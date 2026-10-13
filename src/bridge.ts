import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface ReadingPosition {
  page: number;
  pages: number;
  scale: string;
  rotation: number;
  spread: number;
  scroll: number;
}
export interface DocumentInfo { id: string; name: string; path: string; size: number; position: ReadingPosition | null }
export interface RecentFile { name: string; path: string; position: ReadingPosition | null; exists: boolean }
export interface OpenError { name: string; code: string }
export interface OpenBatch { documents: DocumentInfo[]; errors: OpenError[]; active: string | null }

export const desktop = isTauri();
const browserFiles = new Map<string, File>();

function browserPositionKey(name: string, size: number) {
  return `pdfreader.position:${name}:${size}`;
}

function readBrowserPosition(name: string, size: number): ReadingPosition | null {
  try {
    const stored = localStorage.getItem(browserPositionKey(name, size));
    if (!stored) return null;
    const position = JSON.parse(stored) as ReadingPosition;
    const scale = ['auto', 'page-width', 'page-fit'].includes(position.scale)
      || (Number.isFinite(Number(position.scale)) && Number(position.scale) >= 0.1 && Number(position.scale) <= 10);
    if (!Number.isInteger(position.page) || position.page < 1
      || !Number.isInteger(position.pages) || position.pages < 1 || !scale
      || ![0, 90, 180, 270].includes(position.rotation)
      || !Number.isInteger(position.spread) || position.spread < 0 || position.spread > 2
      || !Number.isInteger(position.scroll) || position.scroll < 0 || position.scroll > 3) return null;
    return position;
  } catch {
    return null;
  }
}

export async function acceptBrowserFiles(files: File[]): Promise<OpenBatch> {
  const result: OpenBatch = { documents: [], errors: [], active: null };
  for (const file of files) {
    if (browserFiles.size >= 12) {
      result.errors.push({ name: file.name, code: 'too_many_open' });
      continue;
    }
    if (file.size > 1024 ** 3) {
      result.errors.push({ name: file.name, code: 'too_large' });
      continue;
    }
    const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
    if (!header.includes('%PDF-')) { result.errors.push({ name: file.name, code: 'not_pdf' }); continue; }
    const id = crypto.randomUUID();
    browserFiles.set(id, file);
    result.documents.push({ id, name: file.name, path: file.name, size: file.size, position: readBrowserPosition(file.name, file.size) });
  }
  return result;
}

export async function openDocuments(): Promise<OpenBatch> {
  if (desktop) return invoke('open_documents');
  return new Promise(resolve => {
    const picker = document.createElement('input');
    picker.type = 'file'; picker.accept = 'application/pdf,.pdf'; picker.multiple = true;
    picker.addEventListener('change', async () => resolve(await acceptBrowserFiles([...picker.files!])));
    picker.addEventListener('cancel', () => resolve({ documents: [], errors: [] }));
    picker.click();
  });
}

export async function readRange(id: string, begin: number, end: number): Promise<Uint8Array> {
  if (!desktop) {
    const file = browserFiles.get(id);
    if (!file) throw new Error('document_closed');
    return new Uint8Array(await file.slice(begin, end).arrayBuffer());
  }
  const data = await invoke<ArrayBuffer | number[]>('read_document_range', { id, begin, end });
  return new Uint8Array(data);
}
export async function closeDocument(id: string) {
  if (desktop) await invoke('close_document', { id }); else browserFiles.delete(id);
}
export async function savePosition(id: string, position: ReadingPosition) {
  if (desktop) {
    await invoke('save_position', { id, position });
    return;
  }
  const file = browserFiles.get(id);
  if (!file) throw new Error('document_closed');
  localStorage.setItem(browserPositionKey(file.name, file.size), JSON.stringify(position));
}
export const recentDocuments = (): Promise<RecentFile[]> => desktop ? invoke('recent_documents') : Promise.resolve([]);
export const reopenRecent = (path: string): Promise<DocumentInfo> => invoke('reopen_recent', { path });
export const clearRecent = (): Promise<void> => desktop ? invoke('clear_recent') : Promise.resolve();
export const removeRecent = (path: string): Promise<void> => desktop ? invoke('remove_recent', { path }) : Promise.resolve();
export const takePending = (): Promise<OpenBatch> => desktop
  ? invoke('take_pending')
  : Promise.resolve({ documents: [], errors: [], active: null });
export const saveSession = (ids: string[], active: string | null): Promise<void> => desktop
  ? invoke('save_session', { ids, active })
  : Promise.resolve();
export const restoreSession = (): Promise<OpenBatch> => desktop
  ? invoke('restore_session')
  : Promise.resolve({ documents: [], errors: [], active: null });
export async function onDocumentsReady(callback: () => void) {
  if (desktop) return listen('documents-ready', callback);
  return () => {};
}
export async function printDocument() {
  if (desktop) await invoke('print_document'); else window.print();
}
export async function setFullscreen(fullscreen: boolean) {
  if (desktop) {
    await invoke('set_fullscreen', { fullscreen });
  } else if (fullscreen) {
    await document.documentElement.requestFullscreen();
  } else if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
}
