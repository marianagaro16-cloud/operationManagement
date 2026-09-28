'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, Checkbox, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { PeoplePicker } from '@/components/tasks/people-picker';
import { localizedName, localizedNameDescription } from '@/lib/localized-content';
import { sendEvaluation } from '@/server/hr-eval-actions';
import { useEvalError } from './evaluation-parts';
import type { OneOffPerson } from '@/components/calendar/one-off-dialog';
import type { Team } from '@/lib/authz';
import type { HrCriterion, HrWorker } from '@/types/hr';

interface Question {
  key: string;
  kind: 'scale' | 'text';
  name: string;
  description: string;
  de: { name: string; description: string };
  en: { name: string; description: string };
}

const blankQuestion = (): Question => ({
  key: crypto.randomUUID(),
  kind: 'scale',
  name: '',
  description: '',
  de: { name: '', description: '' },
  en: { name: '', description: '' },
});

/**
 * Admin sends an evaluation of one worker to several people: which criteria,
 * which of their own questions, who, and until when.
 */
export function SendEvaluation({
  worker,
  criteria,
  people,
  defaultDeadline,
  today,
}: {
  worker: HrWorker;
  /** Every active criterion, of every team. */
  criteria: HrCriterion[];
  /** Approved accounts, the worker's own left out. */
  people: OneOffPerson[];
  defaultDeadline: string;
  today: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const errorText = useEvalError();
  // The worker's own team's criteria are the likely answer.
  const [picked, setPicked] = useState<string[]>(criteria.filter((c) => c.team === worker.team).map((c) => c.id));
  const [questions, setQuestions] = useState<Question[]>([]);
  const [evaluators, setEvaluators] = useState<string[]>([]);
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const teamLabel = (team: Team) => (team === 'production' ? t('roles.teamProduction') : t('roles.teamOperations'));
  const teams = [...new Set(criteria.map((c) => c.team))].sort((a) => (a === worker.team ? -1 : 1));
  const filled = questions.filter((q) => q.name.trim());
  const canSend = (picked.length > 0 || filled.length > 0) && evaluators.length > 0 && deadline >= today;

  const update = (key: string, patch: Partial<Question>) =>
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)));

  function submit() {
    if (!canSend) return;
    setError(null);
    startTransition(async () => {
      const res = await sendEvaluation({
        worker_id: worker.id,
        deadline,
        evaluator_ids: evaluators,
        items: [
          // In the lists' own order, then the questions as written.
          ...criteria.filter((c) => picked.includes(c.id)).map((c) => ({ criterion_id: c.id })),
          ...filled.map((q) => ({
            kind: q.kind,
            name: q.name.trim(),
            description: q.description.trim() || null,
            translations: {
              de: { name: q.de.name.trim() || null, description: q.de.description.trim() || null },
              en: { name: q.en.name.trim() || null, description: q.en.description.trim() || null },
            },
          })),
        ],
      });
      if (!res.ok) return setError(errorText(res.error));
      router.push(`/hr/evaluations/${res.data.id}`);
    });
  }

  return (
    <>
      <Link href={`/hr/${worker.id}?tab=evaluations`} className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {worker.name}
      </Link>
      <PageHeader title={t('hrEval.sendTitle', { name: worker.name })} subtitle={t('hrEval.sendHint', { name: worker.name })} />

      {/* No Enter-to-send: sending tells people, so it stays a click. */}
        <div className="space-y-4">
          <Card className="space-y-3 p-3.5 sm:p-4">
            <div>
              <h2 className="text-[14px] font-semibold">{t('hrEval.criteria')}</h2>
              <p className="text-[12px] text-muted">{t('hrEval.criteriaHint')}</p>
            </div>
            {criteria.length === 0 && <p className="text-[12.5px] text-muted">{t('hr.noCriteria')}</p>}
            {teams.map((team) => (
              <div key={team} className="space-y-2">
                <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{teamLabel(team)}</p>
                {criteria.filter((c) => c.team === team).map((c) => (
                  <Checkbox
                    key={c.id}
                    label={localizedName(c, locale)}
                    hint={localizedNameDescription(c, locale) ?? undefined}
                    checked={picked.includes(c.id)}
                    onChange={(e) =>
                      setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((id) => id !== c.id)))
                    }
                  />
                ))}
              </div>
            ))}
          </Card>

          <Card className="space-y-3 p-3.5 sm:p-4">
            <h2 className="text-[14px] font-semibold">{t('hrEval.ownQuestions')}</h2>
            {questions.map((q, index) => (
              <div key={q.key} className="space-y-2.5 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-muted">#{index + 1}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('hrEval.removeQuestion')}
                    className="h-7 w-7 text-muted hover:text-late"
                    onClick={() => setQuestions((qs) => qs.filter((x) => x.key !== q.key))}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
                <Select
                  aria-label={t('hrEval.kindScale')}
                  value={q.kind}
                  onChange={(e) => update(q.key, { kind: e.target.value as Question['kind'] })}
                >
                  <option value="scale">{t('hrEval.kindScale')}</option>
                  <option value="text">{t('hrEval.kindText')}</option>
                </Select>
                <Field label={t('hrEval.question')} htmlFor={`q-${q.key}`} required>
                  <Input id={`q-${q.key}`} value={q.name} onChange={(e) => update(q.key, { name: e.target.value })} />
                </Field>
                <Field label={t('hrEval.questionDescription')} htmlFor={`qd-${q.key}`}>
                  <Input
                    id={`qd-${q.key}`}
                    value={q.description}
                    onChange={(e) => update(q.key, { description: e.target.value })}
                  />
                </Field>
                {(['de', 'en'] as const).map((lang) => (
                  <Field key={lang} label={lang === 'de' ? 'Deutsch' : 'English'} hint={lang === 'de' ? t('admin.translationsHint') : undefined}>
                    <div className="space-y-1.5">
                      <Input
                        aria-label={`${lang} — ${t('hrEval.question')}`}
                        placeholder={q.name}
                        value={q[lang].name}
                        onChange={(e) => update(q.key, { [lang]: { ...q[lang], name: e.target.value } })}
                      />
                      <Input
                        aria-label={`${lang} — ${t('hrEval.questionDescription')}`}
                        placeholder={q.description || t('hrEval.questionDescription')}
                        value={q[lang].description}
                        onChange={(e) => update(q.key, { [lang]: { ...q[lang], description: e.target.value } })}
                      />
                    </div>
                  </Field>
                ))}
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('hrEval.addQuestion')}
            </Button>
          </Card>

          <Card className="space-y-3 p-3.5 sm:p-4">
            <Field label={t('hrEval.evaluators')} hint={t('hrEval.evaluatorsHint')} required>
              <PeoplePicker people={people} selected={evaluators} onChange={setEvaluators} className="max-h-72" />
            </Field>
            <Field label={t('hrEval.deadline')} hint={t('hrEval.deadlineHint')} htmlFor="eval-deadline" required>
              <Input
                id="eval-deadline"
                type="date"
                min={today}
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="max-w-48"
              />
            </Field>
          </Card>

          {error && <ErrorState message={error} />}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => router.push(`/hr/${worker.id}?tab=evaluations`)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submit} loading={pending} disabled={!canSend}>
              {t('hrEval.sendAction')}
            </Button>
          </div>
        </div>

    </>
  );
}
