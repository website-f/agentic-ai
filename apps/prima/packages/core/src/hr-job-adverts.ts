// Job adverts for approved vacancies (audit decision 6, Fauzan 5 Nov 2026): vacancy posting for guards and all
// staff, drafted for HR and published to social media.
//
// Boundaries kept here:
// - A post is drafted only for a vacancy that is open (CEO approved, company head or HR Director signed).
// - A person approves each post before it can go out, and never the person who wrote the current wording.
// - Approval is bound to the exact wording (version + SHA-256); any edit after approval sends it back to draft.
// - Social publishing is switched off: no channel is connected, Prima never claims a post went out. HR may record
//   a post it made by hand, and that record is marked as HR's own statement, not checked by Prima.
// - The draft uses only the vacancy's job facts (title, department, pay range, headcount, category, employer
//   name). No staff names, IC numbers, phone numbers or other personal data go into a draft or an AI prompt.
import { sha256Hex } from './audit';
import type { Vacancy } from './types';

export type AdvertChannel = 'facebook' | 'instagram' | 'linkedin' | 'tiktok' | 'jobstreet';

/** JobStreet charges per post (Fauzan, 5 Nov 2026: keep it; the person picks channels to suit the post). */
export const ADVERT_CHANNELS: readonly { id: AdvertChannel; name: string; paid: boolean }[] = [
  { id: 'facebook', name: 'Facebook page', paid: false },
  { id: 'instagram', name: 'Instagram', paid: false },
  { id: 'linkedin', name: 'LinkedIn page', paid: false },
  { id: 'tiktok', name: 'TikTok', paid: false },
  { id: 'jobstreet', name: 'JobStreet', paid: true },
];

/**
 * The connection state of each social channel. Every channel is unconfigured until its account is connected and
 * verified separately (Fauzan gives the account access later). Nothing in Prima flips this to connected.
 */
export function advertChannelState(_channel: AdvertChannel): { connected: false; publishing: 'off'; why: string } {
  return { connected: false, publishing: 'off', why: 'Not connected yet. Publishing is switched off until the account is connected and checked.' };
}

export type VacancyCategory = NonNullable<Vacancy['category']>;

export interface AdvertFacts {
  title: string;
  department: string;
  headcount: number;
  category: VacancyCategory;
  employer: string;
  payFrom: number | null;
  payTo: number | null;
  applyHow: string;
  closingDate: string | null;
}

/** The only job facts a drafter (template or AI) may see. */
export function advertFacts(v: Vacancy, employer: string, applyHow: string, closingDate: string | null): AdvertFacts {
  return {
    title: v.title,
    department: v.department,
    headcount: v.headcount,
    category: v.category ?? 'staff',
    employer,
    payFrom: v.payFrom,
    payTo: v.payTo,
    applyHow,
    closingDate,
  };
}

const MONTHS = {
  bm: ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
/** "20 November 2026" / "20 November 2026" (BM month names), for the public post. */
function dayLabel(iso: string, lang: 'bm' | 'en'): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[lang][m - 1]} ${y}`;
}

const rm = (n: number) => `RM${n.toLocaleString('en-MY')}`;

function payLine(f: AdvertFacts, lang: 'bm' | 'en'): string | null {
  if (f.payFrom == null) return null;
  const range = f.payTo != null && f.payTo !== f.payFrom ? `${rm(f.payFrom)} - ${rm(f.payTo)}` : rm(f.payFrom);
  return lang === 'bm' ? `Gaji: ${range} sebulan` : `Pay: ${range} a month`;
}

/**
 * A deterministic bilingual draft (BM then English) from the job facts. It is used while no AI model is connected,
 * and it is labelled as a template so HR never mistakes it for an AI suggestion.
 */
export function templateAdvert(f: AdvertFacts): string {
  const guardLike = f.category === 'guard' || f.category === 'officer';
  const bm: string[] = [];
  const en: string[] = [];
  bm.push(`JAWATAN KOSONG: ${f.title}${f.headcount > 1 ? ` (${f.headcount} kekosongan)` : ''}`);
  bm.push(`${f.employer}${f.department ? ` · ${f.department}` : ''}`);
  en.push(`WE ARE HIRING: ${f.title}${f.headcount > 1 ? ` (${f.headcount} openings)` : ''}`);
  en.push(`${f.employer}${f.department ? ` · ${f.department}` : ''}`);
  const pb = payLine(f, 'bm');
  const pe = payLine(f, 'en');
  if (pb) bm.push(pb);
  if (pe) en.push(pe);
  if (guardLike) {
    bm.push('Syarat: umur 18 hingga 60 tahun; lulus tapisan keselamatan KDN; latihan CSG disediakan.');
    en.push('Requirements: aged 18 to 60; must pass the KDN security vetting; CSG training provided.');
  }
  bm.push('Caruman KWSP, PERKESO dan SIP mengikut undang-undang.');
  en.push('EPF, SOCSO and EIS contributions as required by law.');
  if (f.applyHow) {
    bm.push(`Cara memohon: ${f.applyHow}`);
    en.push(`How to apply: ${f.applyHow}`);
  }
  if (f.closingDate) {
    bm.push(`Tarikh tutup: ${dayLabel(f.closingDate, 'bm')}`);
    en.push(`Closing date: ${dayLabel(f.closingDate, 'en')}`);
  }
  bm.push('Semua pemohon dinilai secara adil berdasarkan kelayakan.');
  en.push('All applicants are considered fairly on merit.');
  return `${bm.join('\n')}\n\n${en.join('\n')}`;
}

/** A pluggable drafter: an AI model can be connected later; until then the template is used. */
export interface AdvertDrafter {
  readonly origin: 'template' | 'ai';
  draft(f: AdvertFacts): Promise<string>;
}

export const templateDrafter: AdvertDrafter = { origin: 'template', draft: async (f) => templateAdvert(f) };

export interface AdvertCheck {
  level: 'block' | 'warn';
  code: string;
  message: string;
}

// One space, dot or dash may sit between digit groups ("012-345 6789", "012.345.6789"). Each match must stand alone,
// so digits inside a longer number (a date with a time, a company registration number) are not mistaken for one.
const SEP = '[\\s.\\-]?';
const MOBILE = new RegExp(`(?<![\\d+])(?:\\+?60${SEP}|0)1\\d${SEP}\\d{3,4}${SEP}\\d{4}(?!\\d)`, 'g');
const IC = new RegExp(`(?<!\\d)(\\d{2})(\\d{2})(\\d{2})${SEP}\\d{2}${SEP}\\d{4}(?!\\d)`, 'g');

/** Malaysian mobile numbers in the text, as written. */
export function findMobileNumbers(text: string): string[] {
  return [...text.matchAll(MOBILE)].map((m) => m[0]);
}

/**
 * Malaysian IC numbers in the text (YYMMDD-PB-####). The first six digits must be a real month and day, so a
 * 12-digit company registration number such as 201901012345 (month 19) is not taken for an IC.
 */
export function findIcNumbers(text: string): string[] {
  return [...text.matchAll(IC)].filter((m) => {
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  }).map((m) => m[0]);
}

const DISCRIMINATORY: RegExp[] = [
  /\b(melayu|cina|india|bumiputera|chinese|malay|indian)\s+(sahaja|only)\b/i,
  /\b(lelaki|perempuan|wanita|male|female|men|women)\s+(sahaja|only)\b/i,
  /\b(islam|muslim|christian|buddhist|hindu)\s+(sahaja|only)\b/i,
  /\b(cantik|good[- ]looking|pretty|handsome)\b/i,
];

/**
 * Checks the wording before it can be sent for approval. Blocks: personal data that must never be published.
 * Warnings: points the approver should look at (the approver decides).
 */
export function checkAdvert(text: string, f: AdvertFacts, minimumWage: number): AdvertCheck[] {
  const out: AdvertCheck[] = [];
  // The public text is what goes out: the wording plus the "How to apply" line.
  const published = `${text}\n${f.applyHow}`;
  if (findIcNumbers(published).length) out.push({ level: 'block', code: 'ic-number', message: 'Remove the IC number. A post never carries anyone’s IC.' });
  const digits = (x: string) => x.replace(/\D/g, '').replace(/^60/, '0');
  const allowed = new Set(findMobileNumbers(f.applyHow).map(digits));
  if (findMobileNumbers(text).some((m) => !allowed.has(digits(m)))) {
    out.push({ level: 'block', code: 'personal-phone', message: 'Remove the mobile number, or put the company’s official recruitment number in "How to apply".' });
  }
  if (DISCRIMINATORY.some((re) => re.test(`${text}\n${f.applyHow}`))) {
    out.push({ level: 'warn', code: 'discrimination', message: 'The wording limits who may apply by race, religion, sex or looks. Remove it unless the law requires it for this job.' });
  }
  if (f.payFrom != null && f.payFrom < minimumWage) {
    out.push({ level: 'warn', code: 'below-minimum-wage', message: `The pay starts below the minimum wage (${rm(minimumWage)} a month).` });
  }
  if (f.payFrom == null) out.push({ level: 'warn', code: 'no-pay', message: 'No pay is shown. Posts with pay get more suitable applicants.' });
  if (!f.applyHow.trim()) out.push({ level: 'warn', code: 'no-apply', message: 'Say how to apply (an official company email, form or number).' });
  if (f.payFrom != null) {
    // Only figures that read as pay (gaji / pay / salary nearby); allowances such as "elaun RM200" are not pay.
    const amounts = [...text.matchAll(/(gaji|pay|salary|upah)[^\n]{0,20}?RM\s?([\d,]+)(?:\s?-\s?RM\s?([\d,]+))?/gi)]
      .flatMap((m) => [m[2], m[3]].filter(Boolean).map((x) => Number(x.replace(/,/g, ''))));
    if (amounts.some((n) => n > 0 && n < f.payFrom!)) out.push({ level: 'warn', code: 'pay-mismatch', message: 'The post shows a pay figure below the approved range.' });
  }
  return out;
}

export function advertHash(text: string, channels: readonly AdvertChannel[], closingDate: string | null, applyHow: string): string {
  return sha256Hex(JSON.stringify({ text, channels: [...channels].sort(), closingDate, applyHow }));
}

const CHANNEL_HOSTS: Record<AdvertChannel, RegExp> = {
  facebook: /(^|\.)(facebook\.com|fb\.com|fb\.watch)$/i,
  instagram: /(^|\.)instagram\.com$/i,
  linkedin: /(^|\.)linkedin\.com$/i,
  tiktok: /(^|\.)tiktok\.com$/i,
  jobstreet: /(^|\.)jobstreet\.com(\.my)?$/i,
};

/** A recorded post link must be https and on the channel's own site. */
export function advertLinkMatches(channel: AdvertChannel, link: string): boolean {
  try {
    const u = new URL(link);
    return u.protocol === 'https:' && !u.username && !u.password && CHANNEL_HOSTS[channel].test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * For the future publisher (nothing calls it yet): an outbox entry may go out only while the post is approved, the
 * entry carries the approved version and hash, the vacancy is open and the closing date has not passed.
 */
export function advertMayPublish(
  v: Pick<Vacancy, 'status' | 'advert'>,
  entry: { version: number; hash: string; status: string },
  today: string,
): boolean {
  const a = v.advert;
  if (!a || v.status !== 'open' || a.status !== 'approved' || !a.approved) return false;
  if (entry.status !== 'waiting_connection' || entry.version !== a.approved.version || entry.hash !== a.approved.hash) return false;
  return !a.closingDate || a.closingDate >= today;
}
