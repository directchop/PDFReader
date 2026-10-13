import { $, button, run } from './dom';
import { hideFind, showFind } from './find';
import { isPrintBusy, showPrint } from './print';
import { getActiveTab, tabs } from './state';
import { closeTab, activate } from './tabs';
import { setScale, zoomBy } from './toolbar';

export function registerShortcuts() {
  window.addEventListener('keydown', event => {
    if ($<HTMLDialogElement>('password-dialog').open || isPrintBusy()) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const active = getActiveTab();
    if (mod && key === 'o') {
      event.preventDefault();
      button('open').click();
    } else if (mod && key === 'f') {
      event.preventDefault();
      showFind();
    } else if (mod && key === 'p') {
      event.preventDefault();
      showPrint();
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
    } else if (key === 'escape' && !$('findbar').hidden) {
      hideFind();
    }
  });
}
