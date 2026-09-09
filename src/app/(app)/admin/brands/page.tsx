import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getBrands } from '@/server/orders';
import { BrandsScreen } from '@/components/admin/master-screens';

export const dynamic = 'force-dynamic';

/**
 * The names we sell under.
 *
 * Product master data, so it takes the capability the product master takes —
 * no new permission key. Inactive brands are shown here because this is where
 * one is brought back.
 */
export default async function BrandsPage() {
  const viewer = await getViewer();
  if (!viewer?.can('products.manage')) redirect('/dashboard');

  const brands = await getBrands(true);
  return <BrandsScreen brands={brands} />;
}
