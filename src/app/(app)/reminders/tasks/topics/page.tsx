import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getPersonalTopics } from '@/server/reminders';
import { TopicManager } from '@/components/reminders/topic-manager';
import { canUseReminders } from '@/lib/authz';

export const dynamic = 'force-dynamic';

/** One's own topics and categories for personal tasks. */
export default async function PersonalTopicsPage() {
  const viewer = await getViewer();
  if (!viewer || !canUseReminders(viewer)) redirect('/dashboard');
  return <TopicManager topics={await getPersonalTopics()} />;
}
