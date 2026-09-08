'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { StatusChip } from '@/components/ui/status-chip';
import type { Customer, Product } from '@/types/orders';
import type { IncidentCategory, IncidentListItem, IncidentType } from '@/types/incidents';
import { IncidentDialog, type OrderContext } from './incident-dialog';
import { typeKey } from './incident-list';

/**
 * The incidents attached to something else — an order, a lot.
 *
 * Deliberately a small panel rather than a page: §32 keeps the Lot Nummer
 * Tracker answering "where was this lot used" and Incidents answering "what
 * went wrong", and merging them would blur both. This is a link between the
 * two, not a merge of them.
 */
export function IncidentLinks({
  incidents,
  variant,
  order,
  customers,
  products,
  categories,
  types,
  canManage,
}: {
  incidents: IncidentListItem[];
  /** Decides the heading. The component owns its own wording — a server
   *  page cannot call t(), and passing a literal string would put English
   *  into a Spanish screen. */
  variant: 'order' | 'lot';
  /**
   * Present on an order, which enables "Report incident" with everything the
   * order already knows prefilled — §6 and §31.
   */
  order?: OrderContext;
  customers?: Customer[];
  products?: Product[];
  categories?: IncidentCategory[];
  types?: IncidentType[];
  canManage: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  // Nothing to show and nothing to offer: render nothing rather than an empty
  // card on every order that has never had a problem, which is most of them.
  if (incidents.length === 0 && !(order && canManage)) return null;

  return (
    <>
      <Card>
        <CardHeader className="flex items-center justify-between gap-2 pb-0">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
            {t(variant === 'lot' ? 'incident.onLot' : 'incident.onOrder')}
            {incidents.length > 0 && (
              <span className="ml-1.5 tabular text-fg">{incidents.length}</span>
            )}
          </h2>
          {order && canManage && (
            <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('incident.reportForOrder')}
            </Button>
          )}
        </CardHeader>

        <CardBody className="pt-2.5">
          {incidents.length === 0 ? (
            <p className="text-[13px] text-muted">{t('incident.none')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {incidents.map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/incidents/${i.id}`}
                    className="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-2 first:pt-0 transition-colors hover:text-accent"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
                    <span className="tabular text-[12.5px] font-medium">{i.incident_number}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {t(typeKey(i.type.slug))}
                    </span>
                    <StatusChip domain="severity" status={i.severity} />
                    <StatusChip domain="incident" status={i.status} />
                    <span className="shrink-0 text-[11.5px] text-subtle">
                      {formatDate(i.detected_at.slice(0, 10), 'short')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {creating && order && (
        <IncidentDialog
          customers={customers ?? []}
          products={products ?? []}
          categories={categories ?? []}
          types={types ?? []}
          order={order}
          onClose={() => setCreating(false)}
          onSaved={(id) => { setCreating(false); router.push(`/incidents/${id}`); }}
        />
      )}
    </>
  );
}
