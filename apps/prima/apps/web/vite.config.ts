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
  // The PDF reader (pdf.js, Apache-2.0) for the key-in helper: its worker, and the decoders scanned PDFs need.
  files.push(['pdf/pdf.worker.min.mjs', join(pkg('pdfjs-dist'), 'build/pdf.worker.min.mjs')]);
  for (const f of ['jbig2.wasm', 'jbig2_nowasm_fallback.js', 'openjpeg.wasm', 'openjpeg_nowasm_fallback.js', 'qcms_bg.wasm'])
    files.push([`pdf/wasm/${f}`, join(pkg('pdfjs-dist'), 'wasm', f)]);
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

/**
 * P122 (speed): the server-connected build never runs the in-browser test backend (api/demo.ts and, through it, the
 * whole of @prima/core's services), but a static import kept it all in the first file people download (7.6 MB). Outside
 * the demo build the import resolves to an empty stand-in, so the app loads only the small rule helpers it uses.
 */
const NO_DEMO = '\0prima-no-demo';
function noDemoBackend(): Plugin {
  return {
    name: 'prima:no-demo-backend',
    enforce: 'pre',
    resolveId(id, importer) {
      return id === './demo' && importer && /[\\/]src[\\/]api[\\/]index\.ts$/.test(importer) ? NO_DEMO : null;
    },
    load(id) {
      return id === NO_DEMO ? 'export class DemoApi { constructor() { throw new Error("The test backend is only in the demo build."); } }' : null;
    },
  };
}

export default defineConfig(({ command, mode }) => (checkApiUrl(command, mode), {
  // Agentic Office serves Prima under a sub-path (PRIMA_BASE=/prima/); the default is the site root.
  base: mode === 'demo' ? './' : process.env.PRIMA_BASE || '/',
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [noDemoBackend(), receiptReaderFiles(), barcodeReaderFiles()])],
  resolve: {
    alias: { '@prima/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
  },
  define: { __DEMO__: JSON.stringify(mode === 'demo') },
  // Keep class static fields as written (every current phone browser has them; iOS 14.1+). Rewritten, they read as
  // work done on loading, which made the bundler keep the whole server-side business code in the phone app although
  // the app never runs it (whole-app review: 9.6 MB down to 1.5 MB for the first download, 23 Nov 2026).
  esbuild: { supported: { 'class-static-field': true } },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    chunkSizeWarningLimit: 2000,
    // P122 (speed): the parts that rarely change (React and the translations) are their own files, so after an
    // update a returning person downloads only what changed, not the whole app again. (Icons stay with the screens that use
    // them: one icons file would carry every screen's icons.)
    rollupOptions:
      mode === 'demo'
        ? {}
        : {
            output: {
              manualChunks(id: string) {
                const p = id.replace(/\\/g, '/');
                if (/\/node_modules\/(react|react-dom|scheduler)\//.test(p)) return 'react';
                if (p.endsWith('/src/i18n.ts')) return 'i18n';
                return undefined;
              },
            },
          },
  },
  server: { proxy: { '/api': 'http://localhost:3000' } },
}));
