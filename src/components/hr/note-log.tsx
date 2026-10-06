'use client';

import { useMemo, useState, useTransition } from 'react';
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
  EMPTY_CONTENT,
  FOLLOW_UP_RULE,
  NOTE_SECTIONS,
  WARNING_LEVELS,
  followUpState,
  missingContent,
  warningNumbers,
  type NoteContent,
  type NoteStructure,
  type WarningLevel,
} from '@/domain/hr/note-structure';
import { useHrError } from './worker-dialog';
import type { HrFollowUp, HrNote, HrNoteType, HrParticipant, HrPerson, HrWorkerFile } from '@/types/hr';

/*
 * The log of a worker's file.
 *
 * A note is written in the sections of its type — why, what was said, what
 * was agreed, what happens next, who was there — and none of them can be left
 * out. What comes of a follow-up is added underneath later, as its own entry;
 * the note itself never changes.
 */

const personKey = (p: HrPerson) => p.profile_id ?? p.worker_id ?? `n:${p.name.toLowerCase()}`;

/** What the form holds, as the action takes it: only this structure's own sections. */
function toPayload(structure: NoteStructure, c: NoteContent) {
  const rule = FOLLOW_UP_RULE[structure];
  const planned = rule !== 'none' && !c.no_follow_up && !!c.follow_up_text.trim();
  return {
    sections: Object.fromEntries(
      NOTE_SECTIONS[structure].map((s) => [s.key, (c.sections[s.key] ?? '').trim()]).filter(([, text]) => text),
    ) as Record<string, string>,
    warning_level: structure === 'warning' ? c.warning_level : null,
    follow_up_text: planned ? c.follow_up_text : null,
    follow_up_on: planned ? c.follow_up_on : null,
    no_follow_up_reason: rule !== 'none' && c.no_follow_up ? c.no_follow_up_reason : null,
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
    };
    return known[error] ? t(known[error]) : hrError(error);
  };
}

export function LogTab({
  file,
  noteTypes,
  people,
  today,
  viewerId,
  viewerName,
  isAdmin,
}: {
  file: HrWorkerFile;
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

  const shown = typeFilter ? file.notes.filter((n) => n.type?.id === typeFilter) : file.notes;
  // Every type that appears in the log, including one Admin has since switched off.
  const types = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of file.notes) if (n.type) map.set(n.type.id, localizedName(n.type, locale));
    return [...map.entries()];
  }, [file.notes, locale]);
  const numbers = useMemo(() => warningNumbers(file.notes), [file.notes]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {types.length > 1 ? (
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
        ) : (
          <span />
        )}
        <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('hr.newNote')}
        </Button>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={t('hr.noNotes')} />
      ) : (
        <ul className="space-y-2">
          {shown.map((n) => {
            const structure: NoteStructure = n.type?.structure ?? 'general';
            const completion = n.follow_ups.find((f) => f.kind === 'completion');
            const level = n.warning_level ?? completion?.warning_level ?? null;
            const number = numbers.get(n.id);
            const state = followUpState(n, today);
            const mayAdd = (n.created_by === viewerId || isAdmin) && state.status !== 'closed';
            return (
              <li key={n.id}>
                <Card className="p-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                    <span className="tabular font-medium text-fg">{formatDate(n.note_date, 'medium')}</span>
                    {n.type && <Badge tone="accent">{localizedName(n.type, locale)}</Badge>}
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
          viewerName={viewerName}
          onClose={() => setEntry(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------ reading a note ----------------------------- */

/** The sections of a note or of a later entry, then its follow-up and who was there. */
function NoteContentView({
  structure,
  sections,
  followUpText,
  followUpOn,
  noFollowUpReason,
  participants,
}: {
  structure: NoteStructure;
  sections: Record<string, string> | null;
  followUpText: string | null;
  followUpOn: string | null;
  noFollowUpReason: string | null;
  participants: HrParticipant[];
}) {
  const { t, formatDate } = useI18n();
  const rows: { label: string; text: string }[] = [
    ...NOTE_SECTIONS[structure]
      .filter((s) => sections?.[s.key])
      .map((s) => ({ label: t(`hrNote.s_${structure}_${s.key}` as MessageKey), text: sections![s.key]! })),
    ...(followUpOn
      ? [{ label: `${t('hrNote.followUp')} · ${formatDate(followUpOn, 'medium')}`, text: followUpText ?? '' }]
      : []),
    ...(noFollowUpReason ? [{ label: t('hrNote.noFollowUpLabel'), text: noFollowUpReason }] : []),
  ];
  if (rows.length === 0 && participants.length === 0) return null;

  return (
    <dl className="mt-2 space-y-2 text-[13px] leading-relaxed">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{row.label}</dt>
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
}: {
  structure: NoteStructure;
  content: NoteContent;
  onChange: (content: NoteContent) => void;
  /** The follow-up cannot be before this day. */
  from: string;
  /** Which warning this would be for the worker. */
  warningNumber?: number;
}) {
  const { t } = useI18n();
  const rule = FOLLOW_UP_RULE[structure];
  const set = (patch: Partial<NoteContent>) => onChange({ ...content, ...patch });

  return (
    <>
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

      {NOTE_SECTIONS[structure].map((s) => {
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

      {rule !== 'none' && (
        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-[13px] font-medium">
            {t('hrNote.followUp')}
            {rule === 'required' && <span className="ml-0.5 text-late">*</span>}
          </legend>
          {!content.no_follow_up && (
            <>
              <Field label={t('hrNote.followUpText')} htmlFor="note-fu-text">
                <NoteTextarea id="note-fu-text" rows={2} value={content.follow_up_text} onChange={(e) => set({ follow_up_text: e.target.value })} />
              </Field>
              <Field label={t('hrNote.followUpOn')} hint={t('hrNote.followUpReminder')} htmlFor="note-fu-on">
                <Input id="note-fu-on" type="date" min={from} value={content.follow_up_on} onChange={(e) => set({ follow_up_on: e.target.value })} className="w-auto" />
              </Field>
            </>
          )}
          {rule === 'required' && (
            <Checkbox label={t('hrNote.noFollowUp')} checked={content.no_follow_up} onChange={(e) => set({ no_follow_up: e.target.checked })} />
          )}
          {content.no_follow_up && (
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

function NoteDialog({
  file,
  noteTypes,
  people,
  today,
  viewerName,
  onClose,
}: {
  file: HrWorkerFile;
  noteTypes: HrNoteType[];
  people: HrPerson[];
  today: string;
  viewerName: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const errorText = useNoteError();
  const workerId = file.worker.id;
  const [typeId, setTypeId] = useState(noteTypes[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [content, setContent] = useState<NoteContent>(EMPTY_CONTENT);
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
  viewerName,
  onClose,
}: {
  file: HrWorkerFile;
  note: HrNote;
  kind: HrFollowUp['kind'];
  people: HrPerson[];
  today: string;
  viewerName: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const errorText = useNoteError();
  const structure: NoteStructure = note.type?.structure ?? 'general';
  const [date, setDate] = useState(today);
  const [body, setBody] = useState('');
  const [closes, setCloses] = useState(true);
  const [nextOn, setNextOn] = useState('');
  const [nextText, setNextText] = useState('');
  const [content, setContent] = useState<NoteContent>(EMPTY_CONTENT);
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
      : !!body.trim() && (closes || (!!nextOn && nextOn >= date)));

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
          : { kind, ...common, body, closes, next_on: closes ? null : nextOn, next_text: closes ? null : nextText },
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
              <ContentFields structure={structure} content={content} onChange={setContent} from={date} />
            ) : (
              <>
                <Field label={t('hrNote.whatHappened')} hint={t('hrNote.whatHappenedHint')} required htmlFor="entry-body">
                  <NoteTextarea id="entry-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
                </Field>
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
