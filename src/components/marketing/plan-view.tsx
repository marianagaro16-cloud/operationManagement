'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { POST_STATUSES, type PostStatus } from '@/lib/marketing';
import type { MarketingPost } from '@/types/marketing';
import { BrandDot, PostRow, usePostLabels } from './marketing-parts';
import { PostDialog, type PostChoices } from './post-dialog';

/**
 * The content plan: a month with each post on its day (and the ideas without
 * a day beside it), or every post as a list filtered by brand and status.
 */
export function PlanView({
  view,
  month,
  today,
  dated,
  undated,
  all,
  canEdit,
  choices,
}: {
  view: 'calendar' | 'list';
  month: string; // YYYY-MM-01
  today: string;
  dated: MarketingPost[];
  undated: MarketingPost[];
  all: MarketingPost[];
  canEdit: boolean;
  choices: PostChoices;
}) {
  const { t, locale } = useI18n();
  const labels = usePostLabels();
  const [creating, setCreating] = useState<string | null>(null);
  const [brand, setBrand] = useState('all');
  const [status, setStatus] = useState<'all' | PostStatus>('all');

  const anchor = DateTime.fromISO(month);
  const start = anchor.startOf('week');
  const end = anchor.endOf('month').endOf('week');
  const days: string[] = [];
  for (let d = start; d <= end; d = d.plus({ days: 1 })) days.push(d.toISODate()!);
  const byDay = new Map<string, MarketingPost[]>();
  for (const p of dated) if (p.planned_on) byDay.set(p.planned_on, [...(byDay.get(p.planned_on) ?? []), p]);
  const monthHref = (delta: number) => `/marketing?month=${anchor.plus({ months: delta }).toFormat('yyyy-MM-01')}`;
  const weekdays = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }).setLocale(locale).toFormat('ccc'));

  const listed = all.filter(
    (p) => (brand === 'all' || (brand === 'group' ? !p.brand_id : p.brand_id === brand)) && (status === 'all' || p.status === status),
  );

  return (
    <>
      <PageHeader
        title={t('mkt.planTitle')}
        subtitle={t('mkt.planSubtitle')}
        action={
          canEdit && (
            <Button variant="primary" size="sm" onClick={() => setCreating('')}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('mkt.newPost')}
            </Button>
          )
        }
      />
      <div className="-mt-2 mb-3 flex gap-1 border-b border-border">
        {(['calendar', 'list'] as const).map((key) => (
          <Link
            key={key}
            href={key === 'calendar' ? `/marketing?month=${month}` : '/marketing?view=list'}
            scroll={false}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              view === key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {key === 'calendar' ? t('mkt.tabCalendar') : t('mkt.tabList')}
          </Link>
        ))}
      </div>

      {view === 'calendar' ? (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <Link href={monthHref(-1)} aria-label={t('mkt.prevMonth')} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Link>
            <h2 className="text-[15px] font-semibold capitalize">{anchor.setLocale(locale).toFormat('LLLL yyyy')}</h2>
            <Link href={monthHref(1)} aria-label={t('mkt.nextMonth')} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <Card className="overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border bg-surface-2/60 text-center text-[11px] font-medium uppercase text-muted">
              {weekdays.map((w) => <div key={w} className="py-1.5">{w}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const inMonth = d.slice(0, 7) === month.slice(0, 7);
                const posts = byDay.get(d) ?? [];
                return (
                  <div
                    key={d}
                    className={cn('group min-h-[5.5rem] border-b border-r border-border p-1 text-[11.5px] [&:nth-child(7n)]:border-r-0', !inMonth && 'bg-surface-2/40 text-subtle')}
                  >
                    <div className="mb-0.5 flex items-center justify-between">
                      <span className={cn('tabular', d === today && 'rounded-full bg-accent px-1.5 font-semibold text-accent-fg')}>{Number(d.slice(8))}</span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setCreating(d)}
                          aria-label={t('mkt.newPost')}
                          className="rounded p-0.5 text-subtle opacity-0 hover:bg-surface-2 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Plus className="h-3 w-3" aria-hidden />
                        </button>
                      )}
                    </div>
                    <div className="space-y-0.5">
                      {posts.map((p) => (
                        <Link
                          key={p.id}
                          href={`/marketing/${p.id}`}
                          title={`${labels.brand(p)} · ${p.title} · ${labels.status(p.status)}`}
                          className={cn(
                            'flex items-center gap-1 truncate rounded px-1 py-0.5 hover:bg-surface-2',
                            p.status === 'published' ? 'text-muted line-through decoration-done/60' : p.status === 'idea' && 'italic text-muted',
                          )}
                        >
                          <BrandDot name={p.brand_name} />
                          <span className="truncate">{p.title}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          <p className="mt-1.5 text-[11.5px] text-subtle">{t('mkt.legend')}</p>

          <section className="mt-5">
            <h2 className="mb-1.5 px-0.5 text-[13px] font-semibold">{t('mkt.undated', { count: undated.length })}</h2>
            {undated.length === 0 ? (
              <p className="px-0.5 text-[12.5px] text-muted">{t('mkt.noUndated')}</p>
            ) : (
              <Card className="divide-y divide-border">{undated.map((p) => <PostRow key={p.id} post={p} />)}</Card>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:max-w-md">
            <Select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label={t('mkt.brand')}>
              <option value="all">{t('mkt.allBrands')}</option>
              <option value="group">{t('mkt.group')}</option>
              {choices.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label={t('mkt.status')}>
              <option value="all">{t('mkt.allStatuses')}</option>
              {POST_STATUSES.map((s) => <option key={s} value={s}>{labels.status(s)}</option>)}
            </Select>
          </div>
          {listed.length === 0 ? (
            <EmptyState title={t('mkt.none')} />
          ) : (
            <Card className="divide-y divide-border">{listed.map((p) => <PostRow key={p.id} post={p} />)}</Card>
          )}
        </>
      )}

      {creating !== null && <PostDialog choices={choices} initialDate={creating || undefined} onClose={() => setCreating(null)} />}
    </>
  );
}
