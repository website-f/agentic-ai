// P81: a SYNTHETIC attendance report in the InfoTech layout, written as a real PDF (text placed by position), for the
// parser tests. Invented companies, people and numbers only; no real report is ever committed.

export interface SynDay {
  date: string; // dd-mm-yyyy
  day: string;
  clocks?: string[];
  in: string;
  out: string;
  shift: string;
  /** normal, late, early, actual, ot1.0, ot1.5, ot2.0, ot3.0, flat, attd, shift, meal, tran, other1, other2, health */
  n: number[];
  reason?: string;
}
export interface SynEmployee {
  code: string;
  name: string;
  designation: string;
  days: SynDay[];
  /** Print totals that do not add up (to test the check). */
  wrongTotals?: boolean;
  monthly?: number[];
  /** Put the monthly allowance block on its own next page. */
  monthlyOnNextPage?: boolean;
  /** Split the day rows over two pages after this many rows. */
  splitAfter?: number;
}

type Text = { x: number; y: number; s: string };

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** A PDF with one page per list of texts (y measured from the top, as on paper), Helvetica 7pt, 792 x 612. */
export function pdfOf(pages: Text[][]): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => {
    objs.push(body);
    return objs.length;
  };
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const texts of pages) {
    const ops = texts.map((t) => `BT /F1 7 Tf 1 0 0 1 ${t.x.toFixed(2)} ${(612 - t.y).toFixed(2)} Tm (${esc(t.s)}) Tj ET`).join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

const W = 3.9; // about one character at 7pt
/** Right-aligned value ending at x. */
const right = (x: number, y: number, s: string): Text => ({ x: x - s.length * W, y, s });

const NUM_RIGHT = [243, 275, 311, 344, 378, 410, 443, 472, 498, 526, 552, 575, 593, 616, 645, 674];
const NUM_RIGHT_CLK = [284, 317, 345, 371, 398, 428, 453, 476, 501, 533, 561, 591, 618, 650, 678, 707];
const TOTAL_RIGHT = [146, 189, 230, 270, 307, 353, 394, 437, 482, 524, 565, 603, 644, 680, 722, 765];

/** Builds the pages of a synthetic report for one month. */
export function syntheticReport(opts: { company: string; from: string; to: string; employees: SynEmployee[]; clocks?: boolean; extraPages?: Text[][] }): Uint8Array {
  const clk = !!opts.clocks;
  const pages: Text[][] = [];
  const head = (n: () => number): Text[] => {
    const t: Text[] = [
      { x: 321, y: 16, s: opts.company },
      { x: 261, y: 36, s: clk ? 'Individual Attendance Report With Actual Clock and Monthly Allowance' : 'Individual Attendance Report With Monthly Allowance' },
      { x: 12, y: 60, s: 'Date :' },
      { x: 42, y: 60, s: '06-11-2026 10:00:00' },
      { x: 300, y: 60, s: 'Period :' },
      { x: 340, y: 60, s: `${opts.from} To ${opts.to}` },
      { x: 727, y: 60, s: `Page : ${n()} of TOTAL` },
      { x: 411, y: 81, s: 'OverTime' },
      { x: 581, y: 81, s: 'Allowance' },
      { x: 693, y: 91, s: 'Reason' },
    ];
    const labels = clk
      ? [['Date', 11], ['Day', 62], ['Clk1', 87], ['Clk2', 114], ['Clk3', 139], ['Clk4', 162], ['In', 191], ['Out', 208], ['Shift', 227], ['Normal', 257], ['Late', 295], ['EarlyOut', 318], ['Actual', 353], ['1.0', 383], ['1.5', 413], ['2.0', 437], ['3.0', 461], ['Flat', 484], ['Attd', 512], ['Shift', 541], ['Meal', 571], ['Tran', 596], ['Allow', 623], ['Allow', 651], ['Health', 677]]
      : [['Date', 12], ['Day', 88], ['In', 129], ['Out', 157], ['Shift', 182], ['Normal', 214], ['Late', 252], ['EarlyOut', 281], ['Actual', 320], ['1.0', 360], ['1.5', 392], ['2.0', 422], ['3.0', 453], ['Flat', 481], ['Attd', 506], ['Shift', 532], ['Meal', 555], ['Tran', 574], ['Allowa', 596], ['Allowa', 627], ['Health', 657]];
    for (const [s, x] of labels) t.push({ x: x as number, y: 100, s: s as string });
    return t;
  };
  let pageNo = 0;
  const next = () => ++pageNo;
  const fmt = (v: number) => v.toFixed(2);
  for (const e of opts.employees) {
    let page = head(next);
    page.push({ x: 12, y: 121, s: 'Emp Code' }, { x: 70, y: 121, s: e.code }, { x: 156, y: 121, s: 'Name :' }, { x: 199, y: 121, s: e.name }, { x: 394, y: 121, s: 'Designation :' }, { x: 454, y: 121, s: e.designation });
    let y = 132;
    e.days.forEach((d, i) => {
      if (e.splitAfter && i === e.splitAfter) {
        page.push({ x: 725, y: 593, s: 'Cont...' });
        pages.push(page);
        page = head(next);
        y = 132;
      }
      page.push({ x: 12, y, s: d.date }, { x: clk ? 69 : 89, y, s: d.day });
      if (clk) (d.clocks ?? ['0.00', '0.00', '0.00', '0.00']).forEach((c, k) => page.push(right([106, 130, 154, 178][k], y, c)));
      page.push(right(clk ? 205 : 141, y, d.in), right(clk ? 225 : 175, y, d.out), { x: clk ? 235 : 183, y, s: d.shift });
      d.n.forEach((v, k) => page.push(right((clk ? NUM_RIGHT_CLK : NUM_RIGHT)[k], y, fmt(v))));
      if (d.reason) page.push({ x: clk ? 710 : 696, y, s: d.reason });
      y += 11;
    });
    const sums = Array.from({ length: 16 }, (_, k) => e.days.reduce((s, d) => s + d.n[k], 0) + (e.wrongTotals && k === 0 ? 1 : 0));
    page.push({ x: 40, y: y + 40, s: 'Total :' });
    // Totals on two heights, as the real report prints them.
    sums.forEach((v, k) => page.push(right(TOTAL_RIGHT[k], y + 38 + (k < 8 ? 1 : 0), fmt(v))));
    const monthly = (p: Text[], top: number) => {
      p.push({ x: 137, y: top, s: 'Monthly Allowance' }, { x: 34, y: top + 18, s: 'Attd' }, { x: 84, y: top + 18, s: 'Health' }, { x: 141, y: top + 18, s: 'Trans' }, { x: 191, y: top + 18, s: 'Meal' });
      (e.monthly ?? [0, 0, 0, 0, 0, 0]).forEach((v, k) => p.push(right([49, 103, 158, 207, 269, 341][k], top + 35 + (k >= 4 ? 2 : 0), fmt(v))));
    };
    if (e.monthlyOnNextPage) {
      page.push({ x: 725, y: 593, s: 'Cont...' });
      pages.push(page);
      page = head(next);
      monthly(page, 134);
    } else monthly(page, y + 60);
    page.push({ x: 725, y: 593, s: 'Cont...' });
    pages.push(page);
  }
  for (const extra of opts.extraPages ?? []) {
    next();
    pages.push(extra);
  }
  const total = String(pages.length);
  return pdfOf(pages.map((p) => p.map((t) => (t.s.includes('TOTAL') ? { ...t, s: t.s.replace('TOTAL', total) } : t))));
}

/** One synthetic day: worked 08:00 to 17:00 unless a reason is given. */
export function synDay(dd: number, mm: string, yyyy: string, o: Partial<SynDay> & { late?: number; early?: number; ot?: number[]; meal?: number } = {}): SynDay {
  const date = `${String(dd).padStart(2, '0')}-${mm}-${yyyy}`;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${yyyy}-${mm}-${String(dd).padStart(2, '0')}T00:00:00Z`).getUTCDay()];
  const off = !!o.reason;
  const late = o.late ?? 0;
  const early = o.early ?? 0;
  const actual = off ? 0 : 8 - late - early;
  const ot = o.ot ?? [0, 0, 0, 0];
  return {
    date,
    day,
    clocks: o.clocks,
    in: o.in ?? (off ? '0.00' : '8.00'),
    out: o.out ?? (off ? '0.00' : '17.00'),
    shift: o.shift ?? 'S01',
    n: [off ? 0 : 8 - late - early, late, early, actual, ...ot, 0, 0, 0, o.meal ?? 0, 0, 0, 0, 0],
    reason: o.reason,
  };
}
