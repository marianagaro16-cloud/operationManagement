import { NextResponse } from 'next/server';
import { ensureScheduled } from '@/server/scheduling';
import { ensureStandingOrders } from '@/server/order-scheduling';

export const dynamic = 'force-dynamic';

/**
 * Scheduled occurrence generation (Vercel Cron -> vercel.json).
 *
 * Deliberately a Next route rather than a Supabase Edge Function: the
 * recurrence engine is TypeScript in `src/domain`, and running it here keeps
 * ONE implementation of the scheduling rules. A Deno Edge Function would mean
 * a second copy of the most correctness-critical code in the system.
 *
 * Idempotent, so a retried or overlapping invocation is harmless.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // One scheduler for both, and now the ONLY caller in normal operation:
    // pages read, this route materialises. The horizons live in
    // server/scheduling.ts rather than being literals here, so the cron, the
    // admin button and the health check cannot disagree about them.
    const run = await ensureScheduled();

    /*
     * Standing orders ride the same nightly run rather than a second cron.
     *
     * Awaited separately so a template failing cannot stop the daily
     * checklist from being materialised — the two are independent, and the
     * checklist is what the floor opens first thing in the morning.
     */
    let standing: Awaited<ReturnType<typeof ensureStandingOrders>> | { error: string };
    try {
      standing = await ensureStandingOrders();
    } catch (e) {
      standing = { error: e instanceof Error ? e.message : String(e) };
    }

    return NextResponse.json({ ok: true, ...run, standing });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
