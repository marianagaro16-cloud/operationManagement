'use client';

import { useEffect } from 'react';
import { useI18n } from '@/i18n';
import { teamLabelKey } from '@/lib/authz';
import { localizedName } from '@/lib/localized-content';
import {
  NOTE_SECTIONS,
  agreementStatus,
  followUpState,
  noteAgreements,
  noteSummary,
  noteTopic,
  warningNumbers,
  type AgreementStatus,
  type NoteForm,
  noteForm,
} from '@/domain/hr/note-structure';
import type { MessageKey } from '@/i18n';
import type { MeetingRecord } from '@/types/meetings';
import type { HrAgreement, HrKey, HrLateArrival, HrNoteEvent, HrParticipant, HrWorkerFile } from '@/types/hr';

/**
 * A worker's whole file on a plain page — details, log, arrivals and
 * evaluations — to print or save as PDF. Opens the print dialog once drawn.
 */
export function PrintWorkerFile({ file, arrivals, keys, meetings }: { file: HrWorkerFile; arrivals: HrLateArrival[]; keys: HrKey[]; meetings: MeetingRecord[] }) {
  const { t, formatDate, locale } = useI18n();
  const { worker, notes, evaluations } = file;
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, []);
  const numbers = warningNumbers(notes);
  const today = new Date().toISOString().slice(0, 10);

  const summary = noteSummary(notes, today, meetings);
  const typeNames = new Map<string, string>([
    ...notes.flatMap((n) => (n.type ? [[n.type.id, localizedName(n.type, locale)] as const] : [])),
    ['meeting', t('meetingRecord.logBadge')],
  ]);
  const status = (key: AgreementStatus) => t(`hrNote.result_${key}` as MessageKey);

  /**
   * The content of a note or a later entry: when and where, its sections, what
   * was agreed and how each agreement went, its follow-up, and who was there.
   */
  const content = (
    structure: NoteForm,
    sections: Record<string, string> | null,
    followUpOn: string | null,
    followUpText: string | null,
    noFollowUpReason: string | null,
    participants: HrParticipant[],
    event: HrNoteEvent,
    agreements: HrAgreement[],
    results: [string, string][] = [],
  ) => {
    const rows: [string, string][] = [
      ...(event.event_on
        ? [[
            t('hrNote.event'),
            [
              [formatDate(event.event_on, 'medium'), event.event_time?.slice(0, 5)].filter(Boolean).join(', '),
              event.event_area && t(teamLabelKey(event.event_area)),
            ].filter(Boolean).join(' · '),
          ] as [string, string]]
        : []),
      ...NOTE_SECTIONS[structure]
        .filter((s) => sections?.[s.key])
        .map((s): [string, string] => [t(`hrNote.s_${structure}_${s.key}` as MessageKey), sections![s.key]!]),
      ...agreements.map((a, i): [string, string] => [
        t('hrNote.agreementN', { n: i + 1 }),
        `${a.body} (${t('hrNote.agreementMeta', { name: a.responsible_name, date: formatDate(a.due_on, 'medium') })}) — ${status(agreementStatus(a))}`,
      ]),
      ...results,
      ...(followUpOn ? [[`${t('hrNote.followUp')} · ${formatDate(followUpOn, 'medium')}`, followUpText ?? ''] as [string, string]] : []),
      ...(noFollowUpReason ? [[t('hrNote.noFollowUpLabel'), noFollowUpReason] as [string, string]] : []),
      ...(participants.length ? [[t('hrNote.participants'), participants.map((p) => p.name).join(', ')] as [string, string]] : []),
    ];
    return rows.map(([label, text], i) => (
      <p key={i} className="whitespace-pre-wrap">
        <span className="text-neutral-500">{label}: </span>
        {text}
      </p>
    ));
  };

  const details: [string, string | null][] = [
    [t('roles.team'), t(teamLabelKey(worker.team))],
    [t('hrPrint.position'), worker.position],
    [t('hrPrint.since'), worker.start_date && formatDate(worker.start_date, 'medium')],
    [t('hrPrint.born'), worker.birth_date && formatDate(worker.birth_date, 'medium')],
    [t('hrPrint.phone'), worker.phone],
    [t('hrPrint.email'), worker.email],
    [t('hrPrint.address'), worker.address],
    [t('hr.emergencyContact'), worker.emergency_contact],
    [t('hrPrint.left'), worker.left_on && formatDate(worker.left_on, 'medium')],
  ];

  return (
    <main className="mx-auto max-w-3xl bg-white p-6 text-[12.5px] text-black print:max-w-none print:p-0">
      <h1 className="text-2xl font-semibold">{worker.name}</h1>
      <p className="mb-4 text-[12px] text-neutral-500">
        {t('hrPrint.printedOn', { date: formatDate(new Date().toISOString().slice(0, 10), 'medium') })}
      </p>

      <dl className="mb-6 grid grid-cols-[11rem_1fr] gap-x-4 gap-y-1">
        {details.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-neutral-500">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <Section title={t('hrKey.tab')} empty={keys.length === 0}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-500">
              <th className="py-1 pr-2 font-medium">{t('hrKey.fieldNumber')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrKey.fieldOpens')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrKey.fieldHanded')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrKey.fieldReturned')}</th>
              <th className="py-1 font-medium">{t('hrKey.fieldNote')}</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-neutral-200 align-top">
                <td className="py-1 pr-2 font-medium">{k.key_number}</td>
                <td className="py-1 pr-2">{k.opens}</td>
                <td className="py-1 pr-2">{formatDate(k.handed_on, 'short')}</td>
                <td className="py-1 pr-2">{k.returned_on ? formatDate(k.returned_on, 'short') : '—'}</td>
                <td className="py-1">{k.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t('hr.tabLog')} empty={notes.length === 0}>
        {summary.total > 0 && (
          <div className="mb-3 break-inside-avoid border border-neutral-300 p-2">
            <p className="font-medium">{t('hrNote.summaryTitle', { count: summary.total })}</p>
            {summary.topics.map((row) => (
              <p key={row.topic}>
                {t(`hrNote.topic_${row.topic}` as MessageKey)}: {row.count}
                <span className="text-neutral-500">
                  {' '}({row.types.map((ty) => `${ty.count} ${typeNames.get(ty.id) ?? t('hr.noteType')}`).join(', ')})
                </span>
              </p>
            ))}
            {summary.noTopic > 0 && <p className="text-neutral-500">{t('hrNote.summaryNoTopic', { count: summary.noTopic })}</p>}
            {Object.values(summary.agreements).some((count) => count > 0) && (
              <p>
                <span className="text-neutral-500">{t('hrNote.agreements')}: </span>
                {(['met', 'partly', 'not_met', 'pending'] as const)
                  .filter((key) => summary.agreements[key] > 0)
                  .map((key) => `${status(key)} ${summary.agreements[key]}`)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}
        <ul className="space-y-2">
          {notes.map((n) => {
            const structure = noteForm(n.type?.structure ?? 'general', n.asked_by);
            const level = n.warning_level ?? n.follow_ups.find((f) => f.kind === 'completion')?.warning_level;
            const state = followUpState(n, today);
            const topic = noteTopic(n);
            const agreements = noteAgreements(n);
            return (
              <li key={n.id} className="break-inside-avoid">
                <p className="font-medium">
                  {formatDate(n.note_date, 'medium')}
                  {n.type && ` · ${localizedName(n.type, locale)}`}
                  {n.asked_by === 'employee' && ` · ${t('hrNote.askedByEmployeeBadge')}`}
                  {n.confidential && ` · ${t('hrNote.confidential')}`}
                  {topic && ` · ${t(`hrNote.topic_${topic}` as MessageKey)}`}
                  {level && ` · ${t(`hrNote.level_${level}` as MessageKey)}`}
                  {numbers.has(n.id) && ` · ${t('hrNote.warningNumber', { n: numbers.get(n.id)! })}`}
                  {state.status === 'closed' && ` · ${t('hrNote.statusClosed')}`}
                  {state.dueOn && ` · ${t(state.status === 'overdue' ? 'hrNote.statusOverdue' : 'hrNote.statusOpen', { date: formatDate(state.dueOn, 'medium') })}`}
                  {n.author_name && <span className="font-normal text-neutral-500"> · {n.author_name}</span>}
                </p>
                {n.body && <p className="whitespace-pre-wrap">{n.body}</p>}
                {content(structure, n.sections, n.follow_up_on, n.follow_up_text, n.no_follow_up_reason, n.participants, n, n.agreements)}
                {n.follow_ups.map((f) => (
                  <div key={f.id} className="ml-4 mt-1 border-l border-neutral-300 pl-2">
                    <p className="font-medium">
                      {formatDate(f.entry_date, 'medium')} · {t(f.kind === 'completion' ? 'hrNote.completed' : 'hrNote.followUp')}
                      {f.closes && ` · ${t('hrNote.closed')}`}
                      {f.author_name && <span className="font-normal text-neutral-500"> · {f.author_name}</span>}
                    </p>
                    {f.body && <p className="whitespace-pre-wrap">{f.body}</p>}
                    {content(
                      structure, f.sections, f.next_on, f.next_text, f.no_follow_up_reason, f.participants, f, f.agreements,
                      // How this entry found each agreement it checked.
                      agreements.flatMap((a) =>
                        a.results
                          .filter((r) => r.followup_id === f.id)
                          .map((r): [string, string] => [status(r.result), r.comment ? `${a.body} — ${r.comment}` : a.body]),
                      ),
                    )}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t('meetingRecord.printTitle')} empty={meetings.length === 0}>
        <ul className="space-y-3">
          {meetings.map((m) => {
            const agreed = m.points.flatMap((p) => p.agreements);
            return (
              <li key={m.meeting_id} className="break-inside-avoid">
                <p className="font-medium">
                  {formatDate(m.meeting_date, 'medium')} · {m.start_time.slice(0, 5)}–{m.end_time.slice(0, 5)} · {m.title}
                  <span className="font-normal text-neutral-500"> · {m.organizer_name}</span>
                </p>
                <p><span className="text-neutral-500">{t('meetingRecord.attendees')}: </span>{m.attendees.map((a) => a.name).join(', ')}</p>
                {m.points.map((p, i) => (
                  <div key={p.id} className="mt-1">
                    <p className="font-medium">
                      {i + 1}. {p.title}
                      {p.topic && <span className="font-normal text-neutral-500"> · {t(`hrNote.topic_${p.topic}` as MessageKey)}</span>}
                    </p>
                    {p.situation && <p className="whitespace-pre-wrap"><span className="text-neutral-500">{t('meetingRecord.situation')}: </span>{p.situation}</p>}
                    {p.discussed && <p className="whitespace-pre-wrap"><span className="text-neutral-500">{t('meetingRecord.discussed')}: </span>{p.discussed}</p>}
                    {p.agreements.map((a, n) => (
                      <p key={a.id} className="whitespace-pre-wrap">
                        <span className="text-neutral-500">{t('hrNote.agreementN', { n: n + 1 })}: </span>
                        {a.body} ({a.responsible_all ? t('meetingRecord.allAttendees') : a.responsible_name}
                        {a.due_on && ` · ${t('meetingRecord.until', { date: formatDate(a.due_on, 'medium') })}`}) — {status(agreementStatus(a))}
                      </p>
                    ))}
                    {p.no_agreements_reason && <p><span className="text-neutral-500">{t('meetingRecord.noAgreementsLabel')}: </span>{p.no_agreements_reason}</p>}
                  </div>
                ))}
                {m.entries.map((e) => (
                  <div key={e.id} className="ml-4 mt-1 border-l border-neutral-300 pl-2">
                    <p className="font-medium">
                      {formatDate(e.entry_date, 'medium')} · {t(e.kind === 'followup' ? 'hrNote.followUp' : 'meetingRecord.addendum')}
                      {e.closes && ` · ${t('hrNote.closed')}`}
                      {e.author_name && <span className="font-normal text-neutral-500"> · {e.author_name}</span>}
                    </p>
                    <p className="whitespace-pre-wrap">{e.body}</p>
                    {agreed.flatMap((a) =>
                      a.results.filter((r) => r.entry_id === e.id).map((r) => (
                        <p key={a.id}><span className="text-neutral-500">{status(r.result)}: </span>{r.comment ? `${a.body} — ${r.comment}` : a.body}</p>
                      )),
                    )}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t('hrLate.tab')} empty={arrivals.length === 0}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-500">
              <th className="py-1 pr-2 font-medium">{t('hrPrint.day')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrPrint.kind')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrLate.expected')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrLate.arrived')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrPrint.minutes')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrLate.reason')}</th>
              <th className="py-1 font-medium">{t('hrLate.excused')}</th>
            </tr>
          </thead>
          <tbody>
            {arrivals.map((a) => (
              <tr key={a.id} className="border-b border-neutral-200 align-top">
                <td className="py-1 pr-2">{formatDate(a.arrival_date, 'short')}</td>
                <td className="py-1 pr-2">{a.kind === 'early' ? t('hrLate.kindEarly') : t('hrLate.kindLate')}</td>
                <td className="py-1 pr-2">{a.expected_time.slice(0, 5)}</td>
                <td className="py-1 pr-2">{a.arrived_time.slice(0, 5)}</td>
                <td className="py-1 pr-2">{a.minutes_off}</td>
                <td className="py-1 pr-2">{a.reason ? localizedName(a.reason, locale) : '—'}{a.note && ` — ${a.note}`}</td>
                <td className="py-1">{a.excused ? t('hrPrint.yes') : t('hrPrint.no')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t('hr.tabEvaluations')} empty={evaluations.length === 0}>
        <div className="space-y-4">
          {evaluations.map((e) => {
            const avg = e.scores.length ? (e.scores.reduce((s, x) => s + x.score, 0) / e.scores.length).toFixed(1) : null;
            return (
              <div key={e.id} className="break-inside-avoid">
                <p className="font-medium">
                  {formatDate(e.evaluated_on, 'medium')}
                  {e.author_name && <span className="font-normal text-neutral-500"> · {e.author_name}</span>}
                  {avg && <span className="font-normal"> · {t('hrPrint.average', { avg })}</span>}
                </p>
                <table className="mt-1 w-full border-collapse">
                  <tbody>
                    {e.scores.map((s) => (
                      <tr key={s.criterion_name} className="border-b border-neutral-200 align-top">
                        <td className="py-0.5 pr-2">{localizedName({ name: s.criterion_name, translations: s.criterion_translations }, locale)}</td>
                        <td className="w-10 py-0.5 pr-2 text-right font-medium">{s.score}/5</td>
                        <td className="py-0.5 text-neutral-600">{s.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {e.comment && <p className="mt-1 whitespace-pre-wrap"><span className="text-neutral-500">{t('hrPrint.comment')}: </span>{e.comment}</p>}
                {e.goals && <p className="mt-0.5 whitespace-pre-wrap"><span className="text-neutral-500">{t('hrPrint.goals')}: </span>{e.goals}</p>}
              </div>
            );
          })}
        </div>
      </Section>
    </main>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="mb-6">
      <h2 className="mb-2 border-b border-neutral-300 pb-1 text-[14px] font-semibold">{title}</h2>
      {empty ? <p className="text-neutral-500">{t('hrPrint.none')}</p> : children}
    </section>
  );
}
