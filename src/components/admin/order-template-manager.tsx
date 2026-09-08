'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/shell/app-shell';
import { deleteOrderRequestTemplate, saveOrderRequestTemplate } from '@/server/import-actions';
import type { TemplateWithCustomer } from '@/server/order-import';
import type { Customer } from '@/types/orders';

/**
 * Order Request template administration.
 *
 * A practical configuration form rather than a visual spreadsheet mapper: the
 * fields are the ones the importer actually reads, and a person who has the
 * customer's file open beside them can fill them in from it. A drag-and-drop
 * column picker would be a project of its own and would not read one more
 * file than this does.
 *
 * Lives under /admin with the other order configuration, gated by the
 * capability the delivery methods and recurring templates already use —
 * orders.manage_config. No new permission was introduced.
 */
export function OrderTemplateManager({
  templates,
  customers,
}: {
  templates: TemplateWithCustomer[];
  customers: Customer[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<TemplateWithCustomer | null>(null);
  const [creating, setCreating] = useState(false);

  const byCustomer = new Map<string, TemplateWithCustomer[]>();
  for (const tpl of templates) {
    const list = byCustomer.get(tpl.customer.name);
    if (list) list.push(tpl);
    else byCustomer.set(tpl.customer.name, [tpl]);
  }

  return (
    <>
      <PageHeader
        title={t('import.tplTitle')}
        subtitle={t('import.tplSubtitle')}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('import.tplNew')}
          </Button>
        }
      />

      {templates.length === 0 ? (
        <EmptyState title={t('import.tplNone')} body={t('import.tplNoneBody')} />
      ) : (
        <div className="space-y-4">
          {[...byCustomer.entries()].map(([customer, list]) => (
            <section key={customer}>
              <h2 className="mb-1.5 px-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                {customer}
              </h2>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-border">
                  {list.map((tpl) => (
                    <li key={tpl.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium">{tpl.name}</p>
                        <p className="truncate text-[11.5px] text-muted">
                          {tpl.sheet_name ?? t('import.tplSheetHint')} · {tpl.product_column} /{' '}
                          {tpl.quantity_column}
                        </p>
                      </div>
                      <Badge tone={tpl.is_active ? 'done' : 'neutral'}>
                        {tpl.is_active ? t('status.active') : t('status.inactive')}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditing(tpl)}
                        aria-label={t('common.edit')}
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
      )}

      {(creating || editing) && (
        <TemplateDialog
          key={editing?.id ?? 'new'}
          template={editing}
          customers={customers}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function TemplateDialog({
  template,
  customers,
  onClose,
  onSaved,
}: {
  template: TemplateWithCustomer | null;
  customers: Customer[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [customerId, setCustomerId] = useState(template?.customer_id ?? '');
  const [name, setName] = useState(template?.name ?? '');
  const [sheetName, setSheetName] = useState(template?.sheet_name ?? '');
  const [headerRow, setHeaderRow] = useState(template ? String(template.header_row ?? '') : '1');
  const [firstDataRow, setFirstDataRow] = useState(String(template?.first_data_row ?? 2));
  const [productColumn, setProductColumn] = useState(template?.product_column ?? '');
  const [quantityColumn, setQuantityColumn] = useState(template?.quantity_column ?? '');
  const [notesColumn, setNotesColumn] = useState(template?.notes_column ?? '');
  const [unitColumn, setUnitColumn] = useState(template?.unit_column ?? '');
  const [defaultUnit, setDefaultUnit] = useState<'unit' | 'box'>(template?.default_unit ?? 'unit');
  const [signature, setSignature] = useState((template?.header_signature ?? []).join(', '));
  const [active, setActive] = useState(template?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveOrderRequestTemplate(
        {
          customer_id: customerId,
          name: name.trim(),
          sheet_name: sheetName.trim() || null,
          header_row: headerRow.trim() ? Number(headerRow) : null,
          first_data_row: Number(firstDataRow) || 1,
          product_column: productColumn.trim(),
          quantity_column: quantityColumn.trim(),
          notes_column: notesColumn.trim() || null,
          unit_column: unitColumn.trim() || null,
          default_unit: defaultUnit,
          // Comma-separated in the field because that is how a person reads a
          // list of column titles off a spreadsheet.
          header_signature: signature.split(',').map((s) => s.trim()).filter(Boolean),
          is_active: active,
        },
        template?.id,
      );
      if (!res.ok) {
        const map: Record<string, string> = {
          header_row_required: t('import.tplErrHeaderRow'),
          invalid_template: t('import.tplErrInvalid'),
          not_authorized: t('import.errNotAuthorized'),
        };
        return setError(map[res.error] ?? t('import.tplErrSave'));
      }
      onSaved();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={template ? t('import.tplEdit') : t('import.tplNew')}
      className="max-w-xl"
      footer={
        <>
          {template && (
            <Button
              variant="ghost"
              className="mr-auto text-late hover:bg-late/10 hover:text-late"
              onClick={() => setDeleteOpen(true)}
              disabled={pending}
            >
              {t('import.tplDelete')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={pending}
            disabled={!customerId || !name.trim() || !productColumn.trim() || !quantityColumn.trim()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label={t('orders.customer')} required htmlFor="tpl-customer">
          <Combobox
            id="tpl-customer"
            items={customers}
            value={customerId || null}
            onChange={(id) => setCustomerId(id ?? '')}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            getSearchText={(c) => `${c.company_name} ${c.company_name_addition ?? ''}`}
            placeholder={t('orders.searchCustomer')}
            emptyMessage={t('orders.noCustomersFound')}
          />
        </Field>

        <Field label={t('import.tplName')} required htmlFor="tpl-name">
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('import.tplSheet')} hint={t('import.tplSheetHint')} htmlFor="tpl-sheet">
            <Input id="tpl-sheet" value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
          </Field>
          <Field label={t('import.tplHeaderRow')} hint={t('import.tplHeaderRowHint')} htmlFor="tpl-hrow">
            <Input
              id="tpl-hrow"
              type="number"
              min="1"
              value={headerRow}
              onChange={(e) => setHeaderRow(e.target.value)}
            />
          </Field>
          <Field
            label={t('import.tplFirstDataRow')}
            hint={t('import.tplFirstDataRowHint')}
            htmlFor="tpl-frow"
          >
            <Input
              id="tpl-frow"
              type="number"
              min="1"
              value={firstDataRow}
              onChange={(e) => setFirstDataRow(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={t('import.tplProductColumn')}
            hint={t('import.tplColumnHint')}
            required
            htmlFor="tpl-pcol"
          >
            <Input id="tpl-pcol" value={productColumn} onChange={(e) => setProductColumn(e.target.value)} />
          </Field>
          <Field
            label={t('import.tplQuantityColumn')}
            hint={t('import.tplColumnHint')}
            required
            htmlFor="tpl-qcol"
          >
            <Input id="tpl-qcol" value={quantityColumn} onChange={(e) => setQuantityColumn(e.target.value)} />
          </Field>
          <Field label={t('import.tplNotesColumn')} htmlFor="tpl-ncol">
            <Input id="tpl-ncol" value={notesColumn} onChange={(e) => setNotesColumn(e.target.value)} />
          </Field>
          <Field label={t('import.tplUnitColumn')} htmlFor="tpl-ucol">
            <Input id="tpl-ucol" value={unitColumn} onChange={(e) => setUnitColumn(e.target.value)} />
          </Field>
        </div>

        <Field
          label={t('import.tplDefaultUnit')}
          hint={t('import.tplDefaultUnitHint')}
          htmlFor="tpl-unit"
        >
          <Select
            id="tpl-unit"
            value={defaultUnit}
            onChange={(e) => setDefaultUnit(e.target.value as 'unit' | 'box')}
          >
            <option value="unit">{t('import.tplUnitOptionUnit')}</option>
            <option value="box">{t('import.tplUnitOptionBox')}</option>
          </Select>
        </Field>

        <Field label={t('import.tplSignature')} hint={t('import.tplSignatureHint')} htmlFor="tpl-sig">
          <Input id="tpl-sig" value={signature} onChange={(e) => setSignature(e.target.value)} />
        </Field>

        <Checkbox
          label={t('status.active')}
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />

        {error && <ErrorState message={error} />}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() =>
          startTransition(async () => {
            if (!template) return;
            const res = await deleteOrderRequestTemplate(template.id);
            if (!res.ok) return setError(t('import.tplErrSave'));
            setDeleteOpen(false);
            onSaved();
          })
        }
        title={t('import.tplDelete')}
        message={t('import.tplDeleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={pending}
      />
    </Dialog>
  );
}
