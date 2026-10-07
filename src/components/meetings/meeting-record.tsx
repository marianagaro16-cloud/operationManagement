'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileCheck2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { AGREEMENT_RESULTS, NOTE_TOPICS, agreementStatus, type AgreementResult, type NotePerson, type NoteTopic } from '@/domain/hr/note-structure';
import { EMPTY_AGREEMENT, agendaPoints, emptyPoint, missingRecord, recordContent, type RecordAgreementDraft, type RecordDraft, type RecordPointDraft } from '@/domain/meetings/record';
import { addMeetingRecordEntry, saveMeetingRecord, setMeetingForFiles } from '@/server/meeting-record-actions';
import type { Meeting, MeetingRecord } from '@/types/meetings';
import { MeetingRecordContent, recordAgreements, recordFollowUp } from './meeting-record-view';

/*
 * A meeting's record for the workers' files, on the meeting itself.
 *
 * Its organiser writes it point by point — a draft they can keep rewriting —
 * and whoever may open the attendees' files registers it. From then on it is
 * permanent and shows in each attendee's log; what comes later is added
 * underneath.
 */

const personKey = (p: NotePerson) => p.worker_id ?? p.profile_id ?? `n:${p.name.toLowerCase()}`;

function useRecordError() {
  const { t } = useI18n();
  return (error: string) => {
    const known: Record<string, MessageKey> = {
      not_authorized: 'meetingRecord.errNotAuthorized',
      files_not_allowed: 'meetingRecord.errFiles',
      attendee_required: 'meetingRecord.errAttendee',
      point_incomplete: 'meetingRecord.errPoint',
      topic_required: 'meetingRecord.errPoint',
      agreement_required: 'meetingRecord.errAgreement',
      agreement_incomplete: 'meetingRecord.errAgreement',
      follow_up_required: 'meetingRecord.errFollowUp',
      follow_up_date_invalid: 'meetingRecord.errFollowUp',
      record_registered: 'meetingRecord.errRegistered',
      meeting_not_held: 'meetingRecord.errNotHeld',
      follow_up_closed: 'hrNote.errClosed',
      result_required: 'hrNote.errResult',
      result_comment_required: 'hrNote.errResult',
      participant_not_found: 'hrNote.errParticipant',
      invalid_date: 'hrNote.errDate',
    };
    return t(known[error] ?? 'meetingRecord.errUnknown');
  };
}

/** What the form starts from: the draft as it was left, or the agenda's points. */
function startDraft(meeting: Meeting, record: MeetingRecord | null): RecordDraft {
  if (!record) {
    const titles = agendaPoints(meeting.agenda);
    return { attendees: [], points: (titles.length ? titles : ['']).map((title) => emptyPoint(title)), follow_up_on: '' };
  }
  const byId = new Map(record.attendees.map((a) => [a.id, a]));
  return {
    attendees: [...byId.values()].map(({ profile_id, worker_id, name }) => ({ profile_id, worker_id, name })),
    follow_up_on: record.follow_up_on ?? '',
    points: record.points.map((p) => ({
      title: p.title,
      topic: p.topic,
      situation: p.situation ?? '',
      discussed: p.discussed ?? '',
      no_agreements: p.agreements.length === 0 && !!p.no_agreements_reason,
      no_agreements_reason: p.no_agreements_reason ?? '',
      agreements: p.agreements.length
        ? p.agreements.map((a) => ({
            body: a.body,
            all: a.responsible_all,
            responsible: a.responsible_name
              ? { profile_id: a.responsible_profile_id, worker_id: a.responsible_worker_id, name: a.responsible_name }
              : null,
            due_on: a.due_on ?? '',
          }))
        : [{ ...EMPTY_AGREEMENT }],
    })),
  };
}

export function MeetingRecordCard({
  meeting,
  record,
  people,
  today,
  started,
  canChange,
  canRegister,
}: {
  meeting: Meeting;
  record: MeetingRecord | null;
  /** Whom attendees are picked from: worker files and accounts. */
  people: NotePerson[];
  today: string;
  /** The meeting has started: its record can be written. */
  started: boolean;
  /** The organiser, or Admin. */
  canChange: boolean;
  /** The viewer has access to workers' files; whether to these, the database decides. */
  canRegister: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const recordError = useRecordError();
  const [writing, setWriting] = useState(false);
  const [entry, setEntry] = useState<'addendum' | 'followup' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const registered = !!record?.registered_at;
  const state = record && registered ? recordFollowUp(record, today) : null;
  if (!record && !(canChange && meeting.status === 'scheduled')) return null;

  return (
    <Card className="p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
          <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
          {t('meetingRecord.title')}
          {record && !registered && <Badge tone="warn">{t('meetingRecord.draft')}</Badge>}
        </h2>
        {canChange && started && !registered && (
          <Button size="sm" variant={record ? 'secondary' : 'primary'} onClick={() => setWriting(true)}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {t(record ? 'meetingRecord.editDraft' : 'meetingRecord.write')}
          </Button>
        )}
      </div>

      {error && <div className="mb-2"><ErrorState message={error} /></div>}

      {!record && (
        <>
          <p className="text-[12.5px] text-muted">{t('meetingRecord.intro')}</p>
          <Checkbox
            className="mt-2"
            label={t('meetingRecord.forFiles')}
            checked={meeting.hr_record}
            disabled={pending}
            onChange={(e) => {
              const on = e.target.checked;
              setError(null);
              startTransition(async () => {
                const res = await setMeetingForFiles(meeting.id, on);
                if (!res.ok) return setError(recordError(res.error));
                router.refresh();
              });
            }}
          />
          <p className="mt-0.5 text-[12px] text-muted">{t('meetingRecord.forFilesHint')}</p>
        </>
      )}

      {record && (
        <>
          <p className="mb-2 text-[12px] text-muted">
            {registered
              ? t('meetingRecord.registered', { date: formatDate(record.registered_at!.slice(0, 10), 'medium'), name: record.registered_by_name ?? '—' })
              : t('meetingRecord.draftHint')}
          </p>
          <MeetingRecordContent record={record} today={today} />
          {registered && canChange && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-2.5">
              {state && state.status !== 'closed' && state.status !== 'none' && (
                <Button size="sm" variant="secondary" onClick={() => setEntry('followup')}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t('hrNote.addFollowUp')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEntry('addendum')}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t('meetingRecord.addAddendum')}
              </Button>
            </div>
          )}
        </>
      )}

      {writing && (
        <RecordEditor meeting={meeting} record={record} people={people} canRegister={canRegister} onClose={() => setWriting(false)} />
      )}
      {entry && record && <EntryDialog record={record} kind={entry} today={today} onClose={() => setEntry(null)} />}
    </Card>
  );
}

/* --------------------------------- writing -------------------------------- */

function RecordEditor({
  meeting,
  record,
  people,
  canRegister,
  onClose,
}: {
  meeting: Meeting;
  record: MeetingRecord | null;
  people: NotePerson[];
  canRegister: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const recordError = useRecordError();
  const [draft, setDraft] = useState<RecordDraft>(() => startDraft(meeting, record));
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const chosen = new Set(draft.attendees.map(personKey));
  const free = people.filter((p) => !chosen.has(personKey(p)));
  const missing = useMemo(() => missingRecord(draft, meeting.meeting_date), [draft, meeting.meeting_date]);
  const missingText = missing
    .map((key) =>
      key.startsWith('point-')
        ? t('meetingRecord.missPoint', { n: Number(key.slice(6)) + 1 })
        : t(key === 'attendees' ? 'meetingRecord.missAttendees' : key === 'points' ? 'meetingRecord.missPoints' : 'meetingRecord.missFollowUp'),
    )
    .join(', ');

  const setPoint = (index: number, patch: Partial<RecordPointDraft>) =>
    setDraft((d) => ({ ...d, points: d.points.map((p, i) => (i === index ? { ...p, ...patch } : p)) }));
  const setAgreement = (index: number, n: number, patch: Partial<RecordAgreementDraft>) =>
    setPoint(index, { agreements: draft.points[index]!.agreements.map((a, i) => (i === n ? { ...a, ...patch } : a)) });

  function addTyped() {
    const typed = name.trim();
    if (!typed) return;
    // Someone on the list, typed instead of picked, is still that person.
    const person = free.find((p) => p.name.toLowerCase() === typed.toLowerCase()) ?? { profile_id: null, worker_id: null, name: typed };
    if (!chosen.has(personKey(person))) setDraft((d) => ({ ...d, attendees: [...d.attendees, person] }));
    setName('');
  }

  function removeAttendee(person: NotePerson) {
    const key = personKey(person);
    setDraft((d) => ({
      attendees: d.attendees.filter((a) => personKey(a) !== key),
      follow_up_on: d.follow_up_on,
      // Whoever was not there is not responsible for anything.
      points: d.points.map((p) => ({
        ...p,
        agreements: p.agreements.map((a) => (a.responsible && personKey(a.responsible) === key ? { ...a, responsible: null } : a)),
      })),
    }));
  }

  function save(register: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await saveMeetingRecord(meeting.id, recordContent(draft), register);
      setConfirming(false);
      if (!res.ok) return setError(recordError(res.error));
      router.refresh();
      onClose();
    });
  }

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={t('meetingRecord.title')}
        description={t('meetingRecord.intro')}
        className="max-w-2xl"
        footer={
          <>
            {missing.length > 0 && <span className="mr-auto text-[12px] text-muted">{t('meetingRecord.missing', { what: missingText })}</span>}
            <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
            <Button variant="secondary" onClick={() => save(false)} loading={pending && !confirming}>{t('meetingRecord.saveDraft')}</Button>
            {canRegister && (
              <Button variant="primary" onClick={() => setConfirming(true)} disabled={missing.length > 0 || pending}>
                {t('meetingRecord.register')}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3.5">
          {error && <ErrorState message={error} />}
          {!canRegister && <p className="rounded-lg border border-border bg-surface-2 p-2.5 text-[12.5px] text-muted">{t('meetingRecord.needsHr')}</p>}

          <Field label={t('meetingRecord.attendees')} hint={t('meetingRecord.attendeesHint')} required htmlFor="record-attendee">
            {draft.attendees.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {draft.attendees.map((p) => (
                  <span key={personKey(p)} className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent/10 py-1 pl-2.5 pr-1.5 text-[12.5px] font-medium text-accent">
                    {p.name}
                    <button type="button" aria-label={t('hrNote.remove', { name: p.name })} onClick={() => removeAttendee(p)} className="rounded-full p-0.5 hover:bg-accent/20">
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                id="record-attendee"
                value=""
                onChange={(e) => {
                  const person = free.find((p) => personKey(p) === e.target.value);
                  if (person) setDraft((d) => ({ ...d, attendees: [...d.attendees, person] }));
                }}
              >
                <option value="">{t('meetingRecord.addAttendee')}</option>
                {free.map((p) => (
                  <option key={personKey(p)} value={personKey(p)}>{p.name}</option>
                ))}
              </Select>
              <div className="flex gap-2">
                <Input
                  aria-label={t('meetingRecord.otherAttendee')}
                  placeholder={t('meetingRecord.otherAttendee')}
                  value={name}
                  maxLength={200}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addTyped();
                  }}
                />
                <Button type="button" variant="secondary" onClick={addTyped} disabled={!name.trim()}>{t('hrNote.add')}</Button>
              </div>
            </div>
          </Field>

          {draft.points.map((point, i) => (
            <fieldset key={i} className={cn('space-y-3 rounded-lg border p-3', missing.includes(`point-${i}`) ? 'border-border' : 'border-done/50')}>
              <legend className="flex items-center gap-1 px-1 text-[13px] font-medium">
                {t('meetingRecord.point', { n: i + 1 })}
                {draft.points.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-late"
                    aria-label={t('meetingRecord.removePoint', { n: i + 1 })}
                    onClick={() => setDraft((d) => ({ ...d, points: d.points.filter((_, x) => x !== i) }))}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
              </legend>
              <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
                <Field label={t('meetingRecord.pointTitle')} required htmlFor={`record-title-${i}`}>
                  <Input id={`record-title-${i}`} value={point.title} maxLength={300} onChange={(e) => setPoint(i, { title: e.target.value })} />
                </Field>
                <Field label={t('hrNote.topic')} required htmlFor={`record-topic-${i}`}>
                  <Select id={`record-topic-${i}`} value={point.topic ?? ''} onChange={(e) => setPoint(i, { topic: (e.target.value || null) as NoteTopic | null })}>
                    <option value="">{t('hrNote.pick')}</option>
                    {NOTE_TOPICS.map((topic) => (
                      <option key={topic} value={topic}>{t(`hrNote.topic_${topic}` as MessageKey)}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label={t('meetingRecord.situation')} hint={t('meetingRecord.situationHint')} required htmlFor={`record-situation-${i}`}>
                <NoteTextarea id={`record-situation-${i}`} rows={3} value={point.situation} onChange={(e) => setPoint(i, { situation: e.target.value })} />
              </Field>
              <Field label={t('meetingRecord.discussed')} hint={t('meetingRecord.discussedHint')} required htmlFor={`record-discussed-${i}`}>
                <NoteTextarea id={`record-discussed-${i}`} rows={3} value={point.discussed} onChange={(e) => setPoint(i, { discussed: e.target.value })} />
              </Field>

              <div className="space-y-2">
                <p className="text-[13px] font-medium">
                  {t('hrNote.agreements')}
                  <span className="ml-0.5 text-late">*</span>
                </p>
                {!point.no_agreements && (
                  <>
                    {point.agreements.map((a, n) => (
                      <div key={n} className="space-y-2 rounded-md border border-border p-2.5">
                        <div className="flex items-start gap-2">
                          <NoteTextarea
                            aria-label={t('hrNote.agreementN', { n: n + 1 })}
                            placeholder={t('hrNote.agreementBody')}
                            rows={2}
                            value={a.body}
                            onChange={(e) => setAgreement(i, n, { body: e.target.value })}
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={t('hrNote.removeAgreement', { n: n + 1 })}
                            onClick={() => setPoint(i, { agreements: point.agreements.filter((_, x) => x !== n) })}
                          >
                            <X className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Field label={t('hrNote.agreementWho')} htmlFor={`record-who-${i}-${n}`}>
                            <Select
                              id={`record-who-${i}-${n}`}
                              value={a.all ? 'all' : a.responsible ? personKey(a.responsible) : ''}
                              onChange={(e) =>
                                setAgreement(i, n, {
                                  all: e.target.value === 'all',
                                  responsible: draft.attendees.find((p) => personKey(p) === e.target.value) ?? null,
                                })
                              }
                            >
                              <option value="">{t('hrNote.pick')}</option>
                              <option value="all">{t('meetingRecord.allAttendees')}</option>
                              {draft.attendees.map((p) => (
                                <option key={personKey(p)} value={personKey(p)}>{p.name}</option>
                              ))}
                            </Select>
                          </Field>
                          <Field label={t('hrNote.agreementDue')} hint={t('hrNote.agreementDueHint')} htmlFor={`record-due-${i}-${n}`}>
                            <Input id={`record-due-${i}-${n}`} type="date" min={meeting.meeting_date} value={a.due_on} onChange={(e) => setAgreement(i, n, { due_on: e.target.value })} />
                          </Field>
                        </div>
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="secondary" onClick={() => setPoint(i, { agreements: [...point.agreements, { ...EMPTY_AGREEMENT }] })}>
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      {t('hrNote.addAgreement')}
                    </Button>
                  </>
                )}
                <Checkbox label={t('meetingRecord.noAgreements')} checked={point.no_agreements} onChange={(e) => setPoint(i, { no_agreements: e.target.checked })} />
                {point.no_agreements && (
                  <Field label={t('meetingRecord.noAgreementsReason')} required htmlFor={`record-none-${i}`}>
                    <Input id={`record-none-${i}`} value={point.no_agreements_reason} maxLength={500} onChange={(e) => setPoint(i, { no_agreements_reason: e.target.value })} />
                  </Field>
                )}
              </div>
            </fieldset>
          ))}

          <Button type="button" size="sm" variant="secondary" onClick={() => setDraft((d) => ({ ...d, points: [...d.points, emptyPoint()] }))}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('meetingRecord.addPoint')}
          </Button>

          <Field label={t('meetingRecord.followUpOn')} hint={t('meetingRecord.followUpHint')} htmlFor="record-follow-up">
            <Input id="record-follow-up" type="date" min={meeting.meeting_date} value={draft.follow_up_on} onChange={(e) => setDraft((d) => ({ ...d, follow_up_on: e.target.value }))} className="w-auto" />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => save(true)}
        title={t('meetingRecord.register')}
        message={t('meetingRecord.registerConfirm')}
        confirmLabel={t('meetingRecord.register')}
        cancelLabel={t('common.back')}
        loading={pending}
      />
    </>
  );
}

/* ------------------------- adding to a registered record ------------------------- */

function EntryDialog({ record, kind, today, onClose }: { record: MeetingRecord; kind: 'addendum' | 'followup'; today: string; onClose: () => void }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const recordError = useRecordError();
  const [date, setDate] = useState(today);
  const [body, setBody] = useState('');
  const [closes, setCloses] = useState(true);
  const [nextOn, setNextOn] = useState('');
  // Every agreement not yet met is marked at each follow-up.
  const open = useMemo(() => recordAgreements(record).filter((a) => agreementStatus(a) !== 'met'), [record]);
  const [results, setResults] = useState<Record<string, { result: AgreementResult | ''; comment: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const resultOf = (id: string) => results[id] ?? { result: '', comment: '' };
  const marked = open.every((a) => {
    const r = resultOf(a.id);
    return r.result === 'met' || (!!r.result && !!r.comment.trim());
  });
  const complete = !!date && !!body.trim() && (kind === 'addendum' || (marked && (closes || (!!nextOn && nextOn >= date))));

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await addMeetingRecordEntry(
        record.meeting_id,
        kind === 'addendum'
          ? { kind, entry_date: date, body }
          : {
              kind,
              entry_date: date,
              body,
              closes,
              next_on: closes ? null : nextOn,
              results: open.map((a) => {
                const r = resultOf(a.id);
                return { agreement_id: a.id, result: r.result as AgreementResult, comment: r.comment || null };
              }),
            },
      );
      if (!res.ok) return setError(recordError(res.error));
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(kind === 'followup' ? 'hrNote.addFollowUp' : 'meetingRecord.addAddendum')}
      description={t('meetingRecord.addendumHint')}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!complete}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('hr.noteDate')} htmlFor="record-entry-date">
          <Input id="record-entry-date" type="date" value={date} min={record.meeting_date} max={today} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        </Field>
        <Field label={t(kind === 'followup' ? 'hrNote.whatHappened' : 'meetingRecord.addendum')} hint={kind === 'followup' ? t('hrNote.whatHappenedHint') : undefined} required htmlFor="record-entry-body">
          <NoteTextarea id="record-entry-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>

        {kind === 'followup' && (
          <>
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
                          {a.responsible_all ? t('meetingRecord.allAttendees') : a.responsible_name}
                          {a.due_on && ` · ${t('meetingRecord.until', { date: formatDate(a.due_on, 'medium') })}`}
                        </p>
                      </div>
                      <Select aria-label={t('hrNote.resultPick', { n: i + 1 })} value={r.result} onChange={(e) => put({ result: e.target.value as AgreementResult | '' })}>
                        <option value="">{t('hrNote.pick')}</option>
                        {AGREEMENT_RESULTS.map((result) => (
                          <option key={result} value={result}>{t(`hrNote.result_${result}` as MessageKey)}</option>
                        ))}
                      </Select>
                      {(r.result === 'partly' || r.result === 'not_met') && (
                        <Field label={t('hrNote.resultComment')} required htmlFor={`record-result-${a.id}`}>
                          <Input id={`record-result-${a.id}`} value={r.comment} maxLength={1000} onChange={(e) => put({ comment: e.target.value })} />
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
                  <input type="radio" name="record-outcome" className="h-4 w-4 accent-accent" checked={closes === value} onChange={() => setCloses(value)} />
                  {t(value ? 'hrNote.outcomeClose' : 'hrNote.outcomeNext')}
                </label>
              ))}
              {!closes && (
                <Field label={t('hrNote.nextOn')} required htmlFor="record-next-on">
                  <Input id="record-next-on" type="date" min={date} value={nextOn} onChange={(e) => setNextOn(e.target.value)} className="w-auto" />
                </Field>
              )}
            </fieldset>
          </>
        )}
      </div>
    </Dialog>
  );
}
