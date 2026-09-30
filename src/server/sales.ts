import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getRouteOrigin } from './route';
import type {
  ActivityKind, CustomerNote, DayEnds, Prospect, ProspectListEntry, ProspectNote, QuietCustomer, SalesActivity,
  SalesCustomerFile, SalesCustomerRow, SalesReport, StartPoint, VisitTarget,
} from '@/types/sales';

/*
 * Sales reads. The database decides who is sales (is_sales()): the list and
 * the file come back empty or null for anyone else, and the notes' RLS says
 * the same.
 */

export async function getSalesCustomers(): Promise<SalesCustomerRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('sales_customer_list');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SalesCustomerRow[];
}

export interface CustomerFileView {
  file: SalesCustomerFile;
  notes: CustomerNote[];
  /** What is planned with this customer, soonest first. */
  planned: SalesActivity[];
}

export async function getCustomerFile(customerId: string): Promise<CustomerFileView | null> {
  const supabase = createClient();
  const [{ data: file, error }, { data: notes, error: notesError }, planned] = await Promise.all([
    supabase.rpc('sales_customer_file', { p_customer_id: customerId }),
    supabase
      .from('customer_notes')
      .select('id, kind_id, note_date, body, starred, created_at, author:profiles!customer_notes_created_by_fkey ( name, email )')
      .eq('customer_id', customerId)
      .order('note_date', { ascending: false })
      .order('created_at', { ascending: false }),
    getPlannedFor({ customerId }),
  ]);
  if (error) return null;
  if (!file) return null;
  if (notesError) throw new Error(notesError.message);

  type RawNote = Omit<CustomerNote, 'author_name'> & { author: { name: string | null; email: string } | null };
  return {
    file: file as unknown as SalesCustomerFile,
    notes: ((notes ?? []) as unknown as RawNote[]).map(({ author, ...n }) => ({
      ...n,
      author_name: author ? author.name || author.email : null,
    })),
    planned,
  };
}

/** Customers going quiet, most overdue first. Empty for anyone not in sales. */
export async function getQuietCustomers(): Promise<QuietCustomer[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('sales_quiet_customers');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as QuietCustomer[];
}

const PROSPECT_COLUMNS = `
  id, company_name, contact_name, phone, email, street, postal_code, city, customer_type_id,
  source_id, interest, weekly_volume, stage, owner_id,
  lost_reason_id, lost_note, customer_id, closed_at, created_at,
  owner:profiles!prospects_owner_id_fkey ( name, email )
`;

type Person = { name: string | null; email: string } | null;
const personName = (p: Person) => (p ? p.name || p.email : null);

function toProspect(row: unknown): Omit<Prospect, 'next'> {
  const { owner, ...p } = row as Omit<Prospect, 'owner_name' | 'next'> & { owner: Person };
  return { ...p, owner_name: personName(owner) };
}

/** Each open prospect's soonest planned activity. */
async function nextPlanned(prospectIds: string[]): Promise<Map<string, Prospect['next']>> {
  const next = new Map<string, Prospect['next']>();
  if (prospectIds.length === 0) return next;
  const supabase = createClient();
  const { data } = await supabase
    .from('sales_activities')
    .select('prospect_id, kind_id, activity_date, activity_time, activity_end, title')
    .in('prospect_id', prospectIds)
    .eq('status', 'planned')
    .order('activity_date')
    .order('activity_time', { nullsFirst: false });
  for (const a of data ?? []) {
    if (a.prospect_id && !next.has(a.prospect_id)) {
      next.set(a.prospect_id, { kind_id: a.kind_id, date: a.activity_date, time: a.activity_time, end: a.activity_end, title: a.title });
    }
  }
  return next;
}

/** Every prospect with its next planned activity, the soonest first; closed ones last. */
export async function getProspects(): Promise<Prospect[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('prospects')
    .select(PROSPECT_COLUMNS)
    .order('closed_at', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const prospects = (data ?? []).map(toProspect);
  const next = await nextPlanned(prospects.filter((p) => !p.closed_at).map((p) => p.id));
  return prospects
    .map((p) => ({ ...p, next: next.get(p.id) ?? null }))
    .sort((a, b) => {
      if (!!a.closed_at !== !!b.closed_at) return a.closed_at ? 1 : -1;
      // Nothing planned first — it needs a plan — then the soonest.
      const ka = a.next ? a.next.date + (a.next.time ?? '99') : '';
      const kb = b.next ? b.next.date + (b.next.time ?? '99') : '';
      return ka.localeCompare(kb);
    });
}

export async function getProspect(id: string): Promise<{ prospect: Prospect; notes: ProspectNote[] } | null> {
  const supabase = createClient();
  const [{ data }, { data: notes, error }] = await Promise.all([
    supabase.from('prospects').select(PROSPECT_COLUMNS).eq('id', id).maybeSingle(),
    supabase
      .from('prospect_notes')
      .select('id, kind_id, note_date, body, starred, created_at, author:profiles!prospect_notes_created_by_fkey ( name, email )')
      .eq('prospect_id', id)
      .order('note_date', { ascending: false })
      .order('created_at', { ascending: false }),
  ]);
  if (!data) return null;
  if (error) throw new Error(error.message);
  return {
    prospect: { ...toProspect(data), next: null },
    notes: ((notes ?? []) as unknown as (Omit<ProspectNote, 'author_name'> & { author: Person })[]).map(
      ({ author, ...n }) => ({ ...n, author_name: personName(author) }),
    ),
  };
}

/** The prospect a customer was won from, if any: its contact details live there. */
export async function getWonFrom(customerId: string): Promise<Prospect | null> {
  const supabase = createClient();
  const { data } = await supabase.from('prospects').select(PROSPECT_COLUMNS).eq('customer_id', customerId).maybeSingle();
  return data ? { ...toProspect(data), next: null } : null;
}

/** Who can be responsible for a prospect: the Ventas team, Admin and Owners. */
export async function getSalesPeople(): Promise<{ id: string; name: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, role, team')
    .eq('status', 'approved')
    .is('deleted_at', null)
    .or('team.eq.sales,role.in.(admin,owner)')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ id: p.id, name: p.name || p.email }));
}

export async function getCustomerTypes(): Promise<{ id: string; name: string }[]> {
  const supabase = createClient();
  const { data } = await supabase.from('customer_types').select('id, name').eq('is_active', true).order('sort_order');
  return data ?? [];
}

/** Admin's lists for prospects: how we found them, and why they were lost. */
export async function getProspectLists(includeInactive = false): Promise<{
  sources: ProspectListEntry[];
  lostReasons: ProspectListEntry[];
}> {
  const supabase = createClient();
  const read = (table: 'prospect_sources' | 'prospect_lost_reasons') => {
    let query = supabase.from(table).select('id, name, translations, sort_order, is_active').order('sort_order').order('name');
    if (!includeInactive) query = query.eq('is_active', true);
    return query;
  };
  const [{ data: sources, error }, { data: lostReasons, error: reasonsError }] = await Promise.all([
    read('prospect_sources'),
    read('prospect_lost_reasons'),
  ]);
  if (error) throw new Error(error.message);
  if (reasonsError) throw new Error(reasonsError.message);
  return {
    sources: (sources ?? []) as ProspectListEntry[],
    lostReasons: (lostReasons ?? []) as ProspectListEntry[],
  };
}

/** The sales report for the month containing `month` (YYYY-MM-DD). */
export async function getSalesReport(month: string): Promise<SalesReport> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('sales_report', { p_month: month });
  if (error) throw new Error(error.message);
  return data as unknown as SalesReport;
}

const ACTIVITY_COLUMNS = `
  id, salesperson_id, kind_id, activity_date, activity_time, activity_end, title, place, place_detail, position, status,
  customer:customers ( id, company_name, street, postal_code, city, latitude, longitude ),
  prospect:prospects ( id, company_name, street, postal_code, city, latitude, longitude ),
  event:events ( id, name ),
  organiser:profiles!sales_activities_salesperson_id_fkey ( name, email ),
  participants:sales_activity_participants ( profile:profiles!sales_activity_participants_profile_id_fkey ( id, name, email ) )
`;

type RawPlace = { id: string; company_name: string; street: string | null; postal_code: string | null; city: string | null; latitude: number | null; longitude: number | null };

type RawPerson = { id?: string; name: string | null; email: string };

function toActivity(row: unknown): SalesActivity {
  const { customer, prospect, organiser, participants, ...a } = row as Omit<SalesActivity, 'target' | 'organiser_name' | 'participants'> & {
    customer: RawPlace | null;
    prospect: RawPlace | null;
    organiser: RawPerson | null;
    participants: { profile: RawPerson | null }[] | null;
  };
  const place = customer ?? prospect;
  return {
    ...a,
    organiser_name: organiser ? organiser.name || organiser.email : '—',
    participants: (participants ?? [])
      .map((p) => p.profile)
      .filter((p): p is RawPerson => !!p)
      .map((p) => ({ id: p.id!, name: p.name || p.email })),
    target: place
      ? {
          kind: customer ? 'customer' : 'prospect',
          id: place.id,
          name: place.company_name,
          street: place.street,
          postal_code: place.postal_code,
          city: place.city,
          latitude: place.latitude,
          longitude: place.longitude,
        }
      : null,
  };
}

/** The activities someone takes part in, between two days — not their own. */
async function takingPartIn(profileId: string, from: string, to: string): Promise<string[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('sales_activity_participants')
    .select('activity_id, activity:sales_activities!inner ( activity_date )')
    .eq('profile_id', profileId)
    .gte('activity.activity_date', from)
    .lte('activity.activity_date', to);
  return (data ?? []).map((r) => r.activity_id);
}

/** Their own, and those they take part in. */
function mineOrWith(profileId: string, ids: string[]): string {
  return ids.length ? `salesperson_id.eq.${profileId},id.in.(${ids.join(',')})` : `salesperson_id.eq.${profileId}`;
}

/** A salesperson's activities on a day — and those they take part in: by time, then those without one; visits in route order. */
export async function getPlanDay(salespersonId: string, date: string): Promise<SalesActivity[]> {
  const supabase = createClient();
  const ids = await takingPartIn(salespersonId, date, date);
  const { data, error } = await supabase
    .from('sales_activities')
    .select(ACTIVITY_COLUMNS)
    .or(mineOrWith(salespersonId, ids))
    .eq('activity_date', date)
    .order('activity_time', { nullsFirst: false })
    .order('position')
    .order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map(toActivity);
}

/** How many activities a salesperson has on each day of a range — the week strip. */
export async function getPlanCounts(salespersonId: string, from: string, to: string): Promise<Record<string, { planned: number; total: number }>> {
  const supabase = createClient();
  const ids = await takingPartIn(salespersonId, from, to);
  const { data } = await supabase
    .from('sales_activities')
    .select('activity_date, status')
    .or(mineOrWith(salespersonId, ids))
    .gte('activity_date', from)
    .lte('activity_date', to);
  const counts: Record<string, { planned: number; total: number }> = {};
  for (const a of data ?? []) {
    const c = (counts[a.activity_date] ??= { planned: 0, total: 0 });
    c.total++;
    if (a.status === 'planned') c.planned++;
  }
  return counts;
}

/** What is still planned with a customer or a prospect, soonest first. */
export async function getPlannedFor(target: { customerId?: string; prospectId?: string }): Promise<SalesActivity[]> {
  const supabase = createClient();
  let query = supabase.from('sales_activities').select(ACTIVITY_COLUMNS).eq('status', 'planned');
  query = target.customerId ? query.eq('customer_id', target.customerId) : query.eq('prospect_id', target.prospectId!);
  const { data, error } = await query.order('activity_date').order('activity_time', { nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toActivity);
}

/** The viewer's own activities still planned from before today — late. */
export async function countMyLateActivities(today: string): Promise<number> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase
    .from('sales_activities')
    .select('id', { count: 'exact', head: true })
    .eq('salesperson_id', user.id)
    .eq('status', 'planned')
    .lt('activity_date', today);
  return count ?? 0;
}

/** Admin's list of activity kinds, shared by the planning and the notes. */
export async function getActivityKinds(includeInactive = false): Promise<ActivityKind[]> {
  const supabase = createClient();
  let query = supabase
    .from('sales_activity_kinds')
    .select('id, slug, name, translations, icon, behavior, default_minutes, sort_order, is_active')
    .order('sort_order')
    .order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityKind[];
}

export async function getStartPoint(userId: string): Promise<StartPoint | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('sales_start_points')
    .select('street, postal_code, city, latitude, longitude')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as StartPoint | null) ?? null;
}

/**
 * Everyone who can be visited: active customers and open prospects, with
 * where they are — for adding a visit, and for finding who is nearby.
 */
export async function getVisitablePlaces(): Promise<VisitTarget[]> {
  const supabase = createClient();
  const [{ data: customers, error }, { data: prospects, error: prospectsError }] = await Promise.all([
    supabase
      .from('customers')
      .select('id, company_name, street, postal_code, city, latitude, longitude')
      .eq('is_active', true)
      .order('company_name'),
    supabase
      .from('prospects')
      .select('id, company_name, street, postal_code, city, latitude, longitude')
      .not('stage', 'in', '(won,lost)')
      .order('company_name'),
  ]);
  if (error) throw new Error(error.message);
  if (prospectsError) throw new Error(prospectsError.message);
  const place = (kind: VisitTarget['kind']) => (p: RawPlace): VisitTarget => ({
    kind, id: p.id, name: p.company_name, street: p.street, postal_code: p.postal_code, city: p.city,
    latitude: p.latitude, longitude: p.longitude,
  });
  return [...(customers ?? []).map(place('customer')), ...(prospects ?? []).map(place('prospect'))];
}

/** Where a day starts and ends; home and home when nothing was chosen. */
export async function getDayEnds(salespersonId: string, date: string): Promise<DayEnds> {
  const supabase = createClient();
  const { data } = await supabase
    .from('sales_visit_days')
    .select('start_at, end_at')
    .eq('salesperson_id', salespersonId)
    .eq('visit_date', date)
    .maybeSingle();
  return (data as DayEnds | null) ?? { start_at: 'home', end_at: 'home' };
}

/** The office: the company's address, where the delivery round starts. */
export async function getOfficePoint(): Promise<StartPoint | null> {
  const origin = await getRouteOrigin();
  if (!origin) return null;
  return {
    street: origin.street,
    postal_code: origin.postal_code,
    city: origin.city,
    latitude: origin.latitude === null ? null : Number(origin.latitude),
    longitude: origin.longitude === null ? null : Number(origin.longitude),
  };
}

/** A day's start and end as places: home or the office. */
export async function getDayRoutePoints(salespersonId: string, date: string): Promise<{
  ends: DayEnds;
  home: StartPoint | null;
  office: StartPoint | null;
}> {
  const [ends, home, office] = await Promise.all([getDayEnds(salespersonId, date), getStartPoint(salespersonId), getOfficePoint()]);
  return { ends, home, office };
}

/** A salesperson's activities over a range of days — the week view — by day, then time. */
export async function getPlanRange(salespersonId: string, from: string, to: string): Promise<SalesActivity[]> {
  const supabase = createClient();
  const ids = await takingPartIn(salespersonId, from, to);
  const { data, error } = await supabase
    .from('sales_activities')
    .select(ACTIVITY_COLUMNS)
    .or(mineOrWith(salespersonId, ids))
    .gte('activity_date', from)
    .lte('activity_date', to)
    .order('activity_date')
    .order('activity_time', { nullsFirst: false })
    .order('position')
    .order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map(toActivity);
}

/** An event's tasks — its planned activities — by deadline; done ones included. */
export async function getPlannedForEvent(eventId: string): Promise<SalesActivity[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sales_activities')
    .select(ACTIVITY_COLUMNS)
    .eq('event_id', eventId)
    .order('activity_date')
    .order('activity_time', { nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toActivity);
}
