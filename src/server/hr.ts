import { createClient } from '@/lib/supabase/server';
import type { BusinessDate } from '@/lib/datetime';
import { HR_BUCKET } from '@/lib/hr';
import type {
  HrCriterion,
  HrEvalTemplate,
  HrEvaluation,
  HrFollowUp,
  HrLateArrival,
  HrLateReason,
  HrNote,
  HrNoteType,
  HrOpenFollowUp,
  HrParticipant,
  HrStats,
  HrTranslations,
  HrWorker,
  HrWorkerFile,
} from '@/types/hr';

/*
 * Human resources reads.
 *
 * Every query runs as the viewer: RLS (hr_can) decides whose files come back,
 * so a Production manager simply receives Production's workers and nothing
 * here has to filter by team.
 */

const WORKER_COLUMNS =
  'id, profile_id, name, team, position, start_date, birth_date, phone, email, address, emergency_contact, is_active, left_on, created_at';

export async function getWorkers(): Promise<HrWorker[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_workers')
    .select(WORKER_COLUMNS)
    .order('is_active', { ascending: false })
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as HrWorker[];
}

const authorName = (p: { name: string | null; email: string } | null) => (p ? p.name || p.email : null);

/** One worker's whole file: who they are, the log, and every evaluation. Null when not theirs to see. */
export async function getWorkerFile(id: string): Promise<HrWorkerFile | null> {
  const supabase = createClient();

  const [{ data: worker }, { data: notes, error: notesError }, { data: evaluations, error: evalError }] =
    await Promise.all([
      supabase.from('hr_workers').select(WORKER_COLUMNS).eq('id', id).maybeSingle(),
      supabase
        .from('hr_notes')
        .select(`
          id, note_date, body, created_at, created_by,
          sections, warning_level, follow_up_text, follow_up_on, no_follow_up_reason,
          type:hr_note_types ( id, name, slug, structure, translations ),
          author:profiles!hr_notes_created_by_fkey ( name, email ),
          attachments:hr_note_attachments ( id, file_name, mime_type, storage_path ),
          participants:hr_note_participants!hr_note_participants_note_id_fkey ( id, followup_id, profile_id, worker_id, name ),
          follow_ups:hr_note_followups (
            id, kind, entry_date, body, sections, warning_level, closes, next_text, next_on, no_follow_up_reason, created_at,
            author:profiles!hr_note_followups_created_by_fkey ( name, email )
          )
        `)
        .eq('worker_id', id)
        .order('note_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('hr_evaluations')
        .select(`
          id, evaluated_on, comment, goals, created_at,
          author:profiles!hr_evaluations_created_by_fkey ( name, email ),
          scores:hr_evaluation_scores ( criterion_name, criterion_translations, score, sort_order, comment )
        `)
        .eq('worker_id', id)
        .order('evaluated_on', { ascending: false })
        .order('created_at', { ascending: false }),
    ]);

  if (!worker) return null;
  if (notesError) throw new Error(notesError.message);
  if (evalError) throw new Error(evalError.message);

  type RawParticipant = HrParticipant & { followup_id: string | null };
  type RawNote = Omit<HrNote, 'author_name' | 'attachments' | 'participants' | 'follow_ups'> & {
    author: { name: string | null; email: string } | null;
    attachments: { id: string; file_name: string; mime_type: string; storage_path: string }[] | null;
    participants: RawParticipant[] | null;
    follow_ups: (Omit<HrFollowUp, 'author_name' | 'participants'> & { author: { name: string | null; email: string } | null })[] | null;
  };
  // Who was there, for the note itself (null) or for one later entry.
  const present = (n: RawNote, followupId: string | null): HrParticipant[] =>
    (n.participants ?? [])
      .filter((p) => p.followup_id === followupId)
      .map(({ id, profile_id, worker_id, name }) => ({ id, profile_id, worker_id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  const rawNotes = (notes ?? []) as unknown as RawNote[];

  // One signing call for every file in the log; links last an hour.
  const paths = rawNotes.flatMap((n) => (n.attachments ?? []).map((a) => a.storage_path));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from(HR_BUCKET).createSignedUrls(paths, 60 * 60);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }

  type RawEvaluation = {
    id: string; evaluated_on: string; comment: string | null; goals: string | null; created_at: string;
    author: { name: string | null; email: string } | null;
    scores: { criterion_name: string; criterion_translations: HrTranslations | null; score: number; sort_order: number; comment: string | null }[] | null;
  };

  return {
    worker: worker as HrWorker,
    notes: rawNotes.map((n) => ({
      id: n.id,
      note_date: n.note_date,
      body: n.body,
      sections: n.sections,
      warning_level: n.warning_level,
      follow_up_text: n.follow_up_text,
      follow_up_on: n.follow_up_on,
      no_follow_up_reason: n.no_follow_up_reason,
      created_at: n.created_at,
      created_by: n.created_by,
      type: n.type,
      author_name: authorName(n.author),
      participants: present(n, null),
      follow_ups: [...(n.follow_ups ?? [])]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(({ author, ...f }) => ({ ...f, author_name: authorName(author), participants: present(n, f.id) })),
      attachments: (n.attachments ?? []).map((a) => ({
        id: a.id,
        file_name: a.file_name,
        mime_type: a.mime_type,
        signed_url: urls.get(a.storage_path) ?? null,
      })),
    })),
    evaluations: ((evaluations ?? []) as unknown as RawEvaluation[]).map((e): HrEvaluation => ({
      id: e.id,
      evaluated_on: e.evaluated_on,
      comment: e.comment,
      goals: e.goals,
      created_at: e.created_at,
      author_name: authorName(e.author),
      scores: [...(e.scores ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order || a.criterion_name.localeCompare(b.criterion_name))
        .map(({ criterion_name, criterion_translations, score, comment }) => ({
          criterion_name,
          criterion_translations: criterion_translations ?? {},
          score,
          comment,
        })),
    })),
  };
}

/**
 * Every note whose follow-up is still open, soonest first — of the files the
 * viewer may open (RLS). The list marks its workers with it; Inicio counts
 * the viewer's own that are due.
 */
export async function getOpenFollowUps(): Promise<HrOpenFollowUp[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_note_follow_up_state')
    .select('note_id, worker_id, created_by, due_on')
    .eq('closed', false)
    .not('due_on', 'is', null)
    .order('due_on');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HrOpenFollowUp[];
}

/** The viewer's own follow-ups due today or before, and whether any is already late. */
export async function countMyFollowUpsDue(profileId: string, today: BusinessDate): Promise<{ count: number; late: boolean }> {
  const supabase = createClient();
  const { data } = await supabase
    .from('hr_note_follow_up_state')
    .select('due_on')
    .eq('closed', false)
    .eq('created_by', profileId)
    .lte('due_on', today);
  const due = (data ?? []) as unknown as { due_on: string }[];
  return { count: due.length, late: due.some((d) => d.due_on < today) };
}

export async function getNoteTypes(includeInactive = false): Promise<HrNoteType[]> {
  const supabase = createClient();
  let query = supabase.from('hr_note_types').select('id, slug, name, structure, translations, sort_order, is_active').order('sort_order');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as HrNoteType[];
}

export async function getCriteria(includeInactive = false): Promise<HrCriterion[]> {
  const supabase = createClient();
  let query = supabase
    .from('hr_criteria')
    .select('id, team, template_id, name, description, translations, sort_order, is_active')
    .order('team')
    .order('sort_order')
    .order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as HrCriterion[];
}

/** What the worker's app account did between two dates; null without an account. */
export async function getWorkerStats(
  workerId: string,
  from: BusinessDate,
  to: BusinessDate,
): Promise<HrStats | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('hr_worker_stats', {
    p_worker_id: workerId,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return (data as HrStats | null) ?? null;
}

/** Evaluation templates: criteria for a job of a team. */
export async function getEvalTemplates(includeInactive = false): Promise<HrEvalTemplate[]> {
  const supabase = createClient();
  let query = supabase
    .from('hr_eval_templates')
    .select('id, team, name, translations, sort_order, is_active')
    .order('team')
    .order('sort_order')
    .order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as HrEvalTemplate[];
}

export async function getLateReasons(includeInactive = false): Promise<HrLateReason[]> {
  const supabase = createClient();
  let query = supabase.from('hr_late_reasons').select('id, slug, name, translations, sort_order, is_active').order('sort_order');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HrLateReason[];
}

/** A worker's late arrivals, newest first. RLS: the file's own access. */
export async function getLateArrivals(workerId: string): Promise<HrLateArrival[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_late_arrivals')
    .select(
      'id, arrival_date, expected_time, arrived_time, minutes_late, kind, minutes_off, excused, notified, note, created_by, created_at, reason:hr_late_reasons ( id, name, translations ), author:profiles!hr_late_arrivals_created_by_fkey ( name, email )',
    )
    .eq('worker_id', workerId)
    .order('arrival_date', { ascending: false })
    .order('arrived_time', { ascending: false });
  if (error) throw new Error(error.message);
  type Raw = Omit<HrLateArrival, 'author_name'> & { author: { name: string | null; email: string } | null };
  return ((data ?? []) as unknown as Raw[]).map(({ author, ...a }) => ({ ...a, author_name: author ? author.name || author.email : null }));
}

/** The arrival settings: Admin's, with their defaults. */
export const HR_ARRIVAL_SETTINGS = {
  hr_late_alert_threshold: 3,
  hr_early_alert_threshold: 3,
  hr_early_tolerance_minutes: 10,
} as const;
export type HrArrivalSetting = keyof typeof HR_ARRIVAL_SETTINGS;

export async function getArrivalSettings(): Promise<Record<HrArrivalSetting, number>> {
  const supabase = createClient();
  const { data } = await supabase.from('app_settings').select('key, value').in('key', Object.keys(HR_ARRIVAL_SETTINGS));
  const out = { ...HR_ARRIVAL_SETTINGS } as Record<HrArrivalSetting, number>;
  for (const row of (data ?? []) as { key: HrArrivalSetting; value: unknown }[]) {
    const n = Number(row.value);
    if (Number.isInteger(n) && n >= 0) out[row.key] = n;
  }
  return out;
}

/** From how many unexcused late arrivals in a month HR is told. */
export async function getLateAlertThreshold(): Promise<number> {
  return (await getArrivalSettings()).hr_late_alert_threshold;
}
