'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, Field, Input } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { PageHeader } from '@/components/shell/app-shell';
import { saveMerchItem } from '@/server/merch-actions';
import type { CustomerType } from '@/types/orders';
import type { MerchCampaignRow, MerchCustomerOption, MerchItem, MerchItemRow } from '@/types/merch';
import { CampaignDialog } from './campaign-dialog';
import { MerchTabs, useMerchLabels } from './merch-parts';

/** Merch: the campaigns (newest week first), and the items with their stock. */
export function MerchHome({
  tab,
  campaigns,
  items,
  customers,
  types,
  today,
}: {
  tab: 'campaigns' | 'items';
  campaigns: MerchCampaignRow[];
  items: MerchItemRow[];
  customers: MerchCustomerOption[];
  types: CustomerType[];
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const [creating, setCreating] = useState(false);
  const [newItem, setNewItem] = useState(false);

  return (
    <>
      <PageHeader
        title={t('merch.navLabel')}
        subtitle={t('merch.subtitle')}
        action={
          tab === 'campaigns' ? (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={items.every((i) => !i.is_active)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('merch.newCampaign')}
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setNewItem(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('merch.newItem')}
            </Button>
          )
        }
      />
      <MerchTabs tab={tab} />

      {tab === 'campaigns' ? (
        campaigns.length === 0 ? (
          <EmptyState title={items.length === 0 ? t('merch.noItems') : t('merch.noCampaigns')} />
        ) : (
          <Card className="divide-y divide-border">
            {campaigns.map((c) => {
              const current = !c.cancelled_at && c.week_start <= today && c.deadline >= today;
              const onOrder = c.counts.on_order + c.counts.packed;
              const notSent = c.counts.not_sent + c.counts.expired;
              return (
                <Link key={c.id} href={`/merch/${c.id}`} className={cn('block px-3.5 py-2.5 hover:bg-surface-2', c.cancelled_at && 'opacity-60')}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13.5px] font-medium">{c.item_name}</span>
                    <span className="text-[12.5px] tabular text-muted">{t('merch.perCustomerShort', { quantity: c.quantity })}</span>
                    {c.cancelled_at && <Badge tone="neutral">{t('merch.cancelled')}</Badge>}
                    {current && <Badge tone="accent">{t('merch.weekOf', { date: formatDate(c.week_start, 'short') })}</Badge>}
                  </div>
                  <p className="text-[12px] text-muted">
                    {!current && `${t('merch.weekOf', { date: formatDate(c.week_start, 'medium') })} · `}
                    {t('merch.until', { date: formatDate(c.deadline, 'short') })}
                    {c.creator_name && ` · ${t('merch.by', { name: c.creator_name })}`}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] tabular">
                    <span className="text-done">{t('merch.countSent', { count: c.counts.sent })}</span>
                    {onOrder > 0 && <span className="text-accent">{t('merch.countOnOrder', { count: onOrder })}</span>}
                    {c.counts.waiting > 0 && <span className="text-muted">{t('merch.countWaiting', { count: c.counts.waiting })}</span>}
                    {notSent > 0 && <span className="text-warn">{t('merch.countNotSent', { count: notSent })}</span>}
                  </p>
                </Link>
              );
            })}
          </Card>
        )
      ) : items.length === 0 ? (
        <EmptyState title={t('merch.noItems')} />
      ) : (
        <Card className="divide-y divide-border">
          {items.map((i) => {
            const short = i.promised - i.stock;
            return (
              <Link key={i.id} href={`/merch/items/${i.id}`} className={cn('flex items-center gap-3 px-3.5 py-2.5 hover:bg-surface-2', !i.is_active && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
                    {i.name}
                    {!i.is_active && <Badge tone="neutral">{t('merch.inactive')}</Badge>}
                  </p>
                  {i.note && <p className="truncate text-[12px] text-muted">{i.note}</p>}
                </div>
                <div className="shrink-0 text-right text-[12px] tabular">
                  <p className="text-[14px] font-semibold">{i.stock}</p>
                  {i.promised > 0 && <p className="text-muted">{t('merch.promised')}: {i.promised}</p>}
                  {short > 0 && <p className="font-medium text-late">{t('merch.short', { count: short })}</p>}
                </div>
              </Link>
            );
          })}
        </Card>
      )}

      {creating && <CampaignDialog items={items} customers={customers} types={types} today={today} onClose={() => setCreating(false)} />}
      {newItem && <ItemDialog onClose={() => setNewItem(false)} />}
    </>
  );
}

/** A merch item: its name, a note, and whether it is still offered. */
export function ItemDialog({ item, onClose }: { item?: MerchItem; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useMerchLabels();
  const [name, setName] = useState(item?.name ?? '');
  const [note, setNote] = useState(item?.note ?? '');
  const [active, setActive] = useState(item?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!name.trim()) return setError(t('common.required'));
    startTransition(async () => {
      const res = await saveMerchItem({ id: item?.id, name, note, is_active: active });
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      if (!item) router.push(`/merch/items/${res.data.id}`);
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? t('merch.editItem') : t('merch.newItem')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label={t('merch.itemName')} required htmlFor="mi-name">
          <Input id="mi-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        </Field>
        <Field label={t('merch.note')} htmlFor="mi-note">
          <NoteTextarea id="mi-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>
        {item && <Checkbox label={t('merch.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />}
        {error && <p className="text-[12.5px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
