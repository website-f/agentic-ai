import { parseReceiptText, type ReceiptRead } from '@prima/core';

declare const __DEMO__: boolean;

/**
 * Reads a receipt photo on the phone (Fauzan, 2 Nov 2026: "Read on the phone, free"). Tesseract runs in the browser from
 * files on this website (see vite.config.ts); the photo is not sent anywhere to be read. The words are turned into a
 * date, total, shop and kind by the same rules the server uses, and the staff member checks them before claiming.
 * Returns null when the phone cannot read it (old phone, blurry photo, files not reachable); staff then type the figures.
 */
export async function readReceiptOnPhone(dataUrl: string, now: string, timeoutMs = 60_000): Promise<ReceiptRead | null> {
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
    if (!text || !text.trim()) return null;
    const read = parseReceiptText(text, now, 'phone');
    return read.amount == null && read.date == null ? null : read;
  } catch {
    return null;
  }
}
