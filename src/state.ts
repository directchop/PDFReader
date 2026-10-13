import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import type { DocumentInfo } from './bridge';
import type { Bookmark } from './bridge';

export interface ReaderTab {
  info: DocumentInfo;
  pane: HTMLDivElement;
  container: HTMLDivElement;
  bus: EventBus;
  viewer: PDFViewer;
  links: PDFLinkService;
  find: PDFFindController;
  task: PDFDocumentLoadingTask;
  pdf?: PDFDocumentProxy;
  bookmarks: Bookmark[];
  outline?: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>;
  disposed: boolean;
  query: string;
  matchCase: boolean;
  matchCount: {
    state: 'idle' | 'searching' | 'no-results' | 'matches';
    current: number;
    total: number;
  };
  canPrint: boolean;
  rendered: boolean;
  positionTimer?: ReturnType<typeof setTimeout>;
}

export const tabs: ReaderTab[] = [];

let activeTab: ReaderTab | undefined;

export function getActiveTab() {
  return activeTab;
}

export function setActiveTab(tab?: ReaderTab) {
  activeTab = tab;
}

export const state = {
  sidebarMode: 'pages' as 'pages' | 'outline' | 'bookmarks' | 'search',
  thumbnailObserver: undefined as IntersectionObserver | undefined,
  thumbnailGroup: -1,
  sidebarVersion: 0,
  pendingPassword: undefined as { tab: ReaderTab; update: (password: string) => void } | undefined,
  opening: Promise.resolve(),
};
