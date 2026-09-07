'use client';

import { useState, useTransition } from 'react';
import { ChevronDown, CircleSlash, History, MessageSquare, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn, displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Field, Input, Textarea } from '@/components/ui/primitives';
import { countState, physicalStock } from '@/domain/inventory/calc';
import {
  addInventoryComment,
  markInventoryItemEmpty,
  resolveInventoryItem,
  setInventoryDigital,
} from '@/server/inventory-actions';
import { DifferenceValue, DigitalPendingBadge, StatusBadge, useInventoryError } from './inventory-bits';
import { EntryRows } from './entry-rows';
import type { InventoryItemDetail, InventoryKind, InventoryLocation } from '@/types/inventory';

/**
 * One counted line.
 *
 * Collapsed it shows the three numbers that matter — Physical Stock,
 * Inventory Digital, Difference — and expands into the entry rows. On a phone
 * that keeps a 114-item count navigable, instead of a wall of inputs.
 */
export function ItemCard({
  item,
  instanceId,
  kind,
  digitalEnabled,
  locations,
  canEdit,
  canManage,
  defaultOpen,
}: {
  item: InventoryItemDetail;
  instanceId: string;
  kind: InventoryKind;
  digitalEnabled: boolean;
  locations: InventoryLocation[];
  canEdit: boolean;
  canManage: boolean;
  defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [digitalOpen, setDigitalOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);

  const [markingEmpty, startMarkEmpty] = useTransition();
  const translateError = useInventoryError();
  const [emptyError, setEmptyError] = useState<string | null>(null);

  // Optimistic stock: the sum updates as soon as a quantity is committed, so
  // the counter sees their own arithmetic immediately. The server value wins
  // as soon as it arrives — this never becomes the stored figure.
  const [localQuantities, setLocalQuantities] = useState<Record<string, number | null>>({});
  const quantities = item.entries.map((e) => ({
    quantity: e.id in localQuantities ? localQuantities[e.id] : e.quantity,
  }));
  const stock = physicalStock(quantities);

  // "Checked, empty" is not the same statement as "nobody has looked yet",
  // even though both sum to zero. See countState().
  const state = countState(quantities);

  function markEmpty() {
    setEmptyError(null);
    startMarkEmpty(async () => {
      const res = await markInventoryItemEmpty(item.id, instanceId);
      if (!res.ok) setEmptyError(translateError(res.error));
    });
  }
  const difference =
    digitalEnabled && item.digital_quantity !== null ? stock - item.digital_quantity : null;
  const digitalPending = digitalEnabled && item.digital_quantity === null;

  return (
    <li
      className={cn(
        'rounded-xl border bg-surface shadow-card',
        item.status === 'to_review' ? 'border-late/30' : 'border-border',
      )}
    >
      {/* The toggle and the one-tap zero sit side by side rather than nested:
          a button inside a button is invalid and the inner one never fires. */}
      <div className="flex items-start gap-2 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-start gap-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-snug">{item.item_name}</p>
          {item.item_group && (
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-subtle">{item.item_group}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
            {/* An uncounted line must NOT read "Physical Stock 0" — that is a
                claim about the warehouse nobody has made yet. */}
            {state === 'uncounted' ? (
              <span className="text-subtle">{t('inventory.notCounted')}</span>
            ) : (
              <span className="text-muted">
                {t('inventory.physicalStock')}{' '}
                <strong className="tabular-nums text-fg">{stock}</strong>
              </span>
            )}

            {state === 'none' && <Badge tone="neutral">{t('inventory.emptyBadge')}</Badge>}

            {digitalEnabled &&
              (digitalPending ? (
                <DigitalPendingBadge />
              ) : (
                <>
                  <span className="text-muted">
                    {t('inventory.inventoryDigital')}{' '}
                    <strong className="tabular-nums text-fg">{item.digital_quantity}</strong>
                  </span>
                  <span className="text-muted">
                    {t('inventory.difference')} <DifferenceValue value={difference} />
                  </span>
                </>
              ))}

            {item.entries.length > 0 && (
              <Badge tone="neutral">{item.entries.length}</Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={item.status} />
          <ChevronDown
            className={cn('h-4 w-4 text-subtle transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </div>
      </button>

      {/* One tap to say "I looked, there is none". Only while the line is
          genuinely uncounted: once a number exists this would be ambiguous,
          and the action refuses it server-side anyway. */}
      {canEdit && state === 'uncounted' && (
        <Button
          size="sm"
          variant="secondary"
          onClick={markEmpty}
          loading={markingEmpty}
          className="mt-[2px] shrink-0 whitespace-nowrap"
        >
          <CircleSlash className="h-3.5 w-3.5" aria-hidden />
          {t('inventory.markEmpty')}
        </Button>
      )}
      </div>

      {emptyError && <p className="px-3 pb-2 text-[12px] text-late">{emptyError}</p>}

      {open && (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-3">
          <div>
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-subtle">
              {t('inventory.stockIsCalculated')}
            </p>
            <EntryRows
              kind={kind}
              instanceId={instanceId}
              itemId={item.id}
              entries={item.entries}
              locations={locations}
              disabled={!canEdit}
              onLocalChange={(entryId, quantity) =>
                setLocalQuantities((prev) => ({ ...prev, [entryId]: quantity }))
              }
            />
          </div>

          {/* ---- item comments ---- */}
          {item.comments.length > 0 && (
            <ul className="space-y-1.5 rounded-lg bg-surface-2/40 p-2">
              {item.comments.map((c) => (
                <li key={c.id} className="text-[12.5px]">
                  <span className="font-medium">{c.author ? displayName(c.author) : '—'}</span>
                  <span className="text-muted"> · {c.body}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setCommentOpen(true)}>
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              {t('inventory.addComment')}
            </Button>

            {canManage && digitalEnabled && (
              <Button size="sm" variant="ghost" onClick={() => setDigitalOpen(true)}>
                {t('inventory.setDigital')}
              </Button>
            )}

            {canManage && (item.status === 'to_review' || item.status === 'resolved') && (
              <Button size="sm" variant="ghost" onClick={() => setResolveOpen(true)}>
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                {t('inventory.resolve')}
              </Button>
            )}

            {(item.resolutions.length > 0 || item.digital_history.length > 0) && (
              <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
                <History className="h-3.5 w-3.5" aria-hidden />
                {t('inventory.auditTrail')}
              </Button>
            )}
          </div>
        </div>
      )}

      <CommentDialog
        open={commentOpen}
        onClose={() => setCommentOpen(false)}
        instanceId={instanceId}
        itemId={item.id}
        hint={t('inventory.itemCommentHint')}
      />
      <DigitalDialog
        open={digitalOpen}
        onClose={() => setDigitalOpen(false)}
        item={item}
        instanceId={instanceId}
        stock={stock}
      />
      <ResolveDialog
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        item={item}
        instanceId={instanceId}
      />
      <ItemHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} item={item} />
    </li>
  );
}

/* ------------------------------- dialogs ------------------------------- */

export function CommentDialog({
  open,
  onClose,
  instanceId,
  itemId,
  hint,
}: {
  open: boolean;
  onClose: () => void;
  instanceId: string;
  itemId?: string | null;
  hint: string;
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await addInventoryComment(instanceId, body, itemId ?? null);
      if (res.ok) {
        setBody('');
        onClose();
      } else {
        setError(translateError(res.error));
      }
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('inventory.addComment')}
      description={hint}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!body.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
      {error && <p className="mt-2 text-[12px] text-late">{error}</p>}
    </Dialog>
  );
}

/**
 * Inventory Digital entry. Admin-only, and the value is typed by hand — there
 * is no Bexio integration behind this and none is implied.
 */
function DigitalDialog({
  open,
  onClose,
  item,
  instanceId,
  stock,
}: {
  open: boolean;
  onClose: () => void;
  item: InventoryItemDetail;
  instanceId: string;
  stock: number;
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [value, setValue] = useState(
    item.digital_quantity === null ? '' : String(item.digital_quantity),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = value.trim() === '' ? null : Number(value);
  const preview =
    parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? stock - parsed : null;

  function submit(next: number | null) {
    setError(null);
    startTransition(async () => {
      const res = await setInventoryDigital(item.id, instanceId, next);
      if (res.ok) onClose();
      else setError(translateError(res.error));
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('inventory.setDigital')}
      description={item.item_name}
      footer={
        <>
          {/* Returning to Pending is a real admin action, not a way of
              erasing the record: the previous value stays in the history. */}
          <Button variant="ghost" onClick={() => submit(null)} disabled={pending}>
            {t('inventory.clearDigital')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={value.trim() === '' || !Number.isInteger(Number(value)) || Number(value) < 0}
            onClick={() => submit(Number(value))}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('inventory.inventoryDigital')} hint={t('inventory.quantityInteger')}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus
          className="tabular-nums"
        />
      </Field>

      <dl className="mt-3 space-y-1 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-muted">{t('inventory.physicalStock')}</dt>
          <dd className="tabular-nums font-medium">{stock}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{t('inventory.difference')}</dt>
          <dd>
            <DifferenceValue value={preview} />
          </dd>
        </div>
      </dl>

      {error && <p className="mt-2 text-[12px] text-late">{error}</p>}
    </Dialog>
  );
}

/**
 * Resolution. The difference is allowed to remain non-zero — that is the
 * point of the state — but the reason is mandatory and is stored with the
 * numbers it was given for.
 */
function ResolveDialog({
  open,
  onClose,
  item,
  instanceId,
}: {
  open: boolean;
  onClose: () => void;
  item: InventoryItemDetail;
  instanceId: string;
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!note.trim()) {
      setError(t('inventory.resolutionRequired'));
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await resolveInventoryItem(item.id, instanceId, note);
      if (res.ok) {
        setNote('');
        onClose();
      } else {
        setError(translateError(res.error));
      }
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('inventory.resolveTitle')}
      description={t('inventory.resolveHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!note.trim()}>
            {t('inventory.resolve')}
          </Button>
        </>
      }
    >
      <dl className="mb-3 space-y-1 rounded-lg bg-surface-2/50 p-2.5 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-muted">{t('inventory.physicalStock')}</dt>
          <dd className="tabular-nums font-medium">{item.physical_stock}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{t('inventory.inventoryDigital')}</dt>
          <dd className="tabular-nums font-medium">{item.digital_quantity ?? '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{t('inventory.difference')}</dt>
          <dd>
            <DifferenceValue value={item.difference} />
          </dd>
        </div>
      </dl>

      <Field label={t('inventory.resolutionNote')} required>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Field>

      {error && <p className="mt-2 text-[12px] text-late">{error}</p>}
    </Dialog>
  );
}

/** Everything ever recorded about this line, oldest decision last. */
function ItemHistoryDialog({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  item: InventoryItemDetail;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onClose={onClose} title={t('inventory.auditTrail')} description={item.item_name}>
      {item.resolutions.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-1.5 text-[13px] font-semibold">{t('inventory.resolutionHistory')}</h3>
          <ul className="space-y-2">
            {item.resolutions.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-2 text-[12.5px]">
                <p className="text-fg">{r.note}</p>
                <p className="mt-1 text-muted">
                  {r.author ? displayName(r.author) : '—'} ·{' '}
                  {new Date(r.resolved_at).toLocaleString()} · {t('inventory.difference')}{' '}
                  <DifferenceValue value={r.difference_at} className="text-[12.5px]" />
                </p>
                {r.superseded_at && (
                  <p className="mt-1 text-[11.5px] text-subtle">
                    {t('inventory.resolutionSuperseded')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {item.digital_history.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[13px] font-semibold">{t('inventory.digitalHistory')}</h3>
          <ul className="space-y-1.5">
            {item.digital_history.map((h) => (
              <li key={h.id} className="text-[12.5px] text-muted">
                {t('inventory.changedFromTo', {
                  from: h.previous_digital ?? t('inventory.notSet'),
                  to: h.new_digital ?? t('inventory.notSet'),
                })}{' '}
                · {h.author ? displayName(h.author) : '—'} ·{' '}
                {new Date(h.changed_at).toLocaleString()}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}
