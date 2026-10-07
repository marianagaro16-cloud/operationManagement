'use client';

import { useI18n, type MessageKey } from '@/i18n';
import { Badge } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { agreementStatus, followUpState, type AgreementStatus } from '@/domain/hr/note-structure';
import type { MeetingAgreement, MeetingRecord } from '@/types/meetings';

const STATUS_TONE = { met: 'done', partly: 'warn', not_met: 'late', pending: 'neutral' } as const satisfies Record<AgreementStatus, string>;

/** Every agreement of a record, point by point. */
export function recordAgreements(record: MeetingRecord): MeetingAgreement[] {
  return record.points.flatMap((p) => p.agreements);
}

/** Where the record's follow-up stands: its own date until a follow-up entry says otherwise. */
export function recordFollowUp(record: MeetingRecord, today: string) {
  return followUpState({ follow_up_on: record.follow_up_on, follow_ups: record.entries.filter((e) => e.kind === 'followup') }, today);
}

/**
 * A meeting's record as it is read — on the meeting and in an attendee's
 * file: who was there, each point with its situation, what was said and what
 * was agreed, and whatever was added afterwards.
 */
export function MeetingRecordContent({ record, today }: { record: MeetingRecord; today: string }) {
  const { t, formatDate } = useI18n();
  const heading = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted';
  const agreements = recordAgreements(record);
  const state = recordFollowUp(record, today);

  return (
    <div className="space-y-3 text-[13px] leading-relaxed">
      <div>
        <p className={heading}>{t('meetingRecord.attendees')}</p>
        <p>{record.attendees.map((a) => a.name).join(', ') || '—'}</p>
      </div>

      {record.points.map((point, i) => (
        <section key={point.id} className="space-y-1.5 border-t border-border pt-2.5">
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-semibold">
            <span>{i + 1}. {point.title || t('meetingRecord.point', { n: i + 1 })}</span>
            {point.topic && <Badge tone="neutral">{t(`hrNote.topic_${point.topic}` as MessageKey)}</Badge>}
          </h3>
          {point.situation && (
            <div>
              <p className={heading}>{t('meetingRecord.situation')}</p>
              <NoteText text={point.situation} />
            </div>
          )}
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
                          {a.responsible_all ? t('meetingRecord.allAttendees') : a.responsible_name}
                          {a.due_on && <span>· {t('meetingRecord.until', { date: formatDate(a.due_on, 'medium') })}</span>}
                          {record.registered_at && <Badge tone={STATUS_TONE[status]}>{t(`hrNote.result_${status}` as MessageKey)}</Badge>}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          {point.no_agreements_reason && (
            <div>
              <p className={heading}>{t('meetingRecord.noAgreementsLabel')}</p>
              <p>{point.no_agreements_reason}</p>
            </div>
          )}
        </section>
      ))}

      {record.follow_up_on && (
        <div className="border-t border-border pt-2.5">
          <p className={heading}>{t('hrNote.followUp')}</p>
          <p className="flex flex-wrap items-center gap-2">
            {formatDate(record.follow_up_on, 'medium')}
            {record.registered_at && state.status === 'open' && <Badge tone="accent">{t('hrNote.statusOpen', { date: formatDate(state.dueOn!, 'medium') })}</Badge>}
            {record.registered_at && state.status === 'overdue' && <Badge tone="late">{t('hrNote.statusOverdue', { date: formatDate(state.dueOn!, 'medium') })}</Badge>}
            {state.status === 'closed' && <Badge tone="done">{t('hrNote.statusClosed')}</Badge>}
          </p>
        </div>
      )}

      {record.entries.length > 0 && (
        <ul className="space-y-2.5 border-l-2 border-border pl-3">
          {record.entries.map((e) => {
            const results = agreements.flatMap((a) => a.results.filter((r) => r.entry_id === e.id).map((r) => ({ ...r, id: a.id, body: a.body })));
            return (
              <li key={e.id}>
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
