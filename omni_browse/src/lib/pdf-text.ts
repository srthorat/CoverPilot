// Reads the text of a policy PDF in the browser. The file itself is never uploaded: only text, with
// identity-number patterns masked (mask-text.ts), goes on to the voice agent's session, and the agent
// then receives only the few passages that match each question.

import { maskIdentityNumbers } from './mask-text';

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_PAGES = 120;

export interface PolicyPage {
  page: number;
  text: string;
}

export async function extractPolicyPages(file: File): Promise<{ pages: PolicyPage[]; masked: number }> {
  if (file.size > MAX_PDF_BYTES) throw new Error('That PDF is over 15 MB.');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  if (doc.numPages > MAX_PDF_PAGES) throw new Error(`That PDF has ${doc.numPages} pages; the limit is ${MAX_PDF_PAGES}.`);
  const pages: PolicyPage[] = [];
  let masked = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    let line = '';
    const lines: string[] = [];
    let lastY: number | null = null;
    for (const item of content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform?.[5] ?? null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && line) {
        lines.push(line);
        line = '';
      }
      line += item.str + (item.hasEOL ? '' : ' ');
      lastY = y;
    }
    if (line) lines.push(line);
    const m = maskIdentityNumbers(lines.join('\n').replace(/[ \t]+/g, ' ').trim());
    masked += m.masked;
    if (m.text) pages.push({ page: n, text: m.text });
  }
  const chars = pages.reduce((sum, p) => sum + p.text.length, 0);
  if (chars < 200) throw new Error('This PDF has no selectable text. Scanned PDFs are not supported.');
  return { pages, masked };
}
