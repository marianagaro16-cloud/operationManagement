/** The sales summary for the weekly meetings: a snapshot of a period. */

export interface SummaryNote {
  id: string;
  date: string;
  target: string;
  target_kind: 'customer' | 'prospect';
  kind_id: string;
  body: string;
  author: string | null;
  starred: boolean;
}

export interface SummaryContent {
  /** Activity kinds as they were named, for the snapshot to show in any language. */
  kinds: Record<string, { name: string; translations: unknown }>;
  /** Starred notes of the period. */
  highlights: SummaryNote[];
  /** Every note of the period, by customer or prospect. */
  conversations: { target: string; target_kind: 'customer' | 'prospect'; notes: SummaryNote[] }[];
  activity: {
    byKind: { kind_id: string; done: number; not_done: number; planned: number }[];
    prospects: { created: string[]; won: string[]; lost: string[] };
  };
  events: {
    name: string;
    start_date: string;
    end_date: string;
    stage: string;
    place: string | null;
    rating: number | null;
    summary: string | null;
    contacts: number;
    planned_cost: number;
    actual_cost: number;
  }[];
}

export interface SalesSummary {
  id: string;
  title: string;
  period_from: string;
  period_to: string;
  content: SummaryContent;
  created_at: string;
  author: string | null;
}
