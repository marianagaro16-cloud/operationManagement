import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getLineProducts, getProductionLines } from '@/server/production-plans';
import { getProducts } from '@/server/orders';
import { LineSettings } from '@/components/production-plans/line-settings';

export const dynamic = 'force-dynamic';

/** Each line's factors, standing notes and products. For whoever makes the plans. */
export default async function ProductionPlanSettingsPage() {
  const viewer = await getViewer();
  if (!viewer?.can('production_plans.manage')) redirect('/production-plans');
  const [lines, lineProducts, products] = await Promise.all([getProductionLines(), getLineProducts(), getProducts()]);
  return (
    <LineSettings
      lines={lines}
      lineProducts={lineProducts}
      products={products.map((p) => ({ id: p.id, code: p.code, name: p.name ?? p.family, weight: p.net_weight_kg == null ? null : Number(p.net_weight_kg) }))}
    />
  );
}
