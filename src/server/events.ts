import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { SalesActivity } from '@/types/sales';
import type {
  EventContact,
  EventCost,
  EventFile,
  EventKindMaterial,
  EventKindTask,
  EventMaterial,
  EventNote,
  EventListEntry,
  PastMaterial,
  PastMaterialEvent,
  EventOrder,
  EventProduct,
  EventReturn,
  EventRow,
  EventShift,
  StaffCandidate,
} from '@/types/events';
import { getPlannedForEvent } from './sales';
import { EVENT_BUCKET } from '@/lib/events';

/*
 * Events reads. RLS decides who may (is_sales()): the Ventas team, Admin
 * and Owners get everything; anyone else gets nothing back.
 */

const EVENT_COLUMNS = `
  id, kind_id, name, stage, cancel_reason, start_date, end_date, open_time, close_time,
  place_name, street, postal_code, city, customer_id, owner_id, description,
  delivery_date, delivery_method_id, order_id,
  result_summary, result_rating, result_repeat, result_visitors, result_samples, result_contacts,
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
  materials: EventMaterial[];
  order: EventOrder | null;
  products: EventProduct[];
  returns: EventReturn[];
  notes: EventNote[];
  files: EventFile[];
  contacts: EventContact[];
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

  const event = toEvent(data);
  const [{ order, products }, returns, notes, files, contacts, materials] = await Promise.all([
    getEventProducts(event),
    getEventReturns(id),
    getEventNotes(id),
    getEventFiles(id),
    getEventContacts(id),
    getEventMaterials(id),
  ]);

  type RawShift = Omit<EventShift, 'person_name'> & { profile: { name: string | null; email: string } | null };
  return {
    event,
    order,
    products,
    returns,
    notes,
    files,
    contacts,
    materials,
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

/** Who may be an event's responsible person: people in sales (Ventas, Admin, Owners) and in Marketing. */
export async function getEventTaskPeople(): Promise<{ id: string; name: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email')
    .eq('status', 'approved')
    .is('deleted_at', null)
    .or('team.in.(sales,marketing),role.in.(admin,owner)')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ id: p.id, name: p.name || p.email }));
}

/** Admin's lists: event kinds with their standard tasks and material, and cost types. */
export async function getEventLists(includeInactive = false): Promise<{
  kinds: EventListEntry[];
  kindTasks: EventKindTask[];
  kindMaterials: EventKindMaterial[];
  costTypes: EventListEntry[];
}> {
  const supabase = createClient();
  const read = (table: 'event_kinds' | 'event_cost_types') => {
    let q = supabase.from(table).select('id, name, translations, sort_order, is_active').order('sort_order').order('name');
    if (!includeInactive) q = q.eq('is_active', true);
    return q;
  };
  const [
    { data: kinds, error },
    { data: costTypes, error: costError },
    { data: kindTasks, error: taskError },
    { data: kindMaterials, error: materialError },
  ] = await Promise.all([
    read('event_kinds'),
    read('event_cost_types'),
    supabase
      .from('event_kind_tasks')
      .select('id, kind_id, title, translations, anchor, days, sort_order')
      .order('sort_order')
      .order('days'),
    supabase.from('event_kind_materials').select('id, kind_id, name, quantity, sort_order').order('sort_order').order('name'),
  ]);
  if (error) throw new Error(error.message);
  if (costError) throw new Error(costError.message);
  if (taskError) throw new Error(taskError.message);
  if (materialError) throw new Error(materialError.message);
  return {
    kinds: (kinds ?? []) as EventListEntry[],
    kindTasks: (kindTasks ?? []) as EventKindTask[],
    kindMaterials: (kindMaterials ?? []).map((m) => ({ ...m, quantity: m.quantity === null ? null : Number(m.quantity) })),
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

/**
 * What we take: the order's lines once the event has a live order (with what
 * was prepared, once it is ready), the event's own list before that.
 */
async function getEventProducts(event: EventRow): Promise<{ order: EventOrder | null; products: EventProduct[] }> {
  const supabase = createClient();
  if (event.order_id) {
    // Through the event: Orders itself is closed to Marketing's external account.
    const { data: order, error } = await supabase.rpc('event_order', { p_event_id: event.id });
    if (error) throw new Error(error.message);
    if (order) {
      const { lines, ...header } = order as unknown as EventOrder & {
        lines: { product_id: string; ordered_quantity: number | string; note: string | null; position: number; prepared: number | string }[];
      };
      const done = !!header.ready_at;
      return {
        order: header,
        products: [...lines]
          .sort((a, b) => a.position - b.position)
          .map((l) => ({
            product_id: l.product_id,
            quantity: Number(l.ordered_quantity),
            note: l.note,
            prepared: done ? Number(l.prepared) : null,
          })),
      };
    }
  }
  const { data, error } = await supabase
    .from('event_products')
    .select('product_id, quantity, note')
    .eq('event_id', event.id)
    .order('position');
  if (error) throw new Error(error.message);
  return { order: null, products: (data ?? []).map((p) => ({ ...p, quantity: Number(p.quantity), prepared: null })) };
}

async function getEventReturns(eventId: string): Promise<EventReturn[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('event_returns')
    .select('product_id, back_quantity, discarded_quantity')
    .eq('event_id', eventId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    product_id: r.product_id,
    back_quantity: Number(r.back_quantity),
    discarded_quantity: Number(r.discarded_quantity),
  }));
}

async function getEventNotes(eventId: string): Promise<EventNote[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('event_notes')
    .select('id, body, created_at, author:profiles ( name, email )')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as (Omit<EventNote, 'author'> & { author: { name: string | null; email: string } | null })[]).map(
    ({ author, ...n }) => ({ ...n, author: author ? author.name || author.email : null }),
  );
}

async function getEventFiles(eventId: string): Promise<EventFile[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('event_files')
    .select('id, storage_path, file_name, mime_type, size_bytes')
    .eq('event_id', eventId)
    .order('created_at');
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const urls = new Map<string, string>();
  if (rows.length) {
    const { data: signed } = await supabase.storage.from(EVENT_BUCKET).createSignedUrls(rows.map((r) => r.storage_path), 60 * 60);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map(({ storage_path, ...f }) => ({ ...f, url: urls.get(storage_path) ?? null }));
}

async function getEventMaterials(eventId: string): Promise<EventMaterial[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('event_materials')
    .select('id, name, quantity, bringer_profile, bringer_worker, packed, came_back, sort_order')
    .eq('event_id', eventId)
    .order('sort_order')
    .order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({ ...m, quantity: m.quantity === null ? null : Number(m.quantity) }));
}

/**
 * Material from the other events: each thing once, as last used (latest event
 * first), and the events that have any — to bring it back for a new event.
 */
export async function getPastMaterials(eventId: string): Promise<{ things: PastMaterial[]; events: PastMaterialEvent[] }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('event_materials')
    .select('name, quantity, event:events!inner ( id, name, start_date )')
    .neq('event_id', eventId);
  if (error) throw new Error(error.message);
  type Raw = { name: string; quantity: number | string | null; event: { id: string; name: string; start_date: string } };
  const rows = ((data ?? []) as unknown as Raw[]).sort((a, b) => b.event.start_date.localeCompare(a.event.start_date));
  const things = new Map<string, PastMaterial>();
  const events = new Map<string, PastMaterialEvent>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    if (!things.has(key)) {
      things.set(key, {
        name: r.name.trim(),
        quantity: r.quantity === null ? null : Number(r.quantity),
        event_name: r.event.name,
        event_date: r.event.start_date,
      });
    }
    const e = events.get(r.event.id);
    if (e) e.count += 1;
    else events.set(r.event.id, { id: r.event.id, name: r.event.name, start_date: r.event.start_date, count: 1 });
  }
  return {
    things: [...things.values()].sort((a, b) => a.name.localeCompare(b.name)),
    events: [...events.values()],
  };
}

async function getEventContacts(eventId: string): Promise<EventContact[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('prospects')
    .select('id, company_name, contact_name, stage, customer_id')
    .eq('event_id', eventId)
    .order('created_at');
  if (error) throw new Error(error.message);
  return data ?? [];
}
