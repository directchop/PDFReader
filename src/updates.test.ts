import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderTab } from './state';
import { tabs } from './state';
import { initializeUpdateSettings } from './updates';
import { commitPendingAnnotations, saveAsCopy } from './annotations';
import { requestUnsavedChoice } from './unsaved';
import { flushSession } from './tabs';
import * as bridge from './bridge';
import { notify } from './dom';

class Control extends EventTarget {
  open = false;
  hidden = true;
  disabled = false;
  checked = false;
  textContent = '';
  onclick?: () => void;
  showModal() { this.open = true; }
  close() { this.open = false; }
}
const controls = vi.hoisted(() => new Map<string, Control>());
const control = (id: string) => controls.get(id)!;
vi.mock('./dom', () => ({
  $: (id: string) => controls.get(id),
  button: (id: string) => controls.get(id),
  input: (id: string) => controls.get(id),
  message: String, notify: vi.fn(),
}));
vi.mock('./bridge', () => ({
  desktop: true, updateAvailableInBuild: vi.fn(async () => true),
  checkUpdate: vi.fn(async () => ({ version: '0.2.0', notes: 'Test update', date: null })),
  installUpdate: vi.fn(async () => {}),
}));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.0' }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => vi.fn() }));
vi.mock('./i18n', () => ({ getLocale: () => 'en', t: (key: string) => key }));
vi.mock('./annotations', () => ({ commitPendingAnnotations: vi.fn(), saveAsCopy: vi.fn() }));
vi.mock('./tabs', () => ({ flushPosition: vi.fn(async () => {}), flushSession: vi.fn(async () => {}) }));
vi.mock('./unsaved', () => ({ requestUnsavedChoice: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  controls.clear();
  for (const id of ['updates-section', 'app-version', 'update-dialog', 'update-check', 'check-updates',
    'update-later', 'update-install', 'update-title', 'update-notes', 'update-date', 'update-progress', 'update-progress-text']) {
    controls.set(id, new Control());
  }
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout: vi.fn() }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  tabs.splice(0);
  vi.mocked(requestUnsavedChoice).mockResolvedValue('cancel');
  await initializeUpdateSettings();
  control('check-updates').onclick!();
  await vi.waitFor(() => expect(control('update-dialog').open).toBe(true));
});
afterEach(() => { tabs.splice(0); vi.unstubAllGlobals(); });

async function finished() {
  await vi.waitFor(() => expect(control('update-install').disabled).toBe(false));
}

describe('update installation safeguards', () => {
  it('commits pending editors and aborts when the unsaved dialog is cancelled', async () => {
    const tab = { modified: false } as ReaderTab;
    tabs.push(tab);
    vi.mocked(commitPendingAnnotations).mockImplementationOnce(() => { tab.modified = true; });
    control('update-install').onclick!();
    await finished();
    expect(requestUnsavedChoice).toHaveBeenCalledWith([tab]);
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    expect(control('update-dialog').open).toBe(true);
  });

  it('does not restart after a failed or cancelled save', async () => {
    tabs.push({ modified: true } as ReaderTab);
    vi.mocked(requestUnsavedChoice).mockResolvedValue('save');
    vi.mocked(saveAsCopy).mockResolvedValue(false);
    control('update-install').onclick!();
    await finished();
    expect(saveAsCopy).toHaveBeenCalledTimes(1);
    expect(bridge.installUpdate).not.toHaveBeenCalled();
  });

  it('keeps the modal and blocks repeated installs while saving and flushing', async () => {
    const tab = { modified: true } as ReaderTab;
    tabs.push(tab);
    vi.mocked(requestUnsavedChoice).mockResolvedValue('save');
    let finishSave!: (saved: boolean) => void;
    let finishFlush!: () => void;
    vi.mocked(saveAsCopy).mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
    vi.mocked(flushSession).mockImplementationOnce(() => new Promise(resolve => { finishFlush = resolve; }));
    control('update-install').onclick!();
    await vi.waitFor(() => expect(saveAsCopy).toHaveBeenCalledTimes(1));
    expect(control('update-dialog').open).toBe(true);
    expect(control('update-later').disabled).toBe(true);
    const cancel = new Event('cancel', { cancelable: true });
    control('update-dialog').dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    control('update-install').onclick!();
    expect(requestUnsavedChoice).toHaveBeenCalledTimes(1);
    tab.modified = false;
    finishSave(true);
    await vi.waitFor(() => expect(flushSession).toHaveBeenCalledTimes(1));
    expect(control('update-dialog').open).toBe(true);
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    finishFlush();
    await finished();
    expect(bridge.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('aborts if another tab becomes dirty while saving', async () => {
    const first = { modified: true } as ReaderTab;
    const second = { modified: false } as ReaderTab;
    tabs.push(first, second);
    vi.mocked(requestUnsavedChoice).mockResolvedValue('save');
    vi.mocked(saveAsCopy).mockImplementationOnce(async () => {
      first.modified = false;
      second.modified = true;
      return true;
    });
    control('update-install').onclick!();
    await finished();
    expect(bridge.installUpdate).not.toHaveBeenCalled();
  });

  it('allows explicit discard and restores controls after an installation failure', async () => {
    tabs.push({ modified: true } as ReaderTab);
    vi.mocked(requestUnsavedChoice).mockResolvedValue('discard');
    vi.mocked(bridge.installUpdate).mockRejectedValueOnce(new Error('Download failed'));
    control('update-install').onclick!();
    await finished();
    expect(bridge.installUpdate).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Error: Download failed');
    expect(control('update-later').disabled).toBe(false);
    expect(control('update-dialog').open).toBe(true);
  });
});
