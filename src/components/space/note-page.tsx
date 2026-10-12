'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, BellRing, Building2, ListChecks, Pin, PinOff, RotateCcw, Trash2, Users, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { NoteText } from '@/components/ui/note';
import { ReminderDialog } from '@/components/reminders/reminder-dialog';
import { noteHeading } from '@/domain/notes';
import { deleteNote, loadNoteChoices, saveNoteContent, saveNoteSettings, setNoteArchived, setNotePinned, tickNoteItem } from '@/server/note-actions';
import type { QuickNote } from '@/types/notes';
import { AutoTextarea, SpaceBack } from './bits';

type Line = { key: number; body: string; done: boolean };
type Saving = 'idle' | 'saving' | 'saved' | 'error';

/** How long after the last keystroke the page is saved. */
const SAVE_AFTER_MS = 700;

/**
 * A quick note as a page: its title, its text and its checklist.
 *
 * One's own is written right here and saves itself — no window, no Save
 * button. One shared by somebody else is read, and its lines ticked. An
 * archived one is read until it is restored.
 */
export function NotePage({ note, viewerId }: { note: QuickNote; viewerId: string }) {
  const archived = Boolean(note.archived_at);
  return note.mine && !archived ? <Editor note={note} viewerId={viewerId} /> : <Reader note={note} />;
}

function Meta({ note }: { note: QuickNote }) {
  const { t, formatDate } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-subtle">
      <span>{formatDate(note.updated_at.slice(0, 10), 'medium')}</span>
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
      {!note.mine && (
        <span className="inline-flex items-center gap-1">
          <Users className="h-3 w-3" aria-hidden />
          {t('note.from', { name: note.owner_name ?? '—' })}
        </span>
      )}
    </div>
  );
}

const action = 'inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50';

/* ------------------------------ one's own ------------------------------ */

function Editor({ note, viewerId }: { note: QuickNote; viewerId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const nextKey = useRef(note.items.length);
  const [lines, setLines] = useState<Line[]>(note.items.map((it, i) => ({ key: i, body: it.body, done: it.done })));
  const [saving, setSaving] = useState<Saving>('idle');
  const [sharing, setSharing] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // What is on the page now, for the save that runs after the last keystroke.
  const latest = useRef({ title, body, lines });
  latest.current = { title, body, lines };
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  // The name the side list shows; it is refreshed only when this changes.
  const listed = useRef(noteHeading(note));

  const save = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    setSaving('saving');
    const now = latest.current;
    const items = now.lines.filter((l) => l.body.trim()).map((l) => ({ body: l.body.trim().slice(0, 300), done: l.done }));
    const res = await saveNoteContent({ id: note.id, title: now.title, body: now.body, items });
    if (!res.ok) {
      dirty.current = true;
      setSaving('error');
      return;
    }
    // Typed on while it was saving: that is saved by its own timer.
    if (!dirty.current) setSaving('saved');
    const heading = noteHeading({ title: now.title, body: now.body, items });
    if (heading !== listed.current) {
      listed.current = heading;
      router.refresh();
    }
  }, [note.id, router]);

  function changed() {
    dirty.current = true;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, SAVE_AFTER_MS);
  }

  // Leaving the page, or the app going to the background, saves what is pending.
  useEffect(() => {
    const flush = () => { if (document.visibilityState === 'hidden') void save(); };
    document.addEventListener('visibilitychange', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      void save();
    };
  }, [save]);

  const setLine = (key: number, patch: Partial<Line>) => {
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    changed();
  };
  const focusLine = (key: number) =>
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-line="${key}"]`)?.focus());
  function addLine(afterKey?: number) {
    const key = nextKey.current++;
    setLines((cur) => {
      const at = afterKey === undefined ? cur.length : cur.findIndex((l) => l.key === afterKey) + 1;
      return [...cur.slice(0, at), { key, body: '', done: false }, ...cur.slice(at)];
    });
    focusLine(key);
  }
  function removeLine(key: number) {
    const at = lines.findIndex((l) => l.key === key);
    setLines((cur) => cur.filter((l) => l.key !== key));
    changed();
    if (at > 0) focusLine(lines[at - 1].key);
  }

  /** Something done to the note as a whole: saved first, so nothing typed is lost. */
  function run(act: () => Promise<{ ok: boolean }>, leave = false) {
    setError(null);
    startTransition(async () => {
      await save();
      const res = await act();
      if (!res.ok) return setError(t('common.error'));
      if (leave) router.push('/space');
      router.refresh();
    });
  }

  // A reminder from a note: its title, and the rest as the reminder's notes.
  const reminderTitle = title.trim() || body.trim().split('\n')[0] || lines[0]?.body || '';
  const reminderNotes = [title.trim() ? body.trim() : body.trim().split('\n').slice(1).join('\n').trim(), ...lines.filter((l) => !l.done && l.body.trim()).map((l) => `- ${l.body.trim()}`)]
    .filter(Boolean)
    .join('\n');

  return (
    <article>
      <div className="mb-2 flex items-center justify-between gap-2 md:justify-end">
        <SpaceBack />
        <span className="text-[12px] text-subtle" aria-live="polite">
          {saving === 'saving' ? t('space.saving') : saving === 'saved' ? t('space.saved') : saving === 'error' ? <span className="text-late">{t('space.saveError')}</span> : null}
        </span>
      </div>

      <AutoTextarea
        singleLine
        value={title}
        onChange={(e) => { setTitle(e.target.value.replace(/\n/g, ' ')); changed(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('note-body')?.focus();
          }
        }}
        placeholder={t('space.untitled')}
        aria-label={t('space.noteTitle')}
        maxLength={200}
        autoFocus={!note.title && !note.body && note.items.length === 0}
        className="text-[28px] font-bold leading-tight tracking-tight"
      />

      <div className="mt-1.5">
        <Meta note={note} />
      </div>

      <div className="-ml-1.5 mt-2 flex flex-wrap gap-x-1 border-b border-border pb-2">
        <button className={action} disabled={pending} onClick={() => run(() => setNotePinned(note.id, !note.pinned))}>
          {note.pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden /> : <Pin className="h-3.5 w-3.5" aria-hidden />}
          {note.pinned ? t('note.unpin') : t('note.pin')}
        </button>
        <button className={action} disabled={pending} onClick={() => setSharing(true)}>
          <Users className="h-3.5 w-3.5" aria-hidden />
          {t('space.share')}
        </button>
        <button className={action} disabled={pending || !reminderTitle} onClick={() => setReminding(true)}>
          <BellRing className="h-3.5 w-3.5" aria-hidden />
          {t('note.toReminder')}
        </button>
        <button className={action} disabled={pending} onClick={() => run(() => setNoteArchived(note.id, true), true)}>
          <Archive className="h-3.5 w-3.5" aria-hidden />
          {t('note.archive')}
        </button>
      </div>

      {error && <div className="mt-2"><ErrorState message={error} /></div>}

      <AutoTextarea
        id="note-body"
        value={body}
        onChange={(e) => { setBody(e.target.value); changed(); }}
        placeholder={t('note.placeholder')}
        aria-label={t('note.body')}
        maxLength={4000}
        className="mt-4 min-h-[3rem] text-[15px] leading-relaxed"
      />

      <ul className="mt-3 space-y-0.5">
        {lines.map((line) => (
          <li key={line.key} className="group flex items-start gap-2.5 rounded-md px-1 py-1 hover:bg-surface-2/50">
            <input
              type="checkbox"
              className="mt-[3px] h-4 w-4 shrink-0 accent-accent"
              checked={line.done}
              aria-label={t('note.tick')}
              onChange={(e) => setLine(line.key, { done: e.target.checked })}
            />
            <AutoTextarea
              singleLine
              data-line={line.key}
              value={line.body}
              onChange={(e) => setLine(line.key, { body: e.target.value.replace(/\n/g, ' ') })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLine(line.key);
                } else if (e.key === 'Backspace' && line.body === '') {
                  e.preventDefault();
                  removeLine(line.key);
                }
              }}
              placeholder={t('note.line')}
              aria-label={t('note.line')}
              maxLength={300}
              className={cn('text-[15px] leading-snug', line.done && 'text-muted line-through')}
            />
            <button
              onClick={() => removeLine(line.key)}
              aria-label={t('common.delete')}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-surface-2 hover:text-fg sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button className={cn(action, 'mt-1 text-subtle')} onClick={() => addLine()}>
        <ListChecks className="h-3.5 w-3.5" aria-hidden />
        {t('note.addLine')}
      </button>

      {sharing && <SettingsDialog note={note} onClose={() => setSharing(false)} />}
      {reminding && (
        <ReminderDialog
          open
          viewerId={viewerId}
          initialTitle={reminderTitle.slice(0, 200)}
          initialNotes={reminderNotes || undefined}
          onClose={() => setReminding(false)}
          // The note became a reminder: it leaves the list, still restorable.
          onSaved={() => {
            setReminding(false);
            run(() => setNoteArchived(note.id, true), true);
          }}
        />
      )}
    </article>
  );
}

/** The customer whose file the note is in, and who else reads it. */
function SettingsDialog({ note, onClose }: { note: QuickNote; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [customerId, setCustomerId] = useState<string | null>(note.customer?.id ?? null);
  const [shares, setShares] = useState<string[]>(note.shares.map((s) => s.id));
  const [choices, setChoices] = useState<{ people: { id: string; name: string }[]; customers: { id: string; name: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    loadNoteChoices().then((res) => res.ok && setChoices(res.data));
  }, []);

  // A customer since made inactive still shows under its name.
  const customers = choices
    ? note.customer && !choices.customers.some((c) => c.id === note.customer!.id)
      ? [note.customer, ...choices.customers]
      : choices.customers
    : note.customer
      ? [note.customer]
      : [];

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveNoteSettings({ id: note.id, customer_id: customerId, share_ids: shares });
      if (!res.ok) return setError(res.error === 'not_authorized' ? t('note.errNotAuthorized') : t('common.error'));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('space.share')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label={t('note.shareWith')} hint={t('note.shareHint')}>
          {choices ? (
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {choices.people.map((p) => {
                const on = shares.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setShares(on ? shares.filter((x) => x !== p.id) : [...shares, p.id])}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[12.5px]',
                      on ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg',
                    )}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">…</p>
          )}
        </Field>
        <Field label={t('note.customer')} hint={t('note.customerHint')} htmlFor="note-customer">
          <Combobox
            id="note-customer"
            items={customers}
            value={customerId}
            onChange={setCustomerId}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            getSearchText={(c) => c.name}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------- somebody else's, or archived -------------------- */

function Reader({ note }: { note: QuickNote }) {
  const { t } = useI18n();
  const router = useRouter();
  const archived = Boolean(note.archived_at);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(act: () => Promise<{ ok: boolean }>, leave = false) {
    setError(null);
    startTransition(async () => {
      const res = await act();
      if (!res.ok) return setError(t('common.error'));
      if (leave) router.push('/space/notes/archived');
      router.refresh();
    });
  }

  return (
    <article>
      <SpaceBack />
      <h1 className={cn('break-words text-[28px] font-bold leading-tight tracking-tight', !note.title.trim() && 'text-subtle')}>
        {note.title.trim() || t('space.untitled')}
      </h1>
      <div className="mt-1.5">
        <Meta note={note} />
      </div>

      {note.mine && archived && (
        <div className="-ml-1.5 mt-2 flex flex-wrap gap-x-1 border-b border-border pb-2">
          <button className={action} disabled={pending} onClick={() => run(() => setNoteArchived(note.id, false))}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t('note.restore')}
          </button>
          <button className={action} disabled={pending} onClick={() => window.confirm(t('note.deleteConfirm')) && run(() => deleteNote(note.id), true)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {t('common.delete')}
          </button>
        </div>
      )}
      {error && <div className="mt-2"><ErrorState message={error} /></div>}

      {note.body && <NoteText className="mt-4 text-[15px] leading-relaxed" text={note.body} />}
      {note.items.length > 0 && (
        <ul className="mt-3 space-y-0.5">
          {note.items.map((it) => {
            const done = ticks[it.id] ?? it.done;
            return (
              <li key={it.id}>
                <label className="flex items-start gap-2.5 rounded-md px-1 py-1 hover:bg-surface-2/50">
                  <input
                    type="checkbox"
                    className="mt-[3px] h-4 w-4 shrink-0 accent-accent"
                    checked={done}
                    disabled={archived}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setTicks((cur) => ({ ...cur, [it.id]: next }));
                      run(() => tickNoteItem(it.id, next));
                    }}
                  />
                  <span className={cn('break-words text-[15px] leading-snug', done && 'text-muted line-through')}>{it.body}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
