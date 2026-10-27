import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, addDays, businessToday } from '@/lib/datetime';
import { sendToUser } from './push';

/** Without a pack-by day: the afternoon before, time enough to pack what is missing. */
const NOTICE_AT = '14:00';
/** On the pack-by day: the bringers in the morning, the responsible person once the day's packing is done. */
const BRINGERS_AT = '08:00';
const EVENING_AT = '18:00';

const qty = (n: number | null) => (n === null ? '' : `${new Intl.NumberFormat('de-CH', { maximumFractionDigits: 2 }).format(Number(n))} × `);

type Material = {
  name: string;
  quantity: number | null;
  packed: boolean;
  bringer_profile: string | null;
  person: { name: string } | null;
  worker: { name: string } | null;
};
type Event = { id: string; name: string; owner_id: string | null; start_date: string; material_pack_by: string | null; materials: Material[] };

/**
 * Material not packed in time (decided 2026-10-16, pack-by day 2026-10-27).
 *
 * An event with a pack-by day: that morning each bringer is reminded of what
 * they still have to pack, and that evening the responsible person hears what
 * is not packed and who brings it. Without one, as before: the responsible
 * person the afternoon before. Each once — the ledger row is claimed before
 * sending.
 */
export async function runEventMaterialNotices(now = new Date()): Promise<{ sent: number }> {
  const clock = DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).toFormat('HH:mm');
  if (clock < BRINGERS_AT) return { sent: 0 };
  const today = businessToday(now);
  const tomorrow = addDays(today, 1);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('events')
    .select(`id, name, owner_id, start_date, material_pack_by,
      materials:event_materials ( name, quantity, packed, bringer_profile, sort_order,
        person:profiles!event_materials_bringer_profile_fkey ( name ), worker:hr_workers ( name ) )`)
    .eq('stage', 'confirmed')
    .or(`material_pack_by.eq.${today},and(material_pack_by.is.null,start_date.eq.${tomorrow})`)
    .order('sort_order', { referencedTable: 'event_materials' });
  if (error) throw new Error(`event material notices: ${error.message}`);

  let sent = 0;
  for (const e of (data ?? []) as unknown as Event[]) {
    const open = e.materials.filter((m) => !m.packed);
    if (open.length === 0) continue;

    // ---- the bringers, the morning of the pack-by day ----
    if (e.material_pack_by === today) {
      const mine = new Map<string, Material[]>();
      for (const m of open) if (m.bringer_profile) mine.set(m.bringer_profile, [...(mine.get(m.bringer_profile) ?? []), m]);
      for (const [to, things] of mine) {
        const { data: claimed } = await admin
          .from('event_material_pack_notices')
          .upsert({ event_id: e.id, profile_id: to }, { onConflict: 'event_id,profile_id', ignoreDuplicates: true })
          .select('event_id');
        if (!claimed?.length) continue;
        try {
          // In Spanish, like every other server-sent notification.
          await sendToUser(to, {
            title: `Hoy: empacar material — ${e.name}`,
            body: things.map((m) => `${qty(m.quantity)}${m.name}`).join(', '),
            url: `/events/${e.id}`,
            tag: `event-material-pack-${e.id}`,
          });
          sent++;
        } catch (err) {
          console.error('event material notices: send failed', err);
        }
      }
    }

    // ---- the responsible person ----
    if (!e.owner_id) continue;
    const due = e.material_pack_by ? clock >= EVENING_AT : clock >= NOTICE_AT;
    if (!due) continue;
    const { data: claimed } = await admin
      .from('event_material_notices')
      .upsert({ event_id: e.id }, { onConflict: 'event_id', ignoreDuplicates: true })
      .select('event_id');
    if (!claimed?.length) continue;

    const title = `${e.name}: ${open.length} cosa${open.length === 1 ? '' : 's'} sin empacar`;
    let body = 'El evento es mañana. Revisa el material y marca lo que ya está empacado.';
    if (e.material_pack_by) {
      const byWho = new Map<string, string[]>();
      for (const m of open) {
        const who = m.person?.name ?? m.worker?.name ?? 'Sin asignar';
        byWho.set(who, [...(byWho.get(who) ?? []), `${qty(m.quantity)}${m.name}`]);
      }
      body = [...byWho].map(([who, things]) => `${who}: ${things.join(', ')}`).join(' · ');
    }
    try {
      await sendToUser(e.owner_id, { title, body, url: `/events/${e.id}#materials`, tag: `event-material-${e.id}` });
      sent++;
    } catch (err) {
      console.error('event material notices: send failed', err);
    }
  }
  return { sent };
}
