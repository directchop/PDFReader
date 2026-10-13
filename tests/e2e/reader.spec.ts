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
