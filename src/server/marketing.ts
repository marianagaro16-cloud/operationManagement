import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { MARKETING_BUCKET } from '@/lib/marketing';
import type { MarketingPost, MarketingPostFull } from '@/types/marketing';

/*
 * Content plan reads. RLS (can_read_marketing) decides who gets anything.
 */

const COLUMNS = `
  id, title, brand_id, status, planned_on, published_on, channels, caption, event_id,
  reach, likes, comments, updated_at,
  brand:brands ( name ),
  event:events ( name ),
  author:profiles!marketing_posts_created_by_fkey ( name, email )
`;

type Raw = Omit<MarketingPost, 'brand_name' | 'event_name' | 'author_name'> & {
  brand: { name: string } | null;
  event: { name: string } | null;
  author: { name: string | null; email: string } | null;
};

function shape({ brand, event, author, ...p }: Raw): MarketingPost {
  return { ...p, brand_name: brand?.name ?? null, event_name: event?.name ?? null, author_name: author ? author.name || author.email : null };
}

/** The posts planned between two days, and every idea without a day. */
export async function getPosts(from: string, to: string): Promise<{ dated: MarketingPost[]; undated: MarketingPost[] }> {
  const supabase = createClient();
  const [dated, undated] = await Promise.all([
    supabase.from('marketing_posts').select(COLUMNS).gte('planned_on', from).lte('planned_on', to).order('planned_on'),
    supabase.from('marketing_posts').select(COLUMNS).is('planned_on', null).order('updated_at', { ascending: false }),
  ]);
  if (dated.error) throw new Error(dated.error.message);
  if (undated.error) throw new Error(undated.error.message);
  return {
    dated: (dated.data as unknown as Raw[]).map(shape),
    undated: (undated.data as unknown as Raw[]).map(shape),
  };
}

/** Every post, newest planned first — the list view. */
export async function getAllPosts(): Promise<MarketingPost[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('marketing_posts')
    .select(COLUMNS)
    .order('planned_on', { ascending: false, nullsFirst: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data as unknown as Raw[]).map(shape);
}

export async function getPost(id: string): Promise<MarketingPostFull | null> {
  const supabase = createClient();
  const [{ data, error }, { data: products }, { data: files }] = await Promise.all([
    supabase.from('marketing_posts').select(COLUMNS).eq('id', id).maybeSingle(),
    supabase.from('marketing_post_products').select('product:products ( id, name )').eq('post_id', id),
    supabase.from('marketing_post_files').select('id, storage_path, file_name, mime_type, size_bytes').eq('post_id', id).order('created_at'),
  ]);
  if (error) throw new Error(error.message);
  if (!data) return null;
  const rows = files ?? [];
  const urls = new Map<string, string>();
  if (rows.length) {
    const { data: signed } = await supabase.storage.from(MARKETING_BUCKET).createSignedUrls(rows.map((r) => r.storage_path), 60 * 60);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return {
    ...shape(data as unknown as Raw),
    products: ((products ?? []) as unknown as { product: { id: string; name: string } | null }[])
      .map((r) => r.product)
      .filter((p): p is { id: string; name: string } => !!p),
    files: rows.map(({ storage_path, ...f }) => ({ ...f, url: urls.get(storage_path) ?? null })),
  };
}

/** The posts about one event — shown on the event. */
export async function getEventPosts(eventId: string): Promise<MarketingPost[]> {
  const supabase = createClient();
  const { data } = await supabase.from('marketing_posts').select(COLUMNS).eq('event_id', eventId).order('planned_on');
  return ((data ?? []) as unknown as Raw[]).map(shape);
}

/** What the post form offers: brands, events and products. */
export async function getPostChoices(): Promise<{
  brands: { id: string; name: string }[];
  events: { id: string; name: string; start_date: string }[];
  products: { id: string; name: string }[];
}> {
  const supabase = createClient();
  const [{ data: brands }, { data: events }, { data: products }] = await Promise.all([
    supabase.from('brands').select('id, name').eq('is_active', true).order('sort_order').order('name'),
    supabase.from('events').select('id, name, start_date').neq('stage', 'cancelled').order('start_date', { ascending: false }).limit(200),
    supabase.from('products').select('id, name').eq('is_active', true).order('name'),
  ]);
  return { brands: brands ?? [], events: events ?? [], products: products ?? [] };
}
