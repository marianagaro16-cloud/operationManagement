import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getKeys, getLateArrivals, getWorkerFile } from '@/server/hr';
import { PrintWorkerFile } from '@/components/hr/print-worker-file';
import { getWorkerMeetingRecords } from '@/server/meeting-records';

export const dynamic = 'force-dynamic';

/** A worker's file on a plain page, without the app around it, to print or save as PDF. */
export default async function PrintWorkerFileRoute({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!viewer.can('hr.manage')) redirect('/dashboard');
  // Not theirs to see looks the same as not found: RLS returned nothing.
  const [file, arrivals, keys, meetings] = await Promise.all([
    getWorkerFile(params.id),
    getLateArrivals(params.id),
    getKeys(params.id),
    getWorkerMeetingRecords(params.id),
  ]);
  if (!file) notFound();
  return <PrintWorkerFile file={file} arrivals={arrivals} keys={keys} meetings={meetings} />;
}
