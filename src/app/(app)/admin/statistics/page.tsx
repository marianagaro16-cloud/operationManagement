import { redirect } from 'next/navigation';

/**
 * Task statistics moved into /admin/reports as its Tasks tab.
 *
 * The screen existed separately with its own range buttons and its own inline
 * period maths, which is how two report screens came to disagree about what a
 * month was. The route is kept as a redirect so an existing bookmark or a link
 * in someone's notes still lands somewhere useful.
 */
export default function StatisticsPage() {
  redirect('/admin/reports?tab=tasks&period=month');
}
