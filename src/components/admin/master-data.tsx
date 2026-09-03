'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, ErrorState, Field, Input } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { saveDeliveryMethod } from '@/server/order-actions';
import type { DeliveryMethod } from '@/types/orders';

type Row = { id: string; name: string; is_active: boolean; slug?: string };

/**
 * Delivery-method editor.
 *
 * Never deleted: historical orders must keep displaying the delivery method
 * they were placed with, so the only lifecycle operation is active/inactive.
 * Customers have their own screen — they carry two name fields and search.
 */
export function MasterDataManager({
  rows,
  title,
  subtitle,
  addLabel,
}: {
  rows: DeliveryMethod[];
  title: string;
  subtitle: string;
  addLabel: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);

  const list = rows as unknown as Row[];

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {addLabel}
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {list.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <span className={`min-w-0 flex-1 truncate text-[13.5px] ${!row.is_active ? 'text-muted line-through' : ''}`}>
                {row.name}
              </span>
              {row.slug && <span className="shrink-0 text-[11.5px] text-subtle">{row.slug}</span>}
              <Badge tone={row.is_active ? 'done' : 'neutral'}>
                {row.is_active ? t('status.active') : t('status.inactive')}
              </Badge>
              <Button size="icon" variant="ghost" onClick={() => setEditing(row)} aria-label={t('common.edit')}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      {(creating || editing) && (
        <RowDialog
          key={editing?.id ?? 'new'}
          row={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function RowDialog({
  row,
  onClose,
  onSaved,
}: {
  row: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(row?.name ?? '');
  const [slug, setSlug] = useState(row?.slug ?? '');
  const [active, setActive] = useState(row?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveDeliveryMethod(
        name,
        slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        active,
        row?.id,
      );
      if (!res.ok) return setError(res.error);
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
        <Field label={t('master.name')} required htmlFor="m-name">
          <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        <Field label={t('master.slug')} htmlFor="m-slug">
          <Input id="m-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
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
