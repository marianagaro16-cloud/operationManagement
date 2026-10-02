'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { createOneOffTask } from './planning-actions';
import { sendToMaintenance, sendToUser } from './push';
import type { ActionResult } from './actions';

/*
 * Repair requests. RLS and guard_repair_request() hold who may do what; these
 * shape the input and tell the other side (in Spanish, like every
 * server-sent notification).
 */

const uuid = z.string().uuid();
const URGENCY = ['normal', 'urgent', 'stops_production'] as const;
const URGENCY_ES: Record<(typeof URGENCY)[number], string> = { normal: 'Avería', urgent: 'Avería URGENTE', stops_production: 'Avería — PARA LA PRODUCCIÓN' };

function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security') || error.message.includes('not_authorized')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: error.message };
}

function revalidate(id?: string, equipmentId?: string | null) {
  revalidatePath('/maintenance/repairs');
  if (id) revalidatePath(`/maintenance/repairs/${id}`);
  if (equipmentId) revalidatePath(`/maintenance/equipment/${equipmentId}`);
  revalidatePath('/', 'layout');
}

async function tell(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error('repair notice failed', err);
  }
}

const reportSchema = z.object({
  title: z.string().trim().min(1, { message: 'title_required' }).max(200),
  description: z.string().max(4000).nullable().transform((v) => v?.trim() || null),
  equipment_id: uuid.nullable(),
  place: z.string().trim().max(120).nullable().transform((v) => v || null),
  urgency: z.enum(URGENCY),
});

/** Report something broken — or change one's own report while still new. Maintenance is told. */
export async function reportRepair(input: z.input<typeof reportSchema>, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };
  if (id) {
    const { data, error } = await supabase.from('repair_requests').update(parsed.data).eq('id', id).select('id');
    if (error) return fail(error);
    if (!data?.length) return { ok: false, error: 'not_authorized' };
    revalidate(id, parsed.data.equipment_id);
    return { ok: true, data: { id } };
  }
  const { data, error } = await supabase.from('repair_requests').insert({ ...parsed.data, reported_by: user.id }).select('id').single();
  if (error) return fail(error);
  const [{ data: me }, { data: eq }] = await Promise.all([
    supabase.from('profiles').select('name, email').eq('id', user.id).maybeSingle(),
    parsed.data.equipment_id ? supabase.from('equipment').select('name').eq('id', parsed.data.equipment_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const where = eq?.name ?? parsed.data.place;
  await tell(() =>
    sendToMaintenance(
      {
        title: `${URGENCY_ES[parsed.data.urgency]}: ${parsed.data.title}`,
        body: [where, me ? `reporta ${me.name || me.email}` : null].filter(Boolean).join(' · '),
        url: `/maintenance/repairs/${data.id}`,
        tag: `repair-${data.id}`,
        ...(parsed.data.urgency !== 'normal' ? { level: 'critical' as const } : {}),
      },
      user.id,
    ),
  );
  revalidate(data.id, parsed.data.equipment_id);
  return { ok: true, data: { id: data.id } };
}

/** Cancel (the reporter while new, or Maintenance), or take it up again. */
export async function setRepairStatus(id: string, status: 'new' | 'in_progress' | 'cancelled'): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || !['new', 'in_progress', 'cancelled'].includes(status)) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const { data, error } = await supabase.from('repair_requests').update({ status }).eq('id', id).select('equipment_id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidate(id, data[0].equipment_id);
  return { ok: true, data: undefined };
}

/**
 * Plan it: a maintenance one-off on a day, for whom Maintenance chooses,
 * about the request's equipment — and the request is in progress.
 */
export async function planRepair(id: string, date: string, assigneeIds: string[]): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const { data: req } = await supabase.from('repair_requests').select('title, description, equipment_id, place, reported_by').eq('id', id).maybeSingle();
  if (!req) return { ok: false, error: 'not_authorized' };
  const made = await createOneOffTask({
    title: `Reparar: ${req.title}`,
    description: [req.place, req.description].filter(Boolean).join('\n') || null,
    date,
    team: 'maintenance',
    assignee_ids: assigneeIds,
    product_id: null,
    target_quantity: null,
    equipment_id: req.equipment_id,
  });
  if (!made.ok) return made;
  const { error } = await supabase.from('repair_requests').update({ task_id: made.data.id, status: 'in_progress' }).eq('id', id);
  if (error) return fail(error);
  const day = DateTime.fromISO(date, { zone: BUSINESS_TZ }).setLocale('es').toFormat('cccc d.M.');
  await tell(() => sendToUser(req.reported_by, { title: 'Tu reporte de avería está planificado', body: `${req.title} — el ${day}`, url: `/maintenance/repairs/${id}`, tag: `repair-${id}` }));
  revalidate(id, req.equipment_id);
  return { ok: true, data: undefined };
}

const fixSchema = z.object({
  resolution: z.string().trim().min(1, { message: 'resolution_required' }).max(4000),
  cost: z.number().min(0).max(10_000_000).nullable(),
});

/** Fixed: what was done and what it cost. Whoever reported it is told. */
export async function fixRepair(id: string, input: z.input<typeof fixSchema>): Promise<ActionResult> {
  const parsed = fixSchema.safeParse(input);
  if (!uuid.safeParse(id).success || !parsed.success) return { ok: false, error: parsed.success ? 'invalid' : parsed.error.issues[0]?.message ?? 'invalid' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('repair_requests')
    .update({ status: 'fixed', resolution: parsed.data.resolution, cost: parsed.data.cost })
    .eq('id', id)
    .select('title, reported_by, equipment_id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  const { title, reported_by, equipment_id } = data[0];
  if (reported_by !== user?.id) {
    await tell(() => sendToUser(reported_by, { title: 'Avería arreglada', body: title, url: `/maintenance/repairs/${id}`, tag: `repair-${id}` }));
  }
  revalidate(id, equipment_id);
  return { ok: true, data: undefined };
}
