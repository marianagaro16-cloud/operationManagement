import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, addDays, businessToday } from '@/lib/datetime';
import { isMarketing, isSales, type Role, type Team } from '@/lib/authz';
import { timeRange } from '@/domain/sales/times';
import { sendToUser } from './push';

/** The afternoon before, like the material notice to the responsible person. */
const NOTICE_AT = '14:00';

type Event = { id: string; name: string };
type Part = { event: Event; text: string };

/**
 * The day before, whoever was given something on a confirmed event hears
 * it in one push: their shift, what they bring, their tasks due (decided
 * 2026-10-19). Tasks only for those outside Sales and Marketing — the others
 * get them with their Planning. Once per person and day: the ledger row is
 * claimed before sending.
 */
export async function runEventAssigneeNotices(now = new Date()): Promise<{ sent: number }> {
  const clock = DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).toFormat('HH:mm');
  if (clock < NOTICE_AT) return { sent: 0 };
  const today = businessToday(now);
  const tomorrow = addDays(today, 1);
  const admin = createAdminClient();

  const [{ data: shifts, error }, { data: materials }, { data: tasks }] = await Promise.all([
    admin
      .from('event_shifts')
      .select('profile_id, start_time, end_time, event:events!inner ( id, name, stage )')
      .eq('shift_date', tomorrow)
      .not('profile_id', 'is', null)
      .eq('event.stage', 'confirmed'),
    admin
      .from('event_materials')
      .select('bringer_profile, name, quantity, event:events!inner ( id, name, stage, start_date )')
      .not('bringer_profile', 'is', null)
      .eq('event.stage', 'confirmed')
      .eq('event.start_date', tomorrow),
    admin
      .from('sales_activities')
      .select('salesperson_id, title, person:profiles!sales_activities_salesperson_id_fkey ( role, team ), event:events!inner ( id, name, stage )')
      .eq('activity_date', tomorrow)
      .eq('status', 'planned')
      .neq('event.stage', 'cancelled'),
  ]);
  if (error) throw new Error(`event assignee notices: ${error.message}`);

  const parts = new Map<string, Part[]>();
  const add = (to: string, part: Part) => parts.set(to, [...(parts.get(to) ?? []), part]);

  for (const s of (shifts ?? []) as unknown as { profile_id: string; start_time: string | null; end_time: string | null; event: Event }[]) {
    add(s.profile_id, { event: s.event, text: s.start_time ? `Turno ${timeRange(s.start_time, s.end_time)}` : 'Turno' });
  }
  const qty = (n: number | null) => (n === null ? '' : `${new Intl.NumberFormat('de-CH', { maximumFractionDigits: 2 }).format(n)} × `);
  const bring = new Map<string, { event: Event; things: string[] }>();
  for (const m of (materials ?? []) as unknown as { bringer_profile: string; name: string; quantity: number | null; event: Event }[]) {
    const key = `${m.bringer_profile}|${m.event.id}`;
    bring.set(key, { event: m.event, things: [...(bring.get(key)?.things ?? []), `${qty(m.quantity)}${m.name}`] });
  }
  for (const [key, b] of bring) add(key.split('|')[0]!, { event: b.event, text: `Llevar: ${b.things.join(', ')}` });
  type Task = { salesperson_id: string; title: string | null; person: { role: Role; team: Team } | null; event: Event };
  for (const a of (tasks ?? []) as unknown as Task[]) {
    if (!a.person || isSales(a.person.role, a.person.team) || isMarketing(a.person.team)) continue;
    add(a.salesperson_id, { event: a.event, text: `Tarea: ${a.title ?? ''}` });
  }

  let sent = 0;
  for (const [to, list] of parts) {
    const { data: claimed } = await admin
      .from('event_assignee_notices')
      .upsert({ profile_id: to, notice_date: today }, { onConflict: 'profile_id,notice_date', ignoreDuplicates: true })
      .select('profile_id');
    if (!claimed?.length) continue;
    const events = [...new Map(list.map((p) => [p.event.id, p.event])).values()];
    const one = events.length === 1 ? events[0]! : null;
    try {
      // In Spanish, like every other server-sent notification.
      await sendToUser(to, {
        title: one ? `Mañana: ${one.name}` : `Mañana: ${events.length} eventos`,
        body: list.map((p) => (one ? p.text : `${p.event.name} — ${p.text}`)).join(' · '),
        url: one ? `/events/${one.id}` : `/agenda?date=${tomorrow}`,
        tag: `event-assignee-${tomorrow}`,
      });
      sent++;
    } catch (err) {
      console.error('event assignee notices: send failed', err);
    }
  }
  return { sent };
}
