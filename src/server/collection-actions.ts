'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { sendToUser } from './push';
import type { ActionResult } from './actions';
import type { CollectionFlag, CollectionStage } from '@/types/collections';

/*
 * Collections writes — the collections team only (RLS: is_collections).
 * Every step is added to the case's history.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });
const uuid = z.string().uuid();
const optDate = DATE.nullable().optional().transform((v) => v ?? null);
const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);
/** The invoicing program's payment reminders before follow-up: two (2026-10-02; it was three). */
const LAST_REMINDER = 2;
const money = z.number().positive({ message: 'invalid_amount' }).max(10_000_000);

const KNOWN = ['not_authorized', 'responsible_not_team', 'collection_cases_agency', 'collection_cases_promise'];
function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: KNOWN.find((c) => error.message.includes(c)) ?? error.message };
}
function revalidateCase(id?: string) {
  revalidatePath('/collections');
  if (id) revalidatePath(`/collections/${id}`);
  revalidatePath('/dashboard');
  revalidatePath('/agenda');
}

async function me(): Promise<string | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function log(caseId: string, kind: string, body: string | null, detail: Record<string, unknown> = {}, happenedOn?: string) {
  const supabase = createClient();
  const uid = await me();
  await supabase.from('collection_events').insert({
    case_id: caseId,
    kind,
    body,
    detail,
    created_by: uid,
    ...(happenedOn ? { happened_on: happenedOn } : {}),
  });
}

/** The open amount of a case: its invoices less what came in. */
async function openAmount(caseId: string): Promise<number> {
  const supabase = createClient();
  const [{ data: inv }, { data: pay }] = await Promise.all([
    supabase.from('collection_invoices').select('amount').eq('case_id', caseId),
    supabase.from('collection_payments').select('amount').eq('case_id', caseId),
  ]);
  const total = (inv ?? []).reduce((s, i) => s + Number(i.amount), 0);
  const paid = (pay ?? []).reduce((s, p) => s + Number(p.amount), 0);
  return Math.round((total - paid) * 100) / 100;
}

const invoiceSchema = z.object({ invoice_number: z.string().trim().min(1).max(60), due_date: optDate, amount: money });

/** "re-07570 " and "RE-07570" are the same invoice. */
const sameNumber = (n: string) => n.replace(/s+/g, '').toUpperCase();

/**
 * An invoice belongs to one case, ever — open or closed.
 *
 * Returns the error to show when one of the numbers is already in a case
 * (which customer's, so it can be found), or is given twice at once. The team
 * reads every invoice, and there are few: compared here rather than in SQL so
 * capitals and spaces do not let a duplicate through.
 */
async function invoiceTaken(numbers: string[], exceptInvoiceId?: string): Promise<string | null> {
  const wanted = numbers.map(sameNumber);
  const twice = numbers.find((_, k) => wanted.indexOf(wanted[k]) !== k);
  if (twice) return `invoice_twice|${twice}`;
  const supabase = createClient();
  const { data } = await supabase.from('collection_invoices').select('id, invoice_number, case:collection_cases ( customer:customers ( company_name ) )');
  const rows = (data ?? []) as unknown as { id: string; invoice_number: string; case: { customer: { company_name: string } | null } | null }[];
  const hit = rows.find((r) => r.id !== exceptInvoiceId && wanted.includes(sameNumber(r.invoice_number)));
  return hit ? `invoice_exists|${hit.invoice_number}|${hit.case?.customer?.company_name ?? ''}` : null;
}

const caseSchema = z.object({
  /** Where it starts: at a payment reminder (1–2, sent on a day), or at follow-up. */
  reminders_sent: z.number().int().min(0).max(LAST_REMINDER).default(0),
  reminder_date: optDate,
  customer_id: uuid,
  responsible_id: uuid,
  invoices: z.array(invoiceSchema).min(1, { message: 'invoice_required' }).max(100),
  next_follow_up: optDate,
  note: text(5000),
});

/** Open a case: a customer, their unpaid invoices, who follows it up and when. */
export async function createCase(input: z.input<typeof caseSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = caseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_case' };
  const v = parsed.data;
  const taken = await invoiceTaken(v.invoices.map((i) => i.invoice_number));
  if (taken) return { ok: false, error: taken };
  const supabase = createClient();
  const uid = await me();
  const { data, error } = await supabase
    .from('collection_cases')
    .insert({
      customer_id: v.customer_id,
      responsible_id: v.responsible_id,
      // At a reminder while the program's reminders run; at follow-up after the third.
      stage: v.reminders_sent > 0 && v.reminders_sent < LAST_REMINDER ? 'reminders' : 'follow_up',
      reminders_sent: v.reminders_sent,
      next_follow_up: v.next_follow_up,
      note: v.note,
      created_by: uid,
    })
    .select('id')
    .single();
  if (error) return fail(error);
  const id = (data as { id: string }).id;
  const { error: invError } = await supabase.from('collection_invoices').insert(v.invoices.map((i) => ({ ...i, case_id: id })));
  if (invError) return fail(invError);
  await log(id, 'stage', null, { stage: v.reminders_sent > 0 && v.reminders_sent < LAST_REMINDER ? 'reminders' : 'follow_up', opened: true });
  if (v.reminders_sent > 0) await log(id, 'reminder', null, { level: v.reminders_sent }, v.reminder_date ?? undefined);
  if (v.responsible_id !== uid) await tellResponsible(v.responsible_id, id, 'Caso de cobranza asignado');
  revalidateCase(id);
  return { ok: true, data: { id } };
}

async function tellResponsible(profileId: string, caseId: string, title: string) {
  const supabase = createClient();
  const { data } = await supabase.from('collection_cases').select('customer:customers ( company_name )').eq('id', caseId).maybeSingle();
  try {
    // In Spanish, like every other server-sent notification.
    await sendToUser(profileId, {
      title,
      body: (data as unknown as { customer: { company_name: string } | null } | null)?.customer?.company_name ?? '',
      url: `/collections/${caseId}`,
      tag: `collection-${caseId}`,
    });
  } catch (err) {
    console.error('collection notice failed', err);
  }
}

const contactSchema = z.object({
  kind: z.enum(['call', 'email', 'note']),
  happened_on: DATE,
  body: z.string().trim().min(1, { message: 'body_required' }).max(5000),
  next_follow_up: optDate,
});

/** A call, an email or a note — and when to follow up next. */
export async function logContact(caseId: string, input: z.input<typeof contactSchema>): Promise<ActionResult> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(caseId).success) return { ok: false, error: parsed.error?.issues[0]?.message ?? 'invalid_contact' };
  const v = parsed.data;
  const supabase = createClient();
  const { error } = await supabase.from('collection_cases').update({ next_follow_up: v.next_follow_up }).eq('id', caseId).is('closed_at', null);
  if (error) return fail(error);
  await log(caseId, v.kind, v.body, { next_follow_up: v.next_follow_up }, v.happened_on);
  revalidateCase(caseId);
  return { ok: true, data: undefined };
}

/**
 * The invoicing program sent the next payment reminder. After the third, the
 * case moves to follow-up — calls and emails — from the day given.
 */
export async function recordReminder(caseId: string, sentOn: string, nextFollowUp?: string | null): Promise<ActionResult<{ level: number }>> {
  if (!DATE.safeParse(sentOn).success || (nextFollowUp && !DATE.safeParse(nextFollowUp).success)) return { ok: false, error: 'invalid_date' };
  const supabase = createClient();
  const { data: c } = await supabase.from('collection_cases').select('stage, reminders_sent').eq('id', caseId).maybeSingle();
  if (!c) return { ok: false, error: 'not_authorized' };
  if (c.stage !== 'reminders' || c.reminders_sent >= LAST_REMINDER) return { ok: false, error: 'invalid_stage' };
  const level = c.reminders_sent + 1;
  const { error } = await supabase
    .from('collection_cases')
    .update(level >= LAST_REMINDER ? { reminders_sent: level, stage: 'follow_up', next_follow_up: nextFollowUp ?? null } : { reminders_sent: level })
    .eq('id', caseId);
  if (error) return fail(error);
  await log(caseId, 'reminder', null, { level }, sentOn);
  if (level >= LAST_REMINDER) await log(caseId, 'stage', null, { stage: 'follow_up', from: 'reminders' });
  revalidateCase(caseId);
  return { ok: true, data: { level } };
}

/** The customer promised to pay by a day: then it is checked. */
export async function setPromise(caseId: string, promisedOn: string, body: string): Promise<ActionResult> {
  if (!DATE.safeParse(promisedOn).success) return { ok: false, error: 'invalid_date' };
  const supabase = createClient();
  const { error } = await supabase
    .from('collection_cases')
    .update({ stage: 'promise', promised_on: promisedOn, next_follow_up: promisedOn })
    .eq('id', caseId)
    .in('stage', ['reminders', 'follow_up', 'promise']);
  if (error) return fail(error);
  await log(caseId, 'promise', body.trim() || null, { promised_on: promisedOn });
  revalidateCase(caseId);
  return { ok: true, data: undefined };
}

/** Money came in. Once nothing is open the case is paid — through the agency if it was there. */
export async function addPayment(caseId: string, input: { paid_on: string; amount: number; note?: string | null }): Promise<ActionResult<{ closed: boolean }>> {
  const parsed = z.object({ paid_on: DATE, amount: money, note: text(1000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_payment' };
  const supabase = createClient();
  const uid = await me();
  const { data: c } = await supabase.from('collection_cases').select('stage').eq('id', caseId).maybeSingle();
  if (!c) return { ok: false, error: 'not_authorized' };
  const viaAgency = c.stage === 'agency';
  const { error } = await supabase.from('collection_payments').insert({ case_id: caseId, ...parsed.data, via_agency: viaAgency, created_by: uid });
  if (error) return fail(error);
  await log(caseId, 'payment', parsed.data.note, { amount: parsed.data.amount, via_agency: viaAgency }, parsed.data.paid_on);
  const open = await openAmount(caseId);
  let closed = false;
  if (open <= 0 && ['reminders', 'follow_up', 'promise', 'agency'].includes(c.stage)) {
    const stage = viaAgency ? 'paid_agency' : 'paid';
    await supabase.from('collection_cases').update({ stage }).eq('id', caseId);
    await log(caseId, 'stage', null, { stage });
    closed = true;
  }
  revalidateCase(caseId);
  return { ok: true, data: { closed } };
}

/** Handed to a collection agency: which, when, and their case number. */
export async function sendToAgency(caseId: string, input: { agency_id: string; sent_on: string; reference?: string | null; note?: string | null }): Promise<ActionResult> {
  const parsed = z.object({ agency_id: uuid, sent_on: DATE, reference: text(120), note: text(2000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_agency' };
  const v = parsed.data;
  const supabase = createClient();
  const { error } = await supabase
    .from('collection_cases')
    .update({ stage: 'agency', agency_id: v.agency_id, agency_sent_on: v.sent_on, agency_reference: v.reference, next_follow_up: null })
    .eq('id', caseId)
    .is('closed_at', null);
  if (error) return fail(error);
  await log(caseId, 'agency', v.note, { agency_id: v.agency_id, reference: v.reference }, v.sent_on);
  revalidateCase(caseId);
  return { ok: true, data: undefined };
}

/** Uncollectible, paid (settled otherwise), or back to follow-up — with a reason in the history. */
export async function setStage(caseId: string, stage: Extract<CollectionStage, 'uncollectible' | 'paid' | 'follow_up'>, reason: string): Promise<ActionResult> {
  if (!['uncollectible', 'paid', 'follow_up'].includes(stage)) return { ok: false, error: 'invalid_stage' };
  const supabase = createClient();
  const { data: c } = await supabase.from('collection_cases').select('stage').eq('id', caseId).maybeSingle();
  if (!c) return { ok: false, error: 'not_authorized' };
  // Settled while at the agency: paid through it.
  const next = stage === 'paid' && c.stage === 'agency' ? 'paid_agency' : stage;
  const { error } = await supabase.from('collection_cases').update({ stage: next, ...(next === 'follow_up' ? { promised_on: null } : {}) }).eq('id', caseId);
  if (error) return fail(error);
  await log(caseId, 'stage', reason.trim() || null, { stage: next, from: c.stage });
  revalidateCase(caseId);
  return { ok: true, data: undefined };
}

export async function setResponsible(caseId: string, profileId: string): Promise<ActionResult> {
  if (!uuid.safeParse(profileId).success) return { ok: false, error: 'responsible_not_team' };
  const supabase = createClient();
  const { error } = await supabase.from('collection_cases').update({ responsible_id: profileId }).eq('id', caseId);
  if (error) return fail(error);
  await log(caseId, 'responsible', null, { responsible_id: profileId });
  if (profileId !== (await me())) await tellResponsible(profileId, caseId, 'Caso de cobranza asignado');
  revalidateCase(caseId);
  return { ok: true, data: undefined };
}

export async function addInvoice(caseId: string, input: z.input<typeof invoiceSchema>): Promise<ActionResult> {
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_invoice' };
  const taken = await invoiceTaken([parsed.data.invoice_number]);
  if (taken) return { ok: false, error: taken };
  const supabase = createClient();
  const { error } = await supabase.from('collection_invoices').insert({ ...parsed.data, case_id: caseId });
  if (error) return fail(error);
  await log(caseId, 'invoice', null, { added: parsed.data.invoice_number, amount: parsed.data.amount });
  revalidateCase(caseId);
  return { ok: true, data: undefined };
}

/** Correct an invoice typed in wrong; the history keeps what it was. */
export async function updateInvoice(caseId: string, invoiceId: string, input: z.input<typeof invoiceSchema>): Promise<ActionResult> {
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_invoice' };
  const supabase = createClient();
  const { data: before } = await supabase.from('collection_invoices').select('invoice_number, due_date, amount').eq('id', invoiceId).eq('case_id', caseId).maybeSingle();
  if (!before) return { ok: false, error: 'not_authorized' };
  // Only when the number itself changes: the amount of one of the old duplicates can still be corrected.
  if (sameNumber(before.invoice_number) !== sameNumber(parsed.data.invoice_number)) {
    const taken = await invoiceTaken([parsed.data.invoice_number], invoiceId);
    if (taken) return { ok: false, error: taken };
  }
  const { error } = await supabase.from('collection_invoices').update(parsed.data).eq('id', invoiceId).eq('case_id', caseId);
  if (error) return fail(error);
  await log(caseId, 'invoice', null, {
    corrected: parsed.data.invoice_number,
    from: { invoice_number: before.invoice_number, due_date: before.due_date, amount: Number(before.amount) },
    to: parsed.data,
  });
  revalidateCase(caseId);
  return { ok: true, data: undefined };
}

export async function removeInvoice(caseId: string, invoiceId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.from('collection_invoices').delete().eq('id', invoiceId).eq('case_id', caseId).select('invoice_number, amount');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  await log(caseId, 'invoice', null, { removed: data[0].invoice_number, amount: Number(data[0].amount) });
  revalidateCase(caseId);
  return { ok: true, data: undefined };
}

/* ----------------------------- Admin's lists ----------------------------- */

/** Who works collections — the whole list at once (RLS: is_admin). */
export async function setCollectionTeam(ids: string[]): Promise<ActionResult> {
  const parsed = z.array(uuid).min(1).max(20).safeParse([...new Set(ids)]);
  if (!parsed.success) return { ok: false, error: 'team_required' };
  const supabase = createClient();
  const uid = await me();
  const { data: current } = await supabase.from('collection_team').select('profile_id');
  const before = (current ?? []).map((r) => r.profile_id);
  const added = parsed.data.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !parsed.data.includes(id));
  if (added.length) {
    const { error } = await supabase.from('collection_team').insert(added.map((profile_id) => ({ profile_id, added_by: uid })));
    if (error) return fail(error);
  }
  if (removed.length) {
    const { error } = await supabase.from('collection_team').delete().in('profile_id', removed);
    if (error) return fail(error);
  }
  revalidatePath('/admin/collections');
  return { ok: true, data: undefined };
}

export async function saveAgency(input: { name: string; sort_order: number; is_active: boolean }, id?: string): Promise<ActionResult> {
  const parsed = z.object({ name: z.string().trim().min(1).max(120), sort_order: z.number().int(), is_active: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'name_required' };
  const supabase = createClient();
  const { error } = id
    ? await supabase.from('collection_agencies').update(parsed.data).eq('id', id)
    : await supabase.from('collection_agencies').insert(parsed.data);
  if (error) return fail(error);
  revalidatePath('/admin/collections');
  return { ok: true, data: undefined };
}

/** How far a customer is in collections — for the warning when ordering. Anyone may ask; nothing more is said. */
export async function customerPaymentFlag(customerId: string): Promise<CollectionFlag | null> {
  if (!uuid.safeParse(customerId).success) return null;
  const supabase = createClient();
  const { data } = await supabase.rpc('collection_customer_flags');
  return ((data ?? []) as { customer_id: string; level: CollectionFlag }[]).find((r) => r.customer_id === customerId)?.level ?? null;
}

/** Whether a customer must pay before delivery — for the warning when ordering. */
export async function customerPrepay(customerId: string): Promise<boolean> {
  if (!uuid.safeParse(customerId).success) return false;
  const supabase = createClient();
  const { data } = await supabase.from('customers').select('prepay_required').eq('id', customerId).maybeSingle();
  return Boolean(data?.prepay_required);
}

/** Put a customer on, or take them off, payment in advance. The collections team only. */
export async function setCustomerPrepay(customerId: string, on: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(customerId).success) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  const { error } = await supabase.rpc('set_customer_prepay', { p_customer_id: customerId, p_on: on });
  if (error) return fail(error);
  revalidatePath('/collections');
  revalidatePath('/sales');
  revalidatePath(`/sales/customers/${customerId}`);
  revalidatePath('/orders');
  return { ok: true, data: undefined };
}
