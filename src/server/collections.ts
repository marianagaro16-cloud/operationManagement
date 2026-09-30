import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type {
  CollectionAgency,
  CollectionCaseRow,
  CollectionEvent,
  CollectionInvoice,
  CollectionPayment,
} from '@/types/collections';

/*
 * Collections reads. Only the collections team reads any of it (RLS:
 * is_collections); everyone else learns only which customers have payments
 * pending (collection_flagged_customers).
 */

const CASE_COLUMNS = `
  id, customer_id, responsible_id, stage, promised_on, next_follow_up, agency_id, agency_sent_on, agency_reference,
  note, closed_at, created_at,
  customer:customers ( company_name ),
  responsible:profiles!collection_cases_responsible_id_fkey ( name, email ),
  agency:collection_agencies ( name ),
  invoices:collection_invoices ( amount, due_date ),
  payments:collection_payments ( amount )
`;

type Person = { name: string | null; email: string } | null;
const nameOf = (p: Person) => (p ? p.name || p.email : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

type Raw = Omit<CollectionCaseRow, 'customer_name' | 'responsible_name' | 'agency_name' | 'total' | 'paid' | 'open' | 'oldest_due'> & {
  customer: { company_name: string } | null;
  responsible: Person;
  agency: { name: string } | null;
  invoices: { amount: number | string; due_date: string | null }[] | null;
  payments: { amount: number | string }[] | null;
};

function toCase({ customer, responsible, agency, invoices, payments, ...c }: Raw): CollectionCaseRow {
  const total = round2((invoices ?? []).reduce((s, i) => s + Number(i.amount), 0));
  const paid = round2((payments ?? []).reduce((s, p) => s + Number(p.amount), 0));
  const dues = (invoices ?? []).map((i) => i.due_date).filter((d): d is string => !!d).sort();
  return {
    ...c,
    customer_name: customer?.company_name ?? '—',
    responsible_name: nameOf(responsible),
    agency_name: agency?.name ?? null,
    total,
    paid,
    open: round2(Math.max(total - paid, 0)),
    oldest_due: dues[0] ?? null,
  };
}

export async function isCollections(): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.rpc('is_collections');
  return data === true;
}

/** Open cases (follow-up, promise, agency) or closed ones; by next follow-up, then the oldest debt. */
export async function getCases(open: boolean, limit = 200): Promise<CollectionCaseRow[]> {
  const supabase = createClient();
  let q = supabase.from('collection_cases').select(CASE_COLUMNS);
  q = open ? q.is('closed_at', null) : q.not('closed_at', 'is', null);
  const { data, error } = await q.order(open ? 'next_follow_up' : 'closed_at', { ascending: open, nullsFirst: false }).limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Raw[]).map(toCase);
}

export async function getCustomerCases(customerId: string): Promise<CollectionCaseRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('collection_cases').select(CASE_COLUMNS).eq('customer_id', customerId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Raw[]).map(toCase);
}

export async function getCase(id: string): Promise<{
  row: CollectionCaseRow;
  invoices: CollectionInvoice[];
  payments: CollectionPayment[];
  events: CollectionEvent[];
} | null> {
  const supabase = createClient();
  const { data } = await supabase.from('collection_cases').select(CASE_COLUMNS).eq('id', id).maybeSingle();
  if (!data) return null;
  const [{ data: invoices }, { data: payments }, { data: events }] = await Promise.all([
    supabase.from('collection_invoices').select('id, invoice_number, due_date, amount').eq('case_id', id).order('due_date', { nullsFirst: false }),
    supabase.from('collection_payments').select('id, paid_on, amount, via_agency, note').eq('case_id', id).order('paid_on'),
    supabase
      .from('collection_events')
      .select('id, kind, happened_on, body, detail, created_at, author:profiles ( name, email )')
      .eq('case_id', id)
      .order('created_at', { ascending: false }),
  ]);
  return {
    row: toCase(data as unknown as Raw),
    invoices: (invoices ?? []).map((i) => ({ ...i, amount: Number(i.amount) })),
    payments: (payments ?? []).map((p) => ({ ...p, amount: Number(p.amount) })),
    events: ((events ?? []) as unknown as (Omit<CollectionEvent, 'author'> & { author: Person })[]).map(({ author, ...e }) => ({
      ...e,
      author: nameOf(author),
    })),
  };
}

/** Customers with payments pending — all anyone outside the team learns. */
export async function getFlaggedCustomers(): Promise<Set<string>> {
  const supabase = createClient();
  const { data } = await supabase.rpc('collection_flagged_customers');
  return new Set(((data ?? []) as unknown as string[]).map(String));
}

export async function getCollectionTeam(): Promise<{ id: string; name: string }[]> {
  const supabase = createClient();
  const { data } = await supabase.from('collection_team').select('profile_id, person:profiles!collection_team_profile_id_fkey ( name, email )');
  return ((data ?? []) as unknown as { profile_id: string; person: Person }[]).map((r) => ({ id: r.profile_id, name: nameOf(r.person) ?? '—' }));
}

export async function getAgencies(includeInactive = false): Promise<CollectionAgency[]> {
  const supabase = createClient();
  let q = supabase.from('collection_agencies').select('id, name, sort_order, is_active').order('sort_order').order('name');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data } = await q;
  return (data ?? []) as CollectionAgency[];
}

/** The viewer's cases to follow up today or before, and promises due. */
export async function countFollowUpsDue(profileId: string, today: string): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase
    .from('collection_cases')
    .select('id', { count: 'exact', head: true })
    .eq('responsible_id', profileId)
    .is('closed_at', null)
    .lte('next_follow_up', today);
  return count ?? 0;
}

/** Every customer, active ones first: an unpaid invoice may belong to one no longer active. */
export async function getCollectionCustomers(): Promise<{ id: string; name: string }[]> {
  const supabase = createClient();
  const { data } = await supabase.from('customers').select('id, company_name, is_active').order('is_active', { ascending: false }).order('company_name');
  return (data ?? []).map((c) => ({ id: c.id, name: c.company_name }));
}
