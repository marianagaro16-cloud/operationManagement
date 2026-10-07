import type { Team } from '@/lib/authz';
import type { AgreementResult, NoteStructure, NoteTopic, WarningLevel } from '@/domain/hr/note-structure';

/** German and English overrides; Spanish is in the base fields. */
export type HrTranslations = Partial<Record<'de' | 'en', { name?: string | null; description?: string | null }>>;

/** Someone who works here — with an app account or without one. */
export interface HrWorker {
  id: string;
  profile_id: string | null;
  name: string;
  team: Team;
  position: string | null;
  start_date: string | null;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  emergency_contact: string | null;
  is_active: boolean;
  left_on: string | null;
  created_at: string;
}

export interface HrNoteType {
  id: string;
  slug: string;
  name: string;
  /** Which sections a note of this type asks for. */
  structure: NoteStructure;
  translations: HrTranslations;
  sort_order: number;
  is_active: boolean;
}

/** A named set of criteria for one job of a team — e.g. "Encargado de turno de producción". */
export interface HrEvalTemplate {
  id: string;
  team: Team;
  name: string;
  translations: HrTranslations;
  sort_order: number;
  is_active: boolean;
}

export interface HrCriterion {
  id: string;
  team: Team;
  /** The template it belongs to; null for the team's general criteria. */
  template_id: string | null;
  name: string;
  description: string | null;
  translations: HrTranslations;
  sort_order: number;
  is_active: boolean;
}

export interface HrAttachment {
  id: string;
  file_name: string;
  mime_type: string;
  signed_url: string | null;
}

/** Someone who was there: an app account, a worker file, or just a name. */
export interface HrParticipant {
  id: string;
  profile_id: string | null;
  worker_id: string | null;
  name: string;
}

/** Whom a note's participants are picked from; one entry per person. */
export interface HrPerson {
  profile_id: string | null;
  worker_id: string | null;
  name: string;
}

/** One thing that was agreed: what, who is responsible and by when. */
export interface HrAgreement {
  id: string;
  body: string;
  responsible_name: string;
  due_on: string;
  /** What each follow-up said of it, oldest first. */
  results: { followup_id: string; result: AgreementResult; comment: string | null }[];
}

/** When and where what a note is about happened. */
export interface HrNoteEvent {
  topic: NoteTopic | null;
  event_on: string | null;
  event_time: string | null;
  event_area: Team | null;
}

/** An entry added to a note later: what came of its follow-up, or the sections an old note lacks. */
export interface HrFollowUp extends HrNoteEvent {
  id: string;
  kind: 'followup' | 'completion';
  entry_date: string;
  body: string | null;
  sections: Record<string, string> | null;
  warning_level: WarningLevel | null;
  /** The agreements a completion gave an old note. */
  agreements: HrAgreement[];
  /** Nothing more to follow up. */
  closes: boolean;
  next_text: string | null;
  next_on: string | null;
  no_follow_up_reason: string | null;
  created_at: string;
  author_name: string | null;
  participants: HrParticipant[];
}

export interface HrNote extends HrNoteEvent {
  id: string;
  note_date: string;
  /** The free text of a note written before notes had sections. */
  body: string | null;
  /** By section key; null for a note in the old format. */
  sections: Record<string, string> | null;
  warning_level: WarningLevel | null;
  agreements: HrAgreement[];
  follow_up_text: string | null;
  follow_up_on: string | null;
  no_follow_up_reason: string | null;
  created_at: string;
  created_by: string | null;
  type: { id: string; name: string; slug: string; structure: NoteStructure; translations: HrTranslations } | null;
  author_name: string | null;
  attachments: HrAttachment[];
  participants: HrParticipant[];
  /** Oldest first. */
  follow_ups: HrFollowUp[];
}

/** A note whose follow-up is still open. */
export interface HrOpenFollowUp {
  note_id: string;
  worker_id: string;
  created_by: string | null;
  due_on: string;
}

export interface HrEvaluation {
  id: string;
  evaluated_on: string;
  comment: string | null;
  /** Goals for the next period — shown again when the next evaluation is written. */
  goals: string | null;
  created_at: string;
  author_name: string | null;
  /** Each criterion's words as they were when rated, in every language. */
  scores: { criterion_name: string; criterion_translations: HrTranslations; score: number; comment: string | null }[];
}

/** What a linked account did in the app over a period. */
export interface HrStats {
  activities_completed: number;
  activities_skipped: number;
  activities_not_done: number;
  incidents_reported: number;
  orders_prepared: number;
  orders_shipped: number;
  inventories_counted: number;
  inventory_lines: number;
}

export interface HrWorkerFile {
  worker: HrWorker;
  notes: HrNote[];
  evaluations: HrEvaluation[];
}

/* --------------------- evaluations sent to several people --------------------- */

/** One question of a sent evaluation, as it was when sent. */
export interface HrEvalItem {
  id: string;
  sort_order: number;
  /** 1-5 with details, or a written answer. */
  kind: 'scale' | 'text';
  criterion_id: string | null;
  name: string;
  description: string | null;
  translations: HrTranslations;
}

/** An evaluation of one worker sent to several people. */
export interface HrEvalRequest {
  id: string;
  worker_id: string;
  worker_name: string;
  worker_position: string | null;
  worker_team: Team;
  deadline: string;
  closed_at: string | null;
  created_at: string;
  /** Not closed early and the deadline day not over. */
  open: boolean;
  invited: number;
  submitted: number;
}

/** The combined answers, without names — only once enough people answered. */
export interface HrEvalOverview {
  invited: number;
  submitted: number;
  shown: boolean;
  items?: { item_id: string; average: number | null; distribution: number[]; texts: string[] }[];
  comments?: string[];
}

export interface HrEvalAnswer {
  item_id: string;
  score: number | null;
  body: string | null;
}

/** One evaluator's evaluation: theirs to fill in, or — for Admin — to read with the name. */
export interface HrEvalAssignment {
  id: string;
  request_id: string;
  evaluator_id: string | null;
  evaluator_name: string | null;
  comment: string | null;
  submitted_at: string | null;
  answers: HrEvalAnswer[];
}

/** Why someone arrived late — Admin's list, like the note types. */
export interface HrLateReason {
  id: string;
  slug: string;
  name: string;
  translations: HrTranslations;
  sort_order: number;
  is_active: boolean;
}

/** One late arrival: when they should have started and when they came. */
export interface HrLateArrival {
  id: string;
  arrival_date: string;
  expected_time: string;
  arrived_time: string;
  /** Negative for an early one. */
  minutes_late: number;
  /** After the expected time, or more than the tolerance before it. */
  kind: 'late' | 'early';
  /** Minutes off either way. */
  minutes_off: number;
  reason: { id: string; name: string; translations: HrTranslations } | null;
  excused: boolean;
  notified: boolean;
  note: string | null;
  created_by: string | null;
  author_name: string | null;
  created_at: string;
}

/** A key someone holds, or held: a worker with a file, or anyone else by name. */
export interface HrKey {
  id: string;
  key_number: string;
  opens: string | null;
  worker_id: string | null;
  /** The worker's name; null for someone without a file. */
  worker_name: string | null;
  holder_name: string | null;
  /** Who someone without a file is: company, phone. */
  holder_detail: string | null;
  handed_on: string;
  /** Null while they still have it. */
  returned_on: string | null;
  note: string | null;
}
