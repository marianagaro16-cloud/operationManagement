'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, Plus, Printer, Trash2 } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Card, Checkbox, ErrorState, Field, Input } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { planLot, planTotals } from '@/domain/production-plan/plan';
import {
  addPlanRow,
  deletePlanRow,
  deleteProductionPlan,
  importPlanOrders,
  savePlanDetails,
  setPlanQuantity,
  updatePlanRow,
} from '@/server/production-plan-actions';
import type { LineProduct, PlanRow, ProductionLine, ProductionPlan } from '@/server/production-plans';
import { PlanSheet } from './plan-sheet';
import { PlanFigures } from './plan-figures';

const KNOWN_ERRORS = new Set(['not_authorized', 'plan_exists', 'row_needs_name', 'invalid']);

export function usePlanError() {
  const { t } = useI18n();
  return (code: string) => (KNOWN_ERRORS.has(code) ? t(`productionPlans.error.${code}` as MessageKey) : code);
}

/** One plan: its figures, the sheet, notes and corn lots. Planners edit; everyone else reads. */
export function PlanView({
  line,
  products,
  plan,
  editable,
  customers,
}: {
  line: ProductionLine;
  products: LineProduct[];
  plan: ProductionPlan;
  editable: boolean;
  customers: { id: string; name: string }[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const translateError = usePlanError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [onlyFilled, setOnlyFilled] = useState(!editable);
  const [rowDialog, setRowDialog] = useState<PlanRow | 'new' | null>(null);
  const [deletingRow, setDeletingRow] = useState<PlanRow | null>(null);
  const [deletingPlan, setDeletingPlan] = useState(false);

  // Cells change the totals at once; the server's copy replaces this on refresh.
  const [rows, setRows] = useState(plan.rows);
  const [seen, setSeen] = useState(plan);
  if (plan !== seen) {
    setSeen(plan);
    setRows(plan.rows);
  }
  const totals = useMemo(() => planTotals(products, rows, line), [products, rows, line]);
  const lot = planLot(plan.plan_date);

  function run(task: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await task();
      if (!res.ok) setError(translateError(res.error ?? 'unknown'));
      else {
        after?.();
        router.refresh();
      }
    });
  }

  function saveCell(row: PlanRow, productId: string, value: number | null) {
    setRows((all) =>
      all.map((r) => {
        if (r.id !== row.id) return r;
        const quantities = { ...r.quantities };
        if (value) quantities[productId] = value;
        else delete quantities[productId];
        return { ...r, quantities };
      }),
    );
    run(() => setPlanQuantity(plan.id, row.id, productId, value));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/production-plans" className="mb-1 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {t('productionPlans.title')}
          </Link>
          <h1 className="text-xl font-semibold leading-tight">
            {line.name}{line.machine ? ` · ${line.machine}` : ''}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {formatDate(plan.plan_date, 'weekday')} · {t('productionPlans.lot')} {lot}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const res = await importPlanOrders(plan.id);
                  if (res.ok) setNotice(res.data.added ? t('productionPlans.ordersAdded', { count: res.data.added }) : t('productionPlans.noNewOrders'));
                  return res;
                })
              }
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t('productionPlans.importOrders')}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => window.open(`/print/production-plans/${plan.id}`, '_blank')}>
            <Printer className="h-3.5 w-3.5" aria-hidden />
            {t('productionPlans.print')}
          </Button>
          {editable && (
            <Button size="sm" variant="ghost" onClick={() => setDeletingPlan(true)} aria-label={t('productionPlans.deletePlan')}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {error && <ErrorState message={error} />}
      {notice && (
        <p className="rounded-lg border border-done/30 bg-done/[0.08] px-3 py-2 text-[12.5px] text-done">{notice}</p>
      )}

      <Card className="p-3 sm:p-4">
        <PlanFigures lot={lot} totals={totals} products={products} />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Checkbox label={t('productionPlans.onlyFilled')} checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} />
        {editable && (
          <Button size="sm" variant="primary" onClick={() => setRowDialog('new')}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('productionPlans.addRow')}
          </Button>
        )}
      </div>

      <PlanSheet
        planDate={plan.plan_date}
        products={products}
        rows={rows}
        totals={totals}
        onlyFilled={onlyFilled}
        editable={editable}
        onCell={saveCell}
        onEditRow={(row) => setRowDialog(row)}
        onDeleteRow={(row) => setDeletingRow(row)}
      />

      <DetailsCard plan={plan} line={line} editable={editable} />

      {rowDialog && (
        <RowDialog
          planId={plan.id}
          row={rowDialog === 'new' ? null : rowDialog}
          customers={customers}
          onClose={() => setRowDialog(null)}
        />
      )}

      <ConfirmDialog
        open={deletingRow !== null}
        onClose={() => setDeletingRow(null)}
        onConfirm={() => deletingRow && run(() => deletePlanRow(plan.id, deletingRow.id), () => setDeletingRow(null))}
        title={t('productionPlans.deleteRow')}
        message={t('productionPlans.deleteRowConfirm', { name: deletingRow?.customer_name ?? deletingRow?.label ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={pending}
      />
      <ConfirmDialog
        open={deletingPlan}
        onClose={() => setDeletingPlan(false)}
        onConfirm={() => run(() => deleteProductionPlan(plan.id), () => router.push('/production-plans'))}
        title={t('productionPlans.deletePlan')}
        message={t('productionPlans.deletePlanConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={pending}
      />
    </div>
  );
}

/** A customer row: from the customer list or typed, with its delivery day and how it goes. */
function RowDialog({
  planId,
  row,
  customers,
  onClose,
}: {
  planId: string;
  row: PlanRow | null;
  customers: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = usePlanError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(row?.customer_id ?? null);
  const [label, setLabel] = useState(row?.label ?? '');
  const [deliveryDate, setDeliveryDate] = useState(row?.delivery_date ?? '');
  const [deliveryNote, setDeliveryNote] = useState(row?.delivery_note ?? '');

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? t('productionPlans.editRow') : t('productionPlans.addRow')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!customerId && !label.trim()}
            onClick={() =>
              startTransition(async () => {
                const input = { customer_id: customerId, label: label.trim() || null, delivery_date: deliveryDate || null, delivery_note: deliveryNote.trim() || null };
                const res = row ? await updatePlanRow(planId, row.id, input) : await addPlanRow(planId, input);
                if (!res.ok) return setError(translateError(res.error));
                onClose();
                router.refresh();
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('productionPlans.customer')} hint={t('productionPlans.customerHint')}>
          <Combobox
            items={customers}
            value={customerId}
            onChange={setCustomerId}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            getSearchText={(c) => c.name}
            clearable
            placeholder={t('productionPlans.pickCustomer')}
          />
        </Field>
        <Field label={t('productionPlans.rowLabel')} hint={t('productionPlans.rowLabelHint')}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('productionPlans.deliveryDate')}>
            <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </Field>
          <Field label={t('productionPlans.deliveryNote')}>
            <Input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} placeholder={t('productionPlans.deliveryNotePlaceholder')} />
          </Field>
        </div>
        {row && row.order_ids.length > 0 && (
          <p className="text-[12px] text-muted">{t('productionPlans.fromOrders', { count: row.order_ids.length })}</p>
        )}
        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}

/** Notes, the corn and its lots, and the line's standing notes. */
function DetailsCard({ plan, line, editable }: { plan: ProductionPlan; line: ProductionLine; editable: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = usePlanError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [notes, setNotes] = useState(plan.notes ?? '');
  const [lots, setLots] = useState(plan.corn_lots.length ? plan.corn_lots : [{ corn: '', lot: '' }]);

  return (
    <Card className="space-y-3 p-3 sm:p-4">
      <div>
        <h3 className="mb-1.5 text-[14px] font-semibold">{t('productionPlans.cornLots')}</h3>
        {editable ? (
          <div className="space-y-1.5">
            {lots.map((l, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <Input
                  aria-label={t('productionPlans.corn')}
                  placeholder={t('productionPlans.cornPlaceholder')}
                  value={l.corn}
                  onChange={(e) => { setSaved(false); setLots((all) => all.map((x, j) => (j === i ? { ...x, corn: e.target.value } : x))); }}
                />
                <Input
                  aria-label={t('productionPlans.lot')}
                  placeholder={t('productionPlans.lot')}
                  value={l.lot}
                  onChange={(e) => { setSaved(false); setLots((all) => all.map((x, j) => (j === i ? { ...x, lot: e.target.value } : x))); }}
                />
              </div>
            ))}
            <button type="button" className="text-[12.5px] font-medium text-accent hover:underline" onClick={() => setLots((all) => [...all, { corn: '', lot: '' }])}>
              {t('productionPlans.addCorn')}
            </button>
          </div>
        ) : plan.corn_lots.length ? (
          <ul className="text-[13px]">
            {plan.corn_lots.map((l, i) => <li key={i}>{l.corn} · <span className="tabular-nums">{l.lot}</span></li>)}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">—</p>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-[14px] font-semibold">{t('productionPlans.notes')}</h3>
        {editable ? (
          <NoteTextarea value={notes} onChange={(e) => { setSaved(false); setNotes(e.target.value); }} rows={3} />
        ) : (
          <NoteText text={plan.notes || '—'} className="text-[13px]" />
        )}
      </div>

      {editable && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await savePlanDetails(plan.id, { notes: notes.trim() || null, corn_lots: lots.map((l) => ({ corn: l.corn.trim(), lot: l.lot.trim() })) });
                if (!res.ok) return setError(translateError(res.error));
                setError(null);
                setSaved(true);
                router.refresh();
              })
            }
          >
            {t('common.save')}
          </Button>
          {saved && <span className="text-[12px] text-done">{t('productionPlans.saved')}</span>}
          {error && <span className="text-[12px] text-late">{error}</span>}
        </div>
      )}

      {line.standing_notes && (
        <div className="rounded-lg bg-surface-2 p-2.5">
          <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('productionPlans.standingNotes')}</p>
          <NoteText text={line.standing_notes} className="text-[12.5px]" />
        </div>
      )}
    </Card>
  );
}
