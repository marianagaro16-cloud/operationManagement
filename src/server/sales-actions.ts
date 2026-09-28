'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { NOTE_KINDS, OPEN_STAGES } from '@/types/sales';
import { saveReminder } from './reminder-actions';
import type { ActionResult } from './actions';

/*
 * Sales writes. Who is sales is the database's decision (is_sales() in the
 * notes' RLS). A note is only ever added; a follow-up is an ordinary
 * reminder, linked to the customer, so it arrives, snoozes and shows on the
 * dashboard like every other.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });

/** Follow-ups arrive in the morning, like the day's other notices. */
const FOLLOW_UP_TIME = '09:00';

const noteSchema = z.object({
  customer_id: z.string().uuid(),
  kind: z.enum(NOTE_KINDS),
  note_date: DATE,
  body: z.string().trim().min(1, { message: 'body_required' }).max(5000),
  follow_up_on: DATE.nullable(),
});

export async function addCustomerNote(
  input: z.input<typeof noteSchema>,
): Promise<ActionResult<{ id: string; followUp: 'none' | 'created' | 'failed' }>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_note' };
  const v = parsed.data;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: note, error } = await supabase
    .from('customer_notes')
    .insert({ customer_id: v.customer_id, kind: v.kind, note_date: v.note_date, body: v.body, created_by: user?.id ?? null })
    .select('id')
    .single();
  if (error) {
    return { ok: false, error: error.message.includes('row-level security') ? 'not_authorized' : error.message };
  }

  let followUp: 'none' | 'created' | 'failed' = 'none';
  if (v.follow_up_on) {
    const { data: customer } = await supabase
      .from('customers')
      .select('company_name')
      .eq('id', v.customer_id)
      .maybeSingle();
    // The note is saved either way; a failed follow-up is reported, not undone.
    const res = await saveReminder({
      id: null,
      title: `Seguimiento: ${customer?.company_name ?? ''}`.trim(),
      notes: v.body,
      date: v.follow_up_on,
      time: FOLLOW_UP_TIME,
      timezone: BUSINESS_TZ,
      recurrence: 'none',
      notifyBefore: null,
      link: { type: 'customer', id: v.customer_id },
      participantIds: [],
    });
    followUp = res.ok ? 'created' : 'failed';
  }

  revalidatePath(`/sales/customers/${v.customer_id}`);
  revalidatePath('/sales');
  return { ok: true, data: { id: (note as { id: string }).id, followUp } };
}

/* ------------------------------- prospects ------------------------------- */

const PROSPECT_ERRORS = [
  'not_authorized', 'prospect_closed', 'owner_not_sales', 'use_win_or_lose',
  'lost_reason_required', 'prospect_not_found', 'prospects_open_has_next_step',
];

function prospectFail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: PROSPECT_ERRORS.find((code) => error.message.includes(code)) ?? error.message };
}

const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);

const prospectSchema = z.object({
  company_name: z.string().trim().min(1, { message: 'name_required' }).max(200),
  contact_name: text(200),
  phone: text(60),
  email: text(200),
  street: text(200),
  postal_code: text(20),
  city: text(100),
  customer_type_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  source_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  interest: text(2000),
  weekly_volume: text(200),
  stage: z.enum(OPEN_STAGES),
  next_step: z.string().trim().min(1, { message: 'next_step_required' }).max(300),
  next_step_on: DATE,
  owner_id: z.string().uuid({ message: 'owner_required' }),
});

export type ProspectInput = z.input<typeof prospectSchema>;

/** Create a prospect, or change an open one. Won and lost have their own actions. */
export async function saveProspect(input: ProspectInput, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = prospectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_prospect' };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const query = id
    ? supabase.from('prospects').update(parsed.data).eq('id', id).select('id').single()
    : supabase.from('prospects').insert({ ...parsed.data, created_by: user?.id ?? null }).select('id').single();
  const { data, error } = await query;
  if (error) return prospectFail(error);

  const saved = (data as { id: string }).id;
  revalidatePath('/sales');
  revalidatePath(`/sales/prospects/${saved}`);
  revalidatePath('/dashboard');
  return { ok: true, data: { id: saved } };
}

const prospectNoteSchema = z.object({
  prospect_id: z.string().uuid(),
  kind: z.enum(NOTE_KINDS),
  note_date: DATE,
  body: z.string().trim().min(1, { message: 'body_required' }).max(5000),
});

export async function addProspectNote(input: z.input<typeof prospectNoteSchema>): Promise<ActionResult> {
  const parsed = prospectNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_note' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('prospect_notes').insert({ ...parsed.data, created_by: user?.id ?? null });
  if (error) return prospectFail(error);
  revalidatePath(`/sales/prospects/${parsed.data.prospect_id}`);
  return { ok: true, data: undefined };
}

/** Won: the customer is created and the notes go to its file. Returns the customer. */
export async function winProspect(id: string): Promise<ActionResult<{ customerId: string }>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('sales_prospect_win', { p_prospect_id: id });
  if (error) return prospectFail(error);
  revalidatePath('/sales');
  revalidatePath(`/sales/prospects/${id}`);
  revalidatePath('/dashboard');
  return { ok: true, data: { customerId: data as string } };
}

export async function loseProspect(id: string, reasonId: string, note: string | null): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(reasonId).success) return { ok: false, error: 'lost_reason_required' };
  const supabase = createClient();
  const { error } = await supabase.rpc('sales_prospect_lose', { p_prospect_id: id, p_reason_id: reasonId, p_note: note ?? '' });
  if (error) return prospectFail(error);
  revalidatePath('/sales');
  revalidatePath(`/sales/prospects/${id}`);
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}

/* ------------------------- Admin's prospect lists ------------------------- */

const listEntrySchema = z.object({
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

export type ProspectListInput = z.input<typeof listEntrySchema>;

/** How we found a prospect, or why one was lost: Admin's lists (RLS: is_admin). */
export async function saveProspectListEntry(
  list: 'sources' | 'lost_reasons',
  input: ProspectListInput,
  id?: string,
): Promise<ActionResult> {
  const parsed = listEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_entry' };
  const table = list === 'sources' ? 'prospect_sources' : 'prospect_lost_reasons';
  const supabase = createClient();
  const { error } = id
    ? await supabase.from(table).update(parsed.data).eq('id', id)
    : await supabase.from(table).insert({ ...parsed.data, slug: crypto.randomUUID() });
  if (error) return prospectFail(error);
  revalidatePath('/admin/sales');
  revalidatePath('/sales', 'layout');
  return { ok: true, data: undefined };
}
