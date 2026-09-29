import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getActivityKinds, getProspectLists } from '@/server/sales';
import { SalesConfig } from '@/components/admin/sales-config';

export const dynamic = 'force-dynamic';

/**
 * The lists behind prospects. Admin's alone: the admin layout opens at
 * power_user, so the page guards itself, and RLS (is_admin) guards the writes.
 */
export default async function AdminSalesPage() {
  const viewer = await getViewer();
  if (!viewer?.can('system.configure')) redirect('/admin');

  // Inactive rows included: this is where one is switched back on.
  const [{ sources, lostReasons }, kinds] = await Promise.all([getProspectLists(true), getActivityKinds(true)]);
  return <SalesConfig sources={sources} lostReasons={lostReasons} kinds={kinds} />;
}
