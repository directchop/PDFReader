import { cp, mkdir } from 'node:fs/promises';
await mkdir('public/pdfjs', { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(`node_modules/pdfjs-dist/${dir}`, `public/pdfjs/${dir}`, { recursive: true });
}
await cp('node_modules/pdfjs-dist/LICENSE', 'public/pdfjs/LICENSE');
await cp('node_modules/pdfjs-dist/web/images', 'public/pdfjs/images', { recursive: true });
