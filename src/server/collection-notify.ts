import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { sendToUser } from './push';

/** From this hour, Europe/Zurich. */
const NOTICE_HOUR = 8;

/**
 * The morning a collection case is due for follow-up — or a promised payment
 * is due to be checked — its responsible is told, once. The ledger row is
 * claimed before sending, so overlapping runs never send twice.
 */
export async function runCollectionNotices(now = new Date()): Promise<{ sent: number }> {
  if (DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).hour < NOTICE_HOUR) return { sent: 0 };
  const today = businessToday();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('collection_cases')
    .select('id, responsible_id, stage, customer:customers ( company_name )')
    .is('closed_at', null)
    .eq('next_follow_up', today)
    .not('responsible_id', 'is', null);
  if (error) throw new Error(`collection notices: ${error.message}`);

  let sent = 0;
  for (const c of (data ?? []) as unknown as { id: string; responsible_id: string; stage: string; customer: { company_name: string } | null }[]) {
    const { data: claimed } = await admin
      .from('collection_notices')
      .upsert({ case_id: c.id, on_date: today, kind: 'follow_up' }, { onConflict: 'case_id,on_date,kind', ignoreDuplicates: true })
      .select('case_id');
    if (!claimed?.length) continue;
    try {
      // In Spanish, like every other server-sent notification.
      await sendToUser(c.responsible_id, {
        title: c.stage === 'promise' ? 'Revisar promesa de pago' : 'Seguimiento de cobranza hoy',
        body: c.customer?.company_name ?? '',
        url: `/collections/${c.id}`,
        tag: `collection-${c.id}-${today}`,
      });
      sent++;
    } catch (err) {
      console.error('collection notices: send failed', err);
    }
  }
  return { sent };
}
