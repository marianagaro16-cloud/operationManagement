'use client';

import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Archive, Check, CheckSquare, FileText, Inbox, Pin, Plus, Search, Users } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { noteHeading } from '@/domain/notes';
import { createNotePage, setSpaceAccent } from '@/server/note-actions';
import type { QuickNote } from '@/types/notes';
import { ACCENT_COLORS, SWATCH, TINT, type SpaceColor } from './colors';

/**
 * "Mi espacio": one's own tasks, notes and notifications in one place.
 *
 * A slim list on the left — the three parts, and every note as a page of its
 * own — and what is open on the right. On a phone the list is the first
 * screen and each part opens over it.
 */
export function SpaceShell({
  notes,
  tasks,
  unread,
  accent,
  children,
}: {
  /** The viewer's notes and those shared with them, not archived. */
  notes: QuickNote[];
  /** The open personal tasks, for the search and the count. */
  tasks: { id: string; title: string }[];
  unread: number;
  /** The colour the viewer chose for their workspace; the app's own when none. */
  accent: SpaceColor | null;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [creating, startCreating] = useTransition();
  // Shown at once; the choice is saved behind it.
  const [colour, setColour] = useState(accent);
  const [, startColouring] = useTransition();

  function chooseColour(next: SpaceColor | null) {
    const previous = colour;
    setColour(next);
    startColouring(async () => {
      const res = await setSpaceAccent(next);
      if (!res.ok) setColour(previous);
    });
  }

  const atRoot = pathname === '/space';
  const q = query.trim().toLowerCase();
  const matches = (note: QuickNote) =>
    !q || [note.title, note.body, ...note.items.map((i) => i.body)].some((text) => text.toLowerCase().includes(q));
  const mine = notes.filter((n) => n.mine && matches(n));
  const shared = notes.filter((n) => !n.mine && matches(n));
  const foundTasks = q ? tasks.filter((task) => task.title.toLowerCase().includes(q)) : [];

  function newNote() {
    startCreating(async () => {
      const res = await createNotePage();
      if (!res.ok) return;
      router.push(`/space/notes/${res.data.id}`);
      router.refresh();
    });
  }

  const row = (href: string, active: boolean) =>
    cn(
      'flex min-w-0 items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] transition-colors',
      active ? 'bg-accent/10 font-medium text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
    );
  const noteRow = (note: QuickNote) => {
    const href = `/space/notes/${note.id}`;
    return (
      <li key={note.id}>
        <Link href={href} className={row(href, pathname === href)}>
          {note.icon
            ? <span className="w-3.5 shrink-0 text-center text-[13px] leading-none" aria-hidden>{note.icon}</span>
            : <FileText className={cn('h-3.5 w-3.5 shrink-0', note.cover ? TINT[note.cover] : 'opacity-70')} aria-hidden />}
          <span className="min-w-0 flex-1 truncate">{noteHeading(note) || t('space.untitled')}</span>
          {note.icon && note.cover && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', SWATCH[note.cover])} aria-hidden />}
          {note.mine && note.pinned && <Pin className="h-3 w-3 shrink-0 text-accent" aria-hidden />}
        </Link>
      </li>
    );
  };
  const label = 'px-2 text-[11px] font-semibold uppercase tracking-wider text-subtle';

  return (
    <div data-space-accent={colour ?? undefined} className="md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8">
      <aside className={cn('md:block md:border-r md:border-border md:pr-3', atRoot ? 'block' : 'hidden')}>
        <div className="md:sticky md:top-20">
          <h1 className="mb-3 px-2 text-xl font-semibold leading-tight md:hidden">{t('space.title')}</h1>

          <label className="mb-3 flex items-center gap-2 rounded-md bg-surface-2/70 px-2 py-1.5 text-muted focus-within:bg-surface-2">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('space.search')}
              aria-label={t('space.search')}
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-subtle focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </label>

          {!q && (
            <ul className="mb-4 space-y-px">
              <li>
                <Link href="/space/inbox" className={row('/space/inbox', pathname === '/space/inbox')}>
                  <Inbox className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{t('space.inbox')}</span>
                  {unread > 0 && <span className="rounded-full bg-late px-1.5 text-[10.5px] font-semibold leading-4 tabular text-white">{unread > 99 ? '99+' : unread}</span>}
                </Link>
              </li>
              <li>
                {/* On a wide screen the tasks are what the workspace opens on. */}
                <Link href="/space/tasks" className={cn(row('/space/tasks', pathname === '/space/tasks'), atRoot && 'md:bg-accent/10 md:font-medium md:text-fg')}>
                  <CheckSquare className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{t('space.tasks')}</span>
                  {tasks.length > 0 && <span className="text-[12px] tabular text-subtle">{tasks.length}</span>}
                </Link>
              </li>
            </ul>
          )}

          {q && foundTasks.length > 0 && (
            <div className="mb-4">
              <p className={cn(label, 'mb-1')}>{t('space.tasks')}</p>
              <ul className="space-y-px">
                {foundTasks.slice(0, 12).map((task) => (
                  <li key={task.id}>
                    <Link href="/space/tasks" className={row('/space/tasks', false)}>
                      <CheckSquare className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-1 flex items-center justify-between">
            <p className={label}>{t('note.navLabel')}</p>
            <button
              onClick={newNote}
              disabled={creating}
              aria-label={t('note.new')}
              title={t('note.new')}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <ul className="space-y-px">
            {mine.map(noteRow)}
            {!q && (
              <li>
                <button onClick={newNote} disabled={creating} className={cn(row('', false), 'w-full text-left text-subtle disabled:opacity-50')}>
                  <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t('note.new')}
                </button>
              </li>
            )}
          </ul>

          {shared.length > 0 && (
            <div className="mt-4">
              <p className={cn(label, 'mb-1 flex items-center gap-1')}>
                <Users className="h-3 w-3 text-violet-500" aria-hidden />
                {t('note.sharedWithMe')}
              </p>
              <ul className="space-y-px">{shared.map(noteRow)}</ul>
            </div>
          )}

          {q && mine.length + shared.length + foundTasks.length === 0 && (
            <p className="px-2 py-2 text-[13px] text-subtle">{t('space.noResults')}</p>
          )}

          {!q && (
            <Link href="/space/notes/archived" className={cn(row('', pathname === '/space/notes/archived'), 'mt-4')}>
              <Archive className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
              {t('note.tabArchived')}
            </Link>
          )}

          {!q && (
            <div className="mt-5 px-2">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('space.myColor')}</p>
              <div className="flex flex-wrap gap-1">
                {[null, ...ACCENT_COLORS].map((c) => (
                  <button
                    key={c ?? 'default'}
                    onClick={() => chooseColour(c)}
                    aria-pressed={colour === c}
                    aria-label={c ?? t('space.defaultColor')}
                    title={c ? undefined : t('space.defaultColor')}
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full text-white transition-transform hover:scale-110',
                      c ? SWATCH[c] : 'bg-[#2f4f8f]',
                    )}
                  >
                    {colour === c && <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      <div className={cn('min-w-0 pb-10 md:block', atRoot && 'hidden')}>{children}</div>
    </div>
  );
}
