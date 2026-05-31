import { existsSync, readFileSync } from 'fs';

// PDF text extraction using pdfjs-dist legacy build (works in Node without canvas).
// We lazily load pdfjs-dist to avoid slowing down non-PDF operations.

let pdfjsLib: any = null;

async function getPdfjs(): Promise<any> {
  if (!pdfjsLib) {
    // Use the legacy build which works in Node without canvas
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLib;
}

export interface PdfPageText {
  page: number;
  text: string;
}

/** Extract text from all pages of a PDF file */
export async function extractPdfText(filePath: string): Promise<PdfPageText[]> {
  if (!existsSync(filePath)) {
    throw new Error(`PDF file not found: ${filePath}`);
  }

  const data = new Uint8Array(readFileSync(filePath));
  const pdfjs = await getPdfjs();

  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: PdfPageText[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => item.str ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push({ page: i, text });
  }

  return pages;
}

/** Extract full text of a PDF concatenated with page markers */
export async function extractPdfFullText(filePath: string): Promise<string> {
  const pages = await extractPdfText(filePath);
  return pages.map(p => `\f${p.text}`).join('\n').trim();
}
