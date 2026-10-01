'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, StickyNote } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import type { QuickNote } from '@/types/notes';
import { NoteCard } from './note-card';
import { NoteDialog } from './note-dialog';

/** Every quick note of one's own and those shared with one; or the archived ones. */
export function NotesView({ notes, archived, viewerId }: { notes: QuickNote[]; archived: boolean; viewerId: string }) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const mine = notes.filter((n) => n.mine);
  const shared = notes.filter((n) => !n.mine);

  return (
    <>
      <PageHeader
        title={t('note.navLabel')}
        subtitle={t('note.subtitle')}
        action={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('note.new')}
          </Button>
        }
      />
      <div className="-mt-2 mb-3 flex gap-1 border-b border-border">
        {[false, true].map((a) => (
          <Link
            key={String(a)}
            href={a ? '/notes?archived=1' : '/notes'}
            scroll={false}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              archived === a ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {a ? t('note.tabArchived') : t('note.tabActive')}
          </Link>
        ))}
      </div>

      {notes.length === 0 ? (
        <EmptyState title={archived ? t('note.noneArchived') : t('note.none')} />
      ) : (
        <div className="space-y-5">
          {mine.length > 0 && <Grid notes={mine} viewerId={viewerId} />}
          {shared.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold text-muted">{t('note.sharedWithMe')}</h2>
              <Grid notes={shared} viewerId={viewerId} />
            </section>
          )}
        </div>
      )}

      {creating && <NoteDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function Grid({ notes, viewerId }: { notes: QuickNote[]; viewerId: string }) {
  return (
    <div className="columns-1 gap-3 sm:columns-2">
      {notes.map((n) => (
        <div key={n.id} className="mb-3 break-inside-avoid">
          <NoteCard note={n} viewerId={viewerId} />
        </div>
      ))}
    </div>
  );
}

/** The latest notes on Inicio, pinned first. */
export function NotesCard({ notes, viewerId }: { notes: QuickNote[]; viewerId: string }) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <StickyNote className="h-4 w-4 text-accent" aria-hidden />
          <Link href="/notes" className="hover:underline">{t('note.navLabel')}</Link>
        </h2>
        <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('note.new')}
        </Button>
      </div>
      {notes.length === 0 ? (
        <Card className="p-3 text-[12.5px] text-muted">{t('note.none')}</Card>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => <NoteCard key={n.id} note={n} viewerId={viewerId} compact />)}
          <Link href="/notes" className="block text-[12.5px] font-medium text-accent hover:underline">{t('note.seeAll')}</Link>
        </div>
      )}
      {creating && <NoteDialog onClose={() => setCreating(false)} />}
    </section>
  );
}

/** A customer's notes in their file — only one's own and those shared with one. */
export function CustomerNotes({ notes, customer, viewerId }: { notes: QuickNote[]; customer: { id: string; name: string }; viewerId: string }) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <StickyNote className="h-4 w-4 text-accent" aria-hidden />
          {t('note.myNotes')}
        </h2>
        <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('note.new')}
        </Button>
      </div>
      {notes.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t('note.noneCustomer')}</p>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => <NoteCard key={n.id} note={n} viewerId={viewerId} />)}
        </div>
      )}
      {creating && <NoteDialog customer={customer} onClose={() => setCreating(false)} />}
    </section>
  );
}
