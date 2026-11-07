// Code 128 (set B) as an SVG string, for printing an item label with the same ID as typed under it (Fitri's paper,
// section 2: if the scanners only read 1D, Code 128 carries the same token). No network, no library.

const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231',
  '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131',
  '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211',
  '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214',
  '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/** Bars for printable ASCII (32-126). Anything else is refused. */
export function code128B(text: string): string {
  const codes = [START_B];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error('Code 128 B carries printable characters only.');
    codes.push(c - 32);
  }
  let sum = START_B;
  for (let k = 1; k < codes.length; k++) sum += codes[k] * k;
  codes.push(sum % 103, STOP);
  return codes.map((c) => PATTERNS[c]).join('');
}

export function code128Svg(text: string, height = 56, module = 2): string {
  const widths = code128B(text);
  const quiet = 10 * module;
  let x = quiet;
  let bars = '';
  for (let k = 0; k < widths.length; k++) {
    const w = Number(widths[k]) * module;
    if (k % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
    x += w;
  }
  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" width="100%" style="max-width:${total}px;height:${height}px" role="img" fill="#000"><rect width="${total}" height="${height}" fill="#fff"/>${bars}</svg>`;
}
