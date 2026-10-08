/**
 * What a log note must say, per type.
 *
 * A note was once one free text box, and what came out was "se habló de
 * tiempos muertos" — no reason, no agreement, no next step, nobody named. Each
 * type now has its sections, fixed here; the database mirrors the compulsory
 * ones in hr_note_required_sections() and refuses a note without them.
 *
 * Beyond the sections a note says what it is about (one topic), when and where
 * it happened (a conversation and a warning), and what was agreed as separate
 * items — what, who, by when — that a follow-up marks one by one.
 *
 * A conversation says who asked for it. Asked by the employee it takes its
 * own form — 'employee_talk': what they raised and what was answered, topics
 * of its own, agreements only if there are any — and can be marked
 * confidential: read only by whoever wrote it, Admin and the Owners (the
 * database's rule: hr_can_note()).
 *
 * Pure: the labels are i18n keys (hrNote.s_<form>_<key>), the form and
 * the file both read the same list.
 */

export const NOTE_STRUCTURES = ['conversation', 'recognition', 'warning', 'training', 'general'] as const;
export type NoteStructure = (typeof NOTE_STRUCTURES)[number];

/** Who asked for a conversation. */
export const ASKED_BY = ['company', 'employee'] as const;
export type AskedBy = (typeof ASKED_BY)[number];

/** What a note is written in: its type's structure, or the form of a conversation the employee asked for. */
export type NoteForm = NoteStructure | 'employee_talk';

export function noteForm(structure: NoteStructure, askedBy: AskedBy | null | undefined): NoteForm {
  return structure === 'conversation' && askedBy === 'employee' ? 'employee_talk' : structure;
}

/** Only a conversation the employee asked for can be confidential. */
export function mayBeConfidential(structure: NoteStructure, askedBy: AskedBy | null | undefined): boolean {
  return noteForm(structure, askedBy) === 'employee_talk';
}

export const WARNING_LEVELS = ['verbal', 'written', 'final'] as const;
export type WarningLevel = (typeof WARNING_LEVELS)[number];

/** What a note is mainly about. Fixed; mirrored in hr_note_topics(). */
export const NOTE_TOPICS = [
  'punctuality', 'quality', 'hygiene_safety', 'attitude', 'productivity', 'teamwork', 'rules', 'other',
] as const;
/** What an employee comes to talk about. Fixed; mirrored in hr_note_employee_topics(). */
export const EMPLOYEE_TOPICS = [
  'pay_conditions', 'schedule_leave', 'workload', 'conflict', 'growth', 'complaint', 'idea', 'personal', 'other',
] as const;
/** The topics the company raises: a note it starts, a point of a team meeting. */
export type CompanyTopic = (typeof NOTE_TOPICS)[number];
export type NoteTopic = CompanyTopic | (typeof EMPLOYEE_TOPICS)[number];
/** Every topic a note can have, the company's first; 'other' is in both lists. */
export const ALL_TOPICS: NoteTopic[] = [...NOTE_TOPICS.filter((topic) => topic !== 'other'), ...EMPLOYEE_TOPICS];

/** The topics a form offers. */
export function formTopics(form: NoteForm): readonly NoteTopic[] {
  return form === 'employee_talk' ? EMPLOYEE_TOPICS : NOTE_TOPICS;
}

export const AGREEMENT_RESULTS = ['met', 'partly', 'not_met'] as const;
export type AgreementResult = (typeof AGREEMENT_RESULTS)[number];
/** pending: no follow-up has checked it yet. */
export type AgreementStatus = AgreementResult | 'pending';

export interface NoteSection {
  key: string;
  required: boolean;
  /** A line is enough: who gave it, how long it took. */
  short?: boolean;
  /** No longer asked for — agreements are items now — but still shown where a note has it. */
  legacy?: boolean;
}

const all = (...keys: string[]): NoteSection[] => keys.map((key) => ({ key, required: true }));
const formerAgreements: NoteSection = { key: 'agreements', required: false, legacy: true };

export const NOTE_SECTIONS: Record<NoteForm, NoteSection[]> = {
  conversation: [...all('reason', 'points'), formerAgreements],
  employee_talk: all('raised', 'answered'),
  recognition: all('what', 'impact', 'why', 'how'),
  warning: [...all('what', 'rule', 'response'), formerAgreements, ...all('consequence')],
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
    formerAgreements,
  ],
};

/** required: a follow-up or the reason there is none. none: the type has no follow-up. */
export type FollowUpRule = 'required' | 'optional' | 'none';

export const FOLLOW_UP_RULE: Record<NoteForm, FollowUpRule> = {
  conversation: 'required',
  // Nothing they asked for is left without a next step, or the reason there is none.
  employee_talk: 'required',
  recognition: 'none',
  warning: 'required',
  training: 'required',
  general: 'optional',
};

/** required: at least one agreement. none: the type has none. */
export const AGREEMENTS_RULE: Record<NoteForm, FollowUpRule> = {
  conversation: 'required',
  employee_talk: 'optional',
  recognition: 'none',
  warning: 'required',
  training: 'none',
  general: 'optional',
};

/** A conversation and a warning are about one moment: day, time and area. */
export const HAS_EVENT: Record<NoteForm, boolean> = {
  conversation: true,
  employee_talk: true,
  recognition: false,
  warning: true,
  training: false,
  general: false,
};

export function isNoteStructure(value: unknown): value is NoteStructure {
  return typeof value === 'string' && (NOTE_STRUCTURES as readonly string[]).includes(value);
}

export interface NotePerson {
  profile_id: string | null;
  worker_id: string | null;
  name: string;
}

/** One agreement as it is being written. */
export interface AgreementDraft {
  body: string;
  responsible: NotePerson | null;
  /** Empty: the day of the follow-up. */
  due_on: string;
}

export interface NoteContent {
  /** Who asked to talk; read for a conversation only. */
  asked_by: AskedBy;
  /** Read only by whoever writes it, Admin and the Owners; only when the employee asked. */
  confidential: boolean;
  sections: Record<string, string>;
  warning_level: WarningLevel | null;
  topic: NoteTopic | null;
  event_on: string;
  event_time: string;
  event_area: string;
  agreements: AgreementDraft[];
  follow_up_text: string;
  follow_up_on: string;
  no_follow_up: boolean;
  no_follow_up_reason: string;
}

export const EMPTY_CONTENT: NoteContent = {
  asked_by: 'company',
  confidential: false,
  sections: {},
  warning_level: null,
  topic: null,
  event_on: '',
  event_time: '',
  event_area: '',
  agreements: [],
  follow_up_text: '',
  follow_up_on: '',
  no_follow_up: false,
  no_follow_up_reason: '',
};

/** The agreements a note of this structure carries: the rows that say something. */
export function filledAgreements(structure: NoteForm, c: NoteContent): AgreementDraft[] {
  if (AGREEMENTS_RULE[structure] === 'none') return [];
  return c.agreements
    .filter((a) => a.body.trim())
    .map((a) => ({ ...a, due_on: a.due_on || c.follow_up_on }));
}

/** "No follow-up needed" — only without agreements, which a follow-up has to check. */
export function skipsFollowUp(structure: NoteForm, c: NoteContent): boolean {
  return FOLLOW_UP_RULE[structure] !== 'none' && c.no_follow_up && filledAgreements(structure, c).length === 0;
}

/**
 * What is still missing before a note of this structure can be saved; empty
 * when it is complete. `from` is the day of the note: what happened cannot be
 * after it, the follow-up and the agreements cannot be before.
 */
export function missingContent(structure: NoteForm, c: NoteContent, from: string): string[] {
  const missing: string[] = [];
  if (!c.topic || !formTopics(structure).includes(c.topic)) missing.push('topic');
  if (HAS_EVENT[structure]) {
    if (!c.event_on || c.event_on > from) missing.push('event_on');
    if (!c.event_time) missing.push('event_time');
    if (!c.event_area) missing.push('event_area');
  }
  if (structure === 'warning' && !c.warning_level) missing.push('level');
  missing.push(
    ...NOTE_SECTIONS[structure]
      .filter((s) => s.required && !(c.sections[s.key] ?? '').trim())
      .map((s) => s.key),
  );

  const agreements = filledAgreements(structure, c);
  if (
    (AGREEMENTS_RULE[structure] === 'required' && agreements.length === 0) ||
    agreements.some((a) => !a.responsible || !a.due_on || a.due_on < from)
  ) {
    missing.push('agreements');
  }

  const rule = FOLLOW_UP_RULE[structure];
  if (rule === 'none') return missing;
  if (skipsFollowUp(structure, c)) {
    if (!c.no_follow_up_reason.trim()) missing.push('no_follow_up_reason');
    return missing;
  }
  const text = !!c.follow_up_text.trim();
  const date = !!c.follow_up_on;
  if (rule === 'optional' && agreements.length === 0 && !text && !date) return missing;
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

/* ------------------------------- agreements ------------------------------- */

/** Where an agreement stands: what the latest follow-up said of it. `results` oldest first. */
export function agreementStatus(agreement: { results: { result: AgreementResult }[] }): AgreementStatus {
  return agreement.results[agreement.results.length - 1]?.result ?? 'pending';
}

interface NoteWithAgreements<A> {
  agreements: A[];
  /** A note from before the sections has its agreements on its completion entry. */
  follow_ups: { agreements: A[] }[];
}

/** Every agreement of a note, wherever it was written. */
export function noteAgreements<A>(note: NoteWithAgreements<A>): A[] {
  return [...note.agreements, ...note.follow_ups.flatMap((f) => f.agreements)];
}

interface NoteWithTopic {
  topic: NoteTopic | null;
  follow_ups: { kind: string; topic: NoteTopic | null }[];
}

/** A note's topic: its own, or the one its completion gave it. */
export function noteTopic(note: NoteWithTopic): NoteTopic | null {
  return note.topic ?? note.follow_ups.find((f) => f.kind === 'completion')?.topic ?? null;
}

/* --------------------------------- summary -------------------------------- */

export interface NoteSummary {
  total: number;
  /** Most notes first; `types` by type id, most first. */
  topics: { topic: NoteTopic; count: number; types: { id: string; count: number }[] }[];
  /** Notes from before topics existed. */
  noTopic: number;
  agreements: Record<AgreementStatus, number>;
}

type SummaryNote = NoteWithTopic &
  NoteWithAgreements<{ results: { result: AgreementResult }[] }> & {
    note_date: string;
    type: { id: string } | null;
  };

/** A registered meeting the worker attended: each of its points has a topic of its own. */
export interface SummaryMeeting {
  meeting_date: string;
  points: { topic: NoteTopic | null; agreements: { results: { result: AgreementResult }[] }[] }[];
}

/** The type a meeting counts under in the summary. */
export const MEETING_TYPE = 'meeting';

/**
 * What the last twelve months of a log are about, and how its agreements
 * went. A meeting counts once in the total and once under each of its topics.
 */
export function noteSummary(notes: SummaryNote[], today: string, meetings: SummaryMeeting[] = []): NoteSummary {
  const from = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const recent = notes.filter((n) => n.note_date > from && n.note_date <= today);

  const byTopic = new Map<NoteTopic, Map<string, number>>();
  const agreements: Record<AgreementStatus, number> = { met: 0, partly: 0, not_met: 0, pending: 0 };
  let noTopic = 0;
  for (const n of recent) {
    for (const a of noteAgreements(n)) agreements[agreementStatus(a)] += 1;
    const topic = noteTopic(n);
    if (!topic) {
      noTopic += 1;
      continue;
    }
    const types = byTopic.get(topic) ?? new Map<string, number>();
    const type = n.type?.id ?? '';
    types.set(type, (types.get(type) ?? 0) + 1);
    byTopic.set(topic, types);
  }
  const attended = meetings.filter((m) => m.meeting_date > from && m.meeting_date <= today);
  for (const m of attended) {
    for (const a of m.points.flatMap((p) => p.agreements)) agreements[agreementStatus(a)] += 1;
    for (const topic of new Set(m.points.map((p) => p.topic))) {
      if (!topic) continue;
      const types = byTopic.get(topic) ?? new Map<string, number>();
      types.set(MEETING_TYPE, (types.get(MEETING_TYPE) ?? 0) + 1);
      byTopic.set(topic, types);
    }
  }

  const topics = ALL_TOPICS.filter((topic) => byTopic.has(topic))
    .map((topic) => {
      const types = [...byTopic.get(topic)!.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
      return { topic, count: types.reduce((sum, ty) => sum + ty.count, 0), types };
    })
    .sort((a, b) => b.count - a.count);
  return { total: recent.length + attended.length, topics, noTopic, agreements };
}
