import type { LinkedRecords } from '@/domain/reminders/links';
import type { PersonalTaskStatus, Recurrence, ReminderStatus } from '@/domain/reminders/schedule';

export interface ReminderPerson {
  id: string;
  name: string | null;
  email: string;
}

export interface Reminder extends LinkedRecords {
  id: string;
  created_by: string;
  title: string;
  notes: string | null;
  due_at: string;
  timezone: string;
  recurrence: Recurrence;
  recurrence_anchor: string | null;
  notify_before_minutes: number | null;
  snoozed_until: string | null;
  next_at: string;
  is_shared: boolean;
  status: ReminderStatus;
  personal_task_id: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
  creator: ReminderPerson | null;
  participants: { user_id: string; profile: ReminderPerson | null }[];
}

export type ReminderEventAction =
  | 'created'
  | 'edited'
  | 'participant_added'
  | 'participant_removed'
  | 'snoozed'
  | 'completed'
  | 'occurrence_completed'
  | 'cancelled'
  | 'converted';

export interface ReminderEvent {
  id: string;
  action: ReminderEventAction;
  detail: Record<string, unknown>;
  created_at: string;
  actor: ReminderPerson | null;
}

export interface PersonalTask extends LinkedRecords {
  id: string;
  owner_id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  due_time: string | null;
  status: PersonalTaskStatus;
  source_reminder_id: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  /** The owner's own filing: a topic, and optionally one of its categories. */
  topic_id: string | null;
  category_id: string | null;
}

export const TOPIC_COLORS = ['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'] as const;
export type TopicColor = (typeof TOPIC_COLORS)[number];

/** A person's own topic for personal tasks, with its categories. Private. */
export interface PersonalTopic {
  id: string;
  name: string;
  color: TopicColor | null;
  sort_order: number;
  archived_at: string | null;
  categories: { id: string; name: string; sort_order: number; archived_at: string | null }[];
}

export const REMINDER_VIEWS = ['today', 'upcoming', 'overdue', 'shared', 'completed', 'cancelled'] as const;
export type ReminderView = (typeof REMINDER_VIEWS)[number];

export interface ReminderFilters {
  view: ReminderView;
  q?: string;
  link?: string;
  scope?: 'personal' | 'shared';
  creator?: 'me' | 'others';
  from?: string;
  to?: string;
  page: number;
}
