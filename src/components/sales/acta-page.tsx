'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileCheck2, Pencil, Plus, Printer, Trash2, X } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { AGREEMENT_RESULTS, agreementStatus, type AgreementResult } from '@/domain/hr/note-structure';
import {
  actaContent, actaLate, emptyAgreement, emptyPoint, missingActa,
  type ActaAgreementDraft, type ActaAttendeeDraft, type ActaDraft, type ActaPointDraft,
} from '@/domain/sales/acta';
import { timeRange } from '@/domain/sales/times';
import { addActaEntry, saveActa } from '@/server/sales-acta-actions';
import type { ActivityKind } from '@/types/sales';
import type { ActaMeeting, ActaTopic, SalesActa } from '@/types/sales-acta';
import { KindBadge, useKinds } from './activity-kind';
import { ActaContent, actaAgreements, actaFollowUp, useTopicName } from './acta-view';

/*
 * The Acta of a visit or an appointment with a customer or a prospect, on
 * its own page.
 *
 * Its salesperson writes it point by point — a draft they can keep rewriting
 * — and registers it. From then on it is permanent and in the customer's
 * file; what comes later is added underneath.
 */

export const targetHref = (target: { kind: 'customer' | 'prospect'; id: string }) =>
  target.kind === 'customer' ? `/sales/customers/${target.id}` : `/sales/prospects/${target.id}`;

function useActaError() {
  const { t } = useI18n();
  return (error: string) => {
    const known: Record<string, MessageKey> = {
      not_authorized: 'meetingRecord.errNotAuthorized',
      acta_not_for_this: 'acta.errNotForThis',
      acta_registered: 'meetingRecord.errRegistered',
      attendee_required: 'acta.errAttendees',
      attendee_not_found: 'acta.errAttendees',
      point_incomplete: 'acta.errPoint',
      topic_required: 'acta.errPoint',
      agreement_incomplete: 'acta.errAgreement',
      responsible_not_sales: 'acta.errAgreement',
      follow_up_required: 'acta.errFollowUp',
      follow_up_date_invalid: 'acta.errFollowUp',
      follow_up_closed: 'hrNote.errClosed',
      result_required: 'hrNote.errResult',
      result_comment_required: 'hrNote.errResult',
      invalid_date: 'hrNote.errDate',
    };
    return t(known[error] ?? 'meetingRecord.errUnknown');
  };
}

/** What the form starts from: the draft as it was left, or who is known to have been there. */
function startDraft(meeting: ActaMeeting, acta: SalesActa | null): ActaDraft {
  if (!acta) {
    return {
      attendees: [
        { side: 'ours', profile_id: meeting.salesperson_id, name: meeting.salesperson_name, role: '' },
        ...meeting.participants.map((p) => ({ side: 'ours' as const, profile_id: p.id, name: p.name, role: '' })),
        ...(meeting.contact_name ? [{ side: 'theirs' as const, profile_id: null, name: meeting.contact_name, role: '' }] : []),
      ],
      points: [emptyPoint()],
      follow_up_on: '',
    };
  }
  return {
    attendees: acta.attendees.map((a) => ({ side: a.side, profile_id: a.profile_id, name: a.name, role: a.role ?? '' })),
    follow_up_on: acta.follow_up_on ?? '',
    points: acta.points.map((p) => ({
      topic_id: p.topic_id ?? '',
      title: p.title,
      discussed: p.discussed ?? '',
      agreements: p.agreements.map((a) => ({ body: a.body, responsible_id: a.responsible_profile_id ?? '', due_on: a.due_on ?? '' })),
    })),
  };
}

export function ActaPage({
  meeting,
  acta,
  topics,
  people,
  kinds,
  today,
  canChange,
  startWriting,
}: {
  meeting: ActaMeeting;
  acta: SalesActa | null;
  /** Admin's list, switched-off ones included: old Actas still name them. */
  topics: ActaTopic[];
  /** Who of ours can have been there or be responsible: sales, Admin and Owners. */
  people: { id: string; name: string }[];
  kinds: ActivityKind[];
  today: string;
  /** Its salesperson, or a manager. */
  canChange: boolean;
  /** Arriving from "done": the form opens at once. */
  startWriting: boolean;
}) {
  const { t, formatDate } = useI18n();
  const k = useKinds(kinds);
  const registered = !!acta?.registered_at;
  const [writing, setWriting] = useState(startWriting && canChange && !registered);
  const [entry, setEntry] = useState<'addendum' | 'followup' | null>(null);
  const state = acta && registered ? actaFollowUp(acta, today) : null;
  const late = !registered && meeting.required && actaLate(meeting.meeting_date, today);
  const place =
    meeting.place === 'office' ? t('sales.placeOffice')
    : meeting.place === 'online' ? t('sales.placeOnline')
    : meeting.place === 'theirs' ? t('sales.placeTheirs')
    : meeting.place === 'other' ? meeting.place_detail || t('sales.placeOther')
    : null;

  return (
    <>
      <Link href={targetHref(meeting.target)} className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {meeting.target.name}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
          <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
          {t('acta.one')}
          {acta && !registered && <Badge tone="warn">{t('meetingRecord.draft')}</Badge>}
          {!acta && meeting.required && <Badge tone={late ? 'late' : 'warn'}>{t('acta.pending')}</Badge>}
        </p>
        <h1 className="mt-1 break-words text-xl font-semibold leading-tight">
          <Link href={targetHref(meeting.target)} className="hover:text-accent">{meeting.target.name}</Link>
        </h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
          <KindBadge kind={k.get(meeting.kind_id)} />
          <span className="font-medium capitalize text-fg">{formatDate(meeting.meeting_date, 'weekday')}</span>
          {meeting.start_time && <span className="tabular">{timeRange(meeting.start_time, meeting.end_time)}</span>}
          {place && <span>· {place}</span>}
          <span>· {meeting.salesperson_name}</span>
        </p>
      </Card>

      <Card className="p-3.5 sm:p-4">
        {!acta && (
          <>
            <p className="text-[13px] text-muted">{t(canChange ? 'acta.intro' : 'acta.none')}</p>
            {late && <p className="mt-1 text-[12.5px] font-medium text-late">{t('acta.lateHint')}</p>}
            {canChange && (
              <Button className="mt-3" variant="primary" onClick={() => setWriting(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                {t('meetingRecord.write')}
              </Button>
            )}
          </>
        )}

        {acta && (
          <>
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-muted">
                {registered
                  ? t('acta.registered', { date: formatDate(acta.registered_at!.slice(0, 10), 'medium'), name: acta.registered_by_name ?? '—' })
                  : t('acta.draftHint')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {canChange && !registered && (
                  <Button size="sm" variant="primary" onClick={() => setWriting(true)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    {t('meetingRecord.editDraft')}
                  </Button>
                )}
                {registered && (
                  <a
                    href={`/print/actas/${acta.activity_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px] font-medium hover:bg-surface-2"
                  >
                    <Printer className="h-3.5 w-3.5" aria-hidden />
                    {t('acta.print')}
                  </a>
                )}
              </div>
            </div>
            <ActaContent acta={acta} topics={topics} today={today} />
            {registered && canChange && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-2.5">
                {state && (state.status === 'open' || state.status === 'overdue') && (
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
      </Card>

      {writing && <ActaEditor meeting={meeting} acta={acta} topics={topics} people={people} onClose={() => setWriting(false)} />}
      {entry && acta && <EntryDialog acta={acta} kind={entry} today={today} onClose={() => setEntry(null)} />}
    </>
  );
}

/* --------------------------------- writing -------------------------------- */

function ActaEditor({
  meeting,
  acta,
  topics,
  people,
  onClose,
}: {
  meeting: ActaMeeting;
  acta: SalesActa | null;
  topics: ActaTopic[];
  people: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const actaError = useActaError();
  const topicName = useTopicName(topics);
  const [draft, setDraft] = useState<ActaDraft>(() => startDraft(meeting, acta));
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ours = draft.attendees.filter((a) => a.side === 'ours');
  const theirs = draft.attendees.filter((a) => a.side === 'theirs');
  const free = people.filter((p) => !ours.some((a) => a.profile_id === p.id));
  // Whoever is already responsible stays offered, even if no longer in sales.
  const responsibles = (current: string) => {
    const known = people.some((p) => p.id === current);
    const kept = acta?.points.flatMap((p) => p.agreements).find((a) => a.responsible_profile_id === current);
    return known || !kept?.responsible_name ? people : [...people, { id: current, name: kept.responsible_name }];
  };
  const missing = useMemo(() => missingActa(draft, meeting.meeting_date), [draft, meeting.meeting_date]);
  const missingText = missing
    .map((key) =>
      key.startsWith('point-')
        ? t('meetingRecord.missPoint', { n: Number(key.slice(6)) + 1 })
        : t(
            key === 'ours' ? 'acta.missOurs'
            : key === 'theirs' ? 'acta.missTheirs'
            : key === 'points' ? 'meetingRecord.missPoints'
            : 'meetingRecord.missFollowUp',
          ),
    )
    .join(', ');

  const setPoint = (index: number, patch: Partial<ActaPointDraft>) =>
    setDraft((d) => ({ ...d, points: d.points.map((p, i) => (i === index ? { ...p, ...patch } : p)) }));
  const setAgreement = (index: number, n: number, patch: Partial<ActaAgreementDraft>) =>
    setPoint(index, { agreements: draft.points[index]!.agreements.map((a, i) => (i === n ? { ...a, ...patch } : a)) });
  const removeAttendee = (who: ActaAttendeeDraft) =>
    setDraft((d) => ({ ...d, attendees: d.attendees.filter((a) => a !== who) }));

  function addTheirs() {
    const typed = name.trim();
    if (!typed) return;
    if (!theirs.some((a) => a.name.toLowerCase() === typed.toLowerCase())) {
      setDraft((d) => ({ ...d, attendees: [...d.attendees, { side: 'theirs', profile_id: null, name: typed, role: role.trim() }] }));
    }
    setName('');
    setRole('');
  }

  function save(register: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await saveActa(meeting.activity_id, actaContent(draft), register);
      setConfirming(false);
      if (!res.ok) return setError(actaError(res.error));
      router.refresh();
      onClose();
    });
  }

  const chip = 'inline-flex items-center gap-1 rounded-full border border-accent bg-accent/10 py-1 pl-2.5 pr-1.5 text-[12.5px] font-medium text-accent';

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={`${t('acta.one')} · ${meeting.target.name}`}
        description={t('acta.intro')}
        className="max-w-2xl"
        footer={
          <>
            {missing.length > 0 && <span className="mr-auto text-[12px] text-muted">{t('meetingRecord.missing', { what: missingText })}</span>}
            <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
            <Button variant="secondary" onClick={() => save(false)} loading={pending && !confirming}>{t('meetingRecord.saveDraft')}</Button>
            <Button variant="primary" onClick={() => setConfirming(true)} disabled={missing.length > 0 || pending}>{t('acta.register')}</Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {error && <ErrorState message={error} />}

          <Field label={t('acta.theirs', { name: meeting.target.name })} hint={t('acta.theirsHint')} required htmlFor="acta-theirs-name">
            {theirs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {theirs.map((a) => (
                  <span key={a.name} className={chip}>
                    {a.role ? `${a.name} (${a.role})` : a.name}
                    <button type="button" aria-label={t('hrNote.remove', { name: a.name })} onClick={() => removeAttendee(a)} className="rounded-full p-0.5 hover:bg-accent/20">
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                id="acta-theirs-name"
                placeholder={t('acta.theirsName')}
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  addTheirs();
                }}
              />
              <Input
                aria-label={t('acta.theirsRole')}
                placeholder={t('acta.theirsRole')}
                value={role}
                maxLength={200}
                onChange={(e) => setRole(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  addTheirs();
                }}
              />
              <Button type="button" variant="secondary" onClick={addTheirs} disabled={!name.trim()}>{t('hrNote.add')}</Button>
            </div>
          </Field>

          <Field label={t('acta.ours')} required htmlFor="acta-ours">
            {ours.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {ours.map((a) => (
                  <span key={a.profile_id} className={chip}>
                    {a.name}
                    <button type="button" aria-label={t('hrNote.remove', { name: a.name })} onClick={() => removeAttendee(a)} className="rounded-full p-0.5 hover:bg-accent/20">
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {free.length > 0 && (
              <Select
                id="acta-ours"
                value=""
                onChange={(e) => {
                  const person = free.find((p) => p.id === e.target.value);
                  if (person) setDraft((d) => ({ ...d, attendees: [...d.attendees, { side: 'ours', profile_id: person.id, name: person.name, role: '' }] }));
                }}
              >
                <option value="">{t('meetingRecord.addAttendee')}</option>
                {free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
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
              <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
                <Field label={t('acta.topic')} required htmlFor={`acta-topic-${i}`}>
                  <Select id={`acta-topic-${i}`} value={point.topic_id} onChange={(e) => setPoint(i, { topic_id: e.target.value })}>
                    <option value="">{t('hrNote.pick')}</option>
                    {/* A switched-off topic stays only on the point that already has it. */}
                    {topics.filter((topic) => topic.is_active || topic.id === point.topic_id).map((topic) => (
                      <option key={topic.id} value={topic.id}>{topicName(topic.id)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('acta.pointTitle')} hint={t('acta.pointTitleHint')} htmlFor={`acta-title-${i}`}>
                  <Input id={`acta-title-${i}`} value={point.title} maxLength={300} onChange={(e) => setPoint(i, { title: e.target.value })} />
                </Field>
              </div>
              <Field label={t('meetingRecord.discussed')} hint={t('acta.discussedHint')} required htmlFor={`acta-discussed-${i}`}>
                <NoteTextarea id={`acta-discussed-${i}`} rows={4} value={point.discussed} onChange={(e) => setPoint(i, { discussed: e.target.value })} />
              </Field>

              <div className="space-y-2">
                <p className="text-[13px] font-medium">{t('hrNote.agreements')}</p>
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
                      <Field label={t('hrNote.agreementWho')} htmlFor={`acta-who-${i}-${n}`}>
                        <Select id={`acta-who-${i}-${n}`} value={a.responsible_id} onChange={(e) => setAgreement(i, n, { responsible_id: e.target.value })}>
                          <option value="">{t('hrNote.pick')}</option>
                          {responsibles(a.responsible_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </Select>
                      </Field>
                      <Field label={t('hrNote.agreementDue')} hint={t('hrNote.agreementDueHint')} htmlFor={`acta-due-${i}-${n}`}>
                        <Input id={`acta-due-${i}-${n}`} type="date" min={meeting.meeting_date} value={a.due_on} onChange={(e) => setAgreement(i, n, { due_on: e.target.value })} />
                      </Field>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setPoint(i, { agreements: [...point.agreements, emptyAgreement(meeting.salesperson_id)] })}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t('hrNote.addAgreement')}
                </Button>
              </div>
            </fieldset>
          ))}

          <Button type="button" size="sm" variant="secondary" onClick={() => setDraft((d) => ({ ...d, points: [...d.points, emptyPoint()] }))}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('meetingRecord.addPoint')}
          </Button>

          <Field label={t('meetingRecord.followUpOn')} hint={t('acta.followUpHint')} htmlFor="acta-follow-up">
            <Input id="acta-follow-up" type="date" min={meeting.meeting_date} value={draft.follow_up_on} onChange={(e) => setDraft((d) => ({ ...d, follow_up_on: e.target.value }))} className="w-auto" />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => save(true)}
        title={t('acta.register')}
        message={t('acta.registerConfirm')}
        confirmLabel={t('acta.register')}
        cancelLabel={t('common.back')}
        loading={pending}
      />
    </>
  );
}

/* ------------------------- adding to a registered Acta ------------------------- */

function EntryDialog({ acta, kind, today, onClose }: { acta: SalesActa; kind: 'addendum' | 'followup'; today: string; onClose: () => void }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const actaError = useActaError();
  const [date, setDate] = useState(today);
  const [body, setBody] = useState('');
  const [closes, setCloses] = useState(true);
  const [nextOn, setNextOn] = useState('');
  // Every agreement not yet met is marked at each follow-up.
  const open = useMemo(() => actaAgreements(acta).filter((a) => agreementStatus(a) !== 'met'), [acta]);
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
      const res = await addActaEntry(
        acta.activity_id,
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
      if (!res.ok) return setError(actaError(res.error));
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
        <Field label={t('hr.noteDate')} htmlFor="acta-entry-date">
          <Input id="acta-entry-date" type="date" value={date} min={acta.meeting_date} max={today} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        </Field>
        <Field label={t(kind === 'followup' ? 'hrNote.whatHappened' : 'meetingRecord.addendum')} hint={kind === 'followup' ? t('hrNote.whatHappenedHint') : undefined} required htmlFor="acta-entry-body">
          <NoteTextarea id="acta-entry-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
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
                          {a.responsible_name}
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
                        <Field label={t('hrNote.resultComment')} required htmlFor={`acta-result-${a.id}`}>
                          <Input id={`acta-result-${a.id}`} value={r.comment} maxLength={1000} onChange={(e) => put({ comment: e.target.value })} />
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
                  <input type="radio" name="acta-outcome" className="h-4 w-4 accent-accent" checked={closes === value} onChange={() => setCloses(value)} />
                  {t(value ? 'hrNote.outcomeClose' : 'hrNote.outcomeNext')}
                </label>
              ))}
              {!closes && (
                <Field label={t('hrNote.nextOn')} required htmlFor="acta-next-on">
                  <Input id="acta-next-on" type="date" min={date} value={nextOn} onChange={(e) => setNextOn(e.target.value)} className="w-auto" />
                </Field>
              )}
            </fieldset>
          </>
        )}
      </div>
    </Dialog>
  );
}
