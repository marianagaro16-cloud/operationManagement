'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Pencil, Plus, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { filterByQuery } from '@/lib/search';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { saveProduct } from '@/server/order-actions';
import { addProductAlias, deleteProductAlias } from '@/server/import-actions';
import type { ProductAliasRow } from '@/server/order-import';
import { productLabel, type Customer, type Product } from '@/types/orders';

/**
 * Product master.
 *
 * `code` is the business identifier and is unique among ACTIVE products.
 * `name` is stored exactly as imported and is never parsed — nothing is
 * inferred from it into category, weight, size or packaging.
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
}: {
  products: Product[];
  aliases: ProductAliasRow[];
  customers: Customer[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const inactiveCount = products.filter((p) => !p.is_active).length;
  const reviewCount = products.filter((p) => p.needs_review).length;

  // The shared matcher, so this screen agrees with the order form's product
  // picker: accent-folded, and terms are ANDed so "tortilla 1kg" narrows
  // instead of returning nothing.
  const visible = useMemo(
    () =>
      filterByQuery(
        products.filter((p) => showInactive || p.is_active),
        query,
        // Searchable by code and by name, which is how people actually look.
        (p) => `${p.code ?? ''} ${p.name ?? ''} ${p.family}`,
      ),
    [products, query, showInactive],
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
                {p.needs_review && (
                  <Badge tone="warn" title={p.notes ?? undefined}>
                    <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                    {t('master.needsReview')}
                  </Badge>
                )}
                <Badge tone={p.is_active ? 'done' : 'neutral'}>
                  {p.is_active ? t('status.active') : t('status.inactive')}
                </Badge>
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
  onClose,
  onSaved,
  onAliasChanged,
}: {
  product: Product | null;
  aliases: ProductAliasRow[];
  customers: Customer[];
  onClose: () => void;
  onSaved: () => void;
  onAliasChanged: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState(product?.code ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [notes, setNotes] = useState(product?.notes ?? '');
  const [unitsPerBox, setUnitsPerBox] = useState(
    product?.units_per_box === null || product?.units_per_box === undefined
      ? ''
      : String(product.units_per_box),
  );
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
          category: category.trim() || null,
          notes: notes.trim() || null,
          // An empty field is NULL, which says "no reliable conversion" and is
          // a real answer — the importer asks rather than assuming.
          units_per_box: unitsPerBox.trim() ? Number(unitsPerBox) : null,
          is_active: active,
          needs_review: needsReview,
        },
        product?.id,
      );
      if (!res.ok) {
        setError(res.error.includes('products_code_active_key') ? t('master.codeInUse') : res.error);
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
          <Button variant="primary" onClick={submit} loading={pending} disabled={!name.trim()}>
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

        <Field label={t('master.category')} htmlFor="p-cat">
          <Input id="p-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>

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
