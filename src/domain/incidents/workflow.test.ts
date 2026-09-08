import { describe, it, expect } from 'vitest';
import { availableTransitions, canTransition, stampsFor } from './workflow';
import { INCIDENT_STATUSES, type IncidentStatus } from './vocabulary';

/**
 * The incident lifecycle.
 *
 * The two properties defended throughout: a Power User can carry an incident
 * all the way to RESOLVED and no further, and nothing reaches CLOSED without
 * having been resolved first.
 */

const manager = { canClose: true, hasResolutionNotes: true };
const powerUser = { canClose: false, hasResolutionNotes: true };

const move = (from: IncidentStatus, to: IncidentStatus, ctx = manager) =>
  canTransition(from, to, ctx);

describe('moving forward', () => {
  it('walks the intended path', () => {
    expect(move('open', 'investigating').ok).toBe(true);
    expect(move('investigating', 'action_required').ok).toBe(true);
    expect(move('action_required', 'resolved').ok).toBe(true);
    expect(move('resolved', 'closed').ok).toBe(true);
  });

  it('allows skipping ahead, because friction stops people reporting', () => {
    // A trivial incident understood and fixed on the spot must not have to be
    // walked through three states nobody used.
    expect(move('open', 'resolved').ok).toBe(true);
    expect(move('open', 'action_required').ok).toBe(true);
  });

  it('treats a no-op as permitted', () => {
    for (const s of INCIDENT_STATUSES) expect(move(s, s, powerUser).ok).toBe(true);
  });
});

describe('resolving requires a resolution', () => {
  it('refuses RESOLVED with nothing written', () => {
    const r = canTransition('investigating', 'resolved', { canClose: true, hasResolutionNotes: false });
    expect(r).toEqual({ ok: false, reason: 'resolution_notes_required' });
  });

  it('accepts it once something is written', () => {
    expect(canTransition('investigating', 'resolved', { canClose: true, hasResolutionNotes: true }).ok)
      .toBe(true);
  });
});

describe('closing is the manager line', () => {
  it('a Power User cannot close', () => {
    expect(move('resolved', 'closed', powerUser)).toEqual({
      ok: false,
      reason: 'close_not_permitted',
    });
  });

  it('a Manager can', () => {
    expect(move('resolved', 'closed', manager).ok).toBe(true);
  });

  it('nothing reaches CLOSED without being resolved first', () => {
    for (const from of ['open', 'investigating', 'action_required'] as IncidentStatus[]) {
      expect(move(from, 'closed', manager)).toEqual({
        ok: false,
        reason: 'close_requires_resolved',
      });
    }
  });

  it('reopening takes the same authority as closing', () => {
    expect(move('closed', 'investigating', powerUser)).toEqual({
      ok: false,
      reason: 'reopen_not_permitted',
    });
    expect(move('closed', 'investigating', manager).ok).toBe(true);
  });
});

describe('moving backward is a correction, not progress', () => {
  it('a Power User cannot walk an incident back', () => {
    expect(move('resolved', 'investigating', powerUser)).toEqual({
      ok: false,
      reason: 'backward_not_permitted',
    });
    expect(move('action_required', 'open', powerUser).ok).toBe(false);
  });

  it('a Manager can', () => {
    expect(move('resolved', 'investigating', manager).ok).toBe(true);
  });
});

describe('what the UI offers', () => {
  it('a Power User on a resolved incident is offered nothing further', () => {
    // Not closing, not reopening. The dropdown shows no choice that would be
    // refused, and the trigger refuses it anyway.
    expect(availableTransitions('resolved', powerUser)).toEqual([]);
  });

  it('a Power User on an open incident can move it along', () => {
    expect(availableTransitions('open', powerUser)).toEqual([
      'investigating',
      'action_required',
      'resolved',
    ]);
  });

  it('a Manager on a resolved incident may close or step back', () => {
    expect(availableTransitions('resolved', manager).sort()).toEqual([
      'action_required',
      'closed',
      'investigating',
      'open',
    ]);
  });

  it('never offers a transition that canTransition would refuse', () => {
    for (const from of INCIDENT_STATUSES) {
      for (const ctx of [manager, powerUser]) {
        for (const to of availableTransitions(from, ctx)) {
          expect(canTransition(from, to, ctx).ok).toBe(true);
        }
      }
    }
  });
});

describe('lifecycle stamps', () => {
  const NOW = '2026-09-10T08:00:00.000Z';
  const EMPTY = { resolved_at: null, resolved_by: null, closed_at: null, closed_by: null };

  it('resolving stamps who resolved it', () => {
    expect(stampsFor('resolved', 'u1', NOW, EMPTY)).toEqual({
      resolved_at: NOW,
      resolved_by: 'u1',
      closed_at: null,
      closed_by: null,
    });
  });

  it('closing keeps who resolved it and records who closed it', () => {
    // Two different acts, potentially by two different people, and the detail
    // page shows both.
    const resolved = { resolved_at: '2026-09-01T00:00:00.000Z', resolved_by: 'u1', closed_at: null, closed_by: null };
    expect(stampsFor('closed', 'u2', NOW, resolved)).toEqual({
      resolved_at: '2026-09-01T00:00:00.000Z',
      resolved_by: 'u1',
      closed_at: NOW,
      closed_by: 'u2',
    });
  });

  it('reopening to resolved un-closes it', () => {
    const closed = { resolved_at: '2026-09-01T00:00:00.000Z', resolved_by: 'u1', closed_at: NOW, closed_by: 'u2' };
    expect(stampsFor('resolved', 'u3', NOW, closed)).toMatchObject({
      resolved_by: 'u1',
      closed_at: null,
      closed_by: null,
    });
  });

  it('reopening to open work clears everything', () => {
    const closed = { resolved_at: '2026-09-01T00:00:00.000Z', resolved_by: 'u1', closed_at: NOW, closed_by: 'u2' };
    // A resolved_at left behind would make the report count the incident as
    // resolved in one place and open in another.
    expect(stampsFor('investigating', 'u3', NOW, closed)).toEqual(EMPTY);
  });
});
