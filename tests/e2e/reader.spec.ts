import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

const fixture = (name: string) => path.resolve('tests/fixtures', name);
async function openPaths(page: Page, files: string[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#open').click();
  await (await chooser).setFiles(files);
}
async function open(page: Page, names = ['reading-sample.pdf']) {
  await openPaths(page, names.map(fixture));
}
async function ready(page: Page, name = 'reading-sample.pdf') {
  await expect(page.locator('#document-status')).toHaveText(name);
  await expect(page.locator('.document-pane:not([hidden]) .page canvas').first()).toBeVisible();
}

async function useJapanese(page: Page) {
  await page.addInitScript(() => localStorage.setItem('pdfreader.locale', 'ja'));
}

async function addTextNote(page: Page, text: string, commit = true) {
  await page.locator('#annotate-toggle').click();
  await page.locator('[data-annotation-mode="3"]').click();
  const pageBox = await page.locator('.page[data-page-number="1"]').boundingBox();
  if (!pageBox) throw new Error('Page 1 is not visible');
  await page.mouse.click(pageBox.x + pageBox.width * .55, pageBox.y + pageBox.height * .4);
  await page.locator('.freeTextEditor .internal').last().fill(text);
  if (commit) await page.mouse.click(pageBox.x + pageBox.width * .72, pageBox.y + pageBox.height * .55);
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
test('free-text annotations save as a PDF copy and render when reopened', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page);
  await ready(page);
  await addTextNote(page, 'メモ', false);
  await expect(page.locator('.freeTextEditor .internal').last()).toBeFocused();
  await expect(page.locator('.tab-main.modified')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await downloadPromise;
  const savedPath = path.resolve('test-results', download.suggestedFilename());
  await download.saveAs(savedPath);
  await expect(page.locator('.tab-main.modified')).toHaveCount(0);
  const data = await readFile(savedPath);
  expect(data.subarray(0, 5).toString()).toBe('%PDF-');
  expect(data.length).toBeGreaterThan((await stat(fixture('reading-sample.pdf'))).size);

  await openPaths(page, [savedPath]);
  await ready(page, download.suggestedFilename());
  await expect.poll(() => page.locator('.annotationLayer, .annotationEditorLayer').evaluateAll(layers =>
    layers.some(layer => layer.textContent?.includes('メモ')),
  )).toBe(true);
});

test('failed PDF serialization keeps edits protected and allows a retry', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page, ['forms-sample.pdf']);
  await ready(page, 'forms-sample.pdf');
  await page.locator('.annotationLayer input[type="text"]').fill('Keep this edit');
  // Reject the worker reply, not saveDocument itself: exercise PDF.js's real
  // finally/resetModified behavior that originally cleared the unsaved flag.
  await page.evaluate(async () => {
    const module = '/src/state.ts';
    const { getActiveTab } = await import(module);
    const handler = getActiveTab().pdf._transport.messageHandler;
    const original = handler.sendWithPromise;
    handler.sendWithPromise = function (action: string, ...args: unknown[]) {
      if (action === 'SaveDocument') {
        handler.sendWithPromise = original;
        return Promise.reject(new Error('Injected serialization failure'));
      }
      return original.call(this, action, ...args);
    };
  });
  await page.keyboard.press('Control+s');
  await expect(page.locator('#toast')).toContainText('Injected serialization failure');
  await expect(page.locator('.tab-main.modified')).toHaveCount(1);
  await expect(page.locator('#save-copy')).toBeEnabled();
  await page.locator('.tab-close').click();
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  await page.locator('#unsaved-cancel').click();
  await expect(page.locator('.annotationLayer input[type="text"]')).toHaveValue('Keep this edit');
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await downloadPromise;
  const savedPath = path.resolve('test-results', 'retry.pdf');
  await download.saveAs(savedPath);
  await expect(page.locator('.tab-main.modified')).toHaveCount(0);
  await openPaths(page, [savedPath]);
  await ready(page, 'retry.pdf');
  await expect(page.locator('.document-pane:not([hidden]) .annotationLayer input[type="text"]')).toHaveValue('Keep this edit');
});

test('closing a tab commits a focused text editor before checking unsaved changes', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page);
  await ready(page);
  await addTextNote(page, 'Still typing', false);
  // Programmatic click deliberately avoids a focusout, like a native close.
  await page.locator('.tab-close').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  await page.locator('#unsaved-cancel').click();
  await expect(page.locator('.freeTextEditor .internal')).toHaveText('Still typing');
  await expect(page.getByRole('tab')).toHaveCount(1);
});

test('automatic reload preserves a focused annotation draft', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page);
  await ready(page);
  await addTextNote(page, 'Keep draft during reload', false);
  const kept = await page.evaluate(async () => {
    const stateModule = '/src/state.ts';
    const tabsModule = '/src/tabs.ts';
    const { getActiveTab } = await import(stateModule);
    const { reloadDocument } = await import(tabsModule);
    const tab = getActiveTab();
    const pdf = tab.pdf;
    await reloadDocument(tab.info);
    return tab.pdf === pdf && tab.modified;
  });
  expect(kept).toBe(true);
  await expect(page.locator('.freeTextEditor .internal')).toHaveText('Keep draft during reload');
});

test('browser reload warns about a focused annotation draft', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page);
  await ready(page);
  await addTextNote(page, 'Keep draft during navigation', false);
  const dialogPromise = page.waitForEvent('dialog');
  // A dismissed reload never completes navigation; schedule it without waiting
  // for a load event so the test checks the retained document immediately.
  await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await expect(page.locator('.freeTextEditor .internal')).toHaveText('Keep draft during navigation');
  await expect(page.locator('.tab-main.modified')).toHaveCount(1);
});

test('annotation swatches remember separate colors for each tool', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page);
  await ready(page);
  await page.locator('#annotate-toggle').click();
  const color = (hex: string) => page.locator(`[data-annotation-color="${hex}"]`);

  await page.locator('[data-annotation-mode="9"]').click();
  await expect(color('#ffff00')).toHaveAttribute('aria-pressed', 'true');
  await color('#00c853').click();
  await page.locator('[data-annotation-mode="3"]').click();
  await expect(color('#1f2933')).toHaveAttribute('aria-pressed', 'true');
  await color('#ff5ca8').click();
  await page.locator('[data-annotation-mode="15"]').click();
  await expect(color('#f44336')).toHaveAttribute('aria-pressed', 'true');
  await color('#1f2933').click();
  await page.locator('[data-annotation-mode="3"]').click();
  await expect(color('#ff5ca8')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-annotation-mode="9"]').click();
  await expect(color('#00c853')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-annotation-mode="15"]').click();
  await expect(color('#1f2933')).toHaveAttribute('aria-pressed', 'true');
});

test('ink strokes mark a document as modified', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page);
  await ready(page);
  await page.locator('#annotate-toggle').click();
  await page.locator('[data-annotation-mode="15"]').click();
  const box = await page.locator('.page[data-page-number="1"] canvas').first().boundingBox();
  if (!box) throw new Error('Page canvas is not visible');
  await page.mouse.move(box.x + box.width * .32, box.y + box.height * .36);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .4, { steps: 6 });
  await page.mouse.move(box.x + box.width * .47, box.y + box.height * .35, { steps: 6 });
  await page.mouse.up();
  await page.locator('[data-annotation-mode="0"]').click();
  await expect(page.locator('.tab-main.modified')).toBeVisible();
});

test('AcroForm fields are saved as a copy and retain their values', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page, ['forms-sample.pdf']);
  await ready(page, 'forms-sample.pdf');
  const nameField = page.locator('.annotationLayer input[type="text"]');
  const approvedField = page.locator('.annotationLayer input[type="checkbox"]');
  await nameField.focus();
  await page.keyboard.press('Control+d');
  await page.keyboard.press('F5');
  await expect(page.locator('#bookmark-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#app')).not.toHaveClass(/presenting/);
  await nameField.fill('PDFReader');
  await approvedField.check();
  await expect(page.locator('.tab-main.modified')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await downloadPromise;
  const savedPath = path.resolve('test-results', download.suggestedFilename());
  await download.saveAs(savedPath);
  const data = await readFile(savedPath);
  expect(data.subarray(0, 5).toString()).toBe('%PDF-');
  expect(data.length).toBeGreaterThan((await stat(fixture('forms-sample.pdf'))).size);

  await openPaths(page, [savedPath]);
  await ready(page, download.suggestedFilename());
  await expect(page.locator('.annotationLayer input[type="text"]').last()).toHaveValue('PDFReader');
  await expect(page.locator('.annotationLayer input[type="checkbox"]').last()).toBeChecked();
});

test('modified tabs can cancel or discard the unsaved-changes dialog', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page);
  await ready(page);
  await addTextNote(page, 'メモ');
  await page.getByRole('button', { name: 'reading-sample.pdf を閉じる' }).click();
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  await page.locator('#unsaved-cancel').click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: 'reading-sample.pdf を閉じる' }).click();
  await page.locator('#unsaved-discard').click();
  await expect(page.getByRole('tab')).toHaveCount(0);
});

test('presentation mode keeps its temporary view settings out of saved positions on reload', async ({ page }) => {
  await useJapanese(page);
  await page.goto('/');
  await open(page);
  await ready(page);
  await page.locator('#zoom').selectOption('1.25');
  await page.locator('#view-menu-toggle').click();
  await page.locator('#spread-odd').click();
  await page.locator('#scroll-vertical').click();
  await expect.poll(() => page.evaluate(() =>
    Object.keys(localStorage).find(key => key.startsWith('pdfreader.position:reading-sample.pdf:')),
  )).toBeTruthy();
  const positionKey = await page.evaluate(() =>
    Object.keys(localStorage).find(key => key.startsWith('pdfreader.position:reading-sample.pdf:')),
  );
  await expect.poll(async () => {
    const position = await page.evaluate(key => JSON.parse(localStorage.getItem(key!) || 'null'), positionKey);
    return [position?.scale, position?.spread, position?.scroll];
  }).toEqual(['1.25', 1, 0]);

  await page.locator('#view-menu-toggle').click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('F5');
  await expect(page.locator('#app')).toHaveClass(/presenting/);
  await page.reload();
  const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key!) || 'null'), positionKey);
  expect(persisted).toMatchObject({ scale: '1.25', spread: 1, scroll: 0 });
});
