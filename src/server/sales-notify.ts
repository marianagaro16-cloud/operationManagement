import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { sendToUser } from './push';
import { timeRange } from '@/domain/sales/times';

/*
 * Sales notices. The weekly summary of customers going quiet, for the Ventas team: Monday
 * from 09:00, once per person and week. Nothing is sent in a week with none
 * — a notice saying "nothing to do" would teach people to ignore it.
 * Written in Spanish, like every other server-sent notification.
 */

const SUMMARY_WEEKDAY = 1; // Monday
const SUMMARY_HOUR = 9;

export async function runQuietCustomersSummary(now = new Date()): Promise<{ sent: number }> {
  const local = DateTime.fromJSDate(now, { zone: BUSINESS_TZ });
  if (local.weekday !== SUMMARY_WEEKDAY || local.hour < SUMMARY_HOUR) return { sent: 0 };

  const admin = createAdminClient();
  const { data: quiet, error } = await admin.rpc('sales_quiet_customers_all');
  if (error) throw new Error(`quiet customers: ${error.message}`);
  const rows = (quiet ?? []) as unknown as { late: boolean }[];
  if (rows.length === 0) return { sent: 0 };

  const { data: team, error: teamError } = await admin
    .from('profiles')
    .select('id')
    .eq('team', 'sales')
    .eq('status', 'approved')
    .is('deleted_at', null);
  if (teamError) throw new Error(`quiet customers: ${teamError.message}`);

  const late = rows.filter((r) => r.late).length;
  const less = rows.length - late;
  const parts = [
    late > 0 && `${late} sin pedir más de lo habitual`,
    less > 0 && `${less} pidiendo menos`,
  ].filter(Boolean);
  const body = `${rows.length === 1 ? '1 cliente' : `${rows.length} clientes`} en silencio: ${parts.join(', ')}.`;

  let sent = 0;
  for (const { id } of team ?? []) {
    const { data: claimed } = await admin
      .from('sales_quiet_notices')
      .upsert({ user_id: id, week_start: local.toISODate() }, { onConflict: 'user_id,week_start', ignoreDuplicates: true })
      .select('user_id');
    if (!claimed?.length) continue;
    try {
      await sendToUser(id, {
        title: 'Clientes en silencio',
        body,
        url: '/sales?tab=quiet',
        tag: `sales-quiet-${local.toISODate()}`,
      });
      sent++;
    } catch (err) {
      console.error('sales-notify: send failed', err);
    }
  }
  return { sent };
}

/** The day's plan arrives from this hour. */
const SUMMARY_PLAN_HOUR = 8;
/** An activity with a time is announced this long before it. */
const BEFORE_MINUTES = 15;

type KindRow = { id: string; name: string };
type PlannedRow = {
  id: string;
  salesperson_id: string;
  kind_id: string;
  activity_time: string | null;
  activity_end: string | null;
  title: string | null;
  customer: { company_name: string } | null;
  prospect: { company_name: string } | null;
};

/**
 * The planning's notices, in Spanish like every other server-sent one:
 * each salesperson's day at 08:00 — once — and, for an activity with a
 * time, a notice 15 minutes before. Claimed before sending, so overlapping
 * runs never send twice.
 */
export async function runPlanNotices(now = new Date()): Promise<{ summaries: number; soon: number }> {
  const local = DateTime.fromJSDate(now, { zone: BUSINESS_TZ });
  const today = local.toISODate()!;
  const admin = createAdminClient();

  const [{ data: kinds }, { data: planned, error }] = await Promise.all([
    admin.from('sales_activity_kinds').select('id, name'),
    admin
      .from('sales_activities')
      .select('id, salesperson_id, kind_id, activity_time, activity_end, title, customer:customers ( company_name ), prospect:prospects ( company_name )')
      .eq('activity_date', today)
      .eq('status', 'planned'),
  ]);
  if (error) throw new Error(`plan notices: ${error.message}`);
  const kindName = new Map(((kinds ?? []) as KindRow[]).map((k) => [k.id, k.name]));
  const rows = (planned ?? []) as unknown as PlannedRow[];
  const about = (r: PlannedRow) => r.customer?.company_name ?? r.prospect?.company_name ?? r.title ?? '';

  // ---- the day, at 08:00 ----
  let summaries = 0;
  if (local.hour >= SUMMARY_PLAN_HOUR) {
    const bySalesperson = new Map<string, PlannedRow[]>();
    for (const r of rows) bySalesperson.set(r.salesperson_id, [...(bySalesperson.get(r.salesperson_id) ?? []), r]);
    for (const [userId, list] of bySalesperson) {
      const { data: claimed } = await admin
        .from('sales_plan_notices')
        .upsert({ user_id: userId, day: today }, { onConflict: 'user_id,day', ignoreDuplicates: true })
        .select('user_id');
      if (!claimed?.length) continue;

      const counts = new Map<string, number>();
      for (const r of list) {
        const name = kindName.get(r.kind_id) ?? '';
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const parts = [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
      try {
        await sendToUser(userId, {
          title: list.length === 1 ? 'Hoy: 1 actividad' : `Hoy: ${list.length} actividades`,
          body: parts.join(' · '),
          url: '/sales?tab=planning',
          tag: `plan-${today}`,
        });
        summaries++;
      } catch (err) {
        console.error('sales-notify: plan summary failed', err);
      }
    }
  }

  // ---- 15 minutes before ----
  let soon = 0;
  for (const r of rows.filter((x) => x.activity_time)) {
    const at = DateTime.fromISO(`${today}T${r.activity_time}`, { zone: BUSINESS_TZ });
    const minutes = at.diff(local, 'minutes').minutes;
    if (minutes > BEFORE_MINUTES || minutes < 0) continue;
    const { data: claimed } = await admin
      .from('sales_activities')
      .update({ reminded_at: now.toISOString() })
      .eq('id', r.id)
      .is('reminded_at', null)
      .select('id');
    if (!claimed?.length) continue;
    try {
      await sendToUser(r.salesperson_id, {
        title: `${kindName.get(r.kind_id) ?? ''} ${timeRange(r.activity_time, r.activity_end)}`,
        body: about(r),
        url: '/sales?tab=planning',
        tag: `plan-activity-${r.id}`,
      });
      soon++;
    } catch (err) {
      console.error('sales-notify: plan notice failed', err);
    }
  }
  return { summaries, soon };
}
