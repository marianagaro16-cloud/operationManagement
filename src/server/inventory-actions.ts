'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { inventoryScheduleSchema, INVENTORY_FREQUENCIES, INVENTORY_KINDS } from '@/domain/inventory/types';
import { addDays, businessToday } from '@/lib/datetime';
import { ensureInventoryInstances } from './inventory';
import { sendToUser } from './push';
import type { ActionResult } from './actions';

/**
 * Inventory server actions.
 *
 * A thin, validated transport — NOT the security boundary. Every rule that
 * matters (who may edit, the 18:00 deadline, admin-only Inventory Digital,
 * a resolution needing a reason, temporary permissions expiring) is enforced
 * by RLS and SECURITY DEFINER functions in the database. These actions
 * validate early so the user gets a translatable message instead of a
 * Postgres error, and the database rejects the same thing again anyway.
 */

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  // Stable identifiers the UI translates, rather than raw SQL text.
  const codes = [
    'not_authorized',
    'inventory_not_found',
    'inventory_item_not_found',
    'inventory_already_completed',
    'already_counted',
    'digital_disabled_for_template',
    'resolution_note_required',
    'nothing_to_resolve',
    'negative_quantity',
    'grant_spans_multiple_days',
    'invalid_window',
    'grant_not_found',
    'location_required',
    'location_not_found',
    'unexpected_field_for_kind',
    'inventory_template_not_found',
  ];
  for (const code of codes) if (message.includes(code)) return { ok: false, error: code };
  // Constraint names are not messages a warehouse operator can act on.
  if (message.includes('inventory_entries_quantity_check')) {
    return { ok: false, error: 'negative_quantity' };
  }
  if (message.includes('violates row-level security')) {
    return { ok: false, error: 'not_authorized' };
  }
  return { ok: false, error: message };
}

function revalidateInventory(instanceId?: string) {
  revalidatePath('/inventory');
  revalidatePath('/dashboard');
  if (instanceId) revalidatePath(`/inventory/${instanceId}`);
}

/* ------------------------------- entries ------------------------------- */

/**
 * Whole units only. Decimals are rejected rather than rounded — a "0.5" in a
 * count of boxes means the counter meant something this system cannot
 * represent. Null is a valid quantity (not counted yet); zero is explicitly
 * allowed and is a different statement.
 */
const quantitySchema = z
  .number()
  .int({ message: 'not_an_integer' })
  .min(0, { message: 'negative_quantity' })
  .nullable();

const entryInputSchema = z.object({
  instance_item_id: z.string().uuid(),
  instance_id: z.string().uuid(),
  quantity: quantitySchema,
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lot_number: z.string().trim().max(120).nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  position: z.number().int().min(0).default(0),
});

export type EntryInput = z.infer<typeof entryInputSchema>;

export async function addInventoryEntry(input: EntryInput): Promise<ActionResult<{ id: string }>> {
  const parsed = entryInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_entry' };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const { data, error } = await supabase
    .from('inventory_entries')
    .insert({ ...parsed.data, created_by: user.id, updated_by: user.id })
    .select('id')
    .single();

  if (error) return fail(error);
  revalidateInventory(parsed.data.instance_id);
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/**
 * Record "nothing in stock" for one line, in one tap.
 *
 * Counting an empty shelf used to take five interactions — expand, Add entry,
 * focus the field, type 0, blur — and on a 114-item packaging count most
 * lines are empty. Worse, doing nothing at all produced the same Physical
 * Stock of 0, so the screen could not tell "checked, empty" from "not looked
 * at". This writes the affirmative zero the schema has always allowed.
 *
 * Deliberately additive, never destructive: it fills in blanks and refuses to
 * touch a line that already carries a real number, so a mis-tap cannot erase
 * a count. Undo is the ordinary one — edit the quantity, or delete the row.
 */
export async function markInventoryItemEmpty(
  itemId: string,
  instanceId: string,
): Promise<ActionResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const { data: instance, error: instErr } = await supabase
    .from('inventory_instances')
    .select('kind')
    .eq('id', instanceId)
    .maybeSingle();
  if (instErr) return fail(instErr);
  if (!instance) return { ok: false, error: 'inventory_not_found' };

  const { data: existing, error: entriesErr } = await supabase
    .from('inventory_entries')
    .select('id, quantity')
    .eq('instance_item_id', itemId);
  if (entriesErr) return fail(entriesErr);

  const rows = (existing ?? []) as { id: string; quantity: number | null }[];
  if (rows.some((r) => (r.quantity ?? 0) > 0)) {
    return { ok: false, error: 'already_counted' };
  }

  // Blank rows the counter left behind: fill them in rather than adding
  // another, so the line does not end up with two rows both saying nothing.
  const blanks = rows.filter((r) => r.quantity === null);
  if (blanks.length > 0) {
    const { error } = await supabase
      .from('inventory_entries')
      .update({ quantity: 0, updated_by: user.id })
      .in('id', blanks.map((r) => r.id));
    if (error) return fail(error);
    revalidateInventory(instanceId);
    return { ok: true, data: undefined };
  }

  // Already an explicit zero and nothing blank — nothing left to say.
  if (rows.length > 0) {
    revalidateInventory(instanceId);
    return { ok: true, data: undefined };
  }

  const kind = (instance as { kind: string }).kind;

  // Packaging is counted per place and the shape trigger requires a location
  // on every row, so "nothing in stock" means a zero at EACH active location
  // — one blanket row would silently leave the other place uncounted.
  if (kind === 'location') {
    const { data: locations, error: locErr } = await supabase
      .from('inventory_locations')
      .select('id')
      .eq('is_active', true)
      .order('sort_order');
    if (locErr) return fail(locErr);
    if (!locations || locations.length === 0) return { ok: false, error: 'location_not_found' };

    const { error } = await supabase.from('inventory_entries').insert(
      (locations as { id: string }[]).map((l, i) => ({
        instance_item_id: itemId,
        instance_id: instanceId,
        quantity: 0,
        location_id: l.id,
        position: i,
        created_by: user.id,
        updated_by: user.id,
      })),
    );
    if (error) return fail(error);
  } else {
    // expiry and lot kinds: a bare zero. No expiry date is invented for stock
    // that does not exist, and the shape trigger allows both to be null.
    const { error } = await supabase.from('inventory_entries').insert({
      instance_item_id: itemId,
      instance_id: instanceId,
      quantity: 0,
      position: 0,
      created_by: user.id,
      updated_by: user.id,
    });
    if (error) return fail(error);
  }

  revalidateInventory(instanceId);
  return { ok: true, data: undefined };
}

const entryPatchSchema = entryInputSchema
  .omit({ instance_item_id: true, instance_id: true, position: true })
  .partial();

export async function updateInventoryEntry(
  entryId: string,
  instanceId: string,
  patch: z.infer<typeof entryPatchSchema>,
): Promise<ActionResult> {
  const parsed = entryPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_entry' };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const { error } = await supabase
    .from('inventory_entries')
    // updated_by, not created_by: the original author of a record is part of
    // its history and is never rewritten by a later editor.
    .update({ ...parsed.data, updated_by: user.id })
    .eq('id', entryId);

  if (error) return fail(error);
  revalidateInventory(instanceId);
  return { ok: true, data: undefined };
}

export async function deleteInventoryEntry(
  entryId: string,
  instanceId: string,
): Promise<ActionResult> {
  const supabase = createClient();
  // The row is audited before it goes (the delete trigger records it), so the
  // count history survives even though the record does not.
  const { error } = await supabase.from('inventory_entries').delete().eq('id', entryId);
  if (error) return fail(error);
  revalidateInventory(instanceId);
  return { ok: true, data: undefined };
}

/* ---------------------------- instance state --------------------------- */

export async function completeInventory(instanceId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc('inventory_complete', { p_instance_id: instanceId });
  if (error) return fail(error);
  revalidateInventory(instanceId);
  return { ok: true, data: undefined };
}

export async function reopenInventory(instanceId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc('inventory_reopen', { p_instance_id: instanceId });
  if (error) return fail(error);
  revalidateInventory(instanceId);
  return { ok: true, data: undefined };
}

/* --------------------------- Inventory Digital ------------------------- */

/**
 * Admin-only. Passing null puts the item back to "Pending" — which is a real
 * state an admin may need to return to, not a way of clearing the record: the
 * previous value is kept in inventory_digital_history either way.
 */
export async function setInventoryDigital(
  itemId: string,
  instanceId: string,
  value: number | null,
): Promise<ActionResult> {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    return { ok: false, error: value < 0 ? 'negative_quantity' : 'not_an_integer' };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc('inventory_set_digital', {
    p_item_id: itemId,
    p_value: value,
  });
  if (error) return fail(error);
  revalidateInventory(instanceId);
  return { ok: true, data: undefined };
}

export async function resolveInventoryItem(
  itemId: string,
  instanceId: string,
  note: string,
): Promise<ActionResult> {
  // Checked here for a fast, translated message; the database requires it too.
  if (!note || note.trim().length === 0) {
    return { ok: false, error: 'resolution_note_required' };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc('inventory_resolve_item', {
    p_item_id: itemId,
    p_note: note.trim(),
  });
  if (error) return fail(error);
  revalidateInventory(instanceId);
  return { ok: true, data: undefined };
}

/* ------------------------------- comments ------------------------------ */

export async function addInventoryComment(
  instanceId: string,
  body: string,
  itemId?: string | null,
): Promise<ActionResult> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'comment_required' };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const { error } = await supabase.from('inventory_comments').insert({
    instance_id: instanceId,
    instance_item_id: itemId ?? null,
    user_id: user.id,
    body: trimmed,
  });
  if (error) return fail(error);
  revalidateInventory(instanceId);
  return { ok: true, data: undefined };
}

/* ------------------------------ assignment ----------------------------- */

/**
 * Replace the assignee set for one inventory. Admin-only via RLS.
 *
 * Newly added people get a push notification through the existing
 * infrastructure; nobody is emailed, and no second notification system is
 * introduced.
 */
export async function setInventoryAssignees(
  instanceId: string,
  userIds: string[],
): Promise<ActionResult> {
  const supabase = createClient();

  const { data: existing, error: readError } = await supabase
    .from('inventory_assignments')
    .select('user_id')
    .eq('instance_id', instanceId);
  if (readError) return fail(readError);

  const before = new Set((existing ?? []).map((r) => (r as { user_id: string }).user_id));
  const after = new Set(userIds);

  const removed = [...before].filter((id) => !after.has(id));
  const added = [...after].filter((id) => !before.has(id));

  if (removed.length) {
    const { error } = await supabase
      .from('inventory_assignments')
      .delete()
      .eq('instance_id', instanceId)
      .in('user_id', removed);
    if (error) return fail(error);
  }

  if (added.length) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('inventory_assignments').insert(
      added.map((id) => ({ instance_id: instanceId, user_id: id, assigned_by: user?.id ?? null })),
    );
    if (error) return fail(error);

    const { data: instance } = await supabase
      .from('inventory_instances')
      .select('name_snapshot, inventory_date, iso_week')
      .eq('id', instanceId)
      .maybeSingle();

    if (instance) {
      const inv = instance as { name_snapshot: string; inventory_date: string; iso_week: number };
      // Best effort: a push that fails must never fail the assignment.
      await Promise.all(
        added.map((id) =>
          sendToUser(id, {
            title: inv.name_snapshot,
            body: `KW ${inv.iso_week} · ${inv.inventory_date}`,
            tag: `inventory-${instanceId}`,
            url: `/inventory/${instanceId}`,
          }).catch(() => 0),
        ),
      );
    }
  }

  revalidateInventory(instanceId);
  return { ok: true, data: undefined };
}

/* -------------------------- temporary permission ----------------------- */

const grantSchema = z
  .object({
    user_id: z.string().uuid(),
    scope: z.enum(['instance', 'all']),
    instance_id: z.string().uuid().nullable(),
    starts_at: z.string().min(1),
    ends_at: z.string().min(1),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => v.scope !== 'instance' || v.instance_id !== null, {
    message: 'instance_required',
  });

export async function grantInventoryEdit(
  input: z.infer<typeof grantSchema>,
): Promise<ActionResult> {
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_grant' };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc('inventory_grant_edit', {
    p_user_id: parsed.data.user_id,
    p_scope: parsed.data.scope,
    p_instance_id: parsed.data.instance_id,
    p_starts_at: parsed.data.starts_at,
    p_ends_at: parsed.data.ends_at,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return fail(error);

  // Tell the person they can now edit, on the device they actually carry.
  await sendToUser(parsed.data.user_id, {
    title: 'Inventory',
    body: 'Temporary edit permission granted',
    tag: `inventory-grant-${parsed.data.user_id}`,
    url: parsed.data.instance_id ? `/inventory/${parsed.data.instance_id}` : '/inventory',
  }).catch(() => 0);

  revalidatePath('/admin/inventory/permissions');
  revalidateInventory(parsed.data.instance_id ?? undefined);
  return { ok: true, data: undefined };
}

export async function revokeInventoryEdit(grantId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc('inventory_revoke_grant', { p_grant_id: grantId });
  if (error) return fail(error);
  revalidatePath('/admin/inventory/permissions');
  return { ok: true, data: undefined };
}

/* ---------------------------- admin: templates ------------------------- */

const translationSchema = z
  .object({
    name: z.string().trim().nullable().optional(),
    description: z.string().trim().nullable().optional(),
  })
  .optional();

const templateInputSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, { message: 'invalid_slug' }),
  name: z.string().trim().min(1),
  description: z.string().trim().nullable().optional(),
  translations: z.object({ de: translationSchema, en: translationSchema }).default({}),
  kind: z.enum(INVENTORY_KINDS),
  frequency: z.enum(INVENTORY_FREQUENCIES),
  // Null is legitimate: it flags the template as needing configuration rather
  // than letting an invented schedule reach production.
  schedule_config: inventoryScheduleSchema.nullable(),
  digital_enabled: z.boolean(),
  is_active: z.boolean(),
});

export type InventoryTemplateInput = z.infer<typeof templateInputSchema>;

export async function saveInventoryTemplate(
  input: InventoryTemplateInput,
  templateId?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = templateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const supabase = createClient();
  const query = templateId
    ? supabase.from('inventory_templates').update(parsed.data).eq('id', templateId).select('id').single()
    : supabase.from('inventory_templates').insert(parsed.data).select('id').single();

  const { data, error } = await query;
  if (error) return fail(error);

  revalidatePath('/admin/inventory');
  revalidateInventory();
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/** Soft deactivation only. Every historical inventory survives untouched. */
export async function setInventoryTemplateActive(
  templateId: string,
  isActive: boolean,
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from('inventory_templates')
    .update({ is_active: isActive })
    .eq('id', templateId);
  if (error) return fail(error);
  revalidatePath('/admin/inventory');
  revalidateInventory();
  return { ok: true, data: undefined };
}

export async function setTemplateAssignees(
  templateId: string,
  userIds: string[],
): Promise<ActionResult> {
  const supabase = createClient();

  const { error: delError } = await supabase
    .from('inventory_template_assignees')
    .delete()
    .eq('template_id', templateId);
  if (delError) return fail(delError);

  if (userIds.length) {
    const { error } = await supabase
      .from('inventory_template_assignees')
      .insert(userIds.map((id) => ({ template_id: templateId, user_id: id })));
    if (error) return fail(error);
  }

  revalidatePath(`/admin/inventory/${templateId}`);
  return { ok: true, data: undefined };
}

/* ------------------------------ admin: items --------------------------- */

const templateItemSchema = z.object({
  template_id: z.string().uuid(),
  name: z.string().trim().min(1),
  item_group: z.string().trim().nullable().optional(),
  translations: z.object({ de: translationSchema, en: translationSchema }).default({}),
  product_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().min(0).default(100),
  is_active: z.boolean().default(true),
});

export async function saveInventoryTemplateItem(
  input: z.infer<typeof templateItemSchema>,
  itemId?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = templateItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const supabase = createClient();
  const query = itemId
    ? supabase.from('inventory_template_items').update(parsed.data).eq('id', itemId).select('id').single()
    : supabase.from('inventory_template_items').insert(parsed.data).select('id').single();

  const { data, error } = await query;
  if (error) return fail(error);

  revalidatePath(`/admin/inventory/${parsed.data.template_id}`);
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/**
 * Deactivating an item keeps it out of NEWLY generated inventories while
 * leaving it fully visible in every inventory that already counted it.
 * Items are never hard-deleted.
 */
export async function setTemplateItemActive(
  itemId: string,
  templateId: string,
  isActive: boolean,
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from('inventory_template_items')
    .update({ is_active: isActive })
    .eq('id', itemId);
  if (error) return fail(error);
  revalidatePath(`/admin/inventory/${templateId}`);
  return { ok: true, data: undefined };
}

export async function reorderTemplateItems(
  templateId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  const supabase = createClient();
  // Sequential rather than a bulk upsert: an upsert would need every NOT NULL
  // column resent, and this list is edited rarely and is a few hundred rows.
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('inventory_template_items')
      .update({ sort_order: (i + 1) * 10 })
      .eq('id', orderedIds[i]);
    if (error) return fail(error);
  }
  revalidatePath(`/admin/inventory/${templateId}`);
  return { ok: true, data: undefined };
}

/* ---------------------------- admin: locations ------------------------- */

const locationSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, { message: 'invalid_slug' }),
  name: z.string().trim().min(1),
  sort_order: z.number().int().min(0).default(100),
  is_active: z.boolean().default(true),
});

export async function saveInventoryLocation(
  input: z.infer<typeof locationSchema>,
  locationId?: string,
): Promise<ActionResult> {
  const parsed = locationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const supabase = createClient();
  const { error } = locationId
    ? await supabase.from('inventory_locations').update(parsed.data).eq('id', locationId)
    : await supabase.from('inventory_locations').insert(parsed.data);

  if (error) return fail(error);
  revalidatePath('/admin/inventory/locations');
  return { ok: true, data: undefined };
}

/* ------------------------------- horizon ------------------------------- */

/** Manual generation from the admin screen. Idempotent, like the cron run. */
export async function generateInventoryHorizon(
  days = 90,
): Promise<ActionResult<{ created: number }>> {
  // Self-gated because what follows uses the SERVICE-ROLE client, which
  // bypasses RLS entirely — so this check is the only one that runs.
  const supabase = createClient();
  const { data: allowed } = await supabase.rpc('has_permission', { p_key: 'inventory.manage_instances' });
  if (!allowed) return { ok: false, error: 'not_authorized' };

  const today = businessToday();
  try {
    const { created } = await ensureInventoryInstances(today, addDays(today, days));
    revalidateInventory();
    revalidatePath('/admin/inventory');
    return { ok: true, data: { created } };
  } catch (e) {
    return fail(e);
  }
}
