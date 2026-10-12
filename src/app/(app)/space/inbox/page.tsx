import { getInbox } from '@/server/inbox';
import { InboxView } from '@/components/inbox/inbox-view';

export const dynamic = 'force-dynamic';

/** Every notification sent to the viewer; RLS returns only their own. */
export default async function SpaceInboxPage() {
  const entries = await getInbox();
  return <InboxView entries={entries} />;
}
