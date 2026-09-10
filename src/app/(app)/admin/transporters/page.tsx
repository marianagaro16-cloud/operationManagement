import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getTransporters } from '@/server/goods-reception';
import { ReceptionMaster } from '@/components/admin/reception-master';

export const dynamic = 'force-dynamic';

/**
 * Who carried the goods to us.
 *
 * Deliberately NOT delivery_methods: that list is how goods leave us for a
 * customer ("Entrega en Zürich", "Se recoge en la fábrica") and half of it is
 * not a carrier at all.
 */
export default async function TransportersPage() {
  const viewer = await getViewer();
  if (!viewer?.can('goods_reception.manage_config')) redirect('/admin');

  return <ReceptionMaster kind="transporter" rows={await getTransporters(true)} />;
}
