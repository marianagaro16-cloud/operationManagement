import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { SERIES_AHEAD_WEEKS, seriesDates } from '@/domain/meetings/series';
import { sendToUser } from './push';

/**
 * Nightly: every running series has its meetings made 12 weeks ahead, with
 * its invitees. Missing ones only — the unique (series, day) index keeps a
 * meeting that was changed or cancelled on its own from coming back.
 */
export async function ensureMeetingSeries(): Promise<{ made: number }> {
  const admin = createAdminClient();
  const today = businessToday();
  const horizon = DateTime.fromISO(today, { zone: BUSINESS_TZ }).plus({ weeks: SERIES_AHEAD_WEEKS }).toISODate()!;
  const { data: series, error } = await admin
    .from('meeting_series')
    .select('id, organizer_id, title, agenda, place, place_detail, weekday, start_time, end_time, interval_weeks, starts_on, until, invitees:meeting_series_invitees ( profile_id )')
    .is('ended_at', null)
    .or(`until.is.null,until.gte.${today}`);
  if (error) throw new Error(`meeting series: ${error.message}`);

  let made = 0;
  type S = {
    id: string; organizer_id: string; title: string; agenda: string | null; place: string | null; place_detail: string | null;
    weekday: number; start_time: string; end_time: string; interval_weeks: 1 | 2; starts_on: string; until: string | null;
    invitees: { profile_id: string }[];
  };
  for (const s of (series ?? []) as unknown as S[]) {
    const dates = seriesDates(s, today, horizon);
    if (!dates.length) continue;
    const { data: rows, error: insertError } = await admin
      .from('meetings')
      .upsert(
        dates.map((meeting_date) => ({
          series_id: s.id, organizer_id: s.organizer_id, title: s.title, agenda: s.agenda, place: s.place, place_detail: s.place_detail,
          start_time: s.start_time, end_time: s.end_time, meeting_date, created_by: s.organizer_id,
        })),
        { onConflict: 'series_id,meeting_date', ignoreDuplicates: true },
      )
      .select('id');
    if (insertError) throw new Error(`meeting series: ${insertError.message}`);
    const ids = (rows ?? []).map((r) => r.id);
    made += ids.length;
    const people = s.invitees.map((i) => i.profile_id).filter((p) => p !== s.organizer_id);
    if (ids.length && people.length) {
      await admin
        .from('meeting_invitees')
        .upsert(ids.flatMap((meeting_id) => people.map((profile_id) => ({ meeting_id, profile_id }))), { onConflict: 'meeting_id,profile_id', ignoreDuplicates: true });
    }
  }
  return { made };
}

/**
 * "Starts in 15 minutes": to the organiser and every invitee who has not
 * said no, once each. Claimed in the ledger before sending.
 */
export async function runMeetingNotices(now = new Date()): Promise<{ sent: number }> {
  const zurich = DateTime.fromJSDate(now, { zone: BUSINESS_TZ });
  const from = zurich.toFormat('HH:mm');
  const to = zurich.plus({ minutes: 15 }).toFormat('HH:mm');
  if (to < from) return { sent: 0 }; // around midnight: nothing meets then

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('meetings')
    .select('id, organizer_id, title, start_time, place, place_detail, invitees:meeting_invitees ( profile_id, response )')
    .eq('meeting_date', zurich.toISODate()!)
    .eq('status', 'scheduled')
    .gte('start_time', from)
    .lte('start_time', to);
  if (error) throw new Error(`meeting notices: ${error.message}`);

  type M = { id: string; organizer_id: string; title: string; start_time: string; place: string | null; place_detail: string | null; invitees: { profile_id: string; response: string }[] };
  let sent = 0;
  for (const m of (data ?? []) as unknown as M[]) {
    const people = [m.organizer_id, ...m.invitees.filter((i) => i.response !== 'no').map((i) => i.profile_id)];
    for (const profileId of people) {
      const { data: claimed } = await admin
        .from('meeting_notices')
        .upsert({ meeting_id: m.id, profile_id: profileId, kind: 'soon' }, { onConflict: 'meeting_id,profile_id,kind', ignoreDuplicates: true })
        .select('meeting_id');
      if (!claimed?.length) continue;
      try {
        // In Spanish, like every other server-sent notification.
        await sendToUser(profileId, {
          title: `Reunión a las ${m.start_time.slice(0, 5)}`,
          body: [m.title, m.place_detail].filter(Boolean).join(' — '),
          url: m.place === 'online' && m.place_detail?.startsWith('http') ? m.place_detail : `/meetings/${m.id}`,
          tag: `meeting-soon-${m.id}`,
        });
        sent++;
      } catch (err) {
        console.error('meeting notices: send failed', err);
      }
    }
  }
  return { sent };
}
