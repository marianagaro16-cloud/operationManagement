import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getNotes } from '@/server/notes';
import { NotesView } from '@/components/notes/notes-view';

export const dynamic = 'force-dynamic';

/** Quick notes: one's own, and those shared with one. */
export default async function NotesPage({ searchParams }: { searchParams: { archived?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const archived = searchParams.archived === '1';
  const notes = await getNotes({ archived });
  return <NotesView notes={notes} archived={archived} viewerId={viewer.profile.id} />;
}
