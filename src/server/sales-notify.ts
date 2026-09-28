import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { sendToUser } from './push';

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

/** Next steps are announced from this hour, on their day. */
const NEXT_STEP_HOUR = 9;

/**
 * A prospect's next step, on its day, to its responsible salesperson — once.
 * Overdue ones are not announced again; the dashboard card keeps them in view.
 */
export async function runProspectNextSteps(now = new Date()): Promise<{ sent: number }> {
  const local = DateTime.fromJSDate(now, { zone: BUSINESS_TZ });
  if (local.hour < NEXT_STEP_HOUR) return { sent: 0 };
  const today = local.toISODate()!;

  const admin = createAdminClient();
  // Claimed and read in one step, so overlapping runs never send twice.
  const { data, error } = await admin
    .from('prospects')
    .update({ next_step_notified_on: today })
    .eq('next_step_on', today)
    .not('stage', 'in', '(won,lost)')
    .not('owner_id', 'is', null)
    .or(`next_step_notified_on.is.null,next_step_notified_on.neq.${today}`)
    .select('id, company_name, next_step, owner_id');
  if (error) throw new Error(`prospect next steps: ${error.message}`);

  let sent = 0;
  for (const p of data ?? []) {
    try {
      await sendToUser(p.owner_id!, {
        title: `Hoy: ${p.company_name}`,
        body: p.next_step ?? '',
        url: `/sales/prospects/${p.id}`,
        tag: `prospect-${p.id}-${today}`,
      });
      sent++;
    } catch (err) {
      console.error('sales-notify: next step failed', err);
    }
  }
  return { sent };
}
