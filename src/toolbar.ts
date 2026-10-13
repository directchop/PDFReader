import { $, button, input, sizeLabel } from './dom';
import { getActiveTab } from './state';

export function refreshToolbar() {
  const tab = getActiveTab();
  if (!tab) return;
  const { viewer, pdf, info } = tab;
  input('page-number').value = String(viewer.currentPageNumber || 1);
  input('page-number').max = String(pdf?.numPages || 1);
  $('page-total').textContent = `/ ${pdf?.numPages ?? '—'}`;
  button('previous-page').disabled = !pdf || viewer.currentPageNumber <= 1;
  button('next-page').disabled = !pdf || viewer.currentPageNumber >= pdf.numPages;
  for (const id of ['zoom-in', 'zoom-out', 'rotate', 'find-toggle']) button(id).disabled = !pdf;
  button('print').disabled = !pdf || !tab.canPrint;
  $('document-status').textContent = tab.rendered ? info.name : '読み込み中…';
  $('document-details').textContent = pdf ? `${pdf.numPages} ページ · ${sizeLabel(info.size)}` : sizeLabel(info.size);
  const zoom = $<HTMLSelectElement>('zoom');
  const value = viewer.currentScaleValue;
  zoom.querySelector('[data-custom]')?.remove();
  if (value && ![...zoom.options].some(option => option.value === value)) {
    const option = new Option(`${Math.round(viewer.currentScale * 100)}%`, value);
    option.dataset.custom = 'true';
    zoom.add(option);
  }
  zoom.value = value || 'auto';
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
