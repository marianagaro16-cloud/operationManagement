import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';

/*
 * Who hears that an order is urgent or late (decided 2026-10-13).
 *
 * Not everybody: the people kept in app_settings
 * ('orders.urgent_notice_people' — Jefferson, who prepares the orders), and
 * whoever covers one of them on that day (Marco, when Jefferson is away).
 */
export async function urgentOrderRecipients(today: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: setting } = await admin.from('app_settings').select('value').eq('key', 'orders.urgent_notice_people').maybeSingle();
  const people = (Array.isArray(setting?.value) ? setting.value : []).filter((v): v is string => typeof v === 'string');
  if (people.length === 0) return [];

  const { data: covering, error } = await admin
    .from('coverage_assignments')
    .select('coverer_id, absence:absences!inner ( profile_id, status )')
    .eq('cover_date', today)
    .is('removed_at', null)
    .eq('absence.status', 'approved')
    .in('absence.profile_id', people);
  if (error) throw new Error(`urgent order recipients: ${error.message}`);

  const ids = [...new Set([...people, ...((covering ?? []) as { coverer_id: string }[]).map((c) => c.coverer_id)])];
  // Only people who can still open the app.
  const { data: approved } = await admin.from('profiles').select('id').eq('status', 'approved').is('deleted_at', null).in('id', ids);
  return ((approved ?? []) as { id: string }[]).map((p) => p.id);
}
