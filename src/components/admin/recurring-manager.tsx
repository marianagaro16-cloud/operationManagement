'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { nextStandingDelivery } from '@/domain/orders/scheduling';
import { businessToday } from '@/lib/datetime';
import { generateOrderFromTemplate, setTemplateActive } from '@/server/order-actions';
import type { Customer, DeliveryMethod, Product, RecurringTemplate } from '@/types/orders';
import { StandingOrderDialog } from './standing-order-dialog';

/**
 * Recurring order templates.
 *
 * A template PROPOSES a draft order for review; it never creates a confirmed
 * one. Templates seeded from the workbook's weekday roster arrive inactive,
 * because a customer appearing on a Wednesday sheet is evidence of a pattern,
 * not proof that the order genuinely recurs.
 *
 * Deliberately separate from the task recurrence engine: an order cadence and
 * an operational task cadence are different concepts.
 */
export function RecurringManager({
  templates,
  customers,
  products,
  deliveryMethods,
}: {
  templates: RecurringTemplate[];
  customers: Customer[];
  products: Product[];
  deliveryMethods: DeliveryMethod[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<RecurringTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const today = businessToday();

  const byWeekday = new Map<number, RecurringTemplate[]>();
  for (const tpl of templates) {
    const list = byWeekday.get(tpl.delivery_weekday);
    if (list) list.push(tpl);
    else byWeekday.set(tpl.delivery_weekday, [tpl]);
  }

  return (
    <>
      <PageHeader
        title={t('master.recurringTitle')}
        subtitle={t('master.recurringSubtitle')}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('master.newStanding')}
          </Button>
        }
      />

      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      {message && <p className="mb-3 text-[13px] text-done">{message}</p>}

      {templates.length === 0 ? (
        <EmptyState
          title={t('master.standingEmpty')}
          body={t('master.standingEmptyBody')}
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('master.newStanding')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {[...byWeekday.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([weekday, list]) => (
              <section key={weekday}>
                <h2 className="mb-1.5 px-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                  {t(`weekday.${weekday}` as 'weekday.1')}
                </h2>
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-border">
                    {list.map((tpl) => {
                      // Cadence-aware: a fortnightly template must not be
                      // offered its off-week.
                      const nextDelivery = nextStandingDelivery(
                        {
                          weekday: tpl.delivery_weekday,
                          intervalWeeks: tpl.interval_weeks,
                          anchorDate: tpl.anchor_date,
                        },
                        today,
                      );
                      return (
                        <li key={tpl.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-medium">{tpl.customer.name}</p>
                            <p className="text-[11.5px] text-muted">
                              {t('master.nextDelivery')}:{' '}
                              {nextDelivery ? formatDate(nextDelivery, 'short') : '—'}
                              {' · '}
                              {tpl.interval_weeks > 1
                                ? t('master.everyNWeeksShort', { n: tpl.interval_weeks })
                                : t('master.weekly')}
                              {tpl.lines?.length ? ` · ${tpl.lines.length}` : ''}
                            </p>
                          </div>

                          <Badge tone={tpl.is_active ? 'done' : 'warn'}>
                            {tpl.is_active ? t('status.active') : t('master.templateInactive')}
                          </Badge>

                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={t('common.edit')}
                            onClick={() => setEditing(tpl)}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () => {
                                const res = await setTemplateActive(tpl.id, !tpl.is_active);
                                if (!res.ok) setError(res.error);
                                router.refresh();
                              })
                            }
                          >
                            {tpl.is_active ? t('admin.deactivate') : t('admin.activate')}
                          </Button>

                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={pending || !tpl.is_active}
                            onClick={() =>
                              startTransition(async () => {
                                setError(null); setMessage(null);
                                const res = await generateOrderFromTemplate(tpl.id, nextDelivery!);
                                if (!res.ok) setError(res.error);
                                else setMessage(t('master.generatedOrder'));
                                router.refresh();
                              })
                            }
                          >
                            <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
                            {t('master.generateOrder')}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </section>
            ))}
        </div>
      )}

      {(creating || editing) && (
        <StandingOrderDialog
          key={editing?.id ?? 'new'}
          template={editing}
          customers={customers}
          products={products}
          deliveryMethods={deliveryMethods}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </>
  );
}
