/**
 * Goods Reception vocabulary.
 *
 * The stable identifiers the database stores, mirroring the three enums in
 * 20260920090000_goods_reception_module.sql. Display text lives in the i18n
 * dictionaries and never here — §49: the database keeps identifiers, the
 * screen keeps language.
 *
 * Pure data with no imports, exactly like `domain/incidents/vocabulary.ts`,
 * so both a Server Component and a Client Component may read it.
 */

/**
 * The lifecycle, in the order the work actually happens.
 *
 * DRAFT       started, not yet a statement about anything
 * RECEIVED    the delivery physically arrived and is on the record
 * CHECKING    somebody is going through it
 * COMPLETED   the reception process is finished
 *
 * There is deliberately no PROBLEM or ISSUE state. A delivery that went wrong
 * is a COMPLETED reception with incidents linked to it — §12. Giving trouble
 * a status of its own would fork the incident workflow and make "how many
 * deliveries had problems" a question with two different answers.
 */
export const RECEPTION_STATUSES = ['draft', 'received', 'checking', 'completed'] as const;
export type ReceptionStatus = (typeof RECEPTION_STATUSES)[number];

/**
 * Progress as a number, for comparison and for "at least received" filters.
 *
 * Not the array index. The array is ordered for display and a rank derived
 * from it would silently invert the moment somebody reordered the list.
 */
export const RECEPTION_STATUS_RANK: Record<ReceptionStatus, number> = {
  draft: 0,
  received: 1,
  checking: 2,
  completed: 3,
};

export const RECEPTION_CONDITIONS = [
  'good',
  'damaged',
  'partially_damaged',
  'other_issue',
] as const;
export type ReceptionCondition = (typeof RECEPTION_CONDITIONS)[number];

/**
 * §17, exactly three states and no fourth.
 *
 * `not_checked` is a real answer — the pallet is in the cold store and nobody
 * has opened it — and has to stay tellable apart from `checked_ok`. A
 * nullable boolean would collapse "not yet" and "nothing wrong" into one
 * shrug, and the monthly report would then be unable to say how many
 * deliveries were never verified at all.
 */
export const QUANTITY_CHECKS = ['not_checked', 'checked_ok', 'discrepancy'] as const;
export type QuantityCheck = (typeof QUANTITY_CHECKS)[number];

/** A condition that is not simply "good" — what the reports count as trouble. */
export function isConditionProblem(condition: ReceptionCondition | null): boolean {
  return condition !== null && condition !== 'good';
}

/** Past the point where an assignee may still edit it. */
export function isCompleted(status: ReceptionStatus): boolean {
  return status === 'completed';
}

export function isReceptionStatus(value: string): value is ReceptionStatus {
  return (RECEPTION_STATUSES as readonly string[]).includes(value);
}

export function isReceptionCondition(value: string): value is ReceptionCondition {
  return (RECEPTION_CONDITIONS as readonly string[]).includes(value);
}

export function isQuantityCheck(value: string): value is QuantityCheck {
  return (QUANTITY_CHECKS as readonly string[]).includes(value);
}

/**
 * A permission key in a form the i18n dictionary can hold.
 *
 * `t()` addresses nested keys by splitting on '.', so a status of
 * 'partially_damaged' is fine as a leaf but 'goods_reception.manage_all' is
 * not. Mirrors `permissionKey` in lib/authz.
 */
export function receptionMessageKey(value: string): string {
  return value.replace(/[._](\w)/g, (_, c: string) => c.toUpperCase());
}
