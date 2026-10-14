// Windows regression test against the actual Rust/WebView2 window. Use a test
// build with an isolated Tauri identifier so existing user sessions stay intact.
// Usage: node scripts/native-annotations-smoke.mjs path/to/pdfreader.exe
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';

if (process.platform !== 'win32') throw new Error('This test requires Windows WebView2.');
if (!process.argv[2]) throw new Error('Supply an isolated test build of pdfreader.exe.');
const output = path.resolve('artifacts/native-annotations');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const app = spawn(path.resolve(process.argv[2]), [path.resolve('tests/fixtures/reading-sample.pdf')], {
  windowsHide: true, stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: profile },
});
let launchError;
app.on('error', error => { launchError = error; });
async function requestClose() {
  // CloseMainWindow sends WM_CLOSE to this test process only. It does not kill it.
  const sender = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `if (-not (Get-Process -Id ${app.pid}).CloseMainWindow()) { exit 1 }`],
  { windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    sender.on('error', reject);
    sender.on('exit', code => code === 0 ? resolve() : reject(new Error(`WM_CLOSE failed: ${code}`)));
  });
}
let browser;
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (launchError) throw launchError;
    assert.equal(app.exitCode, null, 'Test app exited before connecting.');
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert(browser, 'WebView2 debugging endpoint was not available.');
  const context = browser.contexts()[0];
  await expect.poll(() => context.pages().some(page => page.url().includes('tauri.localhost'))).toBe(true);
  const page = context.pages().find(page => page.url().includes('tauri.localhost'));
  await expect(page.locator('#document-status')).toHaveText('reading-sample.pdf');
  const pane = page.locator('.document-pane:not([hidden])');
  await expect(pane.locator('.page canvas').first()).toBeVisible();
  await page.locator('#annotate-toggle').click();
  await page.locator('[data-annotation-mode="3"]').click();
  const box = await pane.locator('.page[data-page-number="1"]').boundingBox();
  assert(box);
  await page.mouse.click(box.x + box.width * .55, box.y + box.height * .4);
  const editor = pane.locator('.freeTextEditor .internal').last();
  await editor.fill('Keep this focused native note');
  await expect(editor).toBeFocused();
  await requestClose();
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  assert.equal(app.exitCode, null);
  await page.locator('#unsaved-cancel').click();
  await expect(editor).toHaveText('Keep this focused native note');

  await expect(page.locator('.tab-main.modified')).toHaveCount(1);
  await expect(page.locator('#save-copy')).toBeEnabled();
  await requestClose();
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  await page.screenshot({ path: path.join(output, 'protected-unsaved-note.png') });
  await page.locator('#unsaved-discard').click();
  await expect.poll(() => app.exitCode).toBe(0);
  console.log('PASS: focused native editor close/cancel preserves text; repeated close prompts; explicit discard exits.');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app.exitCode === null) app.kill();
}
