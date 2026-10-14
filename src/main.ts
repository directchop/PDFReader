import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as bridge from './bridge';
import './style.css';
import { mountIcons } from './icons';
import { $, button, input, notify, run } from './dom';
import { activate, closeTab, enqueue, flushPosition, flushSession, refreshTabs, reloadDocument } from './tabs';
import { renderSidebar } from './sidebar';
import { hideFind, refreshFindCount, search, showFind } from './find';
import { setScale, refreshToolbar, refreshViewMenu, zoomBy } from './toolbar';
import { cancelPrint, clearPrintOutput, initializePrint, preparePrint, showPrint } from './print';
import { refreshRecent } from './recent';
import { registerShortcuts, showShortcuts } from './shortcuts';
import { getActiveTab, state, tabs } from './state';
import { t } from './i18n';
import { toggleCurrentBookmark } from './bookmarks';
import { setFullscreen, syncFullscreen } from './fullscreen';
import { exitPresentation, initializePresentation } from './presentation';
import { commitPendingAnnotations, initializeAnnotations, refreshAnnotationToolbar, saveAsCopy } from './annotations';
import { requestUnsavedChoice } from './unsaved';

GlobalWorkerOptions.workerSrc = workerUrl;
mountIcons();
initializePrint();
initializePresentation();
initializeAnnotations();
window.addEventListener('annotationmodified', refreshTabs);
const passwordDialog = $<HTMLDialogElement>('password-dialog');
const sidebarPreferencesKey = 'pdfreader.sidebar';
const sidebar = $('sidebar');
try {
  const saved = JSON.parse(localStorage.getItem(sidebarPreferencesKey) ?? 'null') as { open?: unknown; mode?: unknown } | null;
  if (saved && typeof saved.open === 'boolean') sidebar.hidden = !saved.open;
  if (saved?.mode === 'pages' || saved?.mode === 'outline' || saved?.mode === 'bookmarks' || saved?.mode === 'search') state.sidebarMode = saved.mode;
} catch {
}
button('sidebar-toggle').setAttribute('aria-pressed', String(!sidebar.hidden));
button('show-pages').classList.toggle('selected', state.sidebarMode === 'pages');
button('show-outline').classList.toggle('selected', state.sidebarMode === 'outline');

function saveSidebarPreferences() {
  try {
    localStorage.setItem(sidebarPreferencesKey, JSON.stringify({
      open: !sidebar.hidden,
      mode: state.sidebarMode,
    }));
  } catch {
  }
}

document.addEventListener('fullscreenchange', () => {
  if (!bridge.desktop) {
    const fullscreen = document.fullscreenElement !== null;
    syncFullscreen(fullscreen);
    if (!fullscreen && $('app').classList.contains('presenting')) void exitPresentation(false);
  }
});
button('fullscreen').onclick = () => run(() => setFullscreen(!$('app').classList.contains('fullscreen')));
button('shortcuts-toggle').onclick = showShortcuts;
button('shortcuts-close').onclick = () => $<HTMLDialogElement>('shortcuts-dialog').close();
button('shortcuts-link').onclick = event => {
  event.preventDefault();
  showShortcuts();
};

const viewMenu = $('view-menu');
button('view-menu-toggle').onclick = () => {
  viewMenu.hidden = !viewMenu.hidden;
  button('view-menu-toggle').setAttribute('aria-expanded', String(!viewMenu.hidden));
  refreshViewMenu();
};
document.querySelectorAll<HTMLButtonElement>('#view-menu [data-spread]').forEach(option => {
  option.onclick = () => {
    const tab = getActiveTab();
    if (tab?.pdf) tab.viewer.spreadMode = Number(option.dataset.spread);
    refreshViewMenu();
  };
});
document.querySelectorAll<HTMLButtonElement>('#view-menu [data-scroll]').forEach(option => {
  option.onclick = () => {
    const tab = getActiveTab();
    if (tab?.pdf) tab.viewer.scrollMode = Number(option.dataset.scroll);
    refreshViewMenu();
  };
});
document.addEventListener('pointerdown', event => {
  if (viewMenu.hidden) return;
  const target = event.target as Node;
  if (viewMenu.contains(target) || button('view-menu-toggle').contains(target)) return;
  viewMenu.hidden = true;
  button('view-menu-toggle').setAttribute('aria-expanded', 'false');
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !viewMenu.hidden) {
    viewMenu.hidden = true;
    button('view-menu-toggle').setAttribute('aria-expanded', 'false');
  }
});

button('open').onclick = button('welcome-open').onclick = () => run(async () => enqueue(await bridge.openDocuments()));
document.querySelector('.brand')!.addEventListener('click', event => {
  event.preventDefault();
  activate();
});
button('clear-recent').onclick = () => run(async () => {
  await bridge.clearRecent();
  await refreshRecent();
});
window.addEventListener('beforeunload', event => {
  if (!bridge.desktop) {
    try {
      for (const tab of tabs) commitPendingAnnotations(tab);
    } catch {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  if (!bridge.desktop && tabs.some(tab => tab.modified)) {
    event.preventDefault();
    event.returnValue = '';
  }
  for (const tab of tabs) void flushPosition(tab).catch(() => {});
  void flushSession();
});
button('sidebar-toggle').onclick = () => {
  sidebar.hidden = !sidebar.hidden;
  button('sidebar-toggle').setAttribute('aria-pressed', String(!sidebar.hidden));
  saveSidebarPreferences();
  void renderSidebar();
  window.dispatchEvent(new Event('resize'));
};
button('show-pages').onclick = () => {
  state.sidebarMode = 'pages';
  saveSidebarPreferences();
  void renderSidebar();
};
button('show-outline').onclick = () => {
  state.sidebarMode = 'outline';
  saveSidebarPreferences();
  void renderSidebar();
};
button('show-bookmarks').onclick = () => {
  state.sidebarMode = 'bookmarks';
  saveSidebarPreferences();
  void renderSidebar();
};
button('show-search-results').onclick = () => {
  state.sidebarMode = 'search';
  saveSidebarPreferences();
  void renderSidebar();
};
button('bookmark-toggle').onclick = () => run(async () => {
  await toggleCurrentBookmark();
});
button('previous-page').onclick = () => {
  const tab = getActiveTab();
  if (tab?.pdf) tab.viewer.previousPage();
};
button('next-page').onclick = () => {
  const tab = getActiveTab();
  if (tab?.pdf) tab.viewer.nextPage();
};
input('page-number').onchange = () => {
  const tab = getActiveTab();
  if (tab?.pdf) tab.viewer.currentPageNumber = Math.max(1, Math.min(tab.pdf.numPages, Number(input('page-number').value) || 1));
  refreshToolbar();
  refreshAnnotationToolbar();
};
$<HTMLSelectElement>('zoom').onchange = () => setScale($<HTMLSelectElement>('zoom').value);
button('zoom-in').onclick = () => zoomBy(1.2);
button('zoom-out').onclick = () => zoomBy(1 / 1.2);
button('rotate').onclick = () => {
  const tab = getActiveTab();
  if (tab?.pdf) {
    tab.viewer.pagesRotation = (tab.viewer.pagesRotation + 90) % 360;
    void renderSidebar();
  }
};
button('find-toggle').onclick = showFind;
button('find-close').onclick = hideFind;
input('find-input').oninput = () => {
  search();
  if (state.sidebarMode === 'search') void renderSidebar();
};
input('match-case').onchange = () => search('casesensitivitychange');
input('find-input').onkeydown = event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    search('again', event.shiftKey);
    if (getActiveTab()?.query.trim()) {
      state.sidebarMode = 'search';
      saveSidebarPreferences();
      void renderSidebar();
    }
  } else if (event.key === 'Escape') {
    hideFind();
  }
};
button('find-next').onclick = () => search('again');
button('find-previous').onclick = () => search('again', true);
button('print').onclick = showPrint;
$('print-form').onsubmit = event => {
  event.preventDefault();
  run(preparePrint);
};
button('print-cancel').onclick = cancelPrint;
$('print-dialog').addEventListener('cancel', cancelPrint);
window.addEventListener('afterprint', clearPrintOutput);
$('password-form').onsubmit = event => {
  event.preventDefault();
  const pending = state.pendingPassword;
  state.pendingPassword = undefined;
  const password = input('password').value;
  input('password').value = '';
  passwordDialog.close();
  pending?.update(password);
};
const cancelPassword = () => {
  if (state.pendingPassword) run(() => closeTab(state.pendingPassword!.tab));
};
button('password-cancel').onclick = cancelPassword;
passwordDialog.addEventListener('cancel', cancelPassword);

registerShortcuts();

window.addEventListener('resize', () => {
  const tab = getActiveTab();
  if (!tab?.pdf) return;
  const scale = tab.viewer.currentScaleValue;
  if (['auto', 'page-width', 'page-fit'].includes(scale)) tab.viewer.currentScaleValue = scale;
  tab.viewer.update();
});
// Block external PDF links and browser navigation. Internal destinations are
// handled by PDFLinkService; documents never gain access to the host shell.
document.addEventListener('click', event => {
  const anchor = (event.target as Element).closest<HTMLAnchorElement>('.annotationLayer a');
  if (anchor && !anchor.classList.contains('internalLink')) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

function tabForTarget(target: EventTarget | null) {
  if (!(target instanceof Node)) return undefined;
  return tabs.find(tab => tab.container.contains(target));
}

function scaleAroundPointer(tab: (typeof tabs)[number], factor: number, x: number, y: number) {
  const current = tab.viewer.currentScale;
  const next = Math.max(.25, Math.min(5, current * factor));
  if (next === current) return;
  tab.viewer.updateScale({
    scaleFactor: next / current,
    origin: [x, y],
    drawingDelay: 400,
  });
}

const documents = $('documents');
documents.addEventListener('wheel', event => {
  if (!event.ctrlKey && !event.metaKey) return;
  const tab = tabForTarget(event.target);
  if (!tab?.pdf) return;
  event.preventDefault();
  scaleAroundPointer(tab, Math.exp(-event.deltaY * .002), event.clientX, event.clientY);
}, { passive: false });

if ('ongesturestart' in window) {
  type SafariGestureEvent = Event & { scale: number; clientX: number; clientY: number };
  let gestureScale = 1;
  documents.addEventListener('gesturestart', event => {
    if (!tabForTarget(event.target)?.pdf) return;
    event.preventDefault();
    gestureScale = (event as SafariGestureEvent).scale || 1;
  }, { passive: false });
  documents.addEventListener('gesturechange', event => {
    const tab = tabForTarget(event.target);
    if (!tab?.pdf) return;
    event.preventDefault();
    const gesture = event as SafariGestureEvent;
    const nextScale = gesture.scale || gestureScale;
    scaleAroundPointer(tab, nextScale / gestureScale, gesture.clientX, gesture.clientY);
    gestureScale = nextScale;
  }, { passive: false });
}

if (!bridge.desktop) {
  document.querySelector('.local-badge [data-i18n]')!.textContent = t('local.browserPreview');
  let dragDepth = 0;
  const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', event => {
    if (!hasFiles(event)) return;
    dragDepth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', event => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dragging');
  });
  window.addEventListener('dragover', event => event.preventDefault());
  window.addEventListener('drop', event => {
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    if (event.dataTransfer?.files.length) {
      run(async () => enqueue(await bridge.acceptBrowserFiles([...event.dataTransfer!.files])));
    }
  });
} else {
  const currentWindow = getCurrentWindow();
  let closePrompt = false;
  let allowClose = false;
  void currentWindow.onCloseRequested(event => {
    if (allowClose) return;
    try {
      for (const tab of tabs) commitPendingAnnotations(tab);
    } catch (error) {
      event.preventDefault();
      notify(String(error));
      return;
    }
    const modified = tabs.filter(tab => tab.modified);
    if (!modified.length) return;
    event.preventDefault();
    if (closePrompt) return;
    closePrompt = true;
    void (async () => {
      const choice = await requestUnsavedChoice(modified);
      if (choice === 'cancel') return;
      if (choice === 'save') {
        for (const tab of modified) {
          if (!await saveAsCopy(tab)) return;
        }
        for (const tab of tabs) commitPendingAnnotations(tab);
        if (tabs.some(tab => tab.modified)) return;
      }
      allowClose = true;
      await currentWindow.destroy();
    })().catch(error => notify(String(error))).finally(() => {
      closePrompt = false;
    });
  });
  void currentWindow.onResized(async () => {
    const fullscreen = await currentWindow.isFullscreen();
    syncFullscreen(fullscreen);
    if (!fullscreen && $('app').classList.contains('presenting')) void exitPresentation(false);
  });
  void getCurrentWebview().onDragDropEvent(event => {
    if (event.payload.type === 'enter' || event.payload.type === 'over') {
      document.body.classList.add('dragging');
    } else {
      document.body.classList.remove('dragging');
    }
  });
}
window.addEventListener('localechange', () => {
  syncFullscreen($('app').classList.contains('fullscreen'));
  refreshTabs();
  refreshToolbar();
  refreshAnnotationToolbar();
  refreshFindCount();
  void renderSidebar();
  run(refreshRecent);
  document.querySelector('.local-badge [data-i18n]')!.textContent = t(bridge.desktop ? 'local.badge' : 'local.browserPreview');
});
run(async () => {
  await bridge.onDocumentsReady(() => run(async () => enqueue(await bridge.takePending())));
  void bridge.onDocumentChanged(info => {
    if (localStorage.getItem('pdfreader.autoReload') === 'false') return;
    const current = tabs.find(tab => tab.info.id === info.id);
    if (current?.modified) {
      notify(t('reload.unsaved', { name: info.name }));
      return;
    }
    run(async () => {
      const tab = await reloadDocument(info);
      if (tab) notify(t('reload.done', { name: info.name }));
    });
  });
  if (bridge.desktop && localStorage.getItem('pdfreader.restoreSession') !== 'false') {
    const session = await bridge.restoreSession();
    enqueue(session, undefined, true);
    await state.opening;
  }
  enqueue(await bridge.takePending());
  await state.opening;
  await refreshRecent();
});
