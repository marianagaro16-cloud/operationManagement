import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { SalesActivity } from '@/types/sales';
import type { EventCost, EventKindTask, EventListEntry, EventRow, EventShift, StaffCandidate } from '@/types/events';
import { getPlannedForEvent } from './sales';

/*
 * Events reads. RLS decides who may (is_sales()): the Ventas team, Admin
 * and Owners get everything; anyone else gets nothing back.
 */

const EVENT_COLUMNS = `
  id, kind_id, name, stage, cancel_reason, start_date, end_date, open_time, close_time,
  place_name, street, postal_code, city, customer_id, owner_id, description,
  customer:customers ( company_name ),
  owner:profiles!events_owner_id_fkey ( name, email )
`;

type Raw = Omit<EventRow, 'customer_name' | 'owner_name'> & {
  customer: { company_name: string } | null;
  owner: { name: string | null; email: string } | null;
};
const toEvent = (row: unknown): EventRow => {
  const { customer, owner, ...e } = row as Raw;
  return { ...e, customer_name: customer?.company_name ?? null, owner_name: owner ? owner.name || owner.email : null };
};

/** Every event: those still to come first, soonest first; then the past ones, latest first. */
export async function getEvents(): Promise<EventRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('events').select(EVENT_COLUMNS).order('start_date');
  if (error) throw new Error(error.message);
  return (data ?? []).map(toEvent);
}

export interface EventView {
  event: EventRow;
  tasks: SalesActivity[];
  shifts: EventShift[];
  costs: EventCost[];
}

export async function getEvent(id: string): Promise<EventView | null> {
  const supabase = createClient();
  const [{ data }, tasks, { data: shifts, error: shiftsError }, { data: costs, error: costsError }] = await Promise.all([
    supabase.from('events').select(EVENT_COLUMNS).eq('id', id).maybeSingle(),
    getPlannedForEvent(id),
    supabase
      .from('event_shifts')
      .select('id, shift_date, start_time, end_time, profile_id, hr_worker_id, note, profile:profiles ( name, email )')
      .eq('event_id', id)
      .order('shift_date')
      .order('start_time', { nullsFirst: false }),
    supabase
      .from('event_costs')
      .select('id, type_id, description, planned_amount, actual_amount')
      .eq('event_id', id)
      .order('created_at'),
  ]);
  if (!data) return null;
  if (shiftsError) throw new Error(shiftsError.message);
  if (costsError) throw new Error(costsError.message);

  // Workers without an account are not readable to sales directly: their names come from the staff list.
  const workers = await getStaffCandidates();
  const workerName = new Map(workers.filter((w) => w.kind === 'worker').map((w) => [w.id, w.name]));

  type RawShift = Omit<EventShift, 'person_name'> & { profile: { name: string | null; email: string } | null };
  return {
    event: toEvent(data),
    tasks,
    shifts: ((shifts ?? []) as unknown as RawShift[]).map(({ profile, ...s }) => ({
      ...s,
      person_name: profile ? profile.name || profile.email : workerName.get(s.hr_worker_id ?? '') ?? '—',
    })),
    costs: (costs ?? []).map((c) => ({
      ...c,
      planned_amount: c.planned_amount === null ? null : Number(c.planned_amount),
      actual_amount: c.actual_amount === null ? null : Number(c.actual_amount),
    })),
  };
}

/** Who can work at an event: approved app users, and workers without an account. */
export async function getStaffCandidates(): Promise<StaffCandidate[]> {
  const supabase = createClient();
  const [{ data: people }, { data: workers }] = await Promise.all([
    supabase.from('profiles').select('id, name, email').eq('status', 'approved').is('deleted_at', null).order('name'),
    supabase.rpc('event_staff_workers'),
  ]);
  return [
    ...(people ?? []).map((p) => ({ kind: 'profile' as const, id: p.id, name: p.name || p.email })),
    ...((workers ?? []) as { id: string; name: string }[]).map((w) => ({ kind: 'worker' as const, id: w.id, name: w.name })),
  ];
}

/** Admin's lists: event kinds with their standard tasks, and cost types. */
export async function getEventLists(includeInactive = false): Promise<{
  kinds: EventListEntry[];
  kindTasks: EventKindTask[];
  costTypes: EventListEntry[];
}> {
  const supabase = createClient();
  const read = (table: 'event_kinds' | 'event_cost_types') => {
    let q = supabase.from(table).select('id, name, translations, sort_order, is_active').order('sort_order').order('name');
    if (!includeInactive) q = q.eq('is_active', true);
    return q;
  };
  const [{ data: kinds, error }, { data: costTypes, error: costError }, { data: kindTasks, error: taskError }] = await Promise.all([
    read('event_kinds'),
    read('event_cost_types'),
    supabase
      .from('event_kind_tasks')
      .select('id, kind_id, title, translations, anchor, days, sort_order')
      .order('sort_order')
      .order('days'),
  ]);
  if (error) throw new Error(error.message);
  if (costError) throw new Error(costError.message);
  if (taskError) throw new Error(taskError.message);
  return {
    kinds: (kinds ?? []) as EventListEntry[],
    kindTasks: (kindTasks ?? []) as EventKindTask[],
    costTypes: (costTypes ?? []) as EventListEntry[],
  };
}

/** The customers an event can be with: the active ones. */
export async function getEventCustomers(): Promise<{ id: string; name: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('customers').select('id, company_name').eq('is_active', true).order('company_name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ id: c.id, name: c.company_name }));
}
