import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, addDays, businessToday } from '@/lib/datetime';
import { expectedNoticesDue, type ExpectedNoticeKind, type NoticeCandidate, type StorageType } from '@/domain/goods-reception/expected';
import { sendToUser, sendToUsers } from './push';

/*
 * Notices about expected deliveries (decided 2026-10-08).
 *
 * To the people on the reception list: when one is entered, moved or
 * cancelled; the afternoon before; the morning of the day — and on Monday for
 * a week without a day. To whoever entered it: when its day passed and
 * nothing arrived, and when what arrived differs from what was announced.
 */

const URL = '/goods-reception?tab=expected';
// In Spanish, like every other server-sent notification.
const STORAGE: Record<StorageType, string> = { dry: 'seco', refrigerated: 'refrigerado', frozen: 'congelado' };

interface Announced {
  id: string;
  expected_date: string | null;
  expected_week: string | null;
  pallets: number | null;
  storage: StorageType[];
  created_by: string;
  supplier: { name: string } | null;
}

const day = (date: string) => DateTime.fromISO(date, { zone: BUSINESS_TZ }).setLocale('es').toFormat('ccc dd.LL.');

/** "vie 09.10." or "semana del 12.10." */
function when(d: Pick<Announced, 'expected_date' | 'expected_week'>): string {
  return d.expected_date ? day(d.expected_date) : `semana del ${day(d.expected_week!).split(' ')[1]}`;
}

/** "17 pallets · seco" */
function what(d: Pick<Announced, 'pallets' | 'storage'>): string {
  return [d.pallets ? `${d.pallets} pallet${d.pallets === 1 ? '' : 's'}` : null, d.storage.map((s) => STORAGE[s]).join(' y ')]
    .filter(Boolean)
    .join(' · ');
}

async function receivers(exclude?: string | null): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('goods_reception_assignees')
    .select('user_id, user:profiles!goods_reception_assignees_user_id_fkey!inner ( status )')
    .eq('user.status', 'approved');
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id).filter((id) => id !== exclude);
}

async function load(ids: string[]): Promise<Announced[]> {
  if (ids.length === 0) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('expected_deliveries')
    .select('id, expected_date, expected_week, pallets, storage, created_by, supplier:suppliers ( name )')
    .in('id', ids);
  if (error) throw new Error(`expected deliveries: ${error.message}`);
  return (data ?? []) as unknown as Announced[];
}

/** Entered, moved to another day, or cancelled: the receivers hear it, whoever did it aside. */
export async function notifyExpectedChange(
  kind: 'entered' | 'moved' | 'cancelled',
  deliveryId: string,
  actorId: string,
): Promise<void> {
  try {
    const [d] = await load([deliveryId]);
    if (!d) return;
    const name = d.supplier?.name ?? '';
    const title =
      kind === 'entered' ? `Entrega esperada: ${name}` : kind === 'moved' ? `Cambió la fecha: ${name}` : `Entrega cancelada: ${name}`;
    await sendToUsers(await receivers(actorId), {
      title,
      body: kind === 'cancelled' ? `Estaba prevista para ${when(d)}.` : [when(d), what(d)].filter(Boolean).join(' · '),
      url: URL,
      tag: `expected-${kind}-${d.id}-${d.expected_date ?? d.expected_week}`,
    });
  } catch (err) {
    console.error('expected deliveries: notice failed', err);
  }
}

/** What arrived is not what was announced: whoever entered it hears it. */
export async function notifyExpectedDifference(deliveryId: string, receptionId: string, actorId: string): Promise<void> {
  try {
    const [d] = await load([deliveryId]);
    if (!d || d.created_by === actorId) return;
    await sendToUser(d.created_by, {
      title: `Diferencia en la entrega de ${d.supplier?.name ?? ''}`,
      body: 'Lo recibido no coincide con lo esperado. Abre la recepción para ver las cantidades.',
      url: `/goods-reception/${receptionId}`,
      tag: `expected-difference-${d.id}`,
      level: 'warning',
    });
  } catch (err) {
    console.error('expected deliveries: difference notice failed', err);
  }
}

const TITLE: Record<Exclude<ExpectedNoticeKind, 'late'>, string> = {
  eve: 'Entrega próxima',
  morning: 'Hoy llega',
  week: 'Esta semana llega',
};

/**
 * The scheduled notices. Each once per delivery, kind and day: the ledger row
 * is claimed before sending, so two runs at once send one notice.
 */
export async function runExpectedDeliveryNotices(now = new Date()): Promise<{ sent: number }> {
  const today = businessToday(now);
  const clock = DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).toFormat('HH:mm');
  const admin = createAdminClient();

  // Everything still expected up to the next working day — at most a weekend ahead.
  const { data, error } = await admin
    .from('expected_deliveries')
    .select('id, status, expected_date, expected_week, due_date')
    .eq('status', 'expected')
    .lte('due_date', addDays(today, 7));
  if (error) throw new Error(`expected deliveries: ${error.message}`);

  const due = expectedNoticesDue((data ?? []) as NoticeCandidate[], { today, clock });
  if (due.length === 0) return { sent: 0 };

  const [details, floor] = await Promise.all([load([...new Set(due.map((n) => n.deliveryId))]), receivers()]);
  const byId = new Map(details.map((d) => [d.id, d]));

  let sent = 0;
  for (const n of due) {
    const d = byId.get(n.deliveryId);
    if (!d) continue;
    const { data: claimed } = await admin
      .from('expected_delivery_notices')
      .upsert(
        { delivery_id: n.deliveryId, kind: n.kind, notice_date: n.noticeDate },
        { onConflict: 'delivery_id,kind,notice_date', ignoreDuplicates: true },
      )
      .select('delivery_id');
    if (!claimed?.length) continue;

    const name = d.supplier?.name ?? '';
    try {
      if (n.kind === 'late') {
        await sendToUser(d.created_by, {
          title: `No llegó: ${name}`,
          body: `Se esperaba para ${when(d)}. Mueve la fecha, registra la llegada o cancélala.`,
          url: URL,
          tag: `expected-late-${d.id}-${n.noticeDate}`,
          level: 'warning',
        });
      } else {
        await sendToUsers(floor, {
          title: `${TITLE[n.kind]}: ${name}`,
          body: [n.kind === 'morning' ? null : when(d), what(d)].filter(Boolean).join(' · '),
          url: URL,
          tag: `expected-${n.kind}-${d.id}-${n.noticeDate}`,
        });
      }
      sent++;
    } catch (err) {
      console.error('expected deliveries: send failed', err);
    }
  }
  return { sent };
}
