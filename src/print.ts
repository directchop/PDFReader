import { AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as bridge from './bridge';
import { $, button, input, message, notify } from './dom';
import { getActiveTab } from './state';
import { parsePageRange } from './print-range';
import { t } from './i18n';

const printDialog = $<HTMLDialogElement>('print-dialog');
let printGeneration = 0;
let printing = false;
const printUrls: string[] = [];
let printStyle: HTMLStyleElement | undefined;

export function initializePrint() {
  printStyle = document.createElement('style');
  document.head.append(printStyle);
}

export function isPrintBusy() {
  return printDialog.open || printing;
}

export function showPrint() {
  const tab = getActiveTab();
  if (!tab?.pdf || !tab.canPrint || printing || printDialog.open) return;
  input('print-range').value = '';
  $('print-progress').textContent = '';
  printDialog.showModal();
}

export function clearPrintOutput() {
  $('print-output').replaceChildren();
  printUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
}

export function cancelPrint() {
  printGeneration++;
  printDialog.close();
}

export async function preparePrint() {
  const tab = getActiveTab();
  if (!tab?.pdf || printing) return;
  let pages: number[];
  try {
    pages = parsePageRange(input('print-range').value, tab.pdf.numPages);
  } catch (error) {
    $('print-progress').textContent = message(error);
    return;
  }
  const generation = ++printGeneration;
  printing = true;
  button('print-submit').disabled = true;
  clearPrintOutput();
  let totalPixels = 0;
  try {
    const first = await tab.pdf.getPage(pages[0]);
    const firstSize = first.getViewport({ scale: 1, rotation: (first.rotate + tab.viewer.pagesRotation) % 360 });
    printStyle!.textContent = `@page { size: ${firstSize.width}pt ${firstSize.height}pt; margin: 0; } @media print { .print-page { width: ${firstSize.width}pt; height: ${firstSize.height}pt; } }`;
    for (const [index, number] of pages.entries()) {
      if (generation !== printGeneration || tab.disposed) return;
      $('print-progress').textContent = t('print.preparing', { current: index + 1, total: pages.length });
      const page = await tab.pdf.getPage(number);
      const base = page.getViewport({ scale: 1, rotation: (page.rotate + tab.viewer.pagesRotation) % 360 });
      const scale = Math.min(150 / 72, Math.sqrt(8_000_000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale, rotation: base.rotation });
      totalPixels += viewport.width * viewport.height;
      if (totalPixels > 120_000_000) throw new Error(t('print.tooLarge'));
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, intent: 'print', annotationMode: AnnotationMode.ENABLE }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error(t('print.imageFailed')))));
      canvas.width = canvas.height = 0;
      if (generation !== printGeneration) return;
      const url = URL.createObjectURL(blob);
      printUrls.push(url);
      const image = new Image();
      image.src = url;
      await image.decode();
      const paper = document.createElement('div');
      paper.className = 'print-page';
      paper.append(image);
      $('print-output').append(paper);
    }
    if (generation !== printGeneration) return;
    printDialog.close();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await bridge.printDocument();
    // Native print dialogs can outlive the Rust command. Keep this immutable
    // snapshot until afterprint or the next print, even if the source tab closes.
  } catch (error) {
    clearPrintOutput();
    if (printDialog.open) $('print-progress').textContent = message(error);
    else notify(message(error));
  } finally {
    printing = false;
    button('print-submit').disabled = false;
    if (generation !== printGeneration) clearPrintOutput();
  }
}
