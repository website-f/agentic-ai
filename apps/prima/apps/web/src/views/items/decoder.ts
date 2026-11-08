// Reading QR and Code 128 from the camera (P85; design section 4).
// 1. The browser's own BarcodeDetector, when it reads both QR and Code 128 (Chrome on Android, ChromeOS, macOS).
// 2. Otherwise ZXing-C++ as WebAssembly (zxing-wasm 3.1.6, MIT), loaded only the first time it is needed (iPhone,
//    Windows and Linux PCs, Firefox). Its .wasm file is served from this website (zxing/zxing_reader.wasm, copied by the
//    Vite build), never from a CDN: the default would fetch it from jsDelivr, which the CSP blocks.
// The single-file test build has no .wasm next to it: there the browser's reader or typed entry is used.
declare const __DEMO__: boolean;

export interface Decoder {
  kind: 'native' | 'zxing';
  /** The codes seen in the current video frame (raw text; the caller checks each one before using it). */
  detect(video: HTMLVideoElement): Promise<string[]>;
}

type NativeDetector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type NativeCtor = (new (o: { formats: string[] }) => NativeDetector) & { getSupportedFormats?: () => Promise<string[]> };

/** Where the reader's .wasm is: next to the app, under its base path (e.g. /prima/zxing/zxing_reader.wasm). */
export function zxingWasmUrl(base: string = import.meta.env.BASE_URL ?? '/'): string {
  return `${base.endsWith('/') ? base : `${base}/`}zxing/zxing_reader.wasm`;
}

/** The locateFile override: every .wasm comes from this website. Exported for the test that it never leaves it. */
export function locateFile(path: string, prefix: string): string {
  return path.endsWith('.wasm') ? zxingWasmUrl() : prefix + path;
}

/** Use the browser's own reader only when it reads both formats. */
export async function nativeDecoder(w: { BarcodeDetector?: NativeCtor } = window as unknown as { BarcodeDetector?: NativeCtor }): Promise<Decoder | null> {
  const Ctor = w.BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = Ctor.getSupportedFormats ? await Ctor.getSupportedFormats() : [];
    if (!formats.includes('qr_code') || !formats.includes('code_128')) return null;
    const d = new Ctor({ formats: ['qr_code', 'code_128'] });
    return { kind: 'native', detect: async (v) => (await d.detect(v)).map((x) => x.rawValue) };
  } catch {
    return null;
  }
}

let zxing: Promise<Decoder> | null = null;

/** The WebAssembly reader, prepared once. Decodes the middle of the frame, at most 1280 pixels wide. */
function zxingDecoder(): Promise<Decoder> {
  return (zxing ??= (async () => {
    const z = await import('zxing-wasm/reader');
    await z.prepareZXingModule({ overrides: { locateFile }, fireImmediately: true });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No canvas');
    return {
      kind: 'zxing' as const,
      async detect(v: HTMLVideoElement) {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) return [];
        const sw = Math.round(w * 0.7);
        const sh = Math.round(h * 0.7);
        const scale = Math.min(1, 1280 / sw);
        canvas.width = Math.round(sw * scale);
        canvas.height = Math.round(sh * scale);
        ctx.drawImage(v, Math.round((w - sw) / 2), Math.round((h - sh) / 2), sw, sh, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = await z.readBarcodes(img, { formats: ['QRCode', 'Code128'], tryHarder: true, maxNumberOfSymbols: 1 });
        return found.filter((x) => x.isValid && x.text).map((x) => x.text);
      },
    };
  })().catch((e) => {
    zxing = null;
    throw e;
  }));
}

let best: Promise<Decoder | null> | null = null;

/**
 * The best reader this phone or PC has, or null (type the ID or use a handheld scanner instead). Prepared once and kept:
 * opening the camera again does not load anything again. A failed load is tried again next time.
 */
export function makeDecoder(): Promise<Decoder | null> {
  return (best ??= (async () => {
    const native = await nativeDecoder();
    if (native) return native;
    if (__DEMO__) return null;
    try {
      return await zxingDecoder();
    } catch {
      best = null;
      return null;
    }
  })());
}

/**
 * P90: start preparing the reader before the camera is opened (the scan screens call it when they show), so the camera
 * never waits for the reader's file. Costs nothing where the browser has its own reader.
 */
export function prewarmDecoder(): void {
  void makeDecoder();
}
