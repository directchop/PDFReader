import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface DocumentInfo { id: string; name: string; path: string; size: number }
export interface RecentFile { name: string; path: string }
export interface OpenError { name: string; code: string }
export interface OpenBatch { documents: DocumentInfo[]; errors: OpenError[] }

export const desktop = isTauri();
const browserFiles = new Map<string, File>();

export async function acceptBrowserFiles(files: File[]): Promise<OpenBatch> {
  const result: OpenBatch = { documents: [], errors: [] };
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
    result.documents.push({ id, name: file.name, path: file.name, size: file.size });
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
export const recentDocuments = (): Promise<RecentFile[]> => desktop ? invoke('recent_documents') : Promise.resolve([]);
export const reopenRecent = (path: string): Promise<DocumentInfo> => invoke('reopen_recent', { path });
export const clearRecent = (): Promise<void> => desktop ? invoke('clear_recent') : Promise.resolve();
export const takePending = (): Promise<OpenBatch> => desktop ? invoke('take_pending') : Promise.resolve({ documents: [], errors: [] });
export async function onDocumentsReady(callback: () => void) {
  if (desktop) return listen('documents-ready', callback);
  return () => {};
}
export async function printDocument() {
  if (desktop) await invoke('print_document'); else window.print();
}
