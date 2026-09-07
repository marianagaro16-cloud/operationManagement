'use client';

import { useMemo, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, Link2, Plus, Search } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import {
  reorderTemplateItems,
  saveInventoryTemplateItem,
  setTemplateAssignees,
  setTemplateItemActive,
} from '@/server/inventory-actions';
import { useInventoryError } from '@/components/inventory/inventory-bits';
import type { InventoryTemplate, InventoryTemplateItem } from '@/types/inventory';
import type { Profile } from '@/types/database';

type ItemRow = InventoryTemplateItem & {
  product: { id: string; name: string | null; code: string | null } | null;
};

/**
 * The item list behind one inventory template.
 *
 * Items are activated and deactivated, never deleted: a deactivated item stops
 * appearing in newly generated inventories and stays fully visible in every
 * one that already counted it. That is what keeps a two-year-old count
 * readable after the catalogue has moved on.
 */
export function InventoryItemsManager({
  template,
  items,
  assigneeIds,
  users,
  products,
}: {
  template: InventoryTemplate;
  items: ItemRow[];
  assigneeIds: string[];
  users: Profile[];
  products: { id: string; name: string | null; code: string | null }[];
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [creating, setCreating] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!showInactive && !item.is_active) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) || (item.item_group ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, query, showInactive]);

  function move(item: ItemRow, direction: -1 | 1) {
    const ordered = items.filter((i) => i.is_active);
    const index = ordered.findIndex((i) => i.id === item.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;

    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];

    setError(null);
    startTransition(async () => {
      const res = await reorderTemplateItems(template.id, next.map((i) => i.id));
      if (!res.ok) setError(translateError(res.error));
    });
  }

  const linked = items.filter((i) => i.product_id).length;

  return (
    <div className="space-y-4">
      <AssigneeCard templateId={template.id} users={users} current={assigneeIds} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">{t('inventory.items')}</h2>
          <p className="text-[12px] text-muted">
            {t('inventory.itemsCounted', { count: items.filter((i) => i.is_active).length })}
            {' · '}
            <Link2 className="inline h-3 w-3" aria-hidden /> {linked}
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('inventory.itemNew')}
        </Button>
      </div>

      {error && <ErrorState message={error} />}

      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.search')}
            className="pl-9"
          />
        </div>
        <Checkbox
          label={t('status.inactive')}
          hint={t('inventory.deactivateHint')}
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
      </div>

      <ul className="space-y-1.5">
        {visible.map((item) => (
          <li key={item.id}>
            <Card className={cn('p-2.5', !item.is_active && 'bg-surface-2/40')}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className={cn('text-[13.5px] font-medium', !item.is_active && 'text-muted')}>
                    {item.name}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted">
                    {item.item_group && <span>{item.item_group}</span>}
                    {item.product ? (
                      <Badge tone="accent">
                        <Link2 className="h-3 w-3" aria-hidden />
                        {item.product.code ?? item.product.name}
                      </Badge>
                    ) : (
                      <span className="text-subtle">{t('inventory.noProduct')}</span>
                    )}
                    {!item.is_active && <Badge tone="neutral">{t('status.inactive')}</Badge>}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  {item.is_active && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('inventory.moveUp')}
                        onClick={() => move(item, -1)}
                        disabled={pending}
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('inventory.moveDown')}
                        onClick={() => move(item, 1)}
                        disabled={pending}
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await setTemplateItemActive(item.id, template.id, !item.is_active);
                        if (!res.ok) setError(translateError(res.error));
                      })
                    }
                  >
                    {item.is_active ? t('inventory.deactivate') : t('inventory.activate')}
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {(creating || editing) && (
        <ItemDialog
          templateId={template.id}
          item={editing}
          products={products}
          nextSortOrder={(items.at(-1)?.sort_order ?? 0) + 10}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AssigneeCard({
  templateId,
  users,
  current,
}: {
  templateId: string;
  users: Profile[];
  current: string[];
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [selected, setSelected] = useState<string[]>(current);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    setSaved(false);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <Card className="p-3 sm:p-4">
      <h3 className="text-[14px] font-semibold">{t('inventory.assignees')}</h3>
      <p className="mb-2 mt-0.5 text-[12px] text-muted">{t('inventory.assigneesHint')}</p>

      <div className="space-y-1.5">
        {users
          .filter((u) => u.status === 'approved')
          .map((u) => (
            <Checkbox
              key={u.id}
              label={u.name ?? u.email}
              checked={selected.includes(u.id)}
              onChange={() => toggle(u.id)}
            />
          ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await setTemplateAssignees(templateId, selected);
              if (res.ok) setSaved(true);
              else setError(translateError(res.error));
            })
          }
        >
          {t('common.save')}
        </Button>
        {saved && <span className="text-[12px] text-done">{t('common.save')}</span>}
        {error && <span className="text-[12px] text-late">{error}</span>}
      </div>
    </Card>
  );
}

function ItemDialog({
  templateId,
  item,
  products,
  nextSortOrder,
  onClose,
}: {
  templateId: string;
  item: ItemRow | null;
  products: { id: string; name: string | null; code: string | null }[];
  nextSortOrder: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(item?.name ?? '');
  const [group, setGroup] = useState(item?.item_group ?? '');
  const [productId, setProductId] = useState(item?.product_id ?? '');
  const [nameDe, setNameDe] = useState(item?.translations?.de?.name ?? '');
  const [nameEn, setNameEn] = useState(item?.translations?.en?.name ?? '');

  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? t('common.edit') : t('inventory.itemNew')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!name.trim()}
            onClick={() =>
              startTransition(async () => {
                const res = await saveInventoryTemplateItem(
                  {
                    template_id: templateId,
                    name: name.trim(),
                    item_group: group.trim() || null,
                    translations: {
                      de: { name: nameDe.trim() || null },
                      en: { name: nameEn.trim() || null },
                    },
                    product_id: productId || null,
                    sort_order: item?.sort_order ?? nextSortOrder,
                    is_active: item?.is_active ?? true,
                  },
                  item?.id,
                );
                if (res.ok) onClose();
                else setError(translateError(res.error));
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('inventory.itemName')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        <Field label={t('inventory.itemGroup')}>
          <Input value={group} onChange={(e) => setGroup(e.target.value)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Deutsch">
            <Input value={nameDe} onChange={(e) => setNameDe(e.target.value)} />
          </Field>
          <Field label="English">
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
        </div>

        {/* Optional by design. Forcing a raw material or a packaging item into
            the commercial product catalogue would corrupt the catalogue. */}
        <Field label={t('inventory.linkedProduct')} hint={t('inventory.linkProductHint')}>
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">{t('inventory.noProduct')}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code ? `${p.code} · ` : ''}
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
