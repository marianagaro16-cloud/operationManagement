'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Pencil, Plus, Send } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { createClient } from '@/lib/supabase/client';
import { HR_ALLOWED_MIME, HR_BUCKET, HR_MAX_BYTES } from '@/lib/hr';
import { localizedName, localizedNameDescription } from '@/lib/localized-content';
import { addEvaluation } from '@/server/hr-actions';
import { WorkerDialog, useHrError, type HrAccount } from './worker-dialog';
import type { Team } from '@/lib/authz';
import type { HrCriterion, HrEvalRequest, HrEvalTemplate, HrEvaluation, HrKey, HrLateArrival, HrLateReason, HrNoteType, HrPerson, HrStats, HrWorkerFile } from '@/types/hr';
import { LateSinceEvaluation, LateTab } from './late-arrivals';
import { LogTab } from './note-log';
import { KeyRegister } from './key-register';
import type { MeetingRecord } from '@/types/meetings';
import { QuickReminderButton } from '@/components/reminders/reminder-actions';
import { RequestStatus } from './evaluation-parts';
import { teamLabelKey } from '@/lib/authz';

export type HrTab = 'log' | 'late' | 'keys' | 'evaluations' | 'app';

/**
 * One worker's file: who they are, the log, their evaluations, and — when
 * they use the app — what they did in it over a period.
 */
export function WorkerFile({
  file,
  tab,
  noteTypes,
  criteria,
  templates,
  stats,
  period,
  accounts,
  teams,
  today,
  evalRequests,
  isAdmin,
  lateArrivals,
  lateReasons,
  keys,
  meetings,
  viewerId,
  viewerName,
  people,
  earlyTolerance = 10,
}: {
  /** Minutes before the agreed time that are still fine. */
  earlyTolerance?: number;
  /** Late arrivals, newest first, and the reasons to pick from. */
  lateArrivals: HrLateArrival[];
  lateReasons: HrLateReason[];
  /** The keys this worker holds or held. */
  keys: HrKey[];
  /** The registered meetings this worker attended; they read as part of the log. */
  meetings: MeetingRecord[];
  viewerId: string;
  viewerName: string;
  /** Whom a note's participants are picked from, without the viewer. */
  people: HrPerson[];
  file: HrWorkerFile;
  tab: HrTab;
  noteTypes: HrNoteType[];
  /** The active criteria of this worker's team: the general ones and every template's. */
  criteria: HrCriterion[];
  /** The team's evaluation templates — criteria for one job. */
  templates: HrEvalTemplate[];
  stats: HrStats | null;
  period: { from: string; to: string };
  accounts: HrAccount[];
  teams: Team[];
  today: string;
  /** Evaluations sent to several people about this worker; read on the Evaluations tab. */
  evalRequests: HrEvalRequest[];
  /** Only Admin sends them. */
  isAdmin: boolean;
}) {
  const { t, formatDate } = useI18n();
  const [editing, setEditing] = useState(false);
  const { worker } = file;
  const teamLabel = (team: Team) => (t(teamLabelKey(team)));

  const details = [
    worker.position,
    worker.start_date && t('hr.since', { date: formatDate(worker.start_date, 'medium') }),
    worker.birth_date && t('hr.born', { date: formatDate(worker.birth_date, 'medium') }),
    worker.phone,
    worker.email,
  ].filter(Boolean) as string[];

  const tabs: { key: HrTab; label: string; count?: number }[] = [
    { key: 'log', label: t('hr.tabLog'), count: file.notes.length + meetings.length },
    { key: 'late', label: t('hrLate.tab'), count: lateArrivals.length },
    { key: 'keys', label: t('hrKey.tab'), count: keys.filter((k) => !k.returned_on).length },
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
          <div className="flex shrink-0 gap-0.5">
            {/* The whole file, to print or save as PDF. */}
            <a
              href={`/print/hr/${worker.id}`}
              target="_blank"
              rel="noreferrer"
              aria-label={t('hrExport.pdf')}
              title={t('hrExport.pdf')}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <FileText className="h-4 w-4" aria-hidden />
              PDF
            </a>
            <Button size="icon" variant="ghost" aria-label={t('hr.editWorker')} onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden />
            </Button>
          </div>
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

      {tab === 'log' && (
        <LogTab file={file} meetings={meetings} noteTypes={noteTypes} people={people} today={today} viewerId={viewerId} viewerName={viewerName} isAdmin={isAdmin} />
      )}
      {tab === 'keys' && <KeyRegister keys={keys} worker={{ id: worker.id, name: worker.name }} today={today} isAdmin={isAdmin} />}
      {tab === 'late' && (
        <LateTab
          workerId={worker.id}
          arrivals={lateArrivals}
          reasons={lateReasons}
          viewerId={viewerId}
          today={today}
          lastEvaluationOn={file.evaluations[0]?.evaluated_on ?? null}
          tolerance={earlyTolerance}
        />
      )}
      {tab === 'evaluations' && <LateSinceEvaluation arrivals={lateArrivals} since={file.evaluations[0]?.evaluated_on ?? null} />}
      {tab === 'evaluations' && (
        <EvaluationsTab file={file} criteria={criteria} templates={templates} today={today} evalRequests={evalRequests} isAdmin={isAdmin} />
      )}
      {tab === 'app' && <AppTab workerId={worker.id} hasAccount={!!worker.profile_id} stats={stats} period={period} />}

      {editing && (
        <WorkerDialog worker={worker} accounts={accounts} teams={teams} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

/* ------------------------------ evaluations ------------------------------ */

function EvaluationsTab({
  file,
  criteria,
  templates,
  today,
  evalRequests,
  isAdmin,
}: {
  file: HrWorkerFile;
  criteria: HrCriterion[];
  templates: HrEvalTemplate[];
  today: string;
  evalRequests: HrEvalRequest[];
  isAdmin: boolean;
}) {
  const { t, locale, formatDate } = useI18n();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      {criteria.length === 0 && <p className="text-[12.5px] text-warn">{t('hr.noCriteria')}</p>}
      {(criteria.length > 0 || isAdmin) && (
        <div className="flex flex-wrap justify-end gap-2">
          {isAdmin && (
            <Link href={`/hr/${file.worker.id}/send`}>
              <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
                <Send className="h-3.5 w-3.5" aria-hidden />
                {t('hrEval.send')}
              </span>
            </Link>
          )}
          {criteria.length > 0 && (
            <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('hr.newEvaluation')}
            </Button>
          )}
        </div>
      )}

      {/* Sent to several people: each opens its overview. */}
      {evalRequests.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('hrEval.sent')}</p>
          <ul className="space-y-2">
            {evalRequests.map((r) => (
              <li key={r.id}>
                <Link href={`/hr/evaluations/${r.id}`} className="block">
                  <Card className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-surface-2/60">
                    <div className="min-w-0 space-y-1">
                      <p className="text-[12.5px] text-muted">
                        <span className="tabular font-medium text-fg">{formatDate(r.created_at, 'medium')}</span>
                        {' · '}
                        {t('hrEval.answered', { submitted: r.submitted, invited: r.invited })}
                      </p>
                      <RequestStatus request={r} />
                    </div>
                    <span className="shrink-0 text-[12.5px] font-medium text-accent">{t('hrEval.viewOverview')}</span>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {file.evaluations.length === 0 ? (
        evalRequests.length === 0 && <EmptyState title={t('hr.noEvaluations')} />
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
                          <dt className="min-w-0 break-words">
                            {localizedName({ name: s.criterion_name, translations: s.criterion_translations }, locale)}
                          </dt>
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
          templates={templates}
          position={file.worker.position}
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
  criteria: allCriteria,
  templates,
  position,
  previous,
  today,
  onClose,
}: {
  workerId: string;
  /** The team's general criteria and every template's. */
  criteria: HrCriterion[];
  templates: HrEvalTemplate[];
  /** The worker's position: a template of the same name is the likely choice. */
  position: string | null;
  /** The last evaluation, whose goals this one checks. */
  previous: HrEvaluation | null;
  today: string;
  onClose: () => void;
}) {
  const { t, locale, formatDate } = useI18n();
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

  // General, or a template: the one named like the worker's position, if any.
  const [templateId, setTemplateId] = useState<string>(
    templates.find((tpl) => position && tpl.name.trim().toLowerCase() === position.trim().toLowerCase())?.id ?? '',
  );
  const criteria = allCriteria.filter((c) => (c.template_id ?? '') === templateId);
  const complete = criteria.length > 0 && criteria.every((c) => scores[c.id]);

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
        {templates.length > 0 && (
          <Field label={t('hr.template')} htmlFor="eval-template">
            <Select id="eval-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">{t('hr.templateGeneral')}</option>
              {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{localizedName(tpl, locale)}</option>)}
            </Select>
          </Field>
        )}

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
              <p className="text-[13px] font-medium">{localizedName(c, locale)}</p>
              {localizedNameDescription(c, locale) && (
                <p className="text-[12px] text-muted">{localizedNameDescription(c, locale)}</p>
              )}
              <div className="mt-1 flex gap-1.5" role="radiogroup" aria-label={localizedName(c, locale)}>
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
                aria-label={`${localizedName(c, locale)} — ${t('hr.criterionDetails')}`}
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
