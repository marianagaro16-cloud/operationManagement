'use client';

import { useState } from 'react';
import { StickyNote } from 'lucide-react';
import { useI18n } from '@/i18n';
import { NoteDialog } from './note-dialog';

/** The note button in the header: write one down without leaving the screen. */
export function QuickNoteButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('note.new')}
        title={t('note.new')}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <StickyNote className="h-[18px] w-[18px]" aria-hidden />
      </button>
      {open && <NoteDialog onClose={() => setOpen(false)} />}
    </>
  );
}
