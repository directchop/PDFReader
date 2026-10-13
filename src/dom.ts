import { describeError } from './i18n';

let toastTimer: ReturnType<typeof setTimeout>;

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const input = (id: string) => $<HTMLInputElement>(id);
export const button = (id: string) => $<HTMLButtonElement>(id);

export function message(error: unknown) {
  return describeError(error instanceof Error ? error.message : String(error));
}

export function notify(text: string) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 7000);
}

export function run(action: () => Promise<unknown>) {
  void action().catch(error => notify(message(error)));
}

export function sizeLabel(bytes: number) {
  return bytes < 1024 ** 2 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
