import { NextResponse } from 'next/server';
import { isPushConfigured } from '@/server/push';
import { runReminderNotifications } from '@/server/reminder-notify';
import { runEvaluationDeadlineReminders } from '@/server/hr-eval-notify';
import { runCelebrationNotices } from '@/server/hr-celebrations';
import { runPlanNotices, runQuietCustomersSummary } from '@/server/sales-notify';
import { runCoverageNotices } from '@/server/coverage-notify';
import { runMeetingNotices } from '@/server/meeting-jobs';

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
    // Evaluations due today, still unanswered: the same cadence suits them.
    const evaluations = await runEvaluationDeadlineReminders();
    // Birthdays and work anniversaries, from 09:00: 3 days before and on the day.
    const celebrations = await runCelebrationNotices();
    // Customers going quiet: the Ventas team's summary, Monday from 09:00.
    const quiet = await runQuietCustomersSummary();
    // The sales planning: each salesperson's day at 08:00, and 15 minutes before a timed activity.
    const plan = await runPlanNotices();
    // Coverage: the evening before, from 17:00, whoever covers someone tomorrow.
    const coverage = await runCoverageNotices();
    // Meetings: 15 minutes before, to whoever attends.
    const meetings = await runMeetingNotices();
    return NextResponse.json({
      ok: true,
      ...result,
      evaluationReminders: evaluations.sent,
      celebrationNotices: celebrations.sent,
      quietCustomersSummary: quiet.sent,
      planSummaries: plan.summaries,
      planNotices: plan.soon,
      coverageNotices: coverage.sent,
      meetingNotices: meetings.sent,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
