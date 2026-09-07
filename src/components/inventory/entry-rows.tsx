'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/primitives';
import { parseQuantityInput } from '@/domain/inventory/calc';
import {
  addInventoryEntry,
  deleteInventoryEntry,
  updateInventoryEntry,
} from '@/server/inventory-actions';
import { useInventoryError } from './inventory-bits';
import type { InventoryEntry, InventoryKind, InventoryLocation } from '@/types/inventory';

/**
 * The counting surface.
 *
 * This is used one-handed, standing in a cold store, on a phone. So: no
 * horizontal table, no modal per record, no explicit save button. Each record
 * is a row of large touch targets that writes on blur, and "Add entry" creates
 * the next one immediately so the rhythm is type-tab-type.
 *
 * The quantity field is numeric-only by keyboard AND by validation: decimals
 * are rejected rather than rounded, because rounding a miscount into a whole
 * number puts a wrong figure into an audited record.
 */
export function EntryRows({
  kind,
  instanceId,
  itemId,
  entries,
  locations,
  disabled,
  onLocalChange,
}: {
  kind: InventoryKind;
  instanceId: string;
  itemId: string;
  entries: InventoryEntry[];
  locations: InventoryLocation[];
  disabled: boolean;
  /** Lets the parent show the running Physical Stock without a round trip. */
  onLocalChange?: (entryId: string, quantity: number | null) => void;
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await addInventoryEntry({
        instance_item_id: itemId,
        instance_id: instanceId,
        quantity: null,
        // Packaging is counted per place, so a new row starts on the first
        // location rather than forcing a choice before anything can be typed.
        location_id: kind === 'location' ? (locations[0]?.id ?? null) : null,
        position: entries.length,
      });
      if (!res.ok) setError(translateError(res.error));
    });
  }

  return (
    <div className="space-y-2">
      {entries.length === 0 && (
        <p className="text-[12.5px] text-subtle">{t('inventory.noEntries')}</p>
      )}

      {entries.map((entry) => (
        <EntryRow
          key={entry.id}
          kind={kind}
          entry={entry}
          instanceId={instanceId}
          locations={locations}
          disabled={disabled}
          onLocalChange={onLocalChange}
          onError={setError}
        />
      ))}

      {!disabled && (
        <Button size="sm" variant="ghost" onClick={add} loading={pending} className="w-full justify-center">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('inventory.addEntry')}
        </Button>
      )}

      {error && <p className="text-[12px] text-late">{error}</p>}
    </div>
  );
}

function EntryRow({
  kind,
  entry,
  instanceId,
  locations,
  disabled,
  onLocalChange,
  onError,
}: {
  kind: InventoryKind;
  entry: InventoryEntry;
  instanceId: string;
  locations: InventoryLocation[];
  disabled: boolean;
  onLocalChange?: (entryId: string, quantity: number | null) => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [, startTransition] = useTransition();
  const [quantityText, setQuantityText] = useState(
    entry.quantity === null ? '' : String(entry.quantity),
  );
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // A server refresh must not clobber what the person is currently typing.
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setQuantityText(entry.quantity === null ? '' : String(entry.quantity));
  }, [entry.quantity]);

  function save(patch: Record<string, unknown>) {
    onError(null);
    startTransition(async () => {
      const res = await updateInventoryEntry(entry.id, instanceId, patch);
      if (!res.ok) onError(translateError(res.error));
    });
  }

  function commitQuantity() {
    dirty.current = false;
    const parsed = parseQuantityInput(quantityText);
    if (!parsed.ok) {
      setQuantityError(translateError(parsed.error));
      return;
    }
    setQuantityError(null);
    onLocalChange?.(entry.id, parsed.value);
    save({ quantity: parsed.value });
  }

  function remove() {
    setDeleting(true);
    onError(null);
    startTransition(async () => {
      const res = await deleteInventoryEntry(entry.id, instanceId);
      if (!res.ok) {
        setDeleting(false);
        onError(translateError(res.error));
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-2">
      <div className="flex items-start gap-2">
        {/* Quantity is the field people reach for first, so it leads and is
            the widest touch target in the row. */}
        <label className="w-[88px] shrink-0">
          <span className="mb-1 block text-2xs font-medium text-muted">
            {t('inventory.quantity')}
          </span>
          <Input
            value={quantityText}
            onChange={(e) => {
              dirty.current = true;
              setQuantityText(e.target.value);
            }}
            onBlur={commitQuantity}
            disabled={disabled}
            // A numeric keypad with no decimal separator: the control itself
            // makes the invalid input hard to type, and validation catches the
            // rest (pasting, hardware keyboards).
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="0"
            aria-label={t('inventory.quantity')}
            className="text-center text-[15px] tabular-nums"
          />
        </label>

        {kind === 'location' ? (
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-2xs font-medium text-muted">
              {t('inventory.location')}
            </span>
            <Select
              value={entry.location_id ?? ''}
              disabled={disabled}
              onChange={(e) => save({ location_id: e.target.value })}
              aria-label={t('inventory.location')}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-2xs font-medium text-muted">
              {t('inventory.expiryDate')}
            </span>
            <Input
              type="date"
              defaultValue={entry.expiry_date ?? ''}
              disabled={disabled}
              // Optional on purpose: nobody is forced to invent an expiry date
              // to record a quantity they actually counted.
              onChange={(e) => save({ expiry_date: e.target.value || null })}
              aria-label={t('inventory.expiryDate')}
            />
          </label>
        )}

        {!disabled && (
          <Button
            variant="ghost"
            size="icon"
            onClick={remove}
            loading={deleting}
            aria-label={t('inventory.removeEntry')}
            className="mt-[18px] text-muted hover:text-late"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>

      {/* Materia Prima records a lot number alongside the expiry date. */}
      {kind === 'lot' && (
        <label className="mt-2 block">
          <span className="mb-1 block text-2xs font-medium text-muted">
            {t('inventory.lotNumber')}
          </span>
          <Input
            defaultValue={entry.lot_number ?? ''}
            disabled={disabled}
            onBlur={(e) => save({ lot_number: e.target.value.trim() || null })}
            aria-label={t('inventory.lotNumber')}
          />
        </label>
      )}

      <label className="mt-2 block">
        <span className="sr-only">{t('inventory.comment')}</span>
        <Input
          defaultValue={entry.note ?? ''}
          disabled={disabled}
          placeholder={t('inventory.comment')}
          onBlur={(e) => save({ note: e.target.value.trim() || null })}
          className="text-[13px]"
        />
      </label>

      {quantityError && <p className="mt-1 text-[12px] text-late">{quantityError}</p>}
    </div>
  );
}
