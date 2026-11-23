import {
  KEY_IN_FILE_RULE,
  keyInFileWords,
  keyInPdfLines,
  keyInPdfPageIsPicture,
  type KeyInFileKind,
  type KeyInFileProblem,
  type KeyInInflate,
  type KeyInPdfItem,
} from '@prima/core';
import { readWordsOnPhone } from './ocr';

declare const __DEMO__: boolean;

/**
 * The words of any kind of document, read on the person's own phone or computer (Fauzan, 23 Nov 2026: "Make it read
 * all type of document"). The file is not uploaded to be read. Photos and scans go through the phone's text reader;
 * a PDF gives its own text and its picture pages are read like photos; Word, Excel, PowerPoint, OpenDocument, text,
 * CSV, web page, RTF and email files are opened by the rules in @prima/core (key-in-files.ts).
 */
export interface PaperWords {
  kind: KeyInFileKind;
  words: string | null;
  /** Why nothing was read, so the screen can tell the person what to do. 'unreadable' is a blurry or blank paper. */
  problem: KeyInFileProblem | 'unreadable' | null;
}

/** Unpacks one part of a Word or Excel file with the browser's own unzip, stopping at `max` bytes. */
const inflate: KeyInInflate = async (data, max) => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error('too big');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const dataUrlOf = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** A photo the text reader takes as it is (JPEG, PNG), or any other picture the browser can open, redrawn as PNG. */
async function photoDataUrl(file: Blob): Promise<string | null> {
  if (/^image\/(jpeg|png)$/.test(file.type)) return dataUrlOf(file);
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** PDF: each page's own text as printed lines; a page that is only a picture (a scan) is read like a photo. */
async function pdfWords(bytes: Uint8Array): Promise<{ words: string | null; locked: boolean }> {
  const base = new URL(`${import.meta.env.BASE_URL}pdf/`, location.href).href;
  const pdfjs = await import('pdfjs-dist');
  // The PDF reader (pdf.js, Apache-2.0) is served from this website, like the text reader; nothing is fetched elsewhere.
  pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: bytes, wasmUrl: `${base}wasm/`, disableFontFace: true, stopAtErrors: false });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    let pictures = 0;
    for (let n = 1; n <= Math.min(doc.numPages, KEY_IN_FILE_RULE.maxPdfPages); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: KeyInPdfItem[] = [];
      for (const it of content.items) if ('str' in it) items.push({ str: it.str, x: Number(it.transform[4]) || 0, y: Number(it.transform[5]) || 0, h: it.height });
      let text = keyInPdfLines(items);
      if (keyInPdfPageIsPicture(text) && pictures < KEY_IN_FILE_RULE.maxPdfPicturePages) {
        pictures++;
        const first = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2.5, 2400 / Math.max(first.width, first.height)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport, background: '#ffffff' }).promise;
        text = (await readWordsOnPhone(canvas.toDataURL('image/png'))) ?? '';
        canvas.width = canvas.height = 0;
      }
      if (text.trim()) pages.push(text.trim());
      page.cleanup();
    }
    const words = pages.join('\n\n');
    return { words: words.trim() ? words : null, locked: false };
  } catch (e) {
    return { words: null, locked: (e as { name?: string } | null)?.name === 'PasswordException' };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

export async function readPaperWords(file: File): Promise<PaperWords> {
  if (file.size > KEY_IN_FILE_RULE.maxFileBytes) return { kind: 'unknown', words: null, problem: 'too-big' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const read = await keyInFileWords(bytes, file.name, file.type, inflate);
  if (!read.next) return { kind: read.kind, words: read.words, problem: read.problem };
  // The single-file test build carries no text reader or PDF reader: photos and PDFs are typed in there.
  if (__DEMO__) return { kind: read.kind, words: null, problem: 'unreadable' };
  if (read.next === 'photo') {
    const url = await photoDataUrl(file);
    const words = url ? await readWordsOnPhone(url) : null;
    return { kind: read.kind, words, problem: words ? null : 'unreadable' };
  }
  const pdf = await pdfWords(bytes).catch(() => ({ words: null, locked: false }));
  return { kind: read.kind, words: pdf.words, problem: pdf.words ? null : pdf.locked ? 'locked' : 'unreadable' };
}
