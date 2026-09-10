import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getSuppliers } from '@/server/goods-reception';
import { ReceptionMaster } from '@/components/admin/reception-master';

export const dynamic = 'force-dynamic';

/** Who goods come from. Inactive rows included — §37 needs them reactivatable. */
export default async function SuppliersPage() {
  const viewer = await getViewer();
  if (!viewer?.can('goods_reception.manage_config')) redirect('/admin');

  return <ReceptionMaster kind="supplier" rows={await getSuppliers(true)} />;
}
