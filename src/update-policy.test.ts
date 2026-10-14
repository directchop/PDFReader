import { describe, expect, it } from 'vitest';
import { formatUpdateDate, shouldAutoCheck } from './update-policy';

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

describe('update date formatting', () => {
  it('formats RFC 3339 dates using the requested locale', () => {
    const value = '2026-10-13T05:56:00Z';
    expect(formatUpdateDate(value, 'ja')).toBe(
      new Intl.DateTimeFormat('ja', { dateStyle: 'medium' }).format(new Date(value)),
    );
  });

  it('hides missing or invalid dates', () => {
    expect(formatUpdateDate(null, 'en')).toBeNull();
    expect(formatUpdateDate('not-a-date', 'en')).toBeNull();
  });
});
