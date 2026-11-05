// Staff receipt wallet (Fauzan, 2 Nov 2026): "staff can upload receipts when they get it, upload or phone camera scanner.
// Then system automatically read it. Staff have the power to push claim now or later. A place to store all receipt for
// claim."
//
// Each receipt is kept as an evidence document marked as the staff member's own (`walletOf`), read by a receipt reader
// (date, total, shop, what kind of claim it looks like) and confirmed or corrected by the staff member before it is
// claimed. What the reader saw is kept apart from what the staff member confirmed, so HR sees both. The reader never
// submits, approves or changes a claim.
import type { IsoDate, IsoDateTime, StaffClaimKind } from './types';

/** What kind of spending a receipt looks like (the claim kinds, plus travel parts and anything else). */
export type ReceiptKind = StaffClaimKind | 'TOLL' | 'PARKING' | 'HOTEL' | 'FUEL' | 'OTHER';
export const RECEIPT_KINDS: ReceiptKind[] = ['MEDICAL', 'DENTAL', 'OPTICAL', 'CHECKUP', 'TOLL', 'PARKING', 'HOTEL', 'FUEL', 'OTHER'];

/** What a reader found on a receipt. Every field may be missing; nothing here is trusted until the staff member confirms it. */
export interface ReceiptRead {
  date: IsoDate | null;
  amount: number | null;
  merchant: string | null;
  kind: ReceiptKind | null;
  /** Which reader: 'phone' (read on the staff member's phone, Fauzan 2 Nov 2026), 'text', 'test' (demo). */
  by: 'phone' | 'text' | 'test';
  /** 0 to 1, as the reader reports it (the text reader gives 0.5 at most). */
  confidence: number;
  at: IsoDateTime;
}

/** A receipt in a staff member's wallet: what was read, what they confirmed, and the claim it went into. */
export interface ReceiptWallet {
  personId: string;
  userId: string;
  read: ReceiptRead | null;
  /** 'off' = no reader switched on; 'failed' = the reader could not read it; staff type the figures. */
  readState: 'waiting' | 'read' | 'failed' | 'off';
  confirmed: {
    date: IsoDate;
    amount: number;
    merchant: string;
    kind: ReceiptKind;
    at: IsoDateTime;
  } | null;
  claimId: string | null;
  removed: { at: IsoDateTime; why: string } | null;
}

/**
 * Reads a receipt on the server side. Fauzan chose on 2 Nov 2026 to read receipts on the phone (free), so the server has
 * no reader ('off') and takes what the phone read as a suggestion; the demo plugs in the test reader.
 */
export interface ReceiptReader {
  mode: 'off' | 'test';
  read(file: { name: string; mime: string; data: string }, now: IsoDateTime): Promise<ReceiptRead | null>;
}
export const offReceiptReader: ReceiptReader = {
  mode: 'off',
  read: async () => null,
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mac: 3,
  mar: 3,
  apr: 4,
  mei: 5,
  may: 5,
  jun: 6,
  jul: 7,
  ogo: 8,
  aug: 8,
  sep: 9,
  okt: 10,
  oct: 10,
  nov: 11,
  dis: 12,
  dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
function validDate(y: number, m: number, d: number): IsoDate | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return new Date(`${iso}T00:00:00Z`).getUTCDate() === d ? iso : null;
}

/** Guesses the kind from the words on the receipt (Malay and English). */
export function receiptKindOf(textIn: string): ReceiptKind | null {
  const t = textIn.toLowerCase();
  if (/pergigian|dental|dentist/.test(t)) return 'DENTAL';
  if (/optic|optik|optometr|kanta|spectacle|cermin mata/.test(t)) return 'OPTICAL';
  if (/pemeriksaan kesihatan|health screening|medical check|check-?up/.test(t)) return 'CHECKUP';
  if (/klinik|clinic|hospital|farmasi|pharmacy|ubat|medical|perubatan|doktor|doctor/.test(t)) return 'MEDICAL';
  if (/\btol\b|toll|plus malaysia|touch ?n ?go|smarttag|lebuhraya/.test(t)) return 'TOLL';
  if (/parking|letak kereta|parkir/.test(t)) return 'PARKING';
  if (/hotel|inn\b|resort|penginapan|check-?in/.test(t)) return 'HOTEL';
  if (/petrol|shell|petronas|caltex|bhp|petron|ron ?9[57]|diesel/.test(t)) return 'FUEL';
  return null;
}

/**
 * Reads the date, total and shop from the words on a receipt. The total is the amount on a line with "total",
 * "jumlah", "amount due" or "grand" (the last such line), else the largest RM amount. The date is the first day/month/year
 * found (dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd or 12 Okt 2026). The shop is the first line with letters that is not a
 * header word. Missing parts are null; the staff member always confirms.
 */
export function parseReceiptText(text: string, now: IsoDateTime, by: ReceiptRead['by'] = 'text'): ReceiptRead {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 400);
  const money = (s: string) =>
    [...s.matchAll(/(?:RM|MYR)?\s*(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\b/gi)]
      .map((m) => Number(`${m[1].replace(/,/g, '')}.${m[2]}`))
      .filter((n) => n > 0 && n < 1_000_000);
  let amount: number | null = null;
  for (const l of lines)
    if (/total|jumlah|amount due|grand|net amount|amaun|bayaran/i.test(l) && !/sub-?total|tax|cukai|sst|gst|discount|diskaun|change|baki/i.test(l))
      amount = money(l).at(-1) ?? amount;
  if (amount == null) {
    const all = lines.flatMap(money);
    amount = all.length ? Math.max(...all) : null;
  }
  let date: IsoDate | null = null;
  for (const l of lines) {
    let m = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(l);
    date = m ? validDate(+m[1], +m[2], +m[3]) : null;
    if (!date && (m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(l))) date = validDate(+m[3], +m[2], +m[1]);
    if (!date && (m = /\b(\d{1,2})\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{2,4})\b/.exec(l)) && MONTHS[m[2].toLowerCase()])
      date = validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    if (date) break;
  }
  const merchant =
    lines
      .find(
        (l) =>
          /[A-Za-z]{3}/.test(l) &&
          !/^(receipt|resit|invoice|invois|tax invoice|cash bill|official receipt|resit rasmi)\b/i.test(l) &&
          !money(l).length &&
          l.length <= 80,
      )
      ?.slice(0, 80) ?? null;
  const found = [amount != null, date != null, merchant != null].filter(Boolean).length;
  return {
    date,
    amount: amount == null ? null : Math.round(amount * 100) / 100,
    merchant,
    kind: receiptKindOf(text),
    by,
    confidence: by === 'text' || by === 'phone' ? Math.min(0.5, found / 6) : found / 3,
    at: now,
  };
}

/**
 * The demo's test reader: it reads the file name and caption as if they were the receipt's words (for example
 * "Klinik Sejahtera 28-10-2026 RM85.00.jpg"). Clearly a stand-in; it never runs on the server.
 */
export const testReceiptReader: ReceiptReader = {
  mode: 'test',
  read: async (file, now) => {
    const words = file.name
      .replace(/\.(jpe?g|png|pdf)$/i, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+(RM)/i, '\nTotal $1')
      .replace(/\s+(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})/, '\n$1');
    const r = parseReceiptText(words, now, 'test');
    return r.amount == null && r.date == null ? null : r;
  },
};

/** The last day a receipt can be claimed (the claim cut-off counts from the receipt date). */
export function receiptClaimBy(date: IsoDate, maxAgeDays: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + maxAgeDays);
  return d.toISOString().slice(0, 10);
}

/**
 * What the phone says it read, cleaned: it is only a suggestion the staff member confirms, so it is marked 'phone',
 * its confidence is capped, and anything out of range is dropped.
 */
export function cleanPhoneRead(v: unknown, now: IsoDateTime, today: IsoDate): ReceiptRead | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.date <= today && o.date >= '2000-01-01' ? o.date : null;
  const n = typeof o.amount === 'number' && Number.isFinite(o.amount) ? Math.round(o.amount * 100) / 100 : null;
  const amount = n != null && n > 0 && n < 1_000_000 ? n : null;
  const merchant = typeof o.merchant === 'string' ? o.merchant.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) || null : null;
  const kind = RECEIPT_KINDS.find((k) => k === o.kind) ?? null;
  if (date == null && amount == null) return null;
  const c = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? o.confidence : 0;
  return { date, amount, merchant, kind, by: 'phone', confidence: Math.max(0, Math.min(0.5, c)), at: now };
}
