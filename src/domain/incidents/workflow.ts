import { STATUS_RANK, type IncidentStatus } from './vocabulary';

/**
 * The incident lifecycle.
 *
 *   OPEN -> INVESTIGATING -> ACTION REQUIRED -> RESOLVED -> CLOSED
 *
 * Pure and free of I/O, like the recurrence engine and the preparation
 * progress rules, so what the workflow permits is unit-tested rather than
 * re-derived in a component and again in an action.
 *
 * §14 asks that arbitrary status changes not bypass the intended workflow.
 * The rules that implement that:
 *
 *   FORWARD is always allowed. A trivial incident that is understood and
 *   fixed the moment it is reported should not have to be walked through
 *   three intermediate states nobody used — §39 is explicit that friction is
 *   what stops people reporting at all.
 *
 *   BACKWARD is a correction, not progress, and takes the closing authority.
 *   Moving an incident out of RESOLVED says the investigation was wrong, and
 *   that is a supervisory act.
 *
 *   CLOSED is reachable only from RESOLVED, and only by a holder of
 *   incidents.close. Closing means the corrective actions are done, which is
 *   a statement about work that has to have been resolved first.
 *
 *   RESOLVED requires a resolution to have been written. §18: an incident is
 *   not resolved because a dropdown changed.
 */

export type TransitionRefusal =
  | 'close_requires_resolved'
  | 'close_not_permitted'
  | 'reopen_not_permitted'
  | 'backward_not_permitted'
  | 'resolution_notes_required';

export type TransitionResult = { ok: true } | { ok: false; reason: TransitionRefusal };

export interface TransitionContext {
  /** Holds incidents.close — a Manager or an Admin. */
  canClose: boolean;
  /** Whether a resolution has been written, on the record or in this edit. */
  hasResolutionNotes: boolean;
}

const OK: TransitionResult = { ok: true };

export function canTransition(
  from: IncidentStatus,
  to: IncidentStatus,
  ctx: TransitionContext,
): TransitionResult {
  // A no-op is not a transition. Saving an incident without touching its
  // status must never be refused for a rule about status.
  if (from === to) return OK;

  // ---- leaving CLOSED ----
  // Reopening is the mirror of closing and takes the same authority.
  if (from === 'closed') {
    if (!ctx.canClose) return { ok: false, reason: 'reopen_not_permitted' };
    return OK;
  }

  // ---- entering CLOSED ----
  if (to === 'closed') {
    if (from !== 'resolved') return { ok: false, reason: 'close_requires_resolved' };
    if (!ctx.canClose) return { ok: false, reason: 'close_not_permitted' };
    return OK;
  }

  // ---- entering RESOLVED ----
  if (to === 'resolved' && !ctx.hasResolutionNotes) {
    return { ok: false, reason: 'resolution_notes_required' };
  }

  // ---- direction ----
  if (STATUS_RANK[to] > STATUS_RANK[from]) return OK;
  if (!ctx.canClose) return { ok: false, reason: 'backward_not_permitted' };
  return OK;
}

/**
 * The statuses this viewer may move an incident to right now.
 *
 * The UI offers exactly these, so a person is never presented with a choice
 * that will be refused. The database enforces the rule regardless — the close
 * guard is a trigger — and this only decides what is worth showing.
 */
export function availableTransitions(
  from: IncidentStatus,
  ctx: TransitionContext,
): IncidentStatus[] {
  return (Object.keys(STATUS_RANK) as IncidentStatus[]).filter(
    (to) => to !== from && canTransition(from, to, ctx).ok,
  );
}

/** Does entering this status require a resolution to have been written? */
export function requiresResolution(status: IncidentStatus): boolean {
  return status === 'resolved' || status === 'closed';
}

/**
 * The timestamps a transition writes.
 *
 * Kept here rather than in the action so that "resolving stamps a resolver"
 * and "reopening clears it" are one rule with one test, instead of two
 * branches in a server action that drift.
 *
 * Reopening deliberately CLEARS the stamps. A resolved_at left behind on an
 * incident that is open again would make the report count it as resolved in
 * one place and open in another, and the audit log preserves the fact that it
 * was once resolved regardless.
 */
export interface LifecycleStamps {
  resolved_at: string | null;
  resolved_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
}

export function stampsFor(
  to: IncidentStatus,
  actorId: string,
  now: string,
  current: LifecycleStamps,
): LifecycleStamps {
  if (to === 'closed') {
    return {
      // Closing an incident that was resolved keeps who resolved it. The two
      // are different acts by potentially different people, and the detail
      // page shows both.
      resolved_at: current.resolved_at ?? now,
      resolved_by: current.resolved_by ?? actorId,
      closed_at: current.closed_at ?? now,
      closed_by: current.closed_by ?? actorId,
    };
  }

  if (to === 'resolved') {
    return {
      resolved_at: current.resolved_at ?? now,
      resolved_by: current.resolved_by ?? actorId,
      // Moving back from closed to resolved un-closes it.
      closed_at: null,
      closed_by: null,
    };
  }

  // Anything earlier than resolved: the incident is open work again.
  return { resolved_at: null, resolved_by: null, closed_at: null, closed_by: null };
}
