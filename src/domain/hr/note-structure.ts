/**
 * What a log note must say, per type.
 *
 * A note was once one free text box, and what came out was "se habló de
 * tiempos muertos" — no reason, no agreement, no next step, nobody named. Each
 * type now has its sections, fixed here; the database mirrors the compulsory
 * ones in hr_note_required_sections() and refuses a note without them.
 *
 * Pure: the labels are i18n keys (hrNote.s_<structure>_<key>), the form and
 * the file both read the same list.
 */

export const NOTE_STRUCTURES = ['conversation', 'recognition', 'warning', 'training', 'general'] as const;
export type NoteStructure = (typeof NOTE_STRUCTURES)[number];

export const WARNING_LEVELS = ['verbal', 'written', 'final'] as const;
export type WarningLevel = (typeof WARNING_LEVELS)[number];

export interface NoteSection {
  key: string;
  required: boolean;
  /** A line is enough: who gave it, how long it took. */
  short?: boolean;
}

const all = (...keys: string[]): NoteSection[] => keys.map((key) => ({ key, required: true }));

export const NOTE_SECTIONS: Record<NoteStructure, NoteSection[]> = {
  conversation: all('reason', 'points', 'agreements'),
  recognition: all('what', 'impact', 'why', 'how'),
  warning: all('what', 'rule', 'response', 'agreements', 'consequence'),
  training: [
    { key: 'topic', required: true, short: true },
    { key: 'reason', required: true },
    { key: 'trainer', required: true, short: true },
    { key: 'duration', required: true, short: true },
    { key: 'result', required: true },
  ],
  general: [
    { key: 'reason', required: true },
    { key: 'detail', required: true },
    { key: 'agreements', required: false },
  ],
};

/** required: a follow-up or the reason there is none. none: the type has no follow-up. */
export type FollowUpRule = 'required' | 'optional' | 'none';

export const FOLLOW_UP_RULE: Record<NoteStructure, FollowUpRule> = {
  conversation: 'required',
  recognition: 'none',
  warning: 'required',
  training: 'required',
  general: 'optional',
};

export function isNoteStructure(value: unknown): value is NoteStructure {
  return typeof value === 'string' && (NOTE_STRUCTURES as readonly string[]).includes(value);
}

export interface NoteContent {
  sections: Record<string, string>;
  warning_level: WarningLevel | null;
  follow_up_text: string;
  follow_up_on: string;
  no_follow_up: boolean;
  no_follow_up_reason: string;
}

export const EMPTY_CONTENT: NoteContent = {
  sections: {},
  warning_level: null,
  follow_up_text: '',
  follow_up_on: '',
  no_follow_up: false,
  no_follow_up_reason: '',
};

/**
 * What is still missing before a note of this structure can be saved; empty
 * when it is complete. `from` is the day the follow-up cannot be before.
 */
export function missingContent(structure: NoteStructure, c: NoteContent, from: string): string[] {
  const missing: string[] = NOTE_SECTIONS[structure]
    .filter((s) => s.required && !(c.sections[s.key] ?? '').trim())
    .map((s) => s.key);
  if (structure === 'warning' && !c.warning_level) missing.push('level');

  const rule = FOLLOW_UP_RULE[structure];
  if (rule === 'none') return missing;
  if (c.no_follow_up) {
    if (!c.no_follow_up_reason.trim()) missing.push('no_follow_up_reason');
    return missing;
  }
  const text = !!c.follow_up_text.trim();
  const date = !!c.follow_up_on;
  if (rule === 'optional' && !text && !date) return missing;
  if (!text) missing.push('follow_up_text');
  if (!date || c.follow_up_on < from) missing.push('follow_up_on');
  return missing;
}

/* ------------------------- where a follow-up stands ------------------------ */

export type FollowUpStatus = 'none' | 'open' | 'overdue' | 'closed';

interface FollowUpSource {
  follow_up_on: string | null;
  /** Oldest first. */
  follow_ups: { closes: boolean; next_on: string | null }[];
}

/** The latest entry decides: it closed it, or set the next date. Without entries, the note's own date. */
export function followUpState(note: FollowUpSource, today: string): { status: FollowUpStatus; dueOn: string | null } {
  const last = note.follow_ups[note.follow_ups.length - 1];
  if (last?.closes) return { status: 'closed', dueOn: null };
  const dueOn = last ? last.next_on : note.follow_up_on;
  if (!dueOn) return { status: 'none', dueOn: null };
  return { status: dueOn < today ? 'overdue' : 'open', dueOn };
}

/**
 * Which warning each one is for the worker — 1 for the first ever, counted
 * over the whole file, in the order they happened.
 */
export function warningNumbers(
  notes: { id: string; note_date: string; created_at: string; type: { structure: string } | null }[],
): Map<string, number> {
  const warnings = notes
    .filter((n) => n.type?.structure === 'warning')
    .sort((a, b) => a.note_date.localeCompare(b.note_date) || a.created_at.localeCompare(b.created_at));
  return new Map(warnings.map((n, i) => [n.id, i + 1]));
}
