/**
 * JA Group app export formats (Fauzan, 23 Nov 2026, sample files "MonthlySalaryType2.csv"). JA's monthly salary report
 * saves as CSV with report box names for headings (textBox35, txtGross ...) and one line per guard; the first boxes on
 * each line repeat the page totals and are ignored. Worked out from the sample: gross = basic + ADE + OTP + extra OT +
 * ODP + PHP + 31P, and net = gross less EPF, SOCSO, EIS, SOCSO (SKBBK), DED, advance and the absence deduction.
 */

/** The box that holds each figure in "Monthly Salary Type 2". */
export const JA_SALARY_TYPE2 = {
  name: 'textBox1',
  staffNo: 'textBox35',
  basedSite: 'textBox9',
  workingSites: 'textBox79',
  workingDays: 'textBox5',
  absenceDays: 'textBox11',
  allowances: 'textBox20',
  deduction: 'txtDeduct',
  advance: 'txtAdvance',
  net: 'txtTotal',
  basic: 'textBox16',
  epf: 'textBox36',
  socso: 'textBox50',
  eis: 'textBox51',
  extraOt: 'textBox24',
  otPay: 'textBox68',
  offDayPay: 'textBox70',
  holidayPay: 'textBox72',
  day31Pay: 'textBox74',
  socsoSkbbk: 'textBox75',
  gross: 'txtGross',
  absenceDeduction: 'textBox3',
} as const;

/** True when the file's headings are JA's "Monthly Salary Type 2" report boxes. */
export function isJaSalaryType2(headers: string[]): boolean {
  const h = new Set(headers.map((x) => x.trim()));
  return ['txtGross', 'txtTotal', 'txtAdvance', 'textBox35', 'textBox16'].every((k) => h.has(k));
}

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim() || 0);
  return Number.isFinite(n) ? n : NaN;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Turns JA's report lines into Prima's salary upload lines (staffNo, basic, otPay, allowances, epf, socso, eis, otherDeductions, gross, net). */
export function fromJaSalaryType2(rows: Record<string, string>[]): Record<string, string>[] {
  const b = JA_SALARY_TYPE2;
  return rows
    .filter((r) => String(r[b.staffNo] ?? '').trim())
    .map((r) => {
      const otPay = num(r[b.otPay]) + num(r[b.extraOt]) + num(r[b.offDayPay]) + num(r[b.holidayPay]) + num(r[b.day31Pay]);
      const other = num(r[b.deduction]) + num(r[b.advance]) + num(r[b.absenceDeduction]);
      return {
        staffNo: String(r[b.staffNo]).trim(),
        basic: String(num(r[b.basic])),
        otHours: '',
        otPay: String(r2(otPay)),
        allowances: String(num(r[b.allowances])),
        epf: String(num(r[b.epf])),
        socso: String(r2(num(r[b.socso]) + num(r[b.socsoSkbbk]))),
        eis: String(num(r[b.eis])),
        pcb: '',
        otherDeductions: String(r2(other)),
        gross: String(num(r[b.gross])),
        net: String(num(r[b.net])),
        paidOn: '',
      };
    });
}
