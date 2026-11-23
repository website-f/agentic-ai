// A tiny Excel 97-2003 (.xls) writer for tests only: one sheet of synthetic cells as BIFF8 records (shared strings split
// over a CONTINUE record, plain text, numbers, RK numbers, a date-formatted number, a formula with a text result) inside
// a compound file, either in normal sectors or in the mini stream. It writes only what readXls reads.

type Cell = string | number | { date: number } | { formula: string };

const rec = (type: number, data: number[]): number[] => [type & 0xff, type >> 8, data.length & 0xff, data.length >> 8, ...data];
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const f64 = (n: number) => {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, n, true);
  return Array.from(new Uint8Array(b.buffer));
};
const latin = (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function workbook(name: string, rows: Cell[][], useSst: boolean): number[] {
  const strings: string[] = [];
  if (useSst) for (const r of rows) for (const c of r) if (typeof c === 'string' && !strings.includes(c)) strings.push(c);
  const bof = (dt: number) => rec(0x0809, [...u16(0x0600), ...u16(dt), ...u16(0), ...u16(0), ...u32(0), ...u32(0)]);
  const xf = (fmt: number) => rec(0x00e0, [...u16(0), ...u16(fmt), ...new Array(16).fill(0)]);
  const globals: number[] = [...bof(0x0005), ...xf(0), ...xf(14)];
  const sheetRecIndex = globals.length;
  globals.push(...rec(0x0085, [...u32(0), 0, 0, name.length, 0, ...latin(name)]));
  if (strings.length) {
    // The shared strings, the last one split over a CONTINUE record (which starts with its own flag byte).
    const body: number[] = [...u32(strings.length), ...u32(strings.length)];
    strings.slice(0, -1).forEach((s) => body.push(...u16(s.length), 0, ...latin(s)));
    const last = strings[strings.length - 1];
    const cut = Math.min(4, last.length);
    body.push(...u16(last.length), 0, ...latin(last.slice(0, cut)));
    globals.push(...rec(0x00fc, body), ...rec(0x003c, [0, ...latin(last.slice(cut))]));
  }
  globals.push(...rec(0x000a, []));
  const sheet: number[] = [...bof(0x0010)];
  rows.forEach((r, ri) =>
    r.forEach((c, ci) => {
      const at = [...u16(ri), ...u16(ci)];
      if (typeof c === 'string') {
        if (useSst) sheet.push(...rec(0x00fd, [...at, ...u16(0), ...u32(strings.indexOf(c))]));
        else sheet.push(...rec(0x0204, [...at, ...u16(0), ...u16(c.length), 0, ...latin(c)]));
      } else if (typeof c === 'number') {
        if (Number.isInteger(c)) sheet.push(...rec(0x027e, [...at, ...u16(0), ...u32(((c << 2) | 2) >>> 0)]));
        else sheet.push(...rec(0x0203, [...at, ...u16(0), ...f64(c)]));
      } else if ('date' in c) sheet.push(...rec(0x0203, [...at, ...u16(1), ...f64(c.date)]));
      else {
        sheet.push(...rec(0x0006, [...at, ...u16(0), 0, 0, 0, 0, 0, 0, 0xff, 0xff, ...u16(0), ...u32(0), ...u16(0)]));
        sheet.push(...rec(0x0207, [...u16(c.formula.length), 0, ...latin(c.formula)]));
      }
    }),
  );
  sheet.push(...rec(0x000a, []));
  // The sheet's BOF position goes into its BOUNDSHEET record.
  const pos = u32(globals.length);
  for (let i = 0; i < 4; i++) globals[sheetRecIndex + 4 + i] = pos[i];
  return [...globals, ...sheet];
}

/** A compound file with one "Workbook" stream. */
export function buildXls(name: string, rows: Cell[][], opt: { mini?: boolean } = {}): Uint8Array {
  const SS = 512;
  const END = 0xfffffffe;
  const FREE = 0xffffffff;
  let stream = workbook(name, rows, !opt.mini);
  if (!opt.mini && stream.length < 4096) stream = [...stream, ...rec(0x1234, new Array(4096 - stream.length).fill(0))];
  const sectorsOf = (n: number) => Math.ceil(n / SS);
  // Sectors: 0 FAT, 1 directory, then the stream (normal) or the mini FAT and the mini stream.
  const fat: number[] = [0xfffffffd, END];
  const sectors: number[][] = [];
  let streamStart = END;
  let rootStart = END;
  let rootSize = 0;
  let miniFatStart = END;
  let miniFatCount = 0;
  const chainFrom = (first: number, count: number) => {
    for (let i = 0; i < count; i++) fat[first + i] = i === count - 1 ? END : first + i + 1;
  };
  if (!opt.mini) {
    streamStart = 2;
    const n = sectorsOf(stream.length);
    chainFrom(2, n);
    for (let i = 0; i < n; i++) sectors.push(stream.slice(i * SS, (i + 1) * SS));
  } else {
    const miniSectors = Math.ceil(stream.length / 64);
    const miniFat: number[] = [];
    for (let i = 0; i < miniSectors; i++) miniFat.push(i === miniSectors - 1 ? END : i + 1);
    miniFatStart = 2;
    miniFatCount = 1;
    chainFrom(2, 1);
    sectors.push(miniFat.flatMap(u32));
    rootStart = 3;
    rootSize = miniSectors * 64;
    const n = sectorsOf(rootSize);
    chainFrom(3, n);
    const padded = [...stream, ...new Array(rootSize - stream.length).fill(0)];
    for (let i = 0; i < n; i++) sectors.push(padded.slice(i * SS, (i + 1) * SS));
    streamStart = 0;
  }
  const entry = (n: string, type: number, child: number, start: number, size: number) => {
    const e = new Array(128).fill(0);
    Array.from(n).forEach((c, i) => {
      e[i * 2] = c.charCodeAt(0);
    });
    e.splice(0x40, 2, ...u16((n.length + 1) * 2));
    e[0x42] = type;
    e[0x43] = 1;
    e.splice(0x44, 4, ...u32(FREE));
    e.splice(0x48, 4, ...u32(FREE));
    e.splice(0x4c, 4, ...u32(child));
    e.splice(0x74, 4, ...u32(start));
    e.splice(0x78, 4, ...u32(size));
    return e;
  };
  const dir = [...entry('Root Entry', 5, 1, rootStart, rootSize), ...entry('Workbook', 2, FREE, streamStart, stream.length - (opt.mini ? 0 : 0)), ...new Array(256).fill(0)];
  while (fat.length < SS / 4) fat.push(FREE);
  const header = new Array(512).fill(0);
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((b, i) => (header[i] = b));
  header.splice(0x18, 2, ...u16(0x3e));
  header.splice(0x1a, 2, ...u16(3));
  header.splice(0x1c, 2, ...u16(0xfffe));
  header.splice(0x1e, 2, ...u16(9));
  header.splice(0x20, 2, ...u16(6));
  header.splice(0x2c, 4, ...u32(1));
  header.splice(0x30, 4, ...u32(1));
  header.splice(0x38, 4, ...u32(4096));
  header.splice(0x3c, 4, ...u32(miniFatStart));
  header.splice(0x40, 4, ...u32(miniFatCount));
  header.splice(0x44, 4, ...u32(END));
  header.splice(0x4c, 4, ...u32(0));
  for (let i = 1; i < 109; i++) header.splice(0x4c + i * 4, 4, ...u32(FREE));
  const pad = (s: number[]) => [...s, ...new Array(SS - s.length).fill(0)];
  return new Uint8Array([...header, ...pad(fat.flatMap(u32)), ...pad(dir), ...sectors.flatMap(pad)]);
}
