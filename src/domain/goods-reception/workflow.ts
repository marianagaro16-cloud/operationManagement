import {
  RECEPTION_STATUS_RANK,
  type QuantityCheck,
  type ReceptionCondition,
  type ReceptionStatus,
} from './vocabulary';

/**
 * The reception lifecycle and the completion rules.
 *
 * Pure and free of I/O, like `domain/incidents/workflow.ts`, so what the
 * workflow permits is unit-tested once rather than re-derived in a component
 * and again in an action — and so the same answer is given by the screen that
 * disables the button and the server that would refuse the write.
 *
 * This mirrors the database and does not replace it. The CHECK constraint on
 * goods_receptions and the guard trigger are the boundary; everything here
 * exists so a user is not offered an action that would be rejected.
 */

export type TransitionRefusal =
  | 'backward_not_permitted'
  | 'completed_is_final';

export type CompletionRefusal =
  | 'supplier_required'
  | 'condition_required'
  | 'quantity_check_required'
  | 'discrepancy_needs_explanation';

export type TransitionResult = { ok: true } | { ok: false; reason: TransitionRefusal };
export type CompletionResult = { ok: true } | { ok: false; reasons: CompletionRefusal[] };

const OK = { ok: true } as const;

export interface TransitionContext {
  /** Holds goods_reception.manage_all — a Power User, Manager or Admin. */
  canManageAll: boolean;
}

/**
 * May this reception move from one status to another?
 *
 *   FORWARD is always allowed, including skipping states. A pallet that
 *   arrives, is checked and is signed off in ninety seconds should not have
 *   to be walked through CHECKING to prove it — §32 is explicit that the
 *   workflow must be fast, and friction here is what produces receptions
 *   nobody bothers to register.
 *
 *   BACKWARD is a correction rather than progress, and takes the management
 *   capability. A receiver who moves a reception back out of CHECKING is
 *   saying the check did not happen, which is a supervisory statement.
 *
 *   OUT OF COMPLETED takes the same capability and is called out separately,
 *   because completion is the point at which the record becomes history. §35:
 *   a completed reception is not casually overwritten.
 */
export function canTransition(
  from: ReceptionStatus,
  to: ReceptionStatus,
  ctx: TransitionContext,
): TransitionResult {
  // A no-op is not a transition. Saving a reception without touching its
  // status must never be refused by a rule about status.
  if (from === to) return OK;

  if (from === 'completed') {
    return ctx.canManageAll ? OK : { ok: false, reason: 'completed_is_final' };
  }

  if (RECEPTION_STATUS_RANK[to] < RECEPTION_STATUS_RANK[from]) {
    return ctx.canManageAll ? OK : { ok: false, reason: 'backward_not_permitted' };
  }

  return OK;
}

export interface CompletionCandidate {
  supplier_id: string | null;
  condition: ReceptionCondition | null;
  quantity_check: QuantityCheck;
  comments: string | null;
  /** Incidents already raised against this reception. */
  incident_count: number;
}

/**
 * Is this reception complete enough to be called completed?
 *
 * §34. The transporter is deliberately NOT required: a supplier's own van
 * with no carrier is an ordinary Tuesday, and demanding one would make
 * somebody invent it — which is how master data fills up with "unknown".
 *
 * Date, time and receiver are absent from these checks because they cannot be
 * missing: both are NOT NULL columns, defaulted from the clock and the
 * session at creation.
 *
 * Returns EVERY reason rather than the first, so the screen can show the
 * whole list at once instead of a user fixing one field to discover another.
 */
export function canComplete(candidate: CompletionCandidate): CompletionResult {
  const reasons: CompletionRefusal[] = [];

  if (!candidate.supplier_id) reasons.push('supplier_required');
  if (!candidate.condition) reasons.push('condition_required');
  if (candidate.quantity_check === 'not_checked') reasons.push('quantity_check_required');

  /*
   * A known discrepancy is never completed in silence.
   *
   * Either somebody wrote down what was missing, or an incident was raised
   * about it. Both are real answers; neither being present means the fact
   * that two boxes never arrived is about to become invisible.
   */
  if (
    candidate.quantity_check === 'discrepancy' &&
    (candidate.comments ?? '').trim().length === 0 &&
    candidate.incident_count === 0
  ) {
    reasons.push('discrepancy_needs_explanation');
  }

  return reasons.length === 0 ? OK : { ok: false, reasons };
}

/**
 * May this person write to a reception in this state?
 *
 * The UI mirror of `can_write_goods_reception()` in SQL. Being an Admin,
 * Manager or Power User does NOT put somebody on the assignee list — it gives
 * them `manage_all`, which is a different authority and the only one that
 * reaches a completed record.
 */
export function canEditReception(params: {
  status: ReceptionStatus;
  isAssignee: boolean;
  canManageAll: boolean;
}): boolean {
  if (params.canManageAll) return true;
  return params.isAssignee && params.status !== 'completed';
}
