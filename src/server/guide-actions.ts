'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { cleanBlocks } from '@/domain/guide/guide';
import type { GuideBlock } from '@/types/guide';
import type { ActionResult } from './actions';

/*
 * Guide writes. Who may do what is RLS's decision (guide_can_edit) and, for
 * ticking, guide_check(): only whoever covers the guide's person today.
 */

function fail(error: unknown): { ok: false; error: string } {
  const message = String((error as { message?: string })?.message ?? error);
  if (message.includes('violates row-level security') || message.includes('not_authorized')) return { ok: false, error: 'not_authorized' };
  if (message.includes('not_today')) return { ok: false, error: 'not_today' };
  if (message.includes('guides_pkey')) return { ok: false, error: 'guide_exists' };
  console.error('[guide]', message);
  return { ok: false, error: 'unknown' };
}

const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);

async function me(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  return (await supabase.auth.getUser()).data.user?.id ?? null;
}

/* --------------------------------- guides -------------------------------- */

const guideSchema = z.object({
  profile_id: z.string().uuid(),
  intro: text(4000),
  day_notes: z.record(z.string().regex(/^[1-7]$/), z.string().trim().max(300)),
});

/** Starts a person's guide, or changes its introduction and the note of each weekday. */
export async function saveGuide(input: z.input<typeof guideSchema>): Promise<ActionResult> {
  const parsed = guideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const uid = await me(supabase);
  const day_notes = Object.fromEntries(Object.entries(parsed.data.day_notes).filter(([, note]) => note));
  const { error } = await supabase
    .from('guides')
    .upsert({ profile_id: parsed.data.profile_id, intro: parsed.data.intro, day_notes, updated_by: uid }, { onConflict: 'profile_id' });
  if (error) return fail(error);
  revalidatePath('/guide');
  return { ok: true, data: undefined };
}

const pointSchema = z.object({
  guide_id: z.string().uuid(),
  kind: z.enum(['task', 'rule']),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, { message: 'weekdays_required' }),
  title: z.string().trim().min(1, { message: 'title_required' }).max(500),
  body: text(4000),
  deadline: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().transform((v) => v || null),
  article_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  supplier_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
});

export type GuidePointInput = z.input<typeof pointSchema>;

/** Adds a point at the end of its guide, or changes one. */
export async function saveGuidePoint(input: GuidePointInput, id?: string): Promise<ActionResult> {
  const parsed = pointSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const supabase = createClient();
  const uid = await me(supabase);
  const row = { ...parsed.data, weekdays: [...new Set(parsed.data.weekdays)].sort(), updated_by: uid };

  if (id) {
    const { error } = await supabase.from('guide_points').update(row).eq('id', id);
    if (error) return fail(error);
  } else {
    const { data: last } = await supabase
      .from('guide_points')
      .select('sort_order')
      .eq('guide_id', row.guide_id)
      .is('removed_at', null)
      .order('sort_order', { ascending: false })
      .limit(1);
    const { error } = await supabase.from('guide_points').insert({ ...row, sort_order: (last?.[0]?.sort_order ?? 0) + 10, created_by: uid });
    if (error) return fail(error);
  }
  revalidatePath('/guide');
  return { ok: true, data: undefined };
}

/** Takes a point off the guide. It stays in the days already ticked. */
export async function removeGuidePoint(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const { error } = await supabase.from('guide_points').update({ removed_at: new Date().toISOString(), updated_by: await me(supabase) }).eq('id', id);
  if (error) return fail(error);
  revalidatePath('/guide');
  return { ok: true, data: undefined };
}

/** Swaps two points' places: how one moves up or down within a day. */
export async function swapGuidePoints(a: { id: string; sort_order: number }, b: { id: string; sort_order: number }): Promise<ActionResult> {
  const ok = z.object({ id: z.string().uuid(), sort_order: z.number().int() });
  if (!ok.safeParse(a).success || !ok.safeParse(b).success) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  // Equal places would swap into themselves; the later one moves a step on.
  const [first, second] = a.sort_order === b.sort_order ? [a.sort_order, a.sort_order + 1] : [b.sort_order, a.sort_order];
  const one = await supabase.from('guide_points').update({ sort_order: first }).eq('id', a.id);
  if (one.error) return fail(one.error);
  const two = await supabase.from('guide_points').update({ sort_order: second }).eq('id', b.id);
  if (two.error) return fail(two.error);
  revalidatePath('/guide');
  return { ok: true, data: undefined };
}

/** The covering person's tick for today: done, "not today", or null to clear it. */
export async function checkGuidePoint(pointId: string, status: 'done' | 'skipped' | null, comment: string | null): Promise<ActionResult> {
  const parsed = z
    .object({ pointId: z.string().uuid(), status: z.enum(['done', 'skipped']).nullable(), comment: z.string().max(1000).nullable() })
    .safeParse({ pointId, status, comment });
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const { error } = await supabase.rpc('guide_check', { p_point_id: pointId, p_status: status, p_comment: comment });
  if (error) return fail(error);
  revalidatePath('/guide');
  revalidatePath('/absences', 'layout');
  return { ok: true, data: undefined };
}

/* -------------------------------- articles ------------------------------- */

const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string().max(300) }),
  z.object({ type: z.literal('text'), text: z.string().max(20000) }),
  z.object({ type: z.literal('image'), path: z.string().max(300).regex(/^[0-9a-f-]{36}\/[\w.-]+$/i), caption: z.string().max(500).optional() }),
  z.object({ type: z.literal('table'), rows: z.array(z.array(z.string().max(1000)).max(12)).max(100) }),
]);

const articleSchema = z.object({
  title: z.string().trim().min(1, { message: 'title_required' }).max(200),
  topic: z.string().trim().max(80),
  blocks: z.array(blockSchema).max(200),
});

export type GuideArticleInput = z.input<typeof articleSchema>;

/**
 * Saves an article. A new one is given its id by the editor, which is the
 * folder its images were uploaded into.
 */
export async function saveGuideArticle(id: string, input: GuideArticleInput): Promise<ActionResult> {
  const parsed = articleSchema.safeParse(input);
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return { ok: false, error: parsed.success ? 'invalid' : parsed.error.issues[0]?.message ?? 'invalid' };
  }
  const supabase = createClient();
  const uid = await me(supabase);
  const blocks = cleanBlocks(parsed.data.blocks as GuideBlock[]);
  // Images live in the article's own folder; nothing points into another's.
  if (blocks.some((b) => b.type === 'image' && !b.path.startsWith(`${id}/`))) return { ok: false, error: 'invalid' };

  const { data: existing } = await supabase.from('guide_articles').select('id').eq('id', id).maybeSingle();
  const row = { title: parsed.data.title, topic: parsed.data.topic, blocks, updated_by: uid };
  const { error } = existing
    ? await supabase.from('guide_articles').update(row).eq('id', id)
    : await supabase.from('guide_articles').insert({ id, ...row, created_by: uid });
  if (error) return fail(error);
  revalidatePath('/guide', 'layout');
  return { ok: true, data: undefined };
}

export async function removeGuideArticle(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const { error } = await supabase.from('guide_articles').update({ removed_at: new Date().toISOString(), updated_by: await me(supabase) }).eq('id', id);
  if (error) return fail(error);
  revalidatePath('/guide', 'layout');
  return { ok: true, data: undefined };
}

/* ------------------------------- suppliers ------------------------------- */

const supplierSchema = z.object({
  supplier_id: z.string().uuid(),
  how: text(4000),
  contact: text(500),
  minimum: text(300),
  deadline: text(300),
  notes: text(4000),
});

/** How to order from a supplier. */
export async function saveSupplierCard(input: z.input<typeof supplierSchema>): Promise<ActionResult> {
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const { error } = await supabase
    .from('supplier_order_info')
    .upsert({ ...parsed.data, updated_by: await me(supabase) }, { onConflict: 'supplier_id' });
  if (error) return fail(error);
  revalidatePath('/guide');
  return { ok: true, data: undefined };
}
