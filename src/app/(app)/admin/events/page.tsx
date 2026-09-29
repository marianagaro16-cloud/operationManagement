import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getEventLists } from '@/server/events';
import { EventsConfig } from '@/components/admin/events-config';

export const dynamic = 'force-dynamic';

/**
 * The lists behind events. Admin's alone: the admin layout opens at
 * power_user, so the page guards itself, and RLS (is_admin) guards the writes.
 */
export default async function AdminEventsPage() {
  const viewer = await getViewer();
  if (!viewer?.can('system.configure')) redirect('/admin');

  // Inactive rows included: this is where one is switched back on.
  const lists = await getEventLists(true);
  return <EventsConfig {...lists} />;
}
