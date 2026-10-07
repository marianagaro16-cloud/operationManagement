'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, KeyRound, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { deleteKey, saveKey } from '@/server/hr-actions';
import type { HrKey } from '@/types/hr';

/*
 * The key register: who holds which key, since when, and when it came back.
 *
 * On a worker's file it lists that worker's keys; on its own page, everyone's
 * — workers, accounts without a file (the owners) and anyone else, by name.
 */

/** Someone from the lists: a worker with a file, or an account without one. */
type Holder = { kind: 'worker' | 'account'; id: string; name: string };

const holderName = (k: HrKey) => k.worker_name ?? k.profile_name ?? k.holder_name ?? '';
const holderKey = (kind: Holder['kind'], id: string) => `${kind}:${id}`;

function useKeyError() {
  const { t } = useI18n();
  return (error: string) => {
    const known: Record<string, MessageKey> = {
      key_number_required: 'hrKey.errNumber',
      holder_required: 'hrKey.errHolder',
      returned_before_handed: 'hrKey.errReturned',
      invalid_date: 'hrKey.errDate',
      not_authorized: 'hrKey.errNotAuthorized',
    };
    return t(known[error] ?? 'hrKey.errUnknown');
  };
}

/** The whole register on its own page. */
export function KeyRegisterPage(props: { keys: HrKey[]; holders: Holder[]; today: string; isAdmin: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <Link href="/hr" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('hr.navLabel')}
      </Link>
      <PageHeader title={t('hrKey.title')} subtitle={t('hrKey.subtitle')} />
      <KeyRegister {...props} />
    </>
  );
}

export function KeyRegister({
  keys,
  holders,
  worker,
  today,
  isAdmin,
}: {
  keys: HrKey[];
  /** Whom a key can be handed to, when the register is everyone's. */
  holders?: Holder[];
  /** On a worker's file: every key here is theirs. */
  worker?: { id: string; name: string };
  today: string;
  /** Only an Admin removes a row. */
  isAdmin: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const keyError = useKeyError();
  const [editing, setEditing] = useState<HrKey | 'new' | null>(null);
  const [removing, setRemoving] = useState<HrKey | null>(null);
  const [showReturned, setShowReturned] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const returnedCount = keys.filter((k) => k.returned_on).length;
  const shown = keys.filter(
    (k) =>
      (showReturned || !k.returned_on) &&
      (!q || `${k.key_number} ${holderName(k)} ${k.holder_detail ?? ''} ${k.opens ?? ''}`.toLowerCase().includes(q)),
  );

  /** The key came back today; the day can be corrected by editing it. */
  function giveBack(k: HrKey) {
    setError(null);
    startTransition(async () => {
      const res = await saveKey(
        {
          key_number: k.key_number,
          opens: k.opens,
          worker_id: k.worker_id,
          profile_id: k.profile_id,
          holder_name: k.holder_name,
          holder_detail: k.holder_detail,
          handed_on: k.handed_on,
          returned_on: today,
          note: k.note,
        },
        k.id,
      );
      if (!res.ok) return setError(keyError(res.error));
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && <ErrorState message={error} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {worker ? (
          <span />
        ) : (
          <Input
            aria-label={t('hrKey.search')}
            placeholder={t('hrKey.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-full text-[13px] sm:w-64"
          />
        )}
        <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('hrKey.add')}
        </Button>
      </div>

      {returnedCount > 0 && (
        <Checkbox label={t('hrKey.showReturned', { count: returnedCount })} checked={showReturned} onChange={(e) => setShowReturned(e.target.checked)} />
      )}

      {shown.length === 0 ? (
        <EmptyState title={t(keys.length === 0 ? 'hrKey.none' : 'hrKey.noneShown')} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {shown.map((k) => (
              <li key={k.id} className="flex items-start gap-3 px-3.5 py-2.5">
                <KeyRound className={cn('mt-0.5 h-4 w-4 shrink-0', k.returned_on ? 'text-subtle' : 'text-accent')} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium', k.returned_on && 'text-muted')}>
                    <span className="tabular">{t('hrKey.number', { n: k.key_number })}</span>
                    {!worker &&
                      (k.worker_id ? (
                        <Link href={`/hr/${k.worker_id}?tab=keys`} className="hover:underline">{holderName(k)}</Link>
                      ) : (
                        <span>{holderName(k)}</span>
                      ))}
                    {!worker && k.holder_name && <Badge tone="neutral">{t('hrKey.noFile')}</Badge>}
                    {k.returned_on && <Badge tone="done">{t('hrKey.returnedOn', { date: formatDate(k.returned_on, 'medium') })}</Badge>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11.5px] text-muted">
                    {[k.opens, k.holder_name && k.holder_detail, t('hrKey.since', { date: formatDate(k.handed_on, 'medium') }), k.note]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <span className="flex shrink-0 gap-0.5">
                  {!k.returned_on && (
                    <Button size="sm" variant="ghost" onClick={() => giveBack(k)} disabled={pending}>
                      <Undo2 className="h-3.5 w-3.5" aria-hidden />
                      {t('hrKey.giveBack')}
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t('common.edit')} onClick={() => setEditing(k)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  {isAdmin && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-late" aria-label={t('common.delete')} onClick={() => setRemoving(k)}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <KeyDialog
          entry={editing === 'new' ? null : editing}
          holders={holders ?? []}
          worker={worker}
          today={today}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          open
          title={t('hrKey.remove')}
          message={`${t('hrKey.number', { n: removing.key_number })} · ${holderName(removing)}`}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          destructive
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            startTransition(async () => {
              const res = await deleteKey(removing.id);
              setRemoving(null);
              if (!res.ok) return setError(keyError(res.error));
              router.refresh();
            })
          }
        />
      )}
    </div>
  );
}

function KeyDialog({
  entry,
  holders,
  worker,
  today,
  onClose,
}: {
  entry: HrKey | null;
  holders: Holder[];
  worker?: { id: string; name: string };
  today: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const keyError = useKeyError();
  const [number, setNumber] = useState(entry?.key_number ?? '');
  const [opens, setOpens] = useState(entry?.opens ?? '');
  // On a worker's file the holder is that worker; elsewhere someone from the list, or a name.
  const [kind, setKind] = useState<'listed' | 'other'>(entry?.holder_name ? 'other' : 'listed');
  const [listed, setListed] = useState(
    worker ? holderKey('worker', worker.id) : entry?.worker_id ? holderKey('worker', entry.worker_id) : entry?.profile_id ? holderKey('account', entry.profile_id) : '',
  );
  // Someone who has since left or lost their account still holds what they hold.
  const options =
    entry && !entry.holder_name && !worker && !holders.some((h) => holderKey(h.kind, h.id) === listed)
      ? [{ kind: entry.worker_id ? ('worker' as const) : ('account' as const), id: (entry.worker_id ?? entry.profile_id)!, name: holderName(entry) }, ...holders]
      : holders;
  const [name, setName] = useState(entry?.holder_name ?? '');
  const [detail, setDetail] = useState(entry?.holder_detail ?? '');
  const [handedOn, setHandedOn] = useState(entry?.handed_on ?? today);
  const [returnedOn, setReturnedOn] = useState(entry?.returned_on ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byList = !!worker || kind === 'listed';
  const [listedKind, listedId] = listed.split(':');
  const complete = !!number.trim() && !!handedOn && (byList ? !!listedId : !!name.trim()) && (!returnedOn || returnedOn >= handedOn);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveKey(
        {
          key_number: number,
          opens,
          worker_id: byList && listedKind === 'worker' ? listedId! : null,
          profile_id: byList && listedKind === 'account' ? listedId! : null,
          holder_name: byList ? null : name,
          holder_detail: byList ? null : detail,
          handed_on: handedOn,
          returned_on: returnedOn || null,
          note,
        },
        entry?.id,
      );
      if (!res.ok) return setError(keyError(res.error));
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(entry ? 'hrKey.edit' : 'hrKey.add')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!complete}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('hrKey.fieldNumber')} required htmlFor="key-number">
            <Input id="key-number" value={number} maxLength={50} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          <Field label={t('hrKey.fieldOpens')} hint={t('hrKey.fieldOpensHint')} htmlFor="key-opens">
            <Input id="key-opens" value={opens} maxLength={200} onChange={(e) => setOpens(e.target.value)} />
          </Field>
        </div>

        {!worker && (
          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-[13px] font-medium">
              {t('hrKey.holder')}
              <span className="ml-0.5 text-late">*</span>
            </legend>
            {(['listed', 'other'] as const).map((value) => (
              <label key={value} className={cn('flex items-center gap-2 text-[13.5px]', kind === value && 'font-medium')}>
                <input type="radio" name="key-holder" className="h-4 w-4 accent-accent" checked={kind === value} onChange={() => setKind(value)} />
                {t(value === 'listed' ? 'hrKey.holderWorker' : 'hrKey.holderOther')}
              </label>
            ))}
            {kind === 'listed' ? (
              <Select aria-label={t('hrKey.holderWorker')} value={listed} onChange={(e) => setListed(e.target.value)}>
                <option value="">{t('hrNote.pick')}</option>
                {options.map((h) => (
                  <option key={holderKey(h.kind, h.id)} value={holderKey(h.kind, h.id)}>{h.name}</option>
                ))}
              </Select>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('hrKey.fieldName')} required htmlFor="key-name">
                  <Input id="key-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label={t('hrKey.fieldDetail')} hint={t('hrKey.fieldDetailHint')} htmlFor="key-detail">
                  <Input id="key-detail" value={detail} maxLength={300} onChange={(e) => setDetail(e.target.value)} />
                </Field>
              </div>
            )}
          </fieldset>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('hrKey.fieldHanded')} required htmlFor="key-handed">
            <Input id="key-handed" type="date" value={handedOn} max={today} onChange={(e) => setHandedOn(e.target.value)} />
          </Field>
          <Field label={t('hrKey.fieldReturned')} hint={t('hrKey.fieldReturnedHint')} htmlFor="key-returned">
            <Input id="key-returned" type="date" value={returnedOn} min={handedOn} max={today} onChange={(e) => setReturnedOn(e.target.value)} />
          </Field>
        </div>
        <Field label={t('hrKey.fieldNote')} htmlFor="key-note">
          <Input id="key-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
