import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { businessToday } from '@/lib/datetime';
import { sendToUsers } from './push';

/*
 * Telling whoever enters production in bexio that something was produced
 * (decided 2026-10-13).
 *
 * The people kept in app_settings ('production.record_notice_people') get a
 * notice the moment a production is recorded, and another, marked as a
 * correction, when its units or best-before date change afterwards.
 * Written in Spanish, like every other server-sent notification.
 */

export interface RecordedBefore {
  produced_quantity: number;
  best_before: string | null;
}

interface Recorded extends RecordedBefore {
  target_quantity: number;
  shortfall_reason: string | null;
  shortfall_note: string | null;
  product: { name: string } | null;
  occurrence: { effective_due_date: string } | null;
}

const REASON: Record<string, string> = {
  raw_material: 'Falta materia prima',
  packaging: 'Falta empaque',
  time: 'Falta de tiempo',
  damaged: 'Producto dañado',
  other: 'Otro',
};

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));
const day = (iso: string) => DateTime.fromISO(iso).toFormat('dd.MM.yyyy');

async function recipients(exclude: string): Promise<string[]> {
  const { data } = await createAdminClient().from('app_settings').select('value').eq('key', 'production.record_notice_people').maybeSingle();
  return (Array.isArray(data?.value) ? data.value : []).filter((v): v is string => typeof v === 'string' && v !== exclude);
}

async function firstName(userId: string): Promise<string> {
  const { data } = await createAdminClient().from('profiles').select('name').eq('id', userId).maybeSingle();
  return (data?.name ?? '').trim().split(' ')[0] || 'Alguien';
}

/** What is recorded for this day now — read before recording, to tell a correction from a first time. */
export async function productionRecordedBefore(occurrenceId: string): Promise<RecordedBefore | null> {
  const { data } = await createAdminClient()
    .from('production_records')
    .select('produced_quantity, best_before')
    .eq('occurrence_id', occurrenceId)
    .maybeSingle();
  return data ? { produced_quantity: Number(data.produced_quantity), best_before: data.best_before } : null;
}

/** Never fails the recording that caused it. */
export async function notifyProductionRecorded(occurrenceId: string, actorId: string, before: RecordedBefore | null): Promise<void> {
  try {
    const to = await recipients(actorId);
    if (to.length === 0) return;
    const [{ data }, name] = await Promise.all([
      createAdminClient()
        .from('production_records')
        .select(
          'produced_quantity, target_quantity, best_before, shortfall_reason, shortfall_note, product:products ( name ), occurrence:task_occurrences ( effective_due_date )',
        )
        .eq('occurrence_id', occurrenceId)
        .maybeSingle(),
      firstName(actorId),
    ]);
    const r = data as unknown as Recorded | null;
    if (!r) return;
    const produced = Number(r.produced_quantity);
    const unitsChanged = before !== null && before.produced_quantity !== produced;
    const dateChanged = before !== null && before.best_before !== r.best_before;
    // Recorded again with the same units and date: bexio already has it.
    if (before && !unitsChanged && !dateChanged) return;

    const product = r.product?.name ?? 'un producto';
    const due = r.occurrence?.effective_due_date;
    const bestBefore = r.best_before
      ? `cad. ${day(r.best_before)}${dateChanged && before?.best_before ? ` (antes ${day(before.best_before)})` : ''}`
      : null;
    const details = [
      `Previsto: ${qty(Number(r.target_quantity))}`,
      bestBefore,
      // Recorded on another day than the one it was planned for.
      due && due !== businessToday() ? `Día: ${day(due)}` : null,
      r.shortfall_reason ? REASON[r.shortfall_reason] ?? null : null,
      r.shortfall_note ? `Nota: ${r.shortfall_note}` : null,
    ].filter(Boolean);

    await sendToUsers(to, {
      title: before
        ? `Corregido: ${qty(produced)} × ${product}${unitsChanged ? ` (antes ${qty(before.produced_quantity)})` : ''}`
        : `${name} produjo ${qty(produced)} × ${product}`,
      body: [before ? `${name} corrigió la producción.` : null, details.join(' · ')].filter(Boolean).join(' ').slice(0, 400),
      url: '/production',
      // The time in the tag: a correction is a notice of its own.
      tag: `production-recorded-${occurrenceId}-${Date.now()}`,
    });
  } catch (err) {
    console.error('production-notify: recorded notice failed', err);
  }
}
