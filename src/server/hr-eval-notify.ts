import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { sendToUser } from './push';

/*
 * Telling people about an evaluation they were asked to fill in: when it is
 * sent to them, and once more on the deadline day if still unanswered.
 * Written in Spanish, like every other server-sent notification.
 */

/** From this hour on the deadline day, the reminder goes out. */
const REMINDER_HOUR = 8;

const day = (date: string) => DateTime.fromISO(date, { zone: BUSINESS_TZ }).setLocale('es').toFormat('cccc d.M.');

/** Never fails the action that caused it: a missed push is not a lost evaluation. */
export async function notifyEvaluationRequested(
  userId: string,
  assignmentId: string,
  workerName: string,
  deadline: string,
) {
  try {
    await sendToUser(userId, {
      title: 'Evaluación pendiente',
      body: `Te han pedido evaluar a ${workerName}. Tienes hasta el ${day(deadline)}.`,
      url: `/evaluations/${assignmentId}`,
      tag: `evaluation-${assignmentId}`,
    });
  } catch (err) {
    console.error('hr-eval-notify: send failed', err);
  }
}

/**
 * On the deadline day, remind whoever has not submitted — once each. Called
 * by the reminders cron every few minutes; reminded_at is claimed before
 * sending, so overlapping runs never send twice.
 */
export async function runEvaluationDeadlineReminders(now = new Date()): Promise<{ sent: number }> {
  const today = businessToday();
  if (DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).hour < REMINDER_HOUR) return { sent: 0 };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('hr_eval_assignments')
    .select('id, evaluator_id, request:hr_eval_requests!inner ( worker_name, deadline, closed_at )')
    .is('submitted_at', null)
    .is('reminded_at', null)
    .not('evaluator_id', 'is', null)
    .eq('request.deadline', today)
    .is('request.closed_at', null)
    .limit(500);
  if (error) throw new Error(`evaluation reminders: ${error.message}`);

  let sent = 0;
  for (const row of (data ?? []) as unknown as {
    id: string;
    evaluator_id: string;
    request: { worker_name: string };
  }[]) {
    const { data: claimed } = await admin
      .from('hr_eval_assignments')
      .update({ reminded_at: now.toISOString() })
      .eq('id', row.id)
      .is('reminded_at', null)
      .select('id');
    if (!claimed?.length) continue;

    try {
      await sendToUser(row.evaluator_id, {
        title: 'Evaluación: último día',
        body: `Hoy es el último día para evaluar a ${row.request.worker_name}.`,
        url: `/evaluations/${row.id}`,
        tag: `evaluation-${row.id}-deadline`,
        level: 'warning',
      });
      sent++;
    } catch (err) {
      console.error('hr-eval-notify: reminder failed', err);
    }
  }
  return { sent };
}
