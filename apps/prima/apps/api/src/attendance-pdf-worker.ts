// P90: a worker thread that reads the text of a run of pages of an attendance report PDF (attendance-pdf.ts). It only
// turns each page into lines of words and sends them back; the main thread reads the lines in page order. Nothing is
// kept here, and the thread ends when its pages are done.
import { parentPort, workerData } from 'node:worker_threads';
import { extractPageLines } from './attendance-pdf';

const job = workerData as { bytes: Uint8Array; from: number; to: number };

extractPageLines(job.bytes, job.from, job.to, (n, lines) => parentPort?.postMessage({ n, lines }))
  .then(() => parentPort?.postMessage({ done: true }))
  .catch((e: unknown) => parentPort?.postMessage({ error: e instanceof Error ? e.message : String(e) }));
