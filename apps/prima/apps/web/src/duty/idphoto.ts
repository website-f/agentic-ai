/**
 * The visitor's IC or licence from the phone camera (Fauzan, 6 Nov 2026: "Ic reader will prepare later, if possible
 * just photo to read ic from picture is enough. Use phone camera to do all this first.").
 *
 * The picture is made smaller on the phone, then sealed for the in-house server with the full number; Prima never keeps
 * it readable. Where the phone's browser can read text from a picture (TextDetector), the number is filled in for the
 * guard to check; otherwise the guard reads it from the picture on screen and types it.
 */

/** Makes a picture smaller as a JPEG data URL, so it can be sealed and sent over a weak signal. */
export async function shrinkImage(src: Blob | string, maxPx: number, quality: number): Promise<string> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This picture cannot be opened. Take it again.'));
      i.src = url;
    });
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}

const MYKAD = /\b(\d{6})[-\s]?(\d{2})[-\s]?(\d{4})\b/;

/** Reads the IC number from the picture where the browser can; null means the guard reads and types it. */
export async function readIdNumber(dataUrl: string): Promise<string | null> {
  const TD = (window as unknown as { TextDetector?: new () => { detect: (s: ImageBitmapSource) => Promise<{ rawValue: string }[]> } }).TextDetector;
  if (!TD) return null;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const found = await new TD().detect(bmp);
    const m = found.map((f) => f.rawValue).join(' ').match(MYKAD);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  } catch {
    return null;
  }
}

export const canReadText = () => typeof window !== 'undefined' && 'TextDetector' in window;

/** Test version only: a drawn sample card, clearly marked, standing in for a photographed IC. */
export function sampleCardImage(name: string, idNumber: string, kind: string): string {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 400;
  const g = c.getContext('2d')!;
  g.fillStyle = '#dfe9f3';
  g.fillRect(0, 0, 640, 400);
  g.fillStyle = '#9aa9b8';
  g.fillRect(40, 110, 170, 210);
  g.fillStyle = '#1d2b3a';
  g.font = 'bold 26px sans-serif';
  g.fillText(`SAMPLE ${kind.toUpperCase()} - TEST ONLY`, 40, 64);
  g.font = 'bold 34px monospace';
  g.fillText(idNumber, 240, 170);
  g.font = '28px sans-serif';
  g.fillText(name.toUpperCase(), 240, 240);
  g.font = '18px sans-serif';
  g.fillText('Not a real document', 240, 300);
  return c.toDataURL('image/jpeg', 0.7);
}
