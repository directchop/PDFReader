// Windows integration test against the actual packaged Rust/WebView2 process.
// Remote debugging is enabled only for this child process, never in app config.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';

if (process.platform !== 'win32') throw new Error('This smoke test targets Windows WebView2.');
const output = 'artifacts/native-smoke';
await mkdir(output, { recursive: true });
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const exe = path.resolve(process.argv[2] || 'src-tauri/target/release/pdfreader.exe');
const file = path.resolve('tests/fixtures/reading-sample.pdf');
const app = spawn(exe, [file], {
  windowsHide: true,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: path.resolve(output, 'webview-profile') },
  stdio: 'ignore',
});
let browser;
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (app.exitCode !== null) throw new Error('PDFReader exited. Close any existing PDFReader instance before testing.');
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
    catch { await new Promise(r => setTimeout(r, 250)); }
  }
  assert(browser, 'WebView2 did not expose a debugging endpoint.');
  const context = browser.contexts()[0];
  let page;
  for (let attempt = 0; attempt < 80; attempt++) {
    page = context.pages().find(p => p.url().includes('tauri.localhost'));
    if (page) break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert(page, 'Native app page not found.');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.waitForFunction(() => document.querySelector('#document-status')?.textContent === 'reading-sample.pdf', { timeout: 30_000 });
  await page.getByRole('button', { name: '文書内を検索' }).click();
  await page.getByRole('searchbox', { name: '検索文字列' }).fill('日本語');
  await page.waitForFunction(() => document.querySelector('#find-count')?.textContent.includes('3 件'));
  await page.getByRole('button', { name: '検索を閉じる' }).click();
  await page.getByLabel('表示倍率').selectOption('page-fit');
  await page.screenshot({ path: `${output}/native-reader.png` });

  const access = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    let unknownRejected = false, pathRejected = false;
    try { await invoke('read_document_range', { id: 'unknown', begin: 0, end: 5 }); } catch { unknownRejected = true; }
    try { await invoke('reopen_recent', { path: 'C:\\Windows\\win.ini' }); } catch { pathRejected = true; }
    return { unknownRejected, pathRejected };
  });
  assert(access.unknownRejected && access.pathRejected, 'Unexpected filesystem access.');
  await page.evaluate(() => { window.print = () => { document.body.dataset.nativePrintCalled = 'true'; }; });
  await page.getByRole('button', { name: '印刷', exact: true }).click();
  await page.getByLabel('ページ範囲').fill('2');
  await page.getByRole('button', { name: '印刷へ進む' }).click();
  await page.waitForFunction(() => document.body.dataset.nativePrintCalled === 'true');
  assert.equal(await page.locator('#print-output img').count(), 1);
  const cdp = await context.newCDPSession(page);
  const print = await cdp.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
  await writeFile(`${output}/native-printed.pdf`, Buffer.from(print.data, 'base64'));
  await page.getByRole('button', { name: 'reading-sample.pdf を閉じる' }).click();
  await page.locator('#home').waitFor({ state: 'visible' });
  await page.screenshot({ path: `${output}/native-home.png` });
  assert.deepEqual(errors, [], 'Unexpected native renderer errors.');
  console.log('PASS: Rust file opening/range IPC, Japanese rendering/search, capability rejection, native print dispatch, WebView2 PDF output, close/home.');
} finally {
  if (browser) await browser.close();
  app.kill();
}
