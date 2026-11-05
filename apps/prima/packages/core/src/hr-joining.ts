import { RULES } from "./rules";
import { addDays, ageOn, daysBetween } from "./time";
import type {
  HrFiling,
  HrFilingKind,
  Id,
  IsoDate,
  Person,
  StaffPayRun,
} from "./types";

/**
 * HR Phase 3, slice 3B: joining and leaving (Fauzan, 2 Nov 2026). Prima works out what must be filed and by when
 * (the latest day, not an exact day), drafts it from the records, and reminds HR. HR files and records the reference.
 */

export const FILING_LABEL: Record<HrFilingKind, string> = {
  CP22: "CP22 to LHDN (new employee)",
  CP22A: "CP22A to LHDN (employee leaving)",
  EPF_REG: "EPF: add to the monthly contribution (KWSP)",
  SOCSO_REG: "SOCSO and EIS registration (PERKESO)",
  EA: "EA forms to every employee",
  BORANG_E: "Borang E with CP8D to LHDN",
  SH_NOTICE: "Sexual harassment notice displayed at the workplace (s.81H)",
  JKKP8: "JKKP 8 yearly report of accidents and diseases to DOSH",
};

export function serviceYears(hiredOn: IsoDate, on: IsoDate): number {
  return Math.max(0, daysBetween(hiredOn, on) / 365.25);
}

/** Employment Act s.12: notice by length of service, unless the contract gives longer. */
export function noticeWeeks(years: number): number {
  return RULES.hrJoinLeave.value.noticeWeeks.find((x) => years < x.underYears)!
    .weeks;
}

/**
 * Termination and lay-off benefits (Regulations 1980): 10, 15 or 20 days' wages for each year of service, in proportion
 * for a part year, after 12 months of service. The daily rate is the monthly basic divided by 26.
 */
export function terminationBenefit(basic: number, years: number) {
  if (years < 1) return { eligible: false, daysPerYear: 0, amount: 0 };
  const daysPerYear = RULES.hrJoinLeave.value.benefitDays.find(
    (x) => years < x.underYears,
  )!.days;
  const amount = Math.round((basic / 26) * daysPerYear * years * 100) / 100;
  return { eligible: true, daysPerYear, amount };
}

export interface FilingDue {
  id: Id;
  kind: HrFilingKind;
  label: string;
  companyId: Id;
  personId: Id | null;
  name: string | null;
  period: string;
  /** The latest day to file (Fauzan, 2 Nov 2026: the latest date, not the exact date). */
  latestBy: IsoDate;
  filed: HrFiling | null;
  overdue: boolean;
}

function nextMonth15(d: IsoDate): IsoDate {
  const [y, m] = d.split("-").map(Number);
  return m === 12
    ? `${y + 1}-01-15`
    : `${y}-${String(m + 1).padStart(2, "0")}-15`;
}

/** What is due for office staff joining in the last 60 days, leaving soon, and the yearly EA and Borang E. */
export function filingsDue(
  people: Person[],
  filings: HrFiling[],
  today: IsoDate,
): FilingDue[] {
  const r = RULES.hrJoinLeave.value;
  const filed = new Map(filings.map((f) => [f.id, f]));
  const out: FilingDue[] = [];
  const add = (
    kind: HrFilingKind,
    companyId: Id,
    p: Person | null,
    period: string,
    latestBy: IsoDate,
  ) => {
    const id = `${kind}-${p?.id ?? companyId}-${period}`;
    const f = filed.get(id) ?? null;
    out.push({
      id,
      kind,
      label: FILING_LABEL[kind],
      companyId,
      personId: p?.id ?? null,
      name: p?.name ?? null,
      period,
      latestBy,
      filed: f,
      overdue: !f && today > latestBy,
    });
  };
  const office = people.filter((p) => p.role === "office");
  for (const p of office) {
    if (p.hiredOn <= today && daysBetween(p.hiredOn, today) <= 60) {
      add("CP22", p.companyId, p, p.hiredOn, addDays(p.hiredOn, r.cp22Days));
      add(
        "SOCSO_REG",
        p.companyId,
        p,
        p.hiredOn,
        addDays(p.hiredOn, r.socsoRegDays),
      );
      add("EPF_REG", p.companyId, p, p.hiredOn, nextMonth15(p.hiredOn));
    }
    if (p.leaving && p.leaving.lastDayOn >= addDays(today, -30))
      add(
        "CP22A",
        p.companyId,
        p,
        p.leaving.lastDayOn,
        addDays(p.leaving.lastDayOn, -r.cp22aDaysBefore),
      );
  }
  // EA and Borang E for last year, shown from January until filed (or until the end of June).
  const month = Number(today.slice(5, 7));
  if (month <= 6) {
    const year = String(Number(today.slice(0, 4)) - 1);
    const employers = [
      ...new Set(
        office
          .filter(
            (p) =>
              p.hiredOn <= `${year}-12-31` &&
              (!p.leaving || p.leaving.lastDayOn >= `${year}-01-01`),
          )
          .map((p) => p.companyId),
      ),
    ];
    for (const c of employers.sort()) {
      add("EA", c, null, year, `${today.slice(0, 4)}-${r.eaBy}`);
      add("BORANG_E", c, null, year, `${today.slice(0, 4)}-${r.borangEBy}`);
    }
  }
  // Employment Act s.81H: a sexual harassment notice is displayed at every workplace at all times. HR confirms it
  // once a year for each employer with office staff (slice 3E).
  const thisYear = today.slice(0, 4);
  for (const c of [...new Set(office.filter((p) => p.status === "active").map((p) => p.companyId))].sort())
    add("SH_NOTICE", c, null, thisYear, `${thisYear}-01-31`);
  // NADOPOD Regulations 2004 reg. 6: the JKKP 8 yearly summary of last year's accidents, poisonings and diseases
  // goes to DOSH by 31 January (Fauzan, 2 Nov 2026: OSH for office staff). Shown January to June until recorded.
  if (month <= 6)
    for (const c of [...new Set(office.filter((p) => p.status === "active").map((p) => p.companyId))].sort())
      add("JKKP8", c, null, String(Number(thisYear) - 1), `${thisYear}-01-31`);
  return out.sort(
    (a, b) =>
      Number(!!a.filed) - Number(!!b.filed) ||
      a.latestBy.localeCompare(b.latestBy),
  );
}

/** EA form figures for each staff member of an employer for a year, from the paid staff payroll runs. */
export function eaFigures(runs: StaffPayRun[], companyId: Id, year: string) {
  const paid = runs.filter(
    (r) =>
      r.companyId === companyId &&
      r.period.startsWith(year) &&
      r.stage === "paid",
  );
  const by = new Map<
    Id,
    {
      personId: Id;
      staffNo: string;
      name: string;
      gross: number;
      epf: number;
      socsoEis: number;
      pcb: number;
      months: number;
    }
  >();
  for (const run of paid)
    for (const l of run.lines) {
      const x = by.get(l.personId) ?? {
        personId: l.personId,
        staffNo: l.staffNo,
        name: l.name,
        gross: 0,
        epf: 0,
        socsoEis: 0,
        pcb: 0,
        months: 0,
      };
      x.gross += l.gross;
      x.epf += l.epfEe;
      x.socsoEis += l.socsoEe + l.eisEe;
      x.pcb += l.pcb;
      x.months += 1;
      by.set(l.personId, x);
    }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    runs: paid.length,
    rows: [...by.values()]
      .sort((a, b) => a.staffNo.localeCompare(b.staffNo))
      .map((x) => ({
        ...x,
        gross: r2(x.gross),
        epf: r2(x.epf),
        socsoEis: r2(x.socsoEis),
        pcb: r2(x.pcb),
      })),
  };
}

/** Office staff whose probation ends within the reminder days (or has passed) with no decision since. */
export function probationsDue(people: Person[], today: IsoDate) {
  const d = RULES.hrJoinLeave.value.probationRemindDays;
  return people
    .filter(
      (p) =>
        p.role === "office" &&
        p.status === "active" &&
        p.employmentType === "probation" &&
        p.probationEndsOn &&
        p.probationEndsOn <= addDays(today, d),
    )
    .map((p) => ({
      person: p,
      endsOn: p.probationEndsOn!,
      overdue: p.probationEndsOn! < today,
    }));
}

/** Office staff reaching the retirement age within the reminder days, or past it (same rule as guards for now). */
export function retirementsDue(people: Person[], today: IsoDate) {
  const r = RULES.hrJoinLeave.value;
  return people
    .filter(
      (p) =>
        p.role === "office" &&
        p.status === "active" &&
        p.dob &&
        ageOn(p.dob, addDays(today, r.retireRemindDays)) >= r.retireAge,
    )
    .map((p) => ({
      person: p,
      age: ageOn(p.dob, today),
      over: ageOn(p.dob, today) >= r.retireAge,
    }));
}
