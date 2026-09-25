'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { createClient } from '@/lib/supabase/client';
import { HR_ALLOWED_MIME, HR_BUCKET, HR_MAX_BYTES } from '@/lib/hr';
import { addEvaluation, addNote, recordNoteAttachment } from '@/server/hr-actions';
import { WorkerDialog, useHrError, type HrAccount } from './worker-dialog';
import type { Team } from '@/lib/authz';
import type { HrCriterion, HrEvaluation, HrNoteType, HrStats, HrWorkerFile } from '@/types/hr';

export type HrTab = 'log' | 'evaluations' | 'app';

/**
 * One worker's file: who they are, the log, their evaluations, and — when
 * they use the app — what they did in it over a period.
 */
export function WorkerFile({
  file,
  tab,
  noteTypes,
  criteria,
  stats,
  period,
  accounts,
  teams,
  today,
}: {
  file: HrWorkerFile;
  tab: HrTab;
  noteTypes: HrNoteType[];
  /** The active criteria of this worker's team. */
  criteria: HrCriterion[];
  stats: HrStats | null;
  period: { from: string; to: string };
  accounts: HrAccount[];
  teams: Team[];
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const [editing, setEditing] = useState(false);
  const { worker } = file;
  const teamLabel = (team: Team) => (team === 'production' ? t('roles.teamProduction') : t('roles.teamOperations'));

  const details = [
    worker.position,
    worker.start_date && t('hr.since', { date: formatDate(worker.start_date, 'medium') }),
    worker.phone,
    worker.email,
  ].filter(Boolean) as string[];

  const tabs: { key: HrTab; label: string; count?: number }[] = [
    { key: 'log', label: t('hr.tabLog'), count: file.notes.length },
    { key: 'evaluations', label: t('hr.tabEvaluations'), count: file.evaluations.length },
    { key: 'app', label: t('hr.tabApp') },
  ];

  return (
    <>
      <Link href="/hr" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('hr.navLabel')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold leading-tight">{worker.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
              <span>{teamLabel(worker.team)}</span>
              {!worker.is_active && (
                <Badge tone="neutral">
                  {t('hr.inactive')}
                  {worker.left_on && ` · ${formatDate(worker.left_on, 'medium')}`}
                </Badge>
              )}
            </p>
            {details.length > 0 && (
              <p className="mt-1 break-words text-[12.5px] text-muted">{details.join(' · ')}</p>
            )}
            {worker.address && <p className="mt-0.5 break-words text-[12.5px] text-muted">{worker.address}</p>}
            {worker.emergency_contact && (
              <p className="mt-0.5 break-words text-[12.5px] text-muted">
                {t('hr.emergencyContact')}: {worker.emergency_contact}
              </p>
            )}
          </div>
          <Button size="icon" variant="ghost" aria-label={t('hr.editWorker')} onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </Card>

      <nav className="mb-3 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={`/hr/${worker.id}?tab=${item.key}`}
            scroll={false}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === item.key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className="ml-1.5 text-[11px] tabular text-subtle">{item.count}</span>
            )}
          </Link>
        ))}
      </nav>

      {tab === 'log' && <LogTab file={file} noteTypes={noteTypes} today={today} />}
      {tab === 'evaluations' && <EvaluationsTab file={file} criteria={criteria} today={today} />}
      {tab === 'app' && <AppTab workerId={worker.id} hasAccount={!!worker.profile_id} stats={stats} period={period} />}

      {editing && (
        <WorkerDialog worker={worker} accounts={accounts} teams={teams} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

/* ---------------------------------- log ---------------------------------- */

function LogTab({ file, noteTypes, today }: { file: HrWorkerFile; noteTypes: HrNoteType[]; today: string }) {
  const { t, formatDate } = useI18n();
  const [adding, setAdding] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');

  const shown = typeFilter ? file.notes.filter((n) => n.type?.id === typeFilter) : file.notes;
  // Every type that appears in the log, including one Admin has since switched off.
  const types = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of file.notes) if (n.type) map.set(n.type.id, n.type.name);
    return [...map.entries()];
  }, [file.notes]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {types.length > 1 ? (
          <Select
            aria-label={t('hr.noteType')}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-8 w-auto py-0 text-[12.5px]"
          >
            <option value="">{t('hr.allTypes')}</option>
            {types.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </Select>
        ) : (
          <span />
        )}
        <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('hr.newNote')}
        </Button>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={t('hr.noNotes')} />
      ) : (
        <ul className="space-y-2">
          {shown.map((n) => (
            <li key={n.id}>
              <Card className="p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <span className="tabular font-medium text-fg">{formatDate(n.note_date, 'medium')}</span>
                  {n.type && <Badge tone="accent">{n.type.name}</Badge>}
                  {n.author_name && <span>{t('hr.by', { name: n.author_name })}</span>}
                </div>
                <div className="mt-1.5 text-[13px] leading-relaxed">
                  <NoteText text={n.body} />
                </div>
                {n.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {n.attachments.map((a) =>
                      a.signed_url && a.mime_type.startsWith('image/') ? (
                        <a key={a.id} href={a.signed_url} target="_blank" rel="noreferrer" title={a.file_name}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL */}
                          <img
                            src={a.signed_url}
                            alt={a.file_name}
                            className="h-20 w-20 rounded-md border border-border object-cover"
                          />
                        </a>
                      ) : (
                        <a
                          key={a.id}
                          href={a.signed_url ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-full items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] hover:bg-surface-2"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="truncate">{a.file_name}</span>
                        </a>
                      ),
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <NoteDialog workerId={file.worker.id} noteTypes={noteTypes} today={today} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

function NoteDialog({
  workerId,
  noteTypes,
  today,
  onClose,
}: {
  workerId: string;
  noteTypes: HrNoteType[];
  today: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useHrError();
  const [typeId, setTypeId] = useState(noteTypes[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function pickFiles(list: FileList | null) {
    const picked = [...(list ?? [])];
    const problems: string[] = [];
    const ok = picked.filter((f) => {
      if (!HR_ALLOWED_MIME.includes(f.type)) problems.push(t('hr.errFileType', { name: f.name }));
      else if (f.size > HR_MAX_BYTES) problems.push(t('hr.errFileTooLarge', { name: f.name }));
      else return true;
      return false;
    });
    setErrors(problems);
    setFiles(ok);
  }

  function submit() {
    setErrors([]);
    startTransition(async () => {
      const res = await addNote({ worker_id: workerId, type_id: typeId, note_date: date, body });
      if (!res.ok) return setErrors([errorText(res.error)]);
      const noteId = res.data.id;

      // Straight from the browser to storage: a server action carries at most
      // 1 MB. The storage policy checks the note folder the file goes into.
      const supabase = createClient();
      const failed: string[] = [];
      for (const file of files) {
        const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
        const path = `${noteId}/${crypto.randomUUID()}.${ext}`;
        const upload = await supabase.storage.from(HR_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        const recorded = upload.error
          ? upload
          : await recordNoteAttachment(
              { note_id: noteId, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size },
              workerId,
            );
        if ('error' in recorded && recorded.error) failed.push(t('hr.errFile', { name: file.name }));
      }

      router.refresh();
      if (failed.length === 0) return onClose();
      // The note is saved either way; say which files did not make it.
      setSaved(true);
      setErrors(failed);
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('hr.newNote')}
      description={t('hr.notePermanent')}
      className="max-w-lg"
      footer={
        saved ? (
          <Button variant="primary" onClick={onClose}>{t('common.close')}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={submit} loading={pending} disabled={!body.trim() || !typeId}>
              {t('common.save')}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3.5">
        {errors.map((e) => (
          <ErrorState key={e} message={e} />
        ))}
        {!saved && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('hr.noteType')} htmlFor="note-type">
                <Select id="note-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                  {noteTypes.map((ty) => (
                    <option key={ty.id} value={ty.id}>{ty.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('hr.noteDate')} htmlFor="note-date">
                <Input id="note-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <Field label={t('hr.noteBody')} required htmlFor="note-body">
              <NoteTextarea id="note-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <Field label={t('hr.noteFiles')} htmlFor="note-files">
              <input
                id="note-files"
                type="file"
                multiple
                accept={HR_ALLOWED_MIME.join(',')}
                onChange={(e) => pickFiles(e.target.files)}
                className="block w-full text-[12.5px] file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-[12.5px]"
              />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------ evaluations ------------------------------ */

function EvaluationsTab({ file, criteria, today }: { file: HrWorkerFile; criteria: HrCriterion[]; today: string }) {
  const { t, formatDate } = useI18n();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      {criteria.length === 0 ? (
        <p className="text-[12.5px] text-warn">{t('hr.noCriteria')}</p>
      ) : (
        <div className="flex justify-end">
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('hr.newEvaluation')}
          </Button>
        </div>
      )}

      {file.evaluations.length === 0 ? (
        <EmptyState title={t('hr.noEvaluations')} />
      ) : (
        <ul className="space-y-2">
          {file.evaluations.map((e) => {
            const average = e.scores.length
              ? e.scores.reduce((sum, s) => sum + s.score, 0) / e.scores.length
              : null;
            return (
              <li key={e.id}>
                <Card className="p-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                    <span className="tabular font-medium text-fg">{formatDate(e.evaluated_on, 'medium')}</span>
                    {average !== null && (
                      <Badge tone="accent">
                        {t('hr.average')}: {average.toFixed(1)}
                      </Badge>
                    )}
                    {e.author_name && <span>{t('hr.by', { name: e.author_name })}</span>}
                  </div>
                  <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    {e.scores.map((s) => (
                      <div key={s.criterion_name} className="text-[12.5px]">
                        <div className="flex items-center justify-between gap-2">
                          <dt className="min-w-0 break-words">{s.criterion_name}</dt>
                          <dd className="shrink-0 tabular font-medium">{s.score} / 5</dd>
                        </div>
                        {s.comment && <p className="mt-0.5 break-words text-[12px] text-muted">{s.comment}</p>}
                      </div>
                    ))}
                  </dl>
                  {e.comment && (
                    <div className="mt-2.5">
                      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('hr.comment')}</p>
                      <div className="mt-0.5 text-[13px] leading-relaxed">
                        <NoteText text={e.comment} />
                      </div>
                    </div>
                  )}
                  {e.goals && (
                    <div className="mt-2.5">
                      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('hr.goals')}</p>
                      <div className="mt-0.5 text-[13px] leading-relaxed">
                        <NoteText text={e.goals} />
                      </div>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <EvaluationDialog
          workerId={file.worker.id}
          criteria={criteria}
          previous={file.evaluations[0] ?? null}
          today={today}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function EvaluationDialog({
  workerId,
  criteria,
  previous,
  today,
  onClose,
}: {
  workerId: string;
  criteria: HrCriterion[];
  /** The last evaluation, whose goals this one checks. */
  previous: HrEvaluation | null;
  today: string;
  onClose: () => void;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const errorText = useHrError();
  const [date, setDate] = useState(today);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [details, setDetails] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [goals, setGoals] = useState('');
  // 1 = Muy en desacuerdo … 5 = Totalmente de acuerdo, as on the paper form.
  const scale = [t('hr.scale1'), t('hr.scale2'), t('hr.scale3'), t('hr.scale4'), t('hr.scale5')];
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const complete = criteria.every((c) => scores[c.id]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await addEvaluation({
        worker_id: workerId,
        evaluated_on: date,
        comment: comment.trim() || null,
        goals: goals.trim() || null,
        scores: criteria.map((c) => ({
          criterion_id: c.id,
          score: scores[c.id],
          comment: details[c.id]?.trim() || null,
        })),
      });
      if (!res.ok) return setError(errorText(res.error));
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('hr.newEvaluation')}
      description={t('hr.evaluationPermanent')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!complete}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('hr.evaluatedOn')} htmlFor="eval-date">
          <Input id="eval-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {previous?.goals && (
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
              {t('hr.previousGoals', { date: formatDate(previous.evaluated_on, 'medium') })}
            </p>
            <div className="mt-0.5 text-[13px] leading-relaxed">
              <NoteText text={previous.goals} />
            </div>
          </div>
        )}

        <p className="text-[12px] text-muted">{scale.map((label, i) => `${i + 1} = ${label}`).join(' · ')}</p>

        <div className="space-y-3.5">
          {!complete && <p className="text-[12px] text-muted">{t('hr.rateAll')}</p>}
          {criteria.map((c) => (
            <div key={c.id}>
              <p className="text-[13px] font-medium">{c.name}</p>
              {c.description && <p className="text-[12px] text-muted">{c.description}</p>}
              <div className="mt-1 flex gap-1.5" role="radiogroup" aria-label={c.name}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={scores[c.id] === n}
                    onClick={() => setScores((s) => ({ ...s, [c.id]: n }))}
                    className={cn(
                      'h-9 w-9 rounded-lg border text-[13px] font-medium tabular transition-colors',
                      scores[c.id] === n
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-border bg-surface hover:bg-surface-2',
                    )}
                  >
                    {n}
                  </button>
                ))}
                {scores[c.id] && (
                  <span className="self-center text-[12px] text-muted">{scale[scores[c.id] - 1]}</span>
                )}
              </div>
              <NoteTextarea
                aria-label={`${c.name} — ${t('hr.criterionDetails')}`}
                placeholder={t('hr.criterionDetails')}
                rows={1}
                value={details[c.id] ?? ''}
                onChange={(e) => setDetails((d) => ({ ...d, [c.id]: e.target.value }))}
                className="mt-1.5 text-[12.5px]"
              />
            </div>
          ))}
        </div>

        <Field label={t('hr.comment')} htmlFor="eval-comment">
          <NoteTextarea id="eval-comment" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>

        <Field label={t('hr.goals')} htmlFor="eval-goals">
          <NoteTextarea id="eval-goals" rows={3} value={goals} onChange={(e) => setGoals(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------- app data ------------------------------- */

function AppTab({
  workerId,
  hasAccount,
  stats,
  period,
}: {
  workerId: string;
  hasAccount: boolean;
  stats: HrStats | null;
  period: { from: string; to: string };
}) {
  const { t } = useI18n();

  if (!hasAccount) return <EmptyState title={t('hr.noAccount')} />;

  const rows: { label: string; value: number }[] = stats
    ? [
        { label: t('hr.statActivitiesCompleted'), value: stats.activities_completed },
        { label: t('hr.statActivitiesSkipped'), value: stats.activities_skipped },
        { label: t('hr.statActivitiesNotDone'), value: stats.activities_not_done },
        { label: t('hr.statIncidents'), value: stats.incidents_reported },
        { label: t('hr.statOrdersPrepared'), value: stats.orders_prepared },
        { label: t('hr.statOrdersShipped'), value: stats.orders_shipped },
        { label: t('hr.statInventories'), value: stats.inventories_counted },
        { label: t('hr.statInventoryLines'), value: stats.inventory_lines },
      ]
    : [];

  return (
    <div className="space-y-3">
      {/* A plain GET form: the period lives in the URL, so the page recomputes it. */}
      <form action={`/hr/${workerId}`} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="app" />
        <Field label={t('hr.from')} htmlFor="app-from">
          <Input id="app-from" name="from" type="date" defaultValue={period.from} className="w-auto" />
        </Field>
        <Field label={t('hr.to')} htmlFor="app-to">
          <Input id="app-to" name="to" type="date" defaultValue={period.to} className="w-auto" />
        </Field>
        <Button type="submit" variant="secondary">{t('common.filter')}</Button>
      </form>
      <p className="text-[12px] text-muted">{t('hr.periodHint')}</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rows.map((r) => (
          <Card key={r.label} className="p-3">
            <p className="text-2xl font-semibold tabular">{r.value}</p>
            <p className="mt-0.5 text-[12px] leading-tight text-muted">{r.label}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
