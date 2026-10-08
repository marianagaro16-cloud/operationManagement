'use client';

import { useI18n, type MessageKey } from '@/i18n';
import { localizedName } from '@/lib/localized-content';
import { Badge } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { agreementStatus, followUpState, type AgreementStatus } from '@/domain/hr/note-structure';
import type { ActaAgreement, ActaRow, ActaTopic, SalesActa } from '@/types/sales-acta';

const STATUS_TONE = { met: 'done', partly: 'warn', not_met: 'late', pending: 'neutral' } as const satisfies Record<AgreementStatus, string>;

/** Every agreement of an Acta, point by point. */
export function actaAgreements(acta: SalesActa): ActaAgreement[] {
  return acta.points.flatMap((p) => p.agreements);
}

/** Where the Acta's follow-up stands: its own date until a follow-up entry says otherwise. */
export function actaFollowUp(acta: SalesActa, today: string) {
  return followUpState({ follow_up_on: acta.follow_up_on, follow_ups: acta.entries.filter((e) => e.kind === 'followup') }, today);
}

/** A topic's name in the reader's language; null when the point has none yet. */
export function useTopicName(topics: ActaTopic[]) {
  const { locale } = useI18n();
  return (id: string | null) => {
    const found = id ? topics.find((topic) => topic.id === id) : undefined;
    return found ? localizedName(found, locale) : null;
  };
}

/** Where an Acta's follow-up stands, as a badge; nothing when it has none. */
export function FollowUpBadge({ followUp }: { followUp: ActaRow['followUp'] }) {
  const { t, formatDate } = useI18n();
  if (followUp.status === 'open') return <Badge tone="accent">{t('hrNote.statusOpen', { date: formatDate(followUp.dueOn!, 'medium') })}</Badge>;
  if (followUp.status === 'overdue') return <Badge tone="late">{t('hrNote.statusOverdue', { date: formatDate(followUp.dueOn!, 'medium') })}</Badge>;
  if (followUp.status === 'closed') return <Badge tone="done">{t('hrNote.statusClosed')}</Badge>;
  return null;
}

/**
 * An Acta as it is read — on its page and on paper: who was there from each
 * side, each point with what was said and what was agreed, and whatever was
 * added afterwards.
 */
export function ActaContent({ acta, topics, today }: { acta: SalesActa; topics: ActaTopic[]; today: string }) {
  const { t, formatDate } = useI18n();
  const topicName = useTopicName(topics);
  const heading = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted';
  const agreements = actaAgreements(acta);
  const state = actaFollowUp(acta, today);
  const ours = acta.attendees.filter((a) => a.side === 'ours');
  const theirs = acta.attendees.filter((a) => a.side === 'theirs');

  return (
    <div className="space-y-3 text-[13px] leading-relaxed">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className={heading}>{t('acta.theirs', { name: acta.target.name })}</p>
          <p>{theirs.map((a) => (a.role ? `${a.name} (${a.role})` : a.name)).join(', ') || '—'}</p>
        </div>
        <div>
          <p className={heading}>{t('acta.ours')}</p>
          <p>{ours.map((a) => a.name).join(', ') || '—'}</p>
        </div>
      </div>

      {acta.points.map((point, i) => {
        const topic = topicName(point.topic_id);
        return (
          <section key={point.id} className="break-inside-avoid space-y-1.5 border-t border-border pt-2.5">
            <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-semibold">
              <span>{i + 1}. {point.title || topic || t('meetingRecord.point', { n: i + 1 })}</span>
              {topic && point.title && <Badge tone="neutral">{topic}</Badge>}
            </h3>
            {point.discussed && (
              <div>
                <p className={heading}>{t('meetingRecord.discussed')}</p>
                <NoteText text={point.discussed} />
              </div>
            )}
            {point.agreements.length > 0 && (
              <div>
                <p className={heading}>{t('hrNote.agreements')}</p>
                <ol className="mt-0.5 space-y-1.5">
                  {point.agreements.map((a, n) => {
                    const status = agreementStatus(a);
                    return (
                      <li key={a.id} className="flex gap-2">
                        <span className="tabular shrink-0 text-muted">{n + 1}.</span>
                        <div className="min-w-0">
                          <NoteText text={a.body} />
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                            {a.responsible_name}
                            {a.due_on && <span>· {t('meetingRecord.until', { date: formatDate(a.due_on, 'medium') })}</span>}
                            {acta.registered_at && <Badge tone={STATUS_TONE[status]}>{t(`hrNote.result_${status}` as MessageKey)}</Badge>}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </section>
        );
      })}

      {acta.follow_up_on && (
        <div className="border-t border-border pt-2.5">
          <p className={heading}>{t('hrNote.followUp')}</p>
          <p className="flex flex-wrap items-center gap-2">
            {formatDate(acta.follow_up_on, 'medium')}
            {acta.registered_at && <FollowUpBadge followUp={state} />}
          </p>
        </div>
      )}

      {acta.entries.length > 0 && (
        <ul className="space-y-2.5 border-l-2 border-border pl-3">
          {acta.entries.map((e) => {
            const results = agreements.flatMap((a) => a.results.filter((r) => r.entry_id === e.id).map((r) => ({ ...r, id: a.id, body: a.body })));
            return (
              <li key={e.id} className="break-inside-avoid">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <span className="tabular font-medium text-fg">{formatDate(e.entry_date, 'medium')}</span>
                  <span>{t(e.kind === 'followup' ? 'hrNote.followUp' : 'meetingRecord.addendum')}</span>
                  {e.closes && <Badge tone="done">{t('hrNote.closed')}</Badge>}
                  {e.next_on && <span>· {t('meetingRecord.nextOn', { date: formatDate(e.next_on, 'medium') })}</span>}
                  {e.author_name && <span>{t('hr.by', { name: e.author_name })}</span>}
                </p>
                <NoteText text={e.body} />
                {results.length > 0 && (
                  <ul className="mt-1 space-y-1">
                    {results.map((r) => (
                      <li key={r.id}>
                        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <Badge tone={STATUS_TONE[r.result]}>{t(`hrNote.result_${r.result}` as MessageKey)}</Badge>
                          <span>{r.body}</span>
                        </p>
                        {r.comment && <p className="text-[12.5px] text-muted">{r.comment}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
