'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, ErrorState, Field, Input } from '@/components/ui/primitives';
import { saveInventoryLocation } from '@/server/inventory-actions';
import { useInventoryError } from '@/components/inventory/inventory-bits';
import type { InventoryLocation } from '@/types/inventory';

/**
 * Counting locations for packaging inventories.
 *
 * "Lager 4to Piso" and "Fábrica" are seed data, not code — a third location
 * is a row an admin adds here, never a migration. Deactivating one keeps every
 * historical count that used it readable, because each entry stores the
 * location name it was recorded against.
 */
export function InventoryLocationManager({ locations }: { locations: InventoryLocation[] }) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [editing, setEditing] = useState<InventoryLocation | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{t('inventory.locations')}</h2>
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('inventory.locationNew')}
        </Button>
      </div>

      {error && <ErrorState message={error} />}

      <ul className="space-y-1.5">
        {locations.map((loc) => (
          <li key={loc.id}>
            <Card className={cn('flex items-center gap-2 p-2.5', !loc.is_active && 'bg-surface-2/40')}>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">{loc.name}</p>
                <p className="text-[11.5px] text-subtle">{loc.slug}</p>
              </div>
              {!loc.is_active && <Badge tone="neutral">{t('status.inactive')}</Badge>}
              <Button size="sm" variant="ghost" onClick={() => setEditing(loc)}>
                {t('common.edit')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await saveInventoryLocation(
                      {
                        slug: loc.slug,
                        name: loc.name,
                        sort_order: loc.sort_order,
                        is_active: !loc.is_active,
                      },
                      loc.id,
                    );
                    if (!res.ok) setError(translateError(res.error));
                  })
                }
              >
                {loc.is_active ? t('inventory.deactivate') : t('inventory.activate')}
              </Button>
            </Card>
          </li>
        ))}
      </ul>

      {(creating || editing) && (
        <LocationDialog
          location={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function LocationDialog({
  location,
  onClose,
}: {
  location: InventoryLocation | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [name, setName] = useState(location?.name ?? '');
  const [slug, setSlug] = useState(location?.slug ?? '');
  const [sortOrder, setSortOrder] = useState(location?.sort_order ?? 100);
  const [isActive, setIsActive] = useState(location?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open
      onClose={onClose}
      title={location ? t('common.edit') : t('inventory.locationNew')}
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
                const res = await saveInventoryLocation(
                  {
                    slug: slug.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                    name: name.trim(),
                    sort_order: sortOrder,
                    is_active: isActive,
                  },
                  location?.id,
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
        <Field label={t('inventory.location')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('inventory.sortOrder')}>
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value) || 100)}
          />
        </Field>
        <Checkbox
          label={t('status.active')}
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
