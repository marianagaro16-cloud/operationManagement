'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Hand } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Card, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { addMerchHandout } from '@/server/merch-actions';
import type { MerchHistoryEntry, MerchItemRow } from '@/types/merch';
import { MerchHistoryList } from './merch-history';
import { useMerchLabels } from './merch-parts';

/**
 * Merch in a customer's file: everything they received or are due to — with
 * an order, or handed over in person — and a button to record a hand-over.
 */
export function CustomerMerch({
  customerId,
  history,
  items,
  today,
}: {
  customerId: string;
  history: MerchHistoryEntry[];
  items: MerchItemRow[];
  today: string;
}) {
  const { t } = useI18n();
  const [giving, setGiving] = useState(false);

  return (
    <Card className="mb-4 p-3.5 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">{t('merch.customerTitle')}</h2>
        {items.some((i) => i.is_active) && (
          <Button size="sm" variant="secondary" onClick={() => setGiving(true)}>
            <Hand className="h-3.5 w-3.5" aria-hidden />
            {t('merch.giveInPerson')}
          </Button>
        )}
      </div>
      {history.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t('merch.noHistory')}</p>
      ) : (
        <MerchHistoryList entries={history} show="item" canRemove />
      )}
      {giving && <HandoutDialog customerId={customerId} items={items} today={today} onClose={() => setGiving(false)} />}
    </Card>
  );
}

function HandoutDialog({ customerId, items, today, onClose }: { customerId: string; items: MerchItemRow[]; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useMerchLabels();
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const n = Math.floor(Number(quantity));
    if (!itemId) return setError(t('merch.chooseItem'));
    if (!(n >= 1 && n <= 9999)) return setError(t('merch.errQuantity'));
    startTransition(async () => {
      const res = await addMerchHandout({ customer_id: customerId, item_id: itemId, quantity: n, given_on: date, note });
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('merch.giveInPerson')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label={t('merch.item')} required htmlFor="mh-item">
          <Select id="mh-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">{t('merch.chooseItem')}</option>
            {items.filter((i) => i.is_active).map((i) => (
              <option key={i.id} value={i.id}>{i.name} · {t('merch.inStock')}: {i.stock}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('merch.quantity')} required htmlFor="mh-qty">
            <Input id="mh-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ''))} />
          </Field>
          <Field label={t('merch.date')} required htmlFor="mh-date">
            <Input id="mh-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t('merch.note')} htmlFor="mh-note">
          <NoteTextarea id="mh-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>
        {error && <p className="text-[12.5px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
