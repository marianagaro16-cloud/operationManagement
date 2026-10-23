import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getSuppliers } from '@/server/goods-reception';
import { getSupplierDetailsMap, getSupplierOrderCards } from '@/server/suppliers';
import { ReceptionMaster } from '@/components/admin/reception-master';

export const dynamic = 'force-dynamic';

/**
 * Who goods come from. Inactive rows included — §37 needs them reactivatable.
 *
 * Whoever configures reception adds, renames and switches suppliers off; the
 * office (Owners, Admin, Power User) keeps their contact, ordering, tax and
 * payment details (2026-10-23) — and may open the page for that alone.
 */
export default async function SuppliersPage() {
  const viewer = await getViewer();
  const configure = Boolean(viewer?.can('goods_reception.manage_config'));
  const office = viewer?.role === 'owner' || viewer?.role === 'admin' || viewer?.role === 'power_user';
  if (!configure && !office) redirect('/admin');

  const [rows, details, cards] = await Promise.all([
    getSuppliers(true),
    office ? getSupplierDetailsMap() : null,
    office ? getSupplierOrderCards() : null,
  ]);

  return (
    <ReceptionMaster
      kind="supplier"
      rows={rows}
      canConfigure={configure}
      office={details && cards ? { details, cards } : null}
    />
  );
}
