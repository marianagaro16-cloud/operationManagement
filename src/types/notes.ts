/** Quick notes: a personal notepad, private unless shared. */

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
  body: string;
  pinned: boolean;
  customer: { id: string; name: string } | null;
  archived_at: string | null;
  updated_at: string;
  items: QuickNoteItem[];
  /** Who else sees it. */
  shares: { id: string; name: string }[];
}
