import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import { addDays, businessNow, businessToday } from '@/lib/datetime';
import { sendToUsers } from './push';
import { urgentOrderRecipients } from './order-notify';

/*
 * Merch, on the scheduled run (decided 2026-10-14):
 *
 *   expired    merch still waiting for an order when its window closes is
 *              "not sent"; whoever made the campaign hears which customers
 *   low stock  an item whose stock does not cover what is still promised:
 *              the makers of its open campaigns hear it once, and again only
 *              after it was covered in between
 *   heads-up   Monday morning, whoever prepares the orders (Jefferson, and
 *              whoever covers him that day) hears which merch goes this week
 *
 * Written in Spanish, like every other server-sent notification. Each part
 * claims its ledger row before sending, so the job is safe on every run.
 */

/** "A, B y 2 más" */
function listed(names: string[]): string {
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} y ${names.length - 3} más` : shown;
}

export async function runMerchJobs(now = new Date()): Promise<{ expired: number; lowStock: number; headsUp: number }> {
  const today = businessToday(now);
  const [expired, lowStock, headsUp] = [await expire(today), await lowStockNotices(today), await mondayHeadsUp(now, today)];
  return { expired, lowStock, headsUp };
}

async function expire(today: string): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('merch_campaign_customers')
    .select('id, customer:customers ( name ), campaign:merch_campaigns!inner ( id, created_by, deadline, cancelled_at, item:merch_items ( name ) )')
    .is('order_id', null)
    .eq('packing', 'open')
    .is('expired_at', null)
    .is('campaign.cancelled_at', null)
    .lt('campaign.deadline', today);
  if (error) throw new Error(`merch expire: ${error.message}`);
  type Row = { id: string; customer: { name: string } | null; campaign: { id: string; created_by: string | null; item: { name: string } | null } };
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return 0;

  // Only the rows this run actually closed are announced.
  const { data: closed, error: updError } = await admin
    .from('merch_campaign_customers')
    .update({ expired_at: new Date().toISOString() })
    .in('id', rows.map((r) => r.id))
    .is('order_id', null)
    .is('expired_at', null)
    .select('id');
  if (updError) throw new Error(`merch expire: ${updError.message}`);
  const done = new Set(((closed ?? []) as { id: string }[]).map((r) => r.id));

  const byCampaign = new Map<string, Row[]>();
  for (const r of rows) if (done.has(r.id)) byCampaign.set(r.campaign.id, [...(byCampaign.get(r.campaign.id) ?? []), r]);
  for (const [campaignId, list] of byCampaign) {
    const to = list[0].campaign.created_by;
    if (!to) continue;
    try {
      await sendToUsers([to], {
        title: `Merch sin pedido a tiempo: ${list[0].campaign.item?.name ?? ''}`,
        body: `${list.length === 1 ? '1 cliente no hizo pedido' : `${list.length} clientes no hicieron pedido`} dentro del plazo: ${listed(list.map((r) => r.customer?.name ?? ''))}. Queda como no enviado.`,
        url: `/merch/${campaignId}`,
        tag: `merch-expired-${campaignId}-${today}`,
        level: 'warning',
      });
    } catch (err) {
      console.error('merch: expired notice failed', err);
    }
  }
  return done.size;
}

async function lowStockNotices(today: string): Promise<number> {
  const admin = createAdminClient();
  const [{ data: stock, error }, { data: items }, { data: notices }] = await Promise.all([
    admin.from('merch_item_stock').select('*'),
    admin.from('merch_items').select('id, name'),
    admin.from('merch_notices').select('ref_id').eq('kind', 'low_stock'),
  ]);
  if (error) throw new Error(`merch stock: ${error.message}`);
  const names = new Map(((items ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]));
  const told = new Set(((notices ?? []) as { ref_id: string }[]).map((n) => n.ref_id));

  let sent = 0;
  for (const s of (stock ?? []) as { item_id: string; received: number; sent: number; handed: number; promised: number }[]) {
    const left = s.received - s.sent - s.handed;
    const short = s.promised > left;
    if (!short) {
      // Covered again: a later shortage is news again.
      if (told.has(s.item_id)) await admin.from('merch_notices').delete().eq('kind', 'low_stock').eq('ref_id', s.item_id);
      continue;
    }
    if (told.has(s.item_id)) continue;
    const { data: claimed } = await admin
      .from('merch_notices')
      .upsert({ kind: 'low_stock', ref_id: s.item_id, notice_date: today }, { onConflict: 'kind,ref_id,notice_date', ignoreDuplicates: true })
      .select('ref_id');
    if (!claimed?.length) continue;

    const { data: campaigns } = await admin
      .from('merch_campaigns')
      .select('created_by')
      .eq('item_id', s.item_id)
      .is('cancelled_at', null)
      .gte('deadline', today);
    const to = [...new Set(((campaigns ?? []) as { created_by: string | null }[]).map((c) => c.created_by).filter((v): v is string => !!v))];
    if (to.length === 0) continue;
    try {
      await sendToUsers(to, {
        title: `Falta merch: ${names.get(s.item_id) ?? ''}`,
        body: `Quedan ${left} y hay ${s.promised} prometidos en campañas. Faltan ${s.promised - left}.`,
        url: `/merch/items/${s.item_id}`,
        tag: `merch-low-${s.item_id}`,
        level: 'warning',
      });
      sent++;
    } catch (err) {
      console.error('merch: low stock notice failed', err);
    }
  }
  return sent;
}

async function mondayHeadsUp(now: Date, today: string): Promise<number> {
  const local = businessNow(now);
  if (local.weekday !== 1) return 0;
  const admin = createAdminClient();
  const { data: setting } = await admin.from('app_settings').select('value').eq('key', 'absences.hours').maybeSingle();
  const start = ((setting?.value ?? {}) as { start?: string }).start ?? '06:30';
  const clock = local.toFormat('HH:mm');
  if (clock < start || clock >= '12:00') return 0;

  const sunday = addDays(today, 6);
  const { data, error } = await admin
    .from('merch_campaign_customers')
    .select('quantity, order:orders ( shipped_at ), campaign:merch_campaigns!inner ( week_start, deadline, cancelled_at, quantity, item:merch_items ( name ) )')
    .neq('packing', 'not_sent')
    .is('expired_at', null)
    .is('campaign.cancelled_at', null)
    .lte('campaign.week_start', sunday)
    .gte('campaign.deadline', today);
  if (error) throw new Error(`merch heads-up: ${error.message}`);
  type Row = { quantity: number; order: { shipped_at: string | null } | null; campaign: { quantity: number; item: { name: string } | null } };
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => !r.order?.shipped_at);
  if (rows.length === 0) return 0;

  const byItem = new Map<string, { customers: number; quantity: number }>();
  for (const r of rows) {
    const name = r.campaign.item?.name ?? '—';
    const cur = byItem.get(name) ?? { customers: 0, quantity: r.campaign.quantity };
    byItem.set(name, { ...cur, customers: cur.customers + 1 });
  }
  const body = [...byItem]
    .map(([name, v]) => `${name} ×${v.quantity} (${v.customers === 1 ? '1 cliente' : `${v.customers} clientes`})`)
    .join(', ');

  let sent = 0;
  for (const userId of await urgentOrderRecipients(today)) {
    const { data: claimed } = await admin
      .from('merch_notices')
      .upsert({ kind: 'heads_up', ref_id: userId, notice_date: today }, { onConflict: 'kind,ref_id,notice_date', ignoreDuplicates: true })
      .select('ref_id');
    if (!claimed?.length) continue;
    try {
      await sendToUsers([userId], {
        title: 'Merch de esta semana',
        body: `${body}. Va con el primer pedido de cada cliente: márcalo al preparar.`,
        url: '/orders?tab=to_prepare',
        tag: `merch-heads-up-${today}`,
      });
      sent++;
    } catch (err) {
      console.error('merch: heads-up failed', err);
    }
  }
  return sent;
}
