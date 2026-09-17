import { describe, it, expect } from 'vitest';
import { planDirectSend, requiresOk } from './direct-messages';

const people = [
  { id: 'u1', role: 'user' },
  { id: 'u2', role: 'user' },
  { id: 'a1', role: 'admin' },
  { id: 'm1', role: 'manager' },
  { id: 'p1', role: 'power_user' },
];

describe('requiresOk', () => {
  it('holds the screen only for the User role', () => {
    expect(requiresOk('user')).toBe(true);
    expect(requiresOk('admin')).toBe(false);
    expect(requiresOk('manager')).toBe(false);
    expect(requiresOk('power_user')).toBe(false);
  });
});

describe('planDirectSend', () => {
  it('sends down to the floor with OK', () => {
    expect(planDirectSend(['u1', 'u2'], people, 'm1')).toEqual({ ok: true, floor: ['u1', 'u2'], office: [] });
  });

  it('sends up and sideways without OK', () => {
    // A power user writing to an admin; an admin writing to another admin.
    expect(planDirectSend(['a1'], people, 'p1')).toEqual({ ok: true, floor: [], office: ['a1'] });
    expect(planDirectSend(['a1', 'm1'], [...people, { id: 'a2', role: 'admin' }], 'a2')).toEqual({
      ok: true,
      floor: [],
      office: ['a1', 'm1'],
    });
  });

  it('splits a mixed send', () => {
    expect(planDirectSend(['u1', 'a1', 'p1'], people, 'm1')).toEqual({ ok: true, floor: ['u1'], office: ['a1', 'p1'] });
  });

  it('refuses a message to yourself', () => {
    expect(planDirectSend(['u1', 'm1'], people, 'm1')).toEqual({ ok: false, error: 'invalid_recipient' });
  });

  it('refuses the whole send when anybody named is not an approved account', () => {
    expect(planDirectSend(['u1', 'gone'], people, 'm1')).toEqual({ ok: false, error: 'invalid_recipient' });
  });

  it('counts a repeated id once', () => {
    expect(planDirectSend(['u1', 'u1'], people, 'm1')).toEqual({ ok: true, floor: ['u1'], office: [] });
  });
});
