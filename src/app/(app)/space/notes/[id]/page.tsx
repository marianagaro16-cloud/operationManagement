import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getNote } from '@/server/notes';
import { NotePage } from '@/components/space/note-page';

export const dynamic = 'force-dynamic';

/** One note as a page: the viewer's own, or one shared with them. */
export default async function SpaceNotePage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const note = await getNote(params.id);
  // Deleted, or no longer shared with the viewer.
  if (!note) redirect('/space');
  return <NotePage key={note.id} note={note} viewerId={viewer.profile.id} />;
}
