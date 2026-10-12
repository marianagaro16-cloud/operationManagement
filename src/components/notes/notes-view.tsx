'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, StickyNote } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import type { QuickNote } from '@/types/notes';
import { NoteCard } from './note-card';
import { NoteDialog } from './note-dialog';

/** The latest notes on Inicio, pinned first. */
export function NotesCard({ notes, viewerId }: { notes: QuickNote[]; viewerId: string }) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <StickyNote className="h-4 w-4 text-accent" aria-hidden />
          <Link href="/space" className="hover:underline">{t('note.navLabel')}</Link>
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
          <Link href="/space" className="block text-[12.5px] font-medium text-accent hover:underline">{t('note.seeAll')}</Link>
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
