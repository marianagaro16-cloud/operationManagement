import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, addDays, businessToday } from '@/lib/datetime';
import { sendToUser } from './push';

/** The afternoon before: time enough to pack what is missing. */
const NOTICE_AT = '14:00';

/**
 * The day before a confirmed event, its responsible person is told how much
 * of its material is not ticked as packed yet (decided 2026-10-16). Once per
 * event: the ledger row is claimed before sending.
 */
export async function runEventMaterialNotices(now = new Date()): Promise<{ sent: number }> {
  const clock = DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).toFormat('HH:mm');
  if (clock < NOTICE_AT) return { sent: 0 };
  const tomorrow = addDays(businessToday(now), 1);
  const admin = createAdminClient();

  const { data: events, error } = await admin
    .from('events')
    .select('id, name, owner_id, materials:event_materials ( packed )')
    .eq('stage', 'confirmed')
    .eq('start_date', tomorrow)
    .not('owner_id', 'is', null);
  if (error) throw new Error(`event material notices: ${error.message}`);

  let sent = 0;
  for (const e of (events ?? []) as { id: string; name: string; owner_id: string; materials: { packed: boolean }[] }[]) {
    const open = e.materials.filter((m) => !m.packed).length;
    if (open === 0) continue;
    const { data: claimed } = await admin
      .from('event_material_notices')
      .upsert({ event_id: e.id }, { onConflict: 'event_id', ignoreDuplicates: true })
      .select('event_id');
    if (!claimed?.length) continue;
    try {
      // In Spanish, like every other server-sent notification.
      await sendToUser(e.owner_id, {
        title: `${e.name}: ${open} cosa${open === 1 ? '' : 's'} sin empacar`,
        body: 'El evento es mañana. Revisa el material y marca lo que ya está empacado.',
        url: `/events/${e.id}#materials`,
        tag: `event-material-${e.id}`,
      });
      sent++;
    } catch (err) {
      console.error('event material notices: send failed', err);
    }
  }
  return { sent };
}
