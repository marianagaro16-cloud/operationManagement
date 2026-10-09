import type { Block } from '@/domain/schedule/schedule';

export interface ScheduleKind {
  id: string;
  name: string;
  /** '#RRGGBB' */
  color: string;
  hatched: boolean;
  /** False for a day off. */
  counts_hours: boolean;
  system_key: 'vacation' | 'free' | 'sick' | null;
  sort_order: number;
  is_active: boolean;
}

export interface ScheduleProduct {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface SchedulePerson {
  id: string;
  worker_id: string | null;
  /** The account behind the worker file, if any: for the absence hint. */
  profile_id: string | null;
  external_name: string | null;
  /** What the schedule calls them: the label, else the file's or the external's name. */
  name: string;
  label: string | null;
  sort_order: number;
  percent: number | null;
  min_hours: number | null;
  max_hours: number | null;
  is_lead: boolean;
  in_sunday_rotation: boolean;
  sunday_order: number;
  is_active: boolean;
}

/** Per day, '0' = Sunday … '6' = Saturday. */
export type DayMap<T> = Record<string, T>;

export interface ScheduleWeekHeader {
  day_products: DayMap<string[]>;
  day_notes: DayMap<string>;
  holidays: number[];
  cleaning_bathroom: string | null;
  cleaning_kitchen: string | null;
}

export interface ScheduleWeek extends ScheduleWeekHeader {
  id: string;
  /** Null for the usual week. */
  week_start: string | null;
  is_pattern: boolean;
  /** Last published version; 0 = draft. */
  version: number;
  published_at: string | null;
}

/** What a published version holds. */
export interface ScheduleSnapshot extends ScheduleWeekHeader {
  blocks: Block[];
}

export interface ScheduleWeekData {
  week: ScheduleWeek;
  blocks: Block[];
  /** The last published state, and the one before it. */
  published: ScheduleSnapshot | null;
  previous: ScheduleSnapshot | null;
}

export interface SundayDuty {
  id: string;
  duty_date: string;
  person_id: string | null;
  person_name: string;
  note: string | null;
  origin: 'planned' | 'schedule' | 'import';
}
