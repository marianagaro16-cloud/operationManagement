import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONTENT,
  agreementStatus,
  filledAgreements,
  followUpState,
  mayBeConfidential,
  noteForm,
  missingContent,
  noteSummary,
  warningNumbers,
  type AgreementResult,
  type NoteContent,
  type NoteTopic,
} from './note-structure';

const juan = { profile_id: null, worker_id: 'w1', name: 'Juan' };
const agreement = { body: 'Avisar al terminar', responsible: juan, due_on: '' };

const conversation: NoteContent = {
  ...EMPTY_CONTENT,
  topic: 'productivity',
  event_on: '2026-10-05',
  event_time: '07:20',
  event_area: 'production',
  sections: { reason: 'Tiempos muertos', points: 'Acomodo del maíz' },
  agreements: [agreement],
  follow_up_text: 'Revisar',
  follow_up_on: '2026-10-20',
};

describe('missingContent', () => {
  it('asks for the topic and every compulsory section', () => {
    expect(missingContent('recognition', EMPTY_CONTENT, '2026-10-06')).toEqual(['topic', 'what', 'impact', 'why', 'how']);
  });

  it('a recognition has no moment, agreements or follow-up to fill in', () => {
    const c = { ...EMPTY_CONTENT, topic: 'quality' as const, sections: { what: 'a', impact: 'b', why: 'c', how: 'd' } };
    expect(missingContent('recognition', c, '2026-10-06')).toEqual([]);
  });

  it('a conversation is complete with its moment, an agreement and a follow-up', () => {
    expect(missingContent('conversation', conversation, '2026-10-06')).toEqual([]);
  });

  it('a conversation says when and where it happened, not after the note', () => {
    const c = { ...conversation, event_on: '', event_time: '', event_area: '' };
    expect(missingContent('conversation', c, '2026-10-06')).toEqual(['event_on', 'event_time', 'event_area']);
    expect(missingContent('conversation', { ...conversation, event_on: '2026-10-07' }, '2026-10-06')).toEqual(['event_on']);
  });

  it('a conversation needs at least one agreement, each with who and when', () => {
    expect(missingContent('conversation', { ...conversation, agreements: [] }, '2026-10-06')).toContain('agreements');
    // A row nothing was written in does not count.
    expect(missingContent('conversation', { ...conversation, agreements: [{ ...agreement, body: ' ' }] }, '2026-10-06')).toContain('agreements');
    expect(missingContent('conversation', { ...conversation, agreements: [{ ...agreement, responsible: null }] }, '2026-10-06')).toEqual(['agreements']);
    expect(missingContent('conversation', { ...conversation, agreements: [{ ...agreement, due_on: '2026-10-01' }] }, '2026-10-06')).toEqual(['agreements']);
  });

  it('an agreement without a date takes the day of the follow-up', () => {
    expect(filledAgreements('conversation', conversation)[0]!.due_on).toBe('2026-10-20');
    expect(filledAgreements('conversation', { ...conversation, agreements: [{ ...agreement, due_on: '2026-10-12' }] })[0]!.due_on).toBe('2026-10-12');
    expect(filledAgreements('training', conversation)).toEqual([]);
  });

  it('with agreements there is always a follow-up', () => {
    const c = { ...conversation, follow_up_text: '', follow_up_on: '', no_follow_up: true, no_follow_up_reason: 'Tema cerrado' };
    expect(missingContent('conversation', c, '2026-10-06')).toEqual(['agreements', 'follow_up_text', 'follow_up_on']);
    const general = { ...EMPTY_CONTENT, topic: 'other' as const, sections: { reason: 'a', detail: 'b' }, agreements: [agreement] };
    expect(missingContent('general', general, '2026-10-06')).toEqual(['agreements', 'follow_up_text', 'follow_up_on']);
  });

  it('the follow-up cannot be before the note', () => {
    const c = { ...conversation, follow_up_on: '2026-10-01' };
    expect(missingContent('conversation', c, '2026-10-06')).toEqual(['agreements', 'follow_up_on']);
  });

  it('a training needs a follow-up, or the reason there is none', () => {
    const c = { ...EMPTY_CONTENT, topic: 'quality' as const, sections: { topic: 'a', reason: 'b', trainer: 'c', duration: 'd', result: 'e' } };
    expect(missingContent('training', c, '2026-10-06')).toEqual(['follow_up_text', 'follow_up_on']);
    expect(missingContent('training', { ...c, no_follow_up: true }, '2026-10-06')).toEqual(['no_follow_up_reason']);
    expect(missingContent('training', { ...c, no_follow_up: true, no_follow_up_reason: 'Ya lo domina' }, '2026-10-06')).toEqual([]);
  });

  it('a warning needs its level', () => {
    const c = { ...conversation, sections: { what: 'a', rule: 'b', response: 'c', consequence: 'e' } };
    expect(missingContent('warning', c, '2026-10-06')).toEqual(['level']);
    expect(missingContent('warning', { ...c, warning_level: 'written' }, '2026-10-06')).toEqual([]);
  });

  it('the general structure may skip agreements and the follow-up, but not half of it', () => {
    const c = { ...EMPTY_CONTENT, topic: 'other' as const, sections: { reason: 'a', detail: 'b' } };
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

describe('agreements and the summary', () => {
  const results = (...list: AgreementResult[]) => ({ results: list.map((result) => ({ result })) });

  it('an agreement stands where its latest follow-up left it', () => {
    expect(agreementStatus(results())).toBe('pending');
    expect(agreementStatus(results('not_met', 'partly'))).toBe('partly');
    expect(agreementStatus(results('partly', 'met'))).toBe('met');
  });

  it('counts the last twelve months by topic and type, and how the agreements went', () => {
    const note = (note_date: string, topic: NoteTopic | null, type: string, agreements: ReturnType<typeof results>[] = []) => ({
      note_date, topic, type: { id: type }, agreements, follow_ups: [],
    });
    const summary = noteSummary(
      [
        note('2026-10-01', 'punctuality', 'warning', [results('met'), results()]),
        note('2026-06-01', 'punctuality', 'conversation', [results('not_met')]),
        note('2026-03-01', 'punctuality', 'warning'),
        note('2026-02-01', 'quality', 'recognition'),
        note('2026-01-15', null, 'conversation'),
        // More than a year ago: not counted.
        note('2025-10-06', 'attitude', 'warning', [results('met')]),
        // A note from before the sections, given its topic and agreement when completed.
        { ...note('2026-05-01', null, 'conversation'), follow_ups: [{ kind: 'completion', topic: 'quality' as const, agreements: [results('partly')] }] },
      ],
      '2026-10-06',
    );
    expect(summary.total).toBe(6);
    expect(summary.noTopic).toBe(1);
    expect(summary.topics).toEqual([
      { topic: 'punctuality', count: 3, types: [{ id: 'warning', count: 2 }, { id: 'conversation', count: 1 }] },
      { topic: 'quality', count: 2, types: [{ id: 'recognition', count: 1 }, { id: 'conversation', count: 1 }] },
    ]);
    expect(summary.agreements).toEqual({ met: 1, partly: 1, not_met: 1, pending: 1 });
  });

  it('a meeting counts once in the total and once under each of its topics', () => {
    const point = (topic: NoteTopic, ...list: AgreementResult[][]) => ({ topic, agreements: list.map((r) => results(...r)) });
    const summary = noteSummary(
      [{ note_date: '2026-10-01', topic: 'quality', type: { id: 'warning' }, agreements: [], follow_ups: [] }],
      '2026-10-06',
      [
        { meeting_date: '2026-10-05', points: [point('quality', ['met']), point('hygiene_safety', []), point('quality')] },
        { meeting_date: '2025-01-05', points: [point('rules')] },
      ],
    );
    expect(summary.total).toBe(2);
    expect(summary.topics).toEqual([
      { topic: 'quality', count: 2, types: [{ id: 'warning', count: 1 }, { id: 'meeting', count: 1 }] },
      { topic: 'hygiene_safety', count: 1, types: [{ id: 'meeting', count: 1 }] },
    ]);
    expect(summary.agreements).toEqual({ met: 1, partly: 0, not_met: 0, pending: 1 });
  });
});

describe('a conversation the employee asked for', () => {
  const asked: NoteContent = {
    ...EMPTY_CONTENT,
    asked_by: 'employee',
    topic: 'schedule_leave',
    event_on: '2026-10-05',
    event_time: '07:20',
    event_area: 'production',
    sections: { raised: 'Pide el turno de mañana', answered: 'Se revisa con producción' },
    no_follow_up: true,
    no_follow_up_reason: 'Se resolvió en el momento',
  };

  it('takes its own form only when the employee asked', () => {
    expect(noteForm('conversation', 'employee')).toBe('employee_talk');
    expect(noteForm('conversation', 'company')).toBe('conversation');
    expect(noteForm('conversation', null)).toBe('conversation');
    expect(noteForm('warning', 'employee')).toBe('warning');
  });

  it('is complete with what was raised and answered, without agreements', () => {
    expect(missingContent('employee_talk', asked, '2026-10-06')).toEqual([]);
  });

  it('needs a next step with its date, or the reason there is none', () => {
    expect(missingContent('employee_talk', { ...asked, no_follow_up: false }, '2026-10-06')).toEqual(['follow_up_text', 'follow_up_on']);
    expect(missingContent('employee_talk', { ...asked, no_follow_up_reason: '' }, '2026-10-06')).toEqual(['no_follow_up_reason']);
  });

  it('has topics of its own, and the company\'s conversation keeps its', () => {
    expect(missingContent('employee_talk', { ...asked, topic: 'productivity' }, '2026-10-06')).toEqual(['topic']);
    expect(missingContent('conversation', { ...asked, topic: 'personal' }, '2026-10-06')).toContain('topic');
  });

  it('is the only note that can be marked confidential', () => {
    expect(mayBeConfidential('conversation', 'employee')).toBe(true);
    expect(mayBeConfidential('conversation', 'company')).toBe(false);
    expect(mayBeConfidential('warning', 'employee')).toBe(false);
    expect(EMPTY_CONTENT.confidential).toBe(false);
  });
});
