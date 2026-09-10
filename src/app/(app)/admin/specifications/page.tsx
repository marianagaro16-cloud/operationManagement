import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import {
  getCustomerSpecifications,
  getCustomers,
  getSpecificationTypes,
} from '@/server/orders';
import { SpecificationManager } from '@/components/admin/specification-manager';

export const dynamic = 'force-dynamic';

/**
 * Customer specifications.
 *
 * customers.manage, which Manager and Power User hold and a plain user does
 * not. RLS already returns a plain user nothing, so this check exists to send
 * them somewhere useful rather than render an empty screen at them.
 *
 * Retired reminders are fetched too: they are history somebody may want to
 * explain later, and the screen hides them behind a toggle rather than the
 * query dropping them.
 */
export default async function SpecificationsPage() {
  const viewer = await getViewer();
  if (!viewer?.can('customers.manage')) redirect('/admin');

  const [specifications, types, customers] = await Promise.all([
    getCustomerSpecifications(true),
    getSpecificationTypes(),
    getCustomers(true),
  ]);

  return (
    <SpecificationManager
      specifications={specifications}
      types={types}
      customers={customers}
    />
  );
}
