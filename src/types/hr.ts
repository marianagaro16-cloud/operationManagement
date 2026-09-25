import type { Team } from '@/lib/authz';

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
  translations: HrTranslations;
  sort_order: number;
  is_active: boolean;
}

export interface HrCriterion {
  id: string;
  team: Team;
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

export interface HrNote {
  id: string;
  note_date: string;
  body: string;
  created_at: string;
  type: { id: string; name: string; slug: string; translations: HrTranslations } | null;
  author_name: string | null;
  attachments: HrAttachment[];
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
