import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getNotifiableUsers } from '@/server/notifications';
import { NotificationSender } from '@/components/admin/notification-sender';

export const dynamic = 'force-dynamic';

/**
 * Send a direct notification.
 *
 * Open to anyone holding `notifications.send` — Power User and Manager by
 * default, and Admin always. The recipient list is fetched here rather than
 * in the client so the "has a device" flag can be derived with the service
 * role without any push endpoint reaching the browser.
 */
export default async function AdminNotificationsPage() {
  const viewer = await getViewer();
  if (!viewer?.can('notifications.send')) redirect('/admin');

  const users = await getNotifiableUsers();

  return <NotificationSender users={users} />;
}
