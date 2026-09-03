'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input, Textarea } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { saveProduct } from '@/server/order-actions';
import { productLabel, type Product } from '@/types/orders';

/**
 * Product master.
 *
 * `code` is the business identifier and is unique among ACTIVE products.
 * `name` is stored exactly as imported and is never parsed — nothing is
 * inferred from it into category, weight, size or packaging.
 *
 * Products absent from the master file are deactivated, never deleted, so
 * historical order lines keep resolving.
 */
export function ProductManager({ products }: { products: Product[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const inactiveCount = products.filter((p) => !p.is_active).length;
  const reviewCount = products.filter((p) => p.needs_review).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (!showInactive && !p.is_active) return false;
      if (!q) return true;
      // Searchable by code and by name, which is how people actually look.
      return (
        (p.code ?? '').toLowerCase().includes(q) ||
        (p.name ?? '').toLowerCase().includes(q) ||
        p.family.toLowerCase().includes(q)
      );
    });
  }, [products, query, showInactive]);

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
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function ProductDialog({
  product,
  onClose,
  onSaved,
}: {
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState(product?.code ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [notes, setNotes] = useState(product?.notes ?? '');
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

        <Field label={t('master.notes')} htmlFor="p-notes">
          <Textarea id="p-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>

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
