'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { NOTE_KINDS } from '@/types/sales';
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
