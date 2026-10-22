'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, ErrorState, Input } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { localizedName } from '@/lib/localized-content';
import { checklistState, entryDone, type ChecklistFacts } from '@/domain/hr/checklists';
import { deleteChecklist, setChecklistDue, setChecklistNote, startChecklist, tickChecklistEntry } from '@/server/hr-actions';
import type { HrChecklist, HrWorker } from '@/types/hr';
import { useHrError } from './worker-dialog';

/**
 * A worker's Ingreso and Salida lists. Items the app knows about (keys, the
 * account, required trainings) read as done while that holds; anything can
 * also be ticked by hand, which keeps who and when.
 */
export function ChecklistTab({ worker, lists, facts, today }: { worker: HrWorker; lists: HrChecklist[]; facts: ChecklistFacts; today: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useHrError();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const has = (phase: HrChecklist['phase']) => lists.some((l) => l.phase === phase);

  function run(action: () => ReturnType<typeof startChecklist>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(errorText(res.error));
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} />}
      {(!has('start') || (!has('leave') && !worker.is_active)) && (
        <div className="flex flex-wrap justify-end gap-2">
          {!has('start') && (
            <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => startChecklist(worker.id, 'start'))}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('hrChecklist.startList')}
            </Button>
          )}
          {!has('leave') && !worker.is_active && (
            <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => startChecklist(worker.id, 'leave'))}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('hrChecklist.startLeave')}
            </Button>
          )}
        </div>
      )}
      {lists.length === 0 && <p className="text-[12.5px] text-muted">{t('hrChecklist.none')}</p>}
      {lists.map((list) => (
        <ChecklistCard key={list.id} worker={worker} list={list} facts={facts} today={today} />
      ))}
    </div>
  );
}

function ChecklistCard({ worker, list, facts, today }: { worker: HrWorker; list: HrChecklist; facts: ChecklistFacts; today: string }) {
  const { t, locale, formatDate } = useI18n();
  const router = useRouter();
  const errorText = useHrError();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [noteFor, setNoteFor] = useState<HrChecklist['entries'][number] | null>(null);
  const state = checklistState(list, list.entries, facts, today);

  function run(action: () => ReturnType<typeof tickChecklistEntry>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(errorText(res.error));
      router.refresh();
    });
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2">
        <h3 className="text-[13.5px] font-semibold">{list.phase === 'start' ? t('hrChecklist.start') : t('hrChecklist.leave')}</h3>
        <span className="text-[12px] tabular text-muted">{t('hrChecklist.progress', { done: state.total - state.open, total: state.total })}</span>
        {state.open === 0 ? (
          <Badge tone="done">{t('hrChecklist.complete')}</Badge>
        ) : state.overdue ? (
          <Badge tone="late">{t('hrChecklist.late')}</Badge>
        ) : null}
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
          {t('hrChecklist.due')}
          <Input
            type="date"
            className="h-8 w-[9.5rem]"
            defaultValue={list.due_on}
            onBlur={(e) => e.target.value && e.target.value !== list.due_on && run(() => setChecklistDue(worker.id, list.id, e.target.value))}
          />
        </label>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('hrChecklist.remove')}
          title={t('hrChecklist.remove')}
          disabled={pending}
          onClick={() => window.confirm(t('hrChecklist.removeConfirm')) && run(() => deleteChecklist(worker.id, list.id))}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      {error && <div className="px-3.5 pt-2"><ErrorState message={error} /></div>}
      <ul className="divide-y divide-border">
        {list.entries.map((e) => {
          const done = entryDone(e, list.phase, facts);
          return (
            <li key={e.id} className="flex items-start gap-2.5 px-3.5 py-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                checked={Boolean(done)}
                // Done by the app: nothing to untick; the fact decides.
                disabled={pending || done === 'app'}
                onChange={(ev) => run(() => tickChecklistEntry(worker.id, e.id, ev.target.checked))}
                aria-label={localizedName(e, locale)}
              />
              <div className="min-w-0 flex-1">
                <p className={cn('break-words text-[13px]', done && 'text-muted line-through')}>{localizedName(e, locale)}</p>
                <p className="text-[11.5px] text-muted">
                  {done === 'app' && (
                    <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" aria-hidden />{t('hrChecklist.byApp')}</span>
                  )}
                  {done === 'hand' && e.done_at && t('hrChecklist.doneBy', { name: e.done_by_name ?? '—', date: formatDate(e.done_at.slice(0, 10), 'medium') })}
                  {!done && e.auto && (
                    <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" aria-hidden />{t('hrChecklist.autoHint')}</span>
                  )}
                </p>
                {e.note && <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px]">{e.note}</p>}
              </div>
              <Button size="icon" variant="ghost" aria-label={t('hrChecklist.noteEdit')} title={t('hrChecklist.noteEdit')} onClick={() => setNoteFor(e)}>
                <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
      {noteFor && (
        <NoteDialog
          initial={noteFor.note ?? ''}
          pending={pending}
          onClose={() => setNoteFor(null)}
          onSave={(note) => {
            const entry = noteFor;
            setNoteFor(null);
            run(() => setChecklistNote(worker.id, entry.id, note));
          }}
        />
      )}
    </Card>
  );
}

function NoteDialog({ initial, pending, onClose, onSave }: { initial: string; pending: boolean; onClose: () => void; onSave: (note: string) => void }) {
  const { t } = useI18n();
  const [note, setNote] = useState(initial);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('hrChecklist.noteEdit')}
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => onSave(note)} loading={pending}>{t('common.save')}</Button>
        </>
      }
    >
      <NoteTextarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('hrChecklist.note')} autoFocus />
    </Dialog>
  );
}
