import { afterEach, describe, expect, it } from 'vitest';
import { describeError, setLocale } from './i18n';

const saveErrorCodes = [
  'cannot_overwrite_original',
  'invalid_save_token',
  'cannot_save',
  'not_pdf',
  'too_large',
];

describe('Save As error translations', () => {
  afterEach(() => setLocale('en'));

  it.each(['ja', 'en'] as const)('localizes all save errors in %s', locale => {
    setLocale(locale);
    for (const code of saveErrorCodes) {
      expect(describeError(code)).not.toBe(code);
    }
  });
});
