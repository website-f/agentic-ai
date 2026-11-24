import type { PdfTextPiece } from '@prima/core';

declare const __DEMO__: boolean;

/**
 * P129 (Fitri, 24 Nov 2026: "make it read the pdf ... combine with OCR"): a scanned or printed-to-picture PDF has no
 * text to read, only pictures of pages. Each page is drawn on this device with the PDF reader (pdf.js) and read with
 * the same OCR as receipts (Tesseract, its LSTM neural network, files served from this site). Every word comes back
 * with its box; words close together on one line become one piece, and the pieces are handed to the same position-based
 * table reader as a text PDF, so the columns, the heading and the people's lines are found the same way. Nothing leaves
 * the device: salary sheets are never sent anywhere to be read.
 */

const SCALE = 3.2; // about 230 dpi for a page drawn at 72 points to the inch: small figures and joined words read better
const MAX_PAGES = 20;

export type OcrProgress = (msg: string) => void;

export async function ocrPdfPieces(bytes: Uint8Array, progress?: OcrProgress, timeoutMs = 240_000): Promise<PdfTextPiece[]> {
  if (__DEMO__) return [];
  const pdfBase = new URL(`${import.meta.env.BASE_URL}pdf/`, location.href).href;
  const ocrBase = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href;
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `${pdfBase}pdf.worker.min.mjs`;
  // pdf.js may detach the buffer it is given: give it a copy.
  const task = pdfjs.getDocument({ data: bytes.slice(), wasmUrl: `${pdfBase}wasm/`, stopAtErrors: false });
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    workerPath: `${ocrBase}worker.min.js`,
    corePath: ocrBase,
    langPath: `${ocrBase}lang`,
    workerBlobURL: false,
    gzip: true,
  });
  const until = Date.now() + timeoutMs;
  try {
    // A table: keep the spaces between columns and read the page as one block of lines.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1', user_defined_dpi: '230' });
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const out: PdfTextPiece[] = [];
    for (let n = 1; n <= pages; n++) {
      if (Date.now() > until) throw new Error('Reading the scanned pages took too long. Try a clearer scan, or fewer pages.');
      progress?.(`Reading scanned page ${n} of ${pages} (OCR on this device)…`);
      const page = await doc.getPage(n);
      const view = page.getViewport({ scale: SCALE, rotation: page.rotate });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(view.width);
      canvas.height = Math.ceil(view.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('This browser cannot draw the PDF pages.');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: view, canvas } as Parameters<typeof page.render>[0]).promise;
      page.cleanup();
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
      const H = canvas.height;
      for (const block of data.blocks ?? [])
        for (const para of block.paragraphs)
          for (const line of para.lines) {
            // Stray marks (lines of the table, specks) read as "~", "|" or "_" are dropped; a word keeps its letters,
            // digits and the signs figures and names use.
            const words = line.words
              .map((w) => ({ ...w, text: w.text.replace(/[^\p{L}\p{N}.,'()/@&-]/gu, '').trim() }))
              .filter((w) => /[\p{L}\p{N}]/u.test(w.text) && w.confidence >= 5);
            if (!words.length) continue;
            // One y for the whole line (its baseline), so its words stay on one line of the table.
            const base = line.baseline?.y0 != null && line.baseline.y1 != null ? (line.baseline.y0 + line.baseline.y1) / 2 : line.bbox.y1;
            const h = Math.max(4, line.rowAttributes?.row_height || line.bbox.y1 - line.bbox.y0);
            // Words close together are one phrase (a name, "GAJI POKOK"); a wide gap starts the next column.
            let cur: { x0: number; x1: number; text: string } | null = null;
            const flush = () => {
              if (!cur) return;
              out.push({ x: cur.x0 / SCALE, right: cur.x1 / SCALE, y: (H - base) / SCALE, size: h / SCALE, text: cur.text, page: n - 1 });
              cur = null;
            };
            for (const w of words) {
              const gap = cur ? w.bbox.x0 - cur.x1 : Infinity;
              const numeric = /^[-(]?(RM)?[\d,]*\.?\d+\)?$/i.test(w.text.trim());
              if (cur && gap < h * 0.7 && !numeric && !/^[-(]?(RM)?[\d,]*\.?\d+\)?$/i.test(cur.text.trim())) {
                cur.x1 = w.bbox.x1;
                cur.text += ` ${w.text.trim()}`;
              } else {
                flush();
                cur = { x0: w.bbox.x0, x1: w.bbox.x1, text: w.text.trim() };
              }
            }
            flush();
          }
      canvas.width = canvas.height = 0;
    }
    return out;
  } finally {
    await worker.terminate().catch(() => undefined);
    await task.destroy().catch(() => undefined);
  }
}

/** The text pieces of a PDF through pdf.js (a text PDF Prima's own small reader cannot open: other encodings, fonts). */
export async function pdfTextPieces(bytes: Uint8Array): Promise<PdfTextPiece[]> {
  if (__DEMO__) return [];
  const base = new URL(`${import.meta.env.BASE_URL}pdf/`, location.href).href;
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: bytes.slice(), wasmUrl: `${base}wasm/`, disableFontFace: true, stopAtErrors: false });
  try {
    const doc = await task.promise;
    const out: PdfTextPiece[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 60); n++) {
      const page = await doc.getPage(n);
      for (const it of (await page.getTextContent()).items)
        if ('str' in it && it.str.trim()) {
          const x = Number(it.transform[4]) || 0;
          const size = Math.abs(Number(it.transform[3])) || Number(it.height) || 8;
          out.push({ x, y: Number(it.transform[5]) || 0, right: x + (Number(it.width) || it.str.length * size * 0.5), size, text: it.str, page: n - 1 });
        }
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/**
 * A table from a PDF any way it can be had, after Prima's own reader found none: pdf.js's text, then OCR of the pages.
 * `enough` says whether a table is usable. Empty when nothing worked.
 */
export async function pdfTableAnyWay(bytes: Uint8Array, toTable: (p: PdfTextPiece[]) => string[][], enough: (rows: string[][]) => boolean, progress?: OcrProgress): Promise<string[][]> {
  const text = toTable(await pdfTextPieces(bytes).catch(() => []));
  if (enough(text)) return text;
  return toTable(await ocrPdfPieces(bytes, progress).catch(() => []));
}
