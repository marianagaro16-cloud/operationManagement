import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { selectNotifications, type NotifiableOrder } from '@/domain/orders/notifications';
import { isPushConfigured, sendToApprovedUsers } from '@/server/push';
import { businessToday, addDays } from '@/lib/datetime';

// web-push needs Node crypto; it cannot run on the Edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Scheduled push notifier.
 *
 * Finds unfinished orders whose delivery deadline is close (or passed) and
 * pushes one notification per escalation to every approved user's devices.
 *
 * Idempotent: each (order, level) is recorded in order_notifications with a
 * UNIQUE constraint, so running this every 15 minutes — or twice at once —
 * never re-sends the same alert. An order escalating warning -> critical ->
 * overdue produces exactly three notifications over its lifetime.
 *
 * Vercel Cron cannot run more often than daily on the Hobby plan, so for a
 * useful cadence point an external scheduler at this endpoint. See the README.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');

  // Fail closed. An unset secret in production would leave this endpoint open
  // to anyone, letting a stranger burn the team's notifications.
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'cron_secret_not_configured' }, { status: 503 });
    }
  } else if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!isPushConfigured()) {
    return NextResponse.json({ ok: false, error: 'push_not_configured' }, { status: 503 });
  }

  const admin = createAdminClient();
  const today = businessToday();

  try {
    // Only orders that could plausibly be urgent: today and the next day, so
    // an evening deadline still notifies. Cancelled orders are excluded.
    const { data: orders, error } = await admin
      .from('orders')
      .select(`
        id, reference, status, delivery_date, delivery_time,
        customer:customers!inner ( name ),
        lines:order_lines (
          ordered_quantity, shortfall_reason,
          allocations:lot_allocations ( quantity )
        )
      `)
      .gte('delivery_date', addDays(today, -1))
      .lte('delivery_date', addDays(today, 1))
      .neq('status', 'cancelled');

    if (error) throw new Error(error.message);

    const candidateIds = (orders ?? []).map((o) => (o as { id: string }).id);
    if (candidateIds.length === 0) {
      return NextResponse.json({ ok: true, today, considered: 0, sent: 0 });
    }

    // What has already gone out, so escalations notify once each.
    const { data: sentRows } = await admin
      .from('order_notifications')
      .select('order_id, level')
      .in('order_id', candidateIds);

    const alreadySent = new Set(
      (sentRows ?? []).map((r) => `${(r as { order_id: string }).order_id}:${(r as { level: string }).level}`),
    );

    const pending = selectNotifications(
      orders as unknown as NotifiableOrder[],
      alreadySent,
      new Date(),
    );

    let sent = 0;
    const results: { order: number; level: string; recipients: number }[] = [];

    for (const n of pending) {
      // Claim the (order, level) BEFORE sending. The unique constraint means
      // a concurrent run loses the race and skips, rather than both sending.
      const { error: claimError } = await admin
        .from('order_notifications')
        .insert({ order_id: n.orderId, level: n.level, recipients: 0 });
      if (claimError) continue; // already claimed by another run

      const recipients = await sendToApprovedUsers({
        title: n.title,
        body: n.body,
        // One tag per order, so an escalation replaces the earlier card
        // instead of stacking three notifications for the same delivery.
        tag: `order-${n.orderId}`,
        url: '/preparation',
        level: n.level,
      });

      if (recipients === 0) {
        // Nobody has notifications enabled yet. Release the claim so this
        // alert can still fire once someone subscribes, rather than being
        // silently consumed by a run that reached no one.
        await admin
          .from('order_notifications')
          .delete()
          .eq('order_id', n.orderId)
          .eq('level', n.level);
        continue;
      }

      await admin
        .from('order_notifications')
        .update({ recipients })
        .eq('order_id', n.orderId)
        .eq('level', n.level);

      sent += recipients;
      results.push({ order: n.reference, level: n.level, recipients });
    }

    return NextResponse.json({
      ok: true,
      today,
      considered: candidateIds.length,
      notifications: pending.length,
      sent,
      results,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
