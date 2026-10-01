'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ListChecks, Plus, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { loadNoteChoices, saveNote } from '@/server/note-actions';
import type { QuickNote } from '@/types/notes';

type Choices = { people: { id: string; name: string }[]; customers: { id: string; name: string }[] };

/**
 * Write or change a quick note. Text first and alone, so a quick note stays
 * quick; a checklist, a customer and sharing are one tap further.
 */
export function NoteDialog({
  note,
  customer,
  onClose,
}: {
  /** Present when changing one. */
  note?: QuickNote | null;
  /** A new one filed under this customer (from the customer file). */
  customer?: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [body, setBody] = useState(note?.body ?? '');
  const [items, setItems] = useState<{ body: string; done: boolean }[]>(note?.items.map(({ body, done }) => ({ body, done })) ?? []);
  const [customerId, setCustomerId] = useState<string | null>(note?.customer?.id ?? customer?.id ?? null);
  const [shares, setShares] = useState<string[]>(note?.shares.map((s) => s.id) ?? []);
  const [more, setMore] = useState(Boolean(note && (note.items.length || note.customer || note.shares.length)) || Boolean(customer));
  const [choices, setChoices] = useState<Choices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!more || choices) return;
    loadNoteChoices().then((res) => res.ok && setChoices(res.data));
  }, [more, choices]);

  // A customer since made inactive still shows under its name.
  const known = note?.customer ?? customer ?? null;
  const customers = choices
    ? known && !choices.customers.some((c) => c.id === known.id)
      ? [known, ...choices.customers]
      : choices.customers
    : known
      ? [known]
      : [];

  const lines = items.filter((i) => i.body.trim());
  const ready = body.trim().length > 0 || lines.length > 0;

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await saveNote({ id: note?.id ?? null, body, items: lines, customer_id: customerId, share_ids: shares });
      if (!res.ok) return setError(res.error === 'note_empty' ? t('note.errEmpty') : res.error === 'not_authorized' ? t('note.errNotAuthorized') : t('common.error'));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={note ? t('note.edit') : t('note.new')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <NoteTextarea
          aria-label={t('note.body')}
          placeholder={t('note.placeholder')}
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          autoFocus
        />

        {!more ? (
          <Button size="sm" variant="ghost" onClick={() => setMore(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('note.more')}
          </Button>
        ) : (
          <>
            <Field label={t('note.checklist')}>
              <div className="space-y-1.5">
                {items.map((it, k) => (
                  <div key={k} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-accent"
                      checked={it.done}
                      aria-label={t('note.tick')}
                      onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, done: e.target.checked } : x)))}
                    />
                    <Input
                      value={it.body}
                      aria-label={t('note.line')}
                      onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, body: e.target.value } : x)))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          setItems([...items.slice(0, k + 1), { body: '', done: false }, ...items.slice(k + 1)]);
                          requestAnimationFrame(() => {
                            const inputs = document.querySelectorAll<HTMLInputElement>('[data-note-line]');
                            inputs[k + 1]?.focus();
                          });
                        }
                      }}
                      data-note-line
                      className={cn(it.done && 'text-muted line-through')}
                    />
                    <Button size="icon" variant="ghost" aria-label={t('common.delete')} onClick={() => setItems(items.filter((_, j) => j !== k))}>
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setItems([...items, { body: '', done: false }])}>
                  <ListChecks className="h-3.5 w-3.5" aria-hidden />
                  {t('note.addLine')}
                </Button>
              </div>
            </Field>

            <Field label={t('note.customer')} hint={t('note.customerHint')} htmlFor="note-customer">
              <Combobox
                id="note-customer"
                items={customers}
                value={customerId}
                onChange={setCustomerId}
                getKey={(c) => c.id}
                getLabel={(c) => c.name}
                getSearchText={(c) => c.name}
              />
            </Field>

            <Field label={t('note.shareWith')} hint={t('note.shareHint')}>
              {choices ? (
                <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  {choices.people.map((p) => {
                    const on = shares.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setShares(on ? shares.filter((x) => x !== p.id) : [...shares, p.id])}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-[12.5px]',
                          on ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg',
                        )}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[12.5px] text-muted">…</p>
              )}
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
