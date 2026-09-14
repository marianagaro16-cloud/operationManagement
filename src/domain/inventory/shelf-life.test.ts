import { describe, it, expect } from 'vitest';
import { shelfLifeThreshold, shortShelfLife, shortShelfLifeAlert, type ShelfLifeItem } from './shelf-life';

const COUNT = '2026-09-14';

const item = (id: string, name: string, entries: ShelfLifeItem['entries']): ShelfLifeItem =>
  ({ id, item_name: name, entries });

describe('threshold', () => {
  it('is three calendar months after the count date', () => {
    expect(shelfLifeThreshold(COUNT, 3)).toBe('2026-12-14');
  });

  it('clamps to the end of a short month', () => {
    expect(shelfLifeThreshold('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('short shelf life', () => {
  it('flags stock expiring before the threshold, and not on or after it', () => {
    const lines = shortShelfLife([
      item('a', 'Salsa verde', [{ quantity: 4, expiry_date: '2026-12-13' }]),
      item('b', 'Tostadas', [{ quantity: 6, expiry_date: '2026-12-14' }]),
      item('c', 'Frijoles', [{ quantity: 2, expiry_date: '2027-05-01' }]),
    ], COUNT, 3);
    expect(lines.map((l) => l.itemName)).toEqual(['Salsa verde']);
    expect(lines[0]).toMatchObject({ expiryDate: '2026-12-13', quantity: 4, daysLeft: 90 });
  });

  it('includes stock that has already expired, with negative days left', () => {
    const [line] = shortShelfLife([item('a', 'Chipotle', [{ quantity: 1, expiry_date: '2026-09-01' }])], COUNT, 3);
    expect(line.daysLeft).toBe(-13);
  });

  it('ignores entries without an expiry date, without a quantity, or counted as zero', () => {
    expect(shortShelfLife([
      item('a', 'A', [{ quantity: 5, expiry_date: null }]),
      item('b', 'B', [{ quantity: null, expiry_date: '2026-10-01' }]),
      item('c', 'C', [{ quantity: 0, expiry_date: '2026-10-01' }]),
    ], COUNT, 3)).toEqual([]);
  });

  it('adds up one batch counted in two places', () => {
    const lines = shortShelfLife([item('a', 'Salsa', [
      { quantity: 3, expiry_date: '2026-10-10' },
      { quantity: 2, expiry_date: '2026-10-10' },
      { quantity: 7, expiry_date: '2026-11-01' },
    ])], COUNT, 3);
    expect(lines.map((l) => [l.expiryDate, l.quantity])).toEqual([['2026-10-10', 5], ['2026-11-01', 7]]);
  });

  it('lists the soonest to expire first', () => {
    const lines = shortShelfLife([
      item('a', 'Later', [{ quantity: 1, expiry_date: '2026-11-20' }]),
      item('b', 'Sooner', [{ quantity: 1, expiry_date: '2026-10-02' }]),
    ], COUNT, 3);
    expect(lines.map((l) => l.itemName)).toEqual(['Sooner', 'Later']);
  });
});

describe('alert text', () => {
  it('counts products, names the first three and says how many more', () => {
    const lines = shortShelfLife([
      item('a', 'Salsa', [{ quantity: 1, expiry_date: '2026-10-01' }, { quantity: 1, expiry_date: '2026-10-05' }]),
      item('b', 'Tostadas', [{ quantity: 1, expiry_date: '2026-10-02' }]),
      item('c', 'Mole', [{ quantity: 1, expiry_date: '2026-11-02' }]),
    ], COUNT, 3);
    const { title, body } = shortShelfLifeAlert('Complementarios', 38, 3, lines);
    expect(title).toBe('Complementarios — caducidad corta');
    expect(body).toBe('3 productos vencen en menos de 3 meses · KW 38: Salsa (01.10.2026), Tostadas (02.10.2026), Salsa (05.10.2026) y 1 más');
  });
});
