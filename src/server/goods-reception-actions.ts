'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  QUANTITY_CHECKS,
  RECEPTION_CONDITIONS,
  RECEPTION_STATUSES,
} from '@/domain/goods-reception/vocabulary';
import { canComplete, canTransition } from '@/domain/goods-reception/workflow';
import { buildReceptionReport } from '@/domain/goods-reception/report';
import { getViewer } from './data';
import { getReceptionsForMonth, isReceptionAssignee } from './goods-reception';
import type { ActionResult } from './actions';

/**
 * Goods Reception mutations.
 *
 * A thin, validated transport. The BOUNDARY is the database: every table in
 * this module has RLS, `can_write_goods_reception()` decides who may write,
 * a CHECK constraint refuses an incomplete completion and a trigger refuses a
 * silent discrepancy. What the checks below buy is a translatable message
 * instead of a raw Postgres error — they are not what makes the rules true.
 *
 * The one thing this layer alone enforces is §15: `received_by` and
 * `created_by` are taken from the session and never from the client. The
 * insert policy asserts the same thing, so a forged value is refused twice.
 */

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function mapError(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('discrepancy_needs_explanation')) return fail('discrepancy_needs_explanation');
  if (message.includes('goods_receptions_complete_is_complete')) return fail('completion_incomplete');
  if (message.includes('suppliers_name_key')) return fail('supplier_exists');
  if (message.includes('transporters_name_key')) return fail('transporter_exists');
  if (message.includes('violates row-level security')) return fail('not_authorized');
  if (message.includes('violates foreign key')) return fail('still_referenced');
  return fail(message);
}

function revalidateReceptions(id?: string) {
  revalidatePath('/goods-reception');
  if (id) revalidatePath(`/goods-reception/${id}`);
}

/**
 * The caller, plus the two facts every decision here needs.
 *
 * Resolved once per action rather than per check: an assignee lookup is a
 * round trip, and asking three times to answer one question is how a fast
 * screen becomes a slow one.
 */
async function receptionViewer() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved') return null;

  const canManageAll = viewer.can('goods_reception.manage_all');
  // A manage_all holder never needs the list checked — they may write anyway.
  const isAssignee = canManageAll ? false : await isReceptionAssignee(viewer.profile.id);

  return { viewer, canManageAll, isAssignee, canWrite: canManageAll || isAssignee };
}

/* ------------------------------- receptions ------------------------------ */

const receptionSchema = z.object({
  supplier_id: z.string().uuid().nullable(),
  transporter_id: z.string().uuid().nullable(),
  delivery_note: z.string().trim().max(120).nullable(),
  received_at: z.string().datetime(),
  condition: z.enum(RECEPTION_CONDITIONS).nullable(),
  quantity_check: z.enum(QUANTITY_CHECKS),
  comments: z.string().trim().max(2000).nullable(),
  status: z.enum(RECEPTION_STATUSES),
});

export type ReceptionInput = z.infer<typeof receptionSchema>;

/**
 * Start a reception.
 *
 * §33: a DRAFT may carry almost nothing. The driver is waiting, and a form
 * that refuses to save until every field is filled is a form that gets filled
 * in afterwards from memory, which is worse than a half-empty record.
 */
export async function createReception(input: ReceptionInput): Promise<ActionResult<string>> {
  const parsed = receptionSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_reception');

  const ctx = await receptionViewer();
  if (!ctx) return fail('not_authorized');
  if (!ctx.canWrite) return fail('not_assigned');

  const supabase = createClient();
  const { data, error } = await supabase
    .from('goods_receptions')
    .insert({
      ...parsed.data,
      // Never from the client. §15.
      received_by: ctx.viewer.profile.id,
      created_by: ctx.viewer.profile.id,
      updated_by: ctx.viewer.profile.id,
    })
    .select('id')
    .single();

  if (error) return mapError(error);

  revalidateReceptions();
  return { ok: true, data: (data as { id: string }).id };
}

export async function updateReception(
  id: string,
  input: ReceptionInput,
): Promise<ActionResult> {
  const parsed = receptionSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_reception');

  const ctx = await receptionViewer();
  if (!ctx) return fail('not_authorized');

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('goods_receptions')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (!existing) return fail('reception_not_found');
  const current = existing as { status: ReceptionInput['status'] };

  // Mirrors can_write_goods_reception(): an assignee stops at completion.
  if (!ctx.canManageAll && !(ctx.isAssignee && current.status !== 'completed')) {
    return fail(current.status === 'completed' ? 'completed_is_final' : 'not_assigned');
  }

  const transition = canTransition(current.status, parsed.data.status, {
    canManageAll: ctx.canManageAll,
  });
  if (!transition.ok) return fail(transition.reason);

  const { error } = await supabase
    .from('goods_receptions')
    .update({ ...parsed.data, updated_by: ctx.viewer.profile.id })
    .eq('id', id);

  if (error) return mapError(error);

  revalidateReceptions(id);
  return { ok: true, data: undefined };
}

/**
 * Complete a reception.
 *
 * Validated here so the refusal names every missing field at once, and again
 * by the CHECK constraint and the guard trigger, which is what actually
 * refuses. The incident count is read fresh rather than trusted from the
 * client — §34's escape hatch is a REAL linked incident, not a claim of one.
 */
export async function completeReception(id: string): Promise<ActionResult> {
  const ctx = await receptionViewer();
  if (!ctx) return fail('not_authorized');
  if (!ctx.canWrite) return fail('not_assigned');

  const supabase = createClient();
  const { data } = await supabase
    .from('goods_receptions')
    .select('status, supplier_id, condition, quantity_check, comments, incidents ( id )')
    .eq('id', id)
    .maybeSingle();

  if (!data) return fail('reception_not_found');

  const row = data as unknown as {
    status: ReceptionInput['status'];
    supplier_id: string | null;
    condition: ReceptionInput['condition'];
    quantity_check: ReceptionInput['quantity_check'];
    comments: string | null;
    incidents: { id: string }[] | null;
  };

  if (row.status === 'completed') return fail('already_completed');

  const verdict = canComplete({
    supplier_id: row.supplier_id,
    condition: row.condition,
    quantity_check: row.quantity_check,
    comments: row.comments,
    incident_count: row.incidents?.length ?? 0,
  });
  if (!verdict.ok) return fail(verdict.reasons[0]);

  const { error } = await supabase
    .from('goods_receptions')
    .update({
      status: 'completed',
      // completed_at / completed_by are stamped by the guard trigger, so they
      // are true even when a future caller forgets to send them.
      updated_by: ctx.viewer.profile.id,
    })
    .eq('id', id);

  if (error) return mapError(error);

  revalidateReceptions(id);
  return { ok: true, data: undefined };
}

/** Reopen a completed reception. Management only, and always audited. */
export async function reopenReception(id: string): Promise<ActionResult> {
  const ctx = await receptionViewer();
  if (!ctx) return fail('not_authorized');
  if (!ctx.canManageAll) return fail('completed_is_final');

  const supabase = createClient();
  const { error } = await supabase
    .from('goods_receptions')
    .update({
      status: 'checking',
      completed_at: null,
      completed_by: null,
      updated_by: ctx.viewer.profile.id,
    })
    .eq('id', id);

  if (error) return mapError(error);

  revalidateReceptions(id);
  return { ok: true, data: undefined };
}

/* ------------------------------- exceptions ------------------------------ */

const exceptionSchema = z.object({
  reception_id: z.string().uuid(),
  product_id: z.string().uuid(),
  lot_number: z.string().trim().max(80).nullable(),
  best_before: z.string().date().nullable(),
  affected_quantity: z.number().positive().nullable(),
  description: z.string().trim().min(1).max(1000),
});

/**
 * Record an exceptional product.
 *
 * §22: the product comes from the existing master and free text is refused —
 * a typed product name cannot be reported on, and two spellings of one cheese
 * become two products in every analysis that follows.
 */
export async function addReceptionException(
  input: z.infer<typeof exceptionSchema>,
): Promise<ActionResult> {
  const parsed = exceptionSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_exception');

  const ctx = await receptionViewer();
  if (!ctx) return fail('not_authorized');

  const supabase = createClient();
  const { error } = await supabase
    .from('goods_reception_exceptions')
    .insert({ ...parsed.data, created_by: ctx.viewer.profile.id });

  if (error) return mapError(error);

  revalidateReceptions(parsed.data.reception_id);
  return { ok: true, data: undefined };
}

export async function updateReceptionException(
  id: string,
  input: z.infer<typeof exceptionSchema>,
): Promise<ActionResult> {
  const parsed = exceptionSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_exception');

  const ctx = await receptionViewer();
  if (!ctx) return fail('not_authorized');

  const supabase = createClient();
  const { reception_id, ...fields } = parsed.data;
  const { error } = await supabase
    .from('goods_reception_exceptions')
    .update(fields)
    .eq('id', id);

  if (error) return mapError(error);

  revalidateReceptions(reception_id);
  return { ok: true, data: undefined };
}

export async function deleteReceptionException(
  id: string,
  receptionId: string,
): Promise<ActionResult> {
  const ctx = await receptionViewer();
  if (!ctx) return fail('not_authorized');

  const supabase = createClient();
  const { error } = await supabase.from('goods_reception_exceptions').delete().eq('id', id);
  if (error) return mapError(error);

  revalidateReceptions(receptionId);
  return { ok: true, data: undefined };
}

/* -------------------------------- evidence ------------------------------- */

/**
 * Images only. §20 puts invoices, packing lists and arbitrary PDFs out of
 * scope, so `application/pdf` is deliberately absent — the incident bucket
 * allows it and this one does not, in the table AND in the bucket definition.
 */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

/**
 * Attach a photo.
 *
 * FormData because that is how a browser sends a file — including one taken
 * straight from the camera on a phone — without base64-ing it through a
 * server action first.
 *
 * The object is stored under the reception's own id, which is what lets the
 * storage policy decide access from the path alone.
 */
export async function addReceptionEvidence(formData: FormData): Promise<ActionResult> {
  const ctx = await receptionViewer();
  if (!ctx) return fail('not_authorized');

  const receptionId = String(formData.get('reception_id') ?? '');
  const rawException = String(formData.get('exception_id') ?? '');
  const file = formData.get('file');

  if (!z.string().uuid().safeParse(receptionId).success) return fail('invalid_evidence');
  if (!(file instanceof File) || file.size === 0) return fail('invalid_evidence');
  if (file.size > MAX_EVIDENCE_BYTES) return fail('evidence_too_large');
  if (!ALLOWED_MIME.includes(file.type)) return fail('evidence_type_not_allowed');

  const exceptionId = z.string().uuid().safeParse(rawException).success ? rawException : null;

  const supabase = createClient();
  const extension = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const objectName = `${receptionId}/${crypto.randomUUID()}.${extension || 'bin'}`;

  const { error: uploadError } = await supabase.storage
    .from('goods-reception-evidence')
    .upload(objectName, file, { contentType: file.type, upsert: false });
  if (uploadError) return mapError(uploadError);

  const { error } = await supabase.from('goods_reception_evidence').insert({
    reception_id: receptionId,
    exception_id: exceptionId,
    storage_path: objectName,
    file_name: file.name.slice(0, 200),
    mime_type: file.type,
    size_bytes: file.size,
    uploaded_by: ctx.viewer.profile.id,
  });

  if (error) {
    // An object with no row is invisible and unreclaimable, so it goes back.
    await supabase.storage.from('goods-reception-evidence').remove([objectName]);
    return mapError(error);
  }

  revalidateReceptions(receptionId);
  return { ok: true, data: undefined };
}

export async function deleteReceptionEvidence(
  id: string,
  receptionId: string,
): Promise<ActionResult> {
  const ctx = await receptionViewer();
  if (!ctx) return fail('not_authorized');

  const supabase = createClient();
  const { data: row } = await supabase
    .from('goods_reception_evidence')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();

  // The row first: RLS decides whether this caller may remove it, and the
  // object is only orphaned if that succeeded.
  const { error } = await supabase.from('goods_reception_evidence').delete().eq('id', id);
  if (error) return mapError(error);

  if (row) {
    await supabase.storage
      .from('goods-reception-evidence')
      .remove([(row as { storage_path: string }).storage_path]);
  }

  revalidateReceptions(receptionId);
  return { ok: true, data: undefined };
}

/* ------------------------- suppliers / transporters ---------------------- */

const masterSchema = z.object({ name: z.string().trim().min(1).max(160) });

/**
 * §38: "Pacovis AG" and "PACOVIS AG" must not become two suppliers.
 *
 * The unique index on lower(btrim(name)) is what enforces it — the same
 * device `customers` has used since the orders module. This lookup exists
 * only so the refusal can name the existing supplier instead of surfacing a
 * constraint violation, and it deliberately does NOT merge anything: §38 says
 * an ambiguous match requires confirmation, and merging silently is the
 * opposite of that.
 */
async function findByName(table: 'suppliers' | 'transporters', name: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from(table)
    .select('id, name, is_active')
    .ilike('name', name.trim())
    .maybeSingle();
  return (data as { id: string; name: string; is_active: boolean } | null) ?? null;
}

export async function createSupplier(input: { name: string }): Promise<ActionResult<string>> {
  return createMaster('suppliers', input, '/admin/suppliers');
}

export async function createTransporter(input: { name: string }): Promise<ActionResult<string>> {
  return createMaster('transporters', input, '/admin/transporters');
}

async function createMaster(
  table: 'suppliers' | 'transporters',
  input: { name: string },
  path: string,
): Promise<ActionResult<string>> {
  const parsed = masterSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_name');

  const viewer = await getViewer();
  if (!viewer?.can('goods_reception.manage_config')) return fail('not_authorized');

  const existing = await findByName(table, parsed.data.name);
  if (existing) {
    // Naming the collision is what lets a user decide whether they meant the
    // existing row — including reactivating a deactivated one.
    return fail(table === 'suppliers' ? 'supplier_exists' : 'transporter_exists');
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from(table)
    .insert({
      name: parsed.data.name,
      created_by: viewer.profile.id,
      updated_by: viewer.profile.id,
    })
    .select('id')
    .single();

  if (error) return mapError(error);

  revalidatePath(path);
  revalidatePath('/goods-reception');
  return { ok: true, data: (data as { id: string }).id };
}

export async function renameSupplier(id: string, name: string): Promise<ActionResult> {
  return renameMaster('suppliers', id, name, '/admin/suppliers');
}

export async function renameTransporter(id: string, name: string): Promise<ActionResult> {
  return renameMaster('transporters', id, name, '/admin/transporters');
}

async function renameMaster(
  table: 'suppliers' | 'transporters',
  id: string,
  name: string,
  path: string,
): Promise<ActionResult> {
  const parsed = masterSchema.safeParse({ name });
  if (!parsed.success) return fail('invalid_name');

  const viewer = await getViewer();
  if (!viewer?.can('goods_reception.manage_config')) return fail('not_authorized');

  const existing = await findByName(table, parsed.data.name);
  if (existing && existing.id !== id) {
    return fail(table === 'suppliers' ? 'supplier_exists' : 'transporter_exists');
  }

  const supabase = createClient();
  const { error } = await supabase
    .from(table)
    .update({ name: parsed.data.name, updated_by: viewer.profile.id })
    .eq('id', id);

  if (error) return mapError(error);

  revalidatePath(path);
  revalidatePath('/goods-reception');
  return { ok: true, data: undefined };
}

/**
 * Deactivate or reactivate. §37: never a delete.
 *
 * A supplier with receptions behind it keeps appearing on every one of them;
 * an inactive one simply stops being offered for new receptions. The FK is
 * RESTRICT, so even a hand-written DELETE is refused by the database.
 */
export async function setSupplierActive(id: string, isActive: boolean): Promise<ActionResult> {
  return setMasterActive('suppliers', id, isActive, '/admin/suppliers');
}

export async function setTransporterActive(id: string, isActive: boolean): Promise<ActionResult> {
  return setMasterActive('transporters', id, isActive, '/admin/transporters');
}

async function setMasterActive(
  table: 'suppliers' | 'transporters',
  id: string,
  isActive: boolean,
  path: string,
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer?.can('goods_reception.manage_config')) return fail('not_authorized');

  const supabase = createClient();
  const { error } = await supabase
    .from(table)
    .update({ is_active: isActive, updated_by: viewer.profile.id })
    .eq('id', id);

  if (error) return mapError(error);

  revalidatePath(path);
  revalidatePath('/goods-reception');
  return { ok: true, data: undefined };
}

/* ------------------------------- assignment ------------------------------ */

export async function setReceptionAssignee(
  userId: string,
  assigned: boolean,
): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(userId).success) return fail('invalid_assignment');

  const viewer = await getViewer();
  if (!viewer?.can('goods_reception.manage_config')) return fail('not_authorized');

  const supabase = createClient();

  if (assigned) {
    const { error } = await supabase
      .from('goods_reception_assignees')
      .upsert(
        { user_id: userId, assigned_by: viewer.profile.id },
        { onConflict: 'user_id', ignoreDuplicates: true },
      );
    if (error) return mapError(error);
  } else {
    const { error } = await supabase
      .from('goods_reception_assignees')
      .delete()
      .eq('user_id', userId);
    if (error) return mapError(error);
  }

  // Assignment changes what the whole authenticated surface offers, not just
  // this page — the New Reception button lives on another route entirely.
  revalidatePath('/', 'layout');
  return { ok: true, data: undefined };
}

/* -------------------------- incident from reception ---------------------- */

const reportIncidentSchema = z.object({
  reception_id: z.string().uuid(),
  incident_type_id: z.string().uuid(),
  description: z.string().trim().min(1).max(2000),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  product_ids: z.array(z.string().uuid()).max(20).optional(),
});

/**
 * Raise an incident from a reception — §24.
 *
 * The prefill is done HERE rather than in the browser, because every value
 * being copied is one the client should not be trusted to supply: the
 * reception link decides visibility, and `detected_at` decides which month
 * the incident is reported in.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: investigate. Cause, responsibility,
 * secondary causes and resolution are absent, and the incident lands in its
 * normal 'open' state for somebody holding incidents.manage to work through
 * in the existing Incidents module. §24 is explicit that this must not become
 * a second incident system, and the way to keep that true is for this action
 * to be able to create an incident and nothing else.
 *
 * A reception may carry many of these. §23: three problems on one delivery
 * are three incidents, each independently analysable, never one merged row.
 */
export async function reportIncidentFromReception(
  input: z.infer<typeof reportIncidentSchema>,
): Promise<ActionResult<string>> {
  const parsed = reportIncidentSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_incident');

  const ctx = await receptionViewer();
  if (!ctx) return fail('not_authorized');

  const canReport = ctx.canWrite || ctx.viewer.can('incidents.manage');
  if (!canReport) return fail('not_assigned');

  const supabase = createClient();
  const { data: reception } = await supabase
    .from('goods_receptions')
    .select('id, received_at')
    .eq('id', parsed.data.reception_id)
    .maybeSingle();

  if (!reception) return fail('reception_not_found');

  const { data, error } = await supabase
    .from('incidents')
    .insert({
      goods_reception_id: parsed.data.reception_id,
      incident_type_id: parsed.data.incident_type_id,
      description: parsed.data.description,
      severity: parsed.data.severity,
      // The delivery's own arrival time, not now(). An incident written up on
      // Monday about Friday's pallet belongs to Friday — the same rule the
      // incidents module already states for detected_at.
      detected_at: (reception as { received_at: string }).received_at,
      created_by: ctx.viewer.profile.id,
      updated_by: ctx.viewer.profile.id,
    })
    .select('id')
    .single();

  if (error) return mapError(error);

  const incidentId = (data as { id: string }).id;

  /*
   * Affected products, when the reception's exceptions named any.
   *
   * Best-effort: the incident is already real, and failing the whole action
   * because a product link did not attach would leave the user believing
   * nothing was reported. Writing these needs incidents.manage, so for a
   * reception assignee this insert is expected to be refused by RLS — the
   * incident still carries the description they wrote.
   */
  if (parsed.data.product_ids?.length) {
    await supabase.from('incident_affected_items').insert(
      parsed.data.product_ids.map((product_id, position) => ({
        incident_id: incidentId,
        product_id,
        position,
      })),
    );
  }

  revalidateReceptions(parsed.data.reception_id);
  revalidatePath('/incidents');
  return { ok: true, data: incidentId };
}

/* --------------------------- report snapshots ---------------------------- */

const snapshotSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  note: z.string().trim().max(500).nullable(),
  unrecorded_label: z.string().trim().min(1).max(80),
});

/**
 * Freeze a month. §42.
 *
 * The payload is computed by the SAME domain function the live screen uses,
 * so a snapshot can never disagree with the report it was taken from. The
 * version comes from the database rather than from a count here, because two
 * people pressing Generate at once would otherwise both read version 1 and
 * one of them would meet a constraint violation instead of a report.
 *
 * Nothing is ever updated or deleted: there is no policy permitting it, which
 * is what makes "historical reports remain permanently available" a property
 * of the system rather than a promise in a comment.
 */
export async function generateReceptionReport(
  input: z.infer<typeof snapshotSchema>,
): Promise<ActionResult<string>> {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_report');

  const viewer = await getViewer();
  if (!viewer?.can('reports.view')) return fail('not_authorized');

  const receptions = await getReceptionsForMonth(parsed.data.month);
  const payload = buildReceptionReport({
    period: parsed.data.month,
    receptions,
    unrecordedLabel: parsed.data.unrecorded_label,
  });

  const supabase = createClient();
  const { data: version, error: versionError } = await supabase.rpc(
    'next_goods_reception_report_version',
    { p_month: `${parsed.data.month}-01` },
  );
  if (versionError) return mapError(versionError);

  const { data, error } = await supabase
    .from('goods_reception_report_snapshots')
    .insert({
      period_month: `${parsed.data.month}-01`,
      version: version as number,
      payload,
      reception_ids: receptions.map((r) => r.id),
      generated_by: viewer.profile.id,
      note: parsed.data.note,
    })
    .select('id')
    .single();

  if (error) return mapError(error);

  revalidatePath('/admin/goods-reception-reports');
  return { ok: true, data: (data as { id: string }).id };
}
