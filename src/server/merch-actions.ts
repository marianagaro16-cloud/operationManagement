'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { sendToUsers } from './push';
import type { ActionResult } from './actions';
import type { MerchNotSentReason, MerchPacking, PendingMerch } from '@/types/merch';

/*
 * Merch writes. Campaigns, items, stock and hand-overs: the planners
 * (can_manage_merch). Packing: whoever prepares orders. The database decides;
 * these validate and translate.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);

const KNOWN = [
  'not_authorized', 'merch_no_customers', 'merch_item_not_found', 'merch_item_inactive', 'merch_campaign_not_found',
  'merch_campaign_cancelled', 'merch_line_not_found', 'merch_reason_required', 'merch_invalid_quantity',
  'order_ready_locked', 'order_shipped_locked', 'order_not_confirmed', 'merch_items_name_key',
];
function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: KNOWN.find((c) => error.message.includes(c)) ?? error.message };
}

function revalidateMerch() {
  revalidatePath('/merch', 'layout');
  revalidatePath('/orders', 'layout');
  revalidatePath('/sales/customers', 'layout');
}

async function me(): Promise<string | null> {
  const { data: { user } } = await createClient().auth.getUser();
  return user?.id ?? null;
}

/* ------------------------------- items ------------------------------- */

const itemSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(120),
  note: text(1000),
  is_active: z.boolean().default(true),
});

export async function saveMerchItem(input: z.input<typeof itemSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { id, ...row } = parsed.data;
  const supabase = createClient();
  const q = id
    ? supabase.from('merch_items').update(row).eq('id', id).select('id').single()
    : supabase.from('merch_items').insert({ ...row, created_by: await me() }).select('id').single();
  const { data, error } = await q;
  if (error) return fail(error);
  revalidateMerch();
  return { ok: true, data: { id: data.id } };
}

const stockSchema = z.object({
  item_id: uuid,
  quantity: z.number().int().refine((n) => n !== 0 && Math.abs(n) <= 1_000_000),
  entry_date: DATE,
  note: text(500),
});

/** Came in (positive) or a counted correction (either sign). */
export async function addMerchStock(input: z.input<typeof stockSchema>): Promise<ActionResult> {
  const parsed = stockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { error } = await createClient().from('merch_stock_entries').insert({ ...parsed.data, created_by: await me() });
  if (error) return fail(error);
  revalidateMerch();
  return { ok: true, data: undefined };
}

/* ----------------------------- campaigns ----------------------------- */

const campaignSchema = z.object({
  id: uuid.nullable().optional(),
  item_id: uuid,
  week_start: DATE,
  quantity: z.number().int().min(1).max(9999),
  carry_weeks: z.number().int().min(0).max(12),
  customer_type_ids: z.array(uuid).max(50),
  customer_ids: z.array(uuid).min(1).max(5000),
  note: text(1000),
});

export async function saveMerchCampaign(input: z.input<typeof campaignSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.some((i) => i.path[0] === 'customer_ids') ? 'merch_no_customers' : 'invalid' };
  const c = parsed.data;
  const { data, error } = await createClient().rpc('merch_save_campaign', {
    p_id: c.id ?? undefined,
    p_item_id: c.item_id,
    p_week_start: c.week_start,
    p_quantity: c.quantity,
    p_carry_weeks: c.carry_weeks,
    p_customer_type_ids: c.customer_type_ids,
    p_customer_ids: [...new Set(c.customer_ids)],
    p_note: c.note ?? undefined,
  });
  if (error) return fail(error);
  revalidateMerch();
  return { ok: true, data: { id: data as string } };
}

export async function cancelMerchCampaign(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'invalid' };
  const { error } = await createClient().rpc('merch_cancel_campaign', { p_id: id });
  if (error) return fail(error);
  revalidateMerch();
  return { ok: true, data: undefined };
}

/** Who already got this item, and when last — to flag them when aiming a campaign. */
export async function merchReceivedBefore(itemId: string, exceptCampaignId?: string | null): Promise<Record<string, string>> {
  if (!uuid.safeParse(itemId).success) return {};
  const supabase = createClient();
  const [{ data: lines }, { data: handouts }] = await Promise.all([
    supabase
      .from('merch_campaign_customers')
      .select('customer_id, campaign_id, packing, order:orders!inner ( shipped_at ), campaign:merch_campaigns!inner ( item_id )')
      .eq('campaign.item_id', itemId)
      .eq('packing', 'packed')
      .not('order.shipped_at', 'is', null),
    supabase.from('merch_handouts').select('customer_id, given_on').eq('item_id', itemId),
  ]);
  const last: Record<string, string> = {};
  const keep = (id: string, date: string) => { if (!last[id] || last[id] < date) last[id] = date; };
  for (const l of (lines ?? []) as unknown as { customer_id: string; campaign_id: string; order: { shipped_at: string } }[]) {
    if (l.campaign_id !== exceptCampaignId) keep(l.customer_id, l.order.shipped_at.slice(0, 10));
  }
  for (const h of (handouts ?? []) as { customer_id: string; given_on: string }[]) keep(h.customer_id, h.given_on);
  return last;
}

/* ----------------------------- on the order ----------------------------- */

const REASON_ES: Record<MerchNotSentReason, string> = {
  none_left: 'no quedaba',
  declined: 'el cliente no lo quiere',
  forgot: 'se olvidó',
  other: 'otro motivo',
};

export async function setMerchPacking(
  lineId: string,
  packing: MerchPacking,
  reason: MerchNotSentReason | null = null,
  note: string | null = null,
): Promise<ActionResult> {
  if (!uuid.safeParse(lineId).success) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const { error } = await supabase.rpc('merch_set_packing', {
    p_line_id: lineId,
    p_packing: packing,
    p_reason: reason ?? undefined,
    p_note: note ?? undefined,
  });
  if (error) return fail(error);

  // Not sent: whoever made the campaign hears it (decided 2026-10-14).
  if (packing === 'not_sent') {
    try {
      const actor = await me();
      const { data } = await createAdminClient()
        .from('merch_campaign_customers')
        .select('quantity, not_sent_note, customer:customers ( name ), order:orders ( reference ), campaign:merch_campaigns ( id, created_by, item:merch_items ( name ) ), packer:profiles!merch_campaign_customers_packed_by_fkey ( name )')
        .eq('id', lineId)
        .maybeSingle();
      const row = data as unknown as {
        quantity: number; not_sent_note: string | null; customer: { name: string } | null; order: { reference: number } | null;
        campaign: { id: string; created_by: string | null; item: { name: string } | null } | null; packer: { name: string | null } | null;
      } | null;
      const to = row?.campaign?.created_by;
      if (row && to && to !== actor) {
        const why = [reason ? REASON_ES[reason] : null, row.not_sent_note].filter(Boolean).join(': ');
        await sendToUsers([to], {
          title: `Merch no enviado: ${row.campaign?.item?.name ?? ''} → ${row.customer?.name ?? ''}`,
          body: `${row.packer?.name?.split(' ')[0] ?? 'Alguien'} lo marcó en el pedido #${row.order?.reference ?? ''}. Motivo: ${why}.`,
          url: `/merch/${row.campaign?.id}`,
          tag: `merch-not-sent-${lineId}`,
          level: 'warning',
        });
      }
    } catch (err) {
      console.error('merch: not-sent notice failed', err);
    }
  }

  revalidateMerch();
  return { ok: true, data: undefined };
}

export async function setMerchQuantity(lineId: string, quantity: number): Promise<ActionResult> {
  if (!uuid.safeParse(lineId).success || !Number.isInteger(quantity)) return { ok: false, error: 'invalid' };
  const { error } = await createClient().rpc('merch_set_quantity', { p_line_id: lineId, p_quantity: quantity });
  if (error) return fail(error);
  revalidateMerch();
  return { ok: true, data: undefined };
}

/**
 * For the order dialog: merch waiting for this customer that a new order
 * would carry — not yet packed, still in its window.
 */
export async function pendingMerchFor(customerId: string): Promise<(PendingMerch & { on_order_date: string | null; on_order_id: string | null })[]> {
  if (!uuid.safeParse(customerId).success) return [];
  const { data } = await createClient()
    .from('merch_campaign_customers')
    .select('id, quantity, order:orders ( id, delivery_date, ready_at ), campaign:merch_campaigns!inner ( week_start, deadline, cancelled_at, item:merch_items ( name ) )')
    .eq('customer_id', customerId)
    .eq('packing', 'open')
    .is('expired_at', null)
    .is('campaign.cancelled_at', null);
  type Row = {
    id: string; quantity: number;
    order: { id: string; delivery_date: string; ready_at: string | null } | null;
    campaign: { week_start: string; deadline: string; item: { name: string } | null };
  };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => !r.order?.ready_at)
    .map((r) => ({
      id: r.id,
      item_name: r.campaign.item?.name ?? '—',
      quantity: r.quantity,
      week_start: r.campaign.week_start,
      deadline: r.campaign.deadline,
      on_order_date: r.order?.delivery_date ?? null,
      on_order_id: r.order?.id ?? null,
    }));
}

/* ----------------------------- hand-overs ----------------------------- */

const handoutSchema = z.object({
  customer_id: uuid,
  item_id: uuid,
  quantity: z.number().int().min(1).max(9999),
  given_on: DATE,
  note: text(1000),
});

/** Given in person — on a visit, at an event. Counts in the history and the stock. */
export async function addMerchHandout(input: z.input<typeof handoutSchema>): Promise<ActionResult> {
  const parsed = handoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { error } = await createClient().from('merch_handouts').insert({ ...parsed.data, created_by: await me() });
  if (error) return fail(error);
  revalidateMerch();
  return { ok: true, data: undefined };
}

export async function deleteMerchHandout(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'invalid' };
  const { error } = await createClient().from('merch_handouts').delete().eq('id', id);
  if (error) return fail(error);
  revalidateMerch();
  return { ok: true, data: undefined };
}
