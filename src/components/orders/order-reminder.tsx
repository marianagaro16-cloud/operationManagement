'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellPlus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { ReminderDialog } from '@/components/reminders/reminder-dialog';
import { QuickReminderButton } from '@/components/reminders/reminder-actions';

/**
 * The dates people want a reminder about an order on: the day before delivery,
 * the delivery day, a week after. Only those still ahead.
 */
export function useOrderReminderDates(deliveryDate: string): { label: string; date: string }[] {
  const { t } = useI18n();
  const today = DateTime.now().setZone(BUSINESS_TZ).toISODate()!;
  const day = DateTime.fromISO(deliveryDate, { zone: BUSINESS_TZ });
  return [
    { label: t('orders.remDayBefore'), date: day.minus({ days: 1 }).toISODate()! },
    { label: t('orders.remDeliveryDay'), date: deliveryDate },
    { label: t('orders.remWeekAfter'), date: day.plus({ weeks: 1 }).toISODate()! },
  ].filter((q) => q.date >= today);
}

/** A reminder about this order — opened from the order book's card. */
export function OrderReminderButton({
  order,
  viewerId,
}: {
  order: { id: string; reference: number; delivery_date: string };
  viewerId: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const quickDates = useOrderReminderDates(order.delivery_date);
  return (
    <>
      <Button size="icon" variant="ghost" onClick={() => setOpen(true)} aria-label={t('reminder.new')} title={t('reminder.new')}>
        <BellPlus className="h-3.5 w-3.5" aria-hidden />
      </Button>
      {open && (
        <ReminderDialog
          open
          viewerId={viewerId}
          link={{ type: 'order', id: order.id, label: `#${order.reference}` }}
          quickDates={quickDates}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/** The order page's "+ Reminder", with the delivery's dates as quick picks. */
export function OrderPageReminderButton({ order, viewerId }: { order: { id: string; reference: number; delivery_date: string }; viewerId: string | null }) {
  const quickDates = useOrderReminderDates(order.delivery_date);
  return <QuickReminderButton viewerId={viewerId} link={{ type: 'order', id: order.id, label: `#${order.reference}` }} quickDates={quickDates} />;
}
