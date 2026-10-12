'use client';

import Link from 'next/link';
import { FileText } from 'lucide-react';
import { useI18n } from '@/i18n';
import { noteHeading } from '@/domain/notes';
import type { QuickNote } from '@/types/notes';
import { SpaceTitle } from './bits';

/** The archived notes, one line each; a note opens to be restored or deleted. */
export function ArchivedNotes({ notes }: { notes: QuickNote[] }) {
  const { t, formatDate } = useI18n();
  return (
    <>
      <SpaceTitle title={t('note.tabArchived')} />
      {notes.length === 0 ? (
        <p className="px-1 text-[13px] text-subtle">{t('note.noneArchived')}</p>
      ) : (
        <ul>
          {notes.map((note) => (
            <li key={note.id}>
              <Link href={`/space/notes/${note.id}`} className="flex items-center gap-2.5 rounded-md px-1 py-1.5 transition-colors hover:bg-surface-2/50">
                <FileText className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[14.5px]">{noteHeading(note) || t('space.untitled')}</span>
                <span className="shrink-0 text-[12px] tabular text-subtle">{formatDate((note.archived_at ?? note.updated_at).slice(0, 10), 'short')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
