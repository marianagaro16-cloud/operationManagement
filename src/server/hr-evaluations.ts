import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { businessToday } from '@/lib/datetime';
import type {
  HrEvalAssignment,
  HrEvalItem,
  HrEvalOverview,
  HrEvalRequest,
  HrTranslations,
} from '@/types/hr';

/*
 * Evaluations sent to several people — reads.
 *
 * RLS decides what comes back: whoever sees the file reads the requests and
 * their questions; names and answers come back only for Admin, and for each
 * evaluator their own. Everyone else gets the answers through
 * hr_eval_overview(), combined and without names.
 */

const REQUEST_COLUMNS = 'id, worker_id, worker_name, worker_position, worker_team, deadline, closed_at, created_at';
const ITEM_COLUMNS = 'id, sort_order, kind, criterion_id, name, description, translations';

type RawRequest = Omit<HrEvalRequest, 'open' | 'invited' | 'submitted'>;

function isOpen(r: { closed_at: string | null; deadline: string }): boolean {
  return r.closed_at === null && businessToday() <= r.deadline;
}

function toItems(rows: unknown): HrEvalItem[] {
  return ((rows ?? []) as (HrEvalItem & { translations: HrTranslations | null })[])
    .map((i) => ({ ...i, translations: i.translations ?? {} }))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** A worker's sent evaluations, newest first, with how many have answered. */
export async function getWorkerEvalRequests(workerId: string): Promise<HrEvalRequest[]> {
  const supabase = createClient();
  const [{ data, error }, { data: counts, error: countError }] = await Promise.all([
    supabase
      .from('hr_eval_requests')
      .select(REQUEST_COLUMNS)
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false }),
    supabase.rpc('hr_eval_counts', { p_worker_id: workerId }),
  ]);
  if (error) throw new Error(error.message);
  if (countError) throw new Error(countError.message);

  type Count = { request_id: string; invited: number; submitted: number };
  const byId = new Map(((counts ?? []) as unknown as Count[]).map((c) => [c.request_id, c]));
  return ((data ?? []) as RawRequest[]).map((r) => ({
    ...r,
    open: isOpen(r),
    invited: byId.get(r.id)?.invited ?? 0,
    submitted: byId.get(r.id)?.submitted ?? 0,
  }));
}

export interface HrEvalRequestDetail {
  request: HrEvalRequest;
  items: HrEvalItem[];
  overview: HrEvalOverview;
  /** Each evaluator with their answers — Admin only; null for everyone else. */
  assignments: HrEvalAssignment[] | null;
}

/** One sent evaluation: its questions, the overview, and — for Admin — who answered what. */
export async function getEvalRequest(requestId: string, isAdmin: boolean): Promise<HrEvalRequestDetail | null> {
  const supabase = createClient();
  const { data: request } = await supabase
    .from('hr_eval_requests')
    .select(`${REQUEST_COLUMNS}, items:hr_eval_request_items ( ${ITEM_COLUMNS} )`)
    .eq('id', requestId)
    .maybeSingle();
  if (!request) return null;

  // Not someone who sees the file (an evaluator reading their own request): nothing here for them.
  const { data: overview, error: overviewError } = await supabase.rpc('hr_eval_overview', { p_request_id: requestId });
  if (overviewError) return null;
  const counts = overview as unknown as HrEvalOverview;

  let assignments: HrEvalAssignment[] | null = null;
  if (isAdmin) {
    const { data, error } = await supabase
      .from('hr_eval_assignments')
      .select(`
        id, request_id, evaluator_id, comment, submitted_at, created_at,
        evaluator:profiles!hr_eval_assignments_evaluator_id_fkey ( name, email ),
        answers:hr_eval_answers ( item_id, score, body )
      `)
      .eq('request_id', requestId)
      .order('created_at');
    if (error) throw new Error(error.message);
    assignments = ((data ?? []) as unknown as (Omit<HrEvalAssignment, 'evaluator_name'> & {
      evaluator: { name: string | null; email: string } | null;
    })[]).map(({ evaluator, ...a }) => ({
      ...a,
      evaluator_name: evaluator ? evaluator.name || evaluator.email : null,
      answers: a.answers ?? [],
    }));
  }

  const { items, ...raw } = request as RawRequest & { items: unknown };
  return {
    request: { ...raw, open: isOpen(raw), invited: counts.invited, submitted: counts.submitted },
    items: toItems(items),
    overview: counts,
    assignments,
  };
}

/** An evaluation someone was asked to fill in, with what they have written so far. */
export interface MyEvaluation {
  assignment: HrEvalAssignment;
  request: Omit<HrEvalRequest, 'invited' | 'submitted'>;
  items: HrEvalItem[];
}

type RawMine = Omit<HrEvalAssignment, 'evaluator_name'> & {
  request: RawRequest & { items: unknown };
};

function toMine(row: RawMine): MyEvaluation {
  const { request, ...assignment } = row;
  const { items, ...raw } = request;
  return {
    assignment: { ...assignment, evaluator_name: null, answers: assignment.answers ?? [] },
    request: { ...raw, open: isOpen(raw) },
    items: toItems(items),
  };
}

const MINE_SELECT = `
  id, request_id, evaluator_id, comment, submitted_at,
  answers:hr_eval_answers ( item_id, score, body ),
  request:hr_eval_requests ( ${REQUEST_COLUMNS}, items:hr_eval_request_items ( ${ITEM_COLUMNS} ) )
`;

/** The viewer's own evaluations to fill in, newest first. */
export async function getMyEvaluations(): Promise<MyEvaluation[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('hr_eval_assignments')
    .select(MINE_SELECT)
    .eq('evaluator_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawMine[]).map(toMine);
}

export async function getMyEvaluation(assignmentId: string): Promise<MyEvaluation | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('hr_eval_assignments')
    .select(MINE_SELECT)
    .eq('id', assignmentId)
    .eq('evaluator_id', user.id)
    .maybeSingle();
  return data ? toMine(data as unknown as RawMine) : null;
}

/** Still to be answered, and still open — what the dashboard shows. */
export async function getMyPendingEvaluations(): Promise<MyEvaluation[]> {
  return (await getMyEvaluations()).filter((e) => !e.assignment.submitted_at && e.request.open);
}
