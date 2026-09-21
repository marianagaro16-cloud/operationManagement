'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import type { ActionResult } from '@/server/actions';
import { saveProductCategory, saveProductSubcategory } from '@/server/order-actions';
import { localizedName, type ProductCategory, type ProductSubcategory } from '@/types/orders';

type Named = { id: string; name: string; name_es: string | null; name_de: string | null; is_active: boolean };
type NamesInput = { name: string; name_es: string; name_de: string; is_active: boolean };

type Editing =
  | { kind: 'category'; row: ProductCategory | null }
  | { kind: 'subcategory'; categoryId: string; row: ProductSubcategory | null };

/**
 * Product categories, each with its subcategories.
 *
 * One screen for both levels because a subcategory means nothing outside its
 * category — "Ø14" is a kind of Blue tortilla. Each is named in English,
 * Spanish and German; the viewer reads their own language. Deactivated rather
 * than deleted, as brands are.
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

  const save = (input: NamesInput, id?: string): Promise<ActionResult> =>
    !editing || editing.kind === 'category'
      ? saveProductCategory(input, id)
      : saveProductSubcategory({ ...input, category_id: editing.categoryId }, id);

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
                  <Names row={c} strong />
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
                        <Names row={s} />
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

      {editing && (
        <NamesDialog
          key={editing.row?.id ?? `new-${editing.kind}`}
          row={editing.row}
          save={save}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </>
  );
}

/**
 * The name in the viewer's language, with the other two beside it so a
 * missing translation is visible at a glance.
 */
function Names({ row, strong = false }: { row: Named; strong?: boolean }) {
  const { t, locale } = useI18n();
  const others = (['en', 'es', 'de'] as const)
    .filter((l) => l !== locale)
    .map((l) => {
      const value = l === 'en' ? row.name : l === 'es' ? row.name_es : row.name_de;
      return `${l.toUpperCase()}: ${value ?? t('master.noTranslation')}`;
    });
  return (
    <span className={cn('min-w-0 flex-1', !row.is_active && 'text-muted line-through')}>
      <span className={cn('block truncate', strong ? 'text-[13.5px] font-semibold' : 'text-[13px]')}>
        {localizedName(row, locale)}
      </span>
      <span className="block truncate text-[11.5px] text-subtle">{others.join(' · ')}</span>
    </span>
  );
}

function NamesDialog({
  row,
  save,
  onClose,
  onSaved,
}: {
  row: Named | null;
  save: (input: NamesInput, id?: string) => Promise<ActionResult>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(row?.name ?? '');
  const [nameEs, setNameEs] = useState(row?.name_es ?? '');
  const [nameDe, setNameDe] = useState(row?.name_de ?? '');
  const [active, setActive] = useState(row?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await save({ name, name_es: nameEs, name_de: nameDe, is_active: active }, row?.id);
      if (!res.ok) return setError(res.error.includes('_name_key') ? t('master.categoryNameInUse') : res.error);
      onSaved();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? t('common.edit') : t('common.create')}
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
        {/* Language names are written in their own language, as in the language picker. */}
        <Field label="English" hint={t('master.englishNameHint')} required htmlFor="c-name-en">
          <Input id="c-name-en" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Español" htmlFor="c-name-es">
          <Input id="c-name-es" value={nameEs} onChange={(e) => setNameEs(e.target.value)} />
        </Field>
        <Field label="Deutsch" htmlFor="c-name-de">
          <Input id="c-name-de" value={nameDe} onChange={(e) => setNameDe(e.target.value)} />
        </Field>

        <Checkbox
          label={t('status.active')}
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />

        {error && <ErrorState message={error} />}
      </div>
    </Dialog>
  );
}
