import { describe, expect, it } from 'vitest';
import { anchorMatch } from './search-results';

describe('search result match anchoring', () => {
  it('returns an exact match', () => {
    expect(anchorMatch('before local after', 7, 'local', false)).toBe(7);
  });

  it('anchors a match found three characters after the PDF.js index', () => {
    expect(anchorMatch('before local after', 4, 'local', false)).toBe(7);
  });

  it('matches case-insensitively when match case is disabled', () => {
    expect(anchorMatch('before LOCAL after', 7, 'local', false)).toBe(7);
  });

  it('returns null when no occurrence is nearby', () => {
    expect(anchorMatch('before phrase after', 7, 'local', false)).toBeNull();
  });

  it('chooses the nearest of two nearby occurrences', () => {
    expect(anchorMatch('local----local', 10, 'local', false)).toBe(9);
  });
});
