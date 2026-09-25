import { createClient } from '@/lib/supabase/server';
import type { BusinessDate } from '@/lib/datetime';
import { HR_BUCKET } from '@/lib/hr';
import type {
  HrCriterion,
  HrEvaluation,
  HrNote,
  HrNoteType,
  HrStats,
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
  'id, profile_id, name, team, position, start_date, phone, email, address, emergency_contact, is_active, left_on, created_at';

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
          id, note_date, body, created_at,
          type:hr_note_types ( id, name, slug ),
          author:profiles!hr_notes_created_by_fkey ( name, email ),
          attachments:hr_note_attachments ( id, file_name, mime_type, storage_path )
        `)
        .eq('worker_id', id)
        .order('note_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('hr_evaluations')
        .select(`
          id, evaluated_on, comment, goals, created_at,
          author:profiles!hr_evaluations_created_by_fkey ( name, email ),
          scores:hr_evaluation_scores ( criterion_name, score, sort_order, comment )
        `)
        .eq('worker_id', id)
        .order('evaluated_on', { ascending: false })
        .order('created_at', { ascending: false }),
    ]);

  if (!worker) return null;
  if (notesError) throw new Error(notesError.message);
  if (evalError) throw new Error(evalError.message);

  type RawNote = {
    id: string; note_date: string; body: string; created_at: string;
    type: HrNote['type'];
    author: { name: string | null; email: string } | null;
    attachments: { id: string; file_name: string; mime_type: string; storage_path: string }[] | null;
  };
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
    scores: { criterion_name: string; score: number; sort_order: number; comment: string | null }[] | null;
  };

  return {
    worker: worker as HrWorker,
    notes: rawNotes.map((n) => ({
      id: n.id,
      note_date: n.note_date,
      body: n.body,
      created_at: n.created_at,
      type: n.type,
      author_name: authorName(n.author),
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
        .map(({ criterion_name, score, comment }) => ({ criterion_name, score, comment })),
    })),
  };
}

export async function getNoteTypes(includeInactive = false): Promise<HrNoteType[]> {
  const supabase = createClient();
  let query = supabase.from('hr_note_types').select('id, slug, name, sort_order, is_active').order('sort_order');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as HrNoteType[];
}

export async function getCriteria(includeInactive = false): Promise<HrCriterion[]> {
  const supabase = createClient();
  let query = supabase
    .from('hr_criteria')
    .select('id, team, name, description, sort_order, is_active')
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
