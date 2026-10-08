/**
 * A meeting's record for the workers' files: what it must say before it can
 * be registered. Mirrored in SQL by meeting_record_save().
 *
 * As detailed as a log note, per agenda point: its topic, the situation that
 * led to it, what was said, and what was agreed — or why nothing was.
 *
 * Pure: the form and the tests read the same rules.
 */
import type { NotePerson, CompanyTopic } from '@/domain/hr/note-structure';

export interface RecordAgreementDraft {
  body: string;
  /** Everyone who was there, rather than one of them. */
  all: boolean;
  responsible: NotePerson | null;
  /** Empty: the day of the follow-up. */
  due_on: string;
}

export interface RecordPointDraft {
  title: string;
  topic: CompanyTopic | null;
  situation: string;
  discussed: string;
  no_agreements: boolean;
  no_agreements_reason: string;
  agreements: RecordAgreementDraft[];
}

export interface RecordDraft {
  attendees: NotePerson[];
  points: RecordPointDraft[];
  follow_up_on: string;
}

export const EMPTY_AGREEMENT: RecordAgreementDraft = { body: '', all: true, responsible: null, due_on: '' };

export const emptyPoint = (title = ''): RecordPointDraft => ({
  title,
  topic: null,
  situation: '',
  discussed: '',
  no_agreements: false,
  no_agreements_reason: '',
  agreements: [{ ...EMPTY_AGREEMENT }],
});

/** The agenda's lines as points: "- Calidad de totopo." → "Calidad de totopo." */
export function agendaPoints(agenda: string | null): string[] {
  return (agenda ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-–•*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

/** The agreements a point carries: the rows that say something, unless it has none. */
export function pointAgreements(point: RecordPointDraft, followUpOn: string): RecordAgreementDraft[] {
  if (point.no_agreements) return [];
  return point.agreements.filter((a) => a.body.trim()).map((a) => ({ ...a, due_on: a.due_on || followUpOn }));
}

/**
 * What is still missing before the record can be registered; empty when it is
 * complete. 'attendees', 'points', 'follow_up', or 'point-<n>' for a point
 * (from 0) that lacks something.
 */
export function missingRecord(draft: RecordDraft, meetingDate: string): string[] {
  const missing: string[] = [];
  if (draft.attendees.length === 0) missing.push('attendees');
  if (draft.points.length === 0) missing.push('points');

  let agreed = 0;
  draft.points.forEach((point, i) => {
    const agreements = pointAgreements(point, draft.follow_up_on);
    agreed += agreements.length;
    const said = point.title.trim() && point.topic && point.situation.trim() && point.discussed.trim();
    const settled = point.no_agreements
      ? !!point.no_agreements_reason.trim()
      : agreements.length > 0 && agreements.every((a) => (a.all || a.responsible) && a.due_on && a.due_on >= meetingDate);
    if (!said || !settled) missing.push(`point-${i}`);
  });

  // Agreements are checked at the follow-up, so there has to be one.
  if ((agreed > 0 && !draft.follow_up_on) || (draft.follow_up_on && draft.follow_up_on < meetingDate)) missing.push('follow_up');
  return missing;
}

/** The draft as meeting_record_save() takes it. */
export function recordContent(draft: RecordDraft) {
  return {
    attendees: draft.attendees,
    points: draft.points.map((point) => ({
      title: point.title.trim(),
      topic: point.topic,
      situation: point.situation.trim(),
      discussed: point.discussed.trim(),
      no_agreements_reason: point.no_agreements ? point.no_agreements_reason.trim() : '',
      agreements: pointAgreements(point, draft.follow_up_on).map((a) => ({
        body: a.body.trim(),
        all: a.all,
        responsible: a.all ? null : a.responsible,
        due_on: a.due_on || null,
      })),
    })),
    follow_up_on: draft.follow_up_on || null,
  };
}
