import { PDFDataRangeTransport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readRange, type DocumentInfo } from './bridge';

export class LocalPdfTransport extends PDFDataRangeTransport {
  private stopped = false;
  constructor(private info: DocumentInfo, private failed: (error: unknown) => void) {
    super(info.size, new Uint8Array(), true);
  }
  requestDataRange(begin: number, end: number) {
    void this.read(begin, end).catch(error => { if (!this.stopped) this.failed(error); });
  }
  private async read(begin: number, end: number) {
    const bytes = new Uint8Array(end - begin);
    for (let offset = begin; offset < end; offset += 1024 * 1024) {
      if (this.stopped) return;
      bytes.set(await readRange(this.info.id, offset, Math.min(end, offset + 1024 * 1024)), offset - begin);
    }
    if (!this.stopped) this.onDataRange(begin, bytes);
  }
  abort() { this.stopped = true; }
}
