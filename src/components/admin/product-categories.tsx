'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { RowDialog, type SaveRow } from './master-data';
import { saveProductCategory, saveProductSubcategory } from '@/server/order-actions';
import type { ProductCategory, ProductSubcategory } from '@/types/orders';

type Editing =
  | { kind: 'category'; row: ProductCategory | null }
  | { kind: 'subcategory'; categoryId: string; row: ProductSubcategory | null };

/**
 * Product categories, each with its subcategories.
 *
 * One screen for both levels because a subcategory means nothing outside its
 * category — "Ø14 Gelb" is a kind of Tortilla. Names are the business's own
 * and not translated. Deactivated rather than deleted, as brands are.
 */
export function ProductCategoriesScreen({
  categories,
  subcategories,
}: {
  categories: ProductCategory[];
  subcategories: ProductSubcategory[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);

  const save: SaveRow | null = !editing
    ? null
    : editing.kind === 'category'
      ? ({ name, is_active }, id) => saveProductCategory(name, is_active, id)
      : ({ name, is_active }, id) =>
        saveProductSubcategory({ category_id: editing.categoryId, name, is_active }, id);

  return (
    <>
      <PageHeader
        title={t('master.categoriesTitle')}
        subtitle={t('master.categoriesSubtitle')}
        action={
          <Button variant="primary" onClick={() => setEditing({ kind: 'category', row: null })}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('master.newCategory')}
          </Button>
        }
      />

      {categories.length === 0 ? (
        <EmptyState title={t('master.noCategoriesYet')} body={t('master.noCategoriesYetBody')} />
      ) : (
        <div className="space-y-3">
          {categories.map((c) => {
            const subs = subcategories.filter((s) => s.category_id === c.id);
            return (
              <Card key={c.id} className="overflow-hidden">
                <div className="flex items-center gap-3 border-b border-border bg-surface-2/50 px-3.5 py-2.5">
                  <span className={cn('min-w-0 flex-1 truncate text-[13.5px] font-semibold', !c.is_active && 'text-muted line-through')}>
                    {c.name}
                  </span>
                  {!c.is_active && <Badge tone="neutral">{t('status.inactive')}</Badge>}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing({ kind: 'subcategory', categoryId: c.id, row: null })}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    {t('master.newSubcategory')}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditing({ kind: 'category', row: c })}
                    aria-label={t('common.edit')}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
                {subs.length === 0 ? (
                  <p className="px-3.5 py-2.5 text-[12.5px] text-subtle">{t('master.noSubcategories')}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {subs.map((s) => (
                      <li key={s.id} className="flex items-center gap-3 py-2 pl-7 pr-3.5">
                        <span className={cn('min-w-0 flex-1 truncate text-[13px]', !s.is_active && 'text-muted line-through')}>
                          {s.name}
                        </span>
                        {!s.is_active && <Badge tone="neutral">{t('status.inactive')}</Badge>}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditing({ kind: 'subcategory', categoryId: c.id, row: s })}
                          aria-label={t('common.edit')}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {editing && save && (
        <RowDialog
          key={editing.row?.id ?? `new-${editing.kind}`}
          row={editing.row}
          save={save}
          withSlug={false}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </>
  );
}
