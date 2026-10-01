import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { QuickNote } from '@/types/notes';

/*
 * Quick notes. RLS returns only the viewer's own and those shared with them —
 * nobody else's, whatever their role.
 */

const COLUMNS = `
  id, owner_id, body, pinned, archived_at, updated_at,
  owner:profiles!quick_notes_owner_id_fkey ( name, email ),
  customer:customers ( id, company_name ),
  items:quick_note_items ( id, body, done, sort_order ),
  shares:quick_note_shares ( profile_id, person:profiles ( name, email ) )
`;

type Person = { name: string | null; email: string } | null;
type Raw = {
  id: string;
  owner_id: string;
  body: string;
  pinned: boolean;
  archived_at: string | null;
  updated_at: string;
  owner: Person;
  customer: { id: string; company_name: string } | null;
  items: { id: string; body: string; done: boolean; sort_order: number }[];
  shares: { profile_id: string; person: Person }[];
};

const nameOf = (p: Person) => (p ? p.name || p.email : null);

function shape(rows: Raw[], viewerId: string): QuickNote[] {
  return rows
    .map((n) => ({
      id: n.id,
      mine: n.owner_id === viewerId,
      owner_name: nameOf(n.owner),
      body: n.body,
      pinned: n.pinned,
      customer: n.customer ? { id: n.customer.id, name: n.customer.company_name } : null,
      archived_at: n.archived_at,
      updated_at: n.updated_at,
      items: [...n.items].sort((a, b) => a.sort_order - b.sort_order).map(({ id, body, done }) => ({ id, body, done })),
      shares: n.shares.map((s) => ({ id: s.profile_id, name: nameOf(s.person) ?? '—' })),
    }))
    // Pinned first (one's own pin), then the latest.
    .sort((a, b) => Number(b.mine && b.pinned) - Number(a.mine && a.pinned) || b.updated_at.localeCompare(a.updated_at));
}

async function viewerId(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function getNotes({ archived = false, customerId, limit }: { archived?: boolean; customerId?: string; limit?: number } = {}): Promise<QuickNote[]> {
  const me = await viewerId();
  if (!me) return [];
  const supabase = createClient();
  let query = supabase.from('quick_notes').select(COLUMNS);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  if (customerId) query = query.eq('customer_id', customerId);
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(archived ? 100 : 300);
  if (error) throw new Error(error.message);
  const notes = shape((data ?? []) as unknown as Raw[], me);
  return limit ? notes.slice(0, limit) : notes;
}
