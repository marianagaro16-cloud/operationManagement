'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { AGREEMENT_RESULTS } from '@/domain/hr/note-structure';
import { sendToUser } from './push';
import type { ActionResult } from './actions';

/*
 * The Acta of a meeting with a customer or a prospect. Who may write, and
 * whether it is complete, is the database's decision (sales_acta_save); these
 * shape the input, translate errors, and tell the owners once it is registered.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });

const contentSchema = z.object({
  attendees: z
    .array(
      z.object({
        side: z.enum(['ours', 'theirs']),
        profile_id: z.string().uuid().nullable(),
        name: z.string().trim().max(200),
        role: z.string().trim().max(200),
      }),
    )
    .max(40),
  points: z
    .array(
      z.object({
        topic_id: z.string().uuid().nullable(),
        title: z.string().trim().max(300),
        discussed: z.string().trim().max(10000),
        agreements: z
          .array(z.object({ body: z.string().trim().max(2000), responsible_id: z.string().uuid().nullable(), due_on: DATE.nullable() }))
          .max(30),
      }),
    )
    .max(30),
  follow_up_on: DATE.nullable(),
});

export type ActaInput = z.input<typeof contentSchema>;

const ERRORS = [
  'not_authorized', 'acta_not_for_this', 'acta_registered', 'acta_not_registered', 'attendee_required', 'attendee_not_found',
  'point_incomplete', 'topic_required', 'agreement_incomplete', 'responsible_not_sales', 'follow_up_required',
  'follow_up_date_invalid', 'follow_up_closed', 'result_required', 'result_comment_required', 'body_required', 'invalid_date',
];

function fail(error: unknown): { ok: false; error: string } {
  const message = String((error as { message?: string })?.message ?? error);
  return { ok: false, error: ERRORS.find((code) => message.includes(code)) ?? (message.includes('row-level security') ? 'not_authorized' : 'unknown') };
}

/** The Acta's own page, the lists it is in, and the file it belongs to. */
async function revalidate(activityId: string) {
  revalidatePath('/sales');
  revalidatePath(`/sales/actas/${activityId}`);
  revalidatePath('/dashboard');
  const supabase = createClient();
  const { data } = await supabase.from('sales_actas').select('customer_id, prospect_id').eq('activity_id', activityId).maybeSingle();
  if (data?.customer_id) revalidatePath(`/sales/customers/${data.customer_id}`);
  if (data?.prospect_id) revalidatePath(`/sales/prospects/${data.prospect_id}`);
}

/** The owners hear of each registered Acta, once — whoever registered it aside. Never throws. */
async function tellOwners(activityId: string, registeredBy: string | null) {
  try {
    const admin = createAdminClient();
    const [{ data: acta }, { data: owners }] = await Promise.all([
      admin
        .from('sales_actas')
        .select('meeting_date, salesperson_name, customer:customers ( company_name ), prospect:prospects ( company_name )')
        .eq('activity_id', activityId)
        .maybeSingle(),
      admin.from('profiles').select('id').eq('status', 'approved').eq('role', 'owner').is('deleted_at', null),
    ]);
    if (!acta) return;
    const a = acta as unknown as {
      meeting_date: string; salesperson_name: string;
      customer: { company_name: string } | null; prospect: { company_name: string } | null;
    };
    // Written in Spanish, like every other server-sent notification.
    const day = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${a.meeting_date}T12:00:00Z`));
    for (const { id } of ((owners ?? []) as { id: string }[]).filter((o) => o.id !== registeredBy)) {
      const { data: claimed } = await admin
        .from('sales_acta_notices')
        .upsert({ activity_id: activityId, profile_id: id, kind: 'registered' }, { onConflict: 'activity_id,profile_id,kind', ignoreDuplicates: true })
        .select('activity_id');
      if (!claimed?.length) continue;
      await sendToUser(id, {
        title: 'Acta de reunión con cliente',
        body: `${a.customer?.company_name ?? a.prospect?.company_name ?? ''} — ${day} (${a.salesperson_name})`,
        url: `/sales/actas/${activityId}`,
        tag: `acta-registered-${activityId}`,
      });
    }
  } catch (err) {
    console.error('[acta] notice to owners failed', err);
  }
}

/** Saves the Acta as a draft, or registers it: from then on it is permanent. */
export async function saveActa(activityId: string, input: ActaInput, register: boolean): Promise<ActionResult> {
  const parsed = contentSchema.safeParse(input);
  if (!parsed.success || !z.string().uuid().safeParse(activityId).success) return { ok: false, error: 'unknown' };
  const supabase = createClient();
  const { error } = await supabase.rpc('sales_acta_save', { p_activity_id: activityId, p_content: parsed.data, p_register: register });
  if (error) return fail(error);
  if (register) {
    const { data: { user } } = await supabase.auth.getUser();
    await tellOwners(activityId, user?.id ?? null);
  }
  await revalidate(activityId);
  return { ok: true, data: undefined };
}

const entrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('addendum'), entry_date: DATE, body: z.string().trim().min(1, { message: 'body_required' }).max(10000) }),
  // What came of the agreements: it ends here, or it continues on a new date.
  z.object({
    kind: z.literal('followup'),
    entry_date: DATE,
    body: z.string().trim().min(1, { message: 'body_required' }).max(10000),
    closes: z.boolean(),
    next_on: DATE.nullable(),
    results: z
      .array(z.object({ agreement_id: z.string().uuid(), result: z.enum(AGREEMENT_RESULTS), comment: z.string().trim().max(1000).nullable() }))
      .max(200),
  }),
]);

export type ActaEntryInput = z.input<typeof entrySchema>;

/** Adds to a registered Acta — by its salesperson or a manager. The Acta itself is never touched. */
export async function addActaEntry(activityId: string, input: ActaEntryInput): Promise<ActionResult> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'unknown' };
  const v = parsed.data;
  const supabase = createClient();
  const { error } = await supabase.rpc('sales_acta_entry_add', {
    p_activity_id: activityId,
    p_kind: v.kind,
    p_entry_date: v.entry_date,
    p_body: v.body,
    p_closes: v.kind === 'followup' && v.closes,
    p_next_on: v.kind === 'followup' && !v.closes ? v.next_on : null,
    p_results: v.kind === 'followup' ? v.results : null,
  });
  if (error) return fail(error);
  await revalidate(activityId);
  return { ok: true, data: undefined };
}
