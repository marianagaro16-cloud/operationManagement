'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from './data';
import { getLiveReport } from './incidents';
import {
  INCIDENT_CAUSES,
  INCIDENT_RESPONSIBILITIES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
} from '@/domain/incidents/vocabulary';
import { canTransition, stampsFor } from '@/domain/incidents/workflow';
import { monthRange } from '@/domain/orders/scheduling';
import type { ActionResult } from './actions';

/**
 * Incident mutations.
 *
 * These are a validated transport, not the security boundary. RLS decides who
 * may write an incident, a trigger decides who may close one, and both run
 * whether the caller came through this file or straight at PostgREST. The
 * checks here exist so the UI can fail with a sentence instead of an empty
 * result.
 *
 * Nothing here creates a customer, a product, an order or a task definition
 * that was not asked for by name.
 */

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function mapError(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('incident_close_denied')) return fail('close_not_permitted');
  if (message.includes('incident_reopen_denied')) return fail('reopen_not_permitted');
  if (message.includes('secondary_cause_is_primary')) return fail('secondary_cause_is_primary');
  if (message.includes('incident_replacements_substantive')) return fail('replacement_empty');
  if (message.includes('row-level security')) return fail('not_authorized');
  console.error('[incidents]', error);
  return fail('save_failed');
}

function revalidateIncidents(id?: string) {
  revalidatePath('/incidents');
  if (id) revalidatePath(`/incidents/${id}`);
  revalidatePath('/admin/incident-reports');
}

async function requireManage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved') return null;
  if (!viewer.can('incidents.manage')) return null;
  return viewer;
}

/* ------------------------------- creation ------------------------------- */

/**
 * §39: creating an incident asks for the essentials and nothing else.
 *
 * Cause, responsibility, investigation notes and resolution are all absent
 * from this schema on purpose — they belong to the investigation, which
 * happens later, and demanding them at the door is how an incident log stops
 * being used.
 */
const createSchema = z.object({
  // §7: an incident may exist with no known order, and with no known customer.
  customer_id: z.string().uuid().nullable(),
  order_id: z.string().uuid().nullable(),
  delivery_method_id: z.string().uuid().nullable(),
  incident_type_id: z.string().uuid(),
  severity: z.enum(INCIDENT_SEVERITIES),
  description: z.string().trim().min(1).max(4000),
  /** ISO instant. When it happened, not when the row was written. */
  detected_at: z.string().datetime().optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        order_line_id: z.string().uuid().nullable().optional(),
        lot_allocation_id: z.string().uuid().nullable().optional(),
        affected_quantity: z.number().positive().nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
      }),
    )
    // §15: one incident, many products. Zero is also valid — a late delivery
    // affects an order without affecting a particular product.
    .max(200)
    .default([]),
});

export type CreateIncidentInput = z.infer<typeof createSchema>;

export async function createIncident(
  input: CreateIncidentInput,
): Promise<ActionResult<{ id: string; incident_number: string }>> {
  const viewer = await requireManage();
  if (!viewer) return fail('not_authorized');

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_incident');
  const data = parsed.data;

  const supabase = createClient();

  // The order decides the customer and the delivery method. Taking them from
  // the order rather than trusting the client means an incident cannot claim
  // an order belongs to a customer it does not.
  let customerId = data.customer_id;
  let deliveryMethodId = data.delivery_method_id;
  if (data.order_id) {
    const { data: order } = await supabase
      .from('orders')
      .select('customer_id, delivery_method_id')
      .eq('id', data.order_id)
      .maybeSingle();
    if (!order) return fail('order_not_found');
    const o = order as { customer_id: string; delivery_method_id: string | null };
    customerId = o.customer_id;
    deliveryMethodId = deliveryMethodId ?? o.delivery_method_id;
  }

  const { data: created, error } = await supabase
    .from('incidents')
    .insert({
      customer_id: customerId,
      order_id: data.order_id,
      delivery_method_id: deliveryMethodId,
      incident_type_id: data.incident_type_id,
      severity: data.severity,
      description: data.description,
      detected_at: data.detected_at ?? new Date().toISOString(),
      created_by: viewer.profile.id,
      updated_by: viewer.profile.id,
    })
    .select('id, incident_number')
    .single();

  if (error) return mapError(error);
  const incident = created as { id: string; incident_number: string };

  if (data.items.length > 0) {
    const { error: itemsError } = await supabase.from('incident_affected_items').insert(
      data.items.map((item, i) => ({
        incident_id: incident.id,
        product_id: item.product_id,
        order_line_id: item.order_line_id ?? null,
        lot_allocation_id: item.lot_allocation_id ?? null,
        affected_quantity: item.affected_quantity ?? null,
        note: item.note ?? null,
        position: i,
      })),
    );
    if (itemsError) return mapError(itemsError);
  }

  revalidateIncidents(incident.id);
  if (data.order_id) revalidatePath(`/orders/${data.order_id}`);
  return { ok: true, data: incident };
}

/* ----------------------------- investigation ---------------------------- */

const updateSchema = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  order_id: z.string().uuid().nullable().optional(),
  delivery_method_id: z.string().uuid().nullable().optional(),
  incident_type_id: z.string().uuid().optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  description: z.string().trim().min(1).max(4000).optional(),

  primary_cause: z.enum(INCIDENT_CAUSES).nullable().optional(),
  secondary_causes: z.array(z.enum(INCIDENT_CAUSES)).max(11).optional(),
  responsibility: z.enum(INCIDENT_RESPONSIBILITIES).optional(),
  investigation_notes: z.string().trim().max(8000).nullable().optional(),
  resolution_notes: z.string().trim().max(8000).nullable().optional(),

  status: z.enum(INCIDENT_STATUSES).optional(),
});

export type UpdateIncidentInput = z.infer<typeof updateSchema>;

/**
 * Record the investigation, and move the incident along.
 *
 * The status transition is validated against the workflow rules HERE so the
 * user gets a sentence, and against the close guard IN POSTGRES so the rule
 * holds regardless. Both consult the same capability.
 */
export async function updateIncident(
  id: string,
  input: UpdateIncidentInput,
): Promise<ActionResult> {
  const viewer = await requireManage();
  if (!viewer) return fail('not_authorized');

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_incident');
  const data = parsed.data;

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('incidents')
    .select('status, resolution_notes, resolved_at, resolved_by, closed_at, closed_by, order_id')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return fail('incident_not_found');

  const current = existing as {
    status: (typeof INCIDENT_STATUSES)[number];
    resolution_notes: string | null;
    resolved_at: string | null;
    resolved_by: string | null;
    closed_at: string | null;
    closed_by: string | null;
    order_id: string | null;
  };

  const patch: Record<string, unknown> = { updated_by: viewer.profile.id };
  for (const key of [
    'customer_id', 'order_id', 'delivery_method_id', 'incident_type_id',
    'severity', 'description', 'primary_cause', 'responsibility',
    'investigation_notes', 'resolution_notes',
  ] as const) {
    if (data[key] !== undefined) patch[key] = data[key];
  }

  // ---- the transition ----
  if (data.status && data.status !== current.status) {
    // The resolution being written in THIS edit counts: a person who types a
    // resolution and moves the incident to Resolved in one action should not
    // be told the resolution is missing.
    const resolution =
      data.resolution_notes !== undefined ? data.resolution_notes : current.resolution_notes;

    const check = canTransition(current.status, data.status, {
      canClose: viewer.can('incidents.close'),
      hasResolutionNotes: Boolean(resolution && resolution.trim().length > 0),
    });
    if (!check.ok) return fail(check.reason);

    patch.status = data.status;
    Object.assign(
      patch,
      stampsFor(data.status, viewer.profile.id, new Date().toISOString(), {
        resolved_at: current.resolved_at,
        resolved_by: current.resolved_by,
        closed_at: current.closed_at,
        closed_by: current.closed_by,
      }),
    );
  }

  const { error } = await supabase.from('incidents').update(patch).eq('id', id);
  if (error) return mapError(error);

  // ---- secondary causes ----
  // Replaced wholesale rather than diffed: the set is tiny, and a diff would
  // be three round trips to save one.
  if (data.secondary_causes) {
    const primary = data.primary_cause !== undefined ? data.primary_cause : null;
    const causes = [...new Set(data.secondary_causes)].filter((c) => c !== primary);

    const { error: delError } = await supabase
      .from('incident_secondary_causes').delete().eq('incident_id', id);
    if (delError) return mapError(delError);

    if (causes.length > 0) {
      const { error: insError } = await supabase
        .from('incident_secondary_causes')
        .insert(causes.map((cause) => ({ incident_id: id, cause })));
      if (insError) return mapError(insError);
    }
  }

  revalidateIncidents(id);
  if (current.order_id) revalidatePath(`/orders/${current.order_id}`);
  return { ok: true, data: undefined };
}

/* --------------------------- affected products -------------------------- */

const itemsSchema = z.array(
  z.object({
    product_id: z.string().uuid(),
    order_line_id: z.string().uuid().nullable().optional(),
    lot_allocation_id: z.string().uuid().nullable().optional(),
    affected_quantity: z.number().positive().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  }),
).max(200);

export async function setIncidentItems(
  incidentId: string,
  items: z.infer<typeof itemsSchema>,
): Promise<ActionResult> {
  const viewer = await requireManage();
  if (!viewer) return fail('not_authorized');

  const parsed = itemsSchema.safeParse(items);
  if (!parsed.success) return fail('invalid_items');

  const supabase = createClient();
  const { error: delError } = await supabase
    .from('incident_affected_items').delete().eq('incident_id', incidentId);
  if (delError) return mapError(delError);

  if (parsed.data.length > 0) {
    const { error } = await supabase.from('incident_affected_items').insert(
      parsed.data.map((item, i) => ({
        incident_id: incidentId,
        product_id: item.product_id,
        order_line_id: item.order_line_id ?? null,
        lot_allocation_id: item.lot_allocation_id ?? null,
        affected_quantity: item.affected_quantity ?? null,
        note: item.note ?? null,
        position: i,
      })),
    );
    if (error) return mapError(error);
  }

  revalidateIncidents(incidentId);
  return { ok: true, data: undefined };
}

/* ------------------------------ replacements ---------------------------- */

const replacementSchema = z.object({
  order_id: z.string().uuid().nullable().optional(),
  product_id: z.string().uuid().nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

/**
 * Record what we sent afterwards.
 *
 * An incident is not a replacement and a replacement is not an incident: this
 * writes a separate row, and the incident's own status is untouched by it.
 * Recording a replacement does not resolve anything.
 *
 * Where an order is named, the reverse pointer is set on that order too, so
 * the order book can say what it was raised for without joining through here.
 */
export async function addReplacement(
  incidentId: string,
  input: z.infer<typeof replacementSchema>,
): Promise<ActionResult> {
  const viewer = await requireManage();
  if (!viewer) return fail('not_authorized');

  const parsed = replacementSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_replacement');
  const data = parsed.data;

  if (!data.order_id && !data.note?.trim()) return fail('replacement_empty');

  const supabase = createClient();
  const { error } = await supabase.from('incident_replacements').insert({
    incident_id: incidentId,
    order_id: data.order_id ?? null,
    product_id: data.product_id ?? null,
    quantity: data.quantity ?? null,
    note: data.note?.trim() || null,
    created_by: viewer.profile.id,
  });
  if (error) return mapError(error);

  if (data.order_id) {
    // Best effort: the replacement is recorded either way, and the pointer is
    // a convenience for the order book rather than the record itself.
    await supabase
      .from('orders')
      .update({ replaces_incident_id: incidentId })
      .eq('id', data.order_id);
    revalidatePath(`/orders/${data.order_id}`);
  }

  revalidateIncidents(incidentId);
  return { ok: true, data: undefined };
}

export async function deleteReplacement(id: string, incidentId: string): Promise<ActionResult> {
  const viewer = await requireManage();
  if (!viewer) return fail('not_authorized');

  const supabase = createClient();
  const { error } = await supabase.from('incident_replacements').delete().eq('id', id);
  if (error) return mapError(error);
  revalidateIncidents(incidentId);
  return { ok: true, data: undefined };
}

/* --------------------------- corrective actions ------------------------- */

const actionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Raise a corrective action.
 *
 * It becomes a REAL TASK — a one-off definition plus the single occurrence
 * that carries the owner, the due date and the status. It appears on the
 * calendar, on the assignee's dashboard and in the task audit trail, because
 * it is the same row those screens already read. §17 and §34 both require
 * this and forbid the alternative.
 */
export async function createCorrectiveAction(
  incidentId: string,
  input: z.infer<typeof actionSchema>,
): Promise<ActionResult<{ task_id: string }>> {
  const viewer = await requireManage();
  if (!viewer) return fail('not_authorized');

  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_action');
  const data = parsed.data;

  const supabase = createClient();

  // The definition. 'one_off' is the frequency that exists so this is a task
  // rather than a parallel entity; schedule_config stays null because there
  // is no recurrence to configure and the generator never looks at it.
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .insert({
      title: data.title,
      description: data.description ?? null,
      frequency: 'one_off',
      incident_id: incidentId,
      is_active: true,
      is_skippable: true,
      created_by: viewer.profile.id,
    })
    .select('id')
    .single();

  if (taskError) return mapError(taskError);
  const taskId = (task as { id: string }).id;

  // The single occurrence. `source: 'manual'` because a person raised it —
  // the nightly generator owns only its own rows and must not adopt this one.
  const { error: occError } = await supabase.from('task_occurrences').insert({
    task_id: taskId,
    period_key: data.due_date,
    due_date: data.due_date,
    status: 'pending',
    source: 'manual',
    assignee_id: data.assignee_id ?? null,
  });

  if (occError) {
    // Leaving a definition with no occurrence would put a corrective action
    // on no list at all, which is worse than failing visibly.
    await supabase.from('tasks').delete().eq('id', taskId);
    return mapError(occError);
  }

  revalidateIncidents(incidentId);
  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  return { ok: true, data: { task_id: taskId } };
}

/* -------------------------------- evidence ------------------------------ */

const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
];
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

/**
 * Attach a photo.
 *
 * FormData because that is how a browser sends a file — including one taken
 * straight from the camera on a phone — without the application base64-ing it
 * through a server action first.
 *
 * The object is stored under the incident's own id, which is what lets the
 * storage policy decide access from the path alone.
 */
export async function addEvidence(formData: FormData): Promise<ActionResult> {
  const viewer = await requireManage();
  if (!viewer) return fail('not_authorized');

  const incidentId = String(formData.get('incident_id') ?? '');
  const file = formData.get('file');

  if (!z.string().uuid().safeParse(incidentId).success) return fail('invalid_evidence');
  if (!(file instanceof File) || file.size === 0) return fail('invalid_evidence');
  if (file.size > MAX_EVIDENCE_BYTES) return fail('evidence_too_large');
  if (!ALLOWED_MIME.includes(file.type)) return fail('evidence_type_not_allowed');

  const supabase = createClient();

  const extension = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const objectName = `${incidentId}/${crypto.randomUUID()}.${extension || 'bin'}`;

  const { error: uploadError } = await supabase.storage
    .from('incident-evidence')
    .upload(objectName, file, { contentType: file.type, upsert: false });
  if (uploadError) return mapError(uploadError);

  const { error } = await supabase.from('incident_evidence').insert({
    incident_id: incidentId,
    storage_path: objectName,
    file_name: file.name.slice(0, 200),
    mime_type: file.type,
    size_bytes: file.size,
    uploaded_by: viewer.profile.id,
  });

  if (error) {
    // An object with no row is invisible and unreclaimable, so it goes back.
    await supabase.storage.from('incident-evidence').remove([objectName]);
    return mapError(error);
  }

  revalidateIncidents(incidentId);
  return { ok: true, data: undefined };
}

export async function deleteEvidence(id: string, incidentId: string): Promise<ActionResult> {
  const viewer = await requireManage();
  if (!viewer) return fail('not_authorized');

  const supabase = createClient();
  const { data: row } = await supabase
    .from('incident_evidence').select('storage_path').eq('id', id).maybeSingle();

  // The row first: RLS decides whether this caller may remove it, and the
  // object is only orphaned if that succeeded.
  const { error } = await supabase.from('incident_evidence').delete().eq('id', id);
  if (error) return mapError(error);

  if (row) {
    await supabase.storage
      .from('incident-evidence')
      .remove([(row as { storage_path: string }).storage_path]);
  }

  revalidateIncidents(incidentId);
  return { ok: true, data: undefined };
}

/* --------------------------- report snapshots --------------------------- */

/**
 * Freeze a month.
 *
 * The payload is computed by the same function the live screen uses, so a
 * snapshot is literally the document that was on screen — §42's requirement
 * that a September report opened in December has not silently changed.
 *
 * Never overwrites. A month reported twice produces two versions, both kept,
 * because the second one usually exists BECAUSE something changed and hiding
 * the first would hide that.
 */
export async function generateReportSnapshot(
  month: string,
  note?: string,
): Promise<ActionResult<{ id: string; version: number }>> {
  const viewer = await requireManage();
  if (!viewer) return fail('not_authorized');
  if (!/^\d{4}-\d{2}$/.test(month)) return fail('invalid_month');

  const { start, end } = monthRange(month);
  const payload = await getLiveReport(month, start, end);

  const supabase = createClient();
  const { data: nextVersion, error: versionError } = await supabase.rpc(
    'next_incident_report_version',
    { p_month: `${month}-01` },
  );
  if (versionError) return mapError(versionError);

  const { data, error } = await supabase
    .from('incident_report_snapshots')
    .insert({
      period_month: `${month}-01`,
      version: (nextVersion as number) ?? 1,
      payload,
      incident_ids: payload.incidentIds,
      generated_by: viewer.profile.id,
      note: note?.trim() || null,
    })
    .select('id, version')
    .single();

  if (error) return mapError(error);
  revalidatePath('/admin/incident-reports');
  return { ok: true, data: data as { id: string; version: number } };
}

/* ------------------------- vocabulary administration -------------------- */

const categorySchema = z.object({
  slug: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(60),
  name: z.string().trim().min(1).max(120),
  sort_order: z.number().int().min(0).max(9999),
  is_active: z.boolean(),
});

export async function saveIncidentCategory(
  input: z.infer<typeof categorySchema>,
  id?: string,
): Promise<ActionResult> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return fail('invalid_category');

  const supabase = createClient();
  const { error } = id
    ? await supabase.from('incident_categories').update(parsed.data).eq('id', id)
    : await supabase.from('incident_categories').insert(parsed.data);
  if (error) return mapError(error);

  revalidatePath('/admin/incident-types');
  return { ok: true, data: undefined };
}

const typeSchema = categorySchema.extend({ category_id: z.string().uuid() });

export async function saveIncidentType(
  input: z.infer<typeof typeSchema>,
  id?: string,
): Promise<ActionResult> {
  const parsed = typeSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_type');

  const supabase = createClient();
  const { error } = id
    ? await supabase.from('incident_types').update(parsed.data).eq('id', id)
    : await supabase.from('incident_types').insert(parsed.data);
  if (error) return mapError(error);

  revalidatePath('/admin/incident-types');
  return { ok: true, data: undefined };
}
