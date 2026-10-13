import { getActiveTab, type ReaderTab } from './state';
import { $ } from './dom';
import { t } from './i18n';

let renderVersion = 0;

export async function renderSearchResults(tab: ReaderTab = getActiveTab()!) {
  const content = $('sidebar-content');
  content.replaceChildren();
  const version = ++renderVersion;
  if (!tab?.pdf || !tab.query.trim()) return;
  const pages = tab.find.pageMatches ?? [];
  const lengths = tab.find.pageMatchesLength ?? [];
  const rows: { page: number; matches: { index: number; length: number }[]; text: string }[] = [];
  for (let pageIndex = 0; pageIndex < tab.pdf.numPages; pageIndex++) {
    const matches: number[] = pages[pageIndex] ?? [];
    if (!matches.length) continue;
    const textContent = await (await tab.pdf.getPage(pageIndex + 1)).getTextContent({ disableNormalization: true });
    if (version !== renderVersion || tab.disposed) return;
    const text = textContent.items.map(item => {
      const textItem = item as { str?: string; hasEOL?: boolean };
      return `${textItem.str ?? ''}${textItem.hasEOL ? '\n' : ''}`;
    }).join('');
    rows.push({
      page: pageIndex + 1,
      matches: matches.map((index, matchIndex) => ({
        index,
        length: lengths[pageIndex]?.[matchIndex] ?? tab.query.length,
      })),
      text,
    });
  }
  const count = Math.min(rows.length, 500);
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
      const start = Math.max(0, match.index - 20);
      const end = Math.min(result.text.length, match.index + match.length + 20);
      const line = document.createElement('span');
      line.className = 'search-result-snippet';
      if (start > 0) line.append(document.createTextNode('…'));
      line.append(document.createTextNode(result.text.slice(start, match.index)));
      const matchText = result.text.slice(match.index, match.index + match.length);
      if (tab.matchCase ? matchText === tab.query : matchText.toLocaleLowerCase() === tab.query.toLocaleLowerCase()) {
        const mark = document.createElement('mark');
        mark.textContent = matchText;
        line.append(mark);
      } else {
        line.append(document.createTextNode(matchText));
      }
      line.append(document.createTextNode(result.text.slice(match.index + match.length, end)));
      if (end < result.text.length) line.append(document.createTextNode('…'));
      snippet.append(line);
    }
    row.append(page, snippet);
    row.onclick = () => {
      content.querySelectorAll('.search-result.active').forEach(item => item.classList.remove('active'));
      row.classList.add('active');
      tab.viewer.currentPageNumber = result.page;
    };
    content.append(row);
  }
  if (rows.length > count) {
    const more = document.createElement('p');
    more.className = 'search-results-more';
    more.textContent = t('sidebar.searchMore', { count: rows.length - count });
    content.append(more);
  }
}
