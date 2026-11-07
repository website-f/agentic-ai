import { useEffect, useState } from 'react';
import { DEFAULT_PAY_LAW, guardSalaryCalc, standardGuardAmounts, type PayFormulaAmounts, type PayLawSettings } from '@prima/core';
import { api } from '../api';

/**
 * Salary calculator (Fauzan, 6 Nov 2026): for the OM and above, to see how a guard's month is counted and what to
 * expect. Uses the standard guard formula (Fauzan's usual rules), or a guard formula ACT set that is in force this month.
 * Gross pay only; not a payslip.
 */

type Choice = { id: string; name: string; amounts: PayFormulaAmounts };
const rm = (n: number) => `${n < 0 ? '-' : ''}RM${Math.abs(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STANDARD: Choice[] = [2, 2.5, 3].map((r) => ({ id: `std-${r}`, name: `Standard: 12-hour shift, ${r} h rest`, amounts: standardGuardAmounts(r) }));

export function SalaryCalcView() {
  const [choices, setChoices] = useState<Choice[]>(STANDARD);
  const [law, setLaw] = useState<PayLawSettings>(DEFAULT_PAY_LAW);
  const [choiceId, setChoiceId] = useState(STANDARD[0].id);
  const [basic, setBasic] = useState<string>(String(STANDARD[0].amounts.basicMonthly));
  const [v, setV] = useState({ daysWorked: '26', trainingDays: '0', annualLeaveDays: '0', mcDays: '0', holidaysOff: '0', restDaysWorked: '0', publicHolidaysWorked: '0' });

  // The OM and above can also pick a guard formula ACT set that is in force this month, with the CEO's pay law.
  useEffect(() => {
    let live = true;
    api.salaryCalcData().then(
      (d) => {
        if (!live) return;
        setLaw(d.law);
        const mine = d.formulas.map((f) => ({ id: f.id, name: `${f.code}: ${f.name}`, amounts: f.amounts }));
        if (mine.length) setChoices([...STANDARD, ...mine]);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  const choice = choices.find((c) => c.id === choiceId) ?? choices[0];
  const amounts: PayFormulaAmounts = { ...choice.amounts, basicMonthly: Number(basic) > 0 ? Number(basic) : choice.amounts.basicMonthly };
  const n = (k: keyof typeof v) => Math.max(0, Number(v[k]) || 0);
  const r = guardSalaryCalc(amounts, {
    daysWorked: n('daysWorked'),
    trainingDays: n('trainingDays'),
    annualLeaveDays: n('annualLeaveDays'),
    mcDays: n('mcDays'),
    holidaysOff: n('holidaysOff'),
    restDaysWorked: n('restDaysWorked'),
    publicHolidaysWorked: n('publicHolidaysWorked'),
  }, law);
  const field = (k: keyof typeof v, label: string, hint: string) => (
    <label key={k} style={{ display: 'grid', gap: 2 }}>
      <span className="small" style={{ fontWeight: 600 }}>
        {label}
      </span>
      <input className="input" type="number" min={0} max={31} step={1} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      <span className="muted small">{hint}</span>
    </label>
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1>Salary calculator</h1>
        <p className="muted">
          How a guard&apos;s month is counted, step by step, so you know what to expect. Change the days to see the effect. Gross pay only: EPF, SOCSO,
          EIS and PCB are not taken off. Not a payslip; the pay run uses the formula ACT set for the guard&apos;s site.
        </p>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Formula</h2>
        </div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          <label style={{ display: 'grid', gap: 2 }}>
            <span className="small" style={{ fontWeight: 600 }}>
              Formula
            </span>
            <select
              className="input"
              value={choice.id}
              onChange={(e) => {
                const c = choices.find((x) => x.id === e.target.value)!;
                setChoiceId(c.id);
                setBasic(String(c.amounts.basicMonthly));
              }}
            >
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 2 }}>
            <span className="small" style={{ fontWeight: 600 }}>
              Basic pay a month (RM)
            </span>
            <input className="input" type="number" min={0} step={50} value={basic} onChange={(e) => setBasic(e.target.value)} />
            <span className="muted small">Placeholder until ACT sets the real amount.</span>
          </label>
        </div>
        <div className="small" style={{ marginTop: 8 }}>
          Daily rate = basic ÷ {r.divisor} = <b>{rm(r.dailyRate)}</b> · Hourly rate = daily ÷ {amounts.normalHoursPerDay} h = <b>{rm(r.hourlyRate)}</b> · Each
          working day: {amounts.normalHoursPerDay} normal hours + {r.otHoursPerDay} overtime hours ({amounts.shiftHours ?? 12} h shift, {amounts.restHours ?? 0} h
          rest)
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>The guard&apos;s month</h2>
        </div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          {field('daysWorked', 'Working days worked', `Full month is ${r.fullMonthDays} days`)}
          {field('trainingDays', 'Training days', 'Paid as a normal day, no overtime')}
          {field('annualLeaveDays', 'Annual leave days', 'Paid as a normal day, no overtime')}
          {field('mcDays', 'MC days', 'Basic only, with a doctor’s certificate')}
          {field('holidaysOff', 'Public holidays off', 'Paid inside basic pay')}
          {field('restDaysWorked', 'Rest days worked', `${amounts.restDayDays} extra day + overtime ${amounts.otRestDayRate}x`)}
          {field('publicHolidaysWorked', 'Public holidays worked', `${amounts.publicHolidayDays} extra days + overtime ${amounts.otPublicHolidayRate}x`)}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Salary</h2>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{rm(r.gross)}</div>
        </div>
        <table className="table small">
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.label}>
                <td style={{ fontWeight: 600 }}>{l.label}</td>
                <td className="muted">{l.how}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{rm(l.amount)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 700 }}>Gross pay</td>
              <td className="muted">Before EPF, SOCSO, EIS and PCB</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{rm(r.gross)}</td>
            </tr>
          </tbody>
        </table>
        <div className="muted small" style={{ marginTop: 6 }}>
          Paid days {r.paidDays} of {r.fullMonthDays}
          {r.shortDays ? `, ${r.shortDays} short` : ''} · Overtime {r.otHours} h · Hours on duty {r.dutyHours} h (counted in Site man-hours)
        </div>
        {r.notes.map((x) => (
          <p key={x} className="notice small" data-tone="warn">
            {x}
          </p>
        ))}
      </section>
    </div>
  );
}
