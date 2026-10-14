import * as bridge from './bridge';
import { $, button, notify, run } from './dom';
import { icon } from './icons';
import { enqueue } from './tabs';
import { t } from './i18n';

export async function refreshRecent() {
  const items = await bridge.recentDocuments();
  const list = $('recent-list');
  list.replaceChildren();
  button('clear-recent').disabled = items.length === 0;
  if (!items.length) {
    list.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'recent-empty';
    empty.textContent = t('recent.empty');
    list.append(empty);
    return;
  }
  for (const item of items.slice(0, 12)) {
    const card = document.createElement('div');
    card.className = 'recent-card';
    const el = document.createElement('button');
    el.className = `recent-item${item.exists ? '' : ' missing'}`;
    el.title = item.path;
    el.innerHTML = `${icon('file')}<div><strong></strong><small></small></div>`;
    el.querySelector('strong')!.textContent = item.name;
    el.querySelector('small')!.textContent = item.path;
    if (item.position) {
      const details = el.querySelector('div')!;
      const progressLabel = document.createElement('small');
      progressLabel.className = 'recent-progress-label';
      progressLabel.textContent = t('recent.progress', { page: item.position.page, pages: item.position.pages });
      details.append(progressLabel);
      if (item.position.pages > 0) {
        const track = document.createElement('div');
        track.className = 'recent-progress-track';
        const fill = document.createElement('span');
        fill.style.width = `${Math.min(100, Math.max(0, item.position.page / item.position.pages * 100))}%`;
        track.append(fill);
        details.append(track);
      }
    }
    if (!item.exists) {
      const missing = document.createElement('small');
      missing.className = 'recent-missing';
      missing.textContent = t('recent.missing');
      el.querySelector('div')!.append(missing);
    }
    el.onclick = () => {
      if (!item.exists) {
        notify(t('error.file_not_found'));
        return;
      }
      run(async () => enqueue({ documents: [await bridge.reopenRecent(item.path)], errors: [], active: null }));
    };
    const remove = document.createElement('button');
    remove.className = 'icon-button recent-remove';
    remove.innerHTML = icon('close');
    remove.setAttribute('aria-label', t('recent.remove', { name: item.name }));
    remove.onclick = () => run(async () => {
      await bridge.removeRecent(item.path);
      await refreshRecent();
    });
    card.append(el, remove);
    list.append(card);
  }
}
