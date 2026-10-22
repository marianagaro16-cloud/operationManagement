/**
 * Start and leaving checklists (2026-10-22). Pure, so the file, the HR list
 * and Inicio agree on what is still open.
 *
 * Some items the app ticks itself from what it already knows — keys, the app
 * account, required trainings. They are never stored as ticked: they read as
 * done while the fact holds, and a hand tick still counts for when the fact
 * does not apply (no key needed, say).
 */

export type ChecklistPhase = 'start' | 'leave';
export type ChecklistAuto = 'keys' | 'account' | 'trainings';

/** Days after the start or the leaving day a list is due. */
export const CHECKLIST_DUE_DAYS: Record<ChecklistPhase, number> = { start: 14, leave: 7 };

/** What the app knows about a worker that some items depend on. */
export interface ChecklistFacts {
  /** Keys they hold now. */
  keysHeld: number;
  /** An app account is linked to the file. */
  accountLinked: boolean;
  /** That account is approved and not removed. */
  accountActive: boolean;
  /** Every training their team requires is done and not expired. */
  trainingsDone: boolean;
}

export interface ChecklistEntryLike {
  auto: ChecklistAuto | null;
  done_at: string | null;
}

/** Whether the fact behind an automatic item holds. */
export function autoDone(auto: ChecklistAuto, phase: ChecklistPhase, facts: ChecklistFacts): boolean {
  switch (auto) {
    case 'keys':
      return phase === 'start' ? facts.keysHeld > 0 : facts.keysHeld === 0;
    case 'account':
      return phase === 'start' ? facts.accountLinked && facts.accountActive : !(facts.accountLinked && facts.accountActive);
    case 'trainings':
      return facts.trainingsDone;
  }
}

/** Done by hand, by the app, or not yet. */
export function entryDone(entry: ChecklistEntryLike, phase: ChecklistPhase, facts: ChecklistFacts): 'hand' | 'app' | null {
  if (entry.done_at) return 'hand';
  if (entry.auto && autoDone(entry.auto, phase, facts)) return 'app';
  return null;
}

export interface ChecklistState {
  total: number;
  open: number;
  /** Items still open after the due day. */
  overdue: boolean;
}

export function checklistState(
  list: { phase: ChecklistPhase; due_on: string },
  entries: ChecklistEntryLike[],
  facts: ChecklistFacts,
  today: string,
): ChecklistState {
  const open = entries.filter((e) => !entryDone(e, list.phase, facts)).length;
  return { total: entries.length, open, overdue: open > 0 && list.due_on < today };
}

/** The day a new list is due: from the start or leaving day when known, else from today. */
export function checklistDue(phase: ChecklistPhase, worker: { start_date: string | null; left_on: string | null }, today: string): string {
  const from = (phase === 'start' ? worker.start_date : worker.left_on) ?? today;
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + CHECKLIST_DUE_DAYS[phase]);
  return d.toISOString().slice(0, 10);
}

/** The items of Admin's list that apply to a worker of this team. */
export function itemsFor<T extends { phase: ChecklistPhase; teams: string[]; is_active: boolean }>(items: T[], phase: ChecklistPhase, team: string): T[] {
  return items.filter((i) => i.is_active && i.phase === phase && (i.teams.length === 0 || i.teams.includes(team)));
}
