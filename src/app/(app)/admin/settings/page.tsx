import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { SettingsView } from '@/components/admin/settings-view';
import { getRouteOrigin } from '@/server/route';

export const dynamic = 'force-dynamic';

/** Admin-only: system configuration is never delegated. */
export default async function SettingsPage() {
  const viewer = await getViewer();
  if (!viewer?.can('system.configure')) redirect('/admin');

  return <SettingsView routeOrigin={await getRouteOrigin()} />;
}
