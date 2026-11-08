import type { IsoDate } from "./types";


export type TimeMarkCheck = 'matches' | 'no_camera_time' | 'differs';

export interface TimeMark {
  /** The time printed on the photo, as the OM read it: YYYY-MM-DDTHH:MM (Malaysia time). */
  stampedAt: string;
  /** The camera's own time from the file, when present: YYYY-MM-DDTHH:MM:SS. */
  cameraAt: string | null;
  check: TimeMarkCheck;
}

/** Minutes the camera time may differ from the stamped time before the photo is flagged. */
export const TIME_MARK_TOLERANCE_MIN = 10;

function bytesOf(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The camera time (EXIF DateTimeOriginal, else DateTime) of a JPEG data URL, as YYYY-MM-DDTHH:MM:SS; null when the file
 * has none. Reads only the EXIF header; never throws on a damaged file.
 */
export function exifTakenAt(dataUrl: string): string | null {
  try {
    if (!/^data:image\/jpeg;base64,/.test(dataUrl)) return null;
    const b = bytesOf(dataUrl);
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    let p = 2;
    while (p + 4 < b.length && b[p] === 0xff) {
      const marker = b[p + 1];
      const len = (b[p + 2] << 8) | b[p + 3];
      if (marker === 0xda) break;
      if (marker === 0xe1 && String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]) === 'Exif') {
        const t = p + 10;
        const le = b[t] === 0x49;
        const u16 = (o: number) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
        const u32 = (o: number) =>
          (le ? b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16) | (b[t + o + 3] << 24) : (b[t + o] << 24) | (b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3]) >>> 0;
        const ascii = (o: number, n: number) => {
          let s = '';
          for (let i = 0; i < n && t + o + i < b.length; i++) {
            const c = b[t + o + i];
            if (c === 0) break;
            s += String.fromCharCode(c);
          }
          return s;
        };
        const readIfd = (off: number): Map<number, number> => {
          const m = new Map<number, number>();
          if (t + off + 2 > b.length) return m;
          const n = u16(off);
          for (let i = 0; i < n && i < 200; i++) {
            const e = off + 2 + i * 12;
            const tag = u16(e);
            const count = u32(e + 4);
            m.set(tag, tag === 0x8769 ? u32(e + 8) : count > 4 ? u32(e + 8) : e + 8);
          }
          return m;
        };
        const ifd0 = readIfd(u32(4));
        const exifOff = ifd0.get(0x8769);
        const exif = exifOff !== undefined ? readIfd(exifOff) : new Map<number, number>();
        const at = exif.get(0x9003) ?? ifd0.get(0x0132);
        if (at === undefined) return null;
        const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(ascii(at, 19));
        return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
      }
      p += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

/** Checks the time printed on the photo against the day it is proof for, and against the camera time. Throws plain words. */
export function checkTimeMark(dataUrl: string, stampedAt: string, day: IsoDate, now: string): TimeMark {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(stampedAt ?? ''))
    throw new Error('Enter the date and time printed on the photo. Only time-marked photos are accepted as proof.');
  if (stampedAt.slice(0, 10) !== day) throw new Error(`The time mark on the photo is ${stampedAt.replace('T', ' ')}, not ${day}. Use a photo taken that day.`);
  if (`${stampedAt}:00` > now.slice(0, 19)) throw new Error('The time mark on the photo is later than now.');
  const cameraAt = exifTakenAt(dataUrl);
  if (!cameraAt) return { stampedAt, cameraAt, check: 'no_camera_time' };
  if (cameraAt.slice(0, 10) !== day) throw new Error(`This photo was taken on ${cameraAt.slice(0, 10)} by the camera's own clock, not ${day}. Use a photo taken that day.`);
  const diff = Math.abs(Date.parse(`${cameraAt}Z`) - Date.parse(`${stampedAt}:00Z`)) / 60_000;
  return { stampedAt, cameraAt, check: diff <= TIME_MARK_TOLERANCE_MIN ? 'matches' : 'differs' };
}

export const TIME_MARK_LABEL: Record<TimeMarkCheck, string> = {
  matches: 'Time mark matches the camera time',
  no_camera_time: 'Camera time removed from the file (e.g. sent by WhatsApp): time mark read by the OM only',
  differs: `Camera time differs from the time mark by more than ${TIME_MARK_TOLERANCE_MIN} minutes`,
};