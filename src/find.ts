import { $, input } from './dom';
import { getActiveTab } from './state';
import { t } from './i18n';

export function refreshFindCount() {
  const count = getActiveTab()?.matchCount;
  if (!count || count.state === 'idle') {
    $('find-count').textContent = '';
    return;
  }
  $('find-count').textContent = count.state === 'searching' ? t('find.searching')
    : count.state === 'no-results' ? t('find.noResults')
      : t('find.count', { current: count.current, total: count.total });
}

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
  if (!tab.query) {
    tab.matchCount = { state: 'idle', current: 0, total: 0 };
    refreshFindCount();
  }
}
