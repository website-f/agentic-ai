import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DEFAULT_PAY_LAW, standardGuardAmounts, type PayFormulaAmounts, type PayLawSettings } from '@prima/core';
import { api } from '../api';
import { Select } from '../SearchSelect';
import { printHtml } from '../native';
import { tr, useLang, type Lang } from '../i18n';
import {
  START_ABOUT,
  START_DAYS,
  basicProblem,
  dayCount,
  dayProblem,
  parseAmount,
  rm,
  salaryCalcModel,
  type About,
  type DayKey,
  type Days,
  type StatLine,
} from './salary-calc-model';
import '../styles/salary-calc.css';

/**
 * Salary calculator (Fauzan, 6 Nov 2026): for the OM and above, to see how a guard's month is counted and what to
 * expect. Uses the standard guard formula (Fauzan's usual rules), or a guard formula ACT set that is in force this month.
 * Not a payslip.
 *
 * P97 (Fitri, 11 Nov 2026: "fields are not organized and look chaotic"): laid out as a payslip is read, in steps
 * (formula and month, days, earnings, deductions, employer's share) with the totals kept in view: a summary beside the
 * steps on a computer, a bar at the bottom on a phone. The sums are unchanged (salary-calc-model.ts says how).
 */

type Choice = { id: string; name: string; amounts: PayFormulaAmounts };
const STANDARD: Choice[] = [2, 2.5, 3].map((r) => ({ id: `std-${r}`, name: `Standard: 12-hour shift, ${r} h rest`, amounts: standardGuardAmounts(r) }));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthText = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ''} ${ym.slice(0, 4)}`;
const thisMonth = () => {
  const d = new Date(Date.now() + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const twoDp = (n: number) => n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DAY_FIELDS: { k: DayKey; label: string; group: 'duty' | 'off'; required?: boolean }[] = [
  { k: 'daysWorked', label: 'Working days worked', group: 'duty', required: true },
  { k: 'restDaysWorked', label: 'Rest days worked', group: 'duty' },
  { k: 'publicHolidaysWorked', label: 'Public holidays worked', group: 'duty' },
  { k: 'trainingDays', label: 'Training days', group: 'off' },
  { k: 'annualLeaveDays', label: 'Annual leave days', group: 'off' },
  { k: 'mcDays', label: 'MC days', group: 'off' },
  { k: 'holidaysOff', label: 'Public holidays off', group: 'off' },
];

/** One numbered step of the calculator. */
function Step({ n, id, title, help, children, aside }: { n: number; id: string; title: string; help?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="sc-step" aria-labelledby={`${id}-h`} id={id}>
      <header className="sc-step-head">
        <span className="sc-step-no" aria-hidden="true">
          {n}
        </span>
        <div className="sc-step-title">
          <h2 id={`${id}-h`}>{title}</h2>
          {help && <p>{help}</p>}
        </div>
        {aside && <div className="sc-step-aside">{aside}</div>}
      </header>
      <div className="sc-step-body">{children}</div>
    </section>
  );
}

/** Money lines as a payslip lists them: what, how it is counted, and the amount on the right. */
function Lines({ rows, total, minus }: { rows: { key: string; label: string; how?: string; amount: number; note?: string }[]; total: { label: string; amount: number }; minus?: boolean }) {
  return (
    <div className="sc-lines" role="list">
      {rows.map((l) => (
        <div key={l.key} className="sc-line" role="listitem">
          <span className="sc-line-text">
            <span className="sc-line-label">{l.label}</span>
            {l.how && <span className="sc-line-how">{l.how}</span>}
          </span>
          {l.note && !l.amount ? (
            <span className="sc-line-note">{l.note}</span>
          ) : (
            <span className="sc-amt" data-minus={(minus && l.amount > 0) || l.amount < 0 || undefined}>
              {minus && l.amount > 0 ? rm(-l.amount) : rm(l.amount)}
            </span>
          )}
        </div>
      ))}
      <div className="sc-line sc-line-total" role="listitem">
        <span className="sc-line-label">{total.label}</span>
        <span className="sc-amt">{minus && total.amount > 0 ? rm(-total.amount) : rm(total.amount)}</span>
      </div>
    </div>
  );
}

/** The estimate as a payslip-style page to print or save, in the screen's language. */
function printable(lang: Lang, x: { formula: string; month: string; m: ReturnType<typeof salaryCalcModel>; days: [string, number][]; settings: string }): string {
  const t = (s: string) => tr(s, lang).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
  const row = (label: string, amount: string, how?: string, cls = '') =>
    `<tr class="${cls}"><td>${t(label)}${how ? `<div class="how">${t(how)}</div>` : ''}</td><td class="amt">${amount}</td></tr>`;
  const stat = (l: StatLine, minus: boolean) => row(l.label, l.note && !l.amount ? t(l.note) : minus && l.amount > 0 ? rm(-l.amount) : rm(l.amount), l.how);
  const { m } = x;
  return `<!doctype html><html lang="${lang === 'en' ? 'en' : 'ms'}"><head><meta charset="utf-8"><title>${t('Salary estimate')}</title><style>
body{font:13px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#121a17;margin:32px;max-width:720px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#5a6762;margin:22px 0 6px}
.meta{color:#5a6762;margin:0 0 4px}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #d9e1dd;vertical-align:top}
.amt{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;padding-left:16px}.how{color:#5a6762;font-size:11px}
.total td{font-weight:700;border-bottom:2px solid #121a17}.net td{font-size:16px;font-weight:700;border:0;padding-top:12px}
.days{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 16px}.days div{display:flex;justify-content:space-between;border-bottom:1px dotted #d9e1dd}
.foot{margin-top:24px;color:#5a6762;font-size:11px}
</style></head><body>
<h1>${t('Salary estimate')}</h1>
<p class="meta">${t(x.formula)} · ${t('Pay law')}: ${t(x.month)} · ${t('Basic pay')}: ${rm(m.amounts.basicMonthly)}</p>
<p class="meta">${t('Estimate only. Not a payslip.')}</p>
<h2>${t('Days in the month')}</h2><div class="days">${x.days.map(([k, v]) => `<div><span>${t(k)}</span><b>${v}</b></div>`).join('')}</div>
<h2>${t('Earnings')}</h2><table>${m.calc.lines.map((l) => row(l.label, rm(l.amount), l.how)).join('')}${row('Gross pay', rm(m.calc.gross), undefined, 'total')}</table>
<h2>${t('Deductions')}</h2><table>${m.deductions.map((l) => stat(l, true)).join('')}${row('Total deductions', rm(-m.totalDeductions), undefined, 'total')}</table>
<table>${row('Net pay', rm(m.net), undefined, 'net')}</table>
<h2>${t('Employer pays on top')}</h2><table>${m.employer.map((l) => stat(l, false)).join('')}${row('Employer cost', rm(m.employerCost), 'Gross pay and the employer’s share', 'total')}</table>
<p class="foot">${t(x.settings)} ${t('Deductions are estimates at the standard statutory rates; the pay run uses the CEO’s statutory settings for the month, and PCB comes from LHDN’s e-PCB.')}</p>
</body></html>`;
}

export function SalaryCalcView() {
  const { lang } = useLang();
  const [choices, setChoices] = useState<Choice[]>(STANDARD);
  const [law, setLaw] = useState<PayLawSettings>(DEFAULT_PAY_LAW);
  const [settingsState, setSettingsState] = useState<'loading' | 'current' | 'unavailable'>('loading');
  const [month, setMonth] = useState<string>(thisMonth());
  const [choiceId, setChoiceId] = useState(STANDARD[0].id);
  const [basic, setBasic] = useState<string>(twoDp(STANDARD[0].amounts.basicMonthly));
  const [v, setV] = useState<Days>(START_DAYS);
  const [about, setAbout] = useState<About>(START_ABOUT);
  const [attempt, setAttempt] = useState(0);

  // The OM and above can also pick a guard formula ACT set that is in force this month, with the CEO's pay law.
  useEffect(() => {
    let live = true;
    api.salaryCalcData().then(
      (d) => {
        if (!live) return;
        setLaw(d.law);
        setSettingsState('current');
        if (d.month) setMonth(d.month);
        const mine = d.formulas.map((f) => ({ id: f.id, name: `${f.code}: ${f.name}`, amounts: f.amounts }));
        if (mine.length) setChoices([...STANDARD, ...mine]);
      },
      () => {
        if (live) setSettingsState('unavailable');
      },
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const choice = choices.find((c) => c.id === choiceId) ?? choices[0];
  const m = salaryCalcModel(choice.amounts, basic, v, law, about, month);
  const r = m.calc;
  const amounts = m.amounts;
  const bp = basicProblem(basic);
  const setDay = (k: DayKey, val: string) => setV({ ...v, [k]: val });
  const bump = (k: DayKey, by: number) => setDay(k, String(Math.min(31, Math.max(0, Math.round(dayCount(v[k])) + by))));
  const onDayKey = (k: DayKey) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      bump(k, e.key === 'ArrowUp' ? 1 : -1);
    }
  };
  const hint: Record<DayKey, string> = {
    daysWorked: `Full month is ${r.fullMonthDays} days`,
    trainingDays: 'Paid as a normal day, no overtime',
    annualLeaveDays: 'Paid as a normal day, no overtime',
    mcDays: 'Basic only, with a doctor’s certificate',
    holidaysOff: 'Paid inside basic pay',
    restDaysWorked: `${amounts.restDayDays} extra day + overtime ${amounts.otRestDayRate}x`,
    publicHolidaysWorked: `${amounts.publicHolidayDays} extra days + overtime ${amounts.otPublicHolidayRate}x`,
  };
  const reset = () => {
    setChoiceId(STANDARD[0].id);
    setBasic(twoDp(STANDARD[0].amounts.basicMonthly));
    setV(START_DAYS);
    setAbout(START_ABOUT);
  };
  const settingsLine =
    settingsState === 'current'
      ? 'Current pay law and formulas in force this month.'
      : settingsState === 'loading'
        ? 'Default pay law: current settings were still loading.'
        : 'Default pay law: current settings were unavailable.';
  const print = () =>
    void printHtml(
      tr('Salary estimate', lang),
      printable(lang, {
        formula: choice.name,
        month: monthText(month),
        m,
        days: DAY_FIELDS.map((f) => [f.label, dayCount(v[f.k])] as [string, number]),
        settings: settingsLine,
      }),
    );
  const paidPct = Math.min(100, Math.round((r.paidDays / Math.max(1, r.fullMonthDays)) * 100));
  const aboutText = [about.nationality === 'MY' ? 'Malaysian' : 'Nepali (foreign worker)', about.ageGroup === 'from60' ? '60 or over' : 'Under 60', ...(about.nationality === 'MY' && about.lindungOptOut ? ['LINDUNG opted out'] : [])].join(' · ');

  const dayField = (f: (typeof DAY_FIELDS)[number]) => {
    const problem = dayProblem(v[f.k]);
    const id = `sc-${f.k}`;
    return (
      <div key={f.k} className="sc-field">
        <label htmlFor={id} className="sc-label">
          {f.label}
          {f.required && <span className="sc-req">Required</span>}
        </label>
        <div className="sc-stepper" data-invalid={problem ? '' : undefined}>
          <button type="button" className="sc-stepper-btn" tabIndex={-1} aria-label="One day less" onClick={() => bump(f.k, -1)} disabled={dayCount(v[f.k]) <= 0}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 8h9" />
            </svg>
          </button>
          <input
            id={id}
            className="sc-input sc-num"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="next"
            value={v[f.k]}
            required={f.required}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-hint`}
            onChange={(e) => setDay(f.k, e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={() => !String(v[f.k]).trim() && setDay(f.k, '0')}
            onKeyDown={onDayKey(f.k)}
          />
          <span className="sc-unit sc-unit-after" aria-hidden="true">
            days
          </span>
          <button type="button" className="sc-stepper-btn" tabIndex={-1} aria-label="One day more" onClick={() => bump(f.k, 1)} disabled={dayCount(v[f.k]) >= 31}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 8h9M8 3.5v9" />
            </svg>
          </button>
        </div>
        <span id={`${id}-hint`} className={problem ? 'sc-error' : 'sc-hint'} role={problem ? 'alert' : undefined}>
          {problem ?? hint[f.k]}
        </span>
      </div>
    );
  };

  return (
    <div className="page sc-page">
      <header className="k-head sc-head">
        <div className="k-head-text">
          <h1>Salary calculator</h1>
          <p className="k-head-sub">
            How a guard&apos;s month is counted, step by step, so you know what to expect. Change the days to see the effect. Not a payslip; the pay run uses the
            formula ACT set for the guard&apos;s site.
          </p>
        </div>
        <div className="k-head-actions">
          <button type="button" className="btn btn-ghost" onClick={reset}>
            Start again
          </button>
          <button type="button" className="btn" onClick={print}>
            Print estimate
          </button>
        </div>
      </header>

      {settingsState !== 'current' && (
        <div role="status" className="notice sc-status" data-tone="warn">
          <span>
            {settingsState === 'loading'
              ? 'Checking current pay settings. Figures below are estimates using default settings, not verified current settings.'
              : 'Current pay settings are unavailable. Figures below are estimates using default settings, not the approved current pay law or site formula. Do not use this estimate to approve or pay wages.'}
          </span>
          {settingsState === 'unavailable' && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setSettingsState('loading');
                setAttempt(attempt + 1);
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}

      <div className="sc-layout">
        <div className="sc-main">
          <Step n={1} id="sc-formula" title="Formula and month" help="The pay formula sets the rates. Basic pay starts at the formula’s amount; change it to try another.">
            <div className="sc-grid sc-grid-2">
              <div className="sc-field">
                <label htmlFor="sc-choice" className="sc-label">
                  Formula<span className="sc-req">Required</span>
                </label>
                <Select
                  id="sc-choice"
                  className="input"
                  value={choice.id}
                  onChange={(e) => {
                    const c = choices.find((x) => x.id === e.target.value)!;
                    setChoiceId(c.id);
                    setBasic(twoDp(c.amounts.basicMonthly));
                  }}
                >
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <span className="sc-hint">{choices.length > STANDARD.length ? 'Standard formulas and the ACT formulas in force this month' : 'Standard formulas. ACT formulas in force show here too.'}</span>
              </div>
              <div className="sc-field">
                <label htmlFor="sc-basic" className="sc-label">
                  Basic pay a month<span className="sc-req">Required</span>
                </label>
                <div className="sc-money" data-invalid={bp ? '' : undefined}>
                  <span className="sc-unit" aria-hidden="true">
                    RM
                  </span>
                  <input
                    id="sc-basic"
                    className="sc-input sc-num"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    enterKeyHint="next"
                    required
                    value={basic}
                    aria-invalid={bp ? true : undefined}
                    aria-describedby="sc-basic-hint"
                    onChange={(e) => setBasic(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onBlur={() => {
                      const n = parseAmount(basic);
                      if (Number.isFinite(n) && n > 0) setBasic(twoDp(n));
                    }}
                  />
                </div>
                <span id="sc-basic-hint" className={bp ? 'sc-error' : 'sc-hint'} role={bp ? 'alert' : undefined}>
                  {bp ?? 'Placeholder until ACT sets the real amount.'}
                </span>
              </div>
            </div>
            <dl className="sc-derived" aria-label="Worked out from the formula">
              <div>
                <dt>Daily rate</dt>
                <dd>{rm(r.dailyRate)}</dd>
                <dd className="sc-derived-how">{`Basic ÷ ${r.divisor}`}</dd>
              </div>
              <div>
                <dt>Hourly rate</dt>
                <dd>{rm(r.hourlyRate)}</dd>
                <dd className="sc-derived-how">{`Daily ÷ ${amounts.normalHoursPerDay} h`}</dd>
              </div>
              <div>
                <dt>Each working day</dt>
                <dd>{`${amounts.normalHoursPerDay} h + ${r.otHoursPerDay} h overtime`}</dd>
                <dd className="sc-derived-how">{`${amounts.shiftHours ?? 12} h shift, ${amounts.restHours ?? 0} h rest`}</dd>
              </div>
              <div>
                <dt>Pay law</dt>
                <dd>{monthText(month)}</dd>
                <dd className="sc-derived-how">{settingsState === 'current' ? 'In force this month' : 'Default settings'}</dd>
              </div>
            </dl>
          </Step>

          <Step n={2} id="sc-days" title="Days in the month" help="Type a number or use − and +. Leave a field at 0 when there were none.">
            <div className="sc-group" role="group" aria-labelledby="sc-duty-h">
              <span className="sc-group-title" id="sc-duty-h">
                Days on duty
              </span>
              <div className="sc-grid sc-grid-3">{DAY_FIELDS.filter((f) => f.group === 'duty').map(dayField)}</div>
            </div>
            <div className="sc-group" role="group" aria-labelledby="sc-off-h">
              <span className="sc-group-title" id="sc-off-h">
                Paid days off
              </span>
              <div className="sc-grid sc-grid-4">{DAY_FIELDS.filter((f) => f.group === 'off').map(dayField)}</div>
            </div>
            <div className="sc-tally">
              <div className="sc-meter" role="meter" aria-label="Paid days" aria-valuemin={0} aria-valuemax={r.fullMonthDays} aria-valuenow={r.paidDays}>
                <span style={{ width: `${paidPct}%` }} />
              </div>
              <dl className="sc-tally-facts">
                <div>
                  <dt>Paid days</dt>
                  <dd>{`${r.paidDays} / ${r.fullMonthDays}`}</dd>
                </div>
                <div data-tone={r.shortDays ? 'warn' : undefined}>
                  <dt>Short days</dt>
                  <dd>{r.shortDays}</dd>
                </div>
                <div>
                  <dt>Overtime</dt>
                  <dd>{`${r.otHours} h`}</dd>
                </div>
                <div>
                  <dt>Hours on duty</dt>
                  <dd>{`${r.dutyHours} h`}</dd>
                </div>
              </dl>
            </div>
            {r.notes.map((x) => (
              <p key={x} className="notice small" data-tone="warn">
                {x}
              </p>
            ))}
          </Step>

          <Step n={3} id="sc-earn" title="Earnings" help="Worked out from the formula and the days. Hours on duty count in Site man-hours.">
            <Lines rows={r.lines.map((l) => ({ ...l, key: l.label }))} total={{ label: 'Gross pay', amount: r.gross }} />
          </Step>

          <Step n={4} id="sc-deduct" title="Deductions" help="An estimate at the standard statutory rates. The pay run uses the CEO’s statutory settings for the month; PCB comes from LHDN’s e-PCB.">
            <details className="sc-about">
              <summary>
                <span className="sc-about-label">Who the estimate is for</span>
                <span className="sc-about-value">{aboutText}</span>
              </summary>
              <div className="sc-about-body">
                <div className="sc-field">
                  <span className="sc-label" id="sc-nat-l">
                    Nationality
                  </span>
                  <div className="seg sc-seg" role="group" aria-labelledby="sc-nat-l">
                    <button type="button" aria-pressed={about.nationality === 'MY'} onClick={() => setAbout({ ...about, nationality: 'MY' })}>
                      Malaysian
                    </button>
                    <button type="button" aria-pressed={about.nationality === 'NP'} onClick={() => setAbout({ ...about, nationality: 'NP' })}>
                      Nepali (foreign worker)
                    </button>
                  </div>
                </div>
                <div className="sc-field">
                  <span className="sc-label" id="sc-age-l">
                    Age
                  </span>
                  <div className="seg sc-seg" role="group" aria-labelledby="sc-age-l">
                    <button type="button" aria-pressed={about.ageGroup === 'under60'} onClick={() => setAbout({ ...about, ageGroup: 'under60' })}>
                      Under 60
                    </button>
                    <button type="button" aria-pressed={about.ageGroup === 'from60'} onClick={() => setAbout({ ...about, ageGroup: 'from60' })}>
                      60 or over
                    </button>
                  </div>
                </div>
                {about.nationality === 'MY' && (
                  <label className="sc-check">
                    <input type="checkbox" checked={about.lindungOptOut} onChange={(e) => setAbout({ ...about, lindungOptOut: e.target.checked })} />
                    <span>Opted out of LINDUNG 24 Jam (form on file)</span>
                  </label>
                )}
              </div>
            </details>
            <Lines rows={m.deductions} total={{ label: 'Total deductions', amount: m.totalDeductions }} minus />
            <div className="sc-net">
              <span>Net pay</span>
              <strong className="sc-amt">{rm(m.net)}</strong>
            </div>
          </Step>

          <Step n={5} id="sc-employer" title="Employer pays on top" help="Not taken from the guard’s pay. Employer cost is gross pay plus these.">
            <Lines rows={m.employer} total={{ label: 'Employer’s share', amount: m.totalEmployer }} />
            <div className="sc-net sc-net-quiet">
              <span>Employer cost</span>
              <strong className="sc-amt">{rm(m.employerCost)}</strong>
            </div>
          </Step>
        </div>

        <aside className="sc-summary" id="sc-summary" aria-labelledby="sc-summary-h">
          <div className="sc-sum-card">
            <h2 id="sc-summary-h" className="sc-sum-title">
              Estimate
            </h2>
            <p className="sc-sum-formula">{choice.name}</p>
            <div className="sc-sum-net">
              <span>Net pay</span>
              <strong>{rm(m.net)}</strong>
            </div>
            <dl className="sc-sum-rows">
              <div>
                <dt>Gross pay</dt>
                <dd>{rm(r.gross)}</dd>
              </div>
              <div>
                <dt>Deductions</dt>
                <dd data-minus={m.totalDeductions > 0 || undefined}>{rm(-m.totalDeductions)}</dd>
              </div>
              <div className="sc-sum-sep">
                <dt>Employer cost</dt>
                <dd>{rm(m.employerCost)}</dd>
              </div>
            </dl>
            <p className="sc-sum-facts">
              <span>
                Paid days <b>{`${r.paidDays} / ${r.fullMonthDays}`}</b>
              </span>
              <span>
                Overtime <b>{`${r.otHours} h`}</b>
              </span>
            </p>
            <button type="button" className="btn sc-sum-print" onClick={print}>
              Print estimate
            </button>
            <p className="sc-sum-foot">Estimate only. Not a payslip. Nothing is saved.</p>
          </div>
        </aside>
      </div>

      <div className="sc-bar" role="region" aria-label="Pay summary">
        <div className="sc-bar-main">
          <span className="sc-bar-label">Net pay</span>
          <strong className="sc-bar-net">{rm(m.net)}</strong>
        </div>
        <div className="sc-bar-sub">
          <span>
            Gross <b>{rm(r.gross)}</b>
          </span>
          <span>
            Deductions <b>{rm(-m.totalDeductions)}</b>
          </span>
        </div>
        <button
          type="button"
          className="btn btn-sm sc-bar-go"
          aria-label="Summary"
          title="Summary"
          onClick={() => document.getElementById('sc-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6.5l4 4 4-4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
