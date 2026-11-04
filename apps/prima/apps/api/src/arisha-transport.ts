/** Pure policy for the Azure OpenAI endpoint family already supported by extraction. */
export function azureOpenAiEndpoint(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.openai\.azure\.com$/i.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

export class ArishaTimeout extends Error {
  constructor() { super('Arisha could not answer within the time limit.'); }
}

/** Reject even if an injected provider ignores abort; always clear timers/listeners. No retries. */
export async function withinArishaBudget<T>(milliseconds: number, work: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectTimeout: (error: Error) => void = () => {};
  const expired = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const abort = () => { controller.abort(); rejectTimeout(new ArishaTimeout()); };
  parent?.addEventListener('abort', abort, { once: true });
  timer = setTimeout(abort, milliseconds);
  try {
    if (parent?.aborted) abort();
    const pending = Promise.resolve().then(() => { checkArishaBudget(controller.signal); return work(controller.signal); });
    return await Promise.race([pending, expired]);
  } finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); }
}
export function checkArishaBudget(signal: AbortSignal): void { if (signal.aborted) throw new ArishaTimeout(); }

/** Streamed byte cap; the surrounding budget also covers stalled response bodies. */
export async function arishaJson(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error('Arisha received an invalid response.');
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    void response.body.cancel().catch(() => {});
    throw new Error('Arisha received an invalid response.');
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    checkArishaBudget(signal);
    while (true) {
      const part = await reader.read();
      checkArishaBudget(signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { cancel(); throw new Error('Arisha received an invalid response.'); }
      chunks.push(part.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Arisha received an invalid response.'); }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
