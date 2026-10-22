import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { businessToday } from '@/lib/datetime';
import { checklistState, type ChecklistFacts, type ChecklistState } from '@/domain/hr/checklists';
import { requiredTrainings } from '@/domain/hr/trainings';
import type { HrChecklist, HrChecklistItem, HrTraining, HrTrainingKind } from '@/types/hr';
import type { Team } from '@/lib/authz';
import { getTrainingKinds, getTrainings, getWorkers } from './hr';

/*
 * Start and leaving checklists (2026-10-22). Read as the viewer: RLS decides
 * whose lists appear — the files they may open.
 */

const ENTRY_COLUMNS = 'id, name, translations, auto, sort_order, done_at, note, done_by_profile:profiles!hr_checklist_entries_done_by_fkey ( name, email )';

type RawList = Omit<HrChecklist, 'entries'> & {
  entries: (Omit<HrChecklist['entries'][number], 'done_by_name'> & { done_by_profile: { name: string | null; email: string } | null })[];
};

function shape(rows: RawList[]): HrChecklist[] {
  return rows.map((l) => ({
    ...l,
    entries: l.entries
      .map(({ done_by_profile, ...e }) => ({ ...e, done_by_name: done_by_profile ? done_by_profile.name || done_by_profile.email : null }))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
  }));
}

export async function getChecklistItems(includeInactive = false): Promise<HrChecklistItem[]> {
  const supabase = createClient();
  let query = supabase.from('hr_checklist_items').select('id, phase, name, translations, teams, auto, sort_order, is_active').order('phase').order('sort_order');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HrChecklistItem[];
}

/** One worker's lists, Ingreso first. */
export async function getWorkerChecklists(workerId: string): Promise<HrChecklist[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_checklists')
    .select(`id, worker_id, phase, due_on, entries:hr_checklist_entries ( ${ENTRY_COLUMNS} )`)
    .eq('worker_id', workerId)
    .order('phase', { ascending: false });
  if (error) throw new Error(error.message);
  return shape((data ?? []) as unknown as RawList[]);
}

/**
 * What the automatic items depend on, per worker: keys held now (on the file
 * or, for someone with an account, on the account), the account, and the
 * trainings their team requires.
 */
export async function getChecklistFacts(
  workers: { id: string; team: Team; profile_id: string | null }[],
  trainingKinds: HrTrainingKind[],
  trainings: HrTraining[],
  today = businessToday(),
): Promise<Record<string, ChecklistFacts>> {
  if (workers.length === 0) return {};
  const supabase = createClient();
  const profileIds = workers.map((w) => w.profile_id).filter((id): id is string => Boolean(id));
  const [{ data: keys }, { data: profiles }] = await Promise.all([
    supabase.from('hr_keys').select('worker_id, profile_id').is('returned_on', null),
    profileIds.length > 0
      ? supabase.from('profiles').select('id, status, deleted_at').in('id', profileIds)
      : Promise.resolve({ data: [] as { id: string; status: string; deleted_at: string | null }[] }),
  ]);
  const held = (keys ?? []) as { worker_id: string | null; profile_id: string | null }[];
  const accounts = new Map(((profiles ?? []) as { id: string; status: string; deleted_at: string | null }[]).map((p) => [p.id, p]));

  const facts: Record<string, ChecklistFacts> = {};
  for (const w of workers) {
    const account = w.profile_id ? accounts.get(w.profile_id) : undefined;
    facts[w.id] = {
      keysHeld: held.filter((k) => k.worker_id === w.id || (w.profile_id && k.profile_id === w.profile_id)).length,
      accountLinked: Boolean(w.profile_id),
      accountActive: Boolean(account && account.status === 'approved' && !account.deleted_at),
      trainingsDone: requiredTrainings(w, trainingKinds, trainings, today).every((r) => r.status === 'ok' || r.status === 'expiring'),
    };
  }
  return facts;
}

export interface ChecklistSummary extends ChecklistState {
  workerId: string;
  phase: HrChecklist['phase'];
}

/** Every list still open among the files the viewer may open. */
export async function getOpenChecklists(
  workers: { id: string; team: Team; profile_id: string | null }[],
  trainingKinds: HrTrainingKind[],
  trainings: HrTraining[],
): Promise<ChecklistSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('hr_checklists').select('id, worker_id, phase, due_on, entries:hr_checklist_entries ( auto, done_at )');
  if (error) return [];
  const lists = (data ?? []) as unknown as { worker_id: string; phase: HrChecklist['phase']; due_on: string; entries: { auto: HrChecklist['entries'][number]['auto']; done_at: string | null }[] }[];
  const today = businessToday();
  const facts = await getChecklistFacts(workers.filter((w) => lists.some((l) => l.worker_id === w.id)), trainingKinds, trainings, today);
  return lists
    .filter((l) => facts[l.worker_id])
    .map((l) => ({ workerId: l.worker_id, phase: l.phase, ...checklistState(l, l.entries, facts[l.worker_id], today) }))
    .filter((s) => s.open > 0);
}

/** Inicio: lists past their due day with items still open, and whose. */
export async function getOverdueChecklists(): Promise<{ count: number; names: string[] }> {
  const [workers, trainingKinds, trainings] = await Promise.all([getWorkers(), getTrainingKinds(), getTrainings()]);
  const late = (await getOpenChecklists(workers, trainingKinds, trainings)).filter((s) => s.overdue);
  const names = new Map(workers.map((w) => [w.id, w.name]));
  return { count: late.length, names: [...new Set(late.map((s) => names.get(s.workerId) ?? ''))].filter(Boolean) };
}
