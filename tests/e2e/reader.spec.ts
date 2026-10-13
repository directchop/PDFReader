import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fixture = (name: string) => path.resolve('tests/fixtures', name);
async function open(page: Page, names = ['reading-sample.pdf']) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#open').click();
  await (await chooser).setFiles(names.map(fixture));
}
async function ready(page: Page, name = 'reading-sample.pdf') {
  await expect(page.locator('#document-status')).toHaveText(name);
  await expect(page.locator('.document-pane:not([hidden]) .page canvas').first()).toBeVisible();
}

async function useJapanese(page: Page) {
  await page.addInitScript(() => localStorage.setItem('pdfreader.locale', 'ja'));
}

test('local rendering, Japanese search, navigation, outline, zoom, rotation, and tabs', async ({ page }) => {
  const errors: string[] = [];
  const remote: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:1420')) remote.push(request.url()); });
  await useJapanese(page);
  await page.goto('/');
  await page.screenshot({ path: 'test-results/home.png' });
  await open(page); await ready(page);
  await expect(page.locator('#page-total')).toHaveText('/ 3');
  await page.getByRole('button', { name: '文書内を検索' }).click();
  await page.getByRole('searchbox', { name: '検索文字列' }).fill('日本語');
  await expect(page.locator('#find-count')).toContainText('3 件');
  await expect(page.locator('.textLayer .highlight').first()).toBeVisible();
  await page.getByRole('button', { name: '次の検索結果' }).click();
  await expect(page.locator('#find-count')).toContainText('2 / 3');
  await page.getByRole('button', { name: '検索を閉じる' }).click();
  await page.getByRole('button', { name: '目次', exact: true }).click();
  await page.getByRole('button', { name: 'Your files stay yours.' }).click();
  await expect(page.getByRole('spinbutton', { name: 'ページ番号' })).toHaveValue('3');
  await page.getByLabel('表示倍率').selectOption('1.5');
  await expect(page.locator('.document-pane:not([hidden]) .page[data-page-number="3"] canvas').first()).toBeVisible();
  await page.getByRole('button', { name: '右に回転' }).click();
  await expect.poll(async () => {
    const box = await page.locator('.document-pane:not([hidden]) .page[data-page-number="3"]').boundingBox();
    return box ? box.width > box.height : false;
  }).toBe(true);
  await open(page, ['long-sample.pdf']); await ready(page, 'long-sample.pdf');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.getByRole('spinbutton', { name: 'ページ番号' }).fill('99');
  await page.getByRole('spinbutton', { name: 'ページ番号' }).press('Enter');
  await page.getByRole('button', { name: 'ページ', exact: true }).click();
  await expect(page.locator('.thumbnail')).toHaveCount(30);
  await page.getByRole('tab', { name: 'reading-sample.pdf' }).click();
  await expect(page.getByRole('spinbutton', { name: 'ページ番号' })).toHaveValue('3');
  await page.getByRole('button', { name: 'long-sample.pdf を閉じる' }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: '右に回転' }).click();
  await page.getByRole('button', { name: '右に回転' }).click();
  await page.getByRole('button', { name: '右に回転' }).click();
  await page.getByLabel('表示倍率').selectOption('page-fit');
  await page.getByRole('spinbutton', { name: 'ページ番号' }).fill('1');
  await page.getByRole('spinbutton', { name: 'ページ番号' }).press('Enter');
  await page.screenshot({ path: 'test-results/reader.png' });
  expect(errors).toEqual([]); expect(remote).toEqual([]);
});

test('password retry, cancellation, invalid PDF recovery, and closing the last tab', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page, ['password-sample.pdf']);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('PDFのパスワード').fill('wrong');
  await page.getByRole('button', { name: '開く', exact: true }).click();
  await expect(page.locator('#password-message')).toContainText('パスワードが違います');
  await page.getByLabel('PDFのパスワード').fill('reader-test');
  await page.getByRole('button', { name: '開く', exact: true }).click();
  await ready(page, 'password-sample.pdf');
  await page.getByRole('button', { name: 'password-sample.pdf を閉じる' }).click();
  await open(page, ['password-sample.pdf']);
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await open(page, ['broken.pdf', 'reading-sample.pdf']);
  await ready(page);
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: 'reading-sample.pdf を閉じる' }).click();
  await expect(page.locator('#home')).toBeVisible();
});

test('print creates all selected pages, excludes app chrome, and rejects invalid ranges', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/'); await open(page); await ready(page);
  await page.evaluate(() => { window.print = () => { document.body.dataset.printRequested = 'true'; }; });
  await page.getByRole('button', { name: '印刷', exact: true }).click();
  await page.getByLabel('ページ範囲').fill('0');
  await page.getByRole('button', { name: '印刷へ進む' }).click();
  await expect(page.locator('#print-progress')).toContainText('1〜3');
  await page.getByLabel('ページ範囲').fill('1,3');
  await page.getByRole('button', { name: '印刷へ進む' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-requested', 'true');
  await expect(page.locator('#print-output img')).toHaveCount(2);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.locator('#print-output')).toBeVisible();
  await page.pdf({ path: 'test-results/printed.pdf', preferCSSPageSize: true, printBackground: true });
});

test('switches to English in settings and preserves the locale after reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#settings-toggle').click();
  await page.locator('#locale-select').selectOption('ja');
  await page.locator('#locale-select').selectOption('en');
  await expect(page.locator('#open')).toHaveText('Open PDF');
  await expect(page.getByRole('heading', { name: 'Recently opened' })).toBeVisible();
  await open(page);
  await ready(page);
  await expect(page.getByRole('button', { name: 'Previous page' })).toHaveAttribute('aria-label', 'Previous page');
  await page.reload();
  await expect(page.locator('#locale-select')).toHaveValue('en');
  await expect(page.locator('#open')).toHaveText('Open PDF');
  await expect(page.getByRole('heading', { name: 'Recently opened' })).toBeVisible();
});

test('restores browser reading position after reopening a PDF', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('pdfreader.locale', 'ja');
  });
  await page.goto('/');
  await open(page, ['long-sample.pdf']);
  await ready(page, 'long-sample.pdf');
  await page.locator('#page-number').fill('20');
  await page.locator('#page-number').press('Enter');
  await expect(page.locator('#page-number')).toHaveValue('20');
  await page.getByRole('button', { name: 'long-sample.pdf を閉じる' }).click();
  await open(page, ['long-sample.pdf']);
  await ready(page, 'long-sample.pdf');
  await expect(page.locator('#page-number')).toHaveValue('20');
});

test('persists sidebar visibility and mode', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('pdfreader.sidebar', JSON.stringify({ open: false, mode: 'outline' }));
  });
  await page.reload();
  await open(page);
  await ready(page);
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('#show-outline')).toHaveClass(/selected/);
  await page.locator('#sidebar-toggle').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await page.locator('#show-pages').click();
  await page.locator('.tab-close').click();
  await page.reload();
  await open(page);
  await ready(page);
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#show-pages')).toHaveClass(/selected/);
});

test('spread modes, shortcut help, and pointer-centered wheel zoom work', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page);
  await ready(page);
  await page.locator('#zoom').selectOption('1');
  const initialZoom = Number((await page.locator('#zoom option:checked').textContent())?.replace('%', ''));
  await page.locator('.viewer-container').evaluate(element => {
    element.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
      clientX: 240,
      clientY: 180,
    }));
  });
  await expect.poll(async () => Number((await page.locator('#zoom option:checked').textContent())?.replace('%', '')))
    .toBeGreaterThan(initialZoom);

  await page.locator('#view-menu-toggle').click();
  await page.locator('#spread-odd').click();
  await expect(page.locator('#spread-odd')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.locator('.document-pane:not([hidden]) .pdfViewer').evaluate(viewer =>
    viewer.classList.contains('spread') || !!viewer.querySelector('.spread'),
  )).toBe(true);
  await page.keyboard.press('Escape');

  await page.keyboard.press('Shift+/');
  await expect(page.locator('#shortcuts-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#shortcuts-dialog')).toBeHidden();
});

test('bookmarks persist in browser preview and can be renamed and deleted', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page);
  await ready(page);
  await page.locator('#page-number').fill('2');
  await page.locator('#page-number').press('Enter');
  await expect(page.locator('#page-number')).toHaveValue('2');
  await page.locator('#bookmark-toggle').click();
  await expect(page.locator('#bookmark-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#show-bookmarks').click();
  await expect(page.locator('.bookmark-row')).toHaveCount(1);
  await page.locator('.bookmark-row [aria-label="しおりの名前を変更"]').click();
  await page.locator('.bookmark-row input').fill('調査メモ');
  await page.locator('.bookmark-row input').press('Enter');
  await expect(page.locator('.bookmark-link')).toHaveText('調査メモ');

  await page.getByRole('button', { name: 'reading-sample.pdf を閉じる' }).click();
  await open(page);
  await ready(page);
  await page.locator('#show-bookmarks').click();
  await expect(page.locator('.bookmark-link')).toHaveText('調査メモ');
  await page.locator('.bookmark-row [aria-label="しおりを削除"]').click();
  await expect(page.locator('.sidebar-empty')).toHaveText('しおりはありません。');
});

test('search results show safe contextual snippets and navigate by page', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page);
  await ready(page);
  await page.locator('#find-toggle').click();
  await page.locator('#find-input').fill('日本語');
  await page.locator('#find-input').press('Enter');
  const rows = page.locator('.search-result');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('日本語');
  const japaneseMarks = rows.locator('mark');
  await expect(japaneseMarks).toHaveCount(3);
  expect(await japaneseMarks.allTextContents()).toEqual(['日本語', '日本語', '日本語']);
  await page.locator('#find-input').fill('local');
  await page.locator('#find-input').press('Enter');
  await expect.poll(async () => new Set(await rows.evaluateAll(items => items.map(item => (item as HTMLElement).dataset.page))).size).toBe(3);
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('local');
  const localMarks = rows.locator('mark');
  await expect(localMarks).toHaveCount(6);
  expect((await localMarks.allTextContents()).map(text => text.toLowerCase())).toEqual(Array(6).fill('local'));
  await page.locator('.search-result[data-page="3"]').click();
  await expect(page.locator('#page-number')).toHaveValue('3');
  await expect(page.locator('.search-result.active')).toHaveAttribute('data-page', '3');
});

test('presentation mode enters with F5 and restores the previous zoom on exit', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page);
  await ready(page);
  await page.locator('#zoom').selectOption('1.25');
  const before = await page.locator('#zoom').inputValue();
  await page.keyboard.press('F5');
  await expect(page.locator('#app')).toHaveClass(/presenting/);
  await expect(page.locator('.toolbar')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#page-number')).toHaveValue('2');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).not.toHaveClass(/presenting/);
  await expect(page.locator('#zoom')).toHaveValue(before);
});
