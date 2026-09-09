import { describe, it, expect } from 'vitest';
import { planTemplateRefresh, planIsEmpty, type RefreshItem, type RefreshProduct } from './refresh';

const product = (id: string, name: string, family = 'Tortillas', code: string | null = null): RefreshProduct =>
  ({ id, name, family, code });

const item = (id: string, over: Partial<RefreshItem> = {}): RefreshItem => ({
  id,
  name: id,
  product_id: null,
  item_group: 'Tortillas',
  sort_order: 10,
  is_active: true,
  ...over,
});

describe('planning a refresh from the product list', () => {
  it('adds a product that has no item yet', () => {
    const plan = planTemplateRefresh([product('p1', 'Tortilla 1kg')], []);
    expect(plan.insert).toEqual([
      { name: 'Tortilla 1kg', item_group: 'Tortillas', product_id: 'p1', sort_order: 10 },
    ]);
    expect(plan.deactivate).toEqual([]);
  });

  it('leaves a product that is already there', () => {
    const plan = planTemplateRefresh(
      [product('p1', 'Tortilla 1kg')],
      [item('i1', { product_id: 'p1', sort_order: 10 })],
    );
    expect(plan.insert).toEqual([]);
    expect(plan.reactivate).toEqual([]);
    expect(plan.deactivate).toEqual([]);
    expect(planIsEmpty(plan)).toBe(true);
  });

  /*
   * Switched off, never deleted. A count may already reference the item, and
   * the schema refuses to delete one that does — history outranks tidiness.
   */
  it('deactivates an item whose product left the brand', () => {
    const plan = planTemplateRefresh([], [item('i1', { product_id: 'gone' })]);
    expect(plan.deactivate).toEqual(['i1']);
    expect(plan.insert).toEqual([]);
  });

  it('reactivates an item whose product came back', () => {
    const plan = planTemplateRefresh(
      [product('p1', 'Tortilla 1kg')],
      [item('i1', { product_id: 'p1', is_active: false, sort_order: 10 })],
    );
    expect(plan.reactivate).toEqual(['i1']);
    expect(plan.insert).toEqual([]);
  });

  it('does not deactivate an item that is already inactive', () => {
    const plan = planTemplateRefresh([], [item('i1', { product_id: 'gone', is_active: false })]);
    expect(plan.deactivate).toEqual([]);
  });

  /*
   * The rule that keeps this button from being quietly destructive: an item
   * nobody linked to a product was added by hand, and a refresh FROM PRODUCTS
   * knows nothing about it.
   */
  it('never touches a hand-added item that has no product', () => {
    const plan = planTemplateRefresh([], [item('i1', { product_id: null })]);
    expect(plan.deactivate).toEqual([]);
    expect(plan.reposition).toEqual([]);
    expect(plan.untouched).toBe(1);
  });

  it('orders by product family, then by name', () => {
    const plan = planTemplateRefresh(
      [
        product('p3', 'Salsa Verde', 'Salsas'),
        product('p1', 'Tortilla Azul', 'Tortillas'),
        product('p2', 'Mezcal Bruxo', 'Mezcal'),
      ],
      [],
    );
    expect(plan.insert.map((i) => i.name)).toEqual(['Mezcal Bruxo', 'Salsa Verde', 'Tortilla Azul']);
    expect(plan.insert.map((i) => i.sort_order)).toEqual([10, 20, 30]);
  });

  it('repositions an existing item so the list keeps matching the shelf', () => {
    const plan = planTemplateRefresh(
      [product('p1', 'Aaa', 'Mezcal'), product('p2', 'Bbb', 'Mezcal')],
      [item('i2', { product_id: 'p2', sort_order: 10, item_group: 'Old group' })],
    );
    expect(plan.reposition).toEqual([{ id: 'i2', item_group: 'Mezcal', sort_order: 20 }]);
  });

  // Two rows on the shelf are two rows to count.
  it('suffixes a repeated product name with its code rather than collapsing it', () => {
    const plan = planTemplateRefresh(
      [product('p1', 'Tortilla 0.5kg', 'Tortillas', '0031'),
       product('p2', 'Tortilla 0.5kg', 'Tortillas', '0286')],
      [],
    );
    expect(plan.insert.map((i) => i.name)).toEqual(['Tortilla 0.5kg', 'Tortilla 0.5kg · 0286']);
  });

  it('falls back to the family when a product has no name', () => {
    const plan = planTemplateRefresh([{ id: 'p1', name: null, family: 'Queso', code: null }], []);
    expect(plan.insert[0].name).toBe('Queso');
  });

  it('reports an empty plan when the list already matches', () => {
    expect(planIsEmpty(planTemplateRefresh([], []))).toBe(true);
    expect(planIsEmpty(planTemplateRefresh([product('p1', 'X')], []))).toBe(false);
  });

  it('handles a full swap: everything new, everything old retired', () => {
    const plan = planTemplateRefresh(
      [product('p2', 'New thing', 'Salsas')],
      [item('i1', { product_id: 'p1' })],
    );
    expect(plan.insert).toHaveLength(1);
    expect(plan.deactivate).toEqual(['i1']);
  });
});
