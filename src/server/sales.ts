import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { CustomerFollowUp, CustomerNote, SalesCustomerFile, SalesCustomerRow } from '@/types/sales';

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
