'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarClock, Lock, UserPlus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, ErrorState, Field, Input } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { PageHeader } from '@/components/shell/app-shell';
import { PeoplePicker } from '@/components/tasks/people-picker';
import { localizedName, localizedNameDescription } from '@/lib/localized-content';
import {
  closeEvaluation,
  inviteEvaluators,
  setEvaluationDeadline,
  uninviteEvaluator,
} from '@/server/hr-eval-actions';
import { RequestStatus, useEvalError, useScaleLabels } from './evaluation-parts';
import type { OneOffPerson } from '@/components/calendar/one-off-dialog';
import type { HrEvalRequestDetail } from '@/server/hr-evaluations';
import type { HrEvalAssignment, HrEvalItem } from '@/types/hr';

/**
 * One sent evaluation. Everyone who sees the file reads the overview —
 * combined, without names, from three answers. Admin also manages it and can
 * open each evaluator's answers.
 */
export function EvalRequestView({
  detail,
  isAdmin,
  people,
  today,
}: {
  detail: HrEvalRequestDetail;
  isAdmin: boolean;
  /** Who can still be added: Admin only. */
  people: OneOffPerson[];
  today: string;
}) {
  const { t, locale } = useI18n();
  const { request, items, overview, assignments } = detail;
  const scale = useScaleLabels();
  const itemName = (i: HrEvalItem) => localizedName(i, locale);

  return (
    <>
      <Link
        href={`/hr/${request.worker_id}?tab=evaluations`}
        className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {request.worker_name}
      </Link>
      <PageHeader
        title={t('hrEval.overviewTitle', { name: request.worker_name })}
        subtitle={t('hrEval.answered', { submitted: overview.submitted, invited: overview.invited })}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RequestStatus request={request} />
      </div>

      {isAdmin && <AdminActions detail={detail} people={people} today={today} />}

      <Card className="mb-4 p-3.5 sm:p-4">
        <h2 className="mb-2 text-[14px] font-semibold">{t('hrEval.overview')}</h2>
        {!overview.shown ? (
          <p className="flex items-start gap-2 text-[12.5px] text-muted">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('hrEval.overviewHidden')}
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-[12px] text-muted">{scale.map((label, i) => `${i + 1} = ${label}`).join(' · ')}</p>
            {items.map((item) => {
              const result = overview.items?.find((r) => r.item_id === item.id);
              const total = result?.distribution.reduce((a, b) => a + b, 0) ?? 0;
              return (
                <div key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-[13px] font-medium">{itemName(item)}</p>
                      {localizedNameDescription(item, locale) && (
                        <p className="text-[12px] text-muted">{localizedNameDescription(item, locale)}</p>
                      )}
                    </div>
                    {item.kind === 'scale' && result?.average != null && (
                      <Badge tone="accent" className="shrink-0">
                        {t('hr.average')}: {Number(result.average).toFixed(1)}
                      </Badge>
                    )}
                  </div>
                  {item.kind === 'scale' && result && (
                    <div className="mt-1.5 space-y-1">
                      {result.distribution.map((count, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11.5px]">
                          <span className="w-3 tabular text-muted">{i + 1}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                            <div
                              className="h-full rounded-full bg-accent"
                              style={{ width: total ? `${(count / total) * 100}%` : 0 }}
                            />
                          </div>
                          <span className="w-5 text-right tabular text-muted">{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {result && result.texts.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {result.texts.map((text, i) => (
                        <li key={i} className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed">
                          <NoteText text={text} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.kind === 'text' && result && result.texts.length === 0 && (
                    <p className="mt-1 text-[12px] text-muted">{t('hrEval.noWrittenAnswers')}</p>
                  )}
                </div>
              );
            })}
            {(overview.comments?.length ?? 0) > 0 && (
              <div>
                <p className="text-[13px] font-medium">{t('hrEval.generalComments')}</p>
                <ul className="mt-1.5 space-y-1.5">
                  {overview.comments!.map((text, i) => (
                    <li key={i} className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed">
                      <NoteText text={text} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      {isAdmin && assignments && (
        <Evaluators detail={detail} assignments={assignments} />
      )}
    </>
  );
}

/* ------------------------------ Admin only ------------------------------ */

function AdminActions({ detail, people, today }: { detail: HrEvalRequestDetail; people: OneOffPerson[]; today: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useEvalError();
  const { request } = detail;
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [changing, setChanging] = useState(false);
  const [deadline, setDeadline] = useState(request.deadline >= today ? request.deadline : today);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, done: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(errorText(res.error ?? ''));
      done();
      router.refresh();
    });
  };

  // Closed early is final; past its deadline, a new deadline opens it again.
  if (request.closed_at) return null;

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap gap-2">
        {request.open && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={people.length === 0}>
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            {t('hrEval.addEvaluators')}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          {t('hrEval.changeDeadline')}
        </Button>
        {request.open && (
          <Button size="sm" variant="ghost" onClick={() => setClosing(true)}>
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {t('hrEval.closeNow')}
          </Button>
        )}
      </div>
      {error && <ErrorState message={error} />}

      {adding && (
        <Dialog
          open
          onClose={() => setAdding(false)}
          title={t('hrEval.addEvaluators')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAdding(false)} disabled={pending}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                loading={pending}
                disabled={chosen.length === 0}
                onClick={() =>
                  run(() => inviteEvaluators(request.id, request.worker_id, chosen), () => {
                    setChosen([]);
                    setAdding(false);
                  })
                }
              >
                {t('hrEval.sendAction')}
              </Button>
            </>
          }
        >
          <PeoplePicker people={people} selected={chosen} onChange={setChosen} className="max-h-72" />
        </Dialog>
      )}

      {changing && (
        <Dialog
          open
          onClose={() => setChanging(false)}
          title={t('hrEval.changeDeadline')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setChanging(false)} disabled={pending}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                loading={pending}
                disabled={deadline < today}
                onClick={() => run(() => setEvaluationDeadline(request.id, request.worker_id, deadline), () => setChanging(false))}
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <Field label={t('hrEval.deadline')} hint={t('hrEval.deadlineHint')} htmlFor="new-deadline">
            <Input id="new-deadline" type="date" min={today} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
        </Dialog>
      )}

      <ConfirmDialog
        open={closing}
        onClose={() => setClosing(false)}
        onConfirm={() => run(() => closeEvaluation(request.id, request.worker_id), () => setClosing(false))}
        title={t('hrEval.closeTitle')}
        message={t('hrEval.closeBody')}
        confirmLabel={t('hrEval.closeNow')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={pending}
      />
    </div>
  );
}

function Evaluators({ detail, assignments }: { detail: HrEvalRequestDetail; assignments: HrEvalAssignment[] }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const errorText = useEvalError();
  const { request } = detail;
  const [reading, setReading] = useState<HrEvalAssignment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(a: HrEvalAssignment) {
    setError(null);
    startTransition(async () => {
      const res = await uninviteEvaluator(a.id, request.id, request.worker_id);
      if (!res.ok) return setError(errorText(res.error));
      router.refresh();
    });
  }

  return (
    <Card className="p-3.5 sm:p-4">
      <h2 className="text-[14px] font-semibold">{t('hrEval.evaluatorList')}</h2>
      <p className="mb-2 flex items-center gap-1.5 text-[12px] text-muted">
        <Lock className="h-3 w-3" aria-hidden />
        {t('hrEval.namesAdminOnly')}
      </p>
      {error && <ErrorState message={error} />}
      <ul className="divide-y divide-border">
        {assignments.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0 break-words text-[13px]">{a.evaluator_name ?? '—'}</span>
            <span className="flex items-center gap-2">
              {a.submitted_at ? (
                <>
                  <Badge tone="done">{t('hrEval.submittedOn', { date: formatDate(a.submitted_at, 'medium') })}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => setReading(a)}>{t('hrEval.viewAnswers')}</Button>
                </>
              ) : (
                <>
                  <Badge tone="warn">{t('hrEval.pending')}</Badge>
                  {request.open && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(a)}>
                      {t('hrEval.remove')}
                    </Button>
                  )}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {reading && (
        <AnswersDialog assignment={reading} items={detail.items} onClose={() => setReading(null)} />
      )}
    </Card>
  );
}

function AnswersDialog({
  assignment,
  items,
  onClose,
}: {
  assignment: HrEvalAssignment;
  items: HrEvalItem[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const scale = useScaleLabels();
  return (
    <Dialog open onClose={onClose} title={t('hrEval.answersOf', { name: assignment.evaluator_name ?? '—' })} className="max-w-lg">
      <div className="space-y-3">
        {items.map((item) => {
          const answer = assignment.answers.find((x) => x.item_id === item.id);
          return (
            <div key={item.id}>
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-[13px] font-medium">{localizedName(item, locale)}</p>
                {item.kind === 'scale' && answer?.score && (
                  <span className="shrink-0 text-[12.5px] tabular font-medium">
                    {answer.score} / 5 · {scale[answer.score - 1]}
                  </span>
                )}
              </div>
              {answer?.body && (
                <div className="mt-0.5 text-[12.5px] text-muted">
                  <NoteText text={answer.body} />
                </div>
              )}
            </div>
          );
        })}
        {assignment.comment && (
          <div>
            <p className="text-[13px] font-medium">{t('hrEval.generalComment')}</p>
            <div className="mt-0.5 text-[12.5px] text-muted">
              <NoteText text={assignment.comment} />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
