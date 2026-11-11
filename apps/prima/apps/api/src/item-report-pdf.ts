// P98 (Fitri, 11 Nov 2026: "Import to import the whole file (Excel, CSV, PDF)"): an item list or stock report saved as
// PDF, read on the server with pdfjs-dist, which gives each piece of text with its place on the page and its width.
// The core (item-report.ts reportFromPdf) rebuilds the table from those places: the header line and its columns, the
// lines that only carry the rest of a wrapped code, the group headings, the supplier cost lines, the item headings of
// a stock card, and what is printed on every page (title, company, date, "Page N of M") left out. Nothing is saved: the
// table goes back to the person's screen to check, and each item is imported through the Items screen's own actions.
// A scanned paper is a picture: it has no text, and the person is told so.

import { reportFromPdf, type PdfPageText, type ReportTable } from '@prima/core';

interface TextItem {
  str?: string;
  transform?: number[];
  width?: number;
}
interface PdfPage {
  getTextContent(): Promise<{ items: TextItem[] }>;
  cleanup(): void;
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
interface PdfJs {
  getDocument(o: Record<string, unknown>): { promise: Promise<PdfDoc> };
}

/** The longest report read at once (the real stock card is 160 pages). */
export const ITEM_PDF_MAX_PAGES = 400;
/** The largest PDF accepted (sent as base64 within the API's 3 MB request limit). */
export const ITEM_PDF_MAX_BYTES = 2_200_000;

let pdfjs: Promise<PdfJs> | null = null;
/** pdfjs-dist is an ES module; the indirect import keeps it a real dynamic import in this CommonJS build. */
function loadPdfJs(): Promise<PdfJs> {
  const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<PdfJs>;
  return (pdfjs ??= dynamicImport('pdfjs-dist/legacy/build/pdf.mjs'));
}

export class ItemPdfError extends Error {}

/** The text pieces of each page with their places (x, y from the bottom left, width, font size). */
export async function pdfPieces(bytes: Uint8Array): Promise<PdfPageText[]> {
  if (bytes.length > ITEM_PDF_MAX_BYTES) throw new ItemPdfError('The PDF is too large to read at once (over 2 MB). Print the report in parts, or export it to Excel.');
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new ItemPdfError('This file is not a PDF.');
  const lib = await loadPdfJs();
  let doc: PdfDoc;
  try {
    doc = await lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, disableAutoFetch: true, stopAtErrors: false, verbosity: 0 }).promise;
  } catch {
    throw new ItemPdfError('This PDF could not be opened. Save the report as PDF again, or export it to Excel.');
  }
  try {
    if (doc.numPages > ITEM_PDF_MAX_PAGES) throw new ItemPdfError(`The PDF has ${doc.numPages} pages; at most ${ITEM_PDF_MAX_PAGES} are read at once. Print the report in parts.`);
    const pages: PdfPageText[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const { items } = await page.getTextContent();
      pages.push({
        pieces: items
          .filter((i) => typeof i.str === 'string' && i.str.trim() && Array.isArray(i.transform))
          .map((i) => {
            const t = i.transform!;
            return { x: t[4], y: t[5], w: Number(i.width) || 0, size: Math.hypot(t[2], t[3]) || Math.abs(t[0]) || 8, text: i.str! };
          }),
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

/** A report PDF to the table the screen shows for checking. */
export async function readItemReportPdf(bytes: Uint8Array): Promise<ReportTable> {
  const pages = await pdfPieces(bytes);
  if (!pages.some((p) => p.pieces.length)) throw new ItemPdfError('No text could be read from this PDF. A scanned paper is a picture: ask for the report as a PDF from the system, or as Excel.');
  const table = reportFromPdf(pages);
  if (!table.header.length || !table.rows.length) throw new ItemPdfError('No item table was found in this PDF: no line names item columns (Item Code, Description, Qty, UOM...). Export the report to Excel, or check it is the right file.');
  return table;
}
