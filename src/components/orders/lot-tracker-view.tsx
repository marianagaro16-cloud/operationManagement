'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Search, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Field, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { lotAllocationsToCsv } from '@/domain/orders/lot-export';
import type { LotAllocationRow, LotSearchResult, LotSort } from '@/server/lot-tracker';
import type { Brand } from '@/types/orders';

export interface LotFilterForm {
  lot: string;
  product: string;
  code: string;
  customer: string;
  /** A brand id, or 'none' for the unclassified. */
  brand: string;
  ref: string;
  prepFrom: string;
  prepTo: string;
  delFrom: string;
  delTo: string;
  user: string;
  sort: LotSort;
}

const SORTS: LotSort[] = ['recent', 'preparation', 'delivery', 'lot', 'customer', 'product'];

/**
 * Lot Nummer Tracker — search, trace, view, export.
 *
 * Filters live in the URL rather than in component state, so a search can be
 * shared, bookmarked and paged. Typing debounces into a replace() so the
 * results follow without an Enter press and without stacking history entries
 * on every keystroke.
 *
 * Nothing here writes. The only route out is Open Order, which leads to the
 * existing workflow where a correction belongs.
 */
export function LotTrackerView({
  result,
  users,
  brands,
  filters,
  page,
  pageSize,
}: {
  result: LotSearchResult;
  users: { id: string; label: string }[];
  brands: Brand[];
  filters: LotFilterForm;
  page: number;
  pageSize: number;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState<LotFilterForm>(filters);
  // Per-instance, not module scope: a shared timer would have one mounted
  // tracker cancelling another's pending search.
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  // The server is the filter. This only reflects what the URL says, so a back
  // button or a shared link repopulates the fields.
  useEffect(() => setForm(filters), [filters]);

  const active = useMemo(
    () =>
      Boolean(
        form.lot || form.product || form.code || form.customer || form.brand ||
        form.ref || form.prepFrom || form.prepTo || form.delFrom || form.delTo ||
        form.user,
      ),
    [form],
  );

  function push(next: LotFilterForm, nextPage = 1) {
    const q = new URLSearchParams();
    const set = (k: string, v: string) => { if (v) q.set(k, v); };
    set('lot', next.lot);
    set('product', next.product);
    set('code', next.code);
    set('customer', next.customer);
    set('brand', next.brand);
    set('ref', next.ref);
    set('prepFrom', next.prepFrom);
    set('prepTo', next.prepTo);
    set('delFrom', next.delFrom);
    set('delTo', next.delTo);
    set('user', next.user);
    if (next.sort !== 'recent') q.set('sort', next.sort);
    if (nextPage > 1) q.set('page', String(nextPage));
    startTransition(() => router.replace(`/lot-tracker?${q.toString()}`));
  }

  // Debounced so results follow typing without a request per keystroke.
  function edit(patch: Partial<LotFilterForm>) {
    const next = { ...form, ...patch };
    setForm(next);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => push(next), 300);
  }

  function clear() {
    const empty: LotFilterForm = {
      lot: '', product: '', code: '', customer: '', brand: '', ref: '',
      prepFrom: '', prepTo: '', delFrom: '', delTo: '', user: '', sort: 'recent',
    };
    setForm(empty);
    startTransition(() => router.replace('/lot-tracker'));
  }

  function exportCsv() {
    // Exactly what is on screen — the filtered page. Never a wider set.
    const blob = new Blob([lotAllocationsToCsv(result.rows)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lots-${form.lot || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(Math.ceil(result.total / pageSize), 1);
  const first = result.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, result.total);

  return (
    <>
      <PageHeader title={t('lot.title')} subtitle={t('lot.subtitle')} />

      <Card className="mb-4 p-3 sm:p-4">
        {/* Lot number leads and is widest: it is the question this screen
            exists to answer, and partial input is expected. */}
        <Field label={t('lot.lotNumber')} htmlFor="lot">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input
              id="lot"
              value={form.lot}
              onChange={(e) => edit({ lot: e.target.value })}
              placeholder={t('lot.lotPlaceholder')}
              className="pl-8 text-[15px]"
              autoFocus
            />
          </div>
        </Field>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('lot.product')} htmlFor="product">
            <Input id="product" value={form.product} onChange={(e) => edit({ product: e.target.value })} />
          </Field>
          <Field label={t('lot.productCode')} htmlFor="code">
            <Input id="code" value={form.code} onChange={(e) => edit({ code: e.target.value })} />
          </Field>
          <Field label={t('lot.customer')} htmlFor="customer">
            <Input id="customer" value={form.customer} onChange={(e) => edit({ customer: e.target.value })} />
          </Field>
          {/* Beside the product fields, because that is what a brand
              narrows. 'none' is offered as a real choice: "what have we
              shipped that nobody has classified" is a question a recall
              asks, and without it those rows are unreachable here. */}
          <Field label={t('master.brand')} htmlFor="brand">
            <Select id="brand" value={form.brand} onChange={(e) => edit({ brand: e.target.value })}>
              <option value="">{t('master.allBrands')}</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
              <option value="none">{t('master.noBrand')}</option>
            </Select>
          </Field>
          <Field label={t('lot.order')} htmlFor="ref">
            <Input id="ref" value={form.ref} onChange={(e) => edit({ ref: e.target.value })} inputMode="numeric" />
          </Field>
          <Field label={t('lot.preparedFrom')} htmlFor="prepFrom">
            <Input id="prepFrom" type="date" value={form.prepFrom} onChange={(e) => edit({ prepFrom: e.target.value })} />
          </Field>
          <Field label={t('lot.preparedTo')} htmlFor="prepTo">
            <Input id="prepTo" type="date" value={form.prepTo} onChange={(e) => edit({ prepTo: e.target.value })} />
          </Field>
          <Field label={t('lot.deliveredFrom')} htmlFor="delFrom">
            <Input id="delFrom" type="date" value={form.delFrom} onChange={(e) => edit({ delFrom: e.target.value })} />
          </Field>
          <Field label={t('lot.deliveredTo')} htmlFor="delTo">
            <Input id="delTo" type="date" value={form.delTo} onChange={(e) => edit({ delTo: e.target.value })} />
          </Field>
          <Field label={t('lot.enteredBy')} htmlFor="user">
            <Select id="user" value={form.user} onChange={(e) => edit({ user: e.target.value })}>
              <option value="">{t('common.all')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <Select
              aria-label={t('lot.sort')}
              value={form.sort}
              onChange={(e) => push({ ...form, sort: e.target.value as LotSort })}
              className="h-8 w-auto py-0 text-[12.5px]"
            >
              {SORTS.map((s) => (
                <option key={s} value={s}>{t(`lot.sort_${s}` as 'lot.sort_recent')}</option>
              ))}
            </Select>
            {active && (
              <Button size="sm" variant="ghost" onClick={clear}>
                <X className="h-3.5 w-3.5" aria-hidden />
                {t('lot.clear')}
              </Button>
            )}
          </div>

          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={result.rows.length === 0}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t('lot.export')}
          </Button>
        </div>
      </Card>

      {result.total > 0 && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[13px] text-muted">
            {t('lot.showing', { first, last, total: result.total })}
          </p>
          {/* The traceability answer: how much of this lot was used across the
              WHOLE match, not just this page. */}
          <p className="text-[13px]">
            {t('lot.totalQuantity')}{' '}
            <strong className="tabular-nums text-fg">{result.totalQuantity}</strong>
          </p>
        </div>
      )}

      {result.rows.length === 0 ? (
        <EmptyState title={t('lot.noResults')} body={t('lot.noResultsBody')} />
      ) : (
        <>
          {/* Desktop: a table. Phone: cards — a twelve-column table on a
              phone is a horizontal scroll nobody reads. */}
          <Card className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-3 py-2.5 font-semibold">{t('lot.lotNumber')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('lot.product')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('lot.customer')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('lot.order')}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{t('lot.quantity')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('lot.preparation')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('lot.delivery')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('lot.enteredBy')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <Link
                          href={`/lot-tracker/${encodeURIComponent(r.lot_number)}`}
                          className="font-medium text-accent hover:underline"
                        >
                          {r.lot_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span className="block truncate">{r.product_name}</span>
                        {(r.product_code || r.brand_name) && (
                          <span className="text-[11.5px] text-subtle">
                            {[r.product_code, r.brand_name].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <CustomerCell row={r} inactiveLabel={t('status.inactive')} />
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/orders/${r.order_id}`} className="tabular-nums hover:underline">
                          #{r.order_reference}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">
                        {formatDate(r.preparation_date, 'short')}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">
                        {formatDate(r.delivery_date, 'short')}
                      </td>
                      <td className="px-3 py-2 text-muted">{r.entered_by ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <ul className="space-y-2 md:hidden">
            {result.rows.map((r) => (
              <li key={r.id}>
                <Card className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/lot-tracker/${encodeURIComponent(r.lot_number)}`}
                      className="text-[14px] font-semibold text-accent hover:underline"
                    >
                      {r.lot_number}
                    </Link>
                    <span className="shrink-0 text-[15px] font-semibold tabular-nums">{r.quantity}</span>
                  </div>
                  <p className="mt-1 truncate text-[13px]">{r.product_name}</p>
                  {r.brand_name && (
                    <p className="text-[11.5px] text-subtle">{r.brand_name}</p>
                  )}
                  <p className="text-[12.5px] text-muted">
                    <CustomerCell row={r} inactiveLabel={t('status.inactive')} />
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-subtle">
                    <Link href={`/orders/${r.order_id}`} className="tabular-nums hover:underline">
                      #{r.order_reference}
                    </Link>
                    <span className="tabular-nums">
                      {t('lot.preparation')}: {formatDate(r.preparation_date, 'short')}
                    </span>
                    <span className="tabular-nums">
                      {t('lot.delivery')}: {formatDate(r.delivery_date, 'short')}
                    </span>
                    {r.entered_by && <span>{r.entered_by}</span>}
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => push(form, page - 1)}
              >
                {t('lot.prev')}
              </Button>
              <span className="text-[12.5px] text-muted">
                {t('lot.pageOf', { page, total: totalPages })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => push(form, page + 1)}
              >
                {t('lot.next')}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * An inactive customer stays visible — historical traceability outlives a
 * customer record — but says so, so a reader does not go looking for them in
 * the active list.
 */
function CustomerCell({ row, inactiveLabel }: { row: LotAllocationRow; inactiveLabel: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', !row.customer_active && 'text-muted')}>
      <span className="truncate">
        {row.customer_name}
        {row.customer_addition ? ` · ${row.customer_addition}` : ''}
      </span>
      {!row.customer_active && <Badge tone="neutral">{inactiveLabel}</Badge>}
    </span>
  );
}
