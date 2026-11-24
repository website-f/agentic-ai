// Company secretary: what Prima opens by itself each year (Director Office study, gaps B1-B3; Fauzan, 23 Nov 2026,
// "Do the gap"). Pure functions: the service decides who may see and runs them inside a transaction.
//
// B1 a company file (corp profile) for every company, made from the company record (SSM number, incorporation date);
//    the year end month starts as December (the group's year ends on 31 December) until the company file says other.
// B2 the annual return and the financial statements filing of each year, worked out from the company file.
// B3 the statutory audit of each year end, with the auditor from the company file.
// Prima only opens and reminds. It never lodges, signs or files anything.
import type { Company, CorpAudit, CorpFiling, CorpProfile, IsoDate } from './types';
import { addDays, daysBetween } from './time';

export interface CorpYearRule {
  annualReturnDays: number;
  fsCirculateMonths: number;
  fsLodgeDays: number;
  /** Open a yearly filing this many days before it is due. */
  openAheadDays: number;
  /** A yearly filing or audit missed by more than this many days is not opened again (it went before Prima). */
  lookBackDays: number;
}

/** The standard papers an auditor asks for (the company may add more on the Audit tab). */
export const AUDIT_PBC_ITEMS = [
  'Trial balance and general ledger',
  'Bank confirmations',
  'Fixed asset register',
  'Payroll and statutory contributions',
  'Debtor ageing and contracts',
];

const monthEnd = (y: number, m: number): IsoDate => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

/** B1: the company file made from the company record. Nothing is invented: missing facts stay empty. */
export function corpProfileFromCompany(c: Company): CorpProfile {
  return {
    id: `cp-${c.id}`,
    companyId: c.id,
    regNo: c.ssmNo ?? '',
    incorporatedOn: c.registeredOn ?? '',
    fyeMonth: 12,
    secretaryFirm: '',
    secretaryLicence: '',
    auditor: '',
    directors: [],
  };
}

/** The incorporation date to use: the company record's, once keyed there (key once), else the company file's. */
export function incorporationOf(p: CorpProfile, c: Company | undefined): IsoDate | null {
  const d = c?.registeredOn || p.incorporatedOn;
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** The latest financial year end on or before today. */
export function latestYearEnd(fyeMonth: number, today: IsoDate): IsoDate {
  const y = Number(today.slice(0, 4));
  const m = fyeMonth >= 1 && fyeMonth <= 12 ? fyeMonth : 12;
  const end = monthEnd(y, m);
  return end <= today ? end : monthEnd(y - 1, m);
}

/** B2: the yearly filings that should be open today and are not on record yet (by id). */
export function dueYearlyFilings(p: CorpProfile, c: Company | undefined, today: IsoDate, have: Set<string>, rule: CorpYearRule): CorpFiling[] {
  const out: CorpFiling[] = [];
  const base = { companyId: p.companyId, status: 'open' as const, prepared: null, lodged: null, receipt: null, changeId: null };
  const inc = incorporationOf(p, c);
  if (inc) {
    const ty = Number(today.slice(0, 4));
    for (const y of [ty - 1, ty, ty + 1]) {
      if (y <= Number(inc.slice(0, 4))) continue;
      let anniv = `${y}${inc.slice(4)}`;
      if (anniv.endsWith('-02-29')) anniv = anniv.replace('-02-29', '-02-28');
      const dueOn = addDays(anniv, rule.annualReturnDays);
      const id = `cf-${p.companyId}-ar-${dueOn.slice(0, 4)}`;
      const ahead = daysBetween(today, dueOn);
      if (have.has(id) || ahead > rule.openAheadDays || ahead < -rule.lookBackDays) continue;
      out.push({
        ...base,
        id,
        kind: 'ANNUAL_RETURN',
        title: `Annual return ${anniv.slice(0, 4)}`,
        dueOn,
        basis: `Within ${rule.annualReturnDays} days after the incorporation anniversary (${anniv}), Companies Act 2016 s.68`,
      });
    }
  }
  const fye = latestYearEnd(p.fyeMonth, today);
  if (!inc || fye > inc) {
    const y = Number(fye.slice(0, 4));
    const m = Number(fye.slice(5, 7));
    const circulateBy = monthEnd(y, m + rule.fsCirculateMonths);
    const dueOn = addDays(circulateBy, rule.fsLodgeDays);
    const id = `cf-${p.companyId}-fs-${dueOn.slice(0, 4)}`;
    if (!have.has(id) && daysBetween(today, dueOn) >= -rule.lookBackDays)
      out.push({
        ...base,
        id,
        kind: 'FINANCIAL_STATEMENTS',
        title: `Financial statements, year ended ${fye}`,
        dueOn,
        basis: `Circulate by ${circulateBy} (s.258), lodge within ${rule.fsLodgeDays} days of circulating (s.259)`,
        fyEnd: fye,
      });
  }
  return out;
}

/** B3: the audit of the latest year end, when it is not on record yet. */
export function dueYearlyAudit(p: CorpProfile, c: Company | undefined, today: IsoDate, have: Set<string>, rule: CorpYearRule): CorpAudit | null {
  const fyEnd = latestYearEnd(p.fyeMonth, today);
  const inc = incorporationOf(p, c);
  if (inc && fyEnd <= inc) return null;
  const id = `audit-${p.companyId}-${fyEnd.slice(0, 4)}`;
  if (have.has(id) || daysBetween(fyEnd, today) > rule.lookBackDays + 180) return null;
  return {
    id,
    companyId: p.companyId,
    fyEnd,
    auditorFirm: p.auditor ?? '',
    fee: null,
    planningOn: null,
    pbc: AUDIT_PBC_ITEMS.map((item, k) => ({ item, dueOn: addDays(fyEnd, 40 + k * 7), receivedOn: null })),
    adjustments: [],
    signed: null,
  };
}

/** The financial statements filing of a year end, ready to circulate once its audit is signed. */
export function fsReadiness(f: CorpFiling, audits: CorpAudit[]): { auditSigned: boolean; auditSignedOn: IsoDate | null } | null {
  if (f.kind !== 'FINANCIAL_STATEMENTS') return null;
  const fyEnd = f.fyEnd ?? f.title.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const a = fyEnd ? audits.find((x) => x.companyId === f.companyId && x.fyEnd === fyEnd) : undefined;
  return { auditSigned: !!a?.signed, auditSignedOn: a?.signed?.on ?? null };
}
