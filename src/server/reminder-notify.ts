import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import {
  alertText,
  notificationWindow,
  selectReminderAlerts,
  type NotifiableReminder,
  type SentAlert,
} from '@/domain/reminders/notifications';
import { sendToUsers } from './push';

/**
 * The reminder half of the scheduler.
 *
 * Same claim-before-send pattern as the order and inventory notifiers: the
 * ledger row is inserted first, so two overlapping runs cannot both send, and
 * the unique key is the only coordination needed.
 *
 * Unlike orders, a claim is NOT released when nobody had a device registered.
 * A reminder is personal: the person without push still sees it in the app,
 * highlighted, and retrying every five minutes for a device that will not
 * appear would only re-run the same query all day.
 */
export async function runReminderNotifications(now = new Date()): Promise<{
  considered: number;
  alerts: number;
  sent: number;
}> {
  const admin = createAdminClient();
  const nowIso = now.toISOString();
  const { from, to } = notificationWindow(nowIso);

  const { data: rows, error } = await admin
    .from('reminders')
    .select('id, title, next_at, timezone, notify_before_minutes, participants:reminder_participants ( user_id )')
    .eq('status', 'open')
    .gte('next_at', from)
    .lte('next_at', to)
    .limit(2000);
  if (error) throw new Error(error.message);

  const reminders = (rows ?? []) as unknown as (Omit<NotifiableReminder, 'participant_ids'> & {
    participants: { user_id: string }[];
  })[];
  if (reminders.length === 0) return { considered: 0, alerts: 0, sent: 0 };

  // Who may still receive reminders. A participant whose role no longer holds
  // the capability stopped seeing the reminder under RLS; they must stop
  // hearing about it too.
  const userIds = [...new Set(reminders.flatMap((r) => r.participants.map((p) => p.user_id)))];
  // Two queries for everybody rather than one per participant; mirrors
  // reminders_eligible() in SQL.
  const [{ data: profiles, error: profilesError }, { data: grants, error: grantsError }] = await Promise.all([
    admin.from('profiles').select('id, role, status').in('id', userIds),
    admin.from('role_permissions').select('role').eq('permission', 'reminders.use'),
  ]);
  if (profilesError) throw new Error(profilesError.message);
  if (grantsError) throw new Error(grantsError.message);
  const grantedRoles = new Set((grants ?? []).map((g) => g.role as string));
  const eligible = new Set(
    (profiles ?? [])
      .filter((p) => p.status === 'approved' && (p.role === 'admin' || grantedRoles.has(p.role as string)))
      .map((p) => p.id as string),
  );

  const ids = reminders.map((r) => r.id);
  const { data: sentRows, error: sentError } = await admin
    .from('reminder_notifications')
    .select('reminder_id, kind, step, slot_at')
    .in('reminder_id', ids);
  // A failed lookup must stop the run: read as "nothing sent" it would repeat
  // every alert in the window.
  if (sentError) throw new Error(sentError.message);

  const alerts = selectReminderAlerts(
    reminders.map((r) => ({
      id: r.id,
      title: r.title,
      next_at: r.next_at,
      timezone: r.timezone,
      notify_before_minutes: r.notify_before_minutes,
      participant_ids: r.participants.map((p) => p.user_id).filter((id) => eligible.has(id)),
    })),
    (sentRows ?? []) as SentAlert[],
    nowIso,
  );

  let sent = 0;
  for (const alert of alerts) {
    const { error: claimError } = await admin.from('reminder_notifications').insert({
      reminder_id: alert.reminderId,
      kind: alert.kind,
      step: alert.step,
      slot_at: alert.slotAt,
    });
    if (claimError) continue; // another run claimed it

    const { title, body } = alertText(alert);
    const recipients = await sendToUsers(alert.recipients, {
      title,
      body,
      // One card per reminder: an overdue repeat replaces the due alert
      // rather than stacking beside it.
      tag: `reminder-${alert.reminderId}`,
      url: `/reminders/${alert.reminderId}`,
      // The service worker keeps overdue and critical notifications on screen.
      level: alert.kind === 'overdue' ? 'overdue' : alert.kind === 'due' ? 'critical' : 'warning',
    });

    await admin
      .from('reminder_notifications')
      .update({ recipients })
      .eq('reminder_id', alert.reminderId)
      .eq('kind', alert.kind)
      .eq('step', alert.step)
      .eq('slot_at', alert.slotAt);

    sent += recipients;
  }

  return { considered: reminders.length, alerts: alerts.length, sent };
}
