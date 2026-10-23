import { filterByQuery } from '@/lib/search';
import type { Customer, Product } from '@/types/orders';

/*
 * The filters on Gestión → Clientes and Gestión → Productos, outside the
 * components so the Excel download (2026-10-23) returns exactly the rows on
 * screen: the screen and the export route run the same function on the same
 * filters, carried as URL parameters.
 */

export type AddressFilter = '' | 'unchecked' | 'approximate' | 'missing' | 'checked';
export type WeightFilter = '' | 'suggested' | 'missing';

export interface CustomerFilters {
  query: string;
  showInactive: boolean;
  /** '' is every segment; 'none' the unclassified ones. */
  type: string;
  address: AddressFilter;
}

export interface ProductFilters {
  query: string;
  showInactive: boolean;
  /** '' is every brand; 'none' the products without one. */
  brand: string;
  /** '' is every category; 'none' the products without one. */
  category: string;
  weight: WeightFilter;
}

const ADDRESS: AddressFilter[] = ['', 'unchecked', 'approximate', 'missing', 'checked'];
const WEIGHT: WeightFilter[] = ['', 'suggested', 'missing'];

export function hasSuggestedWeight(p: Product): boolean {
  return p.net_weight_suggested || p.gross_weight_suggested;
}

export function hasMissingWeight(p: Product): boolean {
  return p.net_weight_kg === null || p.gross_weight_kg === null;
}

// The same matcher the order picker uses: accent-folded and multi-term, so
// "wulflingen" finds Wülflingen here as well.
export function filterCustomers(customers: Customer[], f: CustomerFilters): Customer[] {
  return filterByQuery(
    customers
      .filter((c) => f.showInactive || c.is_active)
      .filter((c) => (f.type === '' ? true : f.type === 'none' ? !c.customer_type_id : c.customer_type_id === f.type))
      .filter((c) => {
        const hasAddress = Boolean(c.city || c.street);
        if (f.address === 'missing') return !hasAddress;
        if (f.address === 'approximate') return c.location_precision === 'city';
        if (f.address === 'checked') return Boolean(c.address_checked_at);
        if (f.address === 'unchecked') return hasAddress && !c.address_checked_at;
        return true;
      }),
    f.query,
    // Search covers BOTH fields, since the team may know either.
    (c) => `${c.company_name} ${c.company_name_addition ?? ''}`,
  );
}

// Terms are ANDed so "tortilla 1kg" narrows instead of returning nothing.
export function filterProducts(products: Product[], f: ProductFilters): Product[] {
  return filterByQuery(
    products
      .filter((p) => f.showInactive || p.is_active)
      .filter((p) => (f.brand === '' ? true : f.brand === 'none' ? p.brand_id === null : p.brand_id === f.brand))
      .filter((p) => (f.category === '' ? true : f.category === 'none' ? p.category_id === null : p.category_id === f.category))
      .filter((p) => (f.weight === 'suggested' ? hasSuggestedWeight(p) : f.weight === 'missing' ? hasMissingWeight(p) : true)),
    f.query,
    // Searchable by code, name and BRAND, which is how people actually
    // look — "masamor" should find the Masamor range.
    (p) => `${p.code ?? ''} ${p.name ?? ''} ${p.family} ${p.brand?.name ?? ''}`,
  );
}

/** The filters as the export link's query string; defaults left out. */
export function customerFiltersToParams(f: CustomerFilters): string {
  const p = new URLSearchParams();
  if (f.query.trim()) p.set('q', f.query);
  if (f.showInactive) p.set('inactive', '1');
  if (f.type) p.set('type', f.type);
  if (f.address) p.set('address', f.address);
  return p.toString();
}

export function customerFiltersFromParams(p: URLSearchParams): CustomerFilters {
  const address = p.get('address') ?? '';
  return {
    query: p.get('q') ?? '',
    showInactive: p.get('inactive') === '1',
    type: p.get('type') ?? '',
    address: ADDRESS.includes(address as AddressFilter) ? (address as AddressFilter) : '',
  };
}

export function productFiltersToParams(f: ProductFilters): string {
  const p = new URLSearchParams();
  if (f.query.trim()) p.set('q', f.query);
  if (f.showInactive) p.set('inactive', '1');
  if (f.brand) p.set('brand', f.brand);
  if (f.category) p.set('category', f.category);
  if (f.weight) p.set('weight', f.weight);
  return p.toString();
}

export function productFiltersFromParams(p: URLSearchParams): ProductFilters {
  const weight = p.get('weight') ?? '';
  return {
    query: p.get('q') ?? '',
    showInactive: p.get('inactive') === '1',
    brand: p.get('brand') ?? '',
    category: p.get('category') ?? '',
    weight: WEIGHT.includes(weight as WeightFilter) ? (weight as WeightFilter) : '',
  };
}
