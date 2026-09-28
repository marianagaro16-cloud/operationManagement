'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ChevronRight, Lock } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Card, EmptyState, ErrorState, Field } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { PageHeader } from '@/components/shell/app-shell';
import { SaveOnEnter } from '@/components/ui/enter-to-save';
import { localizedName, localizedNameDescription } from '@/lib/localized-content';
import { answerEvaluation } from '@/server/hr-eval-actions';
import { RequestStatus, ScaleInput, useEvalError, useScaleLabels } from './evaluation-parts';
import type { Team } from '@/lib/authz';
import type { MyEvaluation } from '@/server/hr-evaluations';

function useTeamLabel() {
  const { t } = useI18n();
  return (team: Team) => (team === 'production' ? t('roles.teamProduction') : t('roles.teamOperations'));
}

/** Everything the viewer was asked to evaluate, still to do first. */
export function MyEvaluationList({ evaluations }: { evaluations: MyEvaluation[] }) {
  const { t } = useI18n();
  const todo = evaluations.filter((e) => !e.assignment.submitted_at && e.request.open);
  const rest = evaluations.filter((e) => !todo.includes(e));

  return (
    <>
      <PageHeader title={t('hrEval.mine')} subtitle={t('hrEval.mineSubtitle')} />
      {evaluations.length === 0 ? (
        <EmptyState title={t('hrEval.noneMine')} />
      ) : (
        <ul className="space-y-2">
          {[...todo, ...rest].map((e) => (
            <li key={e.assignment.id}>
              <EvaluationRow evaluation={e} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function EvaluationRow({ evaluation }: { evaluation: MyEvaluation }) {
  const { t, formatDate } = useI18n();
  const teamLabel = useTeamLabel();
  const { assignment, request } = evaluation;
  return (
    <Link href={`/evaluations/${assignment.id}`} className="block">
      <Card className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-surface-2/60">
        <div className="min-w-0">
          <p className="break-words text-[13.5px] font-medium">{request.worker_name}</p>
          <p className="text-[12px] text-muted">
            {[request.worker_position, teamLabel(request.worker_team)].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {assignment.submitted_at ? (
              <span className="inline-flex items-center gap-1 text-[12px] text-done">
                <Check className="h-3 w-3" aria-hidden />
                {t('hrEval.submittedOn', { date: formatDate(assignment.submitted_at, 'medium') })}
              </span>
            ) : (
              <RequestStatus request={request} />
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
      </Card>
    </Link>
  );
}

/**
 * Filling in one evaluation: a draft until submitted, then final. The
 * evaluator sees who they evaluate — name, position, team — and nothing else
 * of the file.
 */
export function MyEvaluationForm({ evaluation }: { evaluation: MyEvaluation }) {
  const { t, locale, formatDate } = useI18n();
  const router = useRouter();
  const errorText = useEvalError();
  const scale = useScaleLabels();
  const teamLabel = useTeamLabel();
  const { assignment, request, items } = evaluation;

  const initial = new Map(assignment.answers.map((a) => [a.item_id, a]));
  const [scores, setScores] = useState<Record<string, number | null>>(
    Object.fromEntries(items.map((i) => [i.id, initial.get(i.id)?.score ?? null])),
  );
  const [bodies, setBodies] = useState<Record<string, string>>(
    Object.fromEntries(items.map((i) => [i.id, initial.get(i.id)?.body ?? ''])),
  );
  const [comment, setComment] = useState(assignment.comment ?? '');
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const locked = !!assignment.submitted_at || !request.open;
  const complete = items.every((i) => i.kind !== 'scale' || scores[i.id]);

  function save(submit: boolean) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await answerEvaluation({
        assignment_id: assignment.id,
        answers: items.map((i) => ({
          item_id: i.id,
          score: i.kind === 'scale' ? scores[i.id] ?? null : null,
          body: bodies[i.id]?.trim() || null,
        })),
        comment: comment.trim() || null,
        submit,
      });
      setConfirming(false);
      if (!res.ok) return setError(errorText(res.error));
      if (submit) router.refresh();
      else setSaved(true);
    });
  }

  return (
    <>
      <Link href="/evaluations" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('hrEval.mine')}
      </Link>
      <PageHeader
        title={request.worker_name}
        subtitle={[request.worker_position, teamLabel(request.worker_team)].filter(Boolean).join(' · ')}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <RequestStatus request={request} />
      </div>

      {assignment.submitted_at ? (
        <p className="mb-3 flex items-center gap-1.5 text-[12.5px] text-done">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {t('hrEval.submittedDone', { date: formatDate(assignment.submitted_at, 'medium') })}
        </p>
      ) : !request.open ? (
        <p className="mb-3 flex items-center gap-1.5 text-[12.5px] text-muted">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          {t('hrEval.closedNotice')}
        </p>
      ) : (
        <p className="mb-3 text-[12.5px] text-muted">{t('hrEval.formHint', { name: request.worker_name })}</p>
      )}

      <SaveOnEnter onSave={() => save(false)} disabled={pending || locked}>
        <Card className="space-y-4 p-3.5 sm:p-4">
          {items.some((i) => i.kind === 'scale') && (
            <p className="text-[12px] text-muted">{scale.map((label, i) => `${i + 1} = ${label}`).join(' · ')}</p>
          )}
          {items.map((item) => {
            const name = localizedName(item, locale);
            const description = localizedNameDescription(item, locale);
            return (
              <div key={item.id}>
                <p className="break-words text-[13px] font-medium">{name}</p>
                {description && <p className="text-[12px] text-muted">{description}</p>}
                {item.kind === 'scale' && (
                  <ScaleInput
                    label={name}
                    value={scores[item.id]}
                    disabled={locked}
                    onChange={(n) => setScores((s) => ({ ...s, [item.id]: n }))}
                  />
                )}
                {locked ? (
                  bodies[item.id] && (
                    <div className="mt-1 text-[12.5px] text-muted">
                      <NoteText text={bodies[item.id]} />
                    </div>
                  )
                ) : (
                  <NoteTextarea
                    aria-label={`${name} — ${item.kind === 'scale' ? t('hr.criterionDetails') : t('hrEval.yourAnswer')}`}
                    placeholder={item.kind === 'scale' ? t('hr.criterionDetails') : t('hrEval.yourAnswer')}
                    rows={item.kind === 'scale' ? 1 : 3}
                    value={bodies[item.id]}
                    onChange={(e) => setBodies((b) => ({ ...b, [item.id]: e.target.value }))}
                    className="mt-1.5 text-[12.5px]"
                  />
                )}
              </div>
            );
          })}

          {locked ? (
            comment && (
              <div>
                <p className="text-[13px] font-medium">{t('hrEval.generalComment')}</p>
                <div className="mt-0.5 text-[12.5px] text-muted">
                  <NoteText text={comment} />
                </div>
              </div>
            )
          ) : (
            <Field label={t('hrEval.generalComment')} htmlFor="eval-general">
              <NoteTextarea id="eval-general" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          )}
        </Card>
      </SaveOnEnter>

      {error && <div className="mt-3"><ErrorState message={error} /></div>}

      {!locked && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {saved && <span className="text-[12.5px] text-muted">{t('hrEval.draftSaved')}</span>}
          {!complete && <span className="text-[12.5px] text-muted">{t('hrEval.errRateAll')}</span>}
          <Button variant="secondary" onClick={() => save(false)} loading={pending && !confirming}>
            {t('hrEval.saveDraft')}
          </Button>
          <Button variant="primary" onClick={() => setConfirming(true)} disabled={!complete || pending}>
            {t('hrEval.submit')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => save(true)}
        title={t('hrEval.submitTitle')}
        message={t('hrEval.submitBody')}
        confirmLabel={t('hrEval.submit')}
        cancelLabel={t('common.cancel')}
        loading={pending}
      />
    </>
  );
}
