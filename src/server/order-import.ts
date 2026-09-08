import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ProductAlias } from '@/domain/orders/import/matching';
import type { PipelineProduct } from '@/domain/orders/import/pipeline';
import type { OrderRequestTemplate } from '@/domain/orders/import/template';

/**
 * Reads for the Order Request importer.
 *
 * Everything here comes out of the tables the rest of the module already
 * uses. There is no import-side copy of the product catalogue, no search
 * index and no cache to fall out of date — the Product Master is read at the
 * moment of the import, so a product deactivated an hour ago is not offered.
 */

/**
 * The catalogue one import runs against.
 *
 * Fetched on the SERVER and matched on the server. The alternative — shipping
 * the master to the browser to match there — would put a few hundred rows on
 * a warehouse tablet's connection for every import, and would still have to
 * re-verify every id on save.
 *
 * Aliases are narrowed in SQL to the ones that can apply: global aliases and
 * this customer's own. Another customer's shorthand is not merely irrelevant,
 * it is actively wrong — two customers legitimately use one word for two
 * different products.
 */
export async function getImportCatalog(customerId: string): Promise<{
  products: PipelineProduct[];
  aliases: ProductAlias[];
}> {
  const supabase = createClient();

  const [productsRes, aliasesRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, code, name, family, presentation, is_active, units_per_box')
      .eq('is_active', true),
    supabase
      .from('product_aliases')
      .select('product_id, customer_id, alias')
      .or(`customer_id.is.null,customer_id.eq.${customerId}`),
  ]);

  if (productsRes.error) throw new Error(productsRes.error.message);
  if (aliasesRes.error) throw new Error(aliasesRes.error.message);

  return {
    products: (productsRes.data ?? []).map((p) => ({
      ...(p as Omit<PipelineProduct, 'units_per_box'> & { units_per_box: number | string | null }),
      // numeric(12,3) arrives from Postgres as a string, exactly as
      // ordered_quantity does. A string here would multiply as a string.
      units_per_box: toNullableNumber((p as { units_per_box: unknown }).units_per_box),
    })),
    aliases: (aliasesRes.data ?? []) as ProductAlias[],
  };
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Order Request templates, optionally narrowed to one customer. */
export async function getOrderRequestTemplates(
  customerId?: string,
  includeInactive = false,
): Promise<OrderRequestTemplate[]> {
  const supabase = createClient();
  let q = supabase.from('order_request_templates').select('*').order('name');
  if (customerId) q = q.eq('customer_id', customerId);
  if (!includeInactive) q = q.eq('is_active', true);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderRequestTemplate[];
}

export interface TemplateWithCustomer extends OrderRequestTemplate {
  customer: { id: string; name: string; is_active: boolean };
}

/** The admin list, which shows every template including the inactive ones. */
export async function getOrderRequestTemplatesWithCustomer(): Promise<TemplateWithCustomer[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('order_request_templates')
    .select('*, customer:customers!inner ( id, name, is_active )')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TemplateWithCustomer[];
}

export interface ProductAliasRow {
  id: string;
  product_id: string;
  customer_id: string | null;
  alias: string;
}

/**
 * Every configured alias, for the product master screen.
 *
 * Fetched whole rather than per product: aliases are an explicit,
 * hand-curated list — there will be dozens, not thousands — and one query
 * beats a round trip each time somebody opens a product.
 */
export async function getProductAliases(): Promise<ProductAliasRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('product_aliases')
    .select('id, product_id, customer_id, alias')
    .order('alias');
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductAliasRow[];
}
