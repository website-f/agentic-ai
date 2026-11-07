// A USB or Bluetooth scanner in keyboard mode ("wedge") types the whole code in a burst and ends with Enter or Tab.
// A person types slowly. The difference only labels the entry (scanner or typed): it is not a security control, and a
// typed ID still needs its reason and proof on the server (paper section 10).

/** At least this many characters, with a median gap under this many milliseconds, ended by Enter or Tab. */
export const WEDGE_MIN_CHARS = 8;
export const WEDGE_MAX_GAP_MS = 35;

export function classifyKeys(times: number[], length: number, terminated: boolean): 'wedge' | 'typed' {
  if (!terminated || length < WEDGE_MIN_CHARS || times.length < WEDGE_MIN_CHARS) return 'typed';
  const gaps = times.slice(1).map((t, k) => t - times[k]).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return median < WEDGE_MAX_GAP_MS ? 'wedge' : 'typed';
}

/** Strip what scanners add around a code: control characters and an AIM symbology prefix such as ]Q1 or ]C0. */
export function cleanScan(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\][A-Za-z][0-9]/, '').trim().slice(0, 80);
}

/** The same value again within this time is one scan (a scanner or camera reading twice). */
export const REPEAT_MS = 1500;
