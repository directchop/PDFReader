export function parsePageRange(input: string, pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('ページ数が無効です。');
  const selected = new Set<number>();
  const text = input.trim();
  const parts = text ? text.split(',') : [`1-${pageCount}`];
  for (const part of parts) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
    if (!match) throw new Error('ページ範囲を「1-3, 5」の形式で入力してください。');
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start < 1 || end > pageCount || start > end) throw new Error(`1〜${pageCount}ページの範囲で入力してください。`);
    if (end - start >= 100) throw new Error('1回につき100ページまで選択できます。');
    for (let i = start; i <= end; i++) selected.add(i);
    if (selected.size > 100) throw new Error('1回につき100ページまで選択できます。');
  }
  return [...selected].sort((a, b) => a - b);
}
