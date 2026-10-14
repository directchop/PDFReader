import { $, button, input, run } from './dom';
import { hideFind, search, showFind } from './find';
import { isPrintBusy, showPrint } from './print';
import { getActiveTab, tabs } from './state';
import { closeTab, activate } from './tabs';
import { setScale, zoomBy } from './toolbar';
import { toggleCurrentBookmark } from './bookmarks';
import { enterPresentation, exitPresentation } from './presentation';
import { AnnotationEditorType } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { closeAnnotationBar, saveAsCopy, setAnnotationMode, toggleAnnotationBar } from './annotations';

export function registerShortcuts() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const modifier = mac ? '⌘' : 'Ctrl';
  document.querySelectorAll<HTMLElement>('[data-shortcut-modifier]').forEach(element => {
    element.textContent = element.dataset.shortcutKey
      ? `${modifier}+${element.dataset.shortcutKey}`
      : modifier;
  });
  document.querySelectorAll<HTMLElement>('.mac-shortcut').forEach(element => {
    element.hidden = !mac;
  });

  window.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open], [role="dialog"]:not([hidden])') || isPrintBusy()) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const active = getActiveTab();
    if ($('app').classList.contains('presenting')) {
      if (event.key === 'Escape' || event.key === 'F5') {
        event.preventDefault();
        run(() => exitPresentation());
      } else if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(event.key)) {
        event.preventDefault();
        active?.viewer.nextPage();
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(event.key)) {
        event.preventDefault();
        active?.viewer.previousPage();
      } else if (event.key === 'Home' && active?.pdf) {
        event.preventDefault();
        active.viewer.currentPageNumber = 1;
      } else if (event.key === 'End' && active?.pdf) {
        event.preventDefault();
        active.viewer.currentPageNumber = active.pdf.numPages;
      }
      return;
    }
    const target = event.target;
    if (mod && key === 's' && active?.pdf) {
      event.preventDefault();
      run(() => saveAsCopy(active));
      return;
    }
    const annotationOrFormFocus = target instanceof Element && !!target.closest(
      '.annotationEditorLayer, .freeTextEditor, .inkEditor, .annotationLayer input, .annotationLayer textarea, .annotationLayer select, .annotationLayer [contenteditable="true"]',
    );
    if (annotationOrFormFocus) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAnnotationBar();
      }
      return;
    }
    const editing = target instanceof Element && !!target.closest('input, select, textarea, [contenteditable="true"]');

    if (mac && event.ctrlKey && event.metaKey && key === 'f' && !editing) {
      event.preventDefault();
      button('fullscreen').click();
    } else if (mod && key === 'o') {
      event.preventDefault();
      button('open').click();
    } else if (mod && key === 'f') {
      event.preventDefault();
      showFind();
    } else if (mod && key === 'p') {
      event.preventDefault();
      showPrint();
    } else if (mod && key === 'd' && active?.pdf) {
      event.preventDefault();
      run(() => toggleCurrentBookmark());
    } else if (mod && key === 'w' && active) {
      event.preventDefault();
      run(() => closeTab(active));
    } else if (event.ctrlKey && key === 'tab' && tabs.length) {
      event.preventDefault();
      const next = (tabs.indexOf(active!) + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
      activate(tabs[next]);
    } else if (mod && (key === '+' || key === '=')) {
      event.preventDefault();
      zoomBy(1.2);
    } else if (mod && key === '-') {
      event.preventDefault();
      zoomBy(1 / 1.2);
    } else if (mod && key === '0' && active?.pdf) {
      event.preventDefault();
      setScale('page-fit');
    } else if (event.key === 'Escape') {
      if ($('app').classList.contains('fullscreen')) {
        event.preventDefault();
        button('fullscreen').click();
      } else if (!$('findbar').hidden) {
        hideFind();
      }
    } else if (editing) {
      return;
    } else if (event.key === 'F5') {
      event.preventDefault();
      run(() => enterPresentation());
    } else if (!mod && active?.pdf && ['v', 'h', 't', 'i'].includes(key)) {
      event.preventDefault();
      if ($('annotationbar').hidden) toggleAnnotationBar();
      const modes: Record<string, number> = {
        v: AnnotationEditorType.NONE,
        h: AnnotationEditorType.HIGHLIGHT,
        t: AnnotationEditorType.FREETEXT,
        i: AnnotationEditorType.INK,
      };
      setAnnotationMode(modes[key]);
    } else if (event.key === 'ArrowLeft' && active?.pdf) {
      event.preventDefault();
      active.viewer.previousPage();
    } else if (event.key === 'ArrowRight' && active?.pdf) {
      event.preventDefault();
      active.viewer.nextPage();
    } else if (event.key === 'Home' && active?.pdf) {
      event.preventDefault();
      active.viewer.currentPageNumber = 1;
    } else if (event.key === 'End' && active?.pdf) {
      event.preventDefault();
      active.viewer.currentPageNumber = active.pdf.numPages;
    } else if (mod && key === 'g' && active?.pdf) {
      event.preventDefault();
      input('page-number').focus();
      input('page-number').select();
    } else if (mod && key === 'b') {
      event.preventDefault();
      button('sidebar-toggle').click();
    } else if (mod && key === 'r') {
      event.preventDefault();
      if (active?.pdf) button('rotate').click();
    } else if (event.key === 'F3' && active?.pdf) {
      event.preventDefault();
      search('again', event.shiftKey);
    } else if (event.key === 'F11') {
      event.preventDefault();
      button('fullscreen').click();
    } else if (event.key === '?' || (event.code === 'Slash' && event.shiftKey) || event.key === 'F1') {
      event.preventDefault();
      showShortcuts();
    }
  });
}

export function showShortcuts() {
  const dialog = $<HTMLDialogElement>('shortcuts-dialog');
  if (!dialog.open) dialog.showModal();
}
