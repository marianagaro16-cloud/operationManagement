'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Pencil, Plus, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { filterByQuery } from '@/lib/search';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { QuickReminderButton } from '@/components/reminders/reminder-actions';
import { saveProduct } from '@/server/order-actions';
import { addProductAlias, deleteProductAlias } from '@/server/import-actions';
import type { ProductAliasRow } from '@/server/order-import';
import { suggestNetWeightKg } from '@/domain/orders/weight';
import {
  productLabel,
  type Brand,
  type Customer,
  type Product,
  type ProductCategory,
  type ProductSubcategory,
} from '@/types/orders';

/**
 * Product master.
 *
 * `code` is the business identifier and is unique among ACTIVE products.
 * `name` is stored exactly as imported and is never parsed — nothing is
 * inferred from it into category, size or packaging. The one exception is a
 * net weight SUGGESTION: offered in the dialog, or pre-filled by a script and
 * marked "to review". The gross weight starts as a copy of the net, also "to
 * review". Each suggested weight is final only when its own "Confirm" tick is
 * saved — saving the product for another reason confirms nothing.
 *
 * Products absent from the master file are deactivated, never deleted, so
 * historical order lines keep resolving.
 *
 * Two import-facing fields live here because this is where product master
 * data belongs, not because the importer owns them:
 *
 *   units_per_box — the ONLY place a box-to-units conversion can come from.
 *                   Empty means "unknown", and the importer then asks.
 *   aliases       — the names customers use on their own order requests.
 *                   An alias resolves to this product; it never creates one.
 */
export function ProductManager({
  products,
  aliases,
  customers,
  brands,
  categories,
  subcategories,
  reminderViewerId,
}: {
  products: Product[];
  aliases: ProductAliasRow[];
  customers: Customer[];
  brands: Brand[];
  categories: ProductCategory[];
  subcategories: ProductSubcategory[];
  /** Null when the viewer cannot use reminders; the row button then renders nothing. */
  reminderViewerId: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [brandFilter, setBrandFilter] = useState('');
  // A category id, or 'none' — how somebody works through the products
  // that still need classifying.
  const [categoryFilter, setCategoryFilter] = useState('');
  const [weightFilter, setWeightFilter] = useState<'' | 'suggested' | 'missing'>('');

  const inactiveCount = products.filter((p) => !p.is_active).length;
  const reviewCount = products.filter((p) => p.needs_review).length;
  // Active products only: an inactive product is never ordered, so its
  // weight is nobody's work.
  const weightSuggestedCount = products.filter((p) => p.is_active && hasSuggestedWeight(p)).length;
  const noWeightCount = products.filter((p) => p.is_active && hasMissingWeight(p)).length;

  // The shared matcher, so this screen agrees with the order form's product
  // picker: accent-folded, and terms are ANDed so "tortilla 1kg" narrows
  // instead of returning nothing.
  const visible = useMemo(
    () =>
      filterByQuery(
        products
          .filter((p) => showInactive || p.is_active)
          .filter((p) =>
            brandFilter === '' ? true
              : brandFilter === 'none' ? p.brand_id === null
                : p.brand_id === brandFilter,
          )
          .filter((p) =>
            categoryFilter === '' ? true
              : categoryFilter === 'none' ? p.category_id === null
                : p.category_id === categoryFilter,
          )
          .filter((p) =>
            weightFilter === 'suggested' ? hasSuggestedWeight(p)
              : weightFilter === 'missing' ? hasMissingWeight(p)
                : true,
          ),
        query,
        // Searchable by code, name and BRAND, which is how people actually
        // look — "masamor" should find the Masamor range.
        (p) => `${p.code ?? ''} ${p.name ?? ''} ${p.family} ${p.brand?.name ?? ''}`,
      ),
    [products, query, showInactive, brandFilter, categoryFilter, weightFilter],
  );

  return (
    <>
      <PageHeader
        title={t('master.productsTitle')}
        subtitle={t('master.productsSubtitle')}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('master.newProduct')}
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('master.searchProducts')}
          className="max-w-xs"
          aria-label={t('common.search')}
        />
        {/* Three brands, so a plain select beats a combobox. "All brands"
            and "No brand" are both real answers — the second is how somebody
            finds the catalogue that still needs classifying. */}
        <Select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          aria-label={t('master.brand')}
          className="max-w-[12rem]"
        >
          <option value="">{t('master.allBrands')}</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
          <option value="none">{t('master.noBrand')}</option>
        </Select>
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label={t('master.category')}
          className="max-w-[12rem]"
        >
          <option value="">{t('master.allCategories')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value="none">{t('master.noCategory')}</option>
        </Select>

        {inactiveCount > 0 && (
          <button
            onClick={() => setShowInactive((v) => !v)}
            aria-pressed={showInactive}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors',
              showInactive
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border bg-surface text-muted hover:text-fg',
            )}
          >
            {t('master.showInactive', { count: inactiveCount })}
          </button>
        )}
        {reviewCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-warn/30 bg-warn/[0.07] px-2.5 py-1.5 text-[13px] font-medium text-warn">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t('master.reviewCount', { count: reviewCount })}
          </span>
        )}
        {/* Weights still to check, and weights nobody has entered: each one
            narrows the list to exactly that work. */}
        {weightSuggestedCount > 0 && (
          <WeightFilterChip
            active={weightFilter === 'suggested'}
            onClick={() => setWeightFilter((f) => (f === 'suggested' ? '' : 'suggested'))}
            label={t('master.weightSuggestedCount', { count: weightSuggestedCount })}
          />
        )}
        {noWeightCount > 0 && (
          <WeightFilterChip
            active={weightFilter === 'missing'}
            onClick={() => setWeightFilter((f) => (f === 'missing' ? '' : 'missing'))}
            label={t('master.noWeightCount', { count: noWeightCount })}
          />
        )}
        <span className="text-[12px] text-subtle">
          {t('master.showingCount', { shown: visible.length, total: products.length })}
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState title={t('stats.noData')} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {visible.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3.5 py-2">
                <span className="w-14 shrink-0 text-[11.5px] tabular text-subtle">
                  {p.code ?? '—'}
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[13px]',
                    !p.is_active && 'text-muted line-through',
                  )}
                  title={productLabel(p)}
                >
                  {productLabel(p)}
                </span>
                {/* The brand a product is sold under, beside its name.
                    Absent rather than "—" when unclassified: a badge that
                    says nothing still costs a column on a phone. */}
                {p.brand && <Badge tone="neutral">{p.brand.name}</Badge>}
                {p.category_id && (
                  <Badge tone="neutral" className="hidden sm:inline-flex">
                    {classificationLabel(p, categories, subcategories)}
                  </Badge>
                )}
                <ProductWeights product={p} />
                {p.needs_review && (
                  <Badge tone="warn" title={p.notes ?? undefined}>
                    <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                    {t('master.needsReview')}
                  </Badge>
                )}
                <Badge tone={p.is_active ? 'done' : 'neutral'}>
                  {p.is_active ? t('status.active') : t('status.inactive')}
                </Badge>
                <QuickReminderButton
                  viewerId={reminderViewerId}
                  variant="ghost"
                  link={{
                    type: 'product',
                    id: p.id,
                    label: p.code ? `${p.code} · ${productLabel(p)}` : productLabel(p),
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setEditing(p)}
                  aria-label={t('common.edit')}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(creating || editing) && (
        <ProductDialog
          key={editing?.id ?? 'new'}
          product={editing}
          aliases={editing ? aliases.filter((a) => a.product_id === editing.id) : []}
          customers={customers}
          brands={brands}
          categories={categories}
          subcategories={subcategories}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); router.refresh(); }}
          onAliasChanged={() => router.refresh()}
        />
      )}
    </>
  );
}

function ProductDialog({
  product,
  aliases,
  customers,
  brands,
  categories,
  subcategories,
  onClose,
  onSaved,
  onAliasChanged,
}: {
  product: Product | null;
  aliases: ProductAliasRow[];
  customers: Customer[];
  brands: Brand[];
  categories: ProductCategory[];
  subcategories: ProductSubcategory[];
  onClose: () => void;
  onSaved: () => void;
  onAliasChanged: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState(product?.code ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState(product?.category_id ?? '');
  const [subcategoryId, setSubcategoryId] = useState(product?.subcategory_id ?? '');
  // Active ones, plus whatever this product already names so a retired
  // category still shows on its own product.
  const categoryOptions = categories.filter((c) => c.is_active || c.id === product?.category_id);
  const subcategoryOptions = subcategories.filter(
    (s) => s.category_id === categoryId && (s.is_active || s.id === product?.subcategory_id),
  );
  const [brandId, setBrandId] = useState(product?.brand_id ?? '');
  const [notes, setNotes] = useState(product?.notes ?? '');
  const [unitsPerBox, setUnitsPerBox] = useState(
    product?.units_per_box === null || product?.units_per_box === undefined
      ? ''
      : String(product.units_per_box),
  );
  const [netWeight, setNetWeight] = useState(
    product?.net_weight_kg === null || product?.net_weight_kg === undefined
      ? ''
      : String(Number(product.net_weight_kg)),
  );
  const [grossWeight, setGrossWeight] = useState(
    product?.gross_weight_kg === null || product?.gross_weight_kg === undefined
      ? ''
      : String(Number(product.gross_weight_kg)),
  );
  // A suggested weight starts unconfirmed. Typing another value is a person
  // deciding it, so it ticks the box; they can still untick it.
  const [netConfirmed, setNetConfirmed] = useState(false);
  const [grossConfirmed, setGrossConfirmed] = useState(false);
  // Offered only while the field is empty, and only when the name says it
  // unambiguously — the same rule the pre-fill used.
  const suggestedWeight = netWeight.trim() ? null : suggestNetWeightKg(name, product?.family, product?.presentation);
  const grossBelowNet =
    netWeight.trim() !== '' && grossWeight.trim() !== '' && Number(grossWeight) < Number(netWeight);
  const [active, setActive] = useState(product?.is_active ?? true);
  const [needsReview, setNeedsReview] = useState(product?.needs_review ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveProduct(
        {
          code: code.trim() || null,
          name: name.trim(),
          // Legacy structured fields are preserved as-is, never re-derived.
          family: product?.family ?? name.trim(),
          presentation: product?.presentation ?? '—',
          // Legacy free-text category, kept as it was.
          category: product?.category ?? null,
          brand_id: brandId || null,
          category_id: categoryId || null,
          subcategory_id: categoryId ? subcategoryId || null : null,
          notes: notes.trim() || null,
          // An empty field is NULL, which says "no reliable conversion" and is
          // a real answer — the importer asks rather than assuming.
          units_per_box: unitsPerBox.trim() ? Number(unitsPerBox) : null,
          net_weight_kg: netWeight.trim() ? Number(netWeight) : null,
          net_weight_suggested: Boolean(product?.net_weight_suggested) && !netConfirmed,
          // Left empty next to a net weight, the database copies the net in,
          // marked to review.
          gross_weight_kg: grossWeight.trim() ? Number(grossWeight) : null,
          gross_weight_suggested: Boolean(product?.gross_weight_suggested) && !grossConfirmed,
          is_active: active,
          needs_review: needsReview,
        },
        product?.id,
      );
      if (!res.ok) {
        setError(
          res.error.includes('products_code_active_key') ? t('master.codeInUse')
            : res.error === 'gross_below_net' ? t('master.grossBelowNet', { net: Number(netWeight) })
              : res.error,
        );
        return;
      }
      onSaved();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={product ? t('common.edit') : t('master.newProduct')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!name.trim() || grossBelowNet}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label={t('master.code')} hint={t('master.codeHint')} htmlFor="p-code">
          <Input id="p-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>

        <Field
          label={t('master.productName')}
          hint={t('master.productNameHint')}
          required
          htmlFor="p-name"
        >
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        <Field label={t('master.brand')} hint={t('master.brandHint')} htmlFor="p-brand">
          <Select id="p-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            {/* Empty is a real answer, not a prompt: a product nobody has
                classified is a fact about the catalogue. */}
            <option value="">{t('master.noBrand')}</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label={t('master.category')} hint={t('master.categoryHint')} htmlFor="p-cat">
            <Select
              id="p-cat"
              value={categoryId}
              onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(''); }}
            >
              <option value="">{t('master.noCategory')}</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('master.subcategory')} htmlFor="p-subcat">
            <Select
              id="p-subcat"
              value={subcategoryId}
              onChange={(e) => setSubcategoryId(e.target.value)}
              disabled={!categoryId}
            >
              <option value="">{t('master.noSubcategory')}</option>
              {subcategoryOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label={t('master.unitsPerBox')}
          hint={t('master.unitsPerBoxHint')}
          htmlFor="p-upb"
        >
          <Input
            id="p-upb"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={unitsPerBox}
            onChange={(e) => setUnitsPerBox(e.target.value)}
          />
        </Field>

        <WeightField
          id="p-weight"
          label={t('master.netWeight')}
          hint={t('master.netWeightHint')}
          value={netWeight}
          onChange={(v) => { setNetWeight(v); setNetConfirmed(true); }}
          review={product?.net_weight_suggested ? {
            note: t('master.weightSuggestedHint'),
            confirmLabel: t('master.confirmNetWeight'),
            confirmed: netConfirmed,
            onConfirmedChange: setNetConfirmed,
          } : null}
        >
          {suggestedWeight !== null && (
            <button
              type="button"
              onClick={() => { setNetWeight(String(suggestedWeight)); setNetConfirmed(true); }}
              className="mt-1 text-[12px] font-medium text-accent hover:underline"
            >
              {t('master.useWeightSuggestion', { kg: suggestedWeight })}
            </button>
          )}
        </WeightField>

        <WeightField
          id="p-gross"
          label={t('master.grossWeight')}
          hint={t('master.grossWeightHint')}
          value={grossWeight}
          onChange={(v) => { setGrossWeight(v); setGrossConfirmed(true); }}
          review={product?.gross_weight_suggested ? {
            note: t('master.grossSuggestedHint'),
            confirmLabel: t('master.confirmGrossWeight'),
            confirmed: grossConfirmed,
            onConfirmedChange: setGrossConfirmed,
          } : null}
        >
          {grossBelowNet && (
            <p className="mt-1 text-[12px] text-late">{t('master.grossBelowNet', { net: Number(netWeight) })}</p>
          )}
        </WeightField>

        <Field label={t('master.notes')} htmlFor="p-notes">
          <Textarea id="p-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>

        {/* Only on an existing product: an alias needs something to point at,
            and saving the product first is what creates it. */}
        {product && (
          <AliasEditor
            productId={product.id}
            aliases={aliases}
            customers={customers}
            onChanged={onAliasChanged}
          />
        )}

        <Checkbox
          label={t('status.active')}
          hint={t('master.activeHint')}
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        <Checkbox
          label={t('master.needsReview')}
          hint={t('master.needsReviewHint')}
          checked={needsReview}
          onChange={(e) => setNeedsReview(e.target.checked)}
        />

        {error && <ErrorState message={error} />}
      </div>
    </Dialog>
  );
}

/** "Tortilla · Ø14 Gelb", or just the category when there is no subcategory. */
function classificationLabel(
  p: Product,
  categories: ProductCategory[],
  subcategories: ProductSubcategory[],
): string {
  const category = categories.find((c) => c.id === p.category_id)?.name ?? '';
  const sub = subcategories.find((s) => s.id === p.subcategory_id)?.name;
  return sub ? `${category} · ${sub}` : category;
}

function hasSuggestedWeight(p: Product): boolean {
  return p.net_weight_suggested || p.gross_weight_suggested;
}

function hasMissingWeight(p: Product): boolean {
  return p.net_weight_kg === null || p.gross_weight_kg === null;
}

/**
 * A product's two weights in its list row.
 *
 * On a phone there is no room for two numbers, so only what needs doing
 * shows: "No weight" or "Check weight". Wider screens show both weights, a
 * suggested one tinted to review.
 */
function ProductWeights({ product: p }: { product: Product }) {
  const { t } = useI18n();
  if (!p.is_active && hasMissingWeight(p)) return null;
  const weight = (kind: 'net' | 'gross') => {
    const kg = kind === 'net' ? p.net_weight_kg : p.gross_weight_kg;
    const suggested = kind === 'net' ? p.net_weight_suggested : p.gross_weight_suggested;
    const label = kind === 'net' ? 'master.netShort' : 'master.grossShort';
    if (kg === null) {
      return (
        <Badge tone="neutral" className="whitespace-nowrap">
          {t(kind === 'net' ? 'master.noNetWeight' : 'master.noGrossWeight')}
        </Badge>
      );
    }
    return suggested ? (
      <Badge tone="warn" className="whitespace-nowrap" title={t('master.weightToReview')}>
        {t(label, { kg: Number(kg) })}
      </Badge>
    ) : (
      <span className="whitespace-nowrap text-[12px] tabular text-muted">{t(label, { kg: Number(kg) })}</span>
    );
  };
  return (
    <>
      <span className="shrink-0 sm:hidden">
        {hasMissingWeight(p) ? (
          <Badge tone="neutral" className="whitespace-nowrap">{t('master.noWeight')}</Badge>
        ) : hasSuggestedWeight(p) ? (
          <Badge tone="warn" className="whitespace-nowrap">{t('master.weightToReview')}</Badge>
        ) : null}
      </span>
      <span className="hidden shrink-0 items-center gap-1.5 sm:inline-flex">
        {weight('net')}
        {weight('gross')}
      </span>
    </>
  );
}

/**
 * A weight input, with its "to review" state when the value is a suggestion:
 * a note saying where it came from and its own Confirm tick.
 */
function WeightField({
  id,
  label,
  hint,
  value,
  onChange,
  review,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  review: { note: string; confirmLabel: string; confirmed: boolean; onConfirmedChange: (v: boolean) => void } | null;
  children?: ReactNode;
}) {
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <Input
        id={id}
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {review && value.trim() !== '' && (
        <div className="mt-1.5 rounded-md border border-warn/30 bg-warn/[0.07] px-2.5 py-2">
          {!review.confirmed && <p className="mb-1.5 text-[12px] text-warn">{review.note}</p>}
          <Checkbox
            label={review.confirmLabel}
            checked={review.confirmed}
            onChange={(e) => review.onConfirmedChange(e.target.checked)}
          />
        </div>
      )}
      {children}
    </Field>
  );
}

function WeightFilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors',
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border bg-surface text-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  );
}

/**
 * Customer names for one product.
 *
 * An alias is the explicit statement that "Panela Goya 454g" on a customer's
 * order sheet IS the product in the master. That statement is the difference
 * between a line the importer resolves and a line somebody retypes every
 * week, and no amount of string cleverness produces it — which is exactly why
 * it is entered by a person, once.
 *
 * Scope matters: an alias with no customer applies to everybody, while a
 * scoped one applies to that customer alone. Two customers legitimately use
 * one word for two different products, and the scope is what lets both be
 * right.
 */
function AliasEditor({
  productId,
  aliases,
  customers,
  onChanged,
}: {
  productId: string;
  aliases: ProductAliasRow[];
  customers: Customer[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [alias, setAlias] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const customerName = (id: string | null) =>
    id === null ? t('master.aliasGlobal') : customers.find((c) => c.id === id)?.name ?? '—';

  function add() {
    if (!alias.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await addProductAlias({
        product_id: productId,
        customer_id: customerId || null,
        alias: alias.trim(),
      });
      if (!res.ok) {
        return setError(res.error === 'alias_in_use' ? t('master.aliasInUse') : res.error);
      }
      setAlias('');
      onChanged();
    });
  }

  return (
    <div>
      <p className="text-[13px] font-medium">{t('master.aliases')}</p>
      <p className="mb-2 mt-0.5 text-[12px] text-muted">{t('master.aliasesHint')}</p>

      {aliases.length === 0 ? (
        <p className="mb-2 text-[12.5px] text-subtle">{t('master.noAliases')}</p>
      ) : (
        <ul className="mb-2 space-y-1">
          {aliases.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-2/50 px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-[12.5px]">{a.alias}</span>
              <span className="shrink-0 text-[11.5px] text-muted">{customerName(a.customer_id)}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('master.removeAlias')}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await deleteProductAlias(a.id);
                    if (!res.ok) return setError(res.error);
                    onChanged();
                  })
                }
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder={t('master.aliasPlaceholder')}
          aria-label={t('master.addAlias')}
          className="min-w-0 flex-1"
        />
        <Select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          aria-label={t('master.aliasScope')}
          className="sm:w-48"
        >
          <option value="">{t('master.aliasGlobal')}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Button variant="secondary" onClick={add} disabled={pending || !alias.trim()}>
          {t('master.addAlias')}
        </Button>
      </div>

      {error && <p className="mt-1.5 text-[12px] text-late">{error}</p>}
    </div>
  );
}
