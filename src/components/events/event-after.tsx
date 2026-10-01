'use client';

import { useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import { FileText, Paperclip, Pencil, Plus, Star, Trash2, UserPlus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { createClient } from '@/lib/supabase/client';
import { EVENT_ALLOWED_MIME, EVENT_BUCKET, EVENT_MAX_BYTES } from '@/lib/events';
import { shrinkImage } from '@/lib/shrink-image';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { addEventContact, addEventNote, recordEventFile, removeEventFile, saveResults } from '@/server/event-actions';
import type { EventContact, EventFile, EventNote, EventRow } from '@/types/events';
import { useEventLabels, useEventsLimited, useEventsReadOnly } from './event-parts';

/* After (and around) the event: how it went, notes, who we met, photos and files. */

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function hasResults(e: EventRow): boolean {
  return [e.result_summary, e.result_rating, e.result_repeat, e.result_visitors, e.result_samples, e.result_contacts].some(
    (v) => v !== null && v !== '',
  );
}

export function Stars({ value }: { value: number }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={t('event.ratingOf', { rating: value })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn('h-3.5 w-3.5', n <= value ? 'fill-warn text-warn' : 'text-subtle')} aria-hidden />
      ))}
    </span>
  );
}

/* -------------------------------- results -------------------------------- */

export function ResultsCard({ event }: { event: EventRow }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const readOnly = useEventsReadOnly();
  const repeat = { yes: t('event.repeatYes'), no: t('event.repeatNo'), maybe: t('event.repeatMaybe') };
  const figures: [string, number | null][] = [
    [t('event.visitors'), event.result_visitors],
    [t('event.samplesGiven'), event.result_samples],
    [t('event.contactsMade'), event.result_contacts],
  ];

  return (
    <Section
      title={t('event.results')}
      action={
        !readOnly && event.stage !== 'cancelled' && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {t('common.edit')}
          </Button>
        )
      }
    >
      {!hasResults(event) ? (
        <p className="text-[12.5px] text-muted">{t('event.resultsNone')}</p>
      ) : (
        <div className="space-y-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {event.result_rating !== null && <Stars value={event.result_rating} />}
            {event.result_repeat && (
              <span>
                <span className="text-muted">{t('event.repeat')}:</span> <span className="font-medium">{repeat[event.result_repeat]}</span>
              </span>
            )}
            {figures
              .filter(([, v]) => v !== null)
              .map(([label, v]) => (
                <span key={label}>
                  <span className="text-muted">{label}:</span> <span className="font-medium tabular">{v}</span>
                </span>
              ))}
          </div>
          {event.result_summary && <NoteText text={event.result_summary} />}
        </div>
      )}
      {editing && <ResultsDialog event={event} markDone={false} onClose={() => setEditing(false)} />}
    </Section>
  );
}

/** How it went. From "Mark as done" it also marks the event done; anything can be left for later. */
export function ResultsDialog({ event, markDone, onClose }: { event: EventRow; markDone: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [summary, setSummary] = useState(event.result_summary ?? '');
  const [rating, setRating] = useState<number | null>(event.result_rating);
  const [repeat, setRepeat] = useState(event.result_repeat ?? '');
  const [visitors, setVisitors] = useState(event.result_visitors?.toString() ?? '');
  const [samples, setSamples] = useState(event.result_samples?.toString() ?? '');
  const [contacts, setContacts] = useState(event.result_contacts?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const whole = (v: string) => (v.trim() === '' ? null : Number(v));
  const valid = [visitors, samples, contacts].every((v) => v.trim() === '' || (Number.isInteger(Number(v)) && Number(v) >= 0));

  function submit() {
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      const res = await saveResults(
        event.id,
        {
          result_summary: summary,
          result_rating: rating,
          result_repeat: (repeat || null) as 'yes' | 'no' | 'maybe' | null,
          result_visitors: whole(visitors),
          result_samples: whole(samples),
          result_contacts: whole(contacts),
        },
        markDone,
      );
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={markDone ? t('event.markDone') : t('event.results')}
      description={markDone ? t('event.markDoneResultsHint') : undefined}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant={markDone ? 'success' : 'primary'} onClick={submit} loading={pending} disabled={!valid}>
            {markDone ? t('event.markDone') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('event.howItWent')} htmlFor="event-result-summary">
          <NoteTextarea id="event-result-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('event.rating')}>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={t('event.ratingOf', { rating: n })}
                  aria-pressed={rating === n}
                  onClick={() => setRating(rating === n ? null : n)}
                  className="rounded p-0.5 hover:bg-surface-2"
                >
                  <Star className={cn('h-6 w-6', rating !== null && n <= rating ? 'fill-warn text-warn' : 'text-subtle')} aria-hidden />
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('event.repeat')} htmlFor="event-result-repeat">
            <Select id="event-result-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
              <option value="">—</option>
              <option value="yes">{t('event.repeatYes')}</option>
              <option value="maybe">{t('event.repeatMaybe')}</option>
              <option value="no">{t('event.repeatNo')}</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('event.visitors')} htmlFor="event-result-visitors">
            <Input id="event-result-visitors" type="number" inputMode="numeric" min={0} value={visitors} onChange={(e) => setVisitors(e.target.value)} />
          </Field>
          <Field label={t('event.samplesGiven')} htmlFor="event-result-samples">
            <Input id="event-result-samples" type="number" inputMode="numeric" min={0} value={samples} onChange={(e) => setSamples(e.target.value)} />
          </Field>
          <Field label={t('event.contactsMade')} htmlFor="event-result-contacts">
            <Input id="event-result-contacts" type="number" inputMode="numeric" min={0} value={contacts} onChange={(e) => setContacts(e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/* --------------------------------- notes --------------------------------- */

export function NotesCard({ event, notes }: { event: EventRow; notes: EventNote[] }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await addEventNote(event.id, body);
      if (!res.ok) return setError(labels.error(res.error));
      setBody('');
      setAdding(false);
      router.refresh();
    });
  }

  return (
    <Section
      title={t('event.notes')}
      action={
        <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('event.addNote')}
        </Button>
      }
    >
      {notes.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t('event.notesNone')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {notes.map((n) => (
            <li key={n.id} className="py-2">
              <p className="mb-0.5 text-[11.5px] text-muted">
                {formatDate(n.created_at.slice(0, 10), 'medium')}
                {n.author && ` · ${n.author}`}
              </p>
              <NoteText text={n.body} className="text-[13px]" />
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <Dialog
          open
          onClose={() => setAdding(false)}
          title={t('event.addNote')}
          description={t('event.notePermanent')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAdding(false)} disabled={pending}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={submit} loading={pending} disabled={!body.trim()}>{t('common.save')}</Button>
            </>
          }
        >
          <div className="space-y-3.5">
            {error && <ErrorState message={error} />}
            <NoteTextarea aria-label={t('event.addNote')} rows={4} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
          </div>
        </Dialog>
      )}
    </Section>
  );
}

/* -------------------------------- contacts ------------------------------- */

export function ContactsCard({ event, contacts, today }: { event: EventRow; contacts: EventContact[]; today: string }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const open = event.stage === 'confirmed' || event.stage === 'done';
  const stage = (s: string) =>
    ({
      new: t('sales.stageNew'),
      contacted: t('sales.stageContacted'),
      tasting: t('sales.stageTasting'),
      offer: t('sales.stageOffer'),
      won: t('sales.stageWon'),
      lost: t('sales.stageLost'),
    })[s] ?? s;

  return (
    <Section
      title={`${t('event.contacts')}${contacts.length ? ` · ${contacts.length}` : ''}`}
      action={
        open && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            {t('event.addContact')}
          </Button>
        )
      }
    >
      {contacts.length === 0 ? (
        <p className="text-[12.5px] text-muted">{open ? t('event.contactsNone') : t('event.contactsIdea')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-1.5 text-[13px]">
              <Link href={c.customer_id ? `/sales/customers/${c.customer_id}` : `/sales/prospects/${c.id}`} className="min-w-0 flex-1 truncate hover:text-accent">
                <span className="font-medium">{c.company_name}</span>
                {c.contact_name && <span className="text-muted"> · {c.contact_name}</span>}
              </Link>
              <Badge tone={c.stage === 'won' ? 'done' : c.stage === 'lost' ? 'neutral' : 'accent'}>{stage(c.stage)}</Badge>
            </li>
          ))}
        </ul>
      )}
      {adding && <ContactDialog event={event} today={today} onClose={() => setAdding(false)} />}
    </Section>
  );
}

function ContactDialog({ event, today, onClose }: { event: EventRow; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  // A few days after it ends, or tomorrow if that has passed.
  const suggested = DateTime.fromISO(event.end_date, { zone: BUSINESS_TZ }).plus({ days: 3 }).toISODate()!;
  const tomorrow = DateTime.fromISO(today, { zone: BUSINESS_TZ }).plus({ days: 1 }).toISODate()!;
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [interest, setInterest] = useState('');
  const [followUp, setFollowUp] = useState(suggested > today ? suggested : tomorrow);
  const [another, setAnother] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const first = useRef<HTMLInputElement>(null);
  const ready = !!company.trim() && !!followUp;

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await addEventContact(event.id, { company_name: company, contact_name: contact, phone, email, interest, follow_up: followUp });
      if (!res.ok) return setError(labels.error(res.error));
      router.refresh();
      if (!another) return onClose();
      // Next one, at the stand.
      setAdded(company.trim());
      setCompany('');
      setContact('');
      setPhone('');
      setEmail('');
      setInterest('');
      first.current?.focus();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('event.addContact')}
      description={t('event.contactHint', { name: event.owner_name ?? '—' })}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{added ? t('common.close') : t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        {added && <p className="text-[12.5px] font-medium text-done">{t('event.contactAdded', { name: added })}</p>}
        <Field label={t('event.contactCompany')} required htmlFor="event-contact-company">
          <Input ref={first} id="event-contact-company" value={company} onChange={(e) => setCompany(e.target.value)} autoFocus />
        </Field>
        <Field label={t('sales.contactName')} htmlFor="event-contact-name">
          <Input id="event-contact-name" value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('sales.phone')} htmlFor="event-contact-phone">
            <Input id="event-contact-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={t('sales.email')} htmlFor="event-contact-email">
            <Input id="event-contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label={t('sales.interest')} htmlFor="event-contact-interest">
          <NoteTextarea id="event-contact-interest" rows={2} value={interest} onChange={(e) => setInterest(e.target.value)} />
        </Field>
        <Field label={t('event.followUp')} hint={t('event.followUpHint')} htmlFor="event-contact-follow">
          <Input id="event-contact-follow" type="date" min={today} value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="w-auto" />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="h-4 w-4 accent-accent" checked={another} onChange={(e) => setAnother(e.target.checked)} />
          {t('event.contactAnother')}
        </label>
      </div>
    </Dialog>
  );
}

/* ---------------------------- photos and files --------------------------- */

export function FilesCard({ event, files }: { event: EventRow; files: EventFile[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [removing, setRemoving] = useState<EventFile | null>(null);
  // Marketing adds photos; removing them stays with Sales.
  const readOnly = useEventsLimited();
  const [pending, startTransition] = useTransition();
  const photos = files.filter((f) => f.mime_type.startsWith('image/') && f.url);
  const documents = files.filter((f) => !photos.includes(f));

  function upload(list: FileList | null) {
    if (!list?.length) return;
    const chosen = Array.from(list);
    setErrors([]);
    startTransition(async () => {
      const supabase = createClient();
      const failed: string[] = [];
      for (const original of chosen) {
        if (!EVENT_ALLOWED_MIME.includes(original.type)) {
          failed.push(t('event.errFileType', { name: original.name }));
          continue;
        }
        const file = await shrinkImage(original);
        if (file.size > EVENT_MAX_BYTES) {
          failed.push(t('event.errFileSize', { name: original.name }));
          continue;
        }
        const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
        const path = `${event.id}/${crypto.randomUUID()}.${ext}`;
        const sent = await supabase.storage.from(EVENT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        const recorded = sent.error
          ? { ok: false }
          : await recordEventFile({ event_id: event.id, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size });
        if (!recorded.ok) failed.push(t('event.errFile', { name: original.name }));
      }
      if (input.current) input.current.value = '';
      setErrors(failed);
      router.refresh();
    });
  }

  function remove() {
    const file = removing;
    if (!file) return;
    startTransition(async () => {
      const res = await removeEventFile(file.id, event.id);
      setRemoving(null);
      if (!res.ok) return setErrors([labels.error(res.error)]);
      router.refresh();
    });
  }

  return (
    <Section
      title={t('event.files')}
      action={
        <>
          <input
            ref={input}
            type="file"
            multiple
            accept={EVENT_ALLOWED_MIME.join(',')}
            className="sr-only"
            aria-label={t('event.addFiles')}
            onChange={(e) => upload(e.target.files)}
          />
          <Button size="sm" variant="ghost" loading={pending} onClick={() => input.current?.click()}>
            <Paperclip className="h-3.5 w-3.5" aria-hidden />
            {t('event.addFiles')}
          </Button>
        </>
      }
    >
      {errors.length > 0 && <div className="mb-2"><ErrorState message={errors.join(' · ')} /></div>}
      {files.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t('event.filesNone')}</p>
      ) : (
        <>
          {photos.length > 0 && (
            <div className="mb-2 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {photos.map((f) => (
                <div key={f.id} className="group relative aspect-square overflow-hidden rounded-md bg-surface-2">
                  <a href={f.url!} target="_blank" rel="noreferrer" title={f.file_name}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
                    <img src={f.url!} alt={f.file_name} loading="lazy" className="h-full w-full object-cover" />
                  </a>
                  {!readOnly && <button
                    type="button"
                    aria-label={`${t('common.delete')} · ${f.file_name}`}
                    onClick={() => setRemoving(f)}
                    className="absolute right-1 top-1 rounded bg-black/55 p-1 text-white opacity-80 hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>}
                </div>
              ))}
            </div>
          )}
          {documents.length > 0 && (
            <ul className="divide-y divide-border">
              {documents.map((f) => (
                <li key={f.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                  <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-accent">{f.file_name}</a>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
                  )}
                  <span className="shrink-0 text-[11.5px] tabular text-muted">{Math.max(1, Math.round(f.size_bytes / 1024))} KB</span>
                  {!readOnly && (
                    <Button size="icon" variant="ghost" aria-label={t('common.delete')} onClick={() => setRemoving(f)}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title={t('event.removeFile')}
        message={removing?.file_name ?? ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={pending}
      />
    </Section>
  );
}
