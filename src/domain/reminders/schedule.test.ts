import { describe, it, expect } from 'vitest';
import {
  advanceAfterCompletion,
  localToUtc,
  nextOccurrence,
  daysFromToday,
  isOnDay,
  personalTaskPhase,
  reminderPhase,
  snoozeUntil,
  utcToLocal,
} from './schedule';

/** Runs under TZ=America/New_York; every expectation is in Europe/Zurich. */
const Z = 'Europe/Zurich';
const at = (local: string) => localToUtc(local.slice(0, 10), local.slice(11), Z)!;
const local = (iso: string | null) => (iso ? `${utcToLocal(iso, Z).date}T${utcToLocal(iso, Z).time}` : null);

describe('local time <-> moment', () => {
  it('stores 10:00 in Zurich as 08:00 UTC in summer and 09:00 UTC in winter', () => {
    expect(localToUtc('2026-09-15', '10:00', Z)).toBe('2026-09-15T08:00:00.000Z');
    expect(localToUtc('2026-12-15', '10:00', Z)).toBe('2026-12-15T09:00:00.000Z');
  });

  it('round-trips', () => {
    expect(utcToLocal('2026-09-15T08:00:00.000Z', Z)).toEqual({ date: '2026-09-15', time: '10:00' });
  });

  it('rejects an impossible date', () => {
    expect(localToUtc('2026-02-30', '10:00', Z)).toBeNull();
  });
});

describe('one-off reminders', () => {
  it('have no next occurrence', () => {
    expect(nextOccurrence('none', at('2026-09-15T10:00'), at('2026-09-15T11:00'), Z)).toBeNull();
  });
});

describe('daily', () => {
  it('is the same time the next day', () => {
    expect(local(nextOccurrence('daily', at('2026-09-15T10:00'), at('2026-09-15T10:00'), Z)))
      .toBe('2026-09-16T10:00');
  });

  it('is the anchor itself while the anchor is still ahead', () => {
    expect(local(nextOccurrence('daily', at('2026-09-20T10:00'), at('2026-09-15T12:00'), Z)))
      .toBe('2026-09-20T10:00');
  });

  it('keeps 09:00 across the October DST change', () => {
    expect(local(nextOccurrence('daily', at('2026-10-24T09:00'), at('2026-10-24T09:30'), Z)))
      .toBe('2026-10-25T09:00');
    expect(local(nextOccurrence('daily', at('2026-10-24T09:00'), at('2026-10-25T09:30'), Z)))
      .toBe('2026-10-26T09:00');
  });

  it('finds the right day for a series started long ago', () => {
    expect(local(nextOccurrence('daily', at('2025-01-01T07:30'), at('2026-09-15T08:00'), Z)))
      .toBe('2026-09-16T07:30');
  });
});

describe('weekdays', () => {
  it('skips from Friday to Monday', () => {
    // 2026-09-18 is a Friday.
    expect(local(nextOccurrence('weekdays', at('2026-09-14T08:00'), at('2026-09-18T08:00'), Z)))
      .toBe('2026-09-21T08:00');
  });

  it('is later the same day when the time has not come yet', () => {
    expect(local(nextOccurrence('weekdays', at('2026-09-14T16:00'), at('2026-09-16T09:00'), Z)))
      .toBe('2026-09-16T16:00');
  });

  it('never lands on a weekend even if the anchor did', () => {
    // 2026-09-19 is a Saturday.
    expect(local(nextOccurrence('weekdays', at('2026-09-19T10:00'), at('2026-09-18T12:00'), Z)))
      .toBe('2026-09-21T10:00');
  });
});

describe('weekly', () => {
  it('is the same weekday and time a week later', () => {
    expect(local(nextOccurrence('weekly', at('2026-09-18T16:00'), at('2026-09-18T16:00'), Z)))
      .toBe('2026-09-25T16:00');
  });

  it('skips weeks that have already passed', () => {
    expect(local(nextOccurrence('weekly', at('2026-08-07T16:00'), at('2026-09-15T00:00'), Z)))
      .toBe('2026-09-18T16:00');
  });
});

describe('monthly', () => {
  it('clamps the 31st to the end of a short month and returns to the 31st', () => {
    const anchor = at('2026-01-31T09:00');
    expect(local(nextOccurrence('monthly', anchor, at('2026-01-31T09:00'), Z))).toBe('2026-02-28T09:00');
    expect(local(nextOccurrence('monthly', anchor, at('2026-02-28T09:00'), Z))).toBe('2026-03-31T09:00');
    expect(local(nextOccurrence('monthly', anchor, at('2026-03-31T09:00'), Z))).toBe('2026-04-30T09:00');
    expect(local(nextOccurrence('monthly', anchor, at('2026-04-30T09:00'), Z))).toBe('2026-05-31T09:00');
  });
});

describe('completing a recurring occurrence', () => {
  it('advances to the next occurrence after the one completed', () => {
    const anchor = at('2026-09-18T16:00');
    expect(local(advanceAfterCompletion('weekly', anchor, anchor, at('2026-09-18T15:00'), Z)))
      .toBe('2026-09-25T16:00');
  });

  it('does not land on occurrences already missed', () => {
    const anchor = at('2026-09-10T09:00');
    // Three days overdue, completed on the 15th at 11:00: tomorrow, not the 13th.
    expect(local(advanceAfterCompletion('daily', anchor, at('2026-09-12T09:00'), at('2026-09-15T11:00'), Z)))
      .toBe('2026-09-16T09:00');
  });
});

describe('snooze', () => {
  const now = at('2026-09-15T14:20');

  it('adds the chosen span', () => {
    expect(local(snoozeUntil('10m', now, Z))).toBe('2026-09-15T14:30');
    expect(local(snoozeUntil('1h', now, Z))).toBe('2026-09-15T15:20');
    expect(local(snoozeUntil('3h', now, Z))).toBe('2026-09-15T17:20');
  });

  it('means 09:00 tomorrow for "tomorrow"', () => {
    expect(local(snoozeUntil('tomorrow', now, Z))).toBe('2026-09-16T09:00');
  });
});

describe('phase', () => {
  const now = at('2026-09-15T14:00');

  it('is overdue once the moment has passed', () => {
    expect(reminderPhase('open', at('2026-09-15T13:59'), now, Z)).toBe('overdue');
  });

  it('is today for later today, upcoming from tomorrow', () => {
    expect(reminderPhase('open', at('2026-09-15T23:59'), now, Z)).toBe('today');
    expect(reminderPhase('open', at('2026-09-16T00:00'), now, Z)).toBe('upcoming');
  });

  it('is the stored status once closed, however late', () => {
    expect(reminderPhase('completed', at('2026-01-01T00:00'), now, Z)).toBe('completed');
    expect(reminderPhase('cancelled', at('2026-01-01T00:00'), now, Z)).toBe('cancelled');
    expect(reminderPhase('converted', at('2026-01-01T00:00'), now, Z)).toBe('converted');
  });

  it('judges a personal task by its date, and by its time only when it has one', () => {
    expect(personalTaskPhase('open', null, null, now, Z)).toBe('undated');
    expect(personalTaskPhase('open', '2026-09-14', null, now, Z)).toBe('overdue');
    expect(personalTaskPhase('open', '2026-09-15', null, now, Z)).toBe('today');
    expect(personalTaskPhase('open', '2026-09-15', '13:00', now, Z)).toBe('overdue');
    expect(personalTaskPhase('open', '2026-09-15', '15:00', now, Z)).toBe('today');
    expect(personalTaskPhase('open', '2026-09-16', null, now, Z)).toBe('upcoming');
    expect(personalTaskPhase('completed', '2026-09-14', null, now, Z)).toBe('completed');
    // In progress is still open work, judged by its date like any other.
    expect(personalTaskPhase('in_progress', '2026-09-14', null, now, Z)).toBe('overdue');
    expect(personalTaskPhase('in_progress', null, null, now, Z)).toBe('undated');
  });
});

describe('personal task days', () => {
  it('counts calendar days from today', () => {
    expect(daysFromToday('2026-09-17', '2026-09-17')).toBe(0);
    expect(daysFromToday('2026-09-18', '2026-09-17')).toBe(1);
    expect(daysFromToday('2026-09-16', '2026-09-17')).toBe(-1);
    expect(daysFromToday('2026-10-01', '2026-09-17')).toBe(14);
  });

  it('is not thrown by a DST change in between', () => {
    expect(daysFromToday('2026-10-26', '2026-10-24')).toBe(2);
  });

  it('places an instant on the business day, not the UTC one', () => {
    // 23:30 UTC on the 16th is already the 17th in Zurich.
    expect(isOnDay('2026-09-16T23:30:00Z', '2026-09-17', 'Europe/Zurich')).toBe(true);
    expect(isOnDay('2026-09-16T21:30:00Z', '2026-09-17', 'Europe/Zurich')).toBe(false);
    expect(isOnDay(null, '2026-09-17')).toBe(false);
  });
});
