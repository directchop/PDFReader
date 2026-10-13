import { describe, expect, it } from 'vitest';
import { parsePageRange } from './print-range';

describe('print page ranges', () => {
  it('prints all pages when blank and deduplicates ordered ranges', () => {
    expect(parsePageRange('', 3)).toEqual([1, 2, 3]);
    expect(parsePageRange('5, 1-3, 2', 5)).toEqual([1, 2, 3, 5]);
  });
  it.each(['0', '1-9', '3-1', '1.5', '1,,3', '2-', '-2', '1e2'])('rejects invalid range %s', value => {
    expect(() => parsePageRange(value, 5)).toThrow();
  });
  it('bounds print allocations before iterating over untrusted page counts', () => {
    expect(() => parsePageRange('', 1_000_000)).toThrow('100');
    expect(() => parsePageRange('1-100, 102', 200)).toThrow('100');
    expect(parsePageRange('100', 200)).toEqual([100]);
  });
});
