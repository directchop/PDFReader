import { AnnotationMode, GlobalWorkerOptions, PasswordResponses, PermissionFlag, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import * as bridge from './bridge';
import { LocalPdfTransport } from './transport';
import { icon } from './icons';
import { $, button, input, message, notify, run } from './dom';
import { getActiveTab, setActiveTab, state, tabs, type ReaderTab } from './state';
import { refreshToolbar } from './toolbar';
import { renderSidebar } from './sidebar';
import { refreshRecent } from './recent';

export function refreshTabs() {
  $('tabs').replaceChildren();
  for (const tab of tabs) {
    const item = document.createElement('div');
    item.className = `tab${getActiveTab() === tab ? ' active' : ''}`;
    const main = document.createElement('button');
    main.className = 'tab-main';
    main.role = 'tab';
    main.setAttribute('aria-selected', String(getActiveTab() === tab));
    main.title = tab.info.path;
    main.innerHTML = `${icon('file')}<span></span>`;
    main.querySelector('span')!.textContent = tab.info.name;
    main.onclick = () => activate(tab);
    const close = document.createElement('button');
    close.className = 'tab-close icon-button';
    close.innerHTML = icon('close');
    close.setAttribute('aria-label', `${tab.info.name} を閉じる`);
    close.onclick = () => run(() => closeTab(tab));
    item.append(main, close);
    $('tabs').append(item);
  }
}

export function activate(tab?: ReaderTab) {
  setActiveTab(tab);
  $('home').hidden = !!tab;
  $('reader').hidden = !tab;
  for (const candidate of tabs) candidate.pane.hidden = candidate !== tab;
  document.title = tab ? `${tab.info.name} — PDFReader` : 'PDFReader';
  refreshTabs();
  state.thumbnailGroup = -1;
  if (tab) {
    input('find-input').value = tab.query;
    input('match-case').checked = tab.matchCase;
    $('find-count').textContent = tab.matchCount;
    refreshToolbar();
    void renderSidebar();
    requestAnimationFrame(() => {
      if (getActiveTab() === tab && tab.pdf) tab.viewer.update();
    });
  } else {
    state.thumbnailObserver?.disconnect();
    state.sidebarVersion++;
    run(refreshRecent);
  }
}

export function enqueue(batch: bridge.OpenBatch) {
  state.opening = state.opening.then(async () => {
    if (batch.errors.length) notify(batch.errors.join('\n'));
    for (const info of batch.documents) await loadDocument(info);
    await refreshRecent();
  }).catch(error => notify(message(error)));
}

export async function loadDocument(info: bridge.DocumentInfo) {
  const existing = tabs.find(tab => tab.info.id === info.id);
  if (existing) {
    activate(existing);
    return;
  }
  const pane = document.createElement('div');
  pane.className = 'document-pane';
  pane.innerHTML = '<div class="viewer-container" tabindex="0" aria-label="PDF文書"><div class="pdfViewer"></div></div><div class="loading-message">PDFを開いています…</div>';
  $('documents').append(pane);
  $('home').hidden = true;
  $('reader').hidden = false;
  const container = pane.querySelector<HTMLDivElement>('.viewer-container')!;
  const bus = new EventBus();
  const links = new PDFLinkService({ eventBus: bus, ignoreDestinationZoom: true });
  links.externalLinkEnabled = false;
  const find = new PDFFindController({ eventBus: bus, linkService: links });
  const viewer = new PDFViewer({
    container,
    eventBus: bus,
    linkService: links,
    findController: find,
    textLayerMode: 1,
    annotationMode: AnnotationMode.ENABLE,
    enablePermissions: true,
    enableAutoLinking: false,
    maxCanvasPixels: 16 * 1024 * 1024,
    imageResourcesPath: '/pdfjs/images/',
  });
  links.setViewer(viewer);
  const transport = new LocalPdfTransport(info, error => {
    notify(message(error));
    run(() => closeTab(tab));
  });
  const task = getDocument({
    range: transport,
    rangeChunkSize: 65536,
    disableStream: true,
    disableAutoFetch: true,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    enableXfa: false,
  });
  const tab: ReaderTab = {
    info,
    pane,
    container,
    bus,
    viewer,
    links,
    find,
    task,
    disposed: false,
    query: '',
    matchCase: false,
    matchCount: '',
    canPrint: true,
    rendered: false,
  };
  tabs.push(tab);
  activate(tab);
  task.onPassword = (update: (password: string) => void, reason: number) => {
    if (tab.disposed) return;
    activate(tab);
    state.pendingPassword = { tab, update };
    $('password-message').textContent = reason === PasswordResponses.INCORRECT_PASSWORD ? 'パスワードが違います。もう一度入力してください。' : `${info.name} を開くためのパスワードを入力してください。`;
    input('password').value = '';
    $<HTMLDialogElement>('password-dialog').showModal();
    input('password').focus();
  };
  bus.on('pagesinit', () => {
    viewer.currentScaleValue = 'auto';
    if (getActiveTab() === tab) {
      refreshToolbar();
      void renderSidebar();
    }
  });
  bus.on('pagerendered', () => {
    tab.rendered = true;
    pane.querySelector('.loading-message')?.remove();
    if (getActiveTab() === tab) refreshToolbar();
  });
  bus.on('pagechanging', () => {
    if (getActiveTab() !== tab) return;
    refreshToolbar();
    if (state.sidebarMode === 'pages' && Math.floor((viewer.currentPageNumber - 1) / 30) !== state.thumbnailGroup) {
      void renderSidebar();
    }
    $('sidebar-content').querySelectorAll<HTMLElement>('.thumbnail').forEach(el => el.classList.toggle('active', Number(el.dataset.page) === viewer.currentPageNumber));
  });
  bus.on('scalechanging', () => {
    if (getActiveTab() === tab) refreshToolbar();
  });
  bus.on('updatefindmatchescount', (event: { matchesCount: { current: number; total: number } }) => {
    tab.matchCount = `${event.matchesCount.current} / ${event.matchesCount.total} 件`;
    if (getActiveTab() === tab) $('find-count').textContent = tab.matchCount;
  });
  bus.on('updatefindcontrolstate', (event: { state: number; matchesCount: { current: number; total: number } }) => {
    tab.matchCount = event.state === 1 ? '見つかりません' : event.state === 3 ? '検索中…' : `${event.matchesCount.current} / ${event.matchesCount.total} 件`;
    if (getActiveTab() === tab) $('find-count').textContent = tab.matchCount;
  });
  try {
    const pdf = await task.promise;
    if (tab.disposed) return;
    tab.pdf = pdf;
    const permissions = await pdf.getPermissions();
    if (tab.disposed) return;
    tab.canPrint = !permissions || permissions.has(PermissionFlag.PRINT) || permissions.has(PermissionFlag.PRINT_HIGH_QUALITY);
    links.setDocument(pdf);
    viewer.setDocument(pdf);
    tab.outline = await pdf.getOutline();
    if (tab.disposed) return;
    if (getActiveTab() === tab) {
      refreshToolbar();
      await renderSidebar();
    }
  } catch (error) {
    if (!tab.disposed) {
      notify(`${info.name}: PDFを開けませんでした。${message(error)}`);
      await closeTab(tab);
    }
  }
}

export async function closeTab(tab: ReaderTab) {
  if (tab.disposed) return;
  tab.disposed = true;
  if (state.pendingPassword?.tab === tab) {
    state.pendingPassword = undefined;
    input('password').value = '';
    $<HTMLDialogElement>('password-dialog').close();
  }
  const index = tabs.indexOf(tab);
  tabs.splice(index, 1);
  if (getActiveTab() === tab) activate(tabs[Math.min(index, tabs.length - 1)]);
  else refreshTabs();
  tab.viewer.setDocument(null!);
  tab.links.setDocument(null);
  tab.pane.remove();
  try {
    await tab.task.destroy();
  } finally {
    await bridge.closeDocument(tab.info.id);
  }
}
