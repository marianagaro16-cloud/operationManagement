/**
 * Hand-maintained mirror of the SQL schema.
 *
 * Regenerate the authoritative version after the migration is applied:
 *   npx supabase gen types typescript --linked > src/types/database.types.ts
 * and re-export from there. This file exists so the app is type-safe before
 * the first push.
 */
import type { Frequency, OccurrenceStatus, ScheduleConfig } from '@/domain/recurrence/types';

export type UserRole = 'admin' | 'user';
export type UserStatus = 'pending' | 'approved' | 'rejected' | 'deactivated';

export interface Profile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  category_id: string | null;
  frequency: Frequency;
  schedule_config: ScheduleConfig | null;
  /** Per-locale title/description overrides; Spanish is in the base fields. */
  translations: Record<string, { title?: string | null; description?: string | null }> | null;
  is_skippable: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskOccurrence {
  id: string;
  task_id: string;
  period_key: string;
  due_date: string;
  due_date_override: string | null;
  status: OccurrenceStatus;
  completed_by: string | null;
  completed_at: string | null;
  skipped_by: string | null;
  skipped_at: string | null;
  skip_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskComment {
  id: string;
  occurrence_id: string;
  task_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

/** An occurrence joined to its definition — the shape the dashboard renders. */
export interface OccurrenceWithTask extends TaskOccurrence {
  task: Pick<
    Task,
    'id' | 'title' | 'description' | 'frequency' | 'is_skippable' | 'is_active' | 'category_id'
    | 'translations'
  > & { category: Pick<Category, 'slug' | 'name'> | null };
  comment_count?: number;
}

export type { Frequency, OccurrenceStatus, ScheduleConfig };
