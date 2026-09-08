'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { StatusChip } from '@/components/ui/status-chip';
import type { IncidentListItem } from '@/types/incidents';
import { typeKey } from './incident-list';

/**
 * The incidents attached to something else — an order, a lot.
 *
 * A LIST and nothing more. Reporting one is an action on the order, so it
 * lives on the order's header beside Edit; this panel only answers "what has
 * already gone wrong with this?".
 *
 * Deliberately a panel rather than a page: §32 keeps the Lot Nummer Tracker
 * answering "where was this lot used" and Incidents answering "what went
 * wrong", and merging them would blur both. This is a link between the two,
 * not a merge of them.
 */
export function IncidentLinks({
  incidents,
  variant,
}: {
  incidents: IncidentListItem[];
  /**
   * Decides the heading. The component owns its own wording — a server page
   * cannot call t(), and passing a literal string would put English into a
   * Spanish screen.
   */
  variant: 'order' | 'lot';
}) {
  const { t, formatDate } = useI18n();

  // Nothing to show: render nothing rather than an empty card on every order
  // that has never had a problem, which is nearly all of them.
  if (incidents.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-0">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          {t(variant === 'lot' ? 'incident.onLot' : 'incident.onOrder')}
          <span className="ml-1.5 tabular text-fg">{incidents.length}</span>
        </h2>
      </CardHeader>

      <CardBody className="pt-2.5">
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
      </CardBody>
    </Card>
  );
}
