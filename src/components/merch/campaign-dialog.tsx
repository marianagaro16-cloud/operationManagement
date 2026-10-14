'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { filterByQuery } from '@/lib/search';
import { addDays } from '@/lib/datetime';
import { weekDays } from '@/domain/orders/scheduling';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { useCustomerTypeLabel } from '@/components/customers/use-customer-type-label';
import { merchReceivedBefore, saveMerchCampaign } from '@/server/merch-actions';
import type { CustomerType } from '@/types/orders';
import type { MerchCampaignRow, MerchCustomerOption, MerchItemRow } from '@/types/merch';
import { useMerchLabels } from './merch-parts';

/**
 * A campaign: item, week, how many per customer, how long it may wait, and
 * who gets it — the chosen customer types ticked, each one can be unticked,
 * and others added by hand. Whoever already got the item is flagged, and
 * stays ticked (decided 2026-10-14).
 */
export function CampaignDialog({
  campaign,
  currentCustomerIds = [],
  ownPromised = 0,
  items,
  customers,
  types,
  today,
  onClose,
}: {
  campaign?: MerchCampaignRow;
  /** Editing: who is on it now. */
  currentCustomerIds?: string[];
  /** Editing: what this campaign already counts in the item's "promised". */
  ownPromised?: number;
  items: MerchItemRow[];
  customers: MerchCustomerOption[];
  types: CustomerType[];
  today: string;
  onClose: () => void;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useMerchLabels();
  const typeLabel = useCustomerTypeLabel();
  const [itemId, setItemId] = useState(campaign?.item_id ?? '');
  const [day, setDay] = useState(campaign?.week_start ?? today);
  const [quantity, setQuantity] = useState(String(campaign?.quantity ?? 1));
  const [carry, setCarry] = useState(String(campaign?.carry_weeks ?? 4));
  const [typeIds, setTypeIds] = useState<Set<string>>(new Set(campaign?.customer_type_ids ?? []));
  const [selected, setSelected] = useState<Set<string>>(new Set(currentCustomerIds));
  // Shown in the list without belonging to a chosen type: added by hand, or already on the campaign.
  const [extra, setExtra] = useState<Set<string>>(new Set(currentCustomerIds));
  const [note, setNote] = useState(campaign?.note ?? '');
  const [query, setQuery] = useState('');
  const [got, setGot] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const monday = weekDays(day || today)[0];
  const carryWeeks = Math.min(12, Math.max(0, Math.floor(Number(carry) || 0)));
  const deadline = addDays(monday, carryWeeks * 7 + 6);
  const qty = Math.floor(Number(quantity) || 0);
  const item = items.find((i) => i.id === itemId);

  useEffect(() => {
    let live = true;
    if (!itemId) { setGot({}); return; }
    merchReceivedBefore(itemId, campaign?.id ?? null).then((r) => live && setGot(r)).catch(() => live && setGot({}));
    return () => { live = false; };
  }, [itemId, campaign?.id]);

  function toggleType(id: string) {
    const next = new Set(typeIds);
    const of = customers.filter((c) => (c.customer_type_id ?? '__none__') === id).map((c) => c.id);
    const sel = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      for (const c of of) if (!extra.has(c)) sel.delete(c);
    } else {
      next.add(id);
      for (const c of of) sel.add(c);
    }
    setTypeIds(next);
    setSelected(sel);
  }

  const listed = useMemo(
    () =>
      customers.filter((c) => typeIds.has(c.customer_type_id ?? '__none__') || extra.has(c.id)),
    [customers, typeIds, extra],
  );
  const shown = filterByQuery(listed, query, (c) => c.name);
  const addable = customers.filter((c) => !listed.some((l) => l.id === c.id));
  const need = selected.size * qty;
  const available = item ? item.stock - item.promised + ownPromised : 0;

  function submit() {
    setError(null);
    if (!itemId) return setError(t('merch.chooseItem'));
    if (qty < 1 || qty > 9999) return setError(t('merch.errQuantity'));
    if (selected.size === 0) return setError(t('merch.errNoCustomers'));
    startTransition(async () => {
      const res = await saveMerchCampaign({
        id: campaign?.id ?? null,
        item_id: itemId,
        week_start: monday,
        quantity: qty,
        carry_weeks: carryWeeks,
        customer_type_ids: [...typeIds].filter((id) => id !== '__none__'),
        customer_ids: [...selected],
        note,
      });
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.push(`/merch/${res.data.id}`);
      router.refresh();
    });
  }

  const typeOptions: { id: string; label: string }[] = [
    ...types.filter((ty) => ty.is_active || typeIds.has(ty.id)).map((ty) => ({ id: ty.id, label: typeLabel(ty) })),
    { id: '__none__', label: t('merch.noType') },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title={campaign ? t('merch.editCampaign') : t('merch.newCampaign')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('merch.item')} required htmlFor="m-item">
            <Select id="m-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">{t('merch.chooseItem')}</option>
              {items.filter((i) => i.is_active || i.id === itemId).map((i) => (
                <option key={i.id} value={i.id}>{i.name} · {t('merch.inStock')}: {i.stock}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('merch.week')} required htmlFor="m-week" hint={`${t('merch.weekOf', { date: formatDate(monday, 'medium') })} · ${t('merch.until', { date: formatDate(deadline, 'medium') })}`}>
            <Input id="m-week" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label={t('merch.perCustomer')} required htmlFor="m-qty">
            <Input id="m-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ''))} />
          </Field>
          <Field label={t('merch.carryWeeks')} htmlFor="m-carry" hint={t('merch.carryHint')}>
            <Input id="m-carry" inputMode="numeric" value={carry} onChange={(e) => setCarry(e.target.value.replace(/[^\d]/g, ''))} />
          </Field>
        </div>

        <Field label={t('merch.types')}>
          <div className="flex flex-wrap gap-1.5">
            {typeOptions.map((ty) => (
              <button
                key={ty.id}
                type="button"
                onClick={() => toggleType(ty.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors',
                  typeIds.has(ty.id) ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:text-fg',
                )}
                aria-pressed={typeIds.has(ty.id)}
              >
                {ty.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label={`${t('merch.customers')} · ${t('merch.selected', { count: selected.size })}`} hint={t('merch.customersHint')}>
          <div className="space-y-2">
            {listed.length > 8 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} className="pl-9" />
              </div>
            )}
            {shown.length > 0 && (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {shown.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-surface-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-accent"
                        checked={selected.has(c.id)}
                        onChange={() => {
                          const sel = new Set(selected);
                          if (sel.has(c.id)) sel.delete(c.id); else sel.add(c.id);
                          setSelected(sel);
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {got[c.id] && (
                        <span className="shrink-0 text-[11.5px] font-medium text-warn">
                          {t('merch.alreadyGot', { date: formatDate(got[c.id], 'short') })}
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <Combobox
              items={addable}
              value={null}
              onChange={(id) => {
                if (!id) return;
                setExtra(new Set(extra).add(id));
                setSelected(new Set(selected).add(id));
              }}
              getKey={(c) => c.id}
              getLabel={(c) => c.name}
              getSearchText={(c) => c.name}
              placeholder={t('merch.addCustomer')}
            />
          </div>
        </Field>

        {item && need > 0 && (
          <p className={cn('text-[12.5px] font-medium', need > available ? 'text-late' : 'text-muted')}>
            {t('merch.needStock', { need, stock: Math.max(0, available) })}
          </p>
        )}

        <Field label={t('merch.note')} htmlFor="m-note">
          <NoteTextarea id="m-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>

        {error && <p className="text-[12.5px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
