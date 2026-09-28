import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { CustomerFollowUp, CustomerNote, Prospect, ProspectListEntry, ProspectNote, QuietCustomer, SalesCustomerFile, SalesCustomerRow } from '@/types/sales';

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
  followUps: CustomerFollowUp[];
}

export async function getCustomerFile(customerId: string): Promise<CustomerFileView | null> {
  const supabase = createClient();
  const [{ data: file, error }, { data: notes, error: notesError }, { data: followUps }] = await Promise.all([
    supabase.rpc('sales_customer_file', { p_customer_id: customerId }),
    supabase
      .from('customer_notes')
      .select('id, kind, note_date, body, created_at, author:profiles!customer_notes_created_by_fkey ( name, email )')
      .eq('customer_id', customerId)
      .order('note_date', { ascending: false })
      .order('created_at', { ascending: false }),
    // Reminders are private to their participants: these are the viewer's own.
    supabase
      .from('reminders')
      .select('id, title, next_at')
      .eq('customer_id', customerId)
      .eq('status', 'open')
      .order('next_at'),
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
    followUps: (followUps ?? []) as CustomerFollowUp[],
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
  source_id, interest, weekly_volume, stage, next_step, next_step_on, owner_id,
  lost_reason_id, lost_note, customer_id, closed_at, created_at,
  owner:profiles!prospects_owner_id_fkey ( name, email )
`;

type Person = { name: string | null; email: string } | null;
const personName = (p: Person) => (p ? p.name || p.email : null);

function toProspect(row: unknown): Prospect {
  const { owner, ...p } = row as Omit<Prospect, 'owner_name'> & { owner: Person };
  return { ...p, owner_name: personName(owner) };
}

/** Every prospect, the soonest next step first. Closed ones last. */
export async function getProspects(): Promise<Prospect[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('prospects')
    .select(PROSPECT_COLUMNS)
    .order('next_step_on', { ascending: true, nullsFirst: false })
    .order('closed_at', { ascending: false, nullsFirst: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toProspect);
}

export async function getProspect(id: string): Promise<{ prospect: Prospect; notes: ProspectNote[] } | null> {
  const supabase = createClient();
  const [{ data }, { data: notes, error }] = await Promise.all([
    supabase.from('prospects').select(PROSPECT_COLUMNS).eq('id', id).maybeSingle(),
    supabase
      .from('prospect_notes')
      .select('id, kind, note_date, body, created_at, author:profiles!prospect_notes_created_by_fkey ( name, email )')
      .eq('prospect_id', id)
      .order('note_date', { ascending: false })
      .order('created_at', { ascending: false }),
  ]);
  if (!data) return null;
  if (error) throw new Error(error.message);
  return {
    prospect: toProspect(data),
    notes: ((notes ?? []) as unknown as (Omit<ProspectNote, 'author_name'> & { author: Person })[]).map(
      ({ author, ...n }) => ({ ...n, author_name: personName(author) }),
    ),
  };
}

/** The viewer's open prospects whose next step is today or overdue — the dashboard card. */
export async function getMyDueProspects(today: string): Promise<Prospect[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('prospects')
    .select(PROSPECT_COLUMNS)
    .eq('owner_id', user.id)
    .not('stage', 'in', '(won,lost)')
    .lte('next_step_on', today)
    .order('next_step_on');
  if (error) return [];
  return (data ?? []).map(toProspect);
}

/** The prospect a customer was won from, if any: its contact details live there. */
export async function getWonFrom(customerId: string): Promise<Prospect | null> {
  const supabase = createClient();
  const { data } = await supabase.from('prospects').select(PROSPECT_COLUMNS).eq('customer_id', customerId).maybeSingle();
  return data ? toProspect(data) : null;
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
