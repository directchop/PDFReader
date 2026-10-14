import { ScrollMode, SpreadMode } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import { $, button, input, sizeLabel } from './dom';
import { getActiveTab } from './state';
import { t } from './i18n';

export function refreshToolbar() {
  const tab = getActiveTab();
  if (!tab) {
    refreshViewMenu();
    return;
  }
  const { viewer, pdf, info } = tab;
  input('page-number').value = String(viewer.currentPageNumber || 1);
  input('page-number').max = String(pdf?.numPages || 1);
  $('page-total').textContent = `/ ${pdf?.numPages ?? '—'}`;
  button('previous-page').disabled = !pdf || viewer.currentPageNumber <= 1;
  button('next-page').disabled = !pdf || viewer.currentPageNumber >= pdf.numPages;
  for (const id of ['zoom-in', 'zoom-out', 'rotate', 'find-toggle']) button(id).disabled = !pdf;
  button('print').disabled = !pdf || !tab.canPrint;
  button('bookmark-toggle').disabled = !pdf;
  button('bookmark-toggle').setAttribute('aria-pressed', String(!!pdf && tab.bookmarks.some(bookmark => bookmark.page === viewer.currentPageNumber)));
  $('document-status').textContent = tab.rendered ? info.name : t('status.loading');
  $('document-details').textContent = pdf ? `${pdf.numPages} ${t('status.pages')} · ${sizeLabel(info.size)}` : sizeLabel(info.size);
  const zoom = $<HTMLSelectElement>('zoom');
  const value = viewer.currentScaleValue;
  zoom.querySelector('[data-custom]')?.remove();
  if (value && ![...zoom.options].some(option => option.value === value)) {
    const option = new Option(`${Math.round(viewer.currentScale * 100)}%`, value);
    option.dataset.custom = 'true';
    zoom.add(option);
  }
  zoom.value = value || 'auto';
  refreshViewMenu();
}

export function refreshViewMenu() {
  const tab = getActiveTab();
  const spread = tab?.viewer.spreadMode ?? SpreadMode.NONE;
  const scroll = tab?.viewer.scrollMode ?? ScrollMode.VERTICAL;
  button('view-menu-toggle').disabled = !tab?.pdf;
  document.querySelectorAll<HTMLButtonElement>('#view-menu [data-spread]').forEach(option => {
    const selected = Number(option.dataset.spread) === spread;
    option.setAttribute('aria-checked', String(selected));
    option.classList.toggle('selected', selected);
  });
  document.querySelectorAll<HTMLButtonElement>('#view-menu [data-scroll]').forEach(option => {
    const selected = Number(option.dataset.scroll) === scroll;
    option.setAttribute('aria-checked', String(selected));
    option.classList.toggle('selected', selected);
  });
}

export function zoomBy(amount: number) {
  const tab = getActiveTab();
  if (!tab?.pdf) return;
  tab.viewer.currentScale = Math.max(.25, Math.min(5, tab.viewer.currentScale * amount));
}

export function setScale(value: string) {
  const tab = getActiveTab();
  if (!tab?.pdf) return;
  tab.viewer.currentScaleValue = value;
  if (value === 'page-fit') tab.viewer.scrollPageIntoView({ pageNumber: tab.viewer.currentPageNumber });
}
