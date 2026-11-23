import { parseReceiptText, type ReceiptRead } from '@prima/core';

declare const __DEMO__: boolean;

/**
 * Reads a receipt photo on the phone (Fauzan, 2 Nov 2026: "Read on the phone, free"). Tesseract runs in the browser from
 * files on this website (see vite.config.ts); the photo is not sent anywhere to be read. The words are turned into a
 * date, total, shop and kind by the same rules the server uses, and the staff member checks them before claiming.
 * Returns null when the phone cannot read it (old phone, blurry photo, files not reachable); staff then type the figures.
 */
/**
 * The words of a paper photo, read on the phone (free; the photo is not sent anywhere to be read). Null when the phone
 * cannot read it (old phone, blurry photo, files not reachable); the person then types the values.
 */
export async function readWordsOnPhone(dataUrl: string, timeoutMs = 60_000): Promise<string | null> {
  if (__DEMO__ || !/^data:image\/(jpeg|png)/.test(dataUrl)) return null;
  const base = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href;
  const held: { worker: { terminate: () => Promise<unknown> } | null } = { worker: null };
  const work = (async () => {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: `${base}lang`,
      workerBlobURL: false,
      gzip: true,
    });
    held.worker = worker;
    const { data } = await worker.recognize(dataUrl);
    return data.text;
  })();
  // The reader is closed when it finishes, even after a timeout.
  void work.finally(() => held.worker?.terminate().catch(() => undefined)).catch(() => undefined);
  try {
    const text = await Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
    return text && text.trim() ? text : null;
  } catch {
    return null;
  }
}

export async function readReceiptOnPhone(dataUrl: string, now: string, timeoutMs = 60_000): Promise<ReceiptRead | null> {
  const text = await readWordsOnPhone(dataUrl, timeoutMs);
  if (!text) return null;
  const read = parseReceiptText(text, now, 'phone');
  return read.amount == null && read.date == null ? null : read;
}
