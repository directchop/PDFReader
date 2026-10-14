import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderTab } from './state';
import { setActiveTab } from './state';
import { saveAsCopy } from './annotations';
import * as bridge from './bridge';

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  AnnotationEditorType: { NONE: 0, FREETEXT: 3, HIGHLIGHT: 9, INK: 15 },
  AnnotationEditorParamsType: {},
}));
vi.mock('./bridge', () => ({ desktop: true, pickSavePath: vi.fn(), writeSavedCopy: vi.fn() }));
vi.mock('./i18n', () => ({ t: (key: string) => key }));
vi.mock('./dom', () => ({
  $: () => ({ hidden: false }),
  button: () => ({ setAttribute() {}, disabled: false }),
  message: String,
  notify: vi.fn(),
}));

function draft() {
  const storage = { serializable: { hash: 'first edit' } };
  const saveDocument = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
  const tab = {
    info: { id: 'test', name: 'test.pdf' },
    modified: true, savedAnnotationHash: '', disposed: false,
    pdf: { annotationStorage: storage, saveDocument },
    annotationEditor: { endCurrentEditing: vi.fn() },
  } as unknown as ReaderTab;
  setActiveTab(tab);
  return { tab, storage, saveDocument };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('document', { querySelectorAll: () => [] });
  vi.stubGlobal('window', new EventTarget());
  vi.mocked(bridge.pickSavePath).mockResolvedValue('save-token');
  vi.mocked(bridge.writeSavedCopy).mockResolvedValue('copy.pdf');
});
afterEach(() => { setActiveTab(); vi.unstubAllGlobals(); });

describe('save-copy transaction', () => {
  it('keeps edits when the native save picker is cancelled', async () => {
    const { tab, saveDocument } = draft();
    vi.mocked(bridge.pickSavePath).mockResolvedValue(null);
    expect(await saveAsCopy(tab)).toBe(false);
    expect(tab.modified).toBe(true);
    expect(saveDocument).not.toHaveBeenCalled();
    expect(bridge.writeSavedCopy).not.toHaveBeenCalled();
  });

  it('keeps edits after a native write failure and permits a retry', async () => {
    const { tab } = draft();
    vi.mocked(bridge.writeSavedCopy).mockRejectedValueOnce(new Error('disk full'));
    expect(await saveAsCopy(tab)).toBe(false);
    expect(tab.modified).toBe(true);
    expect(tab.savedAnnotationHash).toBe('');
    expect(await saveAsCopy(tab)).toBe(true);
    expect(tab.modified).toBe(false);
    expect(tab.savedAnnotationHash).toBe('first edit');
  });

  it('keeps edits made while a save is in flight and refuses to close', async () => {
    const { tab, storage, saveDocument } = draft();
    let release!: () => void;
    vi.mocked(bridge.writeSavedCopy).mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve('copy.pdf');
    }));
    const saving = saveAsCopy(tab);
    await vi.waitFor(() => expect(bridge.writeSavedCopy).toHaveBeenCalledTimes(1));
    storage.serializable.hash = 'later edit';
    // Repeated shortcuts cannot start another picker or overlapping write.
    expect(saveAsCopy(tab)).toBe(saving);
    release();
    expect(await saving).toBe(false);
    expect(tab.modified).toBe(true);
    expect(tab.savedAnnotationHash).toBe('first edit');
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(await saveAsCopy(tab)).toBe(true);
    expect(tab.savedAnnotationHash).toBe('later edit');
  });

  it('commits a focused editor before deciding whether a save is needed', async () => {
    const { tab, storage } = draft();
    tab.modified = false;
    storage.serializable.hash = '';
    vi.mocked(tab.annotationEditor!.endCurrentEditing).mockImplementation(() => {
      storage.serializable.hash = 'committed text';
    });
    expect(await saveAsCopy(tab)).toBe(true);
    expect(tab.savedAnnotationHash).toBe('committed text');
    expect(bridge.writeSavedCopy).toHaveBeenCalledTimes(1);
  });
});
