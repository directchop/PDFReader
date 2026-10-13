import { t } from './i18n';

export function parsePageRange(input: string, pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error(t('print.invalidPageCount'));
  const selected = new Set<number>();
  const text = input.trim();
  const parts = text ? text.split(',') : [`1-${pageCount}`];
  for (const part of parts) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
    if (!match) throw new Error(t('print.invalidRangeFormat'));
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start < 1 || end > pageCount || start > end) throw new Error(t('print.pageRangeBounds', { count: pageCount }));
    if (end - start >= 100) throw new Error(t('print.pageLimit'));
    for (let i = start; i <= end; i++) selected.add(i);
    if (selected.size > 100) throw new Error(t('print.pageLimit'));
  }
  return [...selected].sort((a, b) => a - b);
}
