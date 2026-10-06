import { redirect } from 'next/navigation';

/** Customer specifications moved into the Guías; old links land there. */
export default function SpecificationsPage() {
  redirect('/guide?tab=customers');
}
