import { AnnotationEditorType, AnnotationMode, GlobalWorkerOptions, PasswordResponses, PermissionFlag, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer, ScrollMode, SpreadMode } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import * as bridge from './bridge';
import type { ReadingPosition } from './bridge';
import { LocalPdfTransport } from './transport';
import { icon } from './icons';
import { $, button, input, message, notify, run } from './dom';
import { getActiveTab, setActiveTab, state, tabs, type ReaderTab } from './state';
import { refreshToolbar } from './toolbar';
import { renderSidebar } from './sidebar';
import { refreshRecent } from './recent';
import { describeError, t } from './i18n';
import { refreshFindCount, search } from './find';
import { closeAnnotationBar, highlightColors, refreshAnnotationToolbar, saveAsCopy } from './annotations';
import { requestUnsavedChoice } from './unsaved';
import { presentationBaseline } from './presentation';

let sessionTimer: ReturnType<typeof setTimeout> | undefined;
let suppressSessionSave = false;
const changedReadNotices = new Set<string>();

function readErrorCode(error: unknown) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return '';
}

function notifyChangedRead(tab: ReaderTab, info: bridge.DocumentInfo) {
  const key = `${tab.info.id}:${info.generation}`;
  if (changedReadNotices.has(key)) return;
  changedReadNotices.add(key);
  notify(t('error.document_changed', { name: info.name }));
}

function scheduleSessionSave() {
  if (suppressSessionSave) return;
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    sessionTimer = undefined;
    void flushSession();
  }, 300);
}

export async function flushSession() {
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = undefined;
  try {
    await bridge.saveSession(tabs.map(tab => tab.info.id), getActiveTab()?.info.id ?? null);
  } catch {
  }
}

function schedulePositionSave(tab: ReaderTab) {
  if (tab.positionTimer) clearTimeout(tab.positionTimer);
  tab.positionTimer = setTimeout(() => {
    tab.positionTimer = undefined;
    void flushPosition(tab).catch(error => notify(message(error)));
  }, 800);
}

function handlePassword(tab: ReaderTab, name: string, update: (password: string) => void, reason: number) {
  if (tab.disposed) return;
  activate(tab);
  state.pendingPassword = { tab, update };
  $('password-message').textContent = reason === PasswordResponses.INCORRECT_PASSWORD ? t('password.incorrect') : t('password.forDocument', { name });
  input('password').value = '';
  $<HTMLDialogElement>('password-dialog').showModal();
  input('password').focus();
}

function trackModifiedState(tab: ReaderTab) {
  if (!tab.pdf) return;
  const refresh = () => {
    refreshTabs();
    if (getActiveTab() === tab) refreshAnnotationToolbar();
  };
  const storage = tab.pdf.annotationStorage as unknown as {
    onSetModified: (() => void) | null;
    onResetModified: (() => void) | null;
  };
  storage.onSetModified = () => {
    tab.modified = true;
    refresh();
  };
  storage.onResetModified = () => {
    tab.modified = false;
    refresh();
  };
}

function loadPdf(info: bridge.DocumentInfo, tab: ReaderTab, onReadError: (error: unknown) => void) {
  const transport = new LocalPdfTransport(info, onReadError);
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
  task.onPassword = (update: (password: string) => void, reason: number) => handlePassword(tab, info.name, update, reason);
  const loaded = task.promise.then(async pdf => {
    const permissions = await pdf.getPermissions();
    const outline = await pdf.getOutline();
    return {
      pdf,
      outline,
      canPrint: !permissions || permissions.has(PermissionFlag.PRINT) || permissions.has(PermissionFlag.PRINT_HIGH_QUALITY),
    };
  });
  return { task, loaded };
}

export async function flushPosition(tab: ReaderTab) {
  if (tab.positionTimer) clearTimeout(tab.positionTimer);
  tab.positionTimer = undefined;
  if (!tab.pdf || tab.disposed) return;
  const baseline = presentationBaseline(tab);
  const scale = baseline?.scale ?? (tab.viewer.currentScaleValue || 'auto');
  const position: ReadingPosition = {
    page: tab.viewer.currentPageNumber,
    pages: tab.pdf.numPages,
    scale,
    rotation: tab.viewer.pagesRotation,
    spread: baseline?.spread ?? tab.viewer.spreadMode,
    scroll: baseline?.scroll ?? tab.viewer.scrollMode,
  };
  try {
    await bridge.savePosition(tab.info.id, position);
  } catch (error) {
    if (message(error) !== t('error.not_in_recent')) throw error;
  }
}

export function refreshTabs() {
  $('tabs').replaceChildren();
  for (const tab of tabs) {
    const item = document.createElement('div');
    item.className = `tab${getActiveTab() === tab ? ' active' : ''}`;
    const main = document.createElement('button');
    main.className = 'tab-main';
    main.classList.toggle('modified', tab.modified);
    main.role = 'tab';
    main.setAttribute('aria-selected', String(getActiveTab() === tab));
    if (tab.modified) main.setAttribute('aria-description', t('annotation.unsaved'));
    else main.removeAttribute('aria-description');
    main.title = tab.info.path;
    main.innerHTML = `${icon('file')}<span></span>`;
    main.querySelector('span')!.textContent = tab.info.name;
    main.onclick = () => activate(tab);
    const close = document.createElement('button');
    close.className = 'tab-close icon-button';
    close.innerHTML = icon('close');
    close.setAttribute('aria-label', t('tab.close', { name: tab.info.name }));
    close.onclick = () => run(() => closeTab(tab));
    item.append(main, close);
    $('tabs').append(item);
  }
}

export function activate(tab?: ReaderTab) {
  const previous = getActiveTab();
  if (previous !== tab) closeAnnotationBar(previous);
  setActiveTab(tab);
  scheduleSessionSave();
  $('home').hidden = !!tab;
  $('reader').hidden = !tab;
  for (const candidate of tabs) candidate.pane.hidden = candidate !== tab;
  document.title = tab ? `${tab.info.name} — PDFReader` : 'PDFReader';
  refreshTabs();
  state.thumbnailGroup = -1;
  if (tab) {
    input('find-input').value = tab.query;
    input('match-case').checked = tab.matchCase;
    refreshFindCount();
    refreshToolbar();
    refreshAnnotationToolbar();
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

export function enqueue(batch: bridge.OpenBatch, activePath?: string | null, restoring = false) {
  state.opening = state.opening.then(async () => {
    if (restoring) suppressSessionSave = true;
    try {
      if (batch.errors.length) notify(batch.errors.map(error => `${error.name}: ${describeError(error.code)}`).join('\n'));
      for (const info of batch.documents) await loadDocument(info);
      const active = tabs.find(tab => tab.info.path === (activePath ?? batch.active));
      if (active) activate(active);
      await refreshRecent();
    } finally {
      if (restoring) {
        suppressSessionSave = false;
        scheduleSessionSave();
      }
    }
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
  pane.innerHTML = `<div class="viewer-container" tabindex="0" aria-label="${t('reader.document')}"><div class="pdfViewer"></div></div><div class="loading-message">${t('reader.opening')}</div>`;
  $('documents').append(pane);
  $('home').hidden = true;
  $('reader').hidden = false;
  const container = pane.querySelector<HTMLDivElement>('.viewer-container')!;
  const bus = new EventBus();
  const links = new PDFLinkService({ eventBus: bus, ignoreDestinationZoom: true });
  links.externalLinkEnabled = false;
  const find = new PDFFindController({ eventBus: bus, linkService: links });
  const viewerOptions = {
    container,
    eventBus: bus,
    linkService: links,
    findController: find,
    textLayerMode: 1,
    annotationMode: AnnotationMode.ENABLE_FORMS,
    annotationEditorMode: AnnotationEditorType.NONE,
    enableHighlightFloatingButton: true,
    annotationEditorHighlightColors: highlightColors,
    enablePermissions: true,
    enableAutoLinking: false,
    maxCanvasPixels: 16 * 1024 * 1024,
    imageResourcesPath: '/pdfjs/images/',
  };
  const viewer = new PDFViewer(viewerOptions);
  links.setViewer(viewer);
  const tab: ReaderTab = {
    info,
    pane,
    container,
    bus,
    viewer,
    links,
    find,
    task: null!,
    bookmarks: [],
    modified: false,
    annotationMode: AnnotationEditorType.NONE,
    annotationColors: { highlight: '#ffff00', text: '#1f2933', ink: '#f44336' },
    annotationThickness: 3,
    annotationFontSize: 14,
    disposed: false,
    query: '',
    matchCase: false,
    matchCount: { state: 'idle', current: 0, total: 0 },
    canPrint: true,
    rendered: false,
  };
  tabs.push(tab);
  activate(tab);
  let changedReadFailure = false;
  const load = loadPdf(info, tab, error => {
    if (readErrorCode(error) === 'document_changed') {
      changedReadFailure = true;
      notifyChangedRead(tab, info);
      return;
    }
    notify(message(error));
    run(() => closeTab(tab));
  });
  tab.task = load.task;
  bus.on('pagesinit', () => {
    const position = tab.info.position;
    viewer.currentScaleValue = position?.scale ?? 'auto';
    if (position) {
      viewer.pagesRotation = position.rotation;
      if ([SpreadMode.NONE, SpreadMode.ODD, SpreadMode.EVEN].some(mode => mode === position.spread)) {
        viewer.spreadMode = position.spread;
      }
      if ([ScrollMode.VERTICAL, ScrollMode.PAGE].some(mode => mode === position.scroll)) {
        viewer.scrollMode = position.scroll;
      }
      viewer.currentPageNumber = position.page;
    }
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
    schedulePositionSave(tab);
    if (getActiveTab() !== tab) return;
    refreshToolbar();
    if (state.sidebarMode === 'pages' && Math.floor((viewer.currentPageNumber - 1) / 30) !== state.thumbnailGroup) {
      void renderSidebar();
    }
    $('sidebar-content').querySelectorAll<HTMLElement>('.thumbnail').forEach(el => el.classList.toggle('active', Number(el.dataset.page) === viewer.currentPageNumber));
  });
  bus.on('scalechanging', () => {
    schedulePositionSave(tab);
    if (getActiveTab() === tab) refreshToolbar();
  });
  bus.on('rotationchanging', () => {
    schedulePositionSave(tab);
    if (getActiveTab() === tab) refreshToolbar();
  });
  bus.on('spreadmodechanged', () => {
    schedulePositionSave(tab);
    if (getActiveTab() === tab) refreshToolbar();
  });
  bus.on('scrollmodechanged', () => {
    schedulePositionSave(tab);
    if (getActiveTab() === tab) refreshToolbar();
  });
  bus.on('updatefindmatchescount', (event: { matchesCount: { current: number; total: number } }) => {
    tab.matchCount = { state: 'matches', ...event.matchesCount };
    if (getActiveTab() === tab) {
      refreshFindCount();
      if (state.sidebarMode === 'search') void renderSidebar();
    }
  });
  bus.on('updatefindcontrolstate', (event: { state: number; matchesCount: { current: number; total: number } }) => {
    tab.matchCount = {
      state: event.state === 1 ? 'no-results' : event.state === 3 ? 'searching' : 'matches',
      ...event.matchesCount,
    };
    if (getActiveTab() === tab) refreshFindCount();
  });
  bus.on('annotationeditormodechanged', (event: { mode: number }) => {
    tab.annotationMode = event.mode;
    if (getActiveTab() === tab) refreshAnnotationToolbar();
  });
  try {
    const { pdf, canPrint, outline } = await load.loaded;
    tab.bookmarks = await bridge.bookmarks(info).catch(() => []);
    if (tab.disposed) return;
    tab.pdf = pdf;
    tab.canPrint = canPrint;
    links.setDocument(pdf);
    viewer.setDocument(pdf);
    trackModifiedState(tab);
    tab.outline = outline;
    if (tab.disposed) return;
    if (getActiveTab() === tab) {
      refreshToolbar();
      await renderSidebar();
    }
  } catch (error) {
    if (!tab.disposed) {
      if (changedReadFailure || readErrorCode(error) === 'document_changed') {
        if (!changedReadFailure) notifyChangedRead(tab, info);
        return;
      }
      notify(`${info.name}: ${t('error.open_pdf')} ${message(error)}`);
      await closeTab(tab);
    }
  }
}

export async function reloadDocument(info: bridge.DocumentInfo) {
  const tab = tabs.find(item => item.info.id === info.id);
  if (!tab || tab.disposed) return;
  if (tab.modified) {
    notify(t('reload.unsaved', { name: info.name }));
    return undefined;
  }
  const position: ReadingPosition = {
    page: tab.viewer.currentPageNumber,
    pages: tab.pdf?.numPages ?? 1,
    scale: tab.viewer.currentScaleValue || 'auto',
    rotation: tab.viewer.pagesRotation,
    spread: tab.viewer.spreadMode,
    scroll: tab.viewer.scrollMode,
  };
  const reloadedInfo = { ...info, position };
  let loadReady = false;
  let changedReadFailure = false;
  const load = loadPdf(reloadedInfo, tab, error => {
    if (readErrorCode(error) === 'document_changed') {
      changedReadFailure = true;
      notifyChangedRead(tab, info);
    } else if (loadReady) notify(message(error));
  });
  let loaded: Awaited<typeof load.loaded>;
  let bookmarks: bridge.Bookmark[];
  try {
    loaded = await load.loaded;
    bookmarks = await bridge.bookmarks(reloadedInfo).catch(() => []);
  } catch (error) {
    await load.task.destroy().catch(() => {});
    if (tab.modified) {
      notify(t('reload.unsaved', { name: info.name }));
    } else if (changedReadFailure || readErrorCode(error) === 'document_changed') {
      if (!changedReadFailure) notifyChangedRead(tab, info);
    } else {
      notify(t('reload.failed', { name: info.name }));
    }
    return undefined;
  }
  if (tab.disposed || tab.modified) {
    await load.task.destroy().catch(() => {});
    if (tab.modified) notify(t('reload.unsaved', { name: info.name }));
    return undefined;
  }
  const oldTask = tab.task;
  const oldState = {
    info: tab.info,
    pdf: tab.pdf,
    task: tab.task,
    modified: tab.modified,
    canPrint: tab.canPrint,
    outline: tab.outline,
    bookmarks: tab.bookmarks,
    rendered: tab.rendered,
  };
  tab.links.setDocument(loaded.pdf);
  tab.viewer.setDocument(loaded.pdf);
  tab.info = reloadedInfo;
  tab.task = load.task;
  tab.pdf = loaded.pdf;
  tab.modified = false;
  tab.canPrint = loaded.canPrint;
  tab.outline = loaded.outline;
  tab.bookmarks = bookmarks;
  tab.rendered = false;
  try {
    await bridge.commitGeneration(info.id, info.generation);
  } catch {
    tab.links.setDocument(oldState.pdf!);
    tab.viewer.setDocument(oldState.pdf!);
    tab.info = oldState.info;
    tab.pdf = oldState.pdf;
    tab.task = oldState.task;
    tab.modified = oldState.modified;
    tab.canPrint = oldState.canPrint;
    tab.outline = oldState.outline;
    tab.bookmarks = oldState.bookmarks;
    tab.rendered = oldState.rendered;
    await load.task.destroy().catch(() => {});
    notify(t('reload.failed', { name: info.name }));
    return undefined;
  }
  trackModifiedState(tab);
  refreshTabs();
  if (getActiveTab() === tab) refreshAnnotationToolbar();
  loadReady = true;
  await oldTask.destroy().catch(() => {});
  if (getActiveTab() === tab) {
    refreshToolbar();
    await renderSidebar();
    if (tab.query.trim()) search('find');
  }
  return tab;
}

export async function closeTab(tab: ReaderTab, resolveUnsaved = false) {
  if (tab.disposed) return;
  if (tab.modified && !resolveUnsaved) {
    const choice = await requestUnsavedChoice([tab]);
    if (choice === 'cancel') return;
    if (choice === 'save' && !await saveAsCopy(tab)) return;
  }
  try {
    await flushPosition(tab);
  } catch (error) {
    notify(message(error));
  }
  tab.disposed = true;
  if (state.pendingPassword?.tab === tab) {
    state.pendingPassword = undefined;
    input('password').value = '';
    $<HTMLDialogElement>('password-dialog').close();
  }
  const index = tabs.indexOf(tab);
  tabs.splice(index, 1);
  scheduleSessionSave();
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
