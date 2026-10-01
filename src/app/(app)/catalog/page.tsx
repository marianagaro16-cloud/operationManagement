import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { createClient } from '@/lib/supabase/server';
import { CatalogView } from '@/components/catalog/catalog-view';
import { isAdminRole, isMarketing } from '@/lib/authz';

export const dynamic = 'force-dynamic';

/** Products and customers to read — for Marketing. Names and where, nothing commercial. */
export default async function CatalogPage({ searchParams }: { searchParams: { tab?: string } }) {
  const viewer = await getViewer();
  if (!viewer || !(isMarketing(viewer.profile.team) || isAdminRole(viewer.role))) redirect('/dashboard');
  const tab = searchParams.tab === 'customers' ? 'customers' : 'products';

  const supabase = createClient();
  const [{ data: products }, { data: customers }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, code, presentation, category, brand:brands ( name )')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('customers')
      .select('id, company_name, company_name_addition, city, customer_type:customer_types ( slug, name )')
      .eq('is_active', true)
      .order('company_name'),
  ]);

  return (
    <CatalogView
      tab={tab}
      products={((products ?? []) as unknown as { id: string; name: string; code: string | null; presentation: string | null; category: string | null; brand: { name: string } | null }[]).map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        detail: [p.presentation, p.category].filter(Boolean).join(' · ') || null,
        brand: p.brand?.name ?? null,
      }))}
      customers={((customers ?? []) as unknown as { id: string; company_name: string; company_name_addition: string | null; city: string | null; customer_type: { slug: string; name: string } | null }[]).map((c) => ({
        id: c.id,
        name: c.company_name,
        addition: c.company_name_addition,
        city: c.city,
        type: c.customer_type,
      }))}
    />
  );
}
