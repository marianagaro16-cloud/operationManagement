import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getReminder } from '@/server/reminders';
import { ReminderDetail } from '@/components/reminders/reminder-detail';
import { ReminderNotFound } from '@/components/reminders/reminder-not-found';
import { canUseReminders } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export default async function ReminderPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer || !canUseReminders(viewer)) redirect('/dashboard');

  // A malformed id is simply "not found" — never a query error.
  const found = /^[0-9a-f-]{36}$/i.test(params.id) ? await getReminder(params.id) : null;
  if (!found) return <ReminderNotFound />;

  return (
    <ReminderDetail
      reminder={found.reminder}
      events={found.events}
      people={found.people}
      viewerId={viewer.profile.id}
      nowIso={new Date().toISOString()}
    />
  );
}
