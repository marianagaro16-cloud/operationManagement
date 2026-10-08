import 'server-only';
import { DateTime } from 'luxon';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { isAdminRole, type Role, type Team } from '@/lib/authz';
import type { AgendaItem } from '@/types/agenda';
import { getPlanRange } from './sales';
import { getMeetingsFor } from './meetings';
import { getAbsenceCalendar } from './absences';
import { getUsers } from './data';
import { displayName } from '@/lib/utils';
import { personSeesExpected } from './expected-deliveries';

/*
 * The agenda: one person's days, gathered from every part of the app — their
 * activities and counts, their sales plan, meetings, coverage and absences,
 * the deliveries expected from suppliers (for whoever receives or announces
 * them), and (in their own agenda only) their reminders and personal tasks. Each
 * part is read with the viewer's own access, so a manager looking at someone
 * sees what they may see and nothing more.
 */

/** Whose agenda the viewer may open: Admin and Owners and Managers anyone; the Production manager their team; everyone else their own. */
export async function agendaPeople(viewer: { id: string; role: Role; team: Team }): Promise<{ id: string; name: string }[]> {
  const everyone = isAdminRole(viewer.role) || viewer.role === 'manager';
  if (!everyone && viewer.role !== 'production_manager') return [];
  const users = (await getUsers()).filter((u) => u.status === 'approved');
  return users
    .filter((u) => everyone || u.team === viewer.team || u.id === viewer.id)
    .map((u) => ({ id: u.id, name: displayName(u) }));
}

const DELIVERY_COLUMNS = 'id, status, expected_date, expected_week, due_date, pallets, storage, reception_id, supplier:suppliers ( name )';

const zurich = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(BUSINESS_TZ);

export async function getAgenda(personId: string, from: string, to: string, own: boolean, today: string): Promise<AgendaItem[]> {
  const supabase = createClient();
  const items: AgendaItem[] = [];

  // Expected deliveries are nobody's in particular: they show to whoever sees them.
  const seesDeliveries = own || (await personSeesExpected(personId));
  const todayInRange = today >= from && today <= to;

  const [occ, overdue, inv, sales, meetings, coverage, away, reminders, personal, collections, deliveries, lateDeliveries] = await Promise.all([
    supabase
      .from('task_occurrences')
      .select('id, effective_due_date, status, task:tasks!inner ( title, translations )')
      .eq('assignee_id', personId)
      .gte('effective_due_date', from)
      .lte('effective_due_date', to),
    // Still open from before: shown today, as late.
    today >= from && today <= to
      ? supabase
          .from('task_occurrences')
          .select('id, effective_due_date, status, task:tasks!inner ( title, translations )')
          .eq('assignee_id', personId)
          .in('status', ['pending', 'blocked'])
          .lt('effective_due_date', from < today ? from : today)
      : Promise.resolve({ data: [] }),
    supabase
      .from('inventory_assignments')
      .select('instance:inventory_instances!inner ( id, inventory_date, name_snapshot, completed_at )')
      .eq('user_id', personId)
      .gte('instance.inventory_date', from)
      .lte('instance.inventory_date', to),
    getPlanRange(personId, from, to).catch(() => []),
    getMeetingsFor(personId, from, to, true).catch(() => []),
    supabase
      .from('coverage_assignments')
      .select('id, absence_id, cover_date, start_time, end_time')
      .eq('coverer_id', personId)
      .is('removed_at', null)
      .gte('cover_date', from)
      .lte('cover_date', to),
    getAbsenceCalendar(from, to).catch(() => []),
    own
      ? supabase
          .from('reminders')
          .select('id, title, next_at, status')
          .eq('status', 'open')
          // When it is due now: snoozes move it.
          .gte('next_at', DateTime.fromISO(from, { zone: BUSINESS_TZ }).startOf('day').toUTC().toISO()!)
          .lte('next_at', DateTime.fromISO(to, { zone: BUSINESS_TZ }).endOf('day').toUTC().toISO()!)
      : Promise.resolve({ data: [] }),
    own
      ? supabase
          .from('personal_tasks')
          .select('id, title, due_date, due_time, status')
          .eq('owner_id', personId)
          .in('status', ['open', 'in_progress', 'completed'])
          .gte('due_date', from)
          .lte('due_date', to)
      : Promise.resolve({ data: [] }),
    // Collection follow-ups of their cases — the team only (RLS); late ones show today.
    supabase
      .from('collection_cases')
      .select('id, stage, next_follow_up, customer:customers ( company_name ), invoices:collection_invoices ( amount ), payments:collection_payments ( amount )')
      .eq('responsible_id', personId)
      .is('closed_at', null)
      .lte('next_follow_up', to)
      .gte('next_follow_up', today >= from && today <= to ? '1900-01-01' : from),
    // Expected deliveries of these days, and a week without a day when it
    // overlaps them. RLS returns none to anyone who does not see them.
    seesDeliveries
      ? supabase
          .from('expected_deliveries')
          .select(DELIVERY_COLUMNS)
          .in('status', ['expected', 'arrived'])
          .or(`expected_date.lte.${to},expected_week.lte.${to}`)
          .gte('due_date', from)
      : Promise.resolve({ data: [] }),
    // What did not arrive before these days: shown today, as late.
    seesDeliveries && todayInRange
      ? supabase.from('expected_deliveries').select(DELIVERY_COLUMNS).eq('status', 'expected').lt('due_date', from)
      : Promise.resolve({ data: [] }),
  ]);

  // ---- activities ----
  type Occ = { id: string; effective_due_date: string; status: string; task: { title: string; translations: unknown } };
  for (const o of ((occ.data ?? []) as unknown as Occ[])) {
    const open = o.status === 'pending' || o.status === 'blocked';
    items.push({
      key: `activity-${o.id}`, kind: 'activity', id: o.id, date: o.effective_due_date, start: null, end: null,
      title: o.task.title, translations: o.task.translations, detail: o.status === 'blocked' ? 'blocked' : null,
      href: '/dashboard', done: !open, late: open && o.effective_due_date < today, action: open && o.status !== 'blocked' ? 'complete_activity' : null,
    });
  }
  for (const o of ((overdue.data ?? []) as unknown as Occ[])) {
    items.push({
      key: `activity-${o.id}`, kind: 'activity', id: o.id, date: today, start: null, end: null,
      title: o.task.title, translations: o.task.translations, detail: o.effective_due_date,
      href: '/dashboard', done: false, late: true, action: o.status === 'blocked' ? null : 'complete_activity',
    });
  }

  // ---- counts ----
  type Inv = { instance: { id: string; inventory_date: string; name_snapshot: string; completed_at: string | null } };
  for (const r of ((inv.data ?? []) as unknown as Inv[])) {
    items.push({
      key: `inventory-${r.instance.id}`, kind: 'inventory', id: r.instance.id, date: r.instance.inventory_date, start: null, end: null,
      title: r.instance.name_snapshot, detail: null, href: `/inventory/${r.instance.id}`,
      done: !!r.instance.completed_at, late: !r.instance.completed_at && r.instance.inventory_date < today, action: null,
    });
  }

  // ---- sales plan ----
  for (const a of sales) {
    items.push({
      key: `sales-${a.id}`, kind: 'sales', id: a.id, date: a.activity_date,
      start: a.activity_time?.slice(0, 5) ?? null, end: a.activity_end?.slice(0, 5) ?? null,
      title: a.target?.name ?? a.title ?? '', detail: a.kind_id,
      href: a.event ? `/events/${a.event.id}` : `/sales?tab=planning&date=${a.activity_date}&person=${a.salesperson_id}`,
      done: a.status !== 'planned', late: a.status === 'planned' && a.activity_date < today, action: null,
    });
  }

  // ---- meetings ----
  for (const m of meetings) {
    const mine = m.invitees.find((i) => i.profile_id === personId);
    items.push({
      key: `meeting-${m.id}`, kind: 'meeting', id: m.id, date: m.meeting_date,
      start: m.start_time.slice(0, 5), end: m.end_time.slice(0, 5),
      title: m.title, detail: m.status === 'cancelled' ? 'cancelled' : m.place_detail, href: `/meetings/${m.id}`,
      done: m.status === 'cancelled', late: false,
      action: own && mine && m.status === 'scheduled' && m.meeting_date >= today ? 'answer_meeting' : null,
      response: mine?.response,
    });
  }

  // ---- coverage and absences ----
  const byAbsence = new Map(away.map((a) => [a.id, a]));
  for (const c of coverage.data ?? []) {
    items.push({
      key: `coverage-${c.id}`, kind: 'coverage', id: c.id, date: c.cover_date,
      start: c.start_time.slice(0, 5), end: c.end_time.slice(0, 5),
      title: byAbsence.get(c.absence_id)?.person_name ?? '', detail: null, href: `/absences/${c.absence_id}`,
      done: false, late: false, action: null,
    });
  }
  for (const a of away.filter((x) => x.profile_id === personId)) {
    let d = DateTime.fromISO(a.start_date < from ? from : a.start_date, { zone: BUSINESS_TZ });
    const last = a.end_date > to ? to : a.end_date;
    while (d.toISODate()! <= last) {
      const date = d.toISODate()!;
      const start = date === a.start_date ? (a.start_time?.slice(0, 5) ?? (a.first_day === 'afternoon' ? 'pm' : null)) : null;
      const end = date === a.end_date ? (a.end_time?.slice(0, 5) ?? (a.last_day === 'morning' ? 'am' : null)) : null;
      items.push({
        key: `absence-${a.id}-${date}`, kind: 'absence', id: a.id, date,
        start: start && start !== 'pm' ? start : null, end: end && end !== 'am' ? end : null,
        title: '', detail: start === 'pm' ? 'afternoon' : end === 'am' ? 'morning' : null, href: `/absences/${a.id}`,
        done: false, late: false, action: null,
      });
      d = d.plus({ days: 1 });
    }
  }

  // ---- reminders and personal tasks (one's own agenda only) ----
  for (const r of (reminders.data ?? []) as { id: string; title: string; next_at: string }[]) {
    const at = zurich(r.next_at);
    items.push({
      key: `reminder-${r.id}`, kind: 'reminder', id: r.id, date: at.toISODate()!, start: at.toFormat('HH:mm'), end: null,
      title: r.title, detail: null, href: `/reminders/${r.id}`, done: false, late: at.toISODate()! < today, action: null,
    });
  }
  for (const p of (personal.data ?? []) as { id: string; title: string; due_date: string; due_time: string | null; status: string }[]) {
    const done = p.status === 'completed';
    items.push({
      key: `personal-${p.id}`, kind: 'personal', id: p.id, date: p.due_date, start: p.due_time?.slice(0, 5) ?? null, end: null,
      title: p.title, detail: null, href: '/reminders/tasks', done, late: !done && p.due_date < today, action: done ? null : 'complete_personal',
    });
  }

  // ---- collection follow-ups ----
  type Case = {
    id: string; stage: string; next_follow_up: string; customer: { company_name: string } | null;
    invoices: { amount: number | string }[] | null; payments: { amount: number | string }[] | null;
  };
  for (const c of ((collections.data ?? []) as unknown as Case[])) {
    const late = c.next_follow_up < today;
    const open = (c.invoices ?? []).reduce((s, i) => s + Number(i.amount), 0) - (c.payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
    items.push({
      key: `collection-${c.id}`, kind: 'collection', id: c.id,
      // Late ones on today, where they are to be done.
      date: late && today >= from && today <= to ? today : c.next_follow_up, start: null, end: null,
      title: c.customer?.company_name ?? '', detail: `${c.stage === 'promise' ? 'promise' : 'follow_up'}:${Math.max(open, 0).toFixed(2)}`,
      href: `/collections/${c.id}`, done: false, late, action: null,
    });
  }

  // ---- expected deliveries ----
  type Delivery = {
    id: string; status: 'expected' | 'arrived'; expected_date: string | null; expected_week: string | null; due_date: string;
    pallets: number | null; storage: string[]; reception_id: string | null; supplier: { name: string } | null;
  };
  for (const d of ([...(deliveries.data ?? []), ...(lateDeliveries.data ?? [])] as unknown as Delivery[])) {
    const late = d.status === 'expected' && d.due_date < today;
    items.push({
      key: `delivery-${d.id}`, kind: 'delivery', id: d.id,
      date: d.due_date < from ? today : (d.expected_date ?? d.expected_week!), start: null, end: null,
      title: d.supplier?.name ?? '', detail: `${d.pallets ?? ''}|${d.storage.join(',')}`,
      href: d.reception_id ? `/goods-reception/${d.reception_id}` : '/goods-reception?tab=expected',
      done: d.status === 'arrived', late, action: null,
      weekOnly: !d.expected_date && d.due_date >= from,
    });
  }

  // The whole-day things first, then by time.
  return items.sort((a, b) =>
    a.date !== b.date ? a.date.localeCompare(b.date) : (a.start ?? '') === (b.start ?? '') ? a.kind.localeCompare(b.kind) : (a.start ?? '').localeCompare(b.start ?? ''),
  );
}
