import type { Team } from '@/lib/authz';

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
  sort_order: number;
  is_active: boolean;
}

export interface HrCriterion {
  id: string;
  team: Team;
  name: string;
  description: string | null;
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
  type: { id: string; name: string; slug: string } | null;
  author_name: string | null;
  attachments: HrAttachment[];
}

export interface HrEvaluation {
  id: string;
  evaluated_on: string;
  comment: string | null;
  created_at: string;
  author_name: string | null;
  scores: { criterion_name: string; score: number }[];
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
