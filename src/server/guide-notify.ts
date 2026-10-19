import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { isoWeekday, openCount, pointsOn } from '@/domain/guide/guide';
import { sendToUsers } from './push';

/** To whoever covers, when points of the day are still open (decided 2026-10-06). */
const REMIND_AT = '14:00';
/** To the approvers, at the end of the office day, about what was left open. */
const SUMMARY_AT = '16:00';

/**
 * A covered day's guide, twice: in the afternoon the covering people are
 * reminded of what is still open, and at the end of the day the approvers are
 * told what was left — never the person who is away. Each once per guide and
 * day: the ledger row is claimed before sending.
 */
export async function runGuideNotices(now = new Date()): Promise<{ sent: number }> {
  const clock = DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).toFormat('HH:mm');
  if (clock < REMIND_AT) return { sent: 0 };
  const today = businessToday(now);
  const admin = createAdminClient();

  const { data: periods, error } = await admin
    .from('coverage_assignments')
    .select('coverer_id, absence_id, absence:absences!inner ( status, profile_id, person:profiles!absences_profile_id_fkey ( name, email ) )')
    .eq('cover_date', today)
    .is('removed_at', null)
    .eq('absence.status', 'approved');
  if (error) throw new Error(`guide notices: ${error.message}`);
  type Period = {
    coverer_id: string;
    absence_id: string;
    absence: { profile_id: string; person: { name: string | null; email: string } | null };
  };
  const rows = (periods ?? []) as unknown as Period[];
  if (rows.length === 0) return { sent: 0 };

  const owners = [...new Set(rows.map((r) => r.absence.profile_id))];
  const [{ data: guides }, { data: points }, { data: approvers }] = await Promise.all([
    admin.from('guides').select('profile_id').in('profile_id', owners),
    admin.from('guide_points').select('id, guide_id, kind, weekdays, sort_order, deadline').in('guide_id', owners).is('removed_at', null),
    admin.from('absence_approvers').select('profile_id'),
  ]);
  const all = (points ?? []) as { id: string; guide_id: string; kind: 'task' | 'rule'; weekdays: number[]; sort_order: number; deadline: string | null }[];
  const { data: checks } = all.length
    ? await admin.from('guide_checks').select('point_id').in('point_id', all.map((p) => p.id)).eq('check_date', today)
    : { data: [] };
  const checked = (checks ?? []).map((c) => c.point_id);

  let sent = 0;
  for (const g of guides ?? []) {
    const mine = rows.filter((r) => r.absence.profile_id === g.profile_id);
    const open = openCount(pointsOn(all.filter((p) => p.guide_id === g.profile_id), isoWeekday(today)), checked);
    if (open === 0) continue;
    const person = mine[0]!.absence.person;
    const name = person ? person.name || person.email : '';

    for (const kind of clock >= SUMMARY_AT ? (['summary'] as const) : (['remind'] as const)) {
      const { data: claimed } = await admin
        .from('guide_notices')
        .upsert({ guide_id: g.profile_id, notice_date: today, kind }, { onConflict: 'guide_id,notice_date,kind', ignoreDuplicates: true })
        .select('guide_id');
      if (!claimed?.length) continue;
      try {
        if (kind === 'remind') {
          await sendToUsers([...new Set(mine.map((r) => r.coverer_id))], {
            // In Spanish, like every other server-sent notification.
            title: `Guía de ${name}: quedan ${open} punto${open === 1 ? '' : 's'}`,
            body: 'Marca lo que ya hiciste, o «Hoy no aplica».',
            url: `/guide?tab=days&person=${g.profile_id}`,
            tag: `guide-remind-${g.profile_id}-${today}`,
          });
        } else {
          await sendToUsers(
            (approvers ?? []).map((a) => a.profile_id).filter((id) => id !== g.profile_id),
            {
              title: `Cobertura de ${name}: ${open} punto${open === 1 ? '' : 's'} de la guía sin marcar`,
              body: 'Abre la ausencia para ver cuáles.',
              url: `/absences/${mine[0]!.absence_id}#guide`,
              tag: `guide-summary-${g.profile_id}-${today}`,
            },
          );
        }
        sent++;
      } catch (err) {
        console.error('guide notices: send failed', err);
      }
    }
  }
  return { sent };
}
