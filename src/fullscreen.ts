import * as bridge from './bridge';
import { $, button } from './dom';
import { t } from './i18n';

export function syncFullscreen(fullscreen: boolean) {
  $('app').classList.toggle('fullscreen', fullscreen);
  button('fullscreen').setAttribute('aria-pressed', String(fullscreen));
  const key = fullscreen ? 'toolbar.exitFullscreen' : 'toolbar.fullscreen';
  button('fullscreen').setAttribute('aria-label', t(key));
  button('fullscreen').title = t(key);
}

export async function setFullscreen(fullscreen: boolean) {
  await bridge.setFullscreen(fullscreen);
  syncFullscreen(fullscreen);
}
