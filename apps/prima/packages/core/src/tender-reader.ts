// Tender paper reader (Marketing item AH9, Fauzan 23 Nov 2026: "Use system more than ai"). The app reads the text of
// the tender papers (arahan petender, notice, forms) and drafts the checklist from fixed rules, in Malay and English.
// Each item found says where it was found. Usual items a tender of this kind needs but the reader did not find are
// still listed, marked "not found in the papers", so nothing is dropped silently. Papers the app cannot read (scanned
// pages, pictures) are named, and a person reads them. The Marketing check still compares the bid with the papers.
import type { DraftItem, TenderReader } from './tender';
import type { Tender, TenderChannel } from './types';

interface ReadRule {
  key: string;
  /** What to look for in the text. */
  find: RegExp;
  label: string;
  detail: string;
  needsDocument: boolean;
  /** Listed even when not found, for these kinds of tender. */
  usual: TenderChannel[];
  /** Builds a more exact label from the sentences where it was found. */
  exact?: (hits: string[]) => { label?: string; detail?: string } | null;
}

const NUM: Record<string, number> = { satu: 1, one: 1, dua: 2, two: 2, tiga: 3, three: 3, empat: 4, four: 4, lima: 5, five: 5, enam: 6, six: 6, twelve: 12 };
const MONTHS = 'jan(?:uari|uary)?|feb(?:ruari|ruary)?|mac|mar(?:ch)?|apr(?:il)?|mei|may|jun(?:e)?|jul(?:ai|y)?|ogo(?:s)?|aug(?:ust)?|sep(?:tember)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|dis(?:ember)?|dec(?:ember)?';
const DATE = new RegExp(`\\b(\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}|\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4})\\b`, 'i');

/** "3 bulan", "tiga (3) bulan", "6 months", "three years" in a sentence, or null. */
function count(hits: string[], unit: RegExp, max = 60): number | null {
  for (const h of hits) {
    const re = new RegExp(`(\\d{1,3}|${Object.keys(NUM).join('|')})\\s*(?:\\(\\s*\\d{1,3}\\s*\\)\\s*)?(?:${unit.source})`, 'i');
    const m = re.exec(h);
    if (m) {
      const v = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1].toLowerCase()];
      if (v && v > 0 && v <= max) return v;
    }
  }
  return null;
}

function dateIn(hits: string[]): string | null {
  for (const h of hits) {
    const m = DATE.exec(h);
    if (m) return m[1];
  }
  return null;
}

const mandatory = (hits: string[]) => hits.some((h) => /\b(wajib|diwajibkan|mandatory|compulsory|must attend|mesti hadir)\b/i.test(h));

/** The rules. Wording follows the guide V1.0 and the paper library; a rule is a search, not a legal reading. */
export const TENDER_READ_RULES: ReadRule[] = [
  {
    key: 'mof',
    find: /\b(MOF|Kementerian Kewangan|akuan pendaftaran syarikat|kod bidang)\b/i,
    label: 'MOF registration with the codes asked, valid to the closing date',
    detail: 'Copy of the MOF certificate showing every code the tender asks for.',
    needsDocument: true,
    usual: ['GOVERNMENT'],
    exact: (hits) => {
      const codes = [...new Set(hits.flatMap((h) => h.match(/\b\d{6}\b/g) ?? []))].slice(0, 8);
      return codes.length ? { label: `MOF registration with code ${codes.join(', ')}, valid to the closing date` } : null;
    },
  },
  {
    key: 'bumi',
    find: /\b(bumiputera|taraf bumiputera|STB)\b/i,
    label: 'Bumiputera status certificate (Sijil Taraf Bumiputera)',
    detail: 'The tender names Bumiputera status; follow its exact condition.',
    needsDocument: true,
    usual: [],
  },
  {
    key: 'kdn',
    find: /\b(KDN|Kementerian Dalam Negeri|Akta Agensi Persendirian|lesen agensi persendirian|private agenc(y|ies) licen[cs]e)\b/i,
    label: 'KDN private agency licence, valid, with the states or armed work asked',
    detail: 'Check the licence, the branch or state and armed or CIT approval if asked.',
    needsDocument: true,
    usual: ['GOVERNMENT', 'PRIVATE'],
  },
  {
    key: 'ssm',
    find: /\b(SSM|Suruhanjaya Syarikat|borang 9|borang 24|borang 49|seksyen 14|seksyen 17|seksyen 58|section 14|section 17|section 58|company search|carian syarikat)\b/i,
    label: 'SSM papers and the latest company search',
    detail: 'Registration forms and a recent search, as the tender asks.',
    needsDocument: true,
    usual: ['GOVERNMENT'],
  },
  {
    key: 'bank',
    find: /\b(penyata bank|bank statements?)\b/i,
    label: 'Bank statements for the months asked',
    detail: 'Every page, the right account, certified if asked.',
    needsDocument: true,
    usual: ['GOVERNMENT'],
    exact: (hits) => {
      const n = count(hits, /bulan|months?/);
      return n ? { label: `Bank statements for the last ${n} months` } : null;
    },
  },
  {
    key: 'accounts',
    find: /\b(akaun (yang )?(diaudit|teraudit)|penyata kewangan (yang )?(diaudit|teraudit)|audited (financial )?(accounts|statements))\b/i,
    label: 'Audited accounts for the years asked',
    detail: 'Signed audited accounts for the right financial years.',
    needsDocument: true,
    usual: ['GOVERNMENT'],
    exact: (hits) => {
      const n = count(hits, /tahun|years?/);
      return n ? { label: `Audited accounts for the last ${n} year${n === 1 ? '' : 's'}` } : null;
    },
  },
  {
    key: 'bankletter',
    find: /\b(surat sokongan bank|surat akuan bank|kemudahan kredit|credit facilit(y|ies)|bank (letter|reference))\b/i,
    label: 'Bank letter or credit facility letter in the form asked',
    detail: 'Use the tender’s own form if it gives one.',
    needsDocument: true,
    usual: [],
  },
  {
    key: 'epf',
    find: /\b(KWSP|EPF|PERKESO|SOCSO)\b/i,
    label: 'EPF and SOCSO registration or statements',
    detail: 'As the tender asks: registration, latest statement or letter of good standing.',
    needsDocument: true,
    usual: [],
  },
  {
    key: 'sst',
    find: /\b(SST|cukai jualan dan perkhidmatan|cukai perkhidmatan|service tax)\b/i,
    label: 'SST registration and the tax shown correctly in the price',
    detail: 'Registration certificate; price with or without SST as the schedule asks.',
    needsDocument: false,
    usual: [],
  },
  {
    key: 'briefing',
    find: /\b(taklimat|briefing)\b/i,
    label: 'Attend the briefing and keep the attendance slip',
    detail: 'Record it under "Briefing and site visit" and name who attends.',
    needsDocument: true,
    usual: [],
    exact: (hits) => {
      const d = dateIn(hits);
      return { label: `Attend the ${mandatory(hits) ? 'mandatory ' : ''}briefing${d ? ` on ${d}` : ''} and keep the attendance slip` };
    },
  },
  {
    key: 'sitevisit',
    find: /\b(lawatan tapak|site visit|lawatan ke tapak)\b/i,
    label: 'Attend the site visit and keep the attendance slip',
    detail: 'Record it under "Briefing and site visit"; check whether only the person on the MOF certificate may go.',
    needsDocument: true,
    usual: [],
    exact: (hits) => {
      const d = dateIn(hits);
      return { label: `Attend the ${mandatory(hits) ? 'mandatory ' : ''}site visit${d ? ` on ${d}` : ''} and keep the attendance slip` };
    },
  },
  {
    key: 'docfee',
    find: /\b(pembelian dokumen|beli dokumen|harga dokumen|bayaran dokumen|document fee|purchase of (the )?tender document)\b/i,
    label: 'Buy the tender document and keep the receipt',
    detail: 'Before the last date to buy it.',
    needsDocument: true,
    usual: [],
  },
  {
    key: 'experience',
    find: /\b(pengalaman|experience)\b/i,
    label: 'Experience letters or contracts as asked',
    detail: 'Choose contracts that match the kind and period the tender asks for.',
    needsDocument: true,
    usual: ['GOVERNMENT'],
    exact: (hits) => {
      const n = count(hits, /tahun|years?/);
      return n ? { label: `Experience letters or contracts for the last ${n} years` } : null;
    },
  },
  {
    key: 'training',
    find: /\b(CSG|Certified Security Guard|kursus pengawal|latihan pengawal|guard training)\b/i,
    label: 'Guard training shown (CSG or the course asked)',
    detail: 'Training records for the guards named in the bid.',
    needsDocument: false,
    usual: [],
  },
  {
    key: 'integrity',
    find: /\b(pakatan integriti|integrity pact|akuan pembida|surat akuan)\b/i,
    label: 'Integrity pact and Surat Akuan Pembida signed by the authorised person',
    detail: 'Signed and witnessed as the form asks.',
    needsDocument: true,
    usual: ['GOVERNMENT'],
  },
  {
    key: 'deposit',
    find: /\b(deposit tender|wang cagaran tender|tender deposit|bid bond)\b/i,
    label: 'Tender deposit or bid bond in the form asked',
    detail: 'Amount, payee and form as the tender says.',
    needsDocument: true,
    usual: [],
  },
  {
    key: 'bond',
    find: /\b(bon pelaksanaan|performance bond|jaminan bank)\b/i,
    label: 'Performance bond: plan it for when the contract is awarded',
    detail: 'Note the amount or percentage and the form asked.',
    needsDocument: false,
    usual: [],
  },
  {
    key: 'insurance',
    find: /\b(insurans|insurance|liabiliti awam|public liability)\b/i,
    label: 'Insurance cover asked (public liability, workers)',
    detail: 'Valid for the contract period asked.',
    needsDocument: false,
    usual: [],
  },
  {
    key: 'wage',
    find: /\b(gaji minimum|minimum wage)\b/i,
    label: 'Price uses at least the minimum wage and the hours asked',
    detail: 'Check the wage, overtime and contributions in the price schedule.',
    needsDocument: false,
    usual: [],
  },
  {
    key: 'validity',
    find: /\b(sah laku|tempoh sah|validity)\b/i,
    label: 'Offer valid for the period asked',
    detail: 'Write the validity period the tender asks for in the offer.',
    needsDocument: false,
    usual: [],
    exact: (hits) => {
      const n = count(hits, /hari|days?/, 365);
      return n ? { label: `Offer valid for ${n} days` } : null;
    },
  },
  {
    key: 'cert',
    find: /\b(sijil digital|digital certificate|token)\b/i,
    label: 'Digital certificate of the person who submits, in force',
    detail: 'The person named on the company’s certificate submits in the portal.',
    needsDocument: false,
    usual: [],
  },
  {
    key: 'ppkkm',
    find: /\b(PPKKM|Persatuan Perkhidmatan Keselamatan)\b/i,
    label: 'PPKKM membership certificate',
    detail: 'In force on the closing date.',
    needsDocument: true,
    usual: [],
  },
];

/** The forms the tender names, such as Lampiran A1 or Borang B. */
function formsNamed(text: string): string[] {
  const names = [...text.matchAll(/\b(Lampiran|Borang|Jadual|Appendix|Form)\s+([A-Z]{1,2}\d{0,2}(?:\.\d{1,2})?)\b/g)].map((m) => `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`);
  return [...new Set(names)].slice(0, 20);
}

/** The sentences of a paper, kept short enough to quote. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.;:!?])\s+|\s{2,}|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

const quote = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}...` : s);

export const ruleTenderReader: TenderReader = {
  name: 'Prima reader (reads the text of the tender papers by fixed rules)',
  readsFiles: true,
  draft(t: Tender, papers) {
    const read = papers.filter((p) => p.text);
    const items: DraftItem[] = [];
    for (const r of TENDER_READ_RULES) {
      const where: { paper: string; s: string }[] = [];
      for (const p of read) for (const s of sentences(p.text!)) if (r.find.test(s)) where.push({ paper: p.name, s });
      if (where.length) {
        const ex = r.exact?.(where.map((w) => w.s)) ?? null;
        items.push({
          label: ex?.label ?? r.label,
          detail: ex?.detail ?? `${r.detail} Found: "${quote(where[0].s)}"`,
          ref: `${where[0].paper}${where.length > 1 ? ` (+${where.length - 1} more)` : ''}`,
          needsDocument: r.needsDocument,
        });
      } else if (r.usual.includes(t.channel)) {
        items.push({
          label: r.label,
          detail: `${r.detail} Usual for this kind of tender, but not found in the papers the app could read: check whether it is asked.`,
          ref: 'Not found in the papers',
          needsDocument: false,
        });
      }
    }
    const forms = formsNamed(read.map((p) => p.text).join(' '));
    if (forms.length)
      items.push({
        label: `Fill in and sign the forms named: ${forms.join(', ')}`,
        detail: 'Each form the papers name, filled in, signed and stamped where asked.',
        ref: 'Forms named in the papers',
        needsDocument: true,
      });
    const unread = papers.filter((p) => !p.text);
    if (unread.length)
      items.unshift({
        label: `Read by hand: ${unread.map((p) => p.name).join(', ')}`,
        detail: 'The app could not read these papers (scanned pages or pictures). Add anything they ask for to this checklist.',
        ref: 'Not read by the app',
        needsDocument: false,
      });
    return items;
  },
};

// ---------- The AI check (Fauzan, 23 Nov 2026 decision card: "Yes, AI checks once, person answers") ----------

/** What the AI check is given: the readable text of the tender papers and the checklist labels. No names, no prices. */
export interface TenderAiCheckInput {
  channel: TenderChannel;
  papers: { name: string; text: string }[];
  checklist: string[];
}
/** Calls the AI once; the API plugs in the Azure OpenAI reader. The answer is untrusted and checked by tenderAiFlags. */
export type TenderAiChecker = (input: TenderAiCheckInput) => Promise<unknown>;

/** Most text sent for one tender: about 30,000 words. Longer papers are cut and the cut is said in the result. */
/**
 * At most this much paper text goes to the AI for one tender (about 10,000 tokens). Fauzan, 23 Nov 2026: "use all the
 * new technology to decrease the amount of token"; only the lines that state what the bidder must do are sent.
 */
export const TENDER_AI_CHECK_MAX_CHARS = 40_000;
const MAX_FLAGS = 30;

/** Words that mark a line stating what the bidder must do or send, in Malay and English. */
const REQUIRE_WORDS =
  /\b(mesti|hendaklah|wajib|dikehendaki|disyaratkan|syarat|perlu|dikemukakan|kemukakan|mengemukakan|lampir\w*|sertakan|salinan|sijil|berdaftar|pendaftaran|tarikh|tempoh|taklimat|lawatan|deposit|bon|jaminan|insurans|pengalaman|penyata|akaun|borang|jadual|lampiran|must|shall|required?|requirements?|mandatory|submit\w*|attach\w*|certified|certificate|registered|registration|copy|copies|closing|deadline|briefing|site visit|bond|guarantee|insurance|experience|statement|accounts|form|appendix|schedule|minimum|at least|not less than|valid|validity)\b/i;

/**
 * The lines of a paper that state requirements, each with the line before and after for sense. Skipped stretches are
 * marked "...". Words are copied exactly, so a quote the AI takes from them is still found in the full paper.
 */
export function tenderAiExcerpt(text: string): string {
  const lines = text.split(/\r?\n/);
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (l.trim() && REQUIRE_WORDS.test(l)) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < lines.length) keep.add(j);
  });
  if (!keep.size) return text.slice(0, 4000);
  const out: string[] = [];
  let last = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (!lines[i].trim()) continue;
    if (last >= 0 && i > last + 1) out.push('...');
    out.push(lines[i]);
    last = i;
  }
  return out.join('\n');
}

/** The papers as sent to the AI: the requirement lines of each, in order, cut to the limit. */
export function tenderAiPapers(papers: { name: string; text: string | null | undefined }[]): {
  sent: { name: string; text: string }[];
  partial: string[];
  skipped: string[];
} {
  let left = TENDER_AI_CHECK_MAX_CHARS;
  const sent: { name: string; text: string }[] = [];
  const partial: string[] = [];
  const skipped: string[] = [];
  for (const p of papers) {
    if (!p.text) continue;
    if (left <= 0) {
      skipped.push(p.name);
      continue;
    }
    const excerpt = tenderAiExcerpt(p.text);
    const text = excerpt.slice(0, left);
    if (text.length < excerpt.length) partial.push(p.name);
    left -= text.length;
    sent.push({ name: p.name.slice(0, 200), text });
  }
  return { sent, partial, skipped };
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Keeps only well-formed flags whose quoted words really are in the paper named. Anything else from the AI is
 * dropped and counted, never shown as a finding.
 */
export function tenderAiFlags(raw: unknown, papers: { name: string; text: string }[]): { flags: { kind: 'MISSING' | 'DIFFERENT'; what: string; quote: string; paper: string }[]; dropped: number } {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { flags?: unknown }).flags) ? ((raw as { flags: unknown[] }).flags) : null;
  if (!list) throw new Error('INVALID_MODEL_OUTPUT');
  const flags: { kind: 'MISSING' | 'DIFFERENT'; what: string; quote: string; paper: string }[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const f of list) {
    const o = (f ?? {}) as Record<string, unknown>;
    const kind = o.kind === 'MISSING' || o.kind === 'DIFFERENT' ? o.kind : null;
    const what = typeof o.what === 'string' ? o.what.trim().slice(0, 240) : '';
    const quote = typeof o.quote === 'string' ? o.quote.trim().slice(0, 300) : '';
    const paper = papers.find((p) => p.name === o.paper);
    if (!kind || what.length < 3 || quote.length < 8 || !paper || !squash(paper.text).includes(squash(quote))) {
      dropped++;
      continue;
    }
    const key = squash(what);
    if (seen.has(key)) continue;
    seen.add(key);
    if (flags.length >= MAX_FLAGS) {
      dropped++;
      continue;
    }
    flags.push({ kind, what, quote, paper: paper.name });
  }
  return { flags, dropped };
}
