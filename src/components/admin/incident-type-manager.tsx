'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { saveIncidentCategory, saveIncidentType } from '@/server/incident-actions';
import type { IncidentCategory, IncidentType } from '@/types/incidents';
import { categoryKey, typeKey } from '@/components/incidents/incident-list';

/**
 * The incident vocabulary.
 *
 * Categories and types are configurable because a new failure mode is
 * something an operations manager discovers, not something that should need a
 * deployment — §9 and §44. Causes and responsibilities deliberately are NOT
 * here: they are the axes every month-on-month comparison is grouped by, and
 * a renamed cause would silently break the history the module exists to keep.
 *
 * `slug` is the identity and the translation key. It is editable only on
 * creation for exactly that reason, and the hint says so.
 */
export function IncidentTypeManager({
  categories,
  types,
}: {
  categories: IncidentCategory[];
  types: IncidentType[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [editingCategory, setEditingCategory] = useState<IncidentCategory | null>(null);
  const [editingType, setEditingType] = useState<IncidentType | null>(null);
  const [creating, setCreating] = useState<'category' | 'type' | null>(null);

  const done = () => {
    setEditingCategory(null);
    setEditingType(null);
    setCreating(null);
    router.refresh();
  };

  return (
    <>
      <PageHeader
        title={t('incident.typesTitle')}
        subtitle={t('incident.typesSubtitle')}
        action={
          <div className="flex gap-1.5">
            <Button variant="secondary" onClick={() => setCreating('category')}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('incident.newCategory')}
            </Button>
            <Button variant="primary" onClick={() => setCreating('type')}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('incident.newType')}
            </Button>
          </div>
        }
      />

      <div className="space-y-4">
        {categories.map((category) => (
          <section key={category.id}>
            <div className="mb-1.5 flex items-center gap-2 px-0.5">
              <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                {t(categoryKey(category.slug))}
              </h2>
              <span className="text-[11px] text-subtle">{category.slug}</span>
              {!category.is_active && <Badge tone="neutral">{t('status.inactive')}</Badge>}
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('common.edit')}
                onClick={() => setEditingCategory(category)}
              >
                <Pencil className="h-3 w-3" aria-hidden />
              </Button>
            </div>

            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">
                {types
                  .filter((ty) => ty.category_id === category.id)
                  .map((ty) => (
                    <li key={ty.id} className="flex items-center gap-3 px-3.5 py-2">
                      <span
                        className={cn('min-w-0 flex-1 truncate text-[13px]', !ty.is_active && 'text-muted line-through')}
                      >
                        {t(typeKey(ty.slug))}
                      </span>
                      <span className="shrink-0 text-[11px] text-subtle">{ty.slug}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('common.edit')}
                        onClick={() => setEditingType(ty)}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </li>
                  ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>

      {(creating === 'category' || editingCategory) && (
        <VocabularyDialog
          key={editingCategory?.id ?? 'new-category'}
          kind="category"
          row={editingCategory}
          categories={categories}
          onClose={() => { setCreating(null); setEditingCategory(null); }}
          onSaved={done}
        />
      )}
      {(creating === 'type' || editingType) && (
        <VocabularyDialog
          key={editingType?.id ?? 'new-type'}
          kind="type"
          row={editingType}
          categories={categories}
          onClose={() => { setCreating(null); setEditingType(null); }}
          onSaved={done}
        />
      )}
    </>
  );
}

function VocabularyDialog({
  kind,
  row,
  categories,
  onClose,
  onSaved,
}: {
  kind: 'category' | 'type';
  row: IncidentCategory | IncidentType | null;
  categories: IncidentCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [slug, setSlug] = useState(row?.slug ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [sortOrder, setSortOrder] = useState(String(row?.sort_order ?? 100));
  const [active, setActive] = useState(row?.is_active ?? true);
  const [categoryId, setCategoryId] = useState(
    (row as IncidentType | null)?.category_id ?? categories[0]?.id ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const base = {
        slug: slug.trim(),
        name: name.trim(),
        sort_order: Number(sortOrder) || 100,
        is_active: active,
      };
      const res = kind === 'category'
        ? await saveIncidentCategory(base, row?.id)
        : await saveIncidentType({ ...base, category_id: categoryId }, row?.id);

      if (!res.ok) return setError(t('incident.errSaveFailed'));
      onSaved();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? t('common.edit') : kind === 'category' ? t('incident.newCategory') : t('incident.newType')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!slug.trim() || !name.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {kind === 'type' && (
          <Field label={t('incident.categoryLabel')} required htmlFor="v-cat">
            <Select id="v-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{t(categoryKey(c.slug))}</option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t('incident.slug')} hint={t('incident.slugHint')} required htmlFor="v-slug">
          {/* Editable only on creation. Changing it after incidents have been
              classified with it would orphan every one of them from its
              translation and from its place in the historical grouping. */}
          <Input
            id="v-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
            disabled={Boolean(row)}
          />
        </Field>

        <Field
          label={t('incident.displayName')}
          hint={t('incident.displayNameHint')}
          required
          htmlFor="v-name"
        >
          <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label={t('incident.sortOrder')} htmlFor="v-sort">
          <Input
            id="v-sort"
            type="number"
            min="0"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
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
