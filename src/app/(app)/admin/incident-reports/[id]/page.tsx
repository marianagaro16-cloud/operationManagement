import { redirect } from 'next/navigation';

/** Saved incident reports moved under Informes. */
export default function IncidentReportSnapshotRedirect({ params }: { params: { id: string } }) {
  redirect(`/admin/reports/incidents/${params.id}`);
}
