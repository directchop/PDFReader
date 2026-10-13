import { ScrollMode, SpreadMode } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import { $, button } from './dom';
import { getActiveTab, type ReaderTab } from './state';
import { flushPosition } from './tabs';
import { setFullscreen } from './fullscreen';

type ViewState = { scale: string; spread: number; scroll: number };

let saved: { id: string; view: ViewState } | undefined;
let cursorTimer: ReturnType<typeof setTimeout> | undefined;

export function presentationBaseline(tab: ReaderTab): ViewState | undefined {
  return $('app').classList.contains('presenting') && saved?.id === tab.info.id
    ? saved.view
    : undefined;
}

function showCursor() {
  $('app').classList.remove('cursor-hidden');
  if (cursorTimer) clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => $('app').classList.add('cursor-hidden'), 2000);
}

export function initializePresentation() {
  button('present').onclick = () => {
    if ($('app').classList.contains('presenting')) void exitPresentation();
    else void enterPresentation();
  };
  window.addEventListener('pointermove', () => {
    if ($('app').classList.contains('presenting')) showCursor();
  });
  $('documents').addEventListener('click', () => {
    if ($('app').classList.contains('presenting')) getActiveTab()?.viewer.nextPage();
  });
}

export async function enterPresentation() {
  const tab = getActiveTab();
  if (!tab?.pdf || $('app').classList.contains('presenting')) return;
  saved = {
    id: tab.info.id,
    view: {
      scale: tab.viewer.currentScaleValue || 'auto',
      spread: tab.viewer.spreadMode,
      scroll: tab.viewer.scrollMode,
    },
  };
  tab.viewer.spreadMode = SpreadMode.NONE;
  tab.viewer.scrollMode = ScrollMode.PAGE;
  tab.viewer.currentScaleValue = 'page-fit';
  await setFullscreen(true).catch(() => {});
  $('app').classList.add('presenting');
  button('present').setAttribute('aria-pressed', 'true');
  showCursor();
}

export async function exitPresentation(leaveFullscreen = true) {
  if (!$('app').classList.contains('presenting')) return;
  const tab = getActiveTab();
  const previous = saved;
  $('app').classList.remove('presenting', 'cursor-hidden');
  if (cursorTimer) clearTimeout(cursorTimer);
  cursorTimer = undefined;
  button('present').setAttribute('aria-pressed', 'false');
  if (tab && previous?.id === tab.info.id) {
    tab.viewer.spreadMode = previous.view.spread;
    tab.viewer.scrollMode = previous.view.scroll;
    tab.viewer.currentScaleValue = previous.view.scale;
  }
  saved = undefined;
  if (leaveFullscreen) await setFullscreen(false).catch(() => {});
  if (tab) await flushPosition(tab);
}
