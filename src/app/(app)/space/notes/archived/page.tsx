import { getNotes } from '@/server/notes';
import { ArchivedNotes } from '@/components/space/archived-notes';

export const dynamic = 'force-dynamic';

/** The notes put away: still readable, restorable, and only from here deleted. */
export default async function SpaceArchivedNotesPage() {
  const notes = await getNotes({ archived: true });
  return <ArchivedNotes notes={notes} />;
}
