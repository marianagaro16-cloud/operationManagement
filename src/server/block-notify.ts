import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import { sendToUsers } from './push';

/*
 * Telling the Admins that an activity is blocked, and why (decided 2026-10-09).
 *
 * Only for the people kept in app_settings ('activities.block_notice_people' —
 * Jefferson, and Marco who covers him): when one of them blocks an activity,
 * every Admin hears it with the reason they wrote, and again when it is free.
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

/** Every approved Admin — owners are admins too — whoever did it aside. */
async function admins(exclude: string): Promise<string[]> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('id')
    .eq('status', 'approved')
    .is('deleted_at', null)
    .in('role', ['admin', 'owner']);
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
