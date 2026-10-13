import { AnnotationEditorParamsType, AnnotationEditorType } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { $, button, message, notify } from './dom';
import * as bridge from './bridge';
import { getActiveTab, type ReaderTab } from './state';
import { t } from './i18n';

const highlightPalette = [
  ['#ffff00', 'yellow'],
  ['#00c853', 'green'],
  ['#2196f3', 'blue'],
  ['#ff5ca8', 'pink'],
  ['#f44336', 'red'],
] as const;

export const highlightColors = highlightPalette.map(([color, name]) => `${name}=${color}`).join(',');

function colorSlot(mode: number): keyof ReaderTab['annotationColors'] {
  if (mode === AnnotationEditorType.FREETEXT) return 'text';
  if (mode === AnnotationEditorType.INK) return 'ink';
  return 'highlight';
}

function parameterType(mode: number) {
  if (mode === AnnotationEditorType.HIGHLIGHT) return AnnotationEditorParamsType.HIGHLIGHT_COLOR;
  if (mode === AnnotationEditorType.FREETEXT) return AnnotationEditorParamsType.FREETEXT_COLOR;
  if (mode === AnnotationEditorType.INK) return AnnotationEditorParamsType.INK_COLOR;
  return undefined;
}

function dispatchParameter(tab: ReaderTab, type: number, value: string | number) {
  tab.bus.dispatch('switchannotationeditorparams', { source: tab.viewer, type, value });
}

function applyColor(tab: ReaderTab) {
  const type = parameterType(tab.annotationMode);
  if (type !== undefined) dispatchParameter(tab, type, tab.annotationColors[colorSlot(tab.annotationMode)]);
}

export function setAnnotationMode(mode: number) {
  const tab = getActiveTab();
  if (!tab?.pdf) return;
  try {
    tab.viewer.annotationEditorMode = { mode };
    tab.annotationMode = mode;
    applyColor(tab);
    if (mode === AnnotationEditorType.INK) {
      dispatchParameter(tab, AnnotationEditorParamsType.INK_THICKNESS, tab.annotationThickness);
    } else if (mode === AnnotationEditorType.FREETEXT) {
      dispatchParameter(tab, AnnotationEditorParamsType.FREETEXT_SIZE, tab.annotationFontSize);
    }
    refreshAnnotationToolbar();
  } catch (error) {
    notify(message(error));
  }
}

export function closeAnnotationBar(tab = getActiveTab()) {
  $('annotationbar').hidden = true;
  button('annotate-toggle').setAttribute('aria-expanded', 'false');
  if (tab?.pdf && tab.annotationMode !== AnnotationEditorType.NONE) {
    try {
      tab.viewer.annotationEditorMode = { mode: AnnotationEditorType.NONE };
      tab.annotationMode = AnnotationEditorType.NONE;
    } catch {
      tab.annotationMode = AnnotationEditorType.NONE;
    }
  }
  refreshAnnotationToolbar();
}

export function toggleAnnotationBar() {
  const tab = getActiveTab();
  if (!tab?.pdf) return;
  if (!$('annotationbar').hidden) {
    closeAnnotationBar(tab);
    return;
  }
  $('annotationbar').hidden = false;
  button('annotate-toggle').setAttribute('aria-expanded', 'true');
  refreshAnnotationToolbar();
}

export function refreshAnnotationToolbar() {
  const tab = getActiveTab();
  const bar = $('annotationbar');
  button('annotate-toggle').disabled = !tab?.pdf;
  button('annotate-toggle').setAttribute('aria-expanded', String(!bar.hidden));
  button('save-copy').disabled = !tab?.modified;
  const mode = tab?.annotationMode ?? AnnotationEditorType.NONE;
  document.querySelectorAll<HTMLButtonElement>('[data-annotation-mode]').forEach(option => {
    const selected = Number(option.dataset.annotationMode) === mode;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-pressed', String(selected));
  });
  $('ink-thickness-control').hidden = mode !== AnnotationEditorType.INK;
  $('freetext-size-control').hidden = mode !== AnnotationEditorType.FREETEXT;
  document.querySelectorAll<HTMLButtonElement>('[data-annotation-color]').forEach(swatch => {
    const selectedColor = tab ? tab.annotationColors[colorSlot(mode)] : undefined;
    const selected = swatch.dataset.annotationColor === selectedColor;
    swatch.classList.toggle('selected', selected);
    swatch.setAttribute('aria-pressed', String(selected));
  });
}

export function initializeAnnotations() {
  button('annotate-toggle').onclick = toggleAnnotationBar;
  button('save-copy').onclick = () => {
    void saveAsCopy();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-annotation-mode]').forEach(option => {
    option.onclick = () => setAnnotationMode(Number(option.dataset.annotationMode));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-annotation-color]').forEach(swatch => {
    swatch.onclick = () => {
      const tab = getActiveTab();
      if (!tab) return;
      tab.annotationColors[colorSlot(tab.annotationMode)] = swatch.dataset.annotationColor!;
      applyColor(tab);
      refreshAnnotationToolbar();
    };
  });
  $('ink-thickness').addEventListener('input', () => {
    const tab = getActiveTab();
    if (!tab) return;
    tab.annotationThickness = Number(($('ink-thickness') as HTMLInputElement).value);
    dispatchParameter(tab, AnnotationEditorParamsType.INK_THICKNESS, tab.annotationThickness);
  });
  $('freetext-size').addEventListener('change', () => {
    const tab = getActiveTab();
    if (!tab) return;
    tab.annotationFontSize = Number(($('freetext-size') as HTMLSelectElement).value);
    dispatchParameter(tab, AnnotationEditorParamsType.FREETEXT_SIZE, tab.annotationFontSize);
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('annotationbar').hidden) {
      event.preventDefault();
      closeAnnotationBar();
    }
  });
  refreshAnnotationToolbar();
}

function suggestedName(tab: ReaderTab) {
  const stem = tab.info.name.replace(/\.pdf$/i, '');
  return t('annotation.annotatedName', { stem });
}

function downloadPdf(name: string, data: Uint8Array) {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: 'application/pdf' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveAsCopy(tab = getActiveTab()): Promise<boolean> {
  if (!tab?.pdf || !tab.modified) return false;
  const name = suggestedName(tab);
  try {
    if (bridge.desktop) {
      const token = await bridge.pickSavePath(tab.info.id, name);
      if (!token) return false;
      const bytes = await tab.pdf.saveDocument();
      const savedName = await bridge.writeSavedCopy(token, bytes);
      notify(t('annotation.saved', { name: savedName }));
    } else {
      const bytes = await tab.pdf.saveDocument();
      downloadPdf(name, bytes);
      notify(t('annotation.saved', { name }));
    }
    tab.pdf.annotationStorage.resetModified();
    tab.modified = false;
    refreshAnnotationToolbar();
    window.dispatchEvent(new Event('annotationmodified'));
    return true;
  } catch (error) {
    notify(message(error));
    return false;
  }
}
