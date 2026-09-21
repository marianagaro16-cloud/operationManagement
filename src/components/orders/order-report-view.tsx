'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Download } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, EmptyState, Select } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { ReportShell, reportHref } from '@/components/reports/report-shell';
import {
  PRODUCT_GROUPINGS,
  productReportToCsv,
  renameClassification,
  type OrderReport,
  type ProductGroup,
  type ProductGrouping,
  type ProductLine,
} from '@/domain/orders/reporting';
import { formatKg } from '@/domain/orders/weight';
import {
  localizedName,
  productLabel,
  type Brand,
  type Customer,
  type Product,
  type ProductCategory,
  type ProductSubcategory,
} from '@/types/orders';

const GROUPING_LABEL = {
  none: 'report.groupNone',
  category: 'master.category',
  subcategory: 'master.subcategory',
} as const;

/** One product's row in the product table; indented under a group. */
function ProductRow({ p, indent = false }: { p: ProductLine; indent?: boolean }) {
  return (
    <tr>
      <td className={cn('py-2 pr-3 tabular text-subtle', indent ? 'pl-8' : 'pl-3')}>{p.code ?? '—'}</td>
      <td className="max-w-[280px] truncate px-2 py-2" title={p.name}>{p.name}</td>
      <QuantityCells line={p} />
    </tr>
  );
}

/** Ordered, prepared, remaining and customers — the same four for a product and a group. */
function QuantityCells({
  line,
  strong = false,
}: {
  line: Pick<ProductLine, 'ordered' | 'prepared' | 'missing' | 'customers'>;
  strong?: boolean;
}) {
  return (
    <>
      <td className={cn('px-2 py-2 text-right tabular', strong ? 'font-semibold' : 'font-medium')}>{line.ordered}</td>
      <td className="px-2 py-2 text-right tabular text-muted">{line.prepared}</td>
      <td className={cn('px-2 py-2 text-right tabular', line.missing > 0 ? 'text-warn' : 'text-subtle')}>
        {line.missing || '—'}
      </td>
      <td className="px-3 py-2 text-right tabular text-muted">{line.customers}</td>
    </>
  );
}

/**
 * Order report — the Orders tab of /admin/reports.
 *
 * Answers, for a day, a week or a month: how many orders, how much of each
 * product went out, who bought it, and how much of it was actually prepared.
 *
 * Keyed on DELIVERY date — this is the commercial view. Lotnummerkontrol
 * remains the preparation-date view of the same orders.
 *
 * The period selector, the navigation and the custom-range pickers used to
 * live in this file, which is why the statistics screen next door grew its own
 * incompatible copy. They are now in ReportShell and shared by all three tabs.
 */
export function OrderReportView({
  report: computed,
  anchor,
  customers,
  products,
  brands,
  filters,
  grouping,
  categories,
  subcategories,
}: {
  report: OrderReport;
  anchor: string;
  customers: Customer[];
  products: Product[];
  brands: Brand[];
  /** Narrowing applied to the whole report, carried in the URL. brandId may be 'none'. */
  filters: { customerId?: string; productId?: string; brandId?: string };
  /** How the product table is grouped, carried in the URL so it survives period changes. */
  grouping: ProductGrouping;
  /** To name categories in the viewer's language, which can change after the server render. */
  categories: ProductCategory[];
  subcategories: ProductSubcategory[];
}) {
  const { t, formatDate, locale } = useI18n();
  const router = useRouter();
  const report = useMemo(() => {
    const category = new Map(categories.map((c) => [c.id, localizedName(c, locale)]));
    const subcategory = new Map(subcategories.map((c) => [c.id, localizedName(c, locale)]));
    return renameClassification(computed, { category: (id) => category.get(id), subcategory: (id) => subcategory.get(id) });
  }, [computed, categories, subcategories, locale]);
  const { range } = report;

  const urlFilters = {
    customer: filters.customerId,
    product: filters.productId,
    brand: filters.brandId,
    group: grouping === 'none' ? undefined : grouping,
  };
  const setFilter = (key: 'customer' | 'product', value: string | null) =>
    router.push(reportHref('orders', range, anchor, undefined, { ...urlFilters, [key]: value ?? undefined }));

  // The product picker offers only the chosen brand's products.
  const inBrand = (p: Product, brand: string | undefined) =>
    !brand || (brand === 'none' ? !p.brand_id : p.brand_id === brand);
  const brandProducts = products.filter((p) => inBrand(p, filters.brandId));

  // A product of another brand would narrow the report to nothing, so it is
  // dropped when the brand changes.
  function setBrand(value: string) {
    const brand = value || undefined;
    const product = products.find((p) => p.id === filters.productId);
    router.push(reportHref('orders', range, anchor, undefined, {
      ...urlFilters,
      brand,
      product: product && inBrand(product, brand) ? product.id : undefined,
    }));
  }

  const groups = grouping === 'category' ? report.byCategory
    : grouping === 'subcategory' ? report.bySubcategory
      : null;
  // Open by default: only the groups somebody folded are remembered.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  function setGrouping(value: ProductGrouping) {
    setCollapsed(new Set());
    router.push(reportHref('orders', range, anchor, undefined, {
      ...urlFilters,
      group: value === 'none' ? undefined : value,
    }));
  }

  function groupLabel(g: ProductGroup): string {
    if (!g.category) return t('report.unclassified');
    if (grouping === 'category') return g.category;
    return `${g.category} · ${g.subcategory ?? t('master.noSubcategory')}`;
  }

  function downloadCsv() {
    // Built in the browser from data already on the page — no round trip.
    const blob = new Blob([productReportToCsv(report, grouping)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pedidos-${range.key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const tiles: { label: string; value: string | number; tone?: string; note?: string }[] = [
    { label: t('report.orders'), value: report.orders },
    { label: t('report.customers'), value: report.customersServed },
    { label: t('report.unitsOrdered'), value: report.totalOrdered },
    {
      label: t('report.totalWeight'),
      value: formatKg(report.totalWeightKg),
      // Partial while products have no weight, and says so.
      note: report.productsWithoutWeight > 0
        ? t('report.productsWithoutWeight', { count: report.productsWithoutWeight })
        : undefined,
    },
    // Boxes belong to a whole order, so they cannot be split by brand or
    // product: shown only when the report is not narrowed to one.
    ...(filters.brandId || filters.productId
      ? []
      : [{ label: t('report.boxes'), value: report.totalBoxes }]),
    {
      label: t('report.fulfilment'),
      value: `${report.fulfilmentRate}%`,
      tone: report.fulfilmentRate >= 100 ? 'text-done' : report.fulfilmentRate > 0 ? 'text-warn' : undefined,
    },
  ];

  return (
    <ReportShell
      tab="orders"
      range={range}
      anchor={anchor}
      filters={urlFilters}
      action={
        report.byProduct.length > 0 ? (
          <button
            onClick={downloadCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] font-medium text-muted transition-colors hover:text-fg"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t('report.exportCsv')}
          </button>
        ) : undefined
      }
    >
      {/* Outside the empty state, so a filter that matches nothing can still
          be seen and cleared. Clearing a field means "all". */}
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Combobox
          items={customers}
          value={filters.customerId ?? null}
          onChange={(id) => setFilter('customer', id)}
          getKey={(c) => c.id}
          getLabel={(c) => c.name}
          getSearchText={(c) => `${c.company_name} ${c.company_name_addition ?? ''}`}
          placeholder={t('orders.allCustomers')}
          emptyMessage={t('orders.noCustomersFound')}
        />
        {/* 'none' is a real choice, as in the Lot Tracker: products nobody
            has classified are otherwise unreachable from a brand filter. */}
        <Select
          value={filters.brandId ?? ''}
          onChange={(e) => setBrand(e.target.value)}
          aria-label={t('master.brand')}
        >
          <option value="">{t('master.allBrands')}</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
          <option value="none">{t('master.noBrand')}</option>
        </Select>
        <Combobox
          items={brandProducts}
          value={filters.productId ?? null}
          onChange={(id) => setFilter('product', id)}
          getKey={(p) => p.id}
          getLabel={(p) => (p.code ? `${p.code} · ${productLabel(p)}` : productLabel(p))}
          getSearchText={(p) => `${p.code ?? ''} ${p.name ?? ''} ${p.family}`}
          placeholder={t('incident.allProducts')}
          emptyMessage={t('orders.noProductsFound')}
        />
      </div>

      {report.orders === 0 && report.cancelled === 0 ? (
        <EmptyState title={t('report.noOrders')} body={t('report.noOrdersBody')} />
      ) : (
        <div className="space-y-5">
          {/* Headline */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map((tile) => (
              <Card key={tile.label}>
                <CardBody className="pt-3.5">
                  <p className="text-[11.5px] text-muted">{tile.label}</p>
                  <p className={cn('mt-0.5 text-xl font-semibold tabular', tile.tone)}>{tile.value}</p>
                  {tile.note && <p className="mt-0.5 text-[11.5px] text-warn">{tile.note}</p>}
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Anything the headline hides */}
          {(report.cancelled > 0 || report.draft > 0 || report.samples > 0
            || report.replacements > 0 || report.sponsorships > 0
            || report.shortLines > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {report.cancelled > 0 && (
                <Badge tone="late">{t('report.cancelled')}: {report.cancelled}</Badge>
              )}
              {report.draft > 0 && (
                <Badge tone="warn">{t('orders.statusDraft')}: {report.draft}</Badge>
              )}
              {report.samples > 0 && (
                <Badge tone="accent">{t('orders.typeSample')}: {report.samples}</Badge>
              )}
              {/* Counted apart from sales. A month's orders and a month's
                  TRADE are different numbers once some of those orders were
                  sent to apologise. */}
              {report.replacements > 0 && (
                <Badge tone="warn">{t('orders.typeReplacement')}: {report.replacements}</Badge>
              )}
              {report.sponsorships > 0 && (
                <Badge tone="accent">{t('orders.typeSponsorship')}: {report.sponsorships}</Badge>
              )}
              {report.shortLines > 0 && (
                <Badge tone="warn">
                  {t('report.shortLines')}: {report.shortLines}
                  {report.unexplainedShortLines > 0 && ` (${report.unexplainedShortLines} ${t('report.unexplained')})`}
                </Badge>
              )}
            </div>
          )}

          {/* Products — the main table */}
          <section>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-[13px] font-semibold">{t('report.byProduct')}</h2>
              <label className="ml-auto flex items-center gap-1.5 text-[12.5px] text-muted">
                {t('report.groupBy')}
                <Select
                  value={grouping}
                  onChange={(e) => setGrouping(e.target.value as ProductGrouping)}
                  className="h-8 w-auto py-0 text-[13px]"
                >
                  {PRODUCT_GROUPINGS.map((g) => (
                    <option key={g} value={g}>{t(GROUPING_LABEL[g])}</option>
                  ))}
                </Select>
              </label>
              {groups && groups.length > 0 && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>
                    <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden />
                    {t('prep.expandAll')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set(groups.map((g) => g.key)))}>
                    <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden />
                    {t('prep.collapseAll')}
                  </Button>
                </>
              )}
            </div>
            {report.byProduct.length === 0 ? (
              <EmptyState title={t('stats.noData')} />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-[11.5px] uppercase text-subtle">
                        <th className="px-3 py-2 text-left font-medium">{t('master.code')}</th>
                        <th className="px-2 py-2 text-left font-medium">{t('orders.product')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('orders.ordered')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('report.prepared')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('orders.remaining')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('report.customersShort')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {groups
                        ? groups.map((g) => {
                          const open = !collapsed.has(g.key);
                          return (
                            <Fragment key={g.key}>
                              <tr className="bg-surface-2/60">
                                <td colSpan={2} className="px-3 py-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleGroup(g.key)}
                                    aria-expanded={open}
                                    className="flex w-full min-w-0 items-center gap-1.5 text-left font-semibold"
                                  >
                                    <ChevronDown
                                      className={cn('h-4 w-4 shrink-0 text-muted transition-transform', !open && '-rotate-90')}
                                      aria-hidden
                                    />
                                    <span className={cn('truncate', !g.category && 'italic text-muted')}>{groupLabel(g)}</span>
                                    <span className="shrink-0 text-[11.5px] font-normal text-subtle">
                                      {g.products.length === 1
                                        ? t('report.productCountOne')
                                        : t('report.productCount', { count: g.products.length })}
                                    </span>
                                  </button>
                                </td>
                                <QuantityCells line={g} strong />
                              </tr>
                              {open && g.products.map((p) => <ProductRow key={p.productId} p={p} indent />)}
                            </Fragment>
                          );
                        })
                        : report.byProduct.map((p) => <ProductRow key={p.productId} p={p} />)}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </section>

          {/* Brands — the question the brand field exists to answer.
              Products nobody has classified share one row rather than being
              dropped, so these numbers still reconcile with the period total,
              and how much is unclassified is itself the finding. */}
          {report.byBrand.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('report.byBrand')}</h2>
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-[11.5px] uppercase text-subtle">
                        <th className="px-3 py-2 text-left font-medium">{t('master.brand')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('master.productsTitle')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('report.lines')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('report.unitsOrdered')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.byBrand.map((b) => (
                        <tr key={b.brandId ?? 'unclassified'}>
                          <td className="max-w-[260px] truncate px-3 py-2">
                            {/* Narrows the whole report to this brand. */}
                            <Link
                              href={reportHref('orders', range, anchor, undefined, {
                                customer: filters.customerId,
                                brand: b.brandId ?? 'none',
                                group: urlFilters.group,
                              })}
                              className="transition-colors hover:text-accent hover:underline"
                            >
                              {b.name ?? (
                                <span className="italic text-subtle">{t('master.noBrand')}</span>
                              )}
                            </Link>
                          </td>
                          <td className="px-2 py-2 text-right tabular">{b.products}</td>
                          <td className="px-2 py-2 text-right tabular">{b.lines}</td>
                          <td className="px-3 py-2 text-right tabular font-medium">{b.ordered}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          )}

          {/* Customers */}
          {report.byCustomer.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('report.byCustomer')}</h2>
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-[11.5px] uppercase text-subtle">
                        <th className="px-3 py-2 text-left font-medium">{t('orders.customer')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('report.orders')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('report.lines')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('report.unitsOrdered')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.byCustomer.map((c) => (
                        <tr key={c.customerId}>
                          {/* The orders behind the number. Every row of this
                              report used to be dead text over a query that
                              already knew how to filter. */}
                          <td className="max-w-[260px] truncate px-3 py-2" title={c.name}>
                            <Link
                              href={`/orders?tab=all&month=${range.start.slice(0, 7)}&customer=${c.customerId}`}
                              className="transition-colors hover:text-accent hover:underline"
                            >
                              {c.name}
                            </Link>
                          </td>
                          <td className="px-2 py-2 text-right tabular">{c.orders}</td>
                          <td className="px-2 py-2 text-right tabular text-muted">{c.lines}</td>
                          <td className="px-3 py-2 text-right font-medium tabular">{c.ordered}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          )}

          {/* Per-month trend for long ranges — 365 daily rows is unreadable */}
          {report.byMonth.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('report.byMonth')}</h2>
              <Card>
                <CardBody className="pt-3.5">
                  <ul className="space-y-1">
                    {report.byMonth.map((m) => {
                      const max = Math.max(...report.byMonth.map((x) => x.ordered), 1);
                      return (
                        <li key={m.month} className="flex items-center gap-2 text-[12.5px]">
                          <span className="w-24 shrink-0 capitalize text-muted">
                            {formatDate(`${m.month}-01`, 'monthYear')}
                          </span>
                          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${(m.ordered / max) * 100}%` }}
                            />
                          </span>
                          <span className="w-12 shrink-0 text-right tabular">{m.ordered || '—'}</span>
                          <span className="w-16 shrink-0 text-right tabular text-subtle">
                            {m.orders ? `${m.orders} ${t('report.ordersShort')}` : ''}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </CardBody>
              </Card>
            </section>
          )}

          {/* Per-day trend, only where it adds something */}
          {range.kind !== 'day' && report.byDay.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('report.byDay')}</h2>
              <Card>
                <CardBody className="pt-3.5">
                  <ul className="space-y-1">
                    {report.byDay.map((d) => {
                      const max = Math.max(...report.byDay.map((x) => x.ordered), 1);
                      return (
                        <li key={d.date} className="flex items-center gap-2 text-[12.5px]">
                          <span className="w-24 shrink-0 capitalize text-muted">
                            {formatDate(d.date, 'short')}
                          </span>
                          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${(d.ordered / max) * 100}%` }}
                            />
                          </span>
                          <span className="w-10 shrink-0 text-right tabular">{d.ordered || '—'}</span>
                          <span className="w-14 shrink-0 text-right tabular text-subtle">
                            {d.orders ? `${d.orders} ${t('report.ordersShort')}` : ''}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </CardBody>
              </Card>
            </section>
          )}

          {/* Delivery methods */}
          {!filters.brandId && !filters.productId && report.byBoxType.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('report.byBoxType')}</h2>
              <Card>
                <CardBody className="flex flex-wrap gap-x-4 gap-y-1 pt-3.5 text-[13px]">
                  {report.byBoxType.map((b) => (
                    <span key={b.boxTypeId} className="text-muted">
                      {b.name}: <span className="font-medium tabular text-fg">{b.boxes}</span>
                    </span>
                  ))}
                </CardBody>
              </Card>
            </section>
          )}

          {report.byDeliveryMethod.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('orders.deliveryMethod')}</h2>
              <Card>
                <CardBody className="flex flex-wrap gap-x-4 gap-y-1 pt-3.5 text-[13px]">
                  {report.byDeliveryMethod.map((m) => (
                    <span key={m.key} className="text-muted">
                      {m.label || t('common.none')}:{' '}
                      <span className="font-medium tabular text-fg">{m.orders}</span>
                    </span>
                  ))}
                </CardBody>
              </Card>
            </section>
          )}
        </div>
      )}
    </ReportShell>
  );
}
