import { describe, it, expect } from 'vitest';
import { canComplete, canEditReception, canTransition } from './workflow';
import type { CompletionCandidate } from './workflow';

/**
 * The reception workflow.
 *
 * Worth testing because every one of these rules exists twice — once here for
 * the screen and once in Postgres for the boundary — and the failure mode of
 * a disagreement is a button that is offered and then refused.
 */

const ASSIGNEE = { canManageAll: false };
const MANAGER = { canManageAll: true };

const complete = (over: Partial<CompletionCandidate> = {}): CompletionCandidate => ({
  supplier_id: 'sup-1',
  condition: 'good',
  quantity_check: 'checked_ok',
  comments: null,
  incident_count: 0,
  ...over,
});

describe('status transitions', () => {
  it('allows any forward move, including skipping states', () => {
    // §32: a pallet checked and signed off in ninety seconds must not have to
    // be walked through CHECKING to prove it happened.
    expect(canTransition('draft', 'received', ASSIGNEE)).toEqual({ ok: true });
    expect(canTransition('draft', 'completed', ASSIGNEE)).toEqual({ ok: true });
    expect(canTransition('received', 'checking', ASSIGNEE)).toEqual({ ok: true });
  });

  it('treats a no-op as permitted', () => {
    // Saving a reception without touching its status must never be refused by
    // a rule about status.
    expect(canTransition('completed', 'completed', ASSIGNEE)).toEqual({ ok: true });
    expect(canTransition('draft', 'draft', ASSIGNEE)).toEqual({ ok: true });
  });

  it('refuses a backward move for an assignee', () => {
    expect(canTransition('checking', 'received', ASSIGNEE)).toEqual({
      ok: false,
      reason: 'backward_not_permitted',
    });
  });

  it('permits a backward move for a manage_all holder', () => {
    expect(canTransition('checking', 'draft', MANAGER)).toEqual({ ok: true });
  });

  it('refuses to reopen a completed reception without the capability', () => {
    // Distinct from a plain backward move: completion is where the record
    // becomes history, and the refusal says so by name.
    expect(canTransition('completed', 'checking', ASSIGNEE)).toEqual({
      ok: false,
      reason: 'completed_is_final',
    });
  });

  it('lets a manage_all holder reopen a completed reception', () => {
    expect(canTransition('completed', 'checking', MANAGER)).toEqual({ ok: true });
  });
});

describe('completion validation', () => {
  it('accepts a reception carrying the required facts', () => {
    expect(canComplete(complete())).toEqual({ ok: true });
  });

  it('does NOT require a transporter', () => {
    // §34: a supplier's own van is an ordinary Tuesday. Demanding a carrier
    // would make somebody invent one.
    expect(canComplete(complete())).toEqual({ ok: true });
  });

  it('requires supplier, condition and a quantity check', () => {
    const result = canComplete(
      complete({ supplier_id: null, condition: null, quantity_check: 'not_checked' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Every reason at once, so the screen shows the whole list rather than a
    // user fixing one field to discover another.
    expect(result.reasons).toEqual([
      'supplier_required',
      'condition_required',
      'quantity_check_required',
    ]);
  });

  it('refuses a silent discrepancy', () => {
    const result = canComplete(complete({ quantity_check: 'discrepancy' }));
    expect(result).toEqual({
      ok: false,
      reasons: ['discrepancy_needs_explanation'],
    });
  });

  it('accepts a discrepancy explained by a comment', () => {
    expect(
      canComplete(complete({ quantity_check: 'discrepancy', comments: '2 boxes missing' })),
    ).toEqual({ ok: true });
  });

  it('accepts a discrepancy explained by a linked incident', () => {
    // Either answer is real: what is refused is neither.
    expect(
      canComplete(complete({ quantity_check: 'discrepancy', incident_count: 1 })),
    ).toEqual({ ok: true });
  });

  it('treats a whitespace-only comment as no explanation', () => {
    expect(
      canComplete(complete({ quantity_check: 'discrepancy', comments: '   ' })),
    ).toEqual({ ok: false, reasons: ['discrepancy_needs_explanation'] });
  });
});

describe('who may edit', () => {
  it('lets an assignee work on anything not yet completed', () => {
    for (const status of ['draft', 'received', 'checking'] as const) {
      expect(canEditReception({ status, isAssignee: true, canManageAll: false })).toBe(true);
    }
  });

  it('stops an assignee at completion', () => {
    expect(
      canEditReception({ status: 'completed', isAssignee: true, canManageAll: false }),
    ).toBe(false);
  });

  it('refuses a user who is not on the assignee list', () => {
    // Being approved is not being responsible. §10: role alone never grants
    // reception rights.
    expect(
      canEditReception({ status: 'draft', isAssignee: false, canManageAll: false }),
    ).toBe(false);
  });

  it('lets a manage_all holder edit a completed reception', () => {
    // §35: not casually overwritten, but reachable — and every such edit is
    // written to the audit log by the database trigger.
    expect(
      canEditReception({ status: 'completed', isAssignee: false, canManageAll: true }),
    ).toBe(true);
  });
});
