import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Two builds from one code base:
//  - default: the installable PWA that talks to the API (VITE_API_URL)
//  - demo:    one self-contained HTML file that runs the same business code in the
//             browser on mock data, for review without a server
/**
 * The server-connected build must know where the API is: without it every call would go to the website itself, which
 * answers with the app page instead of data. Only http://localhost is allowed besides HTTPS.
 */
function checkApiUrl(command: string, mode: string): void {
  if (command !== 'build' || mode === 'demo') return;
  const url = process.env.VITE_API_URL ?? '';
  if (!url && process.env.VITE_ALLOW_SAME_ORIGIN_API === 'true') return;
  // Agentic Office: the API on the same site under its own path (e.g. /api/prima), no host.
  if (/^\/[a-z0-9_-]+(\/[a-z0-9_-]+)*$/i.test(url) && process.env.VITE_ALLOW_SAME_ORIGIN_API === 'true') return;
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url) && !/^http:\/\/localhost(:\d+)?$/.test(url))
    throw new Error('Set VITE_API_URL to the API address (https://..., no trailing slash) for a server build, or build the test version with --mode demo.');
}

/**
 * Receipts are read on the phone (Fauzan, 2 Nov 2026: "Read on the phone, free"). The text reader (Tesseract, Apache-2.0)
 * and its English model are served from this website, not a third-party CDN, and are fetched only when someone scans a
 * receipt. The photo never leaves the phone for reading. Not in the single-file test build, which reads file names.
 */
function receiptReaderFiles(): Plugin {
  const req = createRequire(import.meta.url);
  const pkg = (name: string) => dirname(req.resolve(`${name}/package.json`));
  const files: [string, string][] = [
    ['ocr/worker.min.js', join(pkg('tesseract.js'), 'dist/worker.min.js')],
    ['ocr/tesseract-core-simd-lstm.wasm.js', join(pkg('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js')],
    ['ocr/tesseract-core-lstm.wasm.js', join(pkg('tesseract.js-core'), 'tesseract-core-lstm.wasm.js')],
    ['ocr/lang/eng.traineddata.gz', join(pkg('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz')],
  ];
  return {
    name: 'prima-receipt-reader-files',
    apply: 'build',
    generateBundle() {
      for (const [fileName, from] of files) this.emitFile({ type: 'asset', fileName, source: readFileSync(from) });
    },
  };
}

/**
 * P85: the camera barcode reader for phones and PCs without a built-in one (iPhone, Windows, Firefox). ZXing-C++ as
 * WebAssembly (zxing-wasm, MIT) is served from this website as zxing/zxing_reader.wasm, never from a CDN, and is
 * fetched only the first time a camera scan needs it. Not in the single-file test build (typed entry or the
 * browser's own reader there).
 */
function barcodeReaderFiles(): Plugin {
  const req = createRequire(import.meta.url);
  return {
    name: 'prima-barcode-reader-files',
    apply: 'build',
    generateBundle() {
      // The package exports the .wasm file itself; it is copied as it is, byte for byte.
      this.emitFile({ type: 'asset', fileName: 'zxing/zxing_reader.wasm', source: readFileSync(req.resolve('zxing-wasm/reader/zxing_reader.wasm')) });
    },
  };
}

export default defineConfig(({ command, mode }) => (checkApiUrl(command, mode), {
  // Agentic Office serves Prima under a sub-path (PRIMA_BASE=/prima/); the default is the site root.
  base: mode === 'demo' ? './' : process.env.PRIMA_BASE || '/',
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [receiptReaderFiles(), barcodeReaderFiles()])],
  resolve: {
    alias: { '@prima/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
  },
  define: { __DEMO__: JSON.stringify(mode === 'demo') },
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist', chunkSizeWarningLimit: 2000 },
  server: { proxy: { '/api': 'http://localhost:3000' } },
}));
