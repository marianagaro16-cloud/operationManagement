import type { MeetingResponse } from './meetings';

/** One person's agenda: everything with a day, from every part of the app. */

export type AgendaKind = 'activity' | 'inventory' | 'sales' | 'meeting' | 'coverage' | 'absence' | 'reminder' | 'personal' | 'collection' | 'delivery';

export interface AgendaItem {
  /** Unique across kinds. */
  key: string;
  kind: AgendaKind;
  id: string;
  date: string;
  /** "HH:MM"; null for something of the whole day. */
  start: string | null;
  end: string | null;
  title: string;
  /** Titles an admin translated: shown in the reader's language. */
  translations?: unknown;
  detail: string | null;
  href: string | null;
  done: boolean;
  /** From before today and still open. */
  late: boolean;
  /** What can be done right from the agenda. */
  action: 'complete_activity' | 'complete_personal' | 'answer_meeting' | null;
  response?: MeetingResponse;
  /** An expected delivery with a week and no day yet: `date` is that week's Monday. */
  weekOnly?: boolean;
}
