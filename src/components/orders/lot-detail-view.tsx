'use client';

import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Badge, Card, CardBody } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/app-shell';
import type { LotAllocationRow } from '@/server/lot-tracker';

interface HistoryEntry {
  id: string;
  action: string;
  created_at: string;
  actor: string | null;
  detail: Record<string, unknown> | null;
}

/**
 * Where this lot was used.
 *
 * Read-only, deliberately. A wrong allocation is corrected in the order it
 * belongs to — Open Order leads there — so that Lotnummerkontrol stays the one
 * place lot data is written. Adding an edit control here would create a second
 * path to the same record and, with it, a second source of truth.
 */
export function LotDetailView({
  lotNumber,
  detail,
  history,
}: {
  lotNumber: string;
  detail: {
    rows: LotAllocationRow[];
    totalQuantity: number;
    orderCount: number;
    customerCount: number;
    productCount: number;
  };
  history: HistoryEntry[];
}) {
  const { t, formatDate } = useI18n();

  const when = (iso: string) => `${formatDate(iso.slice(0, 10), 'short')} ${iso.slice(11, 16)}`;

  /** One audit row as a sentence, rather than raw jsonb. */
  function describe(entry: HistoryEntry): string {
    const d = entry.detail ?? {};
    const before = (d.before ?? {}) as Record<string, unknown>;
    const after = (d.after ?? {}) as Record<string, unknown>;

    switch (entry.action) {
      case 'lot_added':
        return t('lot.histAdded', { lot: String(d.lot_number ?? ''), qty: String(d.quantity ?? '') });
      case 'lot_removed':
        return t('lot.histRemoved', { lot: String(d.lot_number ?? ''), qty: String(d.quantity ?? '') });
      case 'lot_changed': {
        if (before.lot_number !== after.lot_number) {
          return t('lot.histRenamed', {
            from: String(before.lot_number ?? ''),
            to: String(after.lot_number ?? ''),
          });
        }
        return t('lot.histQuantity', {
          from: String(before.quantity ?? ''),
          to: String(after.quantity ?? ''),
        });
      }
      default:
        return entry.action;
    }
  }

  return (
    <>
      <div className="mb-3">
        <Link
          href="/lot-tracker"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {t('lot.title')}
        </Link>
      </div>

      <PageHeader title={lotNumber} subtitle={t('lot.detailSubtitle')} />

      {/* The four numbers that answer "where was this used". Total quantity is
          the sum of these allocations — NOT a remaining stock figure, which
          this module deliberately does not compute. */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label={t('lot.totalQuantity')} value={String(detail.totalQuantity)} accent />
        <Stat label={t('lot.orders')} value={String(detail.orderCount)} />
        <Stat label={t('lot.customers')} value={String(detail.customerCount)} />
        <Stat label={t('lot.products')} value={String(detail.productCount)} />
      </div>

      <h2 className="mb-2 text-[13px] font-semibold">{t('lot.allocations')}</h2>
      <ul className="space-y-2">
        {detail.rows.map((r) => (
          <li key={r.id}>
            <Card className="p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">{r.product_name}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {r.product_code ? `${r.product_code} · ` : ''}
                    {r.customer_name}
                    {r.customer_addition ? ` · ${r.customer_addition}` : ''}
                    {!r.customer_active && (
                      <> · <Badge tone="neutral">{t('status.inactive')}</Badge></>
                    )}
                  </p>
                </div>
                <span className="shrink-0 text-[17px] font-semibold tabular-nums">{r.quantity}</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-subtle">
                <span className="tabular-nums">
                  {t('lot.preparation')}: {formatDate(r.preparation_date, 'short')}
                </span>
                <span className="tabular-nums">
                  {t('lot.delivery')}: {formatDate(r.delivery_date, 'short')}
                </span>
                {r.entered_by && <span>{t('lot.enteredBy')}: {r.entered_by}</span>}
              </div>

              {/* The only way out of this screen: corrections happen in the
                  order, through the existing workflow. */}
              <div className="mt-2.5">
                <Link href={`/orders/${r.order_id}`}>
                  <Button size="sm" variant="secondary">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    {t('lot.openOrder', { ref: String(r.order_reference) })}
                  </Button>
                </Link>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <h2 className="mb-2 mt-6 text-[13px] font-semibold">{t('lot.history')}</h2>
      {history.length === 0 ? (
        <Card>
          <CardBody className="pt-4">
            <p className="text-[12.5px] text-muted">{t('lot.noHistory')}</p>
          </CardBody>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {history.map((h) => (
              <li key={h.id} className="px-3.5 py-2.5">
                <p className="text-[13px]">{describe(h)}</p>
                <p className="mt-0.5 text-[11.5px] text-subtle">
                  {h.actor ?? t('lot.systemActor')} · <span className="tabular-nums">{when(h.created_at)}</span>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className="px-3.5 py-3">
      <p className="text-[11.5px] font-medium text-muted">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${accent ? 'text-accent' : 'text-fg'}`}>
        {value}
      </p>
    </Card>
  );
}
