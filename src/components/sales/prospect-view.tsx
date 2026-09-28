'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Plus, Trophy, XCircle } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { addProspectNote, loseProspect, winProspect } from '@/server/sales-actions';
import { NOTE_KINDS, type CustomerNoteKind, type Prospect, type ProspectListEntry, type ProspectNote } from '@/types/sales';
import { NextStep, useProspectError, useProspectLabels } from './prospect-parts';
import { ProspectDialog, type ProspectChoices } from './prospect-dialog';

const KIND_KEY = {
  call: 'sales.kindCall',
  visit: 'sales.kindVisit',
  message: 'sales.kindMessage',
  offer: 'sales.kindOffer',
} as const;

/** One prospect: who they are, where it stands, what is next, and every note. */
export function ProspectView({
  prospect,
  notes,
  choices,
  customerTypeName,
  today,
}: {
  prospect: Prospect;
  notes: ProspectNote[];
  choices: ProspectChoices;
  customerTypeName: string | null;
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useProspectLabels();
  const errorText = useProspectError();
  const [editing, setEditing] = useState(false);
  const [winning, setWinning] = useState(false);
  const [losing, setLosing] = useState(false);
  const [noting, setNoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = !prospect.closed_at;

  function win() {
    setError(null);
    startTransition(async () => {
      const res = await winProspect(prospect.id);
      setWinning(false);
      if (!res.ok) return setError(errorText(res.error));
      router.push(`/sales/customers/${res.data.customerId}`);
    });
  }

  const details: [string, string | null][] = [
    [t('sales.contactName'), prospect.contact_name],
    [t('sales.phone'), prospect.phone],
    [t('sales.email'), prospect.email],
    [t('sales.street'), [prospect.street, [prospect.postal_code, prospect.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null],
    [t('sales.businessType'), customerTypeName],
    [t('sales.source'), labels.entry(choices.sources, prospect.source_id)],
    [t('sales.interest'), prospect.interest],
    [t('sales.weeklyVolume'), prospect.weekly_volume],
  ];

  return (
    <>
      <Link href="/sales?tab=prospects" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('sales.tabProspects')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold leading-tight">{prospect.company_name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
              <Badge tone={prospect.stage === 'won' ? 'done' : prospect.stage === 'lost' ? 'neutral' : 'accent'}>
                {labels.stage(prospect.stage)}
              </Badge>
              {prospect.owner_name && <span>{t('sales.owner')}: {prospect.owner_name}</span>}
            </p>
          </div>
          {open && (
            <Button size="icon" variant="ghost" aria-label={t('sales.editProspect')} onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>

        {open ? (
          <div className="mt-3 rounded-lg border border-accent/25 bg-accent/[0.04] px-3 py-2">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('sales.nextStep')}</p>
            <NextStep step={prospect.next_step} on={prospect.next_step_on} today={today} />
          </div>
        ) : (
          <div className="mt-3 text-[12.5px] text-muted">
            {t('sales.closedOn', { date: formatDate(prospect.closed_at!, 'medium') })}
            {prospect.lost_reason_id && ` · ${labels.entry(choices.lostReasons, prospect.lost_reason_id)}`}
            {prospect.lost_note && <span className="block">{prospect.lost_note}</span>}
            {prospect.customer_id && (
              <Link href={`/sales/customers/${prospect.customer_id}`} className="mt-1 block font-medium text-accent hover:underline">
                {t('sales.wonCustomer')}
              </Link>
            )}
          </div>
        )}

        {open && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="success" onClick={() => setWinning(true)} disabled={pending}>
              <Trophy className="h-3.5 w-3.5" aria-hidden />
              {t('sales.win')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLosing(true)} disabled={pending}>
              <XCircle className="h-3.5 w-3.5" aria-hidden />
              {t('sales.lose')}
            </Button>
          </div>
        )}
        {error && <div className="mt-3"><ErrorState message={error} /></div>}
      </Card>

      <Card className="mb-4 p-3.5 sm:p-4">
        <h2 className="mb-2 text-[14px] font-semibold">{t('sales.details')}</h2>
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {details.filter(([, v]) => v).map(([label, value]) => (
            <div key={label} className="text-[12.5px]">
              <dt className="text-muted">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{t('sales.notes')}</h2>
        {open && (
          <Button size="sm" variant="primary" onClick={() => setNoting(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('sales.newNote')}
          </Button>
        )}
      </div>
      {notes.length === 0 ? (
        <EmptyState title={t('sales.noNotes')} />
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id}>
              <Card className="p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <Badge tone="accent">{t(KIND_KEY[n.kind])}</Badge>
                  <span className="tabular font-medium text-fg">{formatDate(n.note_date, 'medium')}</span>
                  {n.author_name && <span>{t('sales.by', { name: n.author_name })}</span>}
                </div>
                <div className="mt-1.5 text-[13px] leading-relaxed">
                  <NoteText text={n.body} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {editing && <ProspectDialog prospect={prospect} choices={choices} today={today} onClose={() => setEditing(false)} />}
      {noting && <ProspectNoteDialog prospectId={prospect.id} today={today} onClose={() => setNoting(false)} />}
      {losing && <LoseDialog prospectId={prospect.id} reasons={choices.lostReasons} onClose={() => setLosing(false)} />}
      <ConfirmDialog
        open={winning}
        onClose={() => setWinning(false)}
        onConfirm={win}
        title={t('sales.winTitle')}
        message={t('sales.winBody')}
        confirmLabel={t('sales.win')}
        cancelLabel={t('common.cancel')}
        loading={pending}
      />
    </>
  );
}

function ProspectNoteDialog({ prospectId, today, onClose }: { prospectId: string; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [kind, setKind] = useState<CustomerNoteKind>('call');
  const [date, setDate] = useState(today);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await addProspectNote({ prospect_id: prospectId, kind, note_date: date, body });
      if (!res.ok) return setError(res.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('sales.newNote')}
      description={t('sales.notePermanent')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!body.trim()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sales.noteKind')} htmlFor="pn-kind">
            <Select id="pn-kind" value={kind} onChange={(e) => setKind(e.target.value as CustomerNoteKind)}>
              {NOTE_KINDS.map((k) => <option key={k} value={k}>{t(KIND_KEY[k])}</option>)}
            </Select>
          </Field>
          <Field label={t('sales.noteDate')} htmlFor="pn-date">
            <Input id="pn-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t('sales.noteBody')} htmlFor="pn-body" required>
          <NoteTextarea id="pn-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
        </Field>
      </div>
    </Dialog>
  );
}

function LoseDialog({
  prospectId,
  reasons,
  onClose,
}: {
  prospectId: string;
  reasons: ProspectListEntry[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useProspectLabels();
  const errorText = useProspectError();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!reason) return;
    setError(null);
    startTransition(async () => {
      const res = await loseProspect(prospectId, reason, note.trim() || null);
      if (!res.ok) return setError(errorText(res.error));
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('sales.loseTitle')}
      description={t('sales.loseBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={submit} loading={pending} disabled={!reason}>{t('sales.lose')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('sales.loseReason')} htmlFor="lose-reason" required>
          <Select id="lose-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">—</option>
            {reasons.filter((r) => r.is_active).map((r) => (
              <option key={r.id} value={r.id}>{labels.entry(reasons, r.id)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('sales.loseNote')} htmlFor="lose-note">
          <NoteTextarea id="lose-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
