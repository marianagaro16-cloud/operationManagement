import { getInbox } from '@/server/inbox';
import { InboxView } from '@/components/inbox/inbox-view';

export const dynamic = 'force-dynamic';

/**
 * Every notification sent to the viewer. Any approved account: the layout
 * above already turned everyone else away, and RLS returns only their own.
 */
export default async function InboxPage() {
  const entries = await getInbox();
  return <InboxView entries={entries} />;
}
