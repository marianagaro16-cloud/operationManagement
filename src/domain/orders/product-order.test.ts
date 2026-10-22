import { describe, expect, it } from 'vitest';
import { blueCornLast, isBlueCorn } from './product-order';

const p = (id: string, category: string | null) => ({ id, category_info: category ? { name: category } : null });

describe('blue corn last', () => {
  it('knows blue corn by its category', () => {
    expect(isBlueCorn(p('a', 'Blue tortilla'))).toBe(true);
    expect(isBlueCorn(p('b', 'Blue fried tortilla'))).toBe(true);
    expect(isBlueCorn(p('c', 'Yellow tortilla'))).toBe(false);
    expect(isBlueCorn(p('d', null))).toBe(false);
  });

  it('moves blue corn to the end and keeps each half in order', () => {
    const list = [p('1', 'Blue tortilla'), p('2', 'Yellow tortilla'), p('3', 'Blue tostadas'), p('4', null), p('5', 'Yellow tostadas')];
    expect(blueCornLast(list).map((x) => x.id)).toEqual(['2', '4', '5', '1', '3']);
  });
});
