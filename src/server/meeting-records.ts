import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { MeetingAgreement, MeetingRecord, MeetingRecordEntry, MeetingRecordPoint } from '@/types/meetings';

/*
 * Reads of a meeting's record for the workers' files. RLS gives it to whoever
 * sees the meeting and, once registered, to whoever may open the file of one
 * of its attendees — so a file is read here without the meeting itself.
 */

const COLUMNS = `
  meeting_id, title, meeting_date, start_time, end_time, place, place_detail, organizer_id, organizer_name,
  follow_up_on, registered_at,
  registrar:profiles!meeting_records_registered_by_fkey ( name, email ),
  attendees:meeting_attendees ( id, profile_id, worker_id, name ),
  points:meeting_record_points (
    id, sort_order, title, topic, situation, discussed, no_agreements_reason,
    agreements:meeting_record_agreements!meeting_record_agreements_point_id_fkey (
      id, sort_order, body, responsible_all, responsible_profile_id, responsible_worker_id, responsible_name, due_on,
      results:meeting_agreement_results ( entry_id, result, comment )
    )
  ),
  entries:meeting_record_entries (
    id, kind, entry_date, body, closes, next_on, created_at,
    author:profiles!meeting_record_entries_created_by_fkey ( name, email )
  )
`;

type Person = { name: string | null; email: string } | null;
const nameOf = (p: Person) => (p ? p.name || p.email : null);

type Raw = Omit<MeetingRecord, 'registered_by_name' | 'points' | 'entries'> & {
  registrar: Person;
  points: (Omit<MeetingRecordPoint, 'agreements'> & { sort_order: number; agreements: (MeetingAgreement & { sort_order: number })[] | null })[] | null;
  entries: (Omit<MeetingRecordEntry, 'author_name'> & { author: Person })[] | null;
};

function toRecord({ registrar, points, entries, attendees, ...r }: Raw): MeetingRecord {
  const sortedEntries = [...(entries ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const when = new Map(sortedEntries.map((e) => [e.id, e.created_at]));
  return {
    ...r,
    registered_by_name: nameOf(registrar),
    attendees: [...(attendees ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    points: [...(points ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ sort_order: _order, agreements, ...p }) => ({
        ...p,
        agreements: [...(agreements ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(({ sort_order: _n, results, ...a }) => ({
            ...a,
            // In the order of the follow-ups that gave them.
            results: [...(results ?? [])].sort((x, y) => (when.get(x.entry_id) ?? '').localeCompare(when.get(y.entry_id) ?? '')),
          })),
      })),
    entries: sortedEntries.map(({ author, ...e }) => ({ ...e, author_name: nameOf(author) })),
  };
}

/** A meeting's record, draft or registered; null when it has none. */
export async function getMeetingRecord(meetingId: string): Promise<MeetingRecord | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from('meeting_records').select(COLUMNS).eq('meeting_id', meetingId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toRecord(data as unknown as Raw) : null;
}

/** The registered meetings a worker attended, latest first — for their file. */
export async function getWorkerMeetingRecords(workerId: string): Promise<MeetingRecord[]> {
  const supabase = createClient();
  const { data: attended, error: attendedError } = await supabase.from('meeting_attendees').select('meeting_id').eq('worker_id', workerId);
  if (attendedError) throw new Error(attendedError.message);
  const ids = [...new Set((attended ?? []).map((a) => a.meeting_id as string))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('meeting_records')
    .select(COLUMNS)
    .in('meeting_id', ids)
    .not('registered_at', 'is', null)
    .order('meeting_date', { ascending: false })
    .order('start_time', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Raw[]).map(toRecord);
}

export interface MeetingRecordWork {
  /** Meetings for the files the viewer organised, held and not yet registered; late after two days. */
  toRegister: { count: number; late: boolean; first: string | null };
  /** Follow-ups of registered meetings the viewer organised, due today or before. */
  followUps: { count: number; late: boolean; first: string | null };
}

/** What the viewer still owes on the meetings they organised. A record is late two days after the meeting. */
export async function getMeetingRecordWork(profileId: string, today: string): Promise<MeetingRecordWork> {
  const supabase = createClient();
  const lateBefore = new Date(Date.parse(`${today}T12:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: held }, { data: due }] = await Promise.all([
    supabase
      .from('meetings')
      .select('id, meeting_date, record:meeting_records ( registered_at )')
      .eq('organizer_id', profileId)
      .eq('hr_record', true)
      .eq('status', 'scheduled')
      .lt('meeting_date', today)
      .order('meeting_date'),
    supabase
      .from('meeting_record_follow_up_state')
      .select('meeting_id, due_on')
      .eq('organizer_id', profileId)
      .eq('closed', false)
      .lte('due_on', today)
      .order('due_on'),
  ]);
  type Held = { id: string; meeting_date: string; record: { registered_at: string | null } | { registered_at: string | null }[] | null };
  const open = ((held ?? []) as unknown as Held[]).filter((m) => {
    const record = Array.isArray(m.record) ? m.record[0] : m.record;
    return !record?.registered_at;
  });
  const followUps = (due ?? []) as unknown as { meeting_id: string; due_on: string }[];
  return {
    toRegister: { count: open.length, late: open.some((m) => m.meeting_date <= lateBefore), first: open[0]?.id ?? null },
    followUps: { count: followUps.length, late: followUps.some((f) => f.due_on < today), first: followUps[0]?.meeting_id ?? null },
  };
}
