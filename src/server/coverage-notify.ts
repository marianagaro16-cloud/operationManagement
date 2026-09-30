import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { sendToUser } from './push';

/** The evening before, from this hour, Europe/Zurich. */
const NOTICE_HOUR = 17;

/**
 * "Tomorrow you cover …": once per coverage period, the evening before. The
 * ledger row is claimed before sending, so overlapping runs never send one
 * twice; a period planned after the notice hour still gets it on the next run.
 */
export async function runCoverageNotices(now = new Date()): Promise<{ sent: number }> {
  if (DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).hour < NOTICE_HOUR) return { sent: 0 };
  const tomorrow = DateTime.fromISO(businessToday(), { zone: BUSINESS_TZ }).plus({ days: 1 }).toISODate()!;

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from('coverage_assignments')
    .select('id, absence_id, coverer_id, start_time, end_time, absence:absences!inner ( status, person:profiles!absences_profile_id_fkey ( name, email ) )')
    .eq('cover_date', tomorrow)
    .is('removed_at', null)
    .eq('absence.status', 'approved');
  if (error) throw new Error(`coverage notices: ${error.message}`);

  type Row = {
    id: string;
    absence_id: string;
    coverer_id: string;
    start_time: string;
    end_time: string;
    absence: { person: { name: string | null; email: string } | null } | null;
  };
  let sent = 0;
  for (const r of (rows ?? []) as unknown as Row[]) {
    const { data: claimed } = await admin
      .from('coverage_notices')
      .upsert({ assignment_id: r.id, kind: 'day_before' }, { onConflict: 'assignment_id,kind', ignoreDuplicates: true })
      .select('assignment_id');
    if (!claimed?.length) continue;
    const person = r.absence?.person;
    try {
      await sendToUser(r.coverer_id, {
        // In Spanish, like every other server-sent notification.
        title: 'Mañana cubres una ausencia',
        body: `${person ? person.name || person.email : ''}: ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`,
        url: `/absences/${r.absence_id}`,
        tag: `coverage-tomorrow-${r.id}`,
      });
      sent++;
    } catch (err) {
      console.error('coverage notices: send failed', err);
    }
  }
  return { sent };
}
