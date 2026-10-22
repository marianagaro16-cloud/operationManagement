import { describe, expect, it } from 'vitest';
import { defaultExpiry, requiredTrainings, trainingExpiries, trainingStatus } from './trainings';

const kinds = [
  { id: 'haccp', name: 'HACCP', validity_months: 24, required_teams: ['production' as const], is_active: true },
  { id: 'safety', name: 'Seguridad', validity_months: null, required_teams: ['production' as const, 'logistics' as const], is_active: true },
  { id: 'forklift', name: 'Carretilla', validity_months: 60, required_teams: [], is_active: true },
];

describe('trainings', () => {
  it('fills the expiry from the validity', () => {
    expect(defaultExpiry('2026-10-01', 24)).toBe('2028-09-30');
    expect(defaultExpiry('2026-01-31', 1)).toBe('2026-02-27');
    expect(defaultExpiry('2026-10-01', null)).toBeNull();
  });

  it('says how a training stands', () => {
    expect(trainingStatus(undefined, '2026-10-22')).toBe('missing');
    expect(trainingStatus({ expires_on: null }, '2026-10-22')).toBe('ok');
    expect(trainingStatus({ expires_on: '2026-10-21' }, '2026-10-22')).toBe('expired');
    expect(trainingStatus({ expires_on: '2026-11-21' }, '2026-10-22')).toBe('expiring');
    expect(trainingStatus({ expires_on: '2026-11-22' }, '2026-10-22')).toBe('ok');
  });

  it('only the latest training of a kind counts', () => {
    const trainings = [
      { id: 'old', worker_id: 'ana', kind_id: 'haccp', done_on: '2024-01-10', expires_on: '2026-01-09' },
      { id: 'new', worker_id: 'ana', kind_id: 'haccp', done_on: '2026-01-05', expires_on: '2028-01-04' },
    ];
    expect(trainingExpiries(trainings, kinds)).toEqual([{ id: 'new', worker_id: 'ana', label: 'HACCP', on_date: '2028-01-04' }]);
    const required = requiredTrainings({ id: 'ana', team: 'production' }, kinds, trainings, '2026-10-22');
    expect(required.map((r) => [r.kind.id, r.status])).toEqual([['haccp', 'ok'], ['safety', 'missing']]);
    expect(requiredTrainings({ id: 'bo', team: 'sales' }, kinds, trainings, '2026-10-22')).toEqual([]);
  });
});
