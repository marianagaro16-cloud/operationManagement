'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { sendToUser, sendToUsers } from './push';
import type { ActionResult } from './actions';

/*
 * Absences writes. The database decides who may: the person requests and
 * changes their own pending request (RLS); approvers decide, and the person
 * or an approver cancels, through absence_decide() / absence_cancel().
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });
const uuid = z.string().uuid();

const KNOWN = [
  'not_authorized', 'absence_overlaps', 'absence_own', 'absence_not_pending', 'absence_closed', 'absence_past',
  'absences_rejection_reason', 'absences_dates', 'absences_halves', 'absences_times', 'absence_person_inactive', 'absence_not_found', 'absence_status_by_rpc',
];
function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: KNOWN.find((c) => error.message.includes(c)) ?? error.message };
}
function revalidateAbsences() {
  revalidatePath('/absences');
  revalidatePath('/dashboard');
}

const absenceSchema = z
  .object({
    type_id: uuid,
    start_date: DATE,
    end_date: DATE,
    first_day: z.enum(['full', 'afternoon']),
    last_day: z.enum(['full', 'morning']),
    start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional().transform((v) => v || null),
    end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional().transform((v) => v || null),
    note: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
  })
  .refine((a) => a.end_date >= a.start_date, { message: 'absences_dates' })
  .refine((a) => !(a.start_date === a.end_date && a.first_day === 'afternoon' && a.last_day === 'morning'), {
    message: 'absences_halves',
  })
  // A time takes the place of a half on that day; on one day, until after from.
  .refine((a) => !(a.start_time && a.first_day !== 'full') && !(a.end_time && a.last_day !== 'full'), { message: 'absences_halves' })
  .refine((a) => a.start_date !== a.end_date || !a.start_time || !a.end_time || a.end_time.slice(0, 5) > a.start_time.slice(0, 5), {
    message: 'absences_times',
  });

export type AbsenceInput = z.input<typeof absenceSchema>;

/** "lunes 12.10. – viernes 16.10." — in Spanish, like every server-sent notification. */
function spanOf(a: { start_date: string; end_date: string }): string {
  const day = (d: string) => DateTime.fromISO(d, { zone: BUSINESS_TZ }).setLocale('es').toFormat('cccc d.M.');
  return a.start_date === a.end_date ? day(a.start_date) : `${day(a.start_date)} – ${day(a.end_date)}`;
}

async function viewerName(): Promise<{ id: string; name: string } | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('name, email').eq('id', user.id).maybeSingle();
  return { id: user.id, name: data ? data.name || data.email : '' };
}

async function approversExcept(id: string): Promise<string[]> {
  const supabase = createClient();
  const { data } = await supabase.from('absence_approvers').select('profile_id');
  return (data ?? []).map((r) => r.profile_id).filter((p) => p !== id);
}

async function notify(people: string[], title: string, body: string, tag: string) {
  if (!people.length) return;
  try {
    await sendToUsers(people, { title, body, url: '/absences?tab=approve', tag });
  } catch (err) {
    console.error('absence notice failed', err);
  }
}

/** Ask for time off: pending until an approver decides; the approvers are told. */
/**
 * An approver enters someone's absence — approved at once, since holidays
 * are agreed elsewhere; the person is told. Their own waits for another
 * approver, who is told.
 */
export async function registerAbsence(profileId: string, input: AbsenceInput): Promise<ActionResult<{ id: string }>> {
  const parsed = absenceSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(profileId).success) return { ok: false, error: parsed.error?.issues[0]?.message ?? 'invalid_absence' };
  const me = await viewerName();
  if (!me) return { ok: false, error: 'not_authorized' };
  const v = parsed.data;
  const supabase = createClient();
  const { data, error } = await supabase.rpc('absence_register', {
    p_profile_id: profileId,
    p_type_id: v.type_id,
    p_start_date: v.start_date,
    p_end_date: v.end_date,
    p_first_day: v.first_day,
    p_last_day: v.last_day,
    // Sent as null, never left out: the function has no defaults, and a missing
    // argument is "function not found" to PostgREST.
    p_start_time: (v.start_time ?? null) as unknown as string,
    p_end_time: (v.end_time ?? null) as unknown as string,
    p_note: (v.note ?? null) as unknown as string,
  });
  if (error) return fail(error);
  const id = data as string;
  if (profileId === me.id) {
    await notify(await approversExcept(me.id), 'Ausencia por aprobar', `${me.name}: ${spanOf(v)}`, `absence-${id}`);
  } else {
    try {
      await sendToUser(profileId, { title: 'Ausencia registrada', body: `${spanOf(v)} (${me.name})`, url: '/absences', tag: `absence-${id}` });
    } catch (err) {
      console.error('absence notice failed', err);
    }
  }
  revalidateAbsences();
  return { ok: true, data: { id } };
}

/**
 * Correct an absence: an approver someone else's (pending or approved); an
 * approver their own while it waits. Its status stays as it is.
 */
export async function updateAbsence(id: string, input: AbsenceInput): Promise<ActionResult> {
  const parsed = absenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_absence' };
  const supabase = createClient();
  const { data, error } = await supabase
    .from('absences')
    .update(parsed.data)
    .eq('id', id)
    .in('status', ['pending', 'approved'])
    .select('id, profile_id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'absence_not_pending' };
  const me = await viewerName();
  if (me && data[0].profile_id !== me.id) {
    try {
      await sendToUser(data[0].profile_id, { title: 'Ausencia cambiada', body: `${spanOf(parsed.data)} (${me.name})`, url: '/absences', tag: `absence-${id}` });
    } catch (err) {
      console.error('absence notice failed', err);
    }
  }
  revalidateAbsences();
  return { ok: true, data: undefined };
}

/** Approve, or reject with a reason. The person is told. */
export async function decideAbsence(id: string, approve: boolean, reason?: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'absence_not_found' };
  const supabase = createClient();
  const { error } = await supabase.rpc('absence_decide', { p_absence_id: id, p_approve: approve, p_reason: reason ?? undefined });
  if (error) return fail(error);
  const { data: a } = await supabase.from('absences').select('profile_id, start_date, end_date, rejection_reason').eq('id', id).maybeSingle();
  if (a) {
    // Someone who must be covered is asked to plan who covers them.
    const { data: needs } = approve
      ? await supabase.from('absence_needs_cover').select('profile_id').eq('profile_id', a.profile_id).maybeSingle()
      : { data: null };
    try {
      await sendToUser(a.profile_id, {
        title: approve ? 'Ausencia aprobada' : 'Ausencia rechazada',
        body: approve
          ? `${spanOf(a)}${needs ? ' — planea quién te cubre.' : ''}`
          : `${spanOf(a)}: ${a.rejection_reason ?? ''}`,
        url: approve && needs ? `/absences/${id}` : '/absences',
        tag: `absence-${id}`,
      });
    } catch (err) {
      console.error('absence notice failed', err);
    }
  }
  revalidateAbsences();
  return { ok: true, data: undefined };
}

/**
 * Call off a pending or approved absence that has not ended. The person
 * cancelling their own tells the approvers; an approver cancelling tells the person.
 */
export async function cancelAbsence(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'absence_not_found' };
  const supabase = createClient();
  const me = await viewerName();
  if (!me) return { ok: false, error: 'not_authorized' };
  const { data: before } = await supabase.from('absences').select('profile_id, status, start_date, end_date').eq('id', id).maybeSingle();
  const { error } = await supabase.rpc('absence_cancel', { p_absence_id: id });
  if (error) return fail(error);

  // Its coverage comes off the plan — kept for the history — and whoever covered is told.
  const { data: dropped } = await supabase
    .from('coverage_assignments')
    .update({ removed_at: new Date().toISOString(), removed_by: me.id })
    .eq('absence_id', id)
    .is('removed_at', null)
    .select('coverer_id');
  const coverers = [...new Set((dropped ?? []).map((c) => c.coverer_id))];
  if (coverers.length && before) {
    const { data: person } = await supabase.from('profiles').select('name, email').eq('id', before.profile_id).maybeSingle();
    try {
      await sendToUsers(coverers, {
        title: 'Ya no cubres una ausencia',
        body: `${person ? person.name || person.email : ''}: ${spanOf(before)} — ausencia cancelada`,
        url: '/absences?tab=coverage',
        tag: `coverage-cancel-${id}`,
      });
    } catch (err) {
      console.error('coverage notice failed', err);
    }
  }

  if (before) {
    if (before.profile_id === me.id) {
      await notify(await approversExcept(me.id), 'Ausencia cancelada', `${me.name}: ${spanOf(before)}`, `absence-${id}`);
    } else {
      try {
        await sendToUser(before.profile_id, { title: 'Ausencia cancelada', body: `${spanOf(before)} (${me.name})`, url: '/absences', tag: `absence-${id}` });
      } catch (err) {
        console.error('absence notice failed', err);
      }
    }
  }
  revalidateAbsences();
  return { ok: true, data: undefined };
}

/* ----------------------------- Admin's lists ----------------------------- */

const typeSchema = z.object({
  name: z.string().trim().min(1, { message: 'name_required' }).max(100),
  translations: z
    .object({
      de: z.object({ name: z.string().trim().max(100).nullable().optional() }).optional(),
      en: z.object({ name: z.string().trim().max(100).nullable().optional() }).optional(),
    })
    .default({}),
  sort_order: z.number().int().default(100),
  is_active: z.boolean().default(true),
});

/** An absence type (RLS: is_admin). Switched off rather than deleted. */
export async function saveAbsenceType(input: z.input<typeof typeSchema>, id?: string): Promise<ActionResult> {
  const parsed = typeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_entry' };
  const supabase = createClient();
  const { error } = id
    ? await supabase.from('absence_types').update(parsed.data).eq('id', id)
    : await supabase.from('absence_types').insert(parsed.data);
  if (error) return fail(error);
  revalidatePath('/admin/absences');
  revalidateAbsences();
  return { ok: true, data: undefined };
}

/** Who approves absences — the whole list at once (RLS: is_admin). */
export async function setAbsenceApprovers(ids: string[]): Promise<ActionResult> {
  const parsed = z.array(uuid).min(1, { message: 'approver_required' }).max(50).safeParse([...new Set(ids)]);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'approver_required' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: current, error: readError } = await supabase.from('absence_approvers').select('profile_id');
  if (readError) return fail(readError);
  const before = (current ?? []).map((r) => r.profile_id);
  const removed = before.filter((id) => !parsed.data.includes(id));
  const added = parsed.data.filter((id) => !before.includes(id));
  if (added.length) {
    const { error } = await supabase.from('absence_approvers').insert(added.map((profile_id) => ({ profile_id, added_by: user?.id ?? null })));
    if (error) return fail(error);
  }
  if (removed.length) {
    const { error } = await supabase.from('absence_approvers').delete().in('profile_id', removed);
    if (error) return fail(error);
  }
  revalidatePath('/admin/absences');
  revalidateAbsences();
  return { ok: true, data: undefined };
}
