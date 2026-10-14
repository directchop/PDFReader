import * as bridge from './bridge';
import { getActiveTab, type ReaderTab } from './state';
import { t } from './i18n';
import { refreshToolbar } from './toolbar';
import { renderSidebar } from './sidebar';

export function isBookmarked(tab: ReaderTab, page = tab.viewer.currentPageNumber) {
  return tab.bookmarks.some(bookmark => bookmark.page === page);
}

async function outlineLabel(tab: ReaderTab, page: number): Promise<string | undefined> {
  async function find(items: NonNullable<ReaderTab['outline']>, best?: { page: number; title: string }) {
    for (const item of items) {
      if (item.dest && tab.pdf) {
        const dest = typeof item.dest === 'string' ? await tab.pdf.getDestination(item.dest) : item.dest;
        if (Array.isArray(dest) && dest[0]) {
          const pageIndex = typeof dest[0] === 'number' ? dest[0] : await tab.pdf.getPageIndex(dest[0]);
          const itemPage = pageIndex + 1;
          if (itemPage <= page && (!best || itemPage >= best.page)) best = { page: itemPage, title: item.title };
        }
      }
      best = await find(item.items, best);
    }
    return best;
  }
  return tab.outline ? (await find(tab.outline))?.title : undefined;
}

export async function toggleCurrentBookmark() {
  const tab = getActiveTab();
  if (!tab?.pdf) return;
  const page = tab.viewer.currentPageNumber;
  const index = tab.bookmarks.findIndex(bookmark => bookmark.page === page);
  if (index >= 0) {
    tab.bookmarks.splice(index, 1);
  } else {
    if (tab.bookmarks.length >= 200) throw new Error('invalid_bookmark');
    const label = await outlineLabel(tab, page) ?? t('sidebar.bookmarkPage', { page });
    tab.bookmarks.push({ page, label });
  }
  tab.bookmarks.sort((a, b) => a.page - b.page);
  await bridge.saveBookmarks(tab.info, tab.bookmarks);
  refreshToolbar();
  await renderSidebar();
}
