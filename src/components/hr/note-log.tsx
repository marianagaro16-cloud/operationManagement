'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CornerDownRight, FileText, Plus, X } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { createClient } from '@/lib/supabase/client';
import { HR_ALLOWED_MIME, HR_BUCKET, HR_MAX_BYTES } from '@/lib/hr';
import { localizedName } from '@/lib/localized-content';
import { addFollowUp, addNote, recordNoteAttachment } from '@/server/hr-actions';
import { QuickReminderButton } from '@/components/reminders/reminder-actions';
import {
  AGREEMENTS_RULE,
  AGREEMENT_RESULTS,
  EMPTY_CONTENT,
  FOLLOW_UP_RULE,
  HAS_EVENT,
  NOTE_SECTIONS,
  MEETING_TYPE,
  NOTE_TOPICS,
  WARNING_LEVELS,
  agreementStatus,
  filledAgreements,
  followUpState,
  missingContent,
  noteAgreements,
  noteSummary,
  noteTopic,
  skipsFollowUp,
  warningNumbers,
  type AgreementDraft,
  type AgreementResult,
  type AgreementStatus,
  type NoteContent,
  type NoteStructure,
  type NoteTopic,
  type WarningLevel,
} from '@/domain/hr/note-structure';
import { TEAMS, teamLabelKey, type Team } from '@/lib/authz';
import { useHrError } from './worker-dialog';
import { MeetingRecordContent } from '@/components/meetings/meeting-record-view';
import type { MeetingRecord } from '@/types/meetings';
import type { HrAgreement, HrFollowUp, HrNote, HrNoteEvent, HrNoteType, HrParticipant, HrPerson, HrWorkerFile } from '@/types/hr';

/*
 * The log of a worker's file.
 *
 * A note is written in the sections of its type — what it is about, when and
 * where it happened, why, what was said, what was agreed and by whom, what
 * happens next, who was there — and none of them can be left out. What comes
 * of a follow-up is added underneath later, as its own entry that marks each
 * agreement; the note itself never changes.
 */

const personKey = (p: HrPerson) => p.profile_id ?? p.worker_id ?? `n:${p.name.toLowerCase()}`;

const STATUS_TONE = { met: 'done', partly: 'warn', not_met: 'late', pending: 'neutral' } as const satisfies Record<AgreementStatus, string>;

/** What the form holds, as the action takes it: only this structure's own content. */
function toPayload(structure: NoteStructure, c: NoteContent) {
  const skipped = skipsFollowUp(structure, c);
  const planned = FOLLOW_UP_RULE[structure] !== 'none' && !skipped && !!c.follow_up_text.trim();
  const event = HAS_EVENT[structure];
  return {
    sections: Object.fromEntries(
      NOTE_SECTIONS[structure]
        .filter((s) => !s.legacy)
        .map((s) => [s.key, (c.sections[s.key] ?? '').trim()])
        .filter(([, text]) => text),
    ) as Record<string, string>,
    warning_level: structure === 'warning' ? c.warning_level : null,
    topic: c.topic!,
    event_on: event ? c.event_on : null,
    event_time: event ? c.event_time : null,
    event_area: event ? (c.event_area as Team) : null,
    agreements: filledAgreements(structure, c).map((a) => ({ body: a.body, responsible: a.responsible!, due_on: a.due_on })),
    follow_up_text: planned ? c.follow_up_text : null,
    follow_up_on: planned ? c.follow_up_on : null,
    no_follow_up_reason: skipped ? c.no_follow_up_reason : null,
  };
}

function useNoteError() {
  const { t } = useI18n();
  const hrError = useHrError();
  return (error: string) => {
    const known: Record<string, MessageKey> = {
      section_required: 'hrNote.errSection',
      sections_required: 'hrNote.errSection',
      level_required: 'hrNote.errSection',
      body_required: 'hrNote.errSection',
      follow_up_required: 'hrNote.errFollowUp',
      follow_up_date_invalid: 'hrNote.errFollowUpDate',
      follow_up_closed: 'hrNote.errClosed',
      already_complete: 'hrNote.errAlreadyComplete',
      participant_not_found: 'hrNote.errParticipant',
      invalid_date: 'hrNote.errDate',
      topic_required: 'hrNote.errTopic',
      event_required: 'hrNote.errEvent',
      event_date_invalid: 'hrNote.errEventDate',
      agreement_required: 'hrNote.errAgreement',
      agreement_incomplete: 'hrNote.errAgreement',
      result_required: 'hrNote.errResult',
      result_comment_required: 'hrNote.errResult',
    };
    return known[error] ? t(known[error]) : hrError(error);
  };
}

export function LogTab({
  file,
  meetings,
  noteTypes,
  people,
  today,
  viewerId,
  viewerName,
  isAdmin,
}: {
  file: HrWorkerFile;
  /** The registered meetings this worker attended, shown among the notes by date. */
  meetings: MeetingRecord[];
  noteTypes: HrNoteType[];
  /** Whom participants are picked from, without the viewer. */
  people: HrPerson[];
  today: string;
  viewerId: string;
  viewerName: string;
  /** An Admin may add to anyone's note; everybody else to their own. */
  isAdmin: boolean;
}) {
  const { t, locale, formatDate } = useI18n();
  const [adding, setAdding] = useState(false);
  const [entry, setEntry] = useState<{ note: HrNote; kind: HrFollowUp['kind'] } | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState<NoteTopic | ''>('');

  const shown = file.notes.filter(
    (n) => (!typeFilter || n.type?.id === typeFilter) && (!topicFilter || noteTopic(n) === topicFilter),
  );
  const shownMeetings = meetings.filter(
    (m) => (!typeFilter || typeFilter === MEETING_TYPE) && (!topicFilter || m.points.some((p) => p.topic === topicFilter)),
  );
  // Notes and meetings together, the latest first.
  const rows = [
    ...shown.map((note) => ({ date: note.note_date, at: note.created_at, note, meeting: null })),
    ...shownMeetings.map((meeting) => ({ date: meeting.meeting_date, at: meeting.registered_at ?? '', note: null, meeting })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  const topics = NOTE_TOPICS.filter(
    (topic) => file.notes.some((n) => noteTopic(n) === topic) || meetings.some((m) => m.points.some((p) => p.topic === topic)),
  );
  // Every type that appears in the log, including one Admin has since switched off.
  const types = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of file.notes) if (n.type) map.set(n.type.id, localizedName(n.type, locale));
    if (meetings.length > 0) map.set(MEETING_TYPE, t('meetingRecord.logBadge'));
    return [...map.entries()];
  }, [file.notes, meetings.length, locale, t]);
  const numbers = useMemo(() => warningNumbers(file.notes), [file.notes]);

  return (
    <div className="space-y-3">
      <LogSummary notes={file.notes} meetings={meetings} today={today} typeNames={new Map(types)} topic={topicFilter} onTopic={setTopicFilter} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {types.length > 1 && (
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
          )}
          {topics.length > 0 && (
            <Select
              aria-label={t('hrNote.topic')}
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value as NoteTopic | '')}
              className="h-8 w-auto py-0 text-[12.5px]"
            >
              <option value="">{t('hrNote.allTopics')}</option>
              {topics.map((topic) => (
                <option key={topic} value={topic}>{t(`hrNote.topic_${topic}` as MessageKey)}</option>
              ))}
            </Select>
          )}
        </div>
        <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('hr.newNote')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t('hr.noNotes')} />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            if (row.meeting) {
              const m = row.meeting;
              return (
                <li key={m.meeting_id}>
                  <Card className="p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                      <span className="tabular font-medium text-fg">{formatDate(m.meeting_date, 'medium')}</span>
                      <Badge tone="accent">{t('meetingRecord.logBadge')}</Badge>
                      <span className="tabular">{m.start_time.slice(0, 5)}–{m.end_time.slice(0, 5)}</span>
                      <span>{t('meeting.byName', { name: m.organizer_name })}</span>
                      {(isAdmin || m.organizer_id === viewerId) && (
                        <Link href={`/meetings/${m.meeting_id}`} className="ml-auto text-accent hover:underline">{t('meetingRecord.openMeeting')}</Link>
                      )}
                    </div>
                    <p className="mb-2 text-[14px] font-semibold leading-snug">{m.title}</p>
                    <MeetingRecordContent record={m} today={today} />
                  </Card>
                </li>
              );
            }
            const n = row.note;
            const structure: NoteStructure = n.type?.structure ?? 'general';
            const completion = n.follow_ups.find((f) => f.kind === 'completion');
            const level = n.warning_level ?? completion?.warning_level ?? null;
            const number = numbers.get(n.id);
            const state = followUpState(n, today);
            const mayAdd = (n.created_by === viewerId || isAdmin) && state.status !== 'closed';
            const topic = noteTopic(n);
            const agreements = noteAgreements(n);
            return (
              <li key={n.id}>
                <Card className="p-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                    <span className="tabular font-medium text-fg">{formatDate(n.note_date, 'medium')}</span>
                    {n.type && <Badge tone="accent">{localizedName(n.type, locale)}</Badge>}
                    {topic && <Badge tone="neutral">{t(`hrNote.topic_${topic}` as MessageKey)}</Badge>}
                    {structure === 'warning' && (level || number) && (
                      <Badge tone="warn">
                        {[level && t(`hrNote.level_${level}` as MessageKey), number && t('hrNote.warningNumber', { n: number })]
                          .filter(Boolean)
                          .join(' · ')}
                      </Badge>
                    )}
                    {!n.sections && <Badge tone="neutral">{t('hrNote.oldFormat')}</Badge>}
                    {state.status === 'open' && <Badge tone="accent">{t('hrNote.statusOpen', { date: formatDate(state.dueOn!, 'medium') })}</Badge>}
                    {state.status === 'overdue' && <Badge tone="late">{t('hrNote.statusOverdue', { date: formatDate(state.dueOn!, 'medium') })}</Badge>}
                    {state.status === 'closed' && <Badge tone="done">{t('hrNote.statusClosed')}</Badge>}
                    {n.author_name && <span>{t('hr.by', { name: n.author_name })}</span>}
                    {/* A reminder of one's own about this note, linked to it. */}
                    <span className="ml-auto">
                      <QuickReminderButton viewerId={viewerId} variant="ghost" compact link={{ type: 'hr_note', id: n.id, label: `${file.worker.name} · ${formatDate(n.note_date, 'medium')}` }} />
                    </span>
                  </div>

                  {n.body && (
                    <div className="mt-1.5 text-[13px] leading-relaxed">
                      <NoteText text={n.body} />
                    </div>
                  )}
                  {n.sections && (
                    <NoteContentView
                      structure={structure}
                      sections={n.sections}
                      followUpText={n.follow_up_text}
                      followUpOn={n.follow_up_on}
                      noFollowUpReason={n.no_follow_up_reason}
                      participants={n.participants}
                      event={n}
                      agreements={n.agreements}
                    />
                  )}

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

                  {/* What was added later, in the order it happened. */}
                  {n.follow_ups.length > 0 && (
                    <ul className="mt-3 space-y-2.5 border-l-2 border-border pl-3">
                      {n.follow_ups.map((f) => (
                        <li key={f.id}>
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                            <CornerDownRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="tabular font-medium text-fg">{formatDate(f.entry_date, 'medium')}</span>
                            <span>{t(f.kind === 'completion' ? 'hrNote.completed' : 'hrNote.followUp')}</span>
                            {f.closes && <Badge tone="done">{t('hrNote.closed')}</Badge>}
                            {f.author_name && <span>{t('hr.by', { name: f.author_name })}</span>}
                          </p>
                          {f.body && (
                            <div className="mt-1 text-[13px] leading-relaxed">
                              <NoteText text={f.body} />
                            </div>
                          )}
                          <NoteContentView
                            structure={structure}
                            sections={f.sections}
                            followUpText={f.next_text}
                            followUpOn={f.next_on}
                            noFollowUpReason={f.no_follow_up_reason}
                            participants={f.participants}
                            event={f}
                            agreements={f.agreements}
                            results={agreements.flatMap((a) =>
                              a.results.filter((r) => r.followup_id === f.id).map((r) => ({ id: a.id, body: a.body, result: r.result, comment: r.comment })),
                            )}
                          />
                        </li>
                      ))}
                    </ul>
                  )}

                  {mayAdd && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {!n.sections && !completion && (
                        <Button size="sm" variant="secondary" onClick={() => setEntry({ note: n, kind: 'completion' })}>
                          {t('hrNote.complete')}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEntry({ note: n, kind: 'followup' })}>
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        {t('hrNote.addFollowUp')}
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <NoteDialog
          file={file}
          noteTypes={noteTypes}
          people={people}
          today={today}
          viewerId={viewerId}
          viewerName={viewerName}
          onClose={() => setAdding(false)}
        />
      )}
      {entry && (
        <FollowUpDialog
          file={file}
          note={entry.note}
          kind={entry.kind}
          people={people}
          today={today}
          viewerId={viewerId}
          viewerName={viewerName}
          onClose={() => setEntry(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------- the summary ------------------------------- */

/** What the last twelve months of the log are about, and how its agreements went. A topic filters the log. */
function LogSummary({
  notes,
  meetings,
  today,
  typeNames,
  topic,
  onTopic,
}: {
  notes: HrNote[];
  meetings: MeetingRecord[];
  today: string;
  typeNames: Map<string, string>;
  topic: NoteTopic | '';
  onTopic: (topic: NoteTopic | '') => void;
}) {
  const { t } = useI18n();
  const summary = useMemo(() => noteSummary(notes, today, meetings), [notes, today, meetings]);
  if (summary.total === 0) return null;
  const agreed = (['met', 'partly', 'not_met', 'pending'] as const).filter((status) => summary.agreements[status] > 0);

  return (
    <Card className="space-y-2.5 p-3 text-[13px]">
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('hrNote.summaryTitle', { count: summary.total })}</p>
      {summary.topics.length > 0 && (
        <ul className="space-y-1">
          {summary.topics.map((row) => (
            <li key={row.topic} className="flex flex-wrap items-baseline gap-x-2">
              <button
                type="button"
                aria-pressed={topic === row.topic}
                onClick={() => onTopic(topic === row.topic ? '' : row.topic)}
                className={cn('rounded text-left font-medium hover:underline', topic === row.topic && 'text-accent')}
              >
                {t(`hrNote.topic_${row.topic}` as MessageKey)}
                <span className="tabular ml-1.5">{row.count}</span>
              </button>
              <span className="text-[12px] text-muted">
                {row.types.map((ty) => `${ty.count} ${typeNames.get(ty.id) ?? t('hr.noteType')}`).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {summary.noTopic > 0 && <p className="text-[12px] text-muted">{t('hrNote.summaryNoTopic', { count: summary.noTopic })}</p>}
      {agreed.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-muted">{t('hrNote.agreements')}:</span>
          {agreed.map((status) => (
            <Badge key={status} tone={STATUS_TONE[status]}>
              {t(`hrNote.result_${status}` as MessageKey)} <span className="tabular">{summary.agreements[status]}</span>
            </Badge>
          ))}
        </p>
      )}
    </Card>
  );
}

/* ------------------------------ reading a note ----------------------------- */

/**
 * The content of a note or of a later entry: when and where, its sections,
 * what was agreed, its follow-up and who was there.
 */
function NoteContentView({
  structure,
  sections,
  followUpText,
  followUpOn,
  noFollowUpReason,
  participants,
  event,
  agreements,
  results = [],
}: {
  structure: NoteStructure;
  sections: Record<string, string> | null;
  followUpText: string | null;
  followUpOn: string | null;
  noFollowUpReason: string | null;
  participants: HrParticipant[];
  event: HrNoteEvent;
  agreements: HrAgreement[];
  /** How this entry found each agreement it checked. */
  results?: { id: string; body: string; result: AgreementResult; comment: string | null }[];
}) {
  const { t, formatDate } = useI18n();
  const rows: { label: string; text: string }[] = [
    ...(event.event_on
      ? [{
          label: t('hrNote.event'),
          text: [
            [formatDate(event.event_on, 'medium'), event.event_time?.slice(0, 5)].filter(Boolean).join(', '),
            event.event_area && t(teamLabelKey(event.event_area)),
          ].filter(Boolean).join(' · '),
        }]
      : []),
    ...NOTE_SECTIONS[structure]
      .filter((s) => sections?.[s.key])
      .map((s) => ({ label: t(`hrNote.s_${structure}_${s.key}` as MessageKey), text: sections![s.key]! })),
  ];
  const after: { label: string; text: string }[] = [
    ...(followUpOn
      ? [{ label: `${t('hrNote.followUp')} · ${formatDate(followUpOn, 'medium')}`, text: followUpText ?? '' }]
      : []),
    ...(noFollowUpReason ? [{ label: t('hrNote.noFollowUpLabel'), text: noFollowUpReason }] : []),
  ];
  if (rows.length + after.length + participants.length + agreements.length + results.length === 0) return null;
  const heading = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted';

  return (
    <dl className="mt-2 space-y-2 text-[13px] leading-relaxed">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className={heading}>{row.label}</dt>
          <dd><NoteText text={row.text} /></dd>
        </div>
      ))}
      {agreements.length > 0 && (
        <div>
          <dt className={heading}>{t('hrNote.agreements')}</dt>
          <dd>
            <ol className="mt-0.5 space-y-1.5">
              {agreements.map((a, i) => {
                const status = agreementStatus(a);
                return (
                  <li key={a.id} className="flex gap-2">
                    <span className="tabular shrink-0 text-muted">{i + 1}.</span>
                    <div className="min-w-0">
                      <NoteText text={a.body} />
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                        {t('hrNote.agreementMeta', { name: a.responsible_name, date: formatDate(a.due_on, 'medium') })}
                        <Badge tone={STATUS_TONE[status]}>{t(`hrNote.result_${status}` as MessageKey)}</Badge>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </dd>
        </div>
      )}
      {results.length > 0 && (
        <div>
          <dt className={heading}>{t('hrNote.results')}</dt>
          <dd>
            <ul className="mt-0.5 space-y-1.5">
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
          </dd>
        </div>
      )}
      {after.map((row) => (
        <div key={row.label}>
          <dt className={heading}>{row.label}</dt>
          <dd><NoteText text={row.text} /></dd>
        </div>
      ))}
      {participants.length > 0 && (
        <div>
          <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('hrNote.participants')}</dt>
          <dd>{participants.map((p) => p.name).join(', ')}</dd>
        </div>
      )}
    </dl>
  );
}

/* ------------------------------ writing a note ----------------------------- */

/** The sections of a structure as form fields, with its follow-up. */
function ContentFields({
  structure,
  content,
  onChange,
  from,
  warningNumber,
  responsibles,
  defaultResponsible,
}: {
  structure: NoteStructure;
  content: NoteContent;
  onChange: (content: NoteContent) => void;
  /** The day of the note: what happened is not after it, the follow-up and the agreements not before. */
  from: string;
  /** Which warning this would be for the worker. */
  warningNumber?: number;
  /** Who can be responsible for an agreement, and who a new one starts with. */
  responsibles: HrPerson[];
  defaultResponsible: HrPerson | null;
}) {
  const { t } = useI18n();
  const rule = FOLLOW_UP_RULE[structure];
  const agreementsRule = AGREEMENTS_RULE[structure];
  const agreed = filledAgreements(structure, content).length > 0;
  // Agreements are checked at the follow-up, so with them there always is one.
  const maySkip = agreementsRule !== 'required' && !agreed;
  const set = (patch: Partial<NoteContent>) => onChange({ ...content, ...patch });
  const setAgreement = (index: number, patch: Partial<AgreementDraft>) =>
    set({ agreements: content.agreements.map((a, i) => (i === index ? { ...a, ...patch } : a)) });

  return (
    <>
      <Field label={t('hrNote.topic')} hint={t('hrNote.topicHint')} required htmlFor="note-topic">
        <Select id="note-topic" value={content.topic ?? ''} onChange={(e) => set({ topic: (e.target.value || null) as NoteTopic | null })}>
          <option value="">{t('hrNote.pick')}</option>
          {NOTE_TOPICS.map((topic) => (
            <option key={topic} value={topic}>{t(`hrNote.topic_${topic}` as MessageKey)}</option>
          ))}
        </Select>
      </Field>

      {HAS_EVENT[structure] && (
        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-[13px] font-medium">
            {t('hrNote.event')}
            <span className="ml-0.5 text-late">*</span>
          </legend>
          <p className="text-[12px] text-muted">{t('hrNote.eventHint')}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label={t('hrNote.eventOn')} htmlFor="note-event-on">
              <Input id="note-event-on" type="date" max={from} value={content.event_on} onChange={(e) => set({ event_on: e.target.value })} />
            </Field>
            <Field label={t('hrNote.eventTime')} htmlFor="note-event-time">
              <Input id="note-event-time" type="time" value={content.event_time} onChange={(e) => set({ event_time: e.target.value })} />
            </Field>
            <Field label={t('hrNote.eventArea')} htmlFor="note-event-area">
              <Select id="note-event-area" value={content.event_area} onChange={(e) => set({ event_area: e.target.value })}>
                <option value="">{t('hrNote.pick')}</option>
                {TEAMS.map((team) => (
                  <option key={team} value={team}>{t(teamLabelKey(team))}</option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>
      )}

      {structure === 'warning' && (
        <Field label={t('hrNote.level')} required htmlFor="note-level" hint={warningNumber ? t('hrNote.warningNext', { n: warningNumber }) : undefined}>
          <Select id="note-level" value={content.warning_level ?? ''} onChange={(e) => set({ warning_level: (e.target.value || null) as WarningLevel | null })}>
            <option value="">{t('hrNote.pick')}</option>
            {WARNING_LEVELS.map((level) => (
              <option key={level} value={level}>{t(`hrNote.level_${level}` as MessageKey)}</option>
            ))}
          </Select>
        </Field>
      )}

      {NOTE_SECTIONS[structure].filter((s) => !s.legacy).map((s) => {
        const id = `note-s-${s.key}`;
        const value = content.sections[s.key] ?? '';
        const change = (text: string) => set({ sections: { ...content.sections, [s.key]: text } });
        return (
          <Field
            key={`${structure}-${s.key}`}
            label={t(`hrNote.s_${structure}_${s.key}` as MessageKey)}
            hint={t(`hrNote.h_${structure}_${s.key}` as MessageKey)}
            required={s.required}
            htmlFor={id}
          >
            {s.short ? (
              <Input id={id} value={value} maxLength={300} onChange={(e) => change(e.target.value)} />
            ) : (
              <NoteTextarea id={id} rows={3} value={value} onChange={(e) => change(e.target.value)} />
            )}
          </Field>
        );
      })}

      {agreementsRule !== 'none' && (
        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-[13px] font-medium">
            {t('hrNote.agreements')}
            {agreementsRule === 'required' && <span className="ml-0.5 text-late">*</span>}
          </legend>
          <p className="text-[12px] text-muted">{t('hrNote.agreementsHint')}</p>
          {content.agreements.map((a, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border p-2.5">
              <div className="flex items-start gap-2">
                <NoteTextarea
                  aria-label={t('hrNote.agreementN', { n: i + 1 })}
                  placeholder={t('hrNote.agreementBody')}
                  rows={2}
                  value={a.body}
                  onChange={(e) => setAgreement(i, { body: e.target.value })}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('hrNote.removeAgreement', { n: i + 1 })}
                  onClick={() => set({ agreements: content.agreements.filter((_, x) => x !== i) })}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={t('hrNote.agreementWho')} htmlFor={`note-agr-who-${i}`}>
                  <Select
                    id={`note-agr-who-${i}`}
                    value={a.responsible ? personKey(a.responsible) : ''}
                    onChange={(e) => setAgreement(i, { responsible: responsibles.find((p) => personKey(p) === e.target.value) ?? null })}
                  >
                    <option value="">{t('hrNote.pick')}</option>
                    {responsibles.map((p) => (
                      <option key={personKey(p)} value={personKey(p)}>{p.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('hrNote.agreementDue')} hint={t('hrNote.agreementDueHint')} htmlFor={`note-agr-due-${i}`}>
                  <Input id={`note-agr-due-${i}`} type="date" min={from} value={a.due_on} onChange={(e) => setAgreement(i, { due_on: e.target.value })} />
                </Field>
              </div>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => set({ agreements: [...content.agreements, { body: '', responsible: defaultResponsible, due_on: '' }] })}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('hrNote.addAgreement')}
          </Button>
        </fieldset>
      )}

      {rule !== 'none' && (
        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-[13px] font-medium">
            {t('hrNote.followUp')}
            {(rule === 'required' || agreed) && <span className="ml-0.5 text-late">*</span>}
          </legend>
          {agreed && <p className="text-[12px] text-muted">{t('hrNote.followUpForAgreements')}</p>}
          {!(content.no_follow_up && maySkip) && (
            <>
              <Field label={t('hrNote.followUpText')} htmlFor="note-fu-text">
                <NoteTextarea id="note-fu-text" rows={2} value={content.follow_up_text} onChange={(e) => set({ follow_up_text: e.target.value })} />
              </Field>
              <Field label={t('hrNote.followUpOn')} hint={t('hrNote.followUpReminder')} htmlFor="note-fu-on">
                <Input id="note-fu-on" type="date" min={from} value={content.follow_up_on} onChange={(e) => set({ follow_up_on: e.target.value })} className="w-auto" />
              </Field>
            </>
          )}
          {rule === 'required' && maySkip && (
            <Checkbox label={t('hrNote.noFollowUp')} checked={content.no_follow_up} onChange={(e) => set({ no_follow_up: e.target.checked })} />
          )}
          {content.no_follow_up && maySkip && (
            <Field label={t('hrNote.noFollowUpReason')} required htmlFor="note-fu-none">
              <Input id="note-fu-none" value={content.no_follow_up_reason} maxLength={500} onChange={(e) => set({ no_follow_up_reason: e.target.value })} />
            </Field>
          )}
        </fieldset>
      )}
    </>
  );
}

/** Who was there: the writer always, then people from the list or a name typed in. */
function ParticipantPicker({
  people,
  value,
  onChange,
  viewerName,
}: {
  people: HrPerson[];
  value: HrPerson[];
  onChange: (value: HrPerson[]) => void;
  viewerName: string;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const chosen = new Set(value.map(personKey));
  const free = people.filter((p) => !chosen.has(personKey(p)));

  function addTyped() {
    const typed = name.trim();
    if (!typed) return;
    // Someone on the list, typed instead of picked, is still that person.
    const person = free.find((p) => p.name.toLowerCase() === typed.toLowerCase()) ?? { profile_id: null, worker_id: null, name: typed };
    if (!chosen.has(personKey(person))) onChange([...value, person]);
    setName('');
  }

  return (
    <Field label={t('hrNote.participants')} hint={t('hrNote.participantsHint')} required htmlFor="note-person">
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[12.5px] text-muted">{viewerName}</span>
        {value.map((p) => (
          <span key={personKey(p)} className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent/10 py-1 pl-2.5 pr-1.5 text-[12.5px] font-medium text-accent">
            {p.name}
            <button
              type="button"
              aria-label={t('hrNote.remove', { name: p.name })}
              onClick={() => onChange(value.filter((x) => personKey(x) !== personKey(p)))}
              className="rounded-full p-0.5 hover:bg-accent/20"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          id="note-person"
          value=""
          onChange={(e) => {
            const person = free.find((p) => personKey(p) === e.target.value);
            if (person) onChange([...value, person]);
          }}
        >
          <option value="">{t('hrNote.addPerson')}</option>
          {free.map((p) => (
            <option key={personKey(p)} value={personKey(p)}>{p.name}</option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Input
            aria-label={t('hrNote.otherPerson')}
            placeholder={t('hrNote.otherPerson')}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              addTyped();
            }}
          />
          <Button type="button" variant="secondary" onClick={addTyped} disabled={!name.trim()}>
            {t('hrNote.add')}
          </Button>
        </div>
      </div>
    </Field>
  );
}

/**
 * Who can be responsible for an agreement — the writer and everyone on the
 * list — and the content a form starts with: the worker's own area, and a
 * first agreement that is theirs to keep.
 */
function useNoteStart(file: HrWorkerFile, people: HrPerson[], viewerId: string, viewerName: string) {
  return useMemo(() => {
    const worker = people.find((p) => p.worker_id === file.worker.id) ?? null;
    const start: NoteContent = {
      ...EMPTY_CONTENT,
      event_area: file.worker.team,
      agreements: [{ body: '', responsible: worker, due_on: '' }],
    };
    return { responsibles: [{ profile_id: viewerId, worker_id: null, name: viewerName }, ...people], worker, start };
  }, [file.worker.id, file.worker.team, people, viewerId, viewerName]);
}

function NoteDialog({
  file,
  noteTypes,
  people,
  today,
  viewerId,
  viewerName,
  onClose,
}: {
  file: HrWorkerFile;
  noteTypes: HrNoteType[];
  people: HrPerson[];
  today: string;
  viewerId: string;
  viewerName: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const errorText = useNoteError();
  const workerId = file.worker.id;
  const { responsibles, worker, start } = useNoteStart(file, people, viewerId, viewerName);
  const [typeId, setTypeId] = useState(noteTypes[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [content, setContent] = useState<NoteContent>(start);
  // The worker the note is about is usually there; they can be taken out.
  const [participants, setParticipants] = useState<HrPerson[]>(() => people.filter((p) => p.worker_id === workerId));
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const type = noteTypes.find((ty) => ty.id === typeId);
  const structure: NoteStructure = type?.structure ?? 'general';
  const complete = !!type && !!date && missingContent(structure, content, date).length === 0;
  const warningNumber = file.notes.filter((n) => n.type?.structure === 'warning').length + 1;

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
    if (!type) return;
    setErrors([]);
    startTransition(async () => {
      const payload = toPayload(structure, content);
      const res = await addNote({
        worker_id: workerId,
        type_id: typeId,
        note_date: date,
        ...payload,
        participants,
        reminder_title: t('hrNote.reminderTitle', { worker: file.worker.name, type: localizedName(type, locale) }),
      });
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
      // A follow-up from today on should have its reminder.
      if (payload.follow_up_on && payload.follow_up_on >= today && !res.data.reminded) failed.push(t('hrNote.noReminder'));

      router.refresh();
      if (failed.length === 0) return onClose();
      // The note is saved either way; say what did not make it.
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
      className="max-w-xl"
      footer={
        saved ? (
          <Button variant="primary" onClick={onClose}>{t('common.close')}</Button>
        ) : (
          <>
            {!complete && <span className="mr-auto text-[12px] text-muted">{t('hrNote.missing')}</span>}
            <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={submit} loading={pending} disabled={!complete}>
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
                    <option key={ty.id} value={ty.id}>{localizedName(ty, locale)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('hr.noteDate')} htmlFor="note-date">
                <Input id="note-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <ContentFields
              structure={structure}
              content={content}
              onChange={setContent}
              from={date}
              warningNumber={warningNumber}
              responsibles={responsibles}
              defaultResponsible={worker}
            />
            <ParticipantPicker people={people} value={participants} onChange={setParticipants} viewerName={viewerName} />
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

/* --------------------------- adding to a note later -------------------------- */

/**
 * What came of a note's follow-up — closing it or setting a new date — or,
 * for a note from before the sections, the sections it lacks.
 */
function FollowUpDialog({
  file,
  note,
  kind,
  people,
  today,
  viewerId,
  viewerName,
  onClose,
}: {
  file: HrWorkerFile;
  note: HrNote;
  kind: HrFollowUp['kind'];
  people: HrPerson[];
  today: string;
  viewerId: string;
  viewerName: string;
  onClose: () => void;
}) {
  const { t, locale, formatDate } = useI18n();
  const router = useRouter();
  const errorText = useNoteError();
  const structure: NoteStructure = note.type?.structure ?? 'general';
  const { responsibles, worker, start } = useNoteStart(file, people, viewerId, viewerName);
  const [date, setDate] = useState(today);
  const [body, setBody] = useState('');
  const [closes, setCloses] = useState(true);
  const [nextOn, setNextOn] = useState('');
  const [nextText, setNextText] = useState('');
  const [content, setContent] = useState<NoteContent>(start);
  // Every agreement not yet met is marked at each follow-up.
  const open = useMemo(() => noteAgreements(note).filter((a) => agreementStatus(a) !== 'met'), [note]);
  const [results, setResults] = useState<Record<string, { result: AgreementResult | ''; comment: string }>>({});
  const resultOf = (id: string) => results[id] ?? { result: '', comment: '' };
  const marked = open.every((a) => {
    const r = resultOf(a.id);
    return r.result === 'met' || (!!r.result && !!r.comment.trim());
  });
  const [participants, setParticipants] = useState<HrPerson[]>(() =>
    kind === 'completion' ? people.filter((p) => p.worker_id === file.worker.id) : [],
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const complete =
    !!date &&
    (kind === 'completion'
      ? missingContent(structure, content, date).length === 0
      : !!body.trim() && marked && (closes || (!!nextOn && nextOn >= date)));

  function submit() {
    setErrors([]);
    startTransition(async () => {
      const common = {
        note_id: note.id,
        worker_id: file.worker.id,
        entry_date: date,
        participants,
        reminder_title: t('hrNote.reminderTitle', {
          worker: file.worker.name,
          type: note.type ? localizedName(note.type, locale) : t('hrNote.followUp'),
        }),
      };
      const next = kind === 'completion' ? toPayload(structure, content).follow_up_on : closes ? null : nextOn;
      const res = await addFollowUp(
        kind === 'completion'
          ? { kind, ...common, ...toPayload(structure, content) }
          : {
              kind,
              ...common,
              body,
              closes,
              next_on: closes ? null : nextOn,
              next_text: closes ? null : nextText,
              results: open.map((a) => {
                const r = resultOf(a.id);
                return { agreement_id: a.id, result: r.result as AgreementResult, comment: r.comment };
              }),
            },
      );
      if (!res.ok) return setErrors([errorText(res.error)]);
      router.refresh();
      if (!next || next < today || res.data.reminded) return onClose();
      setSaved(true);
      setErrors([t('hrNote.noReminder')]);
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(kind === 'completion' ? 'hrNote.completeTitle' : 'hrNote.followUpTitle')}
      description={t(kind === 'completion' ? 'hrNote.completeHint' : 'hrNote.followUpHint')}
      className="max-w-xl"
      footer={
        saved ? (
          <Button variant="primary" onClick={onClose}>{t('common.close')}</Button>
        ) : (
          <>
            {!complete && <span className="mr-auto text-[12px] text-muted">{t('hrNote.missing')}</span>}
            <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={submit} loading={pending} disabled={!complete}>
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
            <Field label={t('hr.noteDate')} htmlFor="entry-date">
              <Input id="entry-date" type="date" value={date} min={note.note_date} max={today} onChange={(e) => setDate(e.target.value)} className="w-auto" />
            </Field>
            {kind === 'completion' ? (
              <ContentFields
                structure={structure}
                content={content}
                onChange={setContent}
                from={date}
                responsibles={responsibles}
                defaultResponsible={worker}
              />
            ) : (
              <>
                <Field label={t('hrNote.whatHappened')} hint={t('hrNote.whatHappenedHint')} required htmlFor="entry-body">
                  <NoteTextarea id="entry-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
                </Field>
                {open.length > 0 && (
                  <fieldset className="space-y-3 rounded-lg border border-border p-3">
                    <legend className="px-1 text-[13px] font-medium">
                      {t('hrNote.results')}
                      <span className="ml-0.5 text-late">*</span>
                    </legend>
                    {open.map((a, i) => {
                      const r = resultOf(a.id);
                      const put = (patch: Partial<typeof r>) => setResults({ ...results, [a.id]: { ...r, ...patch } });
                      return (
                        <div key={a.id} className="space-y-2 rounded-md border border-border p-2.5">
                          <div className="text-[13px] leading-relaxed">
                            <NoteText text={a.body} />
                            <p className="text-[12px] text-muted">
                              {t('hrNote.agreementMeta', { name: a.responsible_name, date: formatDate(a.due_on, 'medium') })}
                            </p>
                          </div>
                          <Select aria-label={t('hrNote.resultPick', { n: i + 1 })} value={r.result} onChange={(e) => put({ result: e.target.value as AgreementResult | '' })}>
                            <option value="">{t('hrNote.pick')}</option>
                            {AGREEMENT_RESULTS.map((result) => (
                              <option key={result} value={result}>{t(`hrNote.result_${result}` as MessageKey)}</option>
                            ))}
                          </Select>
                          {(r.result === 'partly' || r.result === 'not_met') && (
                            <Field label={t('hrNote.resultComment')} required htmlFor={`entry-result-${a.id}`}>
                              <Input id={`entry-result-${a.id}`} value={r.comment} maxLength={1000} onChange={(e) => put({ comment: e.target.value })} />
                            </Field>
                          )}
                        </div>
                      );
                    })}
                  </fieldset>
                )}
                <fieldset className="space-y-3 rounded-lg border border-border p-3">
                  <legend className="px-1 text-[13px] font-medium">{t('hrNote.outcome')}</legend>
                  {([true, false] as const).map((value) => (
                    <label key={String(value)} className={cn('flex items-center gap-2 text-[13.5px]', closes === value && 'font-medium')}>
                      <input type="radio" name="entry-outcome" className="h-4 w-4 accent-accent" checked={closes === value} onChange={() => setCloses(value)} />
                      {t(value ? 'hrNote.outcomeClose' : 'hrNote.outcomeNext')}
                    </label>
                  ))}
                  {!closes && (
                    <>
                      <Field label={t('hrNote.nextOn')} hint={t('hrNote.followUpReminder')} required htmlFor="entry-next-on">
                        <Input id="entry-next-on" type="date" min={date} value={nextOn} onChange={(e) => setNextOn(e.target.value)} className="w-auto" />
                      </Field>
                      <Field label={t('hrNote.nextText')} htmlFor="entry-next-text">
                        <NoteTextarea id="entry-next-text" rows={2} value={nextText} onChange={(e) => setNextText(e.target.value)} />
                      </Field>
                    </>
                  )}
                </fieldset>
              </>
            )}
            <ParticipantPicker people={people} value={participants} onChange={setParticipants} viewerName={viewerName} />
          </>
        )}
      </div>
    </Dialog>
  );
}
