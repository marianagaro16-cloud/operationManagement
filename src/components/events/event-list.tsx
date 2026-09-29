'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MapPin, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import type { EventRow } from '@/types/events';
import { StageBadge, useEventLabels } from './event-parts';
import { EventDialog, type EventChoices } from './event-dialog';
import { Stars } from './event-after';

/** Every event: what is coming (ideas and confirmed), and what is past or called off. */
export function EventList({ events, choices, today }: { events: EventRow[]; choices: EventChoices; today: string }) {
  const { t } = useI18n();
  const labels = useEventLabels();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [creating, setCreating] = useState(false);

  const upcoming = events.filter((e) => (e.stage === 'idea' || e.stage === 'confirmed') && e.end_date >= today);
  const past = events
    .filter((e) => !upcoming.includes(e))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const shown = tab === 'upcoming' ? upcoming : past;

  return (
    <>
      <PageHeader
        title={t('event.navLabel')}
        subtitle={t('event.subtitle')}
        action={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('event.new')}
          </Button>
        }
      />
      <nav className="mb-3 flex gap-1 border-b border-border">
        {(['upcoming', 'past'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {key === 'upcoming' ? t('event.tabUpcoming') : t('event.tabPast')}
            <span className="ml-1.5 text-[11px] tabular text-muted">{key === 'upcoming' ? upcoming.length : past.length}</span>
          </button>
        ))}
      </nav>

      {shown.length === 0 ? (
        <EmptyState title={tab === 'upcoming' ? t('event.noneUpcoming') : t('event.nonePast')} body={tab === 'upcoming' ? t('event.noneUpcomingBody') : undefined} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {shown.map((e) => {
              const place = labels.place(e);
              return (
                <li key={e.id}>
                  <Link href={`/events/${e.id}`} className="block px-3.5 py-2.5 hover:bg-surface-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13.5px] font-medium">{e.name}</span>
                      <StageBadge stage={e.stage} />
                      <span className="text-[12px] text-muted">{labels.entry(choices.kinds, e.kind_id)}</span>
                      {e.result_rating !== null && <Stars value={e.result_rating} />}
                    </div>
                    <p className="mt-0.5 text-[12.5px] tabular">{labels.dates(e)}</p>
                    <p className="flex flex-wrap gap-x-3 text-[12px] text-muted">
                      {place && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" aria-hidden />
                          {place}
                        </span>
                      )}
                      {e.customer_name && <span>{e.customer_name}</span>}
                      {e.owner_name && <span>{t('event.owner')}: {e.owner_name}</span>}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {creating && <EventDialog event={null} choices={choices} today={today} onClose={() => setCreating(false)} />}
    </>
  );
}
