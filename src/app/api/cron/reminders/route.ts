import { NextResponse } from 'next/server';
import { isPushConfigured } from '@/server/push';
import { runReminderNotifications } from '@/server/reminder-notify';

// web-push needs Node crypto; it cannot run on the Edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Scheduled reminder notifier. Called every five minutes, all day, by the
 * pg_cron job 'reminder-notifications' (migration 20260928090000).
 *
 * Separate from /api/cron/notify on purpose: reminders need a finer cadence
 * and the whole day, and the order and inventory checks need neither.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');

  // Fail closed, exactly as /api/cron/notify does.
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

  try {
    const result = await runReminderNotifications();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
