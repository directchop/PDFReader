import { AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { $, run } from './dom';
import { getActiveTab, state, type ReaderTab } from './state';

export async function renderSidebar() {
  state.thumbnailObserver?.disconnect();
  const version = ++state.sidebarVersion;
  const content = $('sidebar-content');
  content.replaceChildren();
  $('show-pages').classList.toggle('selected', state.sidebarMode === 'pages');
  $('show-outline').classList.toggle('selected', state.sidebarMode === 'outline');
  const tab = getActiveTab();
  if (!tab?.pdf || $('sidebar').hidden) return;
  if (state.sidebarMode === 'outline') {
    const outline = tab.outline;
    if (!outline?.length) {
      content.innerHTML = '<p class="sidebar-empty">このPDFには目次がありません。</p>';
      return;
    }
    type Outline = NonNullable<ReaderTab['outline']>;
    function append(items: Outline, depth = 0) {
      for (const item of items) {
        const el = document.createElement('button');
        el.className = 'outline-item';
        el.textContent = item.title;
        el.style.paddingLeft = `${7 + Math.min(depth, 8) * 12}px`;
        el.onclick = () => {
          const dest = item.dest;
          if (dest) run(() => tab!.links.goToDestination(dest));
        };
        content.append(el);
        if (item.items.length) append(item.items, depth + 1);
      }
    }
    append(outline);
    return;
  }
  const first = Math.floor((tab.viewer.currentPageNumber - 1) / 30) * 30 + 1;
  state.thumbnailGroup = Math.floor((first - 1) / 30);
  const last = Math.min(first + 29, tab.pdf.numPages);
  if (tab.pdf.numPages > 30) {
    const navigation = document.createElement('div');
    navigation.className = 'thumb-pagination';
    const prev = document.createElement('button');
    prev.textContent = '‹';
    prev.setAttribute('aria-label', '前の30ページ');
    prev.disabled = first === 1;
    prev.onclick = () => {
      tab.viewer.currentPageNumber = Math.max(1, first - 30);
    };
    const label = document.createElement('span');
    label.textContent = `${first}–${last}`;
    const next = document.createElement('button');
    next.textContent = '›';
    next.setAttribute('aria-label', '次の30ページ');
    next.disabled = last === tab.pdf.numPages;
    next.onclick = () => {
      tab.viewer.currentPageNumber = last + 1;
    };
    navigation.append(prev, label, next);
    content.append(navigation);
  }
  state.thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target as HTMLButtonElement;
      state.thumbnailObserver?.unobserve(el);
      const pageNumber = Number(el.dataset.page);
      void (async () => {
        const page = await tab.pdf!.getPage(pageNumber);
        if (version !== state.sidebarVersion || tab.disposed) return;
        const base = page.getViewport({ scale: 1, rotation: (page.rotate + tab.viewer.pagesRotation) % 360 });
        const viewport = page.getViewport({ scale: 168 / base.width, rotation: base.rotation });
        const canvas = el.querySelector('canvas')!;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
      })().catch(() => {
        /* Closing or switching a tab can cancel a thumbnail. */
      });
    }
  }, { root: content, rootMargin: '120px' });
  for (let n = first; n <= last; n++) {
    const el = document.createElement('button');
    el.className = `thumbnail${n === tab.viewer.currentPageNumber ? ' active' : ''}`;
    el.dataset.page = String(n);
    el.setAttribute('aria-label', `${n}ページへ`);
    el.innerHTML = `<canvas width="112" height="158" aria-hidden="true"></canvas><span>${n}</span>`;
    el.onclick = () => {
      tab.viewer.currentPageNumber = n;
    };
    content.append(el);
    state.thumbnailObserver.observe(el);
  }
}
