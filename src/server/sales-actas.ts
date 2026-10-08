import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { agreementStatus, followUpState } from '@/domain/hr/note-structure';
import { actaLate } from '@/domain/sales/acta';
import type {
  ActaAgreement, ActaEntry, ActaMeeting, ActaPoint, ActaRow, ActaTarget, ActaTopic, SalesActa,
} from '@/types/sales-acta';

/*
 * Reads of the Actas of meetings with customers and prospects. RLS gives them
 * to sales (the Ventas team, Admin and Owners), like the notes: for anyone
 * else every read here comes back empty.
 */

type Person = { name: string | null; email: string } | null;
const nameOf = (p: Person) => (p ? p.name || p.email : null);
type Company = { id: string; company_name: string } | null;

function targetOf(customer: Company, prospect: Company): ActaTarget | null {
  if (customer) return { kind: 'customer', id: customer.id, name: customer.company_name };
  if (prospect) return { kind: 'prospect', id: prospect.id, name: prospect.company_name };
  return null;
}

/** Admin's list of what a point is about. */
export async function getActaTopics(includeInactive = false): Promise<ActaTopic[]> {
  const supabase = createClient();
  let query = supabase.from('sales_acta_topics').select('id, name, translations, sort_order, is_active').order('sort_order').order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ActaTopic[];
}

/* ------------------------------ one meeting ------------------------------ */

/** The done visit or appointment an Acta is written for; null when there is nothing to write one for. */
export async function getActaMeeting(activityId: string): Promise<ActaMeeting | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('sales_activities')
    .select(`
      id, salesperson_id, kind_id, activity_date, activity_time, activity_end, place, place_detail, status, acta_required,
      kind:sales_activity_kinds ( behavior ),
      customer:customers ( id, company_name ),
      prospect:prospects ( id, company_name, contact_name, customer_id ),
      organiser:profiles!sales_activities_salesperson_id_fkey ( name, email ),
      participants:sales_activity_participants ( profile:profiles!sales_activity_participants_profile_id_fkey ( id, name, email ) )
    `)
    .eq('id', activityId)
    .maybeSingle();
  if (!data) return null;
  const a = data as unknown as {
    id: string; salesperson_id: string; kind_id: string; activity_date: string; activity_time: string | null; activity_end: string | null;
    place: ActaMeeting['place']; place_detail: string | null; status: string; acta_required: boolean;
    kind: { behavior: string } | null;
    customer: Company;
    prospect: { id: string; company_name: string; contact_name: string | null; customer_id: string | null } | null;
    organiser: Person;
    participants: { profile: { id: string; name: string | null; email: string } | null }[] | null;
  };
  if (a.status !== 'done' || !a.kind || a.kind.behavior === 'plain') return null;

  // A prospect won since: the meeting is read from the customer's file.
  let customer = a.customer;
  if (!customer && a.prospect?.customer_id) {
    const { data: won } = await supabase.from('customers').select('id, company_name').eq('id', a.prospect.customer_id).maybeSingle();
    customer = (won as Company) ?? null;
  }
  const target = targetOf(customer, a.prospect);
  if (!target) return null;

  return {
    activity_id: a.id,
    target,
    contact_name: a.prospect?.contact_name ?? null,
    kind_id: a.kind_id,
    meeting_date: a.activity_date,
    start_time: a.activity_time,
    end_time: a.activity_end,
    place: a.place,
    place_detail: a.place_detail,
    salesperson_id: a.salesperson_id,
    salesperson_name: nameOf(a.organiser) ?? '—',
    participants: (a.participants ?? [])
      .map((p) => p.profile)
      .filter((p): p is { id: string; name: string | null; email: string } => !!p)
      .map((p) => ({ id: p.id, name: p.name || p.email })),
    required: a.acta_required,
  };
}

const ACTA_COLUMNS = `
  activity_id, kind_id, meeting_date, start_time, end_time, place, place_detail, salesperson_id, salesperson_name,
  follow_up_on, registered_at,
  customer:customers ( id, company_name ),
  prospect:prospects ( id, company_name ),
  registrar:profiles!sales_actas_registered_by_fkey ( name, email ),
  attendees:sales_acta_attendees ( id, side, profile_id, name, role ),
  points:sales_acta_points (
    id, sort_order, topic_id, title, discussed,
    agreements:sales_acta_agreements!sales_acta_agreements_point_id_fkey (
      id, sort_order, body, responsible_profile_id, responsible_name, due_on,
      results:sales_acta_agreement_results ( entry_id, result, comment )
    )
  ),
  entries:sales_acta_entries (
    id, kind, entry_date, body, closes, next_on, created_at,
    author:profiles!sales_acta_entries_created_by_fkey ( name, email )
  )
`;

type RawActa = Omit<SalesActa, 'target' | 'registered_by_name' | 'points' | 'entries'> & {
  customer: Company;
  prospect: Company;
  registrar: Person;
  points: (Omit<ActaPoint, 'agreements'> & { sort_order: number; agreements: (ActaAgreement & { sort_order: number })[] | null })[] | null;
  entries: (Omit<ActaEntry, 'author_name'> & { author: Person })[] | null;
};

function toActa({ customer, prospect, registrar, points, entries, attendees, ...r }: RawActa): SalesActa | null {
  const target = targetOf(customer, prospect);
  if (!target) return null;
  const sortedEntries = [...(entries ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const when = new Map(sortedEntries.map((e) => [e.id, e.created_at]));
  return {
    ...r,
    target,
    registered_by_name: nameOf(registrar),
    // Ours first, then theirs; by name within each.
    attendees: [...(attendees ?? [])].sort((a, b) => a.side.localeCompare(b.side) || a.name.localeCompare(b.name)),
    points: [...(points ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ sort_order: _order, agreements, ...p }) => ({
        ...p,
        agreements: [...(agreements ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(({ sort_order: _n, results, ...a }) => ({
            ...a,
            // In the order of the follow-ups that gave them.
            results: [...(results ?? [])].sort((x, y) => (when.get(x.entry_id) ?? '').localeCompare(when.get(y.entry_id) ?? '')),
          })),
      })),
    entries: sortedEntries.map(({ author, ...e }) => ({ ...e, author_name: nameOf(author) })),
  };
}

/** An activity's Acta, draft or registered; null when it has none. */
export async function getActa(activityId: string): Promise<SalesActa | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from('sales_actas').select(ACTA_COLUMNS).eq('activity_id', activityId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toActa(data as unknown as RawActa) : null;
}

/** The Actas registered for meetings held in a period, oldest first — for the summary. */
export async function getActasBetween(from: string, to: string): Promise<SalesActa[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sales_actas')
    .select(ACTA_COLUMNS)
    .gte('meeting_date', from)
    .lte('meeting_date', to)
    .not('registered_at', 'is', null)
    .order('meeting_date');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawActa[]).map(toActa).filter((a): a is SalesActa => !!a);
}

/* --------------------------------- lists --------------------------------- */

const ROW_COLUMNS = `
  activity_id, kind_id, meeting_date, salesperson_id, salesperson_name, follow_up_on, registered_at,
  customer:customers ( id, company_name ),
  prospect:prospects ( id, company_name ),
  points:sales_acta_points (
    sort_order, topic_id, title,
    agreements:sales_acta_agreements!sales_acta_agreements_point_id_fkey ( id, results:sales_acta_agreement_results ( entry_id, result ) )
  ),
  entries:sales_acta_entries ( id, kind, closes, next_on, created_at )
`;

type RawRow = {
  activity_id: string; kind_id: string; meeting_date: string; salesperson_id: string; salesperson_name: string;
  follow_up_on: string | null; registered_at: string | null;
  customer: Company; prospect: Company;
  points: { sort_order: number; topic_id: string | null; title: string; agreements: { id: string; results: { entry_id: string; result: 'met' | 'partly' | 'not_met' }[] | null }[] | null }[] | null;
  entries: { id: string; kind: string; closes: boolean; next_on: string | null; created_at: string }[] | null;
};

function toRow(r: RawRow, today: string): ActaRow | null {
  const target = targetOf(r.customer, r.prospect);
  if (!target) return null;
  const entries = [...(r.entries ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const when = new Map(entries.map((e) => [e.id, e.created_at]));
  const points = [...(r.points ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const agreements = points.flatMap((p) => p.agreements ?? []);
  const met = agreements.filter(
    (a) => agreementStatus({ results: [...(a.results ?? [])].sort((x, y) => (when.get(x.entry_id) ?? '').localeCompare(when.get(y.entry_id) ?? '')) }) === 'met',
  ).length;
  return {
    activity_id: r.activity_id,
    target,
    kind_id: r.kind_id,
    meeting_date: r.meeting_date,
    salesperson_id: r.salesperson_id,
    salesperson_name: r.salesperson_name,
    state: r.registered_at ? 'registered' : 'draft',
    points: points.map((p) => ({ topic_id: p.topic_id, title: p.title })),
    agreements: { total: agreements.length, met },
    followUp: r.registered_at
      ? followUpState({ follow_up_on: r.follow_up_on, follow_ups: entries.filter((e) => e.kind === 'followup') }, today)
      : { status: 'none', dueOn: null },
  };
}

const PENDING_COLUMNS = `
  id, salesperson_id, kind_id, activity_date,
  customer:customers ( id, company_name ),
  prospect:prospects ( id, company_name, customer_id ),
  organiser:profiles!sales_activities_salesperson_id_fkey ( name, email ),
  acta:sales_actas ( activity_id )
`;

type RawPending = {
  id: string; salesperson_id: string; kind_id: string; activity_date: string;
  customer: Company; prospect: (NonNullable<Company> & { customer_id: string | null }) | null; organiser: Person;
  acta: { activity_id: string } | { activity_id: string }[] | null;
};

const hasActa = (p: RawPending) => (Array.isArray(p.acta) ? p.acta.length > 0 : !!p.acta);

function pendingRow(p: RawPending, as?: ActaTarget): ActaRow | null {
  const target = as ?? targetOf(p.customer, p.prospect);
  if (!target) return null;
  return {
    activity_id: p.id,
    target,
    kind_id: p.kind_id,
    meeting_date: p.activity_date,
    salesperson_id: p.salesperson_id,
    salesperson_name: nameOf(p.organiser) ?? '—',
    state: 'pending',
    points: [],
    agreements: { total: 0, met: 0 },
    followUp: { status: 'none', dueOn: null },
  };
}

const latestFirst = (a: ActaRow, b: ActaRow) => b.meeting_date.localeCompare(a.meeting_date);

/**
 * The Actas in a customer's or a prospect's file, latest first: registered,
 * drafts, and the meetings whose Acta is still owed. `wonFromId`: the
 * prospect a customer was won from, whose owed Actas are the customer's now.
 */
export async function getTargetActas(
  target: { customerId: string; wonFromId?: string | null } | { prospectId: string },
  today: string,
): Promise<ActaRow[]> {
  const supabase = createClient();
  const isCustomer = 'customerId' in target;
  let actas = supabase.from('sales_actas').select(ROW_COLUMNS);
  let pending = supabase.from('sales_activities').select(PENDING_COLUMNS).eq('acta_required', true).eq('status', 'done');
  if (isCustomer) {
    actas = actas.eq('customer_id', target.customerId);
    pending = target.wonFromId
      ? pending.or(`customer_id.eq.${target.customerId},prospect_id.eq.${target.wonFromId}`)
      : pending.eq('customer_id', target.customerId);
  } else {
    actas = actas.eq('prospect_id', target.prospectId);
    pending = pending.eq('prospect_id', target.prospectId);
  }
  const [{ data: written, error }, { data: owed, error: owedError }] = await Promise.all([actas, pending]);
  if (error ?? owedError) throw new Error((error ?? owedError)!.message);

  // In the customer's file, a meeting held while they were a prospect is theirs too.
  let as: ActaTarget | undefined;
  if (isCustomer && target.wonFromId) {
    const { data: customer } = await supabase.from('customers').select('id, company_name').eq('id', target.customerId).maybeSingle();
    if (customer) as = { kind: 'customer', id: customer.id, name: customer.company_name };
  }
  return [
    ...((written ?? []) as unknown as RawRow[]).map((r) => toRow(r, today)),
    ...((owed ?? []) as unknown as RawPending[]).filter((p) => !hasActa(p)).map((p) => pendingRow(p, as)),
  ]
    .filter((r): r is ActaRow => !!r)
    .sort(latestFirst);
}

/** Every Acta, latest first, with the meetings whose Acta is still owed — the tab. */
export async function getActaList(today: string, limit = 400): Promise<ActaRow[]> {
  const supabase = createClient();
  const [{ data: written, error }, { data: owed, error: owedError }] = await Promise.all([
    supabase.from('sales_actas').select(ROW_COLUMNS).order('meeting_date', { ascending: false }).limit(limit),
    supabase
      .from('sales_activities')
      .select(PENDING_COLUMNS)
      .eq('acta_required', true)
      .eq('status', 'done')
      .is('acta', null)
      .order('activity_date', { ascending: false })
      .limit(limit),
  ]);
  if (error ?? owedError) throw new Error((error ?? owedError)!.message);
  return [
    ...((written ?? []) as unknown as RawRow[]).map((r) => toRow(r, today)),
    ...((owed ?? []) as unknown as RawPending[]).filter((p) => !hasActa(p)).map((p) => pendingRow(p)),
  ]
    .filter((r): r is ActaRow => !!r)
    .sort(latestFirst);
}

/* ------------------------------- what is owed ------------------------------ */

export interface ActaWork {
  /** The viewer's meetings whose Acta is not registered; late after two days. */
  toWrite: { count: number; late: boolean; first: string | null };
  /** Follow-ups of the viewer's registered Actas, due today or before. */
  followUps: { count: number; late: boolean; first: string | null };
}

/** What a salesperson still owes on their meetings with customers. */
export async function getActaWork(profileId: string, today: string): Promise<ActaWork> {
  const supabase = createClient();
  const [{ data: unbegun }, { data: drafts }, { data: due }] = await Promise.all([
    supabase
      .from('sales_activities')
      .select('id, activity_date, acta:sales_actas ( activity_id )')
      .eq('salesperson_id', profileId)
      .eq('acta_required', true)
      .eq('status', 'done')
      .is('acta', null)
      .order('activity_date'),
    supabase
      .from('sales_actas')
      .select('activity_id, meeting_date, activity:sales_activities!inner ( acta_required )')
      .eq('salesperson_id', profileId)
      .is('registered_at', null)
      .eq('activity.acta_required', true)
      .order('meeting_date'),
    supabase
      .from('sales_acta_follow_up_state')
      .select('activity_id, due_on')
      .eq('salesperson_id', profileId)
      .eq('closed', false)
      .lte('due_on', today)
      .order('due_on'),
  ]);
  const open = [
    ...((unbegun ?? []) as unknown as { id: string; activity_date: string }[]).map((a) => ({ id: a.id, date: a.activity_date })),
    ...((drafts ?? []) as unknown as { activity_id: string; meeting_date: string }[]).map((a) => ({ id: a.activity_id, date: a.meeting_date })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const followUps = (due ?? []) as unknown as { activity_id: string; due_on: string }[];
  return {
    toWrite: { count: open.length, late: open.some((a) => actaLate(a.date, today)), first: open[0]?.id ?? null },
    followUps: { count: followUps.length, late: followUps.some((f) => f.due_on < today), first: followUps[0]?.activity_id ?? null },
  };
}
