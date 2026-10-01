'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, BellRing, Building2, Pencil, Pin, PinOff, RotateCcw, Trash2, Users } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { ReminderDialog } from '@/components/reminders/reminder-dialog';
import { deleteNote, setNoteArchived, setNotePinned, tickNoteItem } from '@/server/note-actions';
import type { QuickNote } from '@/types/notes';
import { NoteDialog } from './note-dialog';

/** One quick note: its text, its checklist, and — for its owner — what can be done with it. */
export function NoteCard({ note, viewerId, compact = false }: { note: QuickNote; viewerId: string; compact?: boolean }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Ticks show at once; the server's answer follows.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(t('common.error'));
      router.refresh();
    });
  }

  function tick(id: string, done: boolean) {
    setTicks((cur) => ({ ...cur, [id]: done }));
    run(() => tickNoteItem(id, done));
  }

  const archived = Boolean(note.archived_at);
  // A reminder from a note: its first line as the title, the rest as the notes.
  const [first, ...rest] = (note.body || note.items[0]?.body || '').split('\n');
  const reminderNotes = [rest.join('\n').trim(), ...note.items.filter((i) => !i.done).map((i) => `- ${i.body}`)].filter(Boolean).join('\n');

  return (
    <Card className={cn('p-3', note.mine && note.pinned && !archived && 'border-accent/40')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-[13.5px]">
          {note.body && <NoteText text={compact && note.body.length > 280 ? `${note.body.slice(0, 280)}…` : note.body} />}
          {note.items.length > 0 && (
            <ul className={cn('space-y-1', note.body && 'mt-2')}>
              {note.items.map((it) => {
                const done = ticks[it.id] ?? it.done;
                return (
                  <li key={it.id}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-[3px] h-4 w-4 shrink-0 accent-accent"
                        checked={done}
                        disabled={archived}
                        onChange={(e) => tick(it.id, e.target.checked)}
                      />
                      <span className={cn('break-words', done && 'text-muted line-through')}>{it.body}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {note.mine && note.pinned && !archived && <Pin className="h-3.5 w-3.5 shrink-0 text-accent" aria-label={t('note.pinned')} />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
        <span>{formatDate(note.updated_at.slice(0, 10), 'short')}</span>
        {note.customer && (
          <Link href={`/sales/customers/${note.customer.id}`} className="inline-flex items-center gap-1 hover:text-fg hover:underline">
            <Building2 className="h-3 w-3" aria-hidden />
            {note.customer.name}
          </Link>
        )}
        {note.mine && note.shares.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden />
            {t('note.sharedWith', { names: note.shares.map((s) => s.name).join(', ') })}
          </span>
        )}
        {!note.mine && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" aria-hidden />{t('note.from', { name: note.owner_name ?? '—' })}</span>}
      </div>

      {note.mine && (
        <div className="mt-2 flex flex-wrap gap-1">
          {!archived ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={pending}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                {t('note.editShort')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => run(() => setNotePinned(note.id, !note.pinned))} disabled={pending}>
                {note.pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden /> : <Pin className="h-3.5 w-3.5" aria-hidden />}
                {note.pinned ? t('note.unpin') : t('note.pin')}
              </Button>
              {!compact && (
                <Button size="sm" variant="ghost" onClick={() => setReminding(true)} disabled={pending}>
                  <BellRing className="h-3.5 w-3.5" aria-hidden />
                  {t('note.toReminder')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => run(() => setNoteArchived(note.id, true))} disabled={pending}>
                <Archive className="h-3.5 w-3.5" aria-hidden />
                {t('note.archive')}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => run(() => setNoteArchived(note.id, false))} disabled={pending}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                {t('note.restore')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => window.confirm(t('note.deleteConfirm')) && run(() => deleteNote(note.id))}
                disabled={pending}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {t('common.delete')}
              </Button>
            </>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-[12px] text-late">{error}</p>}

      {editing && <NoteDialog note={note} onClose={() => setEditing(false)} />}
      {reminding && (
        <ReminderDialog
          open
          viewerId={viewerId}
          initialTitle={first.slice(0, 200)}
          initialNotes={reminderNotes || undefined}
          onClose={() => setReminding(false)}
          // The note became a reminder: it leaves the list, still restorable.
          onSaved={() => {
            setReminding(false);
            run(() => setNoteArchived(note.id, true));
          }}
        />
      )}
    </Card>
  );
}
