import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { EMPTY_COUNTS, merchStatus } from '@/domain/merch';
import type {
  MerchCampaignLine,
  MerchCampaignRow,
  MerchCustomerOption,
  MerchHistoryEntry,
  MerchItem,
  MerchItemRow,
  MerchNotSentReason,
  MerchPacking,
  MerchStock,
  MerchStockEntry,
} from '@/types/merch';

/*
 * Merch reads. Items, campaigns and their lines are readable by everyone
 * approved (the packers see an order's merch); stock and hand-overs by the
 * planners only — RLS decides, these just ask.
 */

type Person = { name: string | null; email: string } | null;
const who = (p: Person) => (p ? p.name || p.email : null);

export async function canManageMerchDb(): Promise<boolean> {
  const { data } = await createClient().rpc('can_manage_merch');
  return data === true;
}

export async function getMerchItems(includeInactive = true): Promise<MerchItemRow[]> {
  const supabase = createClient();
  let q = supabase.from('merch_items').select('id, name, note, is_active').order('name');
  if (!includeInactive) q = q.eq('is_active', true);
  const [{ data, error }, { data: stock }] = await Promise.all([q, supabase.from('merch_item_stock').select('*')]);
  if (error) throw new Error(error.message);
  const byItem = new Map(((stock ?? []) as MerchStock[]).map((s) => [s.item_id, s]));
  return ((data ?? []) as MerchItem[]).map((i) => {
    const s = byItem.get(i.id);
    return { ...i, stock: s ? s.received - s.sent - s.handed : 0, promised: s?.promised ?? 0 };
  });
}

interface RawLine {
  id: string;
  campaign_id: string;
  customer_id: string;
  quantity: number;
  packing: MerchPacking;
  not_sent_reason: MerchNotSentReason | null;
  not_sent_note: string | null;
  packed_at: string | null;
  expired_at: string | null;
  created_at: string;
  customer: { name: string | null } | null;
  order: { id: string; reference: number; delivery_date: string; shipped_at: string | null; ready_at: string | null } | null;
}

const LINE_COLUMNS = `
  id, campaign_id, customer_id, quantity, packing, not_sent_reason, not_sent_note, packed_at, expired_at, created_at,
  customer:customers ( name ),
  order:orders ( id, reference, delivery_date, shipped_at, ready_at )
`;

interface RawCampaign {
  id: string;
  item_id: string;
  week_start: string;
  deadline: string;
  quantity: number;
  carry_weeks: number;
  customer_type_ids: string[];
  note: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  item: { name: string } | null;
  creator: Person;
}

const CAMPAIGN_COLUMNS = `
  id, item_id, week_start, deadline, quantity, carry_weeks, customer_type_ids, note, cancelled_at, created_by,
  item:merch_items ( name ),
  creator:profiles!merch_campaigns_created_by_fkey ( name, email )
`;

function toCampaign(c: RawCampaign, lines: RawLine[]): MerchCampaignRow {
  const counts = { ...EMPTY_COUNTS };
  for (const l of lines) counts[merchStatus(l)]++;
  return {
    id: c.id,
    item_id: c.item_id,
    item_name: c.item?.name ?? '—',
    week_start: c.week_start,
    deadline: c.deadline,
    quantity: c.quantity,
    carry_weeks: c.carry_weeks,
    customer_type_ids: c.customer_type_ids ?? [],
    note: c.note,
    cancelled_at: c.cancelled_at,
    created_by: c.created_by,
    creator_name: who(c.creator),
    counts,
  };
}

/** Every campaign, newest week first, with how far each one got. */
export async function getMerchCampaigns(): Promise<MerchCampaignRow[]> {
  const supabase = createClient();
  const [{ data, error }, { data: lines, error: lineError }] = await Promise.all([
    supabase.from('merch_campaigns').select(CAMPAIGN_COLUMNS).order('week_start', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('merch_campaign_customers').select(LINE_COLUMNS),
  ]);
  if (error) throw new Error(error.message);
  if (lineError) throw new Error(lineError.message);
  const byCampaign = new Map<string, RawLine[]>();
  for (const l of (lines ?? []) as unknown as RawLine[]) byCampaign.set(l.campaign_id, [...(byCampaign.get(l.campaign_id) ?? []), l]);
  return ((data ?? []) as unknown as RawCampaign[]).map((c) => toCampaign(c, byCampaign.get(c.id) ?? []));
}

export async function getMerchCampaign(id: string): Promise<{ campaign: MerchCampaignRow; lines: MerchCampaignLine[] } | null> {
  const supabase = createClient();
  const [{ data, error }, { data: lines, error: lineError }] = await Promise.all([
    supabase.from('merch_campaigns').select(CAMPAIGN_COLUMNS).eq('id', id).maybeSingle(),
    supabase.from('merch_campaign_customers').select(LINE_COLUMNS).eq('campaign_id', id),
  ]);
  if (error) throw new Error(error.message);
  if (lineError) throw new Error(lineError.message);
  if (!data) return null;
  const raw = (lines ?? []) as unknown as RawLine[];
  return {
    campaign: toCampaign(data as unknown as RawCampaign, raw),
    lines: raw
      .map((l) => ({
        id: l.id,
        customer_id: l.customer_id,
        customer_name: l.customer?.name ?? '—',
        quantity: l.quantity,
        status: merchStatus(l),
        packing: l.packing,
        not_sent_reason: l.not_sent_reason,
        not_sent_note: l.not_sent_note,
        order: l.order,
      }))
      .sort((a, b) => a.customer_name.localeCompare(b.customer_name)),
  };
}

/** Active customers to aim a campaign at. */
export async function getMerchCustomerOptions(): Promise<MerchCustomerOption[]> {
  const { data, error } = await createClient()
    .from('customers')
    .select('id, name, customer_type_id')
    .eq('is_active', true)
    .order('name');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string | null; customer_type_id: string | null }[]).map((c) => ({
    id: c.id,
    name: c.name ?? '—',
    customer_type_id: c.customer_type_id,
  }));
}

/**
 * Merch history: campaign lines and hand-overs, newest first.
 * For one customer (their file) or one item (its page).
 */
export async function getMerchHistory(filter: { customerId?: string; itemId?: string }): Promise<MerchHistoryEntry[]> {
  const supabase = createClient();
  let lines = supabase
    .from('merch_campaign_customers')
    .select(`${LINE_COLUMNS}, campaign:merch_campaigns!inner ( id, item_id, week_start, cancelled_at, item:merch_items ( name ) ), packer:profiles!merch_campaign_customers_packed_by_fkey ( name, email )`);
  let handouts = supabase
    .from('merch_handouts')
    .select('id, customer_id, item_id, quantity, given_on, note, customer:customers ( name ), item:merch_items ( name ), creator:profiles!merch_handouts_created_by_fkey ( name, email )');
  if (filter.customerId) {
    lines = lines.eq('customer_id', filter.customerId);
    handouts = handouts.eq('customer_id', filter.customerId);
  }
  if (filter.itemId) {
    lines = lines.eq('campaign.item_id', filter.itemId);
    handouts = handouts.eq('item_id', filter.itemId);
  }
  const [{ data: l, error }, { data: h, error: hError }] = await Promise.all([lines, handouts]);
  if (error) throw new Error(error.message);
  // Hand-overs are the planners' to read; anyone else simply sees none.
  if (hError && !hError.message.includes('permission')) throw new Error(hError.message);

  type Line = RawLine & {
    campaign: { id: string; item_id: string; week_start: string; cancelled_at: string | null; item: { name: string } | null };
    packer: Person;
  };
  const fromLines: MerchHistoryEntry[] = ((l ?? []) as unknown as Line[]).map((x) => {
    const status = merchStatus(x);
    return {
      source: 'campaign',
      id: x.id,
      // When it left, else when it is due to.
      date: x.order?.shipped_at?.slice(0, 10) ?? x.order?.delivery_date ?? x.campaign.week_start,
      item_id: x.campaign.item_id,
      item_name: x.campaign.item?.name ?? '—',
      customer_id: x.customer_id,
      customer_name: x.customer?.name ?? '—',
      quantity: x.quantity,
      status,
      not_sent_reason: x.not_sent_reason,
      note: x.not_sent_note,
      campaign_id: x.campaign.id,
      order: x.order ? { id: x.order.id, reference: x.order.reference } : null,
      by: who(x.packer),
    };
  });

  type Handout = {
    id: string; customer_id: string; item_id: string; quantity: number; given_on: string; note: string | null;
    customer: { name: string | null } | null; item: { name: string } | null; creator: Person;
  };
  const fromHandouts: MerchHistoryEntry[] = ((h ?? []) as unknown as Handout[]).map((x) => ({
    source: 'handout',
    id: x.id,
    date: x.given_on,
    item_id: x.item_id,
    item_name: x.item?.name ?? '—',
    customer_id: x.customer_id,
    customer_name: x.customer?.name ?? '—',
    quantity: x.quantity,
    status: 'sent',
    not_sent_reason: null,
    note: x.note,
    campaign_id: null,
    order: null,
    by: who(x.creator),
  }));

  return [...fromLines, ...fromHandouts].sort((a, b) => b.date.localeCompare(a.date));
}

export async function getMerchItem(id: string): Promise<{
  item: MerchItemRow;
  stock: MerchStock;
  entries: MerchStockEntry[];
  history: MerchHistoryEntry[];
} | null> {
  const supabase = createClient();
  const [{ data: item }, { data: stock }, { data: entries, error }, history] = await Promise.all([
    supabase.from('merch_items').select('id, name, note, is_active').eq('id', id).maybeSingle(),
    supabase.from('merch_item_stock').select('*').eq('item_id', id).maybeSingle(),
    supabase
      .from('merch_stock_entries')
      .select('id, quantity, entry_date, note, created_at, creator:profiles!merch_stock_entries_created_by_fkey ( name, email )')
      .eq('item_id', id)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false }),
    getMerchHistory({ itemId: id }),
  ]);
  if (error) throw new Error(error.message);
  if (!item) return null;
  const s = (stock as MerchStock | null) ?? { item_id: id, received: 0, sent: 0, handed: 0, promised: 0 };
  return {
    item: { ...(item as MerchItem), stock: s.received - s.sent - s.handed, promised: s.promised },
    stock: s,
    entries: ((entries ?? []) as unknown as (MerchStockEntry & { creator: Person })[]).map(({ creator, ...e }) => ({
      ...e,
      by: who(creator),
    })),
    history,
  };
}
