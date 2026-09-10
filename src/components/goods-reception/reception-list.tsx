'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Camera, Download, Filter, Plus, Search, Truck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/app-shell';
import { StatusChip } from '@/components/ui/status-chip';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  ReadOnlyNotice,
  Select,
} from '@/components/ui/primitives';
import {
  QUANTITY_CHECKS,
  RECEPTION_CONDITIONS,
  RECEPTION_STATUSES,
} from '@/domain/goods-reception/vocabulary';
import type {
  ReceptionListItem,
  ReceptionPage,
  Supplier,
  Transporter,
} from '@/types/goods-reception';
import { ReceptionForm } from './reception-form';
import { useReceptionLabels, useReceptionTime } from './reception-bits';

/**
 * The reception list.
 *
 * Filters live in the URL rather than in component state, so a filtered view
 * is a link somebody can send — and so the export route can be handed the
 * same query string and produce exactly the file the screen is showing.
 *
 * Every filter is applied in SQL. §54: thousands of receptions are not pulled
 * into the browser to be filtered there.
 */
export function ReceptionList({
  page,
  suppliers,
  transporters,
  receivers,
  canCreate,
  canExport,
  isAssignee,
}: {
  page: ReceptionPage;
  suppliers: Supplier[];
  transporters: Transporter[];
  receivers: { id: string; name: string | null; email: string }[];
  canCreate: boolean;
  canExport: boolean;
  /** Distinguishes "not assigned" from "assigned but nothing to show yet". */
  isAssignee: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const query = params.toString();
  const filtered = [...params.keys()].some((k) => k !== 'page');

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Any filter change returns to the first page: staying on page 4 of a
    // result set that now has one page shows an empty screen.
    next.delete('page');
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  const lastPage = Math.max(1, Math.ceil(page.total / page.pageSize));

  return (
    <>
      <PageHeader
        title={t('gr.title')}
        subtitle={t('gr.subtitle')}
        action={
          canCreate ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('gr.newReception')}
            </Button>
          ) : undefined
        }
      />

      {/* §11 makes everyone a reader. Saying WHY the New button is missing is
          what stops that reading as a broken screen. */}
      {!canCreate && !isAssignee && (
        <ReadOnlyNotice
          title={t('gr.notAssignedTitle')}
          reason={t('gr.notAssignedBody')}
        />
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <Input
            className="pl-9"
            placeholder={t('gr.search')}
            defaultValue={params.get('q') ?? ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setParam('q', (e.target as HTMLInputElement).value.trim());
            }}
            onBlur={(e) => setParam('q', e.target.value.trim())}
            aria-label={t('gr.search')}
          />
        </div>

        <Button
          variant={showFilters || filtered ? 'primary' : 'secondary'}
          onClick={() => setShowFilters((v) => !v)}
        >
          <Filter className="h-4 w-4" aria-hidden />
          {t('gr.filters')}
        </Button>

        {canExport && (
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = `/goods-reception/export${query ? `?${query}` : ''}`;
            }}
          >
            <Download className="h-4 w-4" aria-hidden />
            {t('gr.export')}
          </Button>
        )}
      </div>

      {showFilters && (
        <Card className="mb-3 p-3.5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('gr.dateFrom')}>
              <Input
                type="date"
                defaultValue={params.get('from') ?? ''}
                onChange={(e) => setParam('from', e.target.value)}
              />
            </Field>
            <Field label={t('gr.dateTo')}>
              <Input
                type="date"
                defaultValue={params.get('to') ?? ''}
                onChange={(e) => setParam('to', e.target.value)}
              />
            </Field>
            <Field label={t('gr.supplier')}>
              <Select
                value={params.get('supplier') ?? ''}
                onChange={(e) => setParam('supplier', e.target.value)}
              >
                <option value="">{t('gr.all')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('gr.transporter')}>
              <Select
                value={params.get('transporter') ?? ''}
                onChange={(e) => setParam('transporter', e.target.value)}
              >
                <option value="">{t('gr.all')}</option>
                {transporters.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('gr.receivedBy')}>
              <Select
                value={params.get('receiver') ?? ''}
                onChange={(e) => setParam('receiver', e.target.value)}
              >
                <option value="">{t('gr.all')}</option>
                {receivers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name ?? r.email}
                  </option>
                ))}
              </Select>
            </Field>
            <StatusFilter value={params.get('status') ?? ''} onChange={(v) => setParam('status', v)} />
            <ConditionFilter value={params.get('condition') ?? ''} onChange={(v) => setParam('condition', v)} />
            <QuantityFilter value={params.get('quantity') ?? ''} onChange={(v) => setParam('quantity', v)} />
            <Field label={t('gr.hasIncidents')}>
              <Select
                value={params.get('incidents') ?? ''}
                onChange={(e) => setParam('incidents', e.target.value)}
              >
                <option value="">{t('gr.all')}</option>
                <option value="with">{t('gr.withIncidents')}</option>
                <option value="without">{t('gr.withoutIncidents')}</option>
              </Select>
            </Field>
          </div>
        </Card>
      )}

      {page.rows.length === 0 ? (
        <EmptyState
          title={filtered ? t('gr.noResults') : t('gr.empty')}
          body={filtered ? undefined : t('gr.emptyBody')}
          icon={<Truck className="h-5 w-5" aria-hidden />}
        />
      ) : (
        <ul className="space-y-1.5">
          {page.rows.map((row) => (
            <li key={row.id}>
              <ReceptionRow row={row} />
            </li>
          ))}
        </ul>
      )}

      {page.total > page.pageSize && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[12.5px] text-muted">
            {t('gr.showing', { shown: page.rows.length, total: page.total })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page.page <= 1}
              onClick={() => setParam('page', String(page.page - 1))}
            >
              {t('gr.previous')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page.page >= lastPage}
              onClick={() => setParam('page', String(page.page + 1))}
            >
              {t('gr.next')}
            </Button>
          </div>
        </div>
      )}

      {creating && (
        <ReceptionForm
          suppliers={suppliers}
          transporters={transporters}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

/** One row. Touch target is the whole card — §50, this is used on a phone. */
function ReceptionRow({ row }: { row: ReceptionListItem }) {
  const { t } = useI18n();
  const { date, time } = useReceptionTime();

  return (
    <Link href={`/goods-reception/${row.id}`} className="block">
      <Card className="p-3 transition-colors hover:border-accent/40 hover:bg-surface-2/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-semibold">{row.reception_number}</span>
              <StatusChip domain="reception" status={row.status} />
              {row.condition && <StatusChip domain="condition" status={row.condition} />}
              {row.quantity_check !== 'not_checked' && (
                <StatusChip domain="quantity" status={row.quantity_check} />
              )}
            </div>

            <p className="mt-1 truncate text-[13.5px] font-medium">
              {row.supplier?.name ?? t('gr.notRecorded')}
            </p>

            <p className="mt-0.5 truncate text-[12px] text-muted">
              {date(row.received_at)} · {time(row.received_at)}
              {row.transporter ? ` · ${row.transporter.name}` : ''}
              {row.delivery_note ? ` · ${row.delivery_note}` : ''}
            </p>

            <p className="mt-0.5 truncate text-[11.5px] text-subtle">
              {row.receiver?.name ?? row.receiver?.email ?? ''}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            {row.incident_count > 0 && (
              <Badge tone="late">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {row.incident_count}
              </Badge>
            )}
            {row.exception_count > 0 && (
              <Badge tone="warn">
                <Camera className="h-3 w-3" aria-hidden />
                {row.exception_count}
              </Badge>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

/* The two filters whose options need translated labels rather than raw enum
   values. Split out because an <option> cannot hold a component. */

function ConditionFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const labels = useReceptionLabels();
  return (
    <Field label={t('gr.condition')}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('gr.all')}</option>
        {RECEPTION_CONDITIONS.map((c) => (
          <option key={c} value={c}>
            {labels.condition(c)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function QuantityFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const labels = useReceptionLabels();
  return (
    <Field label={t('gr.quantityCheck')}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('gr.all')}</option>
        {QUANTITY_CHECKS.map((q) => (
          <option key={q} value={q}>
            {labels.quantity(q)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function StatusFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const labels = useReceptionLabels();
  return (
    <Field label={t('gr.status')}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('gr.all')}</option>
        {RECEPTION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {labels.status(s)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
