'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { SERIES_AHEAD_WEEKS, seriesDates, weekdayOf } from '@/domain/meetings/series';
import { DEFAULT_HOURS, coverageConflicts, type WorkingHours } from '@/domain/absences/coverage';
import { sendToUser, sendToUsers } from './push';
import type { ActionResult } from './actions';

/*
 * Meetings writes. Sales, managers, Admin and Owners organise (RLS:
 * can_organize_meetings); the organiser (or Admin) changes and cancels;
 * each invitee answers for themselves.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });
const TIME = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'invalid_time' });
const uuid = z.string().uuid();
const hm = (t: string) => t.slice(0, 5);

const KNOWN = ['not_authorized', 'meeting_invitee_inactive', 'meeting_invitee_is_organizer', 'meetings_times', 'meeting_series_times', 'meeting_series_until'];
function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: KNOWN.find((c) => error.message.includes(c)) ?? error.message };
}
function revalidateMeetings(id?: string) {
  revalidatePath('/meetings');
  if (id) revalidatePath(`/meetings/${id}`);
  revalidatePath('/dashboard');
  revalidatePath('/sales');
}

// In Spanish, like every other server-sent notification.
const dayEs = (d: string) => DateTime.fromISO(d, { zone: BUSINESS_TZ }).setLocale('es').toFormat('cccc d.M.');
const whenEs = (m: { meeting_date: string; start_time: string; end_time: string }) =>
  `${dayEs(m.meeting_date)} ${hm(m.start_time)}–${hm(m.end_time)}`;

async function tell(people: string[], title: string, body: string, url: string, tag: string) {
  if (!people.length) return;
  try {
    await sendToUsers(people, { title, body, url, tag });
  } catch (err) {
    console.error('meeting notice failed', err);
  }
}

const meetingSchema = z
  .object({
    title: z.string().trim().min(1, { message: 'title_required' }).max(200),
    agenda: z.string().trim().max(5000).nullable().optional().transform((v) => v || null),
    place: z.enum(['office', 'online', 'other']).nullable().optional().transform((v) => v ?? null),
    place_detail: z.string().trim().max(500).nullable().optional().transform((v) => v || null),
    meeting_date: DATE,
    start_time: TIME,
    end_time: TIME,
    invitees: z.array(uuid).max(60),
    /** Repeats: every one or two weeks on this weekday, maybe until a day. Only when creating or changing a series. */
    repeat: z
      .object({ interval_weeks: z.union([z.literal(1), z.literal(2)]), until: DATE.nullable().optional().transform((v) => v ?? null) })
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  })
  .refine((m) => hm(m.end_time) > hm(m.start_time), { message: 'meetings_times' })
  .refine((m) => !m.repeat?.until || m.repeat.until >= m.meeting_date, { message: 'meeting_series_until' });

export type MeetingInput = z.input<typeof meetingSchema>;

type Fields = { title: string; agenda: string | null; place: 'office' | 'online' | 'other' | null; place_detail: string | null; start_time: string; end_time: string };

/** A series' meetings from a day on, made where missing, with its invitees. */
async function fillSeries(seriesId: string, organizerId: string, fields: Fields, rule: { weekday: number; interval_weeks: 1 | 2; starts_on: string; until: string | null }, from: string, invitees: string[]) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const horizon = DateTime.fromISO(businessToday(), { zone: BUSINESS_TZ }).plus({ weeks: SERIES_AHEAD_WEEKS }).toISODate()!;
  const dates = seriesDates(rule, from, horizon);
  if (!dates.length) return { ok: true as const };
  const { data: made, error } = await supabase
    .from('meetings')
    .upsert(
      dates.map((meeting_date) => ({ ...fields, series_id: seriesId, organizer_id: organizerId, meeting_date, created_by: user?.id ?? null })),
      { onConflict: 'series_id,meeting_date', ignoreDuplicates: true },
    )
    .select('id');
  if (error) return fail(error);
  const ids = (made ?? []).map((m) => m.id);
  if (ids.length && invitees.length) {
    const { error: inviteError } = await supabase
      .from('meeting_invitees')
      .upsert(ids.flatMap((meeting_id) => invitees.map((profile_id) => ({ meeting_id, profile_id }))), { onConflict: 'meeting_id,profile_id', ignoreDuplicates: true });
    if (inviteError) return fail(inviteError);
  }
  return { ok: true as const };
}

/** Plan a meeting — once, or repeating. The invitees are told. */
export async function createMeeting(input: MeetingInput): Promise<ActionResult<{ id: string }>> {
  const parsed = meetingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_meeting' };
  const { invitees: rawInvitees, repeat, meeting_date, ...fields } = parsed.data;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };
  const invitees = [...new Set(rawInvitees)].filter((id) => id !== user.id);
  const { data: me } = await supabase.from('profiles').select('name, email').eq('id', user.id).maybeSingle();
  const organizer = me ? me.name || me.email : '';

  if (!repeat) {
    const { data, error } = await supabase
      .from('meetings')
      .insert({ ...fields, meeting_date, organizer_id: user.id, created_by: user.id })
      .select('id')
      .single();
    if (error) return fail(error);
    const id = (data as { id: string }).id;
    if (invitees.length) {
      const { error: inviteError } = await supabase.from('meeting_invitees').insert(invitees.map((profile_id) => ({ meeting_id: id, profile_id })));
      if (inviteError) return fail(inviteError);
    }
    await tell(invitees, 'Te invitaron a una reunión', `${fields.title} — ${whenEs({ meeting_date, ...fields })} (${organizer})`, `/meetings/${id}`, `meeting-${id}`);
    revalidateMeetings();
    return { ok: true, data: { id } };
  }

  const rule = { weekday: weekdayOf(meeting_date), interval_weeks: repeat.interval_weeks, starts_on: meeting_date, until: repeat.until };
  const { data: series, error } = await supabase
    .from('meeting_series')
    .insert({ ...fields, ...rule, organizer_id: user.id, created_by: user.id })
    .select('id')
    .single();
  if (error) return fail(error);
  const seriesId = (series as { id: string }).id;
  if (invitees.length) {
    const { error: inviteError } = await supabase.from('meeting_series_invitees').insert(invitees.map((profile_id) => ({ series_id: seriesId, profile_id })));
    if (inviteError) return fail(inviteError);
  }
  const filled = await fillSeries(seriesId, user.id, fields, rule, meeting_date, invitees);
  if (!filled.ok) return filled;
  const { data: first } = await supabase.from('meetings').select('id').eq('series_id', seriesId).order('meeting_date').limit(1).maybeSingle();
  const every = repeat.interval_weeks === 1 ? 'cada semana' : 'cada dos semanas';
  await tell(
    invitees,
    'Te invitaron a una reunión',
    `${fields.title} — ${every}, ${DateTime.fromISO(meeting_date, { zone: BUSINESS_TZ }).setLocale('es').toFormat('cccc')} ${hm(fields.start_time)}–${hm(fields.end_time)} (${organizer})`,
    first ? `/meetings/${first.id}` : '/meetings',
    `meeting-series-${seriesId}`,
  );
  revalidateMeetings();
  return { ok: true, data: { id: first?.id ?? '' } };
}

/**
 * Change one meeting — its own copy from now on, even in a series — and who
 * is invited. The added and the removed are told; if it moved, the rest too.
 */
export async function updateMeeting(id: string, input: MeetingInput): Promise<ActionResult> {
  const parsed = meetingSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return { ok: false, error: parsed.error?.issues[0]?.message ?? 'invalid_meeting' };
  const { invitees: rawInvitees, repeat: _repeat, ...fields } = parsed.data;
  const supabase = createClient();
  const { data: before } = await supabase
    .from('meetings')
    .select('organizer_id, series_id, meeting_date, start_time, end_time, place, place_detail, title, invitees:meeting_invitees ( profile_id )')
    .eq('id', id)
    .maybeSingle();
  if (!before) return { ok: false, error: 'not_authorized' };
  const b = before as unknown as {
    organizer_id: string; series_id: string | null; meeting_date: string; start_time: string; end_time: string;
    place: string | null; place_detail: string | null; title: string; invitees: { profile_id: string }[];
  };
  const { data: changed, error } = await supabase
    .from('meetings')
    .update({ ...fields, detached: b.series_id !== null })
    .eq('id', id)
    .select('id');
  if (error) return fail(error);
  if (!changed?.length) return { ok: false, error: 'not_authorized' };

  const invitees = [...new Set(rawInvitees)].filter((p) => p !== b.organizer_id);
  const had = b.invitees.map((i) => i.profile_id);
  const added = invitees.filter((p) => !had.includes(p));
  const removed = had.filter((p) => !invitees.includes(p));
  if (removed.length) {
    const { error: e } = await supabase.from('meeting_invitees').delete().eq('meeting_id', id).in('profile_id', removed);
    if (e) return fail(e);
  }
  if (added.length) {
    const { error: e } = await supabase.from('meeting_invitees').insert(added.map((profile_id) => ({ meeting_id: id, profile_id })));
    if (e) return fail(e);
  }
  const when = whenEs(fields);
  await tell(added, 'Te invitaron a una reunión', `${fields.title} — ${when}`, `/meetings/${id}`, `meeting-${id}`);
  await tell(removed, 'Ya no estás en una reunión', `${b.title} — ${whenEs(b)}`, '/meetings', `meeting-${id}`);
  const moved =
    b.meeting_date !== fields.meeting_date || hm(b.start_time) !== hm(fields.start_time) || hm(b.end_time) !== hm(fields.end_time) ||
    b.place !== fields.place || (b.place_detail ?? null) !== fields.place_detail;
  if (moved) {
    await tell(invitees.filter((p) => had.includes(p)), 'Reunión cambiada', `${fields.title} — ${when}`, `/meetings/${id}`, `meeting-${id}`);
  }
  revalidateMeetings(id);
  return { ok: true, data: undefined };
}

/**
 * Change a series from today on: its meetings still ahead that nobody changed
 * on their own are made again to the new rule; the invitees are told once.
 */
export async function updateSeries(seriesId: string, input: MeetingInput): Promise<ActionResult> {
  const parsed = meetingSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(seriesId).success) return { ok: false, error: parsed.error?.issues[0]?.message ?? 'invalid_meeting' };
  const { invitees: rawInvitees, repeat, meeting_date, ...fields } = parsed.data;
  const supabase = createClient();
  const { data: series } = await supabase.from('meeting_series').select('organizer_id, interval_weeks, until').eq('id', seriesId).maybeSingle();
  if (!series) return { ok: false, error: 'not_authorized' };
  const today = businessToday();
  const from = meeting_date > today ? meeting_date : today;
  const rule = {
    weekday: weekdayOf(meeting_date),
    interval_weeks: (repeat?.interval_weeks ?? series.interval_weeks) as 1 | 2,
    starts_on: meeting_date,
    until: repeat ? repeat.until : series.until,
  };
  const { error } = await supabase.from('meeting_series').update({ ...fields, ...rule }).eq('id', seriesId);
  if (error) return fail(error);

  const invitees = [...new Set(rawInvitees)].filter((p) => p !== series.organizer_id);
  const { data: had } = await supabase.from('meeting_series_invitees').select('profile_id').eq('series_id', seriesId);
  const before = (had ?? []).map((r) => r.profile_id);
  const removed = before.filter((p) => !invitees.includes(p));
  const added = invitees.filter((p) => !before.includes(p));
  if (removed.length) await supabase.from('meeting_series_invitees').delete().eq('series_id', seriesId).in('profile_id', removed);
  if (added.length) await supabase.from('meeting_series_invitees').insert(added.map((profile_id) => ({ series_id: seriesId, profile_id })));

  // What is still ahead and untouched gives way, and is made again.
  const { error: dropError } = await supabase
    .from('meetings')
    .delete()
    .eq('series_id', seriesId)
    .eq('detached', false)
    .is('minutes', null)
    .gte('meeting_date', today);
  if (dropError) return fail(dropError);
  const filled = await fillSeries(seriesId, series.organizer_id, fields, rule, from, invitees);
  if (!filled.ok) return filled;

  await tell([...new Set([...invitees, ...removed])], 'Reunión cambiada', `${fields.title} — a partir del ${dayEs(from)}, ${hm(fields.start_time)}–${hm(fields.end_time)}`, '/meetings', `meeting-series-${seriesId}`);
  revalidateMeetings();
  return { ok: true, data: undefined };
}

/** Cancel one meeting; the invitees are told. It stays, cancelled. */
export async function cancelMeeting(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('meetings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: user?.id ?? null, detached: true })
    .eq('id', id)
    .eq('status', 'scheduled')
    .select('title, meeting_date, start_time, end_time, invitees:meeting_invitees ( profile_id )');
  if (error) return fail(error);
  const m = data?.[0] as unknown as { title: string; meeting_date: string; start_time: string; end_time: string; invitees: { profile_id: string }[] } | undefined;
  if (!m) return { ok: false, error: 'not_authorized' };
  await tell(m.invitees.map((i) => i.profile_id), 'Reunión cancelada', `${m.title} — ${whenEs(m)}`, `/meetings/${id}`, `meeting-${id}`);
  revalidateMeetings(id);
  return { ok: true, data: undefined };
}

/** End a series: no more meetings from today on; the invitees are told. */
export async function endSeries(seriesId: string): Promise<ActionResult> {
  const supabase = createClient();
  const today = businessToday();
  const yesterday = DateTime.fromISO(today, { zone: BUSINESS_TZ }).minus({ days: 1 }).toISODate()!;
  const { data: s, error } = await supabase
    .from('meeting_series')
    .update({ ended_at: new Date().toISOString(), until: yesterday })
    .eq('id', seriesId)
    .select('title, starts_on')
    .maybeSingle();
  if (error) {
    // A series that has not met yet cannot end before it starts: then it ends on its first day.
    if (!error.message.includes('meeting_series_until')) return fail(error);
    await supabase.from('meeting_series').update({ ended_at: new Date().toISOString() }).eq('id', seriesId);
  }
  if (!s && !error) return { ok: false, error: 'not_authorized' };
  const { data: ahead } = await supabase
    .from('meetings')
    .select('id, invitees:meeting_invitees ( profile_id )')
    .eq('series_id', seriesId)
    .eq('status', 'scheduled')
    .gte('meeting_date', today);
  const people = [...new Set(((ahead ?? []) as unknown as { invitees: { profile_id: string }[] }[]).flatMap((m) => m.invitees.map((i) => i.profile_id)))];
  // Ahead and untouched: gone. Changed on their own: cancelled, and kept.
  await supabase.from('meetings').delete().eq('series_id', seriesId).eq('detached', false).is('minutes', null).gte('meeting_date', today);
  await supabase
    .from('meetings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('series_id', seriesId)
    .eq('status', 'scheduled')
    .gte('meeting_date', today);
  await tell(people, 'Reunión periódica terminada', s?.title ?? '', '/meetings', `meeting-series-${seriesId}`);
  revalidateMeetings();
  return { ok: true, data: undefined };
}

/** Attending or not, with an optional word. Saying no tells the organiser. */
export async function answerMeeting(id: string, response: 'yes' | 'no', note: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };
  const { data, error } = await supabase
    .from('meeting_invitees')
    .update({ response, note: note.trim().slice(0, 300) || null, responded_at: new Date().toISOString() })
    .eq('meeting_id', id)
    .eq('profile_id', user.id)
    .select('meeting_id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  if (response === 'no') {
    const [{ data: m }, { data: me }] = await Promise.all([
      supabase.from('meetings').select('organizer_id, title, meeting_date, start_time, end_time').eq('id', id).maybeSingle(),
      supabase.from('profiles').select('name, email').eq('id', user.id).maybeSingle(),
    ]);
    if (m) {
      try {
        await sendToUser(m.organizer_id, {
          title: 'No puede asistir',
          body: `${me ? me.name || me.email : ''}: ${m.title} — ${whenEs(m)}${note.trim() ? ` («${note.trim()}»)` : ''}`,
          url: `/meetings/${id}`,
          tag: `meeting-answer-${id}-${user.id}`,
        });
      } catch (err) {
        console.error('meeting notice failed', err);
      }
    }
  }
  revalidateMeetings(id);
  return { ok: true, data: undefined };
}

/** The minutes, by the organiser (or Admin); the invitees are told the first time. */
export async function saveMinutes(id: string, minutes: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: before } = await supabase.from('meetings').select('minutes, title, meeting_date, invitees:meeting_invitees ( profile_id )').eq('id', id).maybeSingle();
  if (!before) return { ok: false, error: 'not_authorized' };
  const text = minutes.trim().slice(0, 20000) || null;
  const { data, error } = await supabase
    .from('meetings')
    .update({ minutes: text, minutes_at: text ? new Date().toISOString() : null, minutes_by: text ? user?.id ?? null : null })
    .eq('id', id)
    .select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  const b = before as unknown as { minutes: string | null; title: string; meeting_date: string; invitees: { profile_id: string }[] };
  if (text && !b.minutes) {
    await tell(b.invitees.map((i) => i.profile_id), 'Acta de reunión', `${b.title} — ${dayEs(b.meeting_date)}`, `/meetings/${id}`, `meeting-minutes-${id}`);
  }
  revalidateMeetings(id);
  return { ok: true, data: undefined };
}

export interface MeetingConflict {
  profile_id: string;
  name: string;
  kind: 'activity' | 'meeting' | 'absence';
  /** The activity's kind or the other meeting's title; nothing for an absence. */
  label: string | null;
  start: string | null;
  end: string | null;
}

/**
 * Who is busy then: a sales activity, another meeting, or away. Warnings for
 * the organiser before saving — never a refusal.
 */
export async function checkMeetingConflicts(input: {
  date: string;
  start: string;
  end: string;
  people: string[];
  excludeId?: string | null;
}): Promise<ActionResult<MeetingConflict[]>> {
  const parsed = z
    .object({ date: DATE, start: TIME, end: TIME, people: z.array(uuid).max(60), excludeId: uuid.nullable().optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_meeting' };
  const v = parsed.data;
  if (!v.people.length || hm(v.end) <= hm(v.start)) return { ok: true, data: [] };
  const supabase = createClient();
  const [{ data, error }, { data: names }, { data: settings }] = await Promise.all([
    supabase.rpc('meeting_conflicts', { p_people: v.people, p_date: v.date, p_start: v.start, p_end: v.end, p_exclude: v.excludeId ?? undefined }),
    supabase.from('profiles').select('id, name, email').in('id', v.people),
    supabase.from('app_settings').select('value').eq('key', 'absences.hours').maybeSingle(),
  ]);
  if (error) return fail(error);
  const nameOf = new Map((names ?? []).map((p) => [p.id, p.name || p.email]));
  const hours = { ...DEFAULT_HOURS, ...((settings?.value as Partial<WorkingHours> | undefined) ?? {}) };
  type Row = {
    profile_id: string; kind: MeetingConflict['kind']; label: string | null; start_time: string | null; end_time: string | null;
    start_date: string | null; end_date: string | null; first_day: 'full' | 'afternoon' | null; last_day: 'full' | 'morning' | null;
  };
  const out: MeetingConflict[] = [];
  for (const r of (data ?? []) as Row[]) {
    if (r.kind === 'absence') {
      // Away then? Its hours decide — someone away only in the morning can meet in the afternoon.
      const span = { start_date: r.start_date!, end_date: r.end_date!, first_day: r.first_day ?? 'full', last_day: r.last_day ?? 'full', start_time: r.start_time, end_time: r.end_time };
      if (!coverageConflicts({ date: v.date, start: hm(v.start), end: hm(v.end) }, [span], [], hours).length) continue;
      out.push({ profile_id: r.profile_id, name: nameOf.get(r.profile_id) ?? '—', kind: 'absence', label: null, start: null, end: null });
    } else {
      out.push({
        profile_id: r.profile_id,
        name: nameOf.get(r.profile_id) ?? '—',
        kind: r.kind,
        label: r.label,
        start: r.start_time ? hm(r.start_time) : null,
        end: r.end_time ? hm(r.end_time) : null,
      });
    }
  }
  return { ok: true, data: out.sort((a, b) => a.name.localeCompare(b.name)) };
}
