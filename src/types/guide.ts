/** One piece of an article, in the order it is read. */
export type GuideBlock =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  /** `path` in the guide-files bucket; `url` is signed when the article is read. */
  | { type: 'image'; path: string; caption?: string; url?: string | null }
  /** The first row is the header. */
  | { type: 'table'; rows: string[][] };

/** A how-to or a piece of reference, shared by every guide. */
export interface GuideArticle {
  id: string;
  title: string;
  topic: string;
  blocks: GuideBlock[];
  sort_order: number;
  updated_at: string;
}

/** An article as the lists show it. */
export type GuideArticleBrief = Pick<GuideArticle, 'id' | 'title' | 'topic' | 'sort_order'>;

/** Something to do on some weekdays ('task'), or to keep in mind ('rule'). */
export interface GuidePoint {
  id: string;
  guide_id: string;
  kind: 'task' | 'rule';
  /** ISO weekdays, 1 = Monday. */
  weekdays: number[];
  title: string;
  body: string | null;
  /** "HH:MM:SS", when it has to be done by a time. */
  deadline: string | null;
  article_id: string | null;
  supplier_id: string | null;
  sort_order: number;
}

/** What a person does day by day, for whoever covers them. */
export interface Guide {
  profile_id: string;
  intro: string | null;
  /** A line per ISO weekday: who is in, what kind of day it is. */
  day_notes: Record<string, string>;
  points: GuidePoint[];
}

/** How the covering person left a point on one day. */
export interface GuideCheck {
  point_id: string;
  check_date: string;
  status: 'done' | 'skipped';
  comment: string | null;
  checked_by_name: string | null;
}

/** Whose guides the viewer may open, and whether they write them. */
export interface GuideAccess {
  edit: boolean;
  guides: { profile_id: string; name: string; covering_today: boolean }[];
}

/** How to order from a supplier. */
export interface SupplierCard {
  supplier_id: string;
  name: string;
  how: string | null;
  contact: string | null;
  minimum: string | null;
  deadline: string | null;
  notes: string | null;
}

/** One covered day of an absence, as its guide was left. */
export interface GuideDaySummary {
  date: string;
  points: { id: string; title: string; deadline: string | null; check: GuideCheck | null }[];
}
