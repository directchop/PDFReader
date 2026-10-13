import { AnnotationMode, GlobalWorkerOptions, PasswordResponses, PermissionFlag, getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import * as bridge from './bridge';
import { LocalPdfTransport } from './transport';
import { parsePageRange } from './print-range';
import { icon, mountIcons } from './icons';
import './style.css';

GlobalWorkerOptions.workerSrc = workerUrl;
mountIcons();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const button = (id: string) => $<HTMLButtonElement>(id);
const passwordDialog = $<HTMLDialogElement>('password-dialog');
const printDialog = $<HTMLDialogElement>('print-dialog');

interface ReaderTab {
  info: bridge.DocumentInfo;
  pane: HTMLDivElement;
  container: HTMLDivElement;
  bus: EventBus;
  viewer: PDFViewer;
  links: PDFLinkService;
  find: PDFFindController;
  task: PDFDocumentLoadingTask;
  pdf?: PDFDocumentProxy;
  outline?: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>;
  disposed: boolean;
  query: string;
  matchCase: boolean;
  matchCount: string;
  canPrint: boolean;
  rendered: boolean;
}
const tabs: ReaderTab[] = [];
let active: ReaderTab | undefined;
let sidebarMode: 'pages' | 'outline' = 'pages';
let thumbnailObserver: IntersectionObserver | undefined;
let thumbnailGroup = -1;
let sidebarVersion = 0;
let toastTimer: ReturnType<typeof setTimeout>;
let pendingPassword: { tab: ReaderTab; update: (password: string) => void } | undefined;
let opening = Promise.resolve();
let printGeneration = 0;
let printing = false;
const printUrls: string[] = [];
const printStyle = document.createElement('style');
document.head.append(printStyle);

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function notify(text: string) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 7000);
}
function run(action: () => Promise<unknown>) { void action().catch(error => notify(message(error))); }
function sizeLabel(bytes: number) { return bytes < 1024 ** 2 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }

function refreshTabs() {
  $('tabs').replaceChildren();
  for (const tab of tabs) {
    const item = document.createElement('div'); item.className = `tab${active === tab ? ' active' : ''}`;
    const main = document.createElement('button'); main.className = 'tab-main'; main.role = 'tab';
    main.setAttribute('aria-selected', String(active === tab)); main.title = tab.info.path;
    main.innerHTML = `${icon('file')}<span></span>`; main.querySelector('span')!.textContent = tab.info.name;
    main.onclick = () => activate(tab);
    const close = document.createElement('button'); close.className = 'tab-close icon-button';
    close.innerHTML = icon('close'); close.setAttribute('aria-label', `${tab.info.name} を閉じる`);
    close.onclick = () => run(() => closeTab(tab)); item.append(main, close); $('tabs').append(item);
  }
}

function activate(tab?: ReaderTab) {
  active = tab;
  $('home').hidden = !!tab; $('reader').hidden = !tab;
  for (const candidate of tabs) candidate.pane.hidden = candidate !== tab;
  document.title = tab ? `${tab.info.name} — PDFReader` : 'PDFReader';
  refreshTabs();
  thumbnailGroup = -1;
  if (tab) {
    input('find-input').value = tab.query; input('match-case').checked = tab.matchCase;
    $('find-count').textContent = tab.matchCount;
    refreshToolbar(); void renderSidebar();
    requestAnimationFrame(() => { if (active === tab && tab.pdf) { tab.viewer.update(); } });
  } else {
    thumbnailObserver?.disconnect(); sidebarVersion++; run(refreshRecent);
  }
}

function refreshToolbar() {
  if (!active) return;
  const { viewer, pdf, info } = active;
  input('page-number').value = String(viewer.currentPageNumber || 1);
  input('page-number').max = String(pdf?.numPages || 1);
  $('page-total').textContent = `/ ${pdf?.numPages ?? '—'}`;
  button('previous-page').disabled = !pdf || viewer.currentPageNumber <= 1;
  button('next-page').disabled = !pdf || viewer.currentPageNumber >= pdf.numPages;
  for (const id of ['zoom-in', 'zoom-out', 'rotate', 'find-toggle']) button(id).disabled = !pdf;
  button('print').disabled = !pdf || !active.canPrint;
  $('document-status').textContent = active.rendered ? info.name : '読み込み中…';
  $('document-details').textContent = pdf ? `${pdf.numPages} ページ · ${sizeLabel(info.size)}` : sizeLabel(info.size);
  const zoom = $<HTMLSelectElement>('zoom');
  const value = viewer.currentScaleValue;
  zoom.querySelector('[data-custom]')?.remove();
  if (value && ![...zoom.options].some(o => o.value === value)) {
    const option = new Option(`${Math.round(viewer.currentScale * 100)}%`, value); option.dataset.custom = 'true'; zoom.add(option);
  }
  zoom.value = value || 'auto';
}

function enqueue(batch: bridge.OpenBatch) {
  opening = opening.then(async () => {
    if (batch.errors.length) notify(batch.errors.join('\n'));
    for (const info of batch.documents) await loadDocument(info);
    await refreshRecent();
  }).catch(error => notify(message(error)));
}

async function loadDocument(info: bridge.DocumentInfo) {
  const existing = tabs.find(t => t.info.id === info.id);
  if (existing) { activate(existing); return; }
  const pane = document.createElement('div'); pane.className = 'document-pane';
  pane.innerHTML = '<div class="viewer-container" tabindex="0" aria-label="PDF文書"><div class="pdfViewer"></div></div><div class="loading-message">PDFを開いています…</div>';
  $('documents').append(pane);
  $('home').hidden = true; $('reader').hidden = false;
  const container = pane.querySelector<HTMLDivElement>('.viewer-container')!;
  const bus = new EventBus();
  const links = new PDFLinkService({ eventBus: bus, ignoreDestinationZoom: true });
  links.externalLinkEnabled = false;
  const find = new PDFFindController({ eventBus: bus, linkService: links });
  const viewer = new PDFViewer({ container, eventBus: bus, linkService: links, findController: find,
    textLayerMode: 1, annotationMode: AnnotationMode.ENABLE, enablePermissions: true,
    enableAutoLinking: false, maxCanvasPixels: 16 * 1024 * 1024, imageResourcesPath: '/pdfjs/images/',
  });
  links.setViewer(viewer);
  const transport = new LocalPdfTransport(info, error => {
    notify(message(error)); run(() => closeTab(tab));
  });
  const task = getDocument({
    range: transport, rangeChunkSize: 65536, disableStream: true, disableAutoFetch: true,
    cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/',
    enableXfa: false,
  });
  const tab: ReaderTab = { info, pane, container, bus, viewer, links, find, task, disposed: false,
    query: '', matchCase: false, matchCount: '', canPrint: true, rendered: false };
  tabs.push(tab); activate(tab);
  task.onPassword = (update: (password: string) => void, reason: number) => {
    if (tab.disposed) return;
    activate(tab); pendingPassword = { tab, update };
    $('password-message').textContent = reason === PasswordResponses.INCORRECT_PASSWORD ? 'パスワードが違います。もう一度入力してください。' : `${info.name} を開くためのパスワードを入力してください。`;
    input('password').value = ''; passwordDialog.showModal(); input('password').focus();
  };
  bus.on('pagesinit', () => { viewer.currentScaleValue = 'auto'; if (active === tab) { refreshToolbar(); void renderSidebar(); } });
  bus.on('pagerendered', () => {
    tab.rendered = true; pane.querySelector('.loading-message')?.remove();
    if (active === tab) refreshToolbar();
  });
  bus.on('pagechanging', () => {
    if (active !== tab) return; refreshToolbar();
    if (sidebarMode === 'pages' && Math.floor((viewer.currentPageNumber - 1) / 30) !== thumbnailGroup) void renderSidebar();
    $('sidebar-content').querySelectorAll<HTMLElement>('.thumbnail').forEach(el => el.classList.toggle('active', Number(el.dataset.page) === viewer.currentPageNumber));
  });
  bus.on('scalechanging', () => { if (active === tab) refreshToolbar(); });
  bus.on('updatefindmatchescount', (event: { matchesCount: { current: number; total: number } }) => {
    tab.matchCount = `${event.matchesCount.current} / ${event.matchesCount.total} 件`;
    if (active === tab) $('find-count').textContent = tab.matchCount;
  });
  bus.on('updatefindcontrolstate', (event: { state: number; matchesCount: { current: number; total: number } }) => {
    tab.matchCount = event.state === 1 ? '見つかりません' : event.state === 3 ? '検索中…' : `${event.matchesCount.current} / ${event.matchesCount.total} 件`;
    if (active === tab) $('find-count').textContent = tab.matchCount;
  });
  try {
    const pdf = await task.promise;
    if (tab.disposed) return;
    tab.pdf = pdf;
    const permissions = await pdf.getPermissions();
    if (tab.disposed) return;
    tab.canPrint = !permissions || permissions.has(PermissionFlag.PRINT) || permissions.has(PermissionFlag.PRINT_HIGH_QUALITY);
    links.setDocument(pdf); viewer.setDocument(pdf);
    tab.outline = await pdf.getOutline();
    if (tab.disposed) return;
    if (active === tab) { refreshToolbar(); await renderSidebar(); }
  } catch (error) {
    if (!tab.disposed) { notify(`${info.name}: PDFを開けませんでした。${message(error)}`); await closeTab(tab); }
  }
}

async function closeTab(tab: ReaderTab) {
  if (tab.disposed) return;
  tab.disposed = true;
  if (pendingPassword?.tab === tab) { pendingPassword = undefined; input('password').value = ''; passwordDialog.close(); }
  const index = tabs.indexOf(tab); tabs.splice(index, 1);
  if (active === tab) activate(tabs[Math.min(index, tabs.length - 1)]); else refreshTabs();
  tab.viewer.setDocument(null!); tab.links.setDocument(null); tab.pane.remove();
  try { await tab.task.destroy(); } finally { await bridge.closeDocument(tab.info.id); }
}

async function renderSidebar() {
  thumbnailObserver?.disconnect();
  const version = ++sidebarVersion;
  const content = $('sidebar-content'); content.replaceChildren();
  $('show-pages').classList.toggle('selected', sidebarMode === 'pages');
  $('show-outline').classList.toggle('selected', sidebarMode === 'outline');
  const tab = active;
  if (!tab?.pdf || $('sidebar').hidden) return;
  if (sidebarMode === 'outline') {
    const outline = tab.outline;
    if (!outline?.length) { content.innerHTML = '<p class="sidebar-empty">このPDFには目次がありません。</p>'; return; }
    type Outline = NonNullable<ReaderTab['outline']>;
    function append(items: Outline, depth = 0) {
      for (const item of items) {
        const el = document.createElement('button'); el.className = 'outline-item'; el.textContent = item.title;
        el.style.paddingLeft = `${7 + Math.min(depth, 8) * 12}px`;
        el.onclick = () => { const dest = item.dest; if (dest) run(() => tab!.links.goToDestination(dest)); };
        content.append(el); if (item.items.length) append(item.items, depth + 1);
      }
    }
    append(outline); return;
  }
  const first = Math.floor((tab.viewer.currentPageNumber - 1) / 30) * 30 + 1;
  thumbnailGroup = Math.floor((first - 1) / 30);
  const last = Math.min(first + 29, tab.pdf.numPages);
  if (tab.pdf.numPages > 30) {
    const navigation = document.createElement('div'); navigation.className = 'thumb-pagination';
    const prev = document.createElement('button'); prev.textContent = '‹'; prev.setAttribute('aria-label', '前の30ページ'); prev.disabled = first === 1;
    prev.onclick = () => { tab.viewer.currentPageNumber = Math.max(1, first - 30); };
    const label = document.createElement('span'); label.textContent = `${first}–${last}`;
    const next = document.createElement('button'); next.textContent = '›'; next.setAttribute('aria-label', '次の30ページ'); next.disabled = last === tab.pdf.numPages;
    next.onclick = () => { tab.viewer.currentPageNumber = last + 1; };
    navigation.append(prev, label, next); content.append(navigation);
  }
  thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target as HTMLButtonElement; thumbnailObserver?.unobserve(el);
      const pageNumber = Number(el.dataset.page);
      void (async () => {
        const page = await tab.pdf!.getPage(pageNumber);
        if (version !== sidebarVersion || tab.disposed) return;
        const base = page.getViewport({ scale: 1, rotation: (page.rotate + tab.viewer.pagesRotation) % 360 });
        const viewport = page.getViewport({ scale: 168 / base.width, rotation: base.rotation });
        const canvas = el.querySelector('canvas')!;
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
      })().catch(() => { /* Closing or switching a tab can cancel a thumbnail. */ });
    }
  }, { root: content, rootMargin: '120px' });
  for (let n = first; n <= last; n++) {
    const el = document.createElement('button'); el.className = `thumbnail${n === tab.viewer.currentPageNumber ? ' active' : ''}`; el.dataset.page = String(n);
    el.setAttribute('aria-label', `${n}ページへ`); el.innerHTML = `<canvas width="112" height="158" aria-hidden="true"></canvas><span>${n}</span>`;
    el.onclick = () => { tab.viewer.currentPageNumber = n; };
    content.append(el); thumbnailObserver.observe(el);
  }
}

async function refreshRecent() {
  const items = await bridge.recentDocuments();
  const list = $('recent-list'); list.replaceChildren(); button('clear-recent').disabled = items.length === 0;
  if (!items.length) { list.innerHTML = '<div class="recent-empty">開いたPDFがここに表示されます。</div>'; return; }
  for (const item of items.slice(0, 6)) {
    const el = document.createElement('button'); el.className = 'recent-item'; el.title = item.path;
    el.innerHTML = `${icon('file')}<div><strong></strong><small></small></div>`;
    el.querySelector('strong')!.textContent = item.name; el.querySelector('small')!.textContent = item.path;
    el.onclick = () => run(async () => enqueue({ documents: [await bridge.reopenRecent(item.path)], errors: [] }));
    list.append(el);
  }
}

function showFind() { if (!active?.pdf) return; $('findbar').hidden = false; input('find-input').focus(); input('find-input').select(); }
function hideFind() { $('findbar').hidden = true; active?.bus.dispatch('findbarclose', {}); active?.container.focus(); }
function search(type = '', backwards = false) {
  if (!active?.pdf) return;
  active.query = input('find-input').value; active.matchCase = input('match-case').checked;
  active.bus.dispatch('find', { source: window, type, query: active.query, caseSensitive: active.matchCase, entireWord: false, highlightAll: true, findPrevious: backwards, matchDiacritics: false });
  if (!active.query) $('find-count').textContent = '';
}
function zoomBy(amount: number) {
  if (!active?.pdf) return;
  active.viewer.currentScale = Math.max(.25, Math.min(5, active.viewer.currentScale * amount));
}
function setScale(value: string) {
  if (!active?.pdf) return;
  active.viewer.currentScaleValue = value;
  if (value === 'page-fit') active.viewer.scrollPageIntoView({ pageNumber: active.viewer.currentPageNumber });
}
function showPrint() {
  if (!active?.pdf || !active.canPrint || printing || printDialog.open) return;
  input('print-range').value = ''; $('print-progress').textContent = ''; printDialog.showModal();
}
function clearPrintOutput() {
  $('print-output').replaceChildren(); printUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
}
async function preparePrint() {
  const tab = active;
  if (!tab?.pdf || printing) return;
  let pages: number[];
  try { pages = parsePageRange(input('print-range').value, tab.pdf.numPages); }
  catch (error) { $('print-progress').textContent = message(error); return; }
  const generation = ++printGeneration;
  printing = true; button('print-submit').disabled = true; clearPrintOutput();
  let totalPixels = 0;
  try {
    const first = await tab.pdf.getPage(pages[0]);
    const firstSize = first.getViewport({ scale: 1, rotation: (first.rotate + tab.viewer.pagesRotation) % 360 });
    printStyle.textContent = `@page { size: ${firstSize.width}pt ${firstSize.height}pt; margin: 0; } @media print { .print-page { width: ${firstSize.width}pt; height: ${firstSize.height}pt; } }`;
    for (const [index, number] of pages.entries()) {
      if (generation !== printGeneration || tab.disposed) return;
      $('print-progress').textContent = `印刷用ページを準備中 ${index + 1} / ${pages.length}`;
      const page = await tab.pdf.getPage(number);
      const base = page.getViewport({ scale: 1, rotation: (page.rotate + tab.viewer.pagesRotation) % 360 });
      const scale = Math.min(150 / 72, Math.sqrt(8_000_000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale, rotation: base.rotation });
      totalPixels += viewport.width * viewport.height;
      if (totalPixels > 120_000_000) throw new Error('印刷データが大きいため、ページ範囲を分けて印刷してください。');
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, intent: 'print', annotationMode: AnnotationMode.ENABLE }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('印刷画像を生成できませんでした。'))));
      canvas.width = canvas.height = 0;
      if (generation !== printGeneration) return;
      const url = URL.createObjectURL(blob); printUrls.push(url);
      const image = new Image(); image.src = url; await image.decode();
      const paper = document.createElement('div'); paper.className = 'print-page'; paper.append(image); $('print-output').append(paper);
    }
    if (generation !== printGeneration) return;
    printDialog.close();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await bridge.printDocument();
    // Native print dialogs can outlive the Rust command. Keep this immutable
    // snapshot until afterprint or the next print, even if the source tab closes.
  } catch (error) {
    clearPrintOutput();
    if (printDialog.open) $('print-progress').textContent = message(error); else notify(message(error));
  } finally {
    printing = false; button('print-submit').disabled = false;
    if (generation !== printGeneration) clearPrintOutput();
  }
}

button('open').onclick = button('welcome-open').onclick = () => run(async () => enqueue(await bridge.openDocuments()));
document.querySelector('.brand')!.addEventListener('click', event => { event.preventDefault(); activate(); });
button('clear-recent').onclick = () => run(async () => { await bridge.clearRecent(); await refreshRecent(); });
button('sidebar-toggle').onclick = () => { $('sidebar').hidden = !$('sidebar').hidden; button('sidebar-toggle').setAttribute('aria-pressed', String(!$('sidebar').hidden)); void renderSidebar(); window.dispatchEvent(new Event('resize')); };
button('show-pages').onclick = () => { sidebarMode = 'pages'; void renderSidebar(); };
button('show-outline').onclick = () => { sidebarMode = 'outline'; void renderSidebar(); };
button('previous-page').onclick = () => { if (active?.pdf) active.viewer.previousPage(); };
button('next-page').onclick = () => { if (active?.pdf) active.viewer.nextPage(); };
input('page-number').onchange = () => { if (active?.pdf) active.viewer.currentPageNumber = Math.max(1, Math.min(active.pdf.numPages, Number(input('page-number').value) || 1)); refreshToolbar(); };
$<HTMLSelectElement>('zoom').onchange = () => setScale($<HTMLSelectElement>('zoom').value);
button('zoom-in').onclick = () => zoomBy(1.2); button('zoom-out').onclick = () => zoomBy(1 / 1.2);
button('rotate').onclick = () => { if (active?.pdf) { active.viewer.pagesRotation = (active.viewer.pagesRotation + 90) % 360; void renderSidebar(); } };
button('find-toggle').onclick = showFind; button('find-close').onclick = hideFind;
input('find-input').oninput = () => search(); input('match-case').onchange = () => search('casesensitivitychange');
input('find-input').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); search('again', event.shiftKey); } else if (event.key === 'Escape') hideFind(); };
button('find-next').onclick = () => search('again'); button('find-previous').onclick = () => search('again', true);
button('print').onclick = showPrint;
$('print-form').onsubmit = event => { event.preventDefault(); run(preparePrint); };
const cancelPrint = () => { printGeneration++; printDialog.close(); };
button('print-cancel').onclick = cancelPrint; printDialog.addEventListener('cancel', cancelPrint);
window.addEventListener('afterprint', clearPrintOutput);
$('password-form').onsubmit = event => { event.preventDefault(); const pending = pendingPassword; pendingPassword = undefined; const password = input('password').value; input('password').value = ''; passwordDialog.close(); pending?.update(password); };
const cancelPassword = () => { if (pendingPassword) run(() => closeTab(pendingPassword!.tab)); };
button('password-cancel').onclick = cancelPassword; passwordDialog.addEventListener('cancel', cancelPassword);

window.addEventListener('keydown', event => {
  if (passwordDialog.open || printDialog.open || printing) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && key === 'o') { event.preventDefault(); button('open').click(); }
  else if (mod && key === 'f') { event.preventDefault(); showFind(); }
  else if (mod && key === 'p') { event.preventDefault(); showPrint(); }
  else if (mod && key === 'w' && active) { event.preventDefault(); run(() => closeTab(active!)); }
  else if (event.ctrlKey && key === 'tab' && tabs.length) { event.preventDefault(); const next = (tabs.indexOf(active!) + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length; activate(tabs[next]); }
  else if (mod && (key === '+' || key === '=')) { event.preventDefault(); zoomBy(1.2); }
  else if (mod && key === '-') { event.preventDefault(); zoomBy(1 / 1.2); }
  else if (mod && key === '0' && active?.pdf) { event.preventDefault(); setScale('page-fit'); }
  else if (key === 'escape' && !$('findbar').hidden) hideFind();
});
window.addEventListener('resize', () => {
  if (!active?.pdf) return;
  const scale = active.viewer.currentScaleValue;
  if (['auto', 'page-width', 'page-fit'].includes(scale)) active.viewer.currentScaleValue = scale;
  active.viewer.update();
});
// Block external PDF links and browser navigation. Internal destinations are
// handled by PDFLinkService; documents never gain access to the host shell.
document.addEventListener('click', event => {
  const anchor = (event.target as Element).closest<HTMLAnchorElement>('.annotationLayer a');
  if (anchor && !anchor.classList.contains('internalLink')) { event.preventDefault(); event.stopPropagation(); }
}, true);
if (!bridge.desktop) {
  document.querySelector('.local-badge')!.textContent = 'ブラウザプレビュー';
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer?.files.length) run(async () => enqueue(await bridge.acceptBrowserFiles([...e.dataTransfer!.files]))); });
}
run(async () => {
  await bridge.onDocumentsReady(() => run(async () => enqueue(await bridge.takePending())));
  enqueue(await bridge.takePending());
  await refreshRecent();
});
