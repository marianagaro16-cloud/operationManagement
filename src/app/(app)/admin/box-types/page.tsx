import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getBoxTypes } from '@/server/orders';
import { BoxTypeManager } from '@/components/admin/box-type-manager';

export const dynamic = 'force-dynamic';

/**
 * The boxes orders are packed in.
 *
 * Order configuration, so it takes the capability delivery methods take.
 * Inactive types are listed because this is where one is brought back.
 */
export default async function BoxTypesPage() {
  const viewer = await getViewer();
  if (!viewer?.can('orders.manage_config')) redirect('/dashboard');

  const boxTypes = await getBoxTypes(true);
  return <BoxTypeManager boxTypes={boxTypes} />;
}
