import { $, button } from './dom';
import type { ReaderTab } from './state';

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

let pending: Promise<UnsavedChoice> | undefined;

export function requestUnsavedChoice(tabs: ReaderTab[]): Promise<UnsavedChoice> {
  if (pending) return pending;
  const dialog = $<HTMLDialogElement>('unsaved-dialog');
  $('unsaved-files').replaceChildren();
  for (const tab of tabs) {
    const item = document.createElement('li');
    item.textContent = tab.info.name;
    $('unsaved-files').append(item);
  }
  pending = new Promise<UnsavedChoice>(resolve => {
    let done = false;
    const finish = (choice: UnsavedChoice) => {
      if (done) return;
      done = true;
      dialog.close();
      resolve(choice);
    };
    button('unsaved-save').onclick = () => finish('save');
    button('unsaved-discard').onclick = () => finish('discard');
    button('unsaved-cancel').onclick = () => finish('cancel');
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      finish('cancel');
    }, { once: true });
    dialog.showModal();
  }).finally(() => {
    pending = undefined;
  });
  return pending;
}
