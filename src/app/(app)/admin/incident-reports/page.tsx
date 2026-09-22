import { redirect } from 'next/navigation';

/**
 * The incident report is now the Incidencias tab of Informes. Old links and
 * bookmarks land there, on the month they pointed at.
 */
export default function IncidentReportsPage({ searchParams }: { searchParams: { month?: string } }) {
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? `&month=${searchParams.month}` : '';
  redirect(`/admin/reports?tab=incidents${month}`);
}
