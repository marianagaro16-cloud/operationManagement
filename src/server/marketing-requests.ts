import 'server-only';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { REQUESTS_BUCKET } from '@/lib/marketing';
import type { MarketingRequest, MarketingRequestFull } from '@/types/marketing';

/*
 * Requests to Marketing. RLS: whoever asked — alone or with others — sees
 * their own; Marketing, Admin and Owners see them all.
 */

const COLUMNS = `
  id, title, description, brand_id, due_on, status, requested_by, post_id, done_at, created_at,
  brand:brands ( name ),
  requester:profiles!marketing_requests_requested_by_fkey ( name, email ),
  others:marketing_request_requesters ( profile_id, added_at, person:profiles ( name, email ) )
`;

type Person = { name: string | null; email: string } | null;
type Raw = Omit<MarketingRequest, 'brand_name' | 'requester_name' | 'requester_ids'> & {
  brand: { name: string } | null;
  requester: Person;
  others: { profile_id: string; added_at: string; person: Person }[] | null;
};
const nameOf = (p: Person) => (p ? p.name || p.email : null);

function shape({ brand, requester, others, ...r }: Raw): MarketingRequest {
  const with_ = [...(others ?? [])].sort((a, b) => a.added_at.localeCompare(b.added_at) || a.profile_id.localeCompare(b.profile_id));
  return {
    ...r,
    brand_name: brand?.name ?? null,
    requester_ids: [r.requested_by, ...with_.map((o) => o.profile_id)],
    requester_name: [nameOf(requester), ...with_.map((o) => nameOf(o.person))].filter(Boolean).join(', ') || null,
  };
}

/** Everyone who asked for a request: for the notices, read as the system. */
export async function requesterIds(id: string, requestedBy: string): Promise<string[]> {
  const { data } = await createAdminClient().from('marketing_request_requesters').select('profile_id').eq('request_id', id);
  return [...new Set([requestedBy, ...((data ?? []) as { profile_id: string }[]).map((r) => r.profile_id)])];
}

/** Open ones by due date (none last), or closed ones newest first. */
export async function getRequests(open: boolean): Promise<MarketingRequest[]> {
  const supabase = createClient();
  let query = supabase.from('marketing_requests').select(COLUMNS);
  query = open
    ? query.in('status', ['new', 'in_progress']).order('due_on', { ascending: true, nullsFirst: false }).order('created_at')
    : query.in('status', ['done', 'cancelled']).order('updated_at', { ascending: false }).limit(200);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as unknown as Raw[]).map(shape);
}

export async function getRequest(id: string): Promise<MarketingRequestFull | null> {
  const supabase = createClient();
  const [{ data, error }, { data: comments }, { data: files }] = await Promise.all([
    supabase.from('marketing_requests').select(COLUMNS).eq('id', id).maybeSingle(),
    supabase
      .from('marketing_request_comments')
      .select('id, body, author_id, created_at, author:profiles!marketing_request_comments_author_id_fkey ( name, email )')
      .eq('request_id', id)
      .order('created_at'),
    supabase.from('marketing_request_files').select('id, storage_path, file_name, mime_type, size_bytes, uploaded_by').eq('request_id', id).order('created_at'),
  ]);
  if (error) throw new Error(error.message);
  if (!data) return null;
  const rows = files ?? [];
  const urls = new Map<string, string>();
  if (rows.length) {
    const { data: signed } = await supabase.storage.from(REQUESTS_BUCKET).createSignedUrls(rows.map((r) => r.storage_path), 60 * 60);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return {
    ...shape(data as unknown as Raw),
    comments: ((comments ?? []) as unknown as { id: string; body: string; author_id: string; created_at: string; author: Person }[]).map(
      ({ author, ...c }) => ({ ...c, author_name: nameOf(author) }),
    ),
    files: rows.map(({ storage_path, ...f }) => ({ ...f, url: urls.get(storage_path) ?? null })),
  };
}

/** New requests still waiting — the count on Marketing's menu entry. */
export async function countNewRequests(): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase.from('marketing_requests').select('id', { count: 'exact', head: true }).eq('status', 'new');
  return count ?? 0;
}
