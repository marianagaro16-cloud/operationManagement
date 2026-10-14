import { describe, it, expect } from 'vitest';
import { localToUtc } from './schedule';
import {
  alertText,
  isQuietHour,
  selectReminderAlerts,
  type NotifiableReminder,
  type SentAlert,
} from './notifications';

const Z = 'Europe/Zurich';
const at = (local: string) => localToUtc(local.slice(0, 10), local.slice(11), Z)!;

function reminder(over: Partial<NotifiableReminder> = {}): NotifiableReminder {
  return {
    id: 'r1',
    title: 'Call Carlos about replacement',
    next_at: at('2026-09-16T10:00'),
    timezone: Z,
    notify_before_minutes: null,
    participant_ids: ['u1'],
    ...over,
  };
}

const sent = (kind: SentAlert['kind'], step: number, slot: string, id = 'r1'): SentAlert =>
  ({ reminder_id: id, kind, step, slot_at: slot });

describe('before the moment', () => {
  it('sends nothing without an early warning', () => {
    expect(selectReminderAlerts([reminder()], [], at('2026-09-16T09:50'))).toEqual([]);
  });

  it('ignores an early warning kept on an older reminder', () => {
    const r = reminder({ notify_before_minutes: 15 });
    expect(selectReminderAlerts([r], [], at('2026-09-16T09:46'))).toEqual([]);
  });
});

describe('at the moment', () => {
  it('sends the due alert once', () => {
    const r = reminder();
    const [alert] = selectReminderAlerts([r], [], at('2026-09-16T10:02'));
    expect(alert).toMatchObject({ kind: 'due', step: 0, recipients: ['u1'], time: '10:00' });
    expect(selectReminderAlerts([r], [sent('due', 0, r.next_at)], at('2026-09-16T10:07'))).toEqual([]);
  });

  it('recognises the ledger row whatever form the timestamp came back in', () => {
    const r = reminder();
    const postgresForm = '2026-09-16 08:00:00+00';
    expect(selectReminderAlerts([r], [sent('due', 0, postgresForm)], at('2026-09-16T10:05'))).toEqual([]);
  });

  it('is sent even at night: somebody chose that time', () => {
    const r = reminder({ next_at: at('2026-09-16T23:30') });
    expect(selectReminderAlerts([r], [], at('2026-09-16T23:31'))[0]?.kind).toBe('due');
  });

  it('goes to every participant of a shared reminder', () => {
    const r = reminder({ participant_ids: ['u1', 'u2', 'u3'] });
    expect(selectReminderAlerts([r], [], at('2026-09-16T10:00'))[0].recipients).toEqual(['u1', 'u2', 'u3']);
  });
});

describe('overdue', () => {
  const r = reminder();
  const slot = r.next_at;
  const done = [sent('due', 0, slot)];

  it('stays quiet between the due alert and the first hour', () => {
    expect(selectReminderAlerts([r], done, at('2026-09-16T10:50'))).toEqual([]);
  });

  it('repeats once, 1 hour after — and then stops', () => {
    expect(selectReminderAlerts([r], done, at('2026-09-16T11:01'))[0]).toMatchObject({ kind: 'overdue', step: 1 });

    const after1 = [...done, sent('overdue', 1, slot)];
    expect(selectReminderAlerts([r], after1, at('2026-09-16T14:00'))).toEqual([]);
    expect(selectReminderAlerts([r], after1, at('2026-09-19T10:00'))).toEqual([]);
  });

  it('sends one alert, not a backlog, after the scheduler was down', () => {
    const alerts = selectReminderAlerts([r], [], at('2026-09-17T10:30'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'overdue', step: 1 });
  });

  it('is held during quiet hours and sent when they end', () => {
    const evening = reminder({ next_at: at('2026-09-16T21:30') });
    const due = [sent('due', 0, evening.next_at)];
    // 1 hour later is 22:30 — quiet.
    expect(selectReminderAlerts([evening], due, at('2026-09-16T22:35'))).toEqual([]);
    expect(selectReminderAlerts([evening], due, at('2026-09-17T07:00'))[0]).toMatchObject({ step: 1 });
  });
});

describe('snooze and recurrence', () => {
  it('gives a snoozed reminder a fresh due alert at its new moment', () => {
    const original = at('2026-09-16T10:00');
    const snoozed = reminder({ next_at: at('2026-09-16T11:00') });
    const ledger = [sent('due', 0, original), sent('overdue', 1, original)];
    expect(selectReminderAlerts([snoozed], ledger, at('2026-09-16T11:00'))[0]).toMatchObject({ kind: 'due' });
  });

  it('gives the next occurrence of a recurring reminder its own alerts', () => {
    const lastWeek = at('2026-09-09T10:00');
    const thisWeek = reminder({ next_at: at('2026-09-16T10:00') });
    const ledger = [sent('due', 0, lastWeek), sent('overdue', 1, lastWeek)];
    expect(selectReminderAlerts([thisWeek], ledger, at('2026-09-16T10:01'))[0]).toMatchObject({ kind: 'due' });
  });

  it('keeps one reminder\'s ledger from silencing another', () => {
    const a = reminder({ id: 'a' });
    const b = reminder({ id: 'b' });
    const ledger = [sent('due', 0, a.next_at, 'a')];
    const alerts = selectReminderAlerts([a, b], ledger, at('2026-09-16T10:01'));
    expect(alerts.map((x) => x.reminderId)).toEqual(['b']);
  });
});

describe('nobody to tell', () => {
  it('sends nothing for a reminder with no eligible participants left', () => {
    expect(selectReminderAlerts([reminder({ participant_ids: [] })], [], at('2026-09-16T10:00'))).toEqual([]);
  });
});

describe('text and quiet hours', () => {
  it('uses the reminder as the title', () => {
    const [alert] = selectReminderAlerts([reminder()], [], at('2026-09-16T10:00'));
    expect(alertText(alert)).toEqual({ title: 'Call Carlos about replacement', body: 'Recordatorio · 10:00' });
  });

  it('treats 22:00-07:00 Zurich as quiet', () => {
    expect(isQuietHour(at('2026-09-16T21:59'), Z)).toBe(false);
    expect(isQuietHour(at('2026-09-16T22:00'), Z)).toBe(true);
    expect(isQuietHour(at('2026-09-17T06:59'), Z)).toBe(true);
    expect(isQuietHour(at('2026-09-17T07:00'), Z)).toBe(false);
  });
});
