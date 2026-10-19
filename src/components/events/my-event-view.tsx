'use client';

import { useTransition, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, MapPin } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, ErrorState } from '@/components/ui/primitives';
import { timeRange } from '@/domain/sales/times';
import { completeMyEventTask, tickMyMaterial } from '@/server/event-assignee-actions';
import type { MyEvent } from '@/types/events';
import { StageBadge, useEventLabels } from './event-parts';

/**
 * An event for whoever was given something on it, outside Sales and
 * Marketing: what, when, where — and only their shifts, the material they
 * bring and their tasks (decided 2026-10-19).
 */
export function MyEventView({ event, today }: { event: MyEvent; today: string }) {
  const { t, formatDate } = useI18n();
  const labels = useEventLabels();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return setError(labels.error(res.error ?? ''));
      router.refresh();
    });
  };

  const hours = timeRange(event.open_time, event.close_time);
  const place = labels.place(event);
  const mapsHref = place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : null;
  const qty = (n: number) => new Intl.NumberFormat('de-CH', { maximumFractionDigits: 2 }).format(n);
  const packed = event.materials.filter((m) => m.packed).length;

  const tick = (id: string, field: 'packed' | 'came_back', on: boolean, label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={pending}
      onClick={() => act(() => tickMyMaterial(id, event.id, field, !on))}
      className={cn(
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border',
        on ? 'border-done bg-done text-white' : 'border-muted hover:border-accent hover:bg-accent/10',
      )}
    >
      {on && <Check className="h-3 w-3" aria-hidden />}
    </button>
  );

  return (
    <>
      <Link href="/agenda" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('agenda.title')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <h1 className="break-words text-xl font-semibold leading-tight">{event.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
          <StageBadge stage={event.stage} />
          <span>{t('event.myPart')}</span>
        </p>
        <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[9rem_1fr]">
          <Detail label={t('event.when')}>
            <span className="tabular">{labels.dates(event)}{hours && ` · ${hours}`}</span>
          </Detail>
          {place && (
            <Detail label={t('event.where')}>
              <a href={mapsHref!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {place}
              </a>
            </Detail>
          )}
        </dl>
        {error && <div className="mt-3"><ErrorState message={error} /></div>}
      </Card>

      <div className="space-y-4">
        {event.shifts.length > 0 && (
          <Card className="p-3">
            <h2 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('event.myShifts')}</h2>
            <ul className="divide-y divide-border text-[13px]">
              {event.shifts.map((s) => (
                <li key={s.id} className="py-1.5">
                  <span className="font-medium tabular">{formatDate(s.date, 'weekday')}</span>
                  {s.start && <span className="tabular text-muted"> · {timeRange(s.start, s.end)}</span>}
                  {s.note && <span className="block text-[12px] text-muted">{s.note}</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {event.materials.length > 0 && (
          <Card className="p-3">
            <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
              {t('event.myMaterials')} · {t('event.materialsPacked', { packed, total: event.materials.length })}
            </h2>
            <p className="mb-1.5 mt-0.5 text-[12px] text-muted">{t('event.myMaterialsHint')}</p>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] text-muted">
                  <th className="w-12 py-1 font-medium">{t('event.materialPacked')}</th>
                  <th className="py-1 font-medium">{t('event.materialName')}</th>
                  <th className="w-14 py-1 font-medium">{t('event.materialBack')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {event.materials.map((m) => (
                  <tr key={m.id} className="align-top">
                    <td className="py-1.5">{tick(m.id, 'packed', m.packed, t('event.materialPacked'))}</td>
                    <td className="break-words py-1.5 pr-2">
                      {m.quantity !== null && <span className="tabular font-medium">{qty(m.quantity)} × </span>}
                      {m.name}
                    </td>
                    <td className="py-1.5">{tick(m.id, 'came_back', m.came_back, t('event.materialBack'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {event.tasks.length > 0 && (
          <Card className="p-3">
            <h2 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('event.myTasks')}</h2>
            <ul className="divide-y divide-border text-[13px]">
              {event.tasks.map((a) => {
                const open = a.status === 'planned';
                const late = open && a.date < today;
                return (
                  <li key={a.id} className="flex items-start justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <span className={cn('block break-words', !open && 'text-muted line-through')}>{a.title}</span>
                      <span className={cn('text-[12px] tabular text-muted', late && 'font-semibold text-late')}>{formatDate(a.date, 'weekday')}</span>
                    </div>
                    {open ? (
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => completeMyEventTask(a.id, event.id))}>
                        <Check className="h-3 w-3" aria-hidden />
                        {t('agenda.markDone')}
                      </Button>
                    ) : (
                      a.status === 'done' && <Badge tone="done">{t('event.taskDone')}</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[12px] text-muted sm:pt-px">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
