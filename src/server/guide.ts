import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { isoWeekday, pointsOn } from '@/domain/guide/guide';
import type {
  Guide,
  GuideAccess,
  GuideArticle,
  GuideArticleBrief,
  GuideBlock,
  GuideCheck,
  GuideDaySummary,
  GuidePoint,
  SupplierCard,
} from '@/types/guide';

/*
 * Guide reads. RLS decides (guide_can_see, guide_reader): editors, the guide's
 * person, the approvers and whoever covers that person today or tomorrow.
 */

export const GUIDE_BUCKET = 'guide-files';

/** Whose guides the viewer may open and whether they write them. Once per request: the menu and the page both ask. */
export const getGuideAccess = cache(async (): Promise<GuideAccess> => {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('guide_access');
  if (error) return { edit: false, guides: [] };
  return data as unknown as GuideAccess;
});

const POINT_COLUMNS = 'id, guide_id, kind, weekdays, title, body, deadline, article_id, supplier_id, sort_order';

export async function getGuide(profileId: string): Promise<Guide | null> {
  const supabase = createClient();
  const [{ data: guide }, { data: points, error }] = await Promise.all([
    supabase.from('guides').select('profile_id, intro, day_notes').eq('profile_id', profileId).maybeSingle(),
    supabase.from('guide_points').select(POINT_COLUMNS).eq('guide_id', profileId).is('removed_at', null).order('sort_order').order('created_at'),
  ]);
  if (!guide) return null;
  if (error) throw new Error(error.message);
  return {
    profile_id: guide.profile_id,
    intro: guide.intro,
    day_notes: (guide.day_notes ?? {}) as Record<string, string>,
    points: (points ?? []) as GuidePoint[],
  };
}

type RawCheck = Omit<GuideCheck, 'checked_by_name'> & { checker: { name: string | null; email: string } | null };
const toCheck = ({ checker, ...c }: RawCheck): GuideCheck => ({ ...c, checked_by_name: checker ? checker.name || checker.email : null });
const CHECK_COLUMNS = 'point_id, check_date, status, comment, checker:profiles!guide_checks_checked_by_fkey ( name, email )';

/** How a guide's points were left on one day. */
export async function getGuideChecks(pointIds: string[], date: string): Promise<GuideCheck[]> {
  if (pointIds.length === 0) return [];
  const supabase = createClient();
  const { data, error } = await supabase.from('guide_checks').select(CHECK_COLUMNS).in('point_id', pointIds).eq('check_date', date);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawCheck[]).map(toCheck);
}

/**
 * The covered days of an absence that are not ahead, each with the tasks its
 * weekday asks for and how they were left. Empty when the person has no guide
 * or the viewer may not read it.
 */
export async function getGuideSummary(profileId: string, dates: string[], today: string): Promise<GuideDaySummary[]> {
  const days = [...new Set(dates)].filter((d) => d <= today).sort();
  if (days.length === 0) return [];
  const supabase = createClient();
  // Removed points too: a day ticked last month keeps the words it had.
  const { data: points } = await supabase
    .from('guide_points')
    .select(`${POINT_COLUMNS}, removed_at, created_at`)
    .eq('guide_id', profileId)
    .eq('kind', 'task');
  const all = (points ?? []) as (GuidePoint & { removed_at: string | null; created_at: string })[];
  if (all.length === 0) return [];
  const { data: checks } = await supabase
    .from('guide_checks')
    .select(CHECK_COLUMNS)
    .in('point_id', all.map((p) => p.id))
    .gte('check_date', days[0]!)
    .lte('check_date', days[days.length - 1]!);
  const byKey = new Map(((checks ?? []) as unknown as RawCheck[]).map((c) => [`${c.point_id}|${c.check_date}`, toCheck(c)]));

  return days
    .map((date) => ({
      date,
      points: pointsOn(all, isoWeekday(date))
        // As the guide stood that day — or anything ticked then.
        .filter((p) => byKey.has(`${p.id}|${date}`) || (p.created_at.slice(0, 10) <= date && (!p.removed_at || p.removed_at.slice(0, 10) > date)))
        .map((p) => ({ id: p.id, title: p.title, deadline: p.deadline, check: byKey.get(`${p.id}|${date}`) ?? null })),
    }))
    .filter((d) => d.points.length > 0);
}

/* -------------------------------- articles ------------------------------- */

export async function getArticles(): Promise<GuideArticleBrief[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('guide_articles')
    .select('id, title, topic, sort_order')
    .is('removed_at', null)
    .order('topic')
    .order('sort_order')
    .order('title');
  if (error) throw new Error(error.message);
  return (data ?? []) as GuideArticleBrief[];
}

/** One article with its images signed for an hour. Null when gone or not the viewer's to read. */
export async function getArticle(id: string): Promise<GuideArticle | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('guide_articles')
    .select('id, title, topic, blocks, sort_order, updated_at')
    .eq('id', id)
    .is('removed_at', null)
    .maybeSingle();
  if (!data) return null;
  const blocks = (Array.isArray(data.blocks) ? data.blocks : []) as unknown as GuideBlock[];
  const paths = blocks.flatMap((b) => (b.type === 'image' ? [b.path] : []));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from(GUIDE_BUCKET).createSignedUrls(paths, 60 * 60);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return {
    id: data.id,
    title: data.title,
    topic: data.topic,
    sort_order: data.sort_order,
    updated_at: data.updated_at,
    blocks: blocks.map((b) => (b.type === 'image' ? { ...b, url: urls.get(b.path) ?? null } : b)),
  };
}

/* ------------------------------- suppliers ------------------------------- */

/** Every active supplier with how to order from it; those with nothing written come back empty. */
export async function getSupplierCards(): Promise<SupplierCard[]> {
  const supabase = createClient();
  const [{ data: suppliers, error }, { data: info }] = await Promise.all([
    supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('supplier_order_info').select('supplier_id, how, contact, minimum, deadline, notes'),
  ]);
  if (error) throw new Error(error.message);
  const byId = new Map((info ?? []).map((i) => [i.supplier_id, i]));
  return (suppliers ?? []).map((s) => {
    const i = byId.get(s.id);
    return {
      supplier_id: s.id,
      name: s.name,
      how: i?.how ?? null,
      contact: i?.contact ?? null,
      minimum: i?.minimum ?? null,
      deadline: i?.deadline ?? null,
      notes: i?.notes ?? null,
    };
  });
}
