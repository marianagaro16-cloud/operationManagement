import { describe, expect, it } from 'vitest';
import { agendaPoints, emptyPoint, missingRecord, recordContent, type RecordDraft } from './record';

const patricia = { profile_id: null, worker_id: 'w1', name: 'Patricia' };

const complete: RecordDraft = {
  attendees: [patricia],
  follow_up_on: '2026-10-19',
  points: [
    {
      title: 'Limpieza de máquinas',
      topic: 'hygiene_safety',
      situation: 'La freidora quedó con restos el jueves y el viernes.',
      discussed: 'Se repasó el orden de limpieza al terminar el turno.',
      no_agreements: false,
      no_agreements_reason: '',
      agreements: [{ body: 'Limpiar la freidora al terminar cada turno', all: true, responsible: null, due_on: '' }],
    },
  ],
};

describe('agendaPoints', () => {
  it('takes the agenda\'s lines without their bullets', () => {
    expect(agendaPoints('- Calidad de totopo por sabor.\n\n• Limpieza\n2) Puntualidad\n3. Entradas')).toEqual([
      'Calidad de totopo por sabor.', 'Limpieza', 'Puntualidad', 'Entradas',
    ]);
    expect(agendaPoints(null)).toEqual([]);
  });
});

describe('missingRecord', () => {
  const date = '2026-10-05';

  it('a record with its attendees, a full point, an agreement and a follow-up is complete', () => {
    expect(missingRecord(complete, date)).toEqual([]);
  });

  it('needs someone who was there and at least one point', () => {
    expect(missingRecord({ attendees: [], points: [], follow_up_on: '' }, date)).toEqual(['attendees', 'points']);
  });

  it('a point says its topic, the situation and what was said', () => {
    const point = complete.points[0]!;
    for (const patch of [{ topic: null }, { situation: ' ' }, { discussed: '' }, { title: '' }]) {
      expect(missingRecord({ ...complete, points: [{ ...point, ...patch }] }, date)).toEqual(['point-0']);
    }
  });

  it('a point has agreements, or the reason there are none', () => {
    const point = complete.points[0]!;
    expect(missingRecord({ ...complete, points: [emptyPoint('x')] }, date)).toContain('point-0');
    const none = { ...point, no_agreements: true };
    expect(missingRecord({ ...complete, follow_up_on: '', points: [none] }, date)).toEqual(['point-0']);
    expect(missingRecord({ ...complete, follow_up_on: '', points: [{ ...none, no_agreements_reason: 'Solo informativo' }] }, date)).toEqual([]);
  });

  it('an agreement is everyone\'s or someone\'s, and not due before the meeting', () => {
    const point = complete.points[0]!;
    const one = (patch: object) => ({ ...complete, points: [{ ...point, agreements: [{ ...point.agreements[0]!, ...patch }] }] });
    expect(missingRecord(one({ all: false }), date)).toEqual(['point-0']);
    expect(missingRecord(one({ all: false, responsible: patricia }), date)).toEqual([]);
    expect(missingRecord(one({ due_on: '2026-10-01' }), date)).toEqual(['point-0']);
  });

  it('with agreements there is a follow-up, on or after the meeting', () => {
    expect(missingRecord({ ...complete, follow_up_on: '' }, date)).toEqual(['point-0', 'follow_up']);
    expect(missingRecord({ ...complete, follow_up_on: '2026-10-01' }, date)).toEqual(['point-0', 'follow_up']);
  });
});

describe('recordContent', () => {
  it('sends only what counts: filled agreements with the follow-up day when they have none', () => {
    const point = complete.points[0]!;
    const content = recordContent({
      ...complete,
      points: [{ ...point, agreements: [...point.agreements, { body: ' ', all: true, responsible: null, due_on: '' }] }],
    });
    expect(content.points[0]!.agreements).toEqual([
      { body: 'Limpiar la freidora al terminar cada turno', all: true, responsible: null, due_on: '2026-10-19' },
    ]);
    expect(content.follow_up_on).toBe('2026-10-19');
  });

  it('a point without agreements sends its reason and none of the rows', () => {
    const point = { ...complete.points[0]!, no_agreements: true, no_agreements_reason: 'Solo informativo' };
    const content = recordContent({ ...complete, points: [point] });
    expect(content.points[0]).toMatchObject({ no_agreements_reason: 'Solo informativo', agreements: [] });
  });
});
