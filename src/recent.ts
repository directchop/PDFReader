import * as bridge from './bridge';
import { $, button, run } from './dom';
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
  for (const item of items.slice(0, 6)) {
    const el = document.createElement('button');
    el.className = 'recent-item';
    el.title = item.path;
    el.innerHTML = `${icon('file')}<div><strong></strong><small></small></div>`;
    el.querySelector('strong')!.textContent = item.name;
    el.querySelector('small')!.textContent = item.path;
    el.onclick = () => run(async () => enqueue({ documents: [await bridge.reopenRecent(item.path)], errors: [] }));
    list.append(el);
  }
}
