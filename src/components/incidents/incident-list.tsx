'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Download, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Input, Select } from '@/components/ui/primitives';
import { StatusChip } from '@/components/ui/status-chip';
import { PageHeader } from '@/components/shell/app-shell';
import { Combobox } from '@/components/ui/combobox';
import {
  INCIDENT_CAUSES,
  INCIDENT_RESPONSIBILITIES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  resolveVocabularyLabel,
  vocabularyKey,
} from '@/domain/incidents/vocabulary';
import type { Brand, Customer, DeliveryMethod, Product } from '@/types/orders';
import type {
  IncidentCategory,
  IncidentFilters,
  IncidentPage,
  IncidentType,
} from '@/types/incidents';
import { IncidentDialog } from './incident-dialog';

/**
 * The incident list.
 *
 * Every filter lives in the URL and is applied by the DATABASE — the page
 * receives one page of rows and a total, never the whole table. §43 requires
 * that, and it is also what makes a filtered link shareable: a manager can
 * send "all packaging incidents for this customer since July" as a URL.
 *
 * The customer filter is a first-class combobox rather than a dropdown of
 * every customer, because §24 wants "show me everything for this customer" to
 * be one action — for any customer, with none of them special-cased anywhere
 * in this file or in the query behind it.
 */
export function IncidentList({
  page,
  filters,
  customers,
  products,
  brands,
  categories,
  types,
  deliveryMethods,
  canManage,
}: {
  page: IncidentPage;
  filters: IncidentFilters;
  customers: Customer[];
  products: Product[];
  brands: Brand[];
  categories: IncidentCategory[];
  types: IncidentType[];
  deliveryMethods: DeliveryMethod[];
  canManage: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [draftQuery, setDraftQuery] = useState(filters.q ?? '');

  /** Rewrites the URL, keeping every other filter and resetting to page 1. */
  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v && k !== key) params.set(k, String(v));
    }
    if (value) params.set(key, value);
    router.push(`/incidents?${params.toString()}`);
  };

  const goToPage = (next: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
    params.set('page', String(next));
    router.push(`/incidents?${params.toString()}`);
  };

  const exportHref = (() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
    return `/incidents/export?${params.toString()}`;
  })();

  // Types narrow to the chosen category, so the two dropdowns cannot be set
  // to a combination that matches nothing.
  const visibleTypes = filters.categoryId
    ? types.filter((ty) => ty.category_id === filters.categoryId)
    : types;

  const activeCount = Object.entries(filters).filter(
    ([k, v]) => Boolean(v) && k !== 'page',
  ).length;

  const lastPage = Math.max(1, Math.ceil(page.total / page.pageSize));

  return (
    <>
      <PageHeader
        title={t('incident.title')}
        subtitle={t('incident.subtitle')}
        action={
          canManage ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('incident.new')}
            </Button>
          ) : undefined
        }
      />

      {/* Search and the filter toggle. Everything else folds away, because a
          phone cannot show fourteen filters and a warehouse tablet should not
          have to scroll past them to reach the list. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-0 flex-1 sm:max-w-xs"
          onSubmit={(e) => { e.preventDefault(); setFilter('q', draftQuery.trim()); }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            value={draftQuery}
            onChange={(e) => setDraftQuery(e.target.value)}
            placeholder={t('incident.search')}
            aria-label={t('common.search')}
            className="pl-8"
          />
        </form>

        <Button
          variant={showFilters || activeCount > 0 ? 'primary' : 'secondary'}
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          {t('incident.filters')}
          {activeCount > 0 && <span className="tabular">{activeCount}</span>}
        </Button>

        {activeCount > 0 && (
          <Button variant="ghost" onClick={() => router.push('/incidents')}>
            <X className="h-3.5 w-3.5" aria-hidden />
            {t('incident.clearFilters')}
          </Button>
        )}

        {/* The export follows the filters, because an export that did not
            would disagree with the screen it came from. */}
        <a href={exportHref} className="ml-auto">
          <Button variant="secondary" size="sm">
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t('incident.exportCsv')}
          </Button>
        </a>
      </div>

      {showFilters && (
        <Card className="mb-3 p-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <LabeledField label={t('incident.from')}>
              <Input type="date" value={filters.from ?? ''} onChange={(e) => setFilter('from', e.target.value)} />
            </LabeledField>
            <LabeledField label={t('incident.to')}>
              <Input type="date" value={filters.to ?? ''} onChange={(e) => setFilter('to', e.target.value)} />
            </LabeledField>

            <LabeledField label={t('incident.customer')}>
              <Combobox
                items={customers}
                value={filters.customerId ?? null}
                onChange={(id) => setFilter('customerId', id ?? '')}
                getKey={(c) => c.id}
                getLabel={(c) => c.name}
                getSearchText={(c) => `${c.company_name} ${c.company_name_addition ?? ''}`}
                placeholder={t('incident.allCustomers')}
                emptyMessage={t('orders.noCustomersFound')}
              />
            </LabeledField>

            <LabeledField label={t('orders.product')}>
              <Combobox
                items={products}
                value={filters.productId ?? null}
                onChange={(id) => setFilter('productId', id ?? '')}
                getKey={(p) => p.id}
                getLabel={(p) => (p.code ? `${p.code} · ${p.name ?? p.family}` : p.name ?? p.family)}
                getSearchText={(p) => `${p.code ?? ''} ${p.name ?? ''} ${p.family}`}
                placeholder={t('incident.allProducts')}
                emptyMessage={t('orders.noProductsFound')}
              />
            </LabeledField>

            <LabeledField label={t('master.brand')}>
              <Select value={filters.brandId ?? ''} onChange={(e) => setFilter('brandId', e.target.value)}>
                <option value="">{t('incident.allBrands')}</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </LabeledField>

            <LabeledField label={t('incident.categoryLabel')}>
              <Select value={filters.categoryId ?? ''} onChange={(e) => setFilter('categoryId', e.target.value)}>
                <option value="">{t('incident.allCategories')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{categoryLabel(t, c.slug, c.name)}</option>
                ))}
              </Select>
            </LabeledField>

            <LabeledField label={t('incident.typeLabel')}>
              <Select value={filters.typeId ?? ''} onChange={(e) => setFilter('typeId', e.target.value)}>
                <option value="">{t('incident.allTypes')}</option>
                {visibleTypes.map((ty) => (
                  <option key={ty.id} value={ty.id}>{typeLabel(t, ty.slug, ty.name)}</option>
                ))}
              </Select>
            </LabeledField>

            <LabeledField label={t('incident.primaryCause')}>
              <Select value={filters.primaryCause ?? ''} onChange={(e) => setFilter('primaryCause', e.target.value)}>
                <option value="">{t('incident.allCauses')}</option>
                {INCIDENT_CAUSES.map((c) => (
                  <option key={c} value={c}>{t(`incident.cause.${vocabularyKey(c)}` as MessageKey)}</option>
                ))}
              </Select>
            </LabeledField>

            <LabeledField label={t('incident.responsibilityLabel')}>
              <Select value={filters.responsibility ?? ''} onChange={(e) => setFilter('responsibility', e.target.value)}>
                <option value="">{t('incident.allResponsibilities')}</option>
                {INCIDENT_RESPONSIBILITIES.map((r) => (
                  <option key={r} value={r}>{t(`incident.responsibility.${vocabularyKey(r)}` as MessageKey)}</option>
                ))}
              </Select>
            </LabeledField>

            <LabeledField label={t('incident.severityLabel')}>
              <Select value={filters.severity ?? ''} onChange={(e) => setFilter('severity', e.target.value)}>
                <option value="">{t('incident.allSeverities')}</option>
                {INCIDENT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>{t(`incident.severity.${vocabularyKey(s)}` as MessageKey)}</option>
                ))}
              </Select>
            </LabeledField>

            <LabeledField label={t('incident.statusLabel')}>
              <Select value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
                <option value="">{t('incident.allStatuses')}</option>
                {INCIDENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`incident.status.${vocabularyKey(s)}` as MessageKey)}</option>
                ))}
              </Select>
            </LabeledField>

            <LabeledField label={t('incident.deliveryMethod')}>
              <Select
                value={filters.deliveryMethodId ?? ''}
                onChange={(e) => setFilter('deliveryMethodId', e.target.value)}
              >
                <option value="">{t('incident.allMethods')}</option>
                {deliveryMethods.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            </LabeledField>

            <LabeledField label={t('incident.replacements')}>
              <Select value={filters.replacement ?? ''} onChange={(e) => setFilter('replacement', e.target.value)}>
                <option value="">{t('incident.anyReplacement')}</option>
                <option value="with">{t('incident.withReplacement')}</option>
                <option value="without">{t('incident.withoutReplacement')}</option>
              </Select>
            </LabeledField>

            <LabeledField label={t('incident.correctiveActions')}>
              <Select value={filters.action ?? ''} onChange={(e) => setFilter('action', e.target.value)}>
                <option value="">{t('incident.anyAction')}</option>
                <option value="none">{t('incident.actionNone')}</option>
                <option value="open">{t('incident.actionAnyOpen')}</option>
                <option value="done">{t('incident.actionAllDone')}</option>
              </Select>
            </LabeledField>
          </div>
        </Card>
      )}

      {page.rows.length === 0 ? (
        <EmptyState title={t('incident.none')} body={t('incident.noneBody')} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {page.rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/incidents/${row.id}`}
                  className="flex flex-col gap-1.5 px-3.5 py-3 transition-colors hover:bg-surface-2/60"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="tabular text-[12.5px] font-semibold">{row.incident_number}</span>
                    <span className="text-[12px] text-muted">{formatDate(row.detected_at.slice(0, 10), 'short')}</span>
                    <StatusChip domain="severity" status={row.severity} />
                    <StatusChip domain="incident" status={row.status} />
                    {row.replacement_count > 0 && (
                      <Badge tone="accent">{t('incident.replacements')}</Badge>
                    )}
                    {row.open_action_count > 0 && (
                      <Badge tone="warn">
                        {t('incident.actionOpen')} {row.open_action_count}
                      </Badge>
                    )}
                  </div>

                  <p className="truncate text-[13.5px] font-medium">
                    {typeLabel(t, row.type.slug, row.type.name)}
                  </p>

                  <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                    <span className="truncate">{row.customer?.name ?? '—'}</span>
                    <span aria-hidden>·</span>
                    {/* §7: an incident with no order says so, plainly. */}
                    <span className={cn(!row.order && 'text-subtle italic')}>
                      {row.order ? `#${row.order.reference}` : t('incident.orderUnknown')}
                    </span>
                    {row.item_count > 0 && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{t('orders.lineCount', { count: row.item_count })}</span>
                      </>
                    )}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Paging, because the browser is never handed the whole table. */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[12px] text-subtle">
          {t('incident.showingCount', { shown: page.rows.length, total: page.total })}
        </p>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            disabled={page.page <= 1}
            onClick={() => goToPage(page.page - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            {t('incident.previousPage')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={page.page >= lastPage}
            onClick={() => goToPage(page.page + 1)}
          >
            {t('incident.nextPage')}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {creating && (
        <IncidentDialog
          customers={customers}
          products={products}
          categories={categories}
          types={types}
          onClose={() => setCreating(false)}
          onSaved={(id) => { setCreating(false); router.push(`/incidents/${id}`); }}
        />
      )}
    </>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11.5px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * Vocabulary keys.
 *
 * The database stores the slug; the dictionary owns the words. A category
 * added after the dictionaries shipped falls back to `t()`'s own behaviour of
 * returning the key, which the caller can spot — rather than rendering an
 * English database string into a Spanish screen.
 */
export function categoryKey(slug: string): MessageKey {
  return `incident.category.${vocabularyKey(slug)}` as MessageKey;
}

export function typeKey(slug: string): MessageKey {
  return `incident.type.${vocabularyKey(slug)}` as MessageKey;
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * A category's label: translation, else the admin's own name, else the slug
 * made readable. See `resolveVocabularyLabel` for why the fallback matters —
 * a category an admin adds has no translation, and without this the screen
 * would show `incident.category.coldStorage`.
 */
export function categoryLabel(t: Translate, slug: string, name?: string | null): string {
  const key = categoryKey(slug);
  return resolveVocabularyLabel(t(key), key, name);
}

export function typeLabel(t: Translate, slug: string, name?: string | null): string {
  const key = typeKey(slug);
  return resolveVocabularyLabel(t(key), key, name);
}
