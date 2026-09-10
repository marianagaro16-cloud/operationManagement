'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Plus, Truck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shell/app-shell';
import {
  Badge,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
} from '@/components/ui/primitives';
import {
  createSupplier,
  createTransporter,
  renameSupplier,
  renameTransporter,
  setSupplierActive,
  setTransporterActive,
} from '@/server/goods-reception-actions';
import type { Supplier, Transporter } from '@/types/goods-reception';
import { useReceptionError } from '@/components/goods-reception/reception-bits';

/**
 * Supplier and Transporter master data.
 *
 * ONE component for both, because they are the same table with a different
 * noun and two copies would drift the first time one gained a feature. The
 * `kind` prop chooses the actions and the copy; nothing else differs.
 *
 * §37: there is no delete button anywhere on this screen, and the absence is
 * the point. A supplier with receptions behind it is referenced by history;
 * the FK is RESTRICT, so even a hand-written DELETE is refused. Deactivating
 * stops it being offered for new receptions and changes nothing that already
 * happened.
 */
export function ReceptionMaster({
  kind,
  rows,
}: {
  kind: 'supplier' | 'transporter';
  rows: (Supplier | Transporter)[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = useReceptionError();
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Supplier | Transporter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isSupplier = kind === 'supplier';
  const visible = showInactive ? rows : rows.filter((r) => r.is_active);

  function toggleActive(row: Supplier | Transporter) {
    startTransition(async () => {
      const res = isSupplier
        ? await setSupplierActive(row.id, !row.is_active)
        : await setTransporterActive(row.id, !row.is_active);
      if (!res.ok) setError(translateError(res.error));
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <PageHeader
        title={t(isSupplier ? 'gr.suppliersTitle' : 'gr.transportersTitle')}
        subtitle={t(isSupplier ? 'gr.suppliersSubtitle' : 'gr.transportersSubtitle')}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t(isSupplier ? 'gr.addSupplier' : 'gr.addTransporter')}
          </Button>
        }
      />

      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      <div className="mb-3">
        <Checkbox
          label={t('gr.showInactive')}
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={t(isSupplier ? 'gr.suppliersTitle' : 'gr.transportersTitle')}
          icon={
            isSupplier ? (
              <Building2 className="h-5 w-5" aria-hidden />
            ) : (
              <Truck className="h-5 w-5" aria-hidden />
            )
          }
        />
      ) : (
        <ul className="space-y-1.5">
          {visible.map((row) => (
            <li key={row.id}>
              <Card className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium">{row.name}</p>
                  {!row.is_active && (
                    <p className="mt-0.5 text-[12px] text-muted">{t('gr.inactiveNotice')}</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={row.is_active ? 'done' : 'neutral'}>
                    {t(row.is_active ? 'gr.active' : 'gr.inactive')}
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(row)}>
                    {t('gr.rename')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => toggleActive(row)}
                  >
                    {t(row.is_active ? 'gr.deactivate' : 'gr.reactivate')}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NameDialog
          title={t(isSupplier ? 'gr.addSupplier' : 'gr.addTransporter')}
          onClose={() => setCreating(false)}
          onSubmit={(name) => (isSupplier ? createSupplier({ name }) : createTransporter({ name }))}
        />
      )}

      {renaming && (
        <NameDialog
          title={t('gr.rename')}
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={(name) =>
            isSupplier ? renameSupplier(renaming.id, name) : renameTransporter(renaming.id, name)
          }
        />
      )}
    </>
  );
}

/**
 * Name entry, shared by create and rename.
 *
 * §38: a name colliding with an existing one — in any casing — is REFUSED and
 * named, never merged. Merging two records because their names look alike is
 * exactly the silent decision that requirement forbids.
 */
function NameDialog({
  title,
  initial = '',
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = useReceptionError();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={name.trim().length === 0}
            onClick={() =>
              startTransition(async () => {
                const res = await onSubmit(name.trim());
                if (!res.ok) setError(translateError(res.error ?? 'invalid_name'));
                else {
                  onClose();
                  router.refresh();
                }
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('gr.name')} required error={error ?? undefined}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}
