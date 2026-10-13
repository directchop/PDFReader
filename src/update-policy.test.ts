import { describe, expect, it } from 'vitest';
import { shouldAutoCheck } from './update-policy';

describe('automatic update check policy', () => {
  it('requires the opt-in setting', () => {
    expect(shouldAutoCheck(false, null, 100)).toBe(false);
  });

  it('checks when enabled and no previous check exists', () => {
    expect(shouldAutoCheck(true, null, 100)).toBe(true);
  });

  it('waits 24 hours after a previous check', () => {
    expect(shouldAutoCheck(true, 100, 100 + 24 * 60 * 60 * 1000 - 1)).toBe(false);
    expect(shouldAutoCheck(true, 100, 100 + 24 * 60 * 60 * 1000)).toBe(true);
  });
});
