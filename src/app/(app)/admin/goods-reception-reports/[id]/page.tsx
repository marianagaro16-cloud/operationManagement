import { redirect } from 'next/navigation';

/** Saved reception reports moved under Informes. */
export default function ReceptionReportRedirect({ params }: { params: { id: string } }) {
  redirect(`/admin/reports/reception/${params.id}`);
}
