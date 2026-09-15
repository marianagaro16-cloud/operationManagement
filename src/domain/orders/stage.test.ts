import { describe, it, expect } from 'vitest';
import { orderStage, stageWeight } from './stage';

const lot = [{ id: 'a' }];

describe('order stage', () => {
  it('follows the commercial status first', () => {
    expect(orderStage({ status: 'draft', lines: [{ allocations: lot }] })).toBe('draft');
    expect(orderStage({ status: 'cancelled', ready_at: 'x' })).toBe('cancelled');
  });

  it('is to prepare until a first lot is recorded, then in preparation', () => {
    expect(orderStage({ status: 'confirmed', lines: [{ allocations: [] }, { allocations: null }] })).toBe('to_prepare');
    expect(orderStage({ status: 'confirmed', lines: [{ allocations: [] }, { allocations: lot }] })).toBe('in_preparation');
  });

  it('is ready once marked, and shipped once shipped', () => {
    expect(orderStage({ status: 'confirmed', ready_at: 'x', lines: [{ allocations: lot }] })).toBe('ready');
    expect(orderStage({ status: 'confirmed', ready_at: 'x', shipped_at: 'y' })).toBe('shipped');
  });

  it('puts work still to do before finished work', () => {
    const order = ['shipped', 'to_prepare', 'ready', 'in_preparation'] as const;
    expect([...order].sort((a, b) => stageWeight(a) - stageWeight(b))).toEqual(['in_preparation', 'to_prepare', 'ready', 'shipped']);
  });
});
