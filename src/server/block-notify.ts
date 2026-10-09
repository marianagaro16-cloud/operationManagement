import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { sendToUsers } from './push';

/*
 * Telling the Admins that an activity is blocked, and why (decided 2026-10-09).
 *
 * Only for the people kept in app_settings ('activities.block_notice_people' —
 * Jefferson, and Marco who covers him): when one of them blocks an activity,
 * every Admin — not the owners — hears it with the reason they wrote, and
 * again when it is free.
 * Written in Spanish, like every other server-sent notification.
 */

interface Blocked {
  id: string;
  task: { title: string; team: string | null } | null;
}

async function watched(): Promise<string[]> {
  const { data } = await createAdminClient().from('app_settings').select('value').eq('key', 'activities.block_notice_people').maybeSingle();
  return (Array.isArray(data?.value) ? data.value : []).filter((v): v is string => typeof v === 'string');
}

/** Every approved Admin, whoever did it aside. Not the owners: they asked not to be told. */
async function admins(exclude: string): Promise<string[]> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('id')
    .eq('status', 'approved')
    .is('deleted_at', null)
    .eq('role', 'admin');
  return ((data ?? []) as { id: string }[]).map((p) => p.id).filter((id) => id !== exclude);
}

async function firstName(userId: string): Promise<string> {
  const { data } = await createAdminClient().from('profiles').select('name').eq('id', userId).maybeSingle();
  return (data?.name ?? '').trim().split(' ')[0] || 'Alguien';
}

async function load(occurrenceId: string): Promise<Blocked | null> {
  const { data } = await createAdminClient()
    .from('task_occurrences')
    .select('id, task:tasks ( title, team )')
    .eq('id', occurrenceId)
    .maybeSingle();
  return (data as unknown as Blocked) ?? null;
}

const url = (o: Blocked) => (o.task?.team ? `/calendar?team=${o.task.team}` : '/dashboard');

/** Never fails the block that caused it. */
export async function notifyActivityBlocked(occurrenceId: string, actorId: string, reason: string): Promise<void> {
  try {
    if (!(await watched()).includes(actorId)) return;
    const [o, name, to] = await Promise.all([load(occurrenceId), firstName(actorId), admins(actorId)]);
    if (!o) return;
    await sendToUsers(to, {
      title: `${name} bloqueó: ${o.task?.title ?? 'una actividad'}`,
      body: `Motivo: ${reason}`,
      url: url(o),
      // The time in the tag: blocked again later is a notice of its own.
      tag: `activity-blocked-${o.id}-${Date.now()}`,
      level: 'warning',
    });
  } catch (err) {
    console.error('block-notify: blocked notice failed', err);
  }
}

/** Free again: told for the blocks that were told, whoever cleared it. */
export async function notifyActivityUnblocked(
  occurrenceId: string,
  actorId: string,
  was: { blocked_by: string | null; blocked_reason: string | null },
): Promise<void> {
  try {
    if (!was.blocked_by || !(await watched()).includes(was.blocked_by)) return;
    const [o, name, to] = await Promise.all([load(occurrenceId), firstName(actorId), admins(actorId)]);
    if (!o) return;
    await sendToUsers(to, {
      title: `Desbloqueada: ${o.task?.title ?? 'una actividad'}`,
      body: [`${name} la desbloqueó.`, was.blocked_reason ? `Estaba bloqueada por: ${was.blocked_reason}` : null].filter(Boolean).join(' '),
      url: url(o),
      tag: `activity-unblocked-${o.id}-${Date.now()}`,
    });
  } catch (err) {
    console.error('block-notify: unblocked notice failed', err);
  }
}

/* ------------------------- still blocked, each morning ------------------------- */

interface StillBlocked {
  id: string;
  assignee_id: string | null;
  blocked_by: string | null;
  blocked_reason: string | null;
  task: { title: string; is_active: boolean } | null;
}

/** "A, B y 2 más" */
function listed(titles: string[]): string {
  const shown = titles.slice(0, 3).join(', ');
  return titles.length > 3 ? `${shown} y ${titles.length - 3} más` : shown;
}

/**
 * Blocked work stays owed (decided 2026-10-09): each working morning, whoever
 * has a blocked activity is reminded of theirs, and the Admin of all of them.
 * Once per person and day — the ledger row is claimed before sending, so the
 * scheduler can call this on every run.
 */
export async function runBlockedReminders(now = new Date()): Promise<{ sent: number }> {
  const admin = createAdminClient();
  const local = DateTime.fromJSDate(now, { zone: BUSINESS_TZ });
  const today = businessToday(now);

  // The working week and the hour it starts, as kept for absences.
  const { data: setting } = await admin.from('app_settings').select('value').eq('key', 'absences.hours').maybeSingle();
  const hours = (setting?.value ?? {}) as { days?: number[]; start?: string };
  if (!(hours.days ?? [1, 2, 3, 4, 5]).includes(local.weekday % 7)) return { sent: 0 };
  // A morning reminder: from the start of the day until noon, never later.
  const clock = local.toFormat('HH:mm');
  if (clock < (hours.start ?? '06:30') || clock >= '12:00') return { sent: 0 };

  const { data, error } = await admin
    .from('task_occurrences')
    .select('id, assignee_id, blocked_by, blocked_reason, task:tasks!inner ( title, is_active )')
    .eq('status', 'blocked')
    .eq('task.is_active', true)
    .lte('effective_due_date', today)
    .order('effective_due_date');
  if (error) throw new Error(`blocked reminders: ${error.message}`);
  const rows = (data ?? []) as unknown as StillBlocked[];
  if (rows.length === 0) return { sent: 0 };

  // Whose each one is: the person it is assigned to, else whoever blocked it.
  const byPerson = new Map<string, StillBlocked[]>();
  for (const r of rows) {
    const owner = r.assignee_id ?? r.blocked_by;
    if (owner) byPerson.set(owner, [...(byPerson.get(owner) ?? []), r]);
  }
  const adminIds = await admins('');

  const claim = async (userId: string) => {
    const { data: claimed } = await admin
      .from('activity_block_reminders')
      .upsert({ reminder_date: today, user_id: userId }, { onConflict: 'reminder_date,user_id', ignoreDuplicates: true })
      .select('user_id');
    return Boolean(claimed?.length);
  };

  let sent = 0;
  for (const [userId, mine] of byPerson) {
    // An Admin gets the one list of everything, their own included.
    if (adminIds.includes(userId) || !(await claim(userId))) continue;
    try {
      await sendToUsers([userId], {
        title: mine.length === 1 ? 'Tienes 1 actividad bloqueada' : `Tienes ${mine.length} actividades bloqueadas`,
        body: `Siguen pendientes de hacer: ${listed(mine.map((r) => r.task?.title ?? ''))}`,
        url: '/dashboard',
        tag: `blocked-reminder-${today}`,
        level: 'warning',
      });
      sent++;
    } catch (err) {
      console.error('block-notify: reminder failed', err);
    }
  }

  const names = new Map<string, string>();
  for (const id of byPerson.keys()) names.set(id, await firstName(id));
  for (const adminId of adminIds) {
    if (!(await claim(adminId))) continue;
    try {
      await sendToUsers([adminId], {
        title: rows.length === 1 ? '1 actividad sigue bloqueada' : `${rows.length} actividades siguen bloqueadas`,
        body: [...byPerson]
          .map(([id, list]) => `${names.get(id)}: ${list.map((r) => `${r.task?.title ?? ''} (${r.blocked_reason ?? ''})`).join(', ')}`)
          .join(' · ')
          .slice(0, 400),
        url: '/dashboard',
        tag: `blocked-reminder-${today}`,
        level: 'warning',
      });
      sent++;
    } catch (err) {
      console.error('block-notify: admin reminder failed', err);
    }
  }
  return { sent };
}
