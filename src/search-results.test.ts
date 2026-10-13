import { describe, expect, it } from 'vitest';
import { anchorMatch, searchRenderIsCurrent } from './search-results';
import type { ReaderTab } from './state';

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

  it('rejects deferred results after switching sidebar tabs', async () => {
    const tab = { disposed: false } as ReaderTab;
    let version = 1;
    let mode = 'search';
    let activeTab: ReaderTab | undefined = tab;
    let resolve!: () => void;
    const deferred = new Promise<void>(done => { resolve = done; });
    const render = async () => {
      await deferred;
      return searchRenderIsCurrent(1, version, mode, tab, activeTab);
    };

    const result = render();
    mode = 'bookmarks';
    version++;
    resolve();

    await expect(result).resolves.toBe(false);
  });
});
