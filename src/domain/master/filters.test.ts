import { describe, expect, it } from 'vitest';
import {
  customerFiltersFromParams,
  customerFiltersToParams,
  filterCustomers,
  filterProducts,
  productFiltersFromParams,
  productFiltersToParams,
  type CustomerFilters,
  type ProductFilters,
} from './filters';
import type { Customer, Product } from '@/types/orders';

const customer = (over: Partial<Customer>): Customer => ({
  id: 'c', company_name: 'X AG', company_name_addition: null, name: 'X', is_active: true,
  created_at: '', updated_at: '', ...over,
});

const product = (over: Partial<Product>): Product => ({
  id: 'p', code: null, name: null, family: '', presentation: '', category: null, notes: null,
  units_per_box: null, net_weight_kg: 1, net_weight_suggested: false, gross_weight_kg: 1, gross_weight_suggested: false,
  brand_id: null, category_id: null, subcategory_id: null, needs_review: false, is_active: true, ...over,
});

describe('customer filters', () => {
  const all = [
    customer({ id: 'a', company_name: 'La Catedral', city: 'Wülflingen', customer_type_id: 't1' }),
    customer({ id: 'b', company_name: 'Old AG', is_active: false }),
    customer({ id: 'c', company_name: 'Nowhere GmbH' }),
  ];
  const none: CustomerFilters = { query: '', showInactive: false, type: '', address: '' };

  it('hides inactive unless asked', () => {
    expect(filterCustomers(all, none).map((c) => c.id)).toEqual(['a', 'c']);
    expect(filterCustomers(all, { ...none, showInactive: true })).toHaveLength(3);
  });

  it('filters by type, address and text', () => {
    expect(filterCustomers(all, { ...none, type: 'none' }).map((c) => c.id)).toEqual(['c']);
    expect(filterCustomers(all, { ...none, address: 'missing' }).map((c) => c.id)).toEqual(['c']);
    expect(filterCustomers(all, { ...none, query: 'cated' }).map((c) => c.id)).toEqual(['a']);
  });

  it('survives the trip through the link', () => {
    const f: CustomerFilters = { query: 'la cat', showInactive: true, type: 'none', address: 'unchecked' };
    expect(customerFiltersFromParams(new URLSearchParams(customerFiltersToParams(f)))).toEqual(f);
    expect(customerFiltersFromParams(new URLSearchParams(customerFiltersToParams(none)))).toEqual(none);
    expect(customerFiltersFromParams(new URLSearchParams('address=bogus')).address).toBe('');
  });
});

describe('product filters', () => {
  const all = [
    product({ id: 'a', code: '0073', name: 'Tortilla 1kg', brand_id: 'b1' }),
    product({ id: 'b', name: 'Mezcal', net_weight_kg: null }),
    product({ id: 'c', name: 'Retired', is_active: false }),
  ];
  const none: ProductFilters = { query: '', showInactive: false, brand: '', category: '', weight: '' };

  it('filters by brand, weight and text', () => {
    expect(filterProducts(all, none).map((p) => p.id)).toEqual(['a', 'b']);
    expect(filterProducts(all, { ...none, brand: 'none' }).map((p) => p.id)).toEqual(['b']);
    expect(filterProducts(all, { ...none, weight: 'missing' }).map((p) => p.id)).toEqual(['b']);
    expect(filterProducts(all, { ...none, query: '0073' }).map((p) => p.id)).toEqual(['a']);
  });

  it('survives the trip through the link', () => {
    const f: ProductFilters = { query: 'tortilla 1kg', showInactive: true, brand: 'b1', category: 'none', weight: 'suggested' };
    expect(productFiltersFromParams(new URLSearchParams(productFiltersToParams(f)))).toEqual(f);
  });
});
