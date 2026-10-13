import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import * as bridge from './bridge';
import './style.css';
import { mountIcons } from './icons';
import { $, button, input, run } from './dom';
import { activate, closeTab, enqueue, refreshTabs } from './tabs';
import { renderSidebar } from './sidebar';
import { hideFind, refreshFindCount, search, showFind } from './find';
import { setScale, refreshToolbar, zoomBy } from './toolbar';
import { cancelPrint, clearPrintOutput, initializePrint, preparePrint, showPrint } from './print';
import { refreshRecent } from './recent';
import { registerShortcuts } from './shortcuts';
import { getActiveTab, state } from './state';
import { t } from './i18n';

GlobalWorkerOptions.workerSrc = workerUrl;
mountIcons();
initializePrint();
const passwordDialog = $<HTMLDialogElement>('password-dialog');

button('open').onclick = button('welcome-open').onclick = () => run(async () => enqueue(await bridge.openDocuments()));
document.querySelector('.brand')!.addEventListener('click', event => {
  event.preventDefault();
  activate();
});
button('clear-recent').onclick = () => run(async () => {
  await bridge.clearRecent();
  await refreshRecent();
});
button('sidebar-toggle').onclick = () => {
  $('sidebar').hidden = !$('sidebar').hidden;
  button('sidebar-toggle').setAttribute('aria-pressed', String(!$('sidebar').hidden));
  void renderSidebar();
  window.dispatchEvent(new Event('resize'));
};
button('show-pages').onclick = () => {
  state.sidebarMode = 'pages';
  void renderSidebar();
};
button('show-outline').onclick = () => {
  state.sidebarMode = 'outline';
  void renderSidebar();
};
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
input('find-input').oninput = () => search();
input('match-case').onchange = () => search('casesensitivitychange');
input('find-input').onkeydown = event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    search('again', event.shiftKey);
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
if (!bridge.desktop) {
  document.querySelector('.local-badge [data-i18n]')!.textContent = t('local.browserPreview');
  window.addEventListener('dragover', event => event.preventDefault());
  window.addEventListener('drop', event => {
    event.preventDefault();
    if (event.dataTransfer?.files.length) {
      run(async () => enqueue(await bridge.acceptBrowserFiles([...event.dataTransfer!.files])));
    }
  });
}
window.addEventListener('localechange', () => {
  refreshTabs();
  refreshToolbar();
  refreshFindCount();
  void renderSidebar();
  run(refreshRecent);
  document.querySelector('.local-badge [data-i18n]')!.textContent = t(bridge.desktop ? 'local.badge' : 'local.browserPreview');
});
run(async () => {
  await bridge.onDocumentsReady(() => run(async () => enqueue(await bridge.takePending())));
  enqueue(await bridge.takePending());
  await refreshRecent();
});
