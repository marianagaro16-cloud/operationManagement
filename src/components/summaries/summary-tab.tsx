'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { Share2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { Card, ErrorState, Field, Input } from '@/components/ui/primitives';
import { createSummary } from '@/server/summary-actions';
import type { SummaryContent } from '@/types/summaries';
import { SummaryView } from './summary-view';

type Preset = 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth';

function presetRange(p: Preset, today: string): { from: string; to: string } {
  const d = DateTime.fromISO(today, { zone: BUSINESS_TZ });
  switch (p) {
    case 'thisWeek': return { from: d.startOf('week').toISODate()!, to: d.endOf('week').toISODate()! };
    case 'lastWeek': { const w = d.minus({ weeks: 1 }); return { from: w.startOf('week').toISODate()!, to: w.endOf('week').toISODate()! }; }
    case 'thisMonth': return { from: d.startOf('month').toISODate()!, to: d.endOf('month').toISODate()! };
    case 'lastMonth': { const m = d.minus({ months: 1 }); return { from: m.startOf('month').toISODate()!, to: m.endOf('month').toISODate()! }; }
  }
}

/**
 * The summary for the weekly meetings: choose a period, look it over, then
 * save it to print, send, or attach to a meeting. Starred notes lead.
 */
export function SummaryTab({
  content,
  from,
  to,
  today,
  previous,
}: {
  content: SummaryContent;
  from: string;
  to: string;
  today: string;
  previous: { id: string; title: string; period_from: string; period_to: string; created_at: string }[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [navigating, startNav] = useTransition();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const presets: Preset[] = ['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth'];
  const active = presets.find((p) => {
    const r = presetRange(p, today);
    return r.from === from && r.to === to;
  });
  const go = (range: { from: string; to: string }) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', 'summary');
    next.set('from', range.from);
    next.set('to', range.to);
    startNav(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const [title, setTitle] = useState('');
  const defaultTitle = `${t('summary.titleDefault')} ${formatDate(from, 'short')} – ${formatDate(to, 'short')}`;

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => go(presetRange(p, today))}
              className={cn(
                'rounded-full border px-3 py-1 text-[12.5px]',
                active === p ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg',
              )}
            >
              {t(`summary.${p}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('summary.from')}>
            <Input type="date" value={from} onChange={(e) => e.target.value && go({ from: e.target.value, to: e.target.value > to ? e.target.value : to })} className="w-auto" />
          </Field>
          <Field label={t('summary.to')}>
            <Input type="date" value={to} min={from} onChange={(e) => e.target.value && go({ from, to: e.target.value })} className="w-auto" />
          </Field>
        </div>
        <p className="text-[12px] text-muted">{t('summary.starHint')}</p>
      </Card>

      <div className={cn(navigating && 'opacity-60')}>
        <SummaryView content={content} from={from} to={to} />
      </div>

      <Card className="space-y-2 p-3">
        {error && <ErrorState message={error} />}
        <Field label={t('summary.title')} htmlFor="summary-title">
          <Input id="summary-title" value={title} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Button
          variant="primary"
          loading={saving}
          onClick={() =>
            startSave(async () => {
              setError(null);
              const res = await createSummary(from, to, title.trim() || defaultTitle);
              if (!res.ok) return setError(res.error);
              router.push(`/summaries/${res.data.id}`);
            })
          }
        >
          <Share2 className="h-4 w-4" aria-hidden />
          {t('summary.saveShare')}
        </Button>
        <p className="text-[12px] text-muted">{t('summary.saveShareHint')}</p>
      </Card>

      {previous.length > 0 && (
        <Card className="p-3">
          <h2 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('summary.previous')}</h2>
          <ul className="divide-y divide-border">
            {previous.map((s) => (
              <li key={s.id}>
                <Link href={`/summaries/${s.id}`} className="flex items-center gap-2 py-1.5 text-[13px] hover:text-accent">
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <span className="shrink-0 text-[11.5px] text-muted">{formatDate(s.created_at.slice(0, 10), 'short')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
