import { describe, it, expect } from 'vitest';
import {
  deliversOn,
  nextStandingDelivery,
  standingDeliveryDates,
  type StandingCadence,
} from './scheduling';

/**
 * Standing order cadence.
 *
 * Worth testing because a wrong answer here is invisible until a customer
 * does not get their delivery: the screen would show one date, the scheduler
 * would create another, and nobody would notice until the pallet was missing.
 *
 * 2026-09-01 is a Tuesday. Every fixture below is anchored to that week.
 */
const weekly: StandingCadence = { weekday: 2, intervalWeeks: 1, anchorDate: null };
const fortnightly: StandingCadence = {
  weekday: 2,
  intervalWeeks: 2,
  anchorDate: '2026-09-01',
};

describe('weekly', () => {
  it('delivers on every matching weekday', () => {
    for (const d of ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22']) {
      expect(deliversOn(weekly, d)).toBe(true);
    }
  });

  it('never delivers on another weekday', () => {
    // 2026-09-02 is a Wednesday.
    expect(deliversOn(weekly, '2026-09-02')).toBe(false);
  });

  it('needs no anchor', () => {
    expect(deliversOn({ weekday: 2, intervalWeeks: 1, anchorDate: null }, '2026-09-15')).toBe(true);
  });
});

describe('every second week', () => {
  it('delivers on the anchor week and every second week after', () => {
    expect(deliversOn(fortnightly, '2026-09-01')).toBe(true);
    expect(deliversOn(fortnightly, '2026-09-15')).toBe(true);
    expect(deliversOn(fortnightly, '2026-09-29')).toBe(true);
  });

  it('skips the weeks between', () => {
    expect(deliversOn(fortnightly, '2026-09-08')).toBe(false);
    expect(deliversOn(fortnightly, '2026-09-22')).toBe(false);
  });

  it('counts symmetrically BEFORE the anchor', () => {
    // "Every second Tuesday" must mean the same thing looking backwards, or a
    // template anchored today would answer differently about last month than
    // one anchored last month would about today.
    expect(deliversOn(fortnightly, '2026-08-18')).toBe(true);
    expect(deliversOn(fortnightly, '2026-08-25')).toBe(false);
  });

  it('does not care which weekday the anchor was written as', () => {
    // Friday 2026-09-04 is in the same week as Tuesday 2026-09-01, so it
    // describes the same cadence.
    const viaFriday: StandingCadence = { weekday: 2, intervalWeeks: 2, anchorDate: '2026-09-04' };
    for (const d of ['2026-09-01', '2026-09-15', '2026-09-08', '2026-09-22']) {
      expect(deliversOn(viaFriday, d)).toBe(deliversOn(fortnightly, d));
    }
  });

  it('refuses to guess when the anchor is missing', () => {
    // The database enforces this too; here it fails closed rather than
    // silently behaving as though it were weekly.
    expect(deliversOn({ weekday: 2, intervalWeeks: 2, anchorDate: null }, '2026-09-01')).toBe(false);
  });
});

describe('dates within a window', () => {
  it('lists every weekly delivery, inclusive of both ends', () => {
    expect(standingDeliveryDates(weekly, '2026-09-01', '2026-09-22')).toEqual([
      '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22',
    ]);
  });

  it('lists only the on-cadence dates for a fortnightly template', () => {
    expect(standingDeliveryDates(fortnightly, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01', '2026-09-15', '2026-09-29',
    ]);
  });

  it('returns nothing when the window contains no matching weekday', () => {
    // Wednesday to Friday cannot contain a Tuesday.
    expect(standingDeliveryDates(weekly, '2026-09-02', '2026-09-04')).toEqual([]);
  });

  it('starts from a window opening mid-week', () => {
    expect(standingDeliveryDates(weekly, '2026-09-03', '2026-09-10')).toEqual(['2026-09-08']);
  });

  it('does not skip past an off-cadence week', () => {
    // Stepping by the interval from an off-cadence date would stay off
    // cadence forever and produce nothing at all.
    expect(standingDeliveryDates(fortnightly, '2026-09-08', '2026-09-16')).toEqual(['2026-09-15']);
  });
});

describe('next delivery', () => {
  it('is today when today is on cadence', () => {
    expect(nextStandingDelivery(weekly, '2026-09-08')).toBe('2026-09-08');
  });

  it('skips to the next on-cadence week for a fortnightly template', () => {
    expect(nextStandingDelivery(fortnightly, '2026-09-08')).toBe('2026-09-15');
  });

  it('finds a delivery even at the widest interval', () => {
    const yearly: StandingCadence = { weekday: 2, intervalWeeks: 52, anchorDate: '2026-09-01' };
    expect(nextStandingDelivery(yearly, '2026-09-02')).toBe('2027-08-31');
  });
});
