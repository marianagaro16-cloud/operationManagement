import 'server-only';
import { DateTime } from 'luxon';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { getSalesReport } from './sales';

/**
 * The owners' and Admin's figures: how the business is going, at a glance.
 * Orders and activities come from what the dashboard already fetches; these
 * are the two it does not.
 */
export interface BusinessFigures {
  /** Incidents not yet closed, and how many were opened this week. */
  incidents: { open: number; newThisWeek: number };
  /** Units this month against the same days last month (the sales report's). */
  sales: { quantity: number; prevQuantity: number; kg: number } | null;
}

export async function getBusinessFigures(today: string): Promise<BusinessFigures> {
  const supabase = createClient();
  const weekStart = DateTime.fromISO(today, { zone: BUSINESS_TZ }).startOf('week').toUTC().toISO()!;

  const [open, fresh, report] = await Promise.all([
    supabase.from('incidents').select('id', { count: 'exact', head: true }).neq('status', 'closed'),
    supabase.from('incidents').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    getSalesReport(today).catch(() => null),
  ]);

  return {
    incidents: { open: open.count ?? 0, newThisWeek: fresh.count ?? 0 },
    sales: report
      ? {
          quantity: Number(report.totals.quantity),
          prevQuantity: Number(report.totals.prev_quantity),
          kg: Number(report.totals.kg),
        }
      : null,
  };
}
