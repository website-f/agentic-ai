import { AccessDenied } from "./access";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { finRegularDues } from "./finance-regular";
import { finRegularState } from "./finance-regular";
import { addDays } from "./time";
import { daysBetween } from "./time";
import type { FinSettingsValues } from "./types";
import type { FinSign } from "./types";
import type { FinStatus } from "./types";
import type { IsoDate } from "./types";


export interface FinTaxItem {
  key: string;
  dueOn: IsoDate;
  what: string;
  body: 'LHDN' | 'Customs' | 'KWSP' | 'PERKESO' | 'HRD Corp' | 'SSM' | 'Zakat';
  law: string;
  /** done: Prima saw it done, or Finance marked it filed; due: within the warning days; late: past due; upcoming. */
  status: 'done' | 'due' | 'late' | 'upcoming';
  doneBy: string | null;
}

export interface FinTaxFiling {
  key: string;
  filedOn: IsoDate;
  ref: string;
  sign: FinSign;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
const ym = (y: number, m: number) => {
  const d = new Date(Date.UTC(y, m - 1, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
};

/** Days before a deadline it shows as due. */
export const FIN_TAX_WARN_DAYS = 14;

/**
 * Every deadline in a calendar year for one company. `fyEnd` is MM-DD of the financial year end (31 December for the
 * group's companies, Fauzan 2 Nov 2026).
 */
export function finTaxDeadlines(f: Pick<FinStatus, 'fyEnd' | 'sst' | 'einvoice'>, year: number): Omit<FinTaxItem, 'status' | 'doneBy'>[] {
  const [fm] = f.fyEnd.split('-').map(Number);
  const out: Omit<FinTaxItem, 'status' | 'doneBy'>[] = [];
  for (let m = 1; m <= 12; m++) {
    const due15 = `${year}-${pad(m)}-15`;
    const prev = ym(year, m - 1);
    const wage = `${prev.y}-${pad(prev.m)}`;
    out.push({ key: `cp204:${year}-${pad(m)}`, dueOn: due15, what: `CP204 tax instalment for ${year}-${pad(m)}`, body: 'LHDN', law: 'Income Tax Act 1967 s.107C(9): by the 15th of each month of the basis period' });
    out.push({ key: `epf:${wage}`, dueOn: due15, what: `EPF contributions for ${wage} wages`, body: 'KWSP', law: 'EPF Act 1991 s.43 and Regulations: by the 15th of the following month' });
    out.push({ key: `perkeso:${wage}`, dueOn: due15, what: `SOCSO, EIS and LINDUNG contributions for ${wage} wages`, body: 'PERKESO', law: 'Act 4 and Act 800: by the 15th of the following month' });
    out.push({ key: `pcb:${wage}`, dueOn: due15, what: `PCB (monthly tax deductions) for ${wage} wages`, body: 'LHDN', law: 'Income Tax (Deduction from Remuneration) Rules 1994: by the 15th of the following month' });
    out.push({ key: `hrd:${wage}`, dueOn: due15, what: `HRD Corp levy for ${wage} wages`, body: 'HRD Corp', law: 'PSMB Act 2001: by the 15th of the following month' });
    if (f.einvoice?.setup?.required)
      out.push({ key: `einv:${wage}`, dueOn: `${year}-${pad(m)}-07`, what: `Consolidated e-Invoice for ${wage} sales`, body: 'LHDN', law: 'LHDN e-Invoice Guideline: within 7 days after the month' });
  }
  // SST-02: two-month taxable periods from the company's cycle; due the last day of the month after the period.
  if (f.sst?.registered) {
    const start = f.sst.cycleStartMonth || 1;
    for (let k = -1; k < 7; k++) {
      const a = ym(year, start + 2 * k);
      const b = ym(year, start + 2 * k + 1);
      const d = ym(b.y, b.m + 1);
      const dueOn = lastDay(d.y, d.m);
      if (dueOn.slice(0, 4) !== String(year)) continue;
      out.push({ key: `sst:${a.y}-${pad(a.m)}`, dueOn, what: `SST-02 return and payment for ${a.y}-${pad(a.m)} to ${b.y}-${pad(b.m)}`, body: 'Customs', law: 'Service Tax Act 2018 s.26: by the last day of the month after the taxable period' });
    }
  }
  const add = (dueOn: IsoDate, x: Omit<FinTaxItem, 'status' | 'doneBy' | 'dueOn'>) => {
    if (dueOn.slice(0, 4) === String(year)) out.push({ ...x, dueOn });
  };
  // Each financial year end gives the audit, SSM and Form C dates (for a 31 December year end: circulate by 30 June,
  // lodge by 31 July, Form C by 31 July of the next year). The two year ends that can fall due this calendar year.
  for (const y of [year - 1, year]) {
    const fe = `${y}-${f.fyEnd}`;
    const plus = (months: number) => {
      const t = ym(y, fm + months);
      return lastDay(t.y, t.m);
    };
    add(plus(6), { key: `circulate:${fe}`, what: `Audited accounts for the year ended ${fe} circulated to members`, body: 'SSM', law: 'Companies Act 2016 s.258: within 6 months after the financial year end' });
    add(plus(7), { key: `lodge:${fe}`, what: `Financial statements for the year ended ${fe} lodged with SSM`, body: 'SSM', law: 'Companies Act 2016 s.259: within 30 days after circulation' });
    add(plus(7), { key: `formc:${fe}`, what: `Form C (company tax return) for the year ended ${fe}`, body: 'LHDN', law: 'Income Tax Act 1967 s.77A: within 7 months after the financial year end' });
    // CP204 estimate for the basis period starting the day after this year end: 30 days before it starts; revisions in
    // the 6th, 9th and 11th month of the basis period.
    const start = addDays(fe, 1);
    add(addDays(start, -30), { key: `cp204est:${start}`, what: `CP204 tax estimate for the year starting ${start}`, body: 'LHDN', law: 'Income Tax Act 1967 s.107C(2): 30 days before the basis period starts' });
    for (const mth of [6, 9, 11]) {
      const t = ym(y, fm + mth);
      add(lastDay(t.y, t.m), { key: `cp204a:${start}:${mth}`, what: `CP204A revised estimate, month ${mth} of the year starting ${start} (if the estimate changed)`, body: 'LHDN', law: 'Income Tax Act 1967 s.107C(4): in the 6th, 9th and 11th month' });
    }
  }
  // Employer returns.
  add(`${year}-02-28`, { key: `ea:${year - 1}`, what: `EA forms to every employee for ${year - 1}`, body: 'LHDN', law: 'Income Tax Act 1967 s.83(1A): by the last day of February' });
  add(`${year}-03-31`, { key: `forme:${year - 1}`, what: `Form E (employer return) for ${year - 1}`, body: 'LHDN', law: 'Income Tax Act 1967 s.83(1): by 31 March' });
  add(`${year}-03-31`, { key: `cp58:${year - 1}`, what: `CP58 to agents and dealers paid commissions in ${year - 1}`, body: 'LHDN', law: 'Income Tax Act 1967 s.83A: by 31 March' });
  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.key.localeCompare(b.key));
}

/** The calendar with what Prima can see is done and what Finance marked filed. */
export function finTaxCalendar(f: FinStatus, year: number, today: IsoDate, s: Pick<FinSettingsValues, 'matchDays'>): FinTaxItem[] {
  const filings = f.taxFilings ?? [];
  const regularPaid = (body: string, period: string) =>
    (f.regular ?? []).some((r) => r.body === body && r.status !== 'pending' && finRegularDues(r, addDays(today, 40)).some((d) => d.period === period && finRegularState(f, r, d, today, s) === 'paid'));
  return finTaxDeadlines(f, year).map((x) => {
    const [kind, rest] = [x.key.split(':')[0], x.key.slice(x.key.indexOf(':') + 1)];
    let doneBy: string | null = null;
    const filed = filings.find((y) => y.key === x.key);
    if (filed) doneBy = `${filed.sign.by}, ${filed.filedOn} (${filed.ref})`;
    // What Prima sees for itself.
    const payPeriod = x.dueOn.slice(0, 7);
    if (!doneBy && kind === 'sst') {
      const r = f.sst?.returns.find((y) => y.from === rest && y.filed);
      if (r?.filed) doneBy = `Filed in MySST ${r.filed.filedOn} (${r.filed.ackRef})`;
    }
    if (!doneBy && kind === 'einv') {
      const m = f.einvoice?.months.find((y) => y.period === rest && y.consolidated);
      if (m?.consolidated) doneBy = `Submitted ${m.consolidated.submittedOn}`;
    }
    const body = { epf: 'EPF', perkeso: 'PERKESO', pcb: 'LHDN PCB', hrd: 'HRD Corp', cp204: 'LHDN CP204' }[kind];
    if (!doneBy && body && regularPaid(body, payPeriod)) doneBy = 'Paid from the regular payments list';
    const status: FinTaxItem['status'] = doneBy ? 'done' : today > x.dueOn ? 'late' : daysBetween(today, x.dueOn) <= FIN_TAX_WARN_DAYS ? 'due' : 'upcoming';
    return { ...x, status, doneBy };
  });
}

/** Finance marks a deadline filed with the acknowledgement or receipt reference. */
export function finTaxFile(f: FinStatus, input: Record<string, unknown>, sign: FinSign, canAct: boolean) {
  if (!canAct) throw new AccessDenied('view', '(Finance staff record filings)');
  const year = Number(String(input.key ?? '').match(/\d{4}/)?.[0]);
  const item = Number.isFinite(year) ? [year - 1, year, year + 1].flatMap((y) => finTaxDeadlines(f, y)).find((x) => x.key === input.key) : null;
  if (!item) throw new NotFound('Deadline');
  const ref = String(input.ref ?? '').trim().slice(0, 80);
  if (ref.length < 3) throw new BadRequest('Give the acknowledgement, receipt or reference number from the portal.');
  const filedOn = String(input.filedOn ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedOn) || filedOn > sign.at.slice(0, 10)) throw new BadRequest('Give the date it was filed (not in the future).');
  const filing: FinTaxFiling = { key: item.key, filedOn, ref, sign };
  return {
    patch: { taxFilings: [...(f.taxFilings ?? []).filter((x) => x.key !== item.key), filing] },
    action: 'finance.tax.filed',
    summary: `${item.what} (due ${item.dueOn}) marked filed on ${filedOn}, reference ${ref}${filedOn > item.dueOn ? ' (after the due date)' : ''}.`,
    result: filing,
  };
}

/**
 * Automation A16 (Fauzan, 2 Nov 2026): fills a new payee from the supplier's validated e-Invoice as MyInvois returns it
 * (UBL 2.1 JSON or XML): the supplier's registered name, TIN, business registration number and address. Bank details are
 * never on an e-Invoice; they are still typed in and verified by a call-back from a second person.
 */
export function finPayeeFromEInvoice(doc: string): { name: string | null; tin: string | null; brn: string | null; address: string | null } {
  if (typeof doc !== 'string' || !doc.trim() || doc.length > 400_000) throw new BadRequest('Paste the e-Invoice document from MyInvois (JSON or XML).');
  const t = doc.trim();
  if (t.startsWith('{')) {
    let j: unknown;
    try {
      j = JSON.parse(t);
    } catch {
      throw new BadRequest('That is not valid JSON.');
    }
    const val = (x: unknown): string | null => {
      if (x == null) return null;
      if (typeof x === 'string') return x;
      if (Array.isArray(x)) return val(x[0]);
      if (typeof x === 'object' && '_' in (x as Record<string, unknown>)) return String((x as Record<string, unknown>)._);
      return null;
    };
    const find = (o: unknown, key: string): unknown => {
      if (!o || typeof o !== 'object') return undefined;
      if (Array.isArray(o)) {
        for (const x of o) {
          const r = find(x, key);
          if (r !== undefined) return r;
        }
        return undefined;
      }
      const rec = o as Record<string, unknown>;
      if (key in rec) return rec[key];
      for (const v of Object.values(rec)) {
        const r = find(v, key);
        if (r !== undefined) return r;
      }
      return undefined;
    };
    const party = find(find(j, 'AccountingSupplierParty'), 'Party');
    if (!party) throw new BadRequest('No supplier (AccountingSupplierParty) found in the e-Invoice.');
    const ids = (find(party, 'PartyIdentification') as unknown[] | undefined) ?? [];
    const idOf = (scheme: string) => {
      for (const p of ids) {
        const id = (p as Record<string, unknown>).ID;
        const first = Array.isArray(id) ? id[0] : id;
        if (first && typeof first === 'object' && (first as Record<string, unknown>).schemeID === scheme) return val(first);
      }
      return null;
    };
    const addr = find(party, 'PostalAddress');
    const lines = ((find(addr, 'AddressLine') as unknown[] | undefined) ?? []).map((l) => val(find(l, 'Line'))).filter(Boolean);
    const city = val(find(addr, 'CityName'));
    const zip = val(find(addr, 'PostalZone'));
    return {
      name: val(find(find(party, 'PartyLegalEntity'), 'RegistrationName')),
      tin: idOf('TIN'),
      brn: idOf('BRN'),
      address: [...lines, [zip, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
    };
  }
  // XML: read the supplier block with simple patterns (no external entities are ever resolved).
  const block = /<cac:AccountingSupplierParty>([\s\S]*?)<\/cac:AccountingSupplierParty>/.exec(t)?.[1];
  if (!block) throw new BadRequest('No supplier (AccountingSupplierParty) found in the e-Invoice.');
  const id = (scheme: string) => new RegExp(`<cbc:ID[^>]*schemeID="${scheme}"[^>]*>([^<]+)</cbc:ID>`).exec(block)?.[1]?.trim() ?? null;
  return {
    name: /<cbc:RegistrationName>([^<]+)<\/cbc:RegistrationName>/.exec(block)?.[1]?.trim() ?? null,
    tin: id('TIN'),
    brn: id('BRN'),
    address: [...block.matchAll(/<cbc:Line>([^<]+)<\/cbc:Line>/g)].map((m) => m[1].trim()).join(', ') || null,
  };
}