import { $, input } from './dom';
import { getActiveTab } from './state';

export function showFind() {
  if (!getActiveTab()?.pdf) return;
  $('findbar').hidden = false;
  input('find-input').focus();
  input('find-input').select();
}

export function hideFind() {
  $('findbar').hidden = true;
  getActiveTab()?.bus.dispatch('findbarclose', {});
  getActiveTab()?.container.focus();
}

export function search(type = '', backwards = false) {
  const tab = getActiveTab();
  if (!tab?.pdf) return;
  tab.query = input('find-input').value;
  tab.matchCase = input('match-case').checked;
  tab.bus.dispatch('find', {
    source: window,
    type,
    query: tab.query,
    caseSensitive: tab.matchCase,
    entireWord: false,
    highlightAll: true,
    findPrevious: backwards,
    matchDiacritics: false,
  });
  if (!tab.query) $('find-count').textContent = '';
}
