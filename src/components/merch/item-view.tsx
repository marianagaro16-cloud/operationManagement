'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Field, Input } from '@/components/ui/primitives';
import { addMerchStock } from '@/server/merch-actions';
import type { MerchHistoryEntry, MerchItemRow, MerchStock, MerchStockEntry } from '@/types/merch';
import { ItemDialog } from './merch-home';
import { MerchHistoryList } from './merch-history';
import { useMerchLabels } from './merch-parts';

/** One merch item: its stock, how it moved, and who received it. */
export function ItemView({
  item,
  stock,
  entries,
  history,
  today,
  customerLinks = false,
}: {
  item: MerchItemRow;
  stock: MerchStock;
  entries: MerchStockEntry[];
  history: MerchHistoryEntry[];
  today: string;
  customerLinks?: boolean;
}) {
  const { t, formatDate } = useI18n();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const short = item.promised - item.stock;

  return (
    <>
      <Link href="/merch?tab=items" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('merch.tabItems')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold leading-tight">{item.name}</h1>
              {!item.is_active && <Badge tone="neutral">{t('merch.inactive')}</Badge>}
            </div>
            {item.note && <p className="mt-1 text-[12.5px] text-muted">{item.note}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('merch.addStock')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t('common.edit')}
            </Button>
          </div>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile label={t('merch.inStock')} value={item.stock} strong />
        <Tile label={t('merch.promised')} value={item.promised} hint={short > 0 ? t('merch.short', { count: short }) : undefined} late={short > 0} />
        <Tile label={t('merch.received')} value={stock.received} />
        <Tile label={t('merch.sentOut')} value={stock.sent} />
        <Tile label={t('merch.handedOut')} value={stock.handed} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-3.5 sm:p-4">
          <h2 className="mb-2 text-[14px] font-semibold">{t('merch.history')}</h2>
          {history.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t('merch.noHistory')}</p>
          ) : (
            <MerchHistoryList entries={history} show="customer" customerLinks={customerLinks} canRemove />
          )}
        </Card>

        <Card className="p-3.5 sm:p-4">
          <h2 className="mb-2 text-[14px] font-semibold">{t('merch.movements')}</h2>
          {entries.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t('merch.noMovements')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-1.5 text-[12.5px]">
                  <span className="w-16 shrink-0 tabular text-muted">{formatDate(e.entry_date, 'short')}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{[e.note, e.by].filter(Boolean).join(' · ')}</span>
                  <span className={cn('shrink-0 font-semibold tabular', e.quantity < 0 ? 'text-late' : 'text-done')}>
                    {e.quantity > 0 ? `+${e.quantity}` : e.quantity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {editing && <ItemDialog item={item} onClose={() => setEditing(false)} />}
      {adding && <StockDialog itemId={item.id} today={today} onClose={() => setAdding(false)} />}
    </>
  );
}

function Tile({ label, value, hint, strong, late }: { label: string; value: number; hint?: string; strong?: boolean; late?: boolean }) {
  return (
    <Card className="p-3">
      <p className="text-[11px] uppercase tracking-wide text-subtle">{label}</p>
      <p className={cn('mt-0.5 tabular', strong ? 'text-xl font-semibold' : 'text-[16px] font-medium')}>{value}</p>
      {hint && <p className={cn('text-[11.5px]', late ? 'font-medium text-late' : 'text-muted')}>{hint}</p>}
    </Card>
  );
}

function StockDialog({ itemId, today, onClose }: { itemId: string; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useMerchLabels();
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const n = Math.trunc(Number(quantity));
    if (!Number.isFinite(n) || n === 0) return setError(t('merch.stockQuantityHint'));
    startTransition(async () => {
      const res = await addMerchStock({ item_id: itemId, quantity: n, entry_date: date, note });
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('merch.addStock')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('merch.stockQuantity')} required htmlFor="ms-qty" hint={t('merch.stockQuantityHint')}>
            <Input id="ms-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d-]/g, ''))} autoFocus />
          </Field>
          <Field label={t('merch.date')} required htmlFor="ms-date">
            <Input id="ms-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t('merch.note')} htmlFor="ms-note">
          <Input id="ms-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        {error && <p className="text-[12.5px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
