/** Quick notes: a personal notepad, private unless shared. */

import type { TopicColor as SpaceColor } from './reminders';

export interface QuickNoteItem {
  id: string;
  body: string;
  done: boolean;
}

export interface QuickNote {
  id: string;
  /** Written by the viewer — only then can it be changed, pinned, shared or archived. */
  mine: boolean;
  owner_name: string | null;
  /** The page's title; empty for a note jotted down without one. */
  title: string;
  body: string;
  /** An emoji beside the title, and the colour of the band over it; both optional. */
  icon: string | null;
  cover: SpaceColor | null;
  pinned: boolean;
  customer: { id: string; name: string } | null;
  archived_at: string | null;
  updated_at: string;
  items: QuickNoteItem[];
  /** Who else sees it. */
  shares: { id: string; name: string }[];
}
