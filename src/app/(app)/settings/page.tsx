import { NotificationSettings } from '@/components/shell/notification-settings';

export const dynamic = 'force-dynamic';

/**
 * Personal settings, available to every approved user — not just admins.
 * Notifications are per-device, so the people on the floor need to reach
 * this themselves.
 */
export default function SettingsPage() {
  return <NotificationSettings />;
}
