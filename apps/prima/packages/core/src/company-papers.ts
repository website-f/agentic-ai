import { RULES } from './rules';
import { addDays, daysBetween } from './time';
import type { CompanyLicence, Id, IsoDate, IsoDateTime, LicenceType, TenderChannel } from './types';

/**
 * Company paper library (Fauzan, 22-23 Nov 2026, Marketing tender desk item AH7; "Build", 23 Nov 2026): the papers a
 * tender asks for that are not licences, kept once per company with their dates, so Marketing does not ask the company
 * again for every bid. Licences (KDN, MOF, MOF digital certificate, Bumiputera status, SSM annual return, LHDN TCC,
 * CIDB, PIKM, insurance) stay in the licence register and are only read here.
 *
 * Copies of directors' identity cards are NOT kept here (personal data): the company gives them for a bid only.
 */
export type CompanyPaperKind =
  | 'SSM_FORMS'
  | 'SSM_PROFILE'
  | 'COMPANY_PROFILE'
  | 'BANK_STATEMENT'
  | 'AUDITED_ACCOUNTS'
  | 'BANK_LETTER'
  | 'EPF_REGISTRATION'
  | 'SOCSO_REGISTRATION'
  | 'SST_REGISTRATION'
  | 'PPKKM_MEMBERSHIP'
  | 'EXPERIENCE_LETTER'
  | 'ORG_CHART'
  | 'OTHER';

export interface CompanyPaper {
  id: Id;
  companyId: Id;
  kind: CompanyPaperKind;
  title: string;
  /** BANK_STATEMENT: the month, YYYY-MM. AUDITED_ACCOUNTS: the financial year, YYYY. Otherwise null. */
  period: string | null;
  issuedOn: IsoDate | null;
  /** Only for papers that expire (bank letter, PPKKM membership, SSM company search, OTHER when it has a date). */
  expiresOn: IsoDate | null;
  docIds: Id[];
  note: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  /** A newer copy of the same paper (same kind and period) replaced this one. Nothing is deleted. */
  replacedBy?: Id | null;
}

export const PAPER_LABEL: Record<CompanyPaperKind, string> = {
  SSM_FORMS: 'SSM forms (Section 14, 58 and 78, or Form 9, 24 and 49)',
  SSM_PROFILE: 'SSM company search (latest)',
  COMPANY_PROFILE: 'Company profile',
  BANK_STATEMENT: 'Bank statement (one month)',
  AUDITED_ACCOUNTS: 'Audited accounts (one year)',
  BANK_LETTER: 'Bank letter or credit facility letter',
  EPF_REGISTRATION: 'EPF employer registration',
  SOCSO_REGISTRATION: 'SOCSO employer registration',
  SST_REGISTRATION: 'SST registration',
  PPKKM_MEMBERSHIP: 'PPKKM membership',
  EXPERIENCE_LETTER: 'Past contract or experience letter',
  ORG_CHART: 'Organisation chart',
  OTHER: 'Other paper',
};
export const PAPER_KINDS = Object.keys(PAPER_LABEL) as CompanyPaperKind[];
/** Papers that carry an end date. */
export const PAPER_EXPIRES: ReadonlySet<CompanyPaperKind> = new Set(['SSM_PROFILE', 'BANK_LETTER', 'PPKKM_MEMBERSHIP', 'OTHER']);

export type PaperReady = 'OK' | 'DUE' | 'EXPIRED' | 'MISSING';
export interface PaperNeed {
  key: string;
  label: string;
  /** Where it is kept: the paper library, or the licence register (read only here). */
  source: 'paper' | 'licence';
  state: PaperReady;
  detail: string;
  expiresOn: IsoDate | null;
}

const LICENCE_NAME: Partial<Record<LicenceType, string>> = {
  KDN_LICENCE: 'KDN licence',
  MOF_REGISTRATION: 'MOF registration',
  MOF_DIGITAL_CERT: 'MOF digital certificate',
  BUMIPUTERA_STATUS: 'Bumiputera status',
  SSM_ANNUAL_RETURN: 'SSM annual return',
  LHDN_TCC: 'LHDN tax compliance certificate',
  CIDB: 'CIDB',
  PIKM_MEMBERSHIP: 'PIKM membership',
  INSURANCE: 'Insurance',
};

const ym = (d: IsoDate) => d.slice(0, 7);
function prevMonth(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number);
  const t = y * 12 + (mo - 1) - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** The months of bank statements a bid needs: the last full months before this one. */
export function statementMonths(today: IsoDate): string[] {
  const n = RULES.tenderPapers.value.bankStatementMonths;
  return Array.from({ length: n }, (_, i) => prevMonth(ym(today), i + 1));
}

/** The financial years of audited accounts a bid needs (the year ends 31 December; accounts are ready from July). */
export function accountYears(today: IsoDate): string[] {
  const r = RULES.tenderPapers.value;
  const y = Number(today.slice(0, 4));
  const latest = Number(today.slice(5, 7)) >= r.accountsReadyMonth ? y - 1 : y - 2;
  return Array.from({ length: r.auditedAccountYears }, (_, i) => String(latest - i));
}

function dated(expiresOn: IsoDate | null, today: IsoDate, until: IsoDate): { state: PaperReady; detail: string } {
  if (!expiresOn) return { state: 'OK', detail: 'No end date' };
  if (expiresOn < until) return { state: 'EXPIRED', detail: expiresOn < today ? `Expired ${expiresOn}` : `Expires ${expiresOn}, before the closing date` };
  const left = daysBetween(today, expiresOn);
  return left <= RULES.tenderPapers.value.warnDays ? { state: 'DUE', detail: `Expires ${expiresOn} (${left} days)` } : { state: 'OK', detail: `Valid to ${expiresOn}` };
}

/**
 * What a bid usually needs from the company, and whether each is on file and in date (to the closing date when one is
 * given). The tender papers decide; this only says what is ready. Unknown or missing is never shown as ready.
 */
export function paperNeeds(
  papers: CompanyPaper[],
  licences: CompanyLicence[],
  channel: TenderChannel,
  today: IsoDate,
  closesOn: IsoDate | null = null,
): PaperNeed[] {
  const r = RULES.tenderPapers.value;
  const until = closesOn && closesOn > today ? closesOn : today;
  const live = papers.filter((p) => !p.replacedBy);
  const out: PaperNeed[] = [];
  for (const type of channel === 'GOVERNMENT' ? r.governmentLicences : r.privateLicences) {
    const l = licences.find((x) => x.type === type);
    const label = LICENCE_NAME[type] ?? type;
    if (!l || !l.expiresOn) out.push({ key: `lic-${type}`, label, source: 'licence', state: 'MISSING', detail: 'No record in the licence register', expiresOn: null });
    else out.push({ key: `lic-${type}`, label, source: 'licence', ...dated(l.expiresOn, today, until), expiresOn: l.expiresOn });
  }
  for (const kind of channel === 'GOVERNMENT' ? r.governmentPapers : r.privatePapers) {
    if (kind === 'BANK_STATEMENT') {
      const need = statementMonths(today);
      const have = new Set(live.filter((p) => p.kind === 'BANK_STATEMENT').map((p) => p.period));
      const gone = need.filter((m) => !have.has(m));
      // The newest month's statement often comes in the first days of the month: shown as due, not missing, until the 15th.
      const late = gone.length === 1 && gone[0] === need[0] && Number(today.slice(8, 10)) <= 15;
      out.push({
        key: 'BANK_STATEMENT',
        label: `Bank statements, last ${need.length} months`,
        source: 'paper',
        state: gone.length === 0 ? 'OK' : late ? 'DUE' : 'MISSING',
        detail: gone.length ? `Missing ${gone.slice().reverse().join(', ')}` : `On file ${need.slice().reverse().join(', ')}`,
        expiresOn: null,
      });
      continue;
    }
    if (kind === 'AUDITED_ACCOUNTS') {
      const need = accountYears(today);
      const have = new Set(live.filter((p) => p.kind === 'AUDITED_ACCOUNTS').map((p) => p.period));
      const gone = need.filter((y) => !have.has(y));
      out.push({
        key: 'AUDITED_ACCOUNTS',
        label: `Audited accounts, ${need.length} years`,
        source: 'paper',
        state: gone.length ? 'MISSING' : 'OK',
        detail: gone.length ? `Missing ${gone.join(', ')}` : `On file ${need.join(', ')}`,
        expiresOn: null,
      });
      continue;
    }
    const p = live
      .filter((x) => x.kind === kind)
      .sort((a, b) => (b.issuedOn ?? b.at).localeCompare(a.issuedOn ?? a.at))[0];
    if (!p) {
      out.push({ key: kind, label: PAPER_LABEL[kind], source: 'paper', state: 'MISSING', detail: 'Not in the library', expiresOn: null });
      continue;
    }
    if (kind === 'SSM_PROFILE' && !p.expiresOn && p.issuedOn) {
      // A company search is only accepted when recent.
      const until2 = addDays(p.issuedOn, r.ssmSearchFreshDays);
      out.push({ key: kind, label: PAPER_LABEL[kind], source: 'paper', ...dated(until2, today, until), expiresOn: until2 });
      continue;
    }
    out.push({ key: kind, label: PAPER_LABEL[kind], source: 'paper', ...dated(p.expiresOn, today, until), expiresOn: p.expiresOn });
  }
  return out;
}

/** The gaps in words, for a tender row: missing or expired first, then due. */
export function paperGaps(needs: PaperNeed[]): string[] {
  return needs.filter((n) => n.state !== 'OK').map((n) => `${n.label}: ${n.state === 'DUE' ? n.detail.toLowerCase() : n.state === 'EXPIRED' ? n.detail.toLowerCase() : 'missing'}${n.state === 'MISSING' && n.detail.startsWith('Missing') ? ` (${n.detail.toLowerCase()})` : ''}`);
}
