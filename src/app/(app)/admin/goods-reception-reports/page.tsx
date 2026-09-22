import { redirect } from 'next/navigation';

/** The reception reports are now the Recepción tab of Informes. */
export default function ReceptionReportsPage() {
  redirect('/admin/reports?tab=reception');
}
