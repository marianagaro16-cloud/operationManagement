import { NextResponse } from 'next/server';
import { ensureOccurrences } from '@/server/data';
import { addDays, businessToday } from '@/lib/datetime';

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

  const today = businessToday();
  try {
    const result = await ensureOccurrences(addDays(today, -1), addDays(today, 60));
    return NextResponse.json({ ok: true, today, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
