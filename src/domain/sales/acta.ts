/**
 * The Acta of a meeting with a customer: what it must say before it can be
 * registered. Mirrored in SQL by sales_acta_save().
 *
 * Who was there from both sides, and per point its topic and what was said.
 * Agreements are optional; with any, a follow-up date is needed, because
 * that is when they are checked.
 *
 * Pure: the form and the tests read the same rules.
 */

export interface ActaAttendeeDraft {
  side: 'ours' | 'theirs';
  profile_id: string | null;
  name: string;
  role: string;
}

export interface ActaAgreementDraft {
  body: string;
  responsible_id: string;
  /** Empty: the day of the follow-up. */
  due_on: string;
}

export interface ActaPointDraft {
  topic_id: string;
  title: string;
  discussed: string;
  agreements: ActaAgreementDraft[];
}

export interface ActaDraft {
  attendees: ActaAttendeeDraft[];
  points: ActaPointDraft[];
  follow_up_on: string;
}

/** An Acta not registered this many days after the meeting is late. */
export const ACTA_LATE_DAYS = 2;

export const emptyAgreement = (responsibleId = ''): ActaAgreementDraft => ({ body: '', responsible_id: responsibleId, due_on: '' });

export const emptyPoint = (): ActaPointDraft => ({ topic_id: '', title: '', discussed: '', agreements: [] });

/** The agreements a point carries: the rows that say something. */
export function pointAgreements(point: ActaPointDraft, followUpOn: string): ActaAgreementDraft[] {
  return point.agreements.filter((a) => a.body.trim()).map((a) => ({ ...a, due_on: a.due_on || followUpOn }));
}

/**
 * What is still missing before the Acta can be registered; empty when it is
 * complete. 'ours', 'theirs', 'points', 'follow_up', or 'point-<n>' for a
 * point (from 0) that lacks something.
 */
export function missingActa(draft: ActaDraft, meetingDate: string): string[] {
  const missing: string[] = [];
  if (!draft.attendees.some((a) => a.side === 'ours' && a.profile_id)) missing.push('ours');
  if (!draft.attendees.some((a) => a.side === 'theirs' && a.name.trim())) missing.push('theirs');
  if (draft.points.length === 0) missing.push('points');

  let agreed = 0;
  draft.points.forEach((point, i) => {
    const agreements = pointAgreements(point, draft.follow_up_on);
    agreed += agreements.length;
    const said = !!point.topic_id && !!point.discussed.trim();
    const settled = agreements.every((a) => a.responsible_id && a.due_on && a.due_on >= meetingDate);
    if (!said || !settled) missing.push(`point-${i}`);
  });

  if ((agreed > 0 && !draft.follow_up_on) || (draft.follow_up_on && draft.follow_up_on < meetingDate)) missing.push('follow_up');
  return missing;
}

/** The draft as sales_acta_save() takes it. */
export function actaContent(draft: ActaDraft) {
  return {
    attendees: draft.attendees
      .filter((a) => (a.side === 'ours' ? !!a.profile_id : !!a.name.trim()))
      .map((a) => ({ side: a.side, profile_id: a.side === 'ours' ? a.profile_id : null, name: a.name.trim(), role: a.side === 'theirs' ? a.role.trim() : '' })),
    points: draft.points.map((point) => ({
      topic_id: point.topic_id || null,
      title: point.title.trim(),
      discussed: point.discussed.trim(),
      agreements: pointAgreements(point, draft.follow_up_on).map((a) => ({
        body: a.body.trim(),
        responsible_id: a.responsible_id || null,
        due_on: a.due_on || null,
      })),
    })),
    follow_up_on: draft.follow_up_on || null,
  };
}

/** An owed Acta is late once two days have passed since the meeting. */
export function actaLate(meetingDate: string, today: string): boolean {
  const limit = new Date(Date.parse(`${today}T12:00:00Z`) - ACTA_LATE_DAYS * 86_400_000).toISOString().slice(0, 10);
  return meetingDate <= limit;
}
