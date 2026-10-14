import { getActiveTab, state, type ReaderTab } from './state';
import { $ } from './dom';
import { t } from './i18n';

export function anchorMatch(text: string, index: number, query: string, matchCase: boolean): number | null {
  if (!query) return null;
  const center = Number.isFinite(index) ? Math.round(index) : 0;
  const start = Math.max(0, center - 32);
  const end = Math.min(text.length - query.length, center + 32);
  if (end < start) return null;
  const expected = matchCase ? query : query.toLocaleLowerCase();
  let nearest: number | null = null;
  let nearestDistance = Infinity;
  for (let candidate = start; candidate <= end; candidate++) {
    const value = text.slice(candidate, candidate + query.length);
    const matches = matchCase ? value === expected : value.toLocaleLowerCase() === expected;
    const distance = Math.abs(candidate - center);
    if (matches && distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function searchRenderIsCurrent(
  version: number,
  currentVersion: number,
  mode: string,
  tab: ReaderTab,
  activeTab: ReaderTab | undefined,
) {
  return version === currentVersion && mode === 'search' && activeTab === tab && !tab.disposed;
}

function isCurrent(version: number, tab: ReaderTab) {
  return searchRenderIsCurrent(version, state.sidebarVersion, state.sidebarMode, tab, getActiveTab());
}

export async function renderSearchResults(tab: ReaderTab, version: number) {
  const content = $('sidebar-content');
  if (!tab?.pdf || !tab.query.trim()) return;
  const pages = tab.find.pageMatches ?? [];
  const lengths = tab.find.pageMatchesLength ?? [];
  const rows: { page: number; matches: { index: number; length: number; anchor: number | null }[]; text: string }[] = [];
  for (let pageIndex = 0; pageIndex < tab.pdf.numPages; pageIndex++) {
    const matches: number[] = pages[pageIndex] ?? [];
    if (!matches.length) continue;
    const page = await tab.pdf.getPage(pageIndex + 1);
    if (!isCurrent(version, tab)) return;
    const textContent = await page.getTextContent({ disableNormalization: true });
    if (!isCurrent(version, tab)) return;
    const text = textContent.items.map(item => {
      const textItem = item as { str?: string; hasEOL?: boolean };
      return `${textItem.str ?? ''}${textItem.hasEOL ? '\n' : ''}`;
    }).join('');
    rows.push({
      page: pageIndex + 1,
      matches: matches.map((index, matchIndex) => ({
        index,
        length: lengths[pageIndex]?.[matchIndex] ?? tab.query.length,
        anchor: anchorMatch(text, index, tab.query, tab.matchCase),
      })),
      text,
    });
  }
  if (!isCurrent(version, tab)) return;
  const count = Math.min(rows.length, 500);
  const fragment = document.createDocumentFragment();
  for (const result of rows.slice(0, count)) {
    const row = document.createElement('button');
    row.className = 'search-result';
    row.dataset.page = String(result.page);
    const page = document.createElement('span');
    page.className = 'search-result-page';
    page.textContent = String(result.page);
    const snippet = document.createElement('span');
    snippet.className = 'search-result-snippets';
    for (const match of result.matches) {
      const matchStart = match.anchor ?? Math.max(0, Math.min(result.text.length, match.index));
      const matchLength = match.anchor === null ? match.length : tab.query.length;
      const matchEnd = Math.min(result.text.length, matchStart + matchLength);
      const start = Math.max(0, matchStart - 20);
      const end = Math.min(result.text.length, matchEnd + 20);
      const line = document.createElement('span');
      line.className = 'search-result-snippet';
      if (start > 0) line.append(document.createTextNode('…'));
      line.append(document.createTextNode(result.text.slice(start, matchStart).replace(/\n/g, ' ')));
      const matchText = result.text.slice(matchStart, matchEnd);
      if (match.anchor !== null) {
        const mark = document.createElement('mark');
        mark.textContent = matchText;
        line.append(mark);
      } else {
        line.append(document.createTextNode(matchText));
      }
      line.append(document.createTextNode(result.text.slice(matchEnd, end).replace(/\n/g, ' ')));
      if (end < result.text.length) line.append(document.createTextNode('…'));
      snippet.append(line);
    }
    row.append(page, snippet);
    row.onclick = () => {
      content.querySelectorAll('.search-result.active').forEach(item => item.classList.remove('active'));
      row.classList.add('active');
      tab.viewer.currentPageNumber = result.page;
    };
    fragment.append(row);
  }
  if (rows.length > count) {
    const more = document.createElement('p');
    more.className = 'search-results-more';
    more.textContent = t('sidebar.searchMore', { count: rows.length - count });
    fragment.append(more);
  }
  if (!isCurrent(version, tab)) return;
  content.replaceChildren(fragment);
}
