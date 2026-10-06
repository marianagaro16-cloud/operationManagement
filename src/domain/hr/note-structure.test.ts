import { describe, expect, it } from 'vitest';
import { EMPTY_CONTENT, followUpState, missingContent, warningNumbers } from './note-structure';

const conversation = {
  ...EMPTY_CONTENT,
  sections: { reason: 'Tiempos muertos', points: 'Acomodo del maíz', agreements: 'Avisar al terminar' },
};

describe('missingContent', () => {
  it('asks for every compulsory section', () => {
    expect(missingContent('recognition', EMPTY_CONTENT, '2026-10-06')).toEqual(['what', 'impact', 'why', 'how']);
  });

  it('a recognition has no follow-up to fill in', () => {
    const c = { ...EMPTY_CONTENT, sections: { what: 'a', impact: 'b', why: 'c', how: 'd' } };
    expect(missingContent('recognition', c, '2026-10-06')).toEqual([]);
  });

  it('a conversation needs a follow-up, or the reason there is none', () => {
    expect(missingContent('conversation', conversation, '2026-10-06')).toEqual(['follow_up_text', 'follow_up_on']);
    expect(missingContent('conversation', { ...conversation, no_follow_up: true }, '2026-10-06')).toEqual(['no_follow_up_reason']);
    expect(
      missingContent('conversation', { ...conversation, no_follow_up: true, no_follow_up_reason: 'Tema cerrado' }, '2026-10-06'),
    ).toEqual([]);
    expect(
      missingContent('conversation', { ...conversation, follow_up_text: 'Revisar', follow_up_on: '2026-10-20' }, '2026-10-06'),
    ).toEqual([]);
  });

  it('the follow-up cannot be before the note', () => {
    const c = { ...conversation, follow_up_text: 'Revisar', follow_up_on: '2026-10-01' };
    expect(missingContent('conversation', c, '2026-10-06')).toEqual(['follow_up_on']);
  });

  it('a warning needs its level', () => {
    const sections = { what: 'a', rule: 'b', response: 'c', agreements: 'd', consequence: 'e' };
    const c = { ...EMPTY_CONTENT, sections, no_follow_up: true, no_follow_up_reason: 'x' };
    expect(missingContent('warning', c, '2026-10-06')).toEqual(['level']);
    expect(missingContent('warning', { ...c, warning_level: 'written' }, '2026-10-06')).toEqual([]);
  });

  it('the general structure may skip the follow-up, but not half of it', () => {
    const c = { ...EMPTY_CONTENT, sections: { reason: 'a', detail: 'b' } };
    expect(missingContent('general', c, '2026-10-06')).toEqual([]);
    expect(missingContent('general', { ...c, follow_up_text: 'Revisar' }, '2026-10-06')).toEqual(['follow_up_on']);
  });
});

describe('followUpState', () => {
  const today = '2026-10-06';

  it('follows the note until an entry says otherwise', () => {
    expect(followUpState({ follow_up_on: null, follow_ups: [] }, today)).toEqual({ status: 'none', dueOn: null });
    expect(followUpState({ follow_up_on: '2026-10-06', follow_ups: [] }, today).status).toBe('open');
    expect(followUpState({ follow_up_on: '2026-10-05', follow_ups: [] }, today).status).toBe('overdue');
  });

  it('the latest entry decides', () => {
    const moved = { follow_up_on: '2026-10-01', follow_ups: [{ closes: false, next_on: '2026-10-20' }] };
    expect(followUpState(moved, today)).toEqual({ status: 'open', dueOn: '2026-10-20' });
    const closed = { ...moved, follow_ups: [...moved.follow_ups, { closes: true, next_on: null }] };
    expect(followUpState(closed, today)).toEqual({ status: 'closed', dueOn: null });
  });
});

describe('warningNumbers', () => {
  it('counts a worker\'s warnings in the order they happened', () => {
    const note = (id: string, note_date: string, structure: string) => ({ id, note_date, created_at: `${note_date}T10:00:00Z`, type: { structure } });
    const numbers = warningNumbers([
      note('c', '2026-09-01', 'warning'),
      note('x', '2026-08-01', 'conversation'),
      note('a', '2025-03-01', 'warning'),
      note('b', '2026-02-01', 'warning'),
    ]);
    expect([numbers.get('a'), numbers.get('b'), numbers.get('c'), numbers.get('x')]).toEqual([1, 2, 3, undefined]);
  });
});
