/**
 * The tender watcher (Marketing item AH11, Fauzan 22-23 Nov 2026: "1 tender watcher to find tender"; "Use system more
 * than ai"). Once a day the server reads the public pages of the buyer sites Marketing allowed, and these fixed rules
 * pick out the notices about guarding work. No AI, no company logins, no forms, no files: only the public page, and only
 * where the site's robots file and its terms allow it. Marketing decides what each find is.
 */
import { sha256Hex } from './audit';
import type { IsoDate } from './types';

/** The words that mark a notice about guarding work, in Malay and English. */
export const WATCH_WORDS: { word: string; re: RegExp }[] = [
  { word: 'perkhidmatan kawalan keselamatan', re: /perkhidmatan\s+kawalan\s+keselamatan/i },
  { word: 'kawalan keselamatan', re: /kawalan\s+keselamatan/i },
  { word: 'pengawal keselamatan', re: /pengawal(?:an)?\s+keselamatan/i },
  { word: 'khidmat kawalan', re: /khidmat\s+kawalan/i },
  { word: 'security guard', re: /security\s+guard(?:s|ing)?\b/i },
  { word: 'security services', re: /security\s+services?\b/i },
  { word: 'guarding services', re: /guarding\s+services?\b/i },
];

/** The name the watcher gives itself to sites (and looks for in their robots file). No person or company is named. */
export const WATCHER_AGENT = 'PrimaTenderWatcher';

export interface WatchCandidate {
  /** Same notice, same key: so a notice seen again is not shown again. */
  key: string;
  title: string;
  ref: string;
  closesOn: IsoDate | null;
  link: string | null;
  /** The watch word that matched. */
  word: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-' };

function decode(s: string): string {
  return s
    .replace(/&#(\d{1,6});/g, (_m, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

/** The page cut into blocks (table rows, list items, paragraphs, headings), each with its text and first link. */
export function pageBlocks(html: string): { text: string; href: string | null }[] {
  const clean = html
    .slice(0, 2_000_000)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const parts = clean.split(/<\/(?:tr|li|p|h[1-6]|dt|dd|article|section|div|table|ul|ol)\s*>|<br\s*\/?>|<hr\s*\/?>/i);
  const out: { text: string; href: string | null }[] = [];
  for (const p of parts) {
    const href = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(p);
    const text = decode(p.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, href: href ? decode(href[1] ?? href[2] ?? href[3] ?? '') : null });
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mac: 3, mar: 3, march: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, june: 6, jul: 7, julai: 7, july: 7, ogos: 8, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dis: 12, dec: 12, disember: 12,
  december: 12,
};

function iso(y: number, m: number, d: number): IsoDate | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** Every date written in the text, in the order written: 31/12/2026, 31-12-2026, 31.12.2026, 2026-12-31, 31 Disember 2026. */
export function datesIn(text: string): { at: number; date: IsoDate }[] {
  const out: { at: number; date: IsoDate }[] = [];
  const push = (at: number, d: IsoDate | null) => d && out.push({ at, date: d });
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) push(m.index!, iso(+m[3], +m[2], +m[1]));
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m.index!, iso(+m[1], +m[2], +m[3]));
  for (const m of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) push(m.index!, iso(+m[3], mo, +m[1]));
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The closing date: the first date after a closing word, else the latest date in the notice, else none. */
export function closingDate(text: string): IsoDate | null {
  const dates = datesIn(text);
  if (!dates.length) return null;
  const close = /(tarikh\s+tutup|tutup|ditutup|tarikh\s+akhir|closing(?:\s+date)?|closes?|close\s+date|due\s+date|batas\s+waktu)/i.exec(text);
  if (close) {
    const after = dates.find((d) => d.at >= close.index);
    if (after) return after.date;
  }
  return dates.map((d) => d.date).sort().at(-1)!;
}

/** The buyer's tender or quotation number, if the notice shows one. */
export function noticeRef(text: string): string {
  const named = /\b(?:no\.?|nombor|number|ruj(?:ukan)?\.?|ref(?:erence)?\.?)\s*(?:tender|sebut\s*harga|quotation|rujukan|ruj\.?|ref\.?)?\s*[:.]?\s*([A-Z0-9][A-Z0-9/\-.()]{3,40})/i.exec(text);
  if (named && /\d/.test(named[1]) && /[/\-.]/.test(named[1])) return named[1].replace(/[.)]+$/, '');
  const shaped = /\b[A-Z][A-Z0-9]{1,15}(?:[/.-][A-Z0-9()]{1,12}){2,6}\b/.exec(text);
  return shaped && /\d/.test(shaped[0]) ? shaped[0] : '';
}

function link(href: string | null, pageUrl: string): string | null {
  if (!href || /^(javascript|mailto|tel|data):/i.test(href.trim())) return null;
  try {
    const u = new URL(href.trim(), pageUrl);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString().slice(0, 300) : null;
  } catch {
    return null;
  }
}

/** One key for one notice: its number where it has one, else its words, on that site. */
export function watchKey(host: string, ref: string, title: string): string {
  const norm = (ref || title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);
  return sha256Hex(`${host.toLowerCase()}|${norm}`).slice(0, 16);
}

/** The guarding notices on one public page, by fixed rules. At most 40 per page. */
export function watchPage(html: string, pageUrl: string): WatchCandidate[] {
  const host = new URL(pageUrl).hostname;
  const seen = new Set<string>();
  const out: WatchCandidate[] = [];
  for (const b of pageBlocks(html)) {
    if (b.text.length < 12 || b.text.length > 1500) continue;
    const hit = WATCH_WORDS.find((w) => w.re.test(b.text));
    if (!hit) continue;
    const ref = noticeRef(b.text);
    const title = b.text.slice(0, 240);
    const key = watchKey(host, ref, title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, title, ref, closesOn: closingDate(b.text), link: link(b.href, pageUrl), word: hit.word });
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * Whether the site's robots file lets the watcher read this path. The group naming the watcher wins, else the group for
 * every robot ("*"); within it the longest matching rule wins, and Allow wins a tie. No rule = allowed.
 */
export function robotsAllows(robotsTxt: string, path: string, agent = WATCHER_AGENT): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.slice(0, 500_000).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && cur) {
      lastWasAgent = false;
      if (field === 'disallow' && value === '') continue;
      cur.rules.push({ allow: field === 'allow', path: value });
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  const rules = use.flatMap((g) => g.rules);
  const matches = (rule: string) => {
    const re = new RegExp(
      '^' +
        rule
          .split('*')
          .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')
          .replace(/\\\$$/, '$'),
    );
    return re.test(path);
  };
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    if (!matches(r.path)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
  }
  return best ? best.allow : true;
}
