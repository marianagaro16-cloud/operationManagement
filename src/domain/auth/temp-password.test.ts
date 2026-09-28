import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH, tempPassword } from './temp-password';

describe('tempPassword', () => {
  it('is two words and four digits', () => {
    for (let i = 0; i < 50; i++) {
      expect(tempPassword()).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
    }
  });

  it('keeps leading zeros in the digits', () => {
    expect(tempPassword(() => 7)).toMatch(/-0007$/);
  });

  it('is long enough to be accepted', () => {
    expect(tempPassword(() => 0).length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
  });

  it('varies', () => {
    expect(new Set(Array.from({ length: 20 }, () => tempPassword())).size).toBeGreaterThan(15);
  });
});
