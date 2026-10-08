import { describe, expect, it } from 'vitest';
import { actaContent, actaLate, emptyPoint, missingActa, type ActaDraft } from './acta';

const complete = (): ActaDraft => ({
  attendees: [
    { side: 'ours', profile_id: 'carlos', name: 'Carlos', role: '' },
    { side: 'theirs', profile_id: null, name: 'Ana Meier', role: 'Dueña' },
  ],
  points: [{ topic_id: 'prices', title: 'Lista 2027', discussed: 'Aceptan la subida desde enero.', agreements: [] }],
  follow_up_on: '',
});

describe('what an Acta needs before it is registered', () => {
  it('is complete with both sides present and a point that says something', () => {
    expect(missingActa(complete(), '2026-10-08')).toEqual([]);
  });

  it('needs someone of ours and someone of theirs', () => {
    expect(missingActa({ ...complete(), attendees: [] }, '2026-10-08')).toEqual(['ours', 'theirs']);
    const typedBlank = { ...complete(), attendees: [complete().attendees[0]!, { side: 'theirs' as const, profile_id: null, name: '  ', role: '' }] };
    expect(missingActa(typedBlank, '2026-10-08')).toEqual(['theirs']);
  });

  it('needs at least one point, each with its topic and what was said', () => {
    expect(missingActa({ ...complete(), points: [] }, '2026-10-08')).toEqual(['points']);
    expect(missingActa({ ...complete(), points: [emptyPoint()] }, '2026-10-08')).toEqual(['point-0']);
    const untitled = { ...complete(), points: [{ ...complete().points[0]!, title: '' }] };
    expect(missingActa(untitled, '2026-10-08')).toEqual([]);
  });

  it('with agreements, needs who, and a follow-up date not before the meeting', () => {
    const agreed = (patch: object, followUp: string): ActaDraft => ({
      ...complete(),
      follow_up_on: followUp,
      points: [{ ...complete().points[0]!, agreements: [{ body: 'Enviar la lista nueva', responsible_id: 'carlos', due_on: '', ...patch }] }],
    });
    expect(missingActa(agreed({}, ''), '2026-10-08')).toEqual(['point-0', 'follow_up']);
    expect(missingActa(agreed({}, '2026-10-20'), '2026-10-08')).toEqual([]);
    expect(missingActa(agreed({ responsible_id: '' }, '2026-10-20'), '2026-10-08')).toEqual(['point-0']);
    expect(missingActa(agreed({ due_on: '2026-10-01' }, '2026-10-20'), '2026-10-08')).toEqual(['point-0']);
    expect(missingActa(agreed({}, '2026-10-01'), '2026-10-08')).toEqual(['point-0', 'follow_up']);
  });

  it('ignores an agreement row left empty', () => {
    const draft = { ...complete(), points: [{ ...complete().points[0]!, agreements: [{ body: ' ', responsible_id: '', due_on: '' }] }] };
    expect(missingActa(draft, '2026-10-08')).toEqual([]);
    expect(actaContent(draft).points[0]!.agreements).toEqual([]);
  });
});

describe('the Acta as it is saved', () => {
  it('gives an agreement without a date the day of the follow-up', () => {
    const draft: ActaDraft = {
      ...complete(),
      follow_up_on: '2026-10-20',
      points: [{ ...complete().points[0]!, agreements: [{ body: ' Enviar muestras ', responsible_id: 'carlos', due_on: '' }] }],
    };
    expect(actaContent(draft).points[0]!.agreements).toEqual([{ body: 'Enviar muestras', responsible_id: 'carlos', due_on: '2026-10-20' }]);
  });

  it('drops attendees that name nobody and keeps a role only for theirs', () => {
    const draft: ActaDraft = {
      ...complete(),
      attendees: [
        { side: 'ours', profile_id: 'carlos', name: 'Carlos', role: 'x' },
        { side: 'theirs', profile_id: null, name: ' ', role: 'Chef' },
        { side: 'theirs', profile_id: null, name: ' Ana ', role: ' Dueña ' },
      ],
    };
    expect(actaContent(draft).attendees).toEqual([
      { side: 'ours', profile_id: 'carlos', name: 'Carlos', role: '' },
      { side: 'theirs', profile_id: null, name: 'Ana', role: 'Dueña' },
    ]);
  });
});

describe('when an owed Acta is late', () => {
  it('is late two days after the meeting', () => {
    expect(actaLate('2026-10-08', '2026-10-08')).toBe(false);
    expect(actaLate('2026-10-08', '2026-10-09')).toBe(false);
    expect(actaLate('2026-10-08', '2026-10-10')).toBe(true);
  });
});
