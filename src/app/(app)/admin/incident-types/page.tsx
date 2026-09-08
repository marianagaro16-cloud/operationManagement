import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getIncidentCategories, getIncidentTypes } from '@/server/incidents';
import { IncidentTypeManager } from '@/components/admin/incident-type-manager';

export const dynamic = 'force-dynamic';

/**
 * The incident vocabulary.
 *
 * Operational CONFIGURATION, so it takes the Manager's key rather than the
 * Power User's — the same line every other configuration screen draws. The
 * admin layout opens at power_user, so this page guards itself; RLS enforces
 * it again on every write.
 */
export default async function IncidentTypesPage() {
  const viewer = await getViewer();
  if (!viewer?.can('incidents.manage_config')) redirect('/dashboard');

  // Inactive rows are shown here on purpose: this is where somebody
  // reactivates one, and hiding them would look like data loss.
  const [categories, types] = await Promise.all([
    getIncidentCategories(true),
    getIncidentTypes(true),
  ]);

  return <IncidentTypeManager categories={categories} types={types} />;
}
