// A PDF of an ID card or salary slip (e-Aadhaar, e-PAN, a payslip) is turned into one PNG, in the browser, and from
// there it goes through the same blur-first privacy shield as a photo. The PDF itself is never uploaded.
//
// Only a single-page, unprotected PDF is accepted: a password-protected file cannot be drawn, and a multi-page
// file would need a guess about which page holds the ID, so both are refused with a plain message.

export const MAX_ID_PDF_BYTES = 15 * 1024 * 1024;
/** Width the first page is drawn at. The app then fits it into its 1000 x 1400 working size, so a full page and a
 *  card end up with text of a similar size, which is what the blur widths were measured for. */
export const ID_PDF_TARGET_WIDTH = 1400;

export type IdPdfProblem = 'too-large' | 'password' | 'multi-page' | 'empty' | 'unreadable';

export const ID_PDF_MESSAGES: Record<IdPdfProblem, string> = {
  'too-large': 'That PDF is over 15 MB. Use a smaller file, or a photo of the card.',
  password: 'This PDF is password-protected, so it cannot be read here. Save a copy without the password, or use a photo.',
  'multi-page': 'This PDF has more than one page. Use a one-page PDF or crop it to the page with the card or slip.',
  empty: 'This PDF has no pages.',
  unreadable: 'That PDF could not be opened. Try a photo (PNG or JPEG) of the card instead.',
};

export class IdPdfError extends Error {
  problem: IdPdfProblem;
  constructor(problem: IdPdfProblem) {
    super(ID_PDF_MESSAGES[problem]);
    this.problem = problem;
  }
}

/** Page-count rule, kept pure so it can be tested without a PDF. */
export function pageCountProblem(numPages: number): IdPdfProblem | null {
  if (!Number.isFinite(numPages) || numPages < 1) return 'empty';
  if (numPages > 1) return 'multi-page';
  return null;
}

/** Drawing scale that makes a page of `pageWidth` points `targetWidth` px wide, kept within a sane range. */
export function rasterScale(pageWidth: number, targetWidth = ID_PDF_TARGET_WIDTH): number {
  if (!(pageWidth > 0)) return 1;
  return Math.min(4, Math.max(0.5, targetWidth / pageWidth));
}

export async function rasterizeIdPdf(file: File): Promise<Blob> {
  if (file.size > MAX_ID_PDF_BYTES) throw new IdPdfError('too-large');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (e: any) {
    throw new IdPdfError(e?.name === 'PasswordException' ? 'password' : 'unreadable');
  }
  try {
    const problem = pageCountProblem(doc.numPages);
    if (problem) throw new IdPdfError(problem);
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: rasterScale(page.getViewport({ scale: 1 }).width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new IdPdfError('unreadable');
    return blob;
  } finally {
    void doc.destroy();
  }
}
