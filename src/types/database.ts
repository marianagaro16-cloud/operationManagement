/**
 * Hand-maintained mirror of the SQL schema.
 *
 * Regenerate the authoritative version after the migration is applied:
 *   npx supabase gen types typescript --linked > src/types/database.types.ts
 * and re-export from there. This file exists so the app is type-safe before
 * the first push.
 */
import type { Frequency, OccurrenceStatus, ScheduleConfig } from '@/domain/recurrence/types';
import type { Role } from '@/lib/authz';

/**
 * The role vocabulary lives in `@/lib/authz`, so the hierarchy, the capability
 * list and the rank stay in one place rather than being restated per file.
 * Re-exported here because the rest of this schema mirror refers to it.
 */
export type UserRole = Role;
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
  /** The rule's date. Read `effective_due_date` instead — see below. */
  due_date: string;
  /** An admin moved this single occurrence. Null means "follows the rule". */
  due_date_override: string | null;
  /**
   * coalesce(due_date_override, due_date), generated in Postgres.
   *
   * THE date this occurrence is due. Every filter, sort and bucket uses it;
   * hand-coalescing the two columns above is what let a moved occurrence fall
   * outside a window bounded on the raw due_date and disappear.
   */
  effective_due_date: string;
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
  /**
   * Display name of whoever resolved this occurrence — completed or skipped it.
   *
   * Not an embedded relation: `completed_by` and `skipped_by` reference
   * `auth.users`, not `public.profiles`, so PostgREST has no foreign key to
   * traverse. Resolved in one lookup by the query layer instead. Null while
   * the occurrence is still open.
   */
  actor_name?: string | null;
  /** When it was resolved — completed_at or skipped_at, whichever applies. */
  resolved_at?: string | null;
}

export type { Frequency, OccurrenceStatus, ScheduleConfig };
