import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getCriteria, getEvalTemplates, getArrivalSettings, getLateReasons, getEvalIntervals, getNoteTypes, getTrainingKinds } from '@/server/hr';
import { getChecklistItems } from '@/server/hr-checklists';
import { HrConfig } from '@/components/admin/hr-config';

export const dynamic = 'force-dynamic';

/**
 * The lists behind worker files. Admin's alone: the admin layout opens at
 * power_user, so the page guards itself, and RLS (is_admin) guards the writes.
 */
export default async function AdminHrPage() {
  const viewer = await getViewer();
  if (!viewer?.can('system.configure')) redirect('/admin');

  // Inactive rows included: this is where one is switched back on.
  const [noteTypes, criteria, templates, lateReasons, arrivalSettings, trainingKinds, checklistItems, evalIntervals] = await Promise.all([
    getNoteTypes(true),
    getCriteria(true),
    getEvalTemplates(true),
    getLateReasons(true),
    getArrivalSettings(),
    getTrainingKinds(true),
    getChecklistItems(true),
    getEvalIntervals(),
  ]);
  return <HrConfig noteTypes={noteTypes} criteria={criteria} templates={templates} lateReasons={lateReasons} arrivalSettings={arrivalSettings} trainingKinds={trainingKinds} checklistItems={checklistItems} evalIntervals={evalIntervals} />;
}
