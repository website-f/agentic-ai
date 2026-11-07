import { useState } from 'react';
import { api, type PayFormulaBoard, type PayFormulaSaveInput } from '../api';
import { Chip, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * Pay formulas (Fauzan, 5 Nov 2026): the ACT Director sets the guard salary formula for the whole group, a region, a
 * company or a site, starting with a full month of 12-hour shifts with 2, 2.5 or 3 hours of rest a day, and the driver
 * overtime formula. The ACT team prepares amount changes; the ACT Director makes them live. Group leadership sees.
 */

type Row = PayFormulaBoard['formulas'][number];
type Formula = Row['formula'];
type Kind = Formula['kind'];
type Amounts = Formula['amounts'];
type Scope = PayFormulaBoard['uses'][number]['use']['scope'];

const KIND: Record<Kind, string> = { guard_shift: 'Guard salary (shift)', driver_ot: 'Driver overtime', staff_ot: 'Staff overtime' };
const SCOPE: Record<Scope, string> = { group: 'Whole group', region: 'Region', company: 'Company', site: 'Site' };
const SCOPES: Record<Kind, Scope[]> = { guard_shift: ['group', 'region', 'company', 'site'], driver_ot: ['group', 'region', 'company'], staff_ot: ['group', 'region', 'company'] };
const STATUS: Record<Formula['status'], [string, 'ok' | 'warn' | 'crit' | 'info']> = {
  draft: ['Waiting for the ACT Director', 'warn'],
  live: ['Set live', 'ok'],
  rejected: ['Sent back', 'crit'],
  withdrawn: ['Withdrawn', 'info'],
};
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

export function PayFormulasView() {
  const { data, error } = useLoad(() => api.payFormulaBoard(), []);
  const [editing, setEditing] = useState<{ from: Formula | null; kind: Kind } | null>(null);
  if (error)
    return (
      <div className="page">
        <h1>Pay formulas</h1>
        <p className="muted">Only ACT and group leadership see the pay formulas.</p>
      </div>
    );
  if (!data) return <Loading what="pay formulas" />;
  const act = data.role === 'director' || data.role === 'team';
  const drafts = data.formulas.filter((r) => r.formula.status === 'draft');
  const live = data.formulas.filter((r) => r.formula.status === 'live');
  const old = data.formulas.filter((r) => r.formula.status === 'rejected' || r.formula.status === 'withdrawn');
  return (
    <div className="page">
      <div className="page-head">
        <h1>Pay formulas</h1>
        <p className="muted">
          How guard salary and driver overtime are counted. The ACT Director sets each formula and decides where it is used: the whole group, a
          region, a company or a site. The narrowest one wins. The ACT team can prepare amount changes for the Director. Group leadership sees
          everything here.
        </p>
        <p className="small">
          {data.role === 'director'
            ? data.canSetLaw
              ? 'You are the CEO: you set formulas, where they are used, and the pay law settings.'
              : 'You are the ACT Director: you set formulas and where they are used.'
            : data.role === 'team'
              ? 'You are in ACT: you prepare amount changes; the ACT Director makes them live.'
              : 'You can see the formulas. ACT sets them.'}
        </p>
        <p className="notice" data-tone="info">
          Test data. The amounts are placeholders (minimum wage, no allowances) until ACT sets the real ones. The ACT Director&apos;s amounts are
          saved as chosen; labour law points are flagged here and to the CEO. A formula counts pay; it does not pay anyone.
        </p>
        {!data.ready && (
          <p className="notice" data-tone="warn">
            Pay formulas are not switched on in this database yet. Nothing can be saved until the pay formulas module is installed with approval.
          </p>
        )}
      </div>

      {act && data.ready && !editing && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className="btn btn-sm" onClick={() => setEditing({ from: null, kind: 'guard_shift' })}>
            New guard salary formula
          </button>
          <button className="btn btn-sm" onClick={() => setEditing({ from: null, kind: 'driver_ot' })}>
            New driver overtime formula
          </button>
          <button className="btn btn-sm" onClick={() => setEditing({ from: null, kind: 'staff_ot' })}>
            New staff overtime formula
          </button>
        </div>
      )}
      {editing && <FormulaForm data={data} from={editing.from} kind={editing.kind} onDone={() => setEditing(null)} />}

      {drafts.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Changes waiting for the ACT Director</h2>
            <Chip tone="warn">{String(drafts.length)}</Chip>
          </div>
          <div className="list">
            {drafts.map((r) => (
              <FormulaCard key={r.formula.id} r={r} data={data} onEdit={(f) => setEditing({ from: f, kind: f.kind })} />
            ))}
          </div>
        </section>
      )}

      <Uses data={data} />
      <Checker data={data} />
      <LawSettings data={data} />

      <section className="panel">
        <div className="panel-head">
          <h2>Formulas</h2>
        </div>
        <div className="list">
          {live.length === 0 && <div className="empty">No formula is set yet.</div>}
          {live.map((r) => (
            <FormulaCard key={r.formula.id} r={r} data={data} onEdit={(f) => setEditing({ from: f, kind: f.kind })} />
          ))}
          {old.map((r) => (
            <FormulaCard key={r.formula.id} r={r} data={data} onEdit={(f) => setEditing({ from: f, kind: f.kind })} />
          ))}
        </div>
      </section>
      <p className="muted small">
        Rule {data.rule.id}: {data.rule.source}
      </p>
      <p className="muted small">
        Rule {data.restRule.id}: {data.restRule.source}
      </p>
    </div>
  );
}

function amountSummary(kind: Kind, a: Amounts): string {
  const base = `Basic ${rm(a.basicMonthly)} · ${a.normalHoursPerDay} normal hours a day, ${a.workDaysPerWeek} days a week · overtime ${a.otNormalRate}x, rest day ${a.otRestDayRate}x, public holiday ${a.otPublicHolidayRate}x`;
  if (kind === 'guard_shift')
    return `${a.shiftHours}-hour shift, ${a.restHours} hours rest${a.restRelieved ? ' (relieved, unpaid)' : ' (not relieved, paid)'} · full month ${a.fullMonthDays} days · ${base}`;
  const extras = [a.otMealAllowance ? `meal ${rm(a.otMealAllowance)} after ${a.mealAfterHours} hours` : '', a.outstationPerNight ? `outstation ${rm(a.outstationPerNight)} a night` : '']
    .filter(Boolean)
    .join(' · ');
  return `${base}${extras ? ` · ${extras}` : ''}`;
}

function FormulaCard({ r, data, onEdit }: { r: Row; data: PayFormulaBoard; onEdit: (f: Formula) => void }) {
  const f = r.formula;
  const [open, setOpen] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [note, setNote] = useState('');
  const act = useAction();
  const [label, tone] = STATUS[f.status];
  const isAct = data.role === 'director' || data.role === 'team';
  const usedAt = data.uses.filter((u) => u.current && u.use.formulaCode === f.code).map((u) => u.placeName);
  const flags = f.status === 'draft' || r.inForce ? r.check.flags : f.lawFlags;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {f.name} · {f.code} v{f.version}
          </div>
          <div className="muted small">
            {KIND[f.kind]} · from {f.effectiveFrom}
            {r.inForce ? ' · in force this month' : f.status === 'live' && f.effectiveFrom > data.month ? ' · starts later' : f.status === 'live' ? ' · replaced' : ''}
          </div>
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      <div className="small">{amountSummary(f.kind, f.amounts)}</div>
      {f.amounts.fixedAllowances.length > 0 && (
        <div className="small">Fixed allowances: {f.amounts.fixedAllowances.map((x) => `${x.label} ${rm(x.amount)}`).join(', ')}</div>
      )}
      {usedAt.length > 0 && <div className="small">Used for: {usedAt.join(', ')}</div>}
      <div className="muted small">
        Prepared by {f.preparedBy} {dateTimeLabel(f.preparedAt)}: {f.reason}
        {f.decidedBy && f.decidedById !== f.preparedById ? ` · ${label} by ${f.decidedBy}${f.decisionNote ? `: ${f.decisionNote}` : ''}` : ''}
      </div>
      {flags.length > 0 && (
        <div className="notice" data-tone="warn" style={{ margin: 0 }}>
          <div style={{ fontWeight: 600 }}>Labour law flags (shown to the CEO)</div>
          <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
            {flags.map((x) => (
              <li key={x} className="small">
                {x}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(!open)}>
          {open ? 'Hide the worked month' : 'Show a worked month'}
        </button>
        {isAct && data.ready && f.status === 'live' && (
          <button className="btn btn-sm" onClick={() => onEdit(f)}>
            Change amounts
          </button>
        )}
        {data.role === 'director' && data.ready && f.status === 'draft' && !deciding && (
          <button className="btn btn-sm btn-primary" onClick={() => setDeciding(true)}>
            Decide
          </button>
        )}
        {r.mine && data.ready && f.status === 'draft' && (
          <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.withdrawPayFormula(f.id), 'Withdrawn.')}>
            Withdraw
          </button>
        )}
      </div>
      {deciding && (
        <>
          <input className="input" style={{ width: '100%', boxSizing: 'border-box' }} aria-label="Reason for your decision" placeholder="Reason for your decision (required)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.decidePayFormula(f.id, true, note), 'Set. The formula is live from its month.')}>
              Set it live
            </button>
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.decidePayFormula(f.id, false, note), 'Sent back.')}>
              Send back
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setDeciding(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
      <ErrorNotice error={act.error} />
      {open && <Worked example={r.example} kind={f.kind} />}
    </div>
  );
}

function Worked({ example, kind }: { example: Row['example']; kind: Kind }) {
  return (
    <div>
      <div className="muted small">
        {kind === 'guard_shift'
          ? 'A full month: every normal working day, no rest days or public holidays worked.'
          : 'Example: 20 overtime hours on working days and 2 rest days worked.'}{' '}
        Daily rate {rm(example.dailyRate)} (basic / 26), hourly rate {rm(example.hourlyRate)} (daily / normal hours), {example.otHours} overtime hours.
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Quantity</th>
              <th>Rate</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {example.lines.map((l) => (
              <tr key={l.label}>
                <td>{l.label}</td>
                <td>{l.qty == null ? '' : `${l.qty} ${l.unit}${l.qty === 1 ? '' : 's'}`}</td>
                <td>{l.rate == null ? '' : rm(l.rate)}</td>
                <td style={{ textAlign: 'right' }}>{rm(l.amount)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} style={{ fontWeight: 600 }}>
                Gross before EPF, SOCSO, EIS and tax
              </td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{rm(example.gross)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {example.overOtCap && <div className="small">More than 104 overtime hours this month: over the monthly overtime limit.</div>}
    </div>
  );
}

const NUM_FIELDS: { k: keyof Amounts; label: string; step: string; kinds: Kind[] }[] = [
  { k: 'basicMonthly', label: 'Basic pay a month (RM)', step: '0.01', kinds: ['guard_shift', 'driver_ot', 'staff_ot'] },
  { k: 'shiftHours', label: 'Shift length (hours)', step: '0.5', kinds: ['guard_shift'] },
  { k: 'restHours', label: 'Rest in the shift (hours)', step: '0.5', kinds: ['guard_shift'] },
  { k: 'fullMonthDays', label: 'Days counted as a full month', step: '1', kinds: ['guard_shift'] },
  { k: 'normalHoursPerDay', label: 'Normal hours a day', step: '0.5', kinds: ['guard_shift', 'driver_ot', 'staff_ot'] },
  { k: 'workDaysPerWeek', label: 'Working days a week', step: '0.5', kinds: ['guard_shift', 'driver_ot', 'staff_ot'] },
  { k: 'otNormalRate', label: 'Overtime, working day (x hourly)', step: '0.1', kinds: ['guard_shift', 'driver_ot', 'staff_ot'] },
  { k: 'otRestDayRate', label: 'Overtime, rest day (x hourly)', step: '0.1', kinds: ['guard_shift', 'driver_ot', 'staff_ot'] },
  { k: 'otPublicHolidayRate', label: 'Overtime, public holiday (x hourly)', step: '0.1', kinds: ['guard_shift', 'driver_ot', 'staff_ot'] },
  { k: 'restDayDays', label: 'Rest day worked (extra days’ wages)', step: '0.5', kinds: ['guard_shift', 'driver_ot', 'staff_ot'] },
  { k: 'publicHolidayDays', label: 'Public holiday worked (extra days’ wages)', step: '0.5', kinds: ['guard_shift', 'driver_ot', 'staff_ot'] },
  { k: 'otMealAllowance', label: 'Overtime meal allowance (RM a day, 0 = none)', step: '0.01', kinds: ['driver_ot', 'staff_ot'] },
  { k: 'mealAfterHours', label: 'Meal allowance after (overtime hours)', step: '0.5', kinds: ['driver_ot', 'staff_ot'] },
  { k: 'outstationPerNight', label: 'Outstation allowance (RM a night, 0 = none)', step: '0.01', kinds: ['driver_ot', 'staff_ot'] },
];

const BLANK: Record<Kind, Amounts> = {
  guard_shift: { basicMonthly: 1700, normalHoursPerDay: 7.5, workDaysPerWeek: 6, otNormalRate: 1.5, otRestDayRate: 2, otPublicHolidayRate: 3, restDayDays: 1, publicHolidayDays: 2, fixedAllowances: [], shiftHours: 12, restHours: 2, restRelieved: true, fullMonthDays: 26, multiSite: 'main_site', holidaysArePaidDays: true, deductShortDays: true, epfOnRestHolidayPay: true },
  driver_ot: { basicMonthly: 1700, normalHoursPerDay: 8, workDaysPerWeek: 5.5, otNormalRate: 1.5, otRestDayRate: 2, otPublicHolidayRate: 3, restDayDays: 1, publicHolidayDays: 2, fixedAllowances: [], otMealAllowance: 0, mealAfterHours: 3, outstationPerNight: 0 },
  staff_ot: { basicMonthly: 1700, normalHoursPerDay: 8, workDaysPerWeek: 5.5, otNormalRate: 1.5, otRestDayRate: 2, otPublicHolidayRate: 3, restDayDays: 1, publicHolidayDays: 2, fixedAllowances: [], otMealAllowance: 0, mealAfterHours: 3, outstationPerNight: 0 },
};

function FormulaForm({ data, from, kind, onDone }: { data: PayFormulaBoard; from: Formula | null; kind: Kind; onDone: () => void }) {
  const [name, setName] = useState(from?.name ?? '');
  const [month, setMonth] = useState(from ? (from.effectiveFrom > data.month ? from.effectiveFrom : nextMonth(data.month)) : nextMonth(data.month));
  const [a, setA] = useState<Amounts>(() => JSON.parse(JSON.stringify(from?.amounts ?? BLANK[kind])) as Amounts);
  const [reason, setReason] = useState('');
  const act = useAction();
  const director = data.role === 'director';
  const set = (k: keyof Amounts, v: string) => setA({ ...a, [k]: v === '' ? ('' as unknown as number) : Number(v) });
  const save = () => {
    const input: PayFormulaSaveInput = { code: from?.code ?? null, kind, name, effectiveFrom: month, amounts: a, reason };
    return act.run(() => api.savePayFormula(input), director ? 'Set. The formula is live from its month.' : 'Saved for the ACT Director to decide.').then((r) => {
      if (r) onDone();
    });
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{from ? `Change ${from.code}: new version` : `New ${KIND[kind].toLowerCase()} formula`}</h2>
      </div>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        <label className="small" style={{ display: 'grid', gap: 4 }}>
          Name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 12-hour shift, 2 hours rest" />
        </label>
        <label className="small" style={{ display: 'grid', gap: 4 }}>
          Starts from (month)
          <input className="input" type="month" min={data.month} value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        {NUM_FIELDS.filter((x) => x.kinds.includes(kind)).map((x) => (
          <label key={x.k} className="small" style={{ display: 'grid', gap: 4 }}>
            {x.label}
            <input className="input" type="number" inputMode="decimal" min="0" step={x.step} value={String(a[x.k] ?? '')} onChange={(e) => set(x.k, e.target.value)} />
          </label>
        ))}
      </div>
      {kind === 'guard_shift' && (
        <label className="small row" style={{ gap: 6, marginTop: 8 }}>
          <input type="checkbox" checked={!!a.restRelieved} onChange={(e) => setA({ ...a, restRelieved: e.target.checked })} />
          The guard is relieved from the post during the rest (a relief guard covers, or the guard may leave). Untick if the guard stays at the post: the rest is then paid.
        </label>
      )}
      {kind === 'guard_shift' && (
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          <div className="small" style={{ fontWeight: 600 }}>
            Guard pay run
          </div>
          <label className="small" style={{ display: 'grid', gap: 4, maxWidth: 420 }}>
            A month at more than one site
            <select className="input" value={a.multiSite ?? 'main_site'} onChange={(e) => setA({ ...a, multiSite: e.target.value as 'main_site' | 'per_site' })}>
              <option value="main_site">Pay the whole month on the main site's formula</option>
              <option value="per_site">Pay each day's overtime and extra pay at its own site's formula</option>
            </select>
          </label>
          <label className="small row" style={{ gap: 6 }}>
            <input type="checkbox" checked={a.holidaysArePaidDays !== false} onChange={(e) => setA({ ...a, holidaysArePaidDays: e.target.checked })} />
            Public holidays are paid days in the month, worked or not
          </label>
          <label className="small row" style={{ gap: 6 }}>
            <input type="checkbox" checked={a.deductShortDays !== false} onChange={(e) => setA({ ...a, deductShortDays: e.target.checked })} />
            Deduct days short of the full month at the daily rate (untick: only approved unpaid leave is deducted)
          </label>
          <label className="small row" style={{ gap: 6 }}>
            <input type="checkbox" checked={a.epfOnRestHolidayPay !== false} onChange={(e) => setA({ ...a, epfOnRestHolidayPay: e.target.checked })} />
            Rest-day and holiday day pay count as EPF wages (overtime never does)
          </label>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <div className="small" style={{ fontWeight: 600 }}>
          Fixed allowances
        </div>
        {a.fixedAllowances.map((x, i) => (
          <div key={i} className="row" style={{ gap: 6, marginTop: 4 }}>
            <input
              className="input"
              aria-label="Allowance name"
              placeholder="Allowance name"
              value={x.label}
              onChange={(e) => setA({ ...a, fixedAllowances: a.fixedAllowances.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })}
            />
            <input
              className="input"
              aria-label="Allowance amount (RM)"
              type="number"
              min="0"
              step="0.01"
              value={String(x.amount)}
              onChange={(e) => setA({ ...a, fixedAllowances: a.fixedAllowances.map((y, j) => (j === i ? { ...y, amount: Number(e.target.value) } : y)) })}
            />
            <button className="btn btn-sm btn-ghost" onClick={() => setA({ ...a, fixedAllowances: a.fixedAllowances.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        {a.fixedAllowances.length < 10 && (
          <button className="btn btn-sm btn-ghost" style={{ marginTop: 4 }} onClick={() => setA({ ...a, fixedAllowances: [...a.fixedAllowances, { label: '', amount: 0 }] })}>
            Add allowance
          </button>
        )}
      </div>
      <label className="small" style={{ display: 'grid', gap: 4, marginTop: 8 }}>
        Reason (kept with the formula)
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this formula or change" />
      </label>
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={save}>
          {director ? 'Set it live' : 'Send to the ACT Director'}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function Uses({ data }: { data: PayFormulaBoard }) {
  const [kind, setKind] = useState<Kind>('guard_shift');
  const [scope, setScope] = useState<Scope>('site');
  const [scopeId, setScopeId] = useState('');
  const [code, setCode] = useState('');
  const [month, setMonth] = useState(nextMonth(data.month));
  const [reason, setReason] = useState('');
  const [showOld, setShowOld] = useState(false);
  const act = useAction();
  const director = data.role === 'director' && data.ready;
  const places = scope === 'region' ? data.places.regions : scope === 'company' ? data.places.companies : scope === 'site' ? data.places.sites : [];
  const codes = [...new Map(data.formulas.filter((r) => r.formula.status === 'live' && r.formula.kind === kind).map((r) => [r.formula.code, r.formula.name])).entries()];
  const rows = data.uses.filter((u) => showOld || u.current);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Where each formula is used</h2>
      </div>
      <div className="list">
        {rows.length === 0 && <div className="empty">Nothing chosen yet.</div>}
        {rows.map((u) => (
          <div key={u.use.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 600 }}>
                {KIND[u.use.kind]} · {SCOPE[u.use.scope]}
                {u.use.scope === 'group' ? '' : `: ${u.placeName}`}
              </div>
              <Chip tone={u.current ? (u.use.effectiveFrom > data.month ? 'info' : 'ok') : 'info'}>{u.current ? (u.use.effectiveFrom > data.month ? `From ${u.use.effectiveFrom}` : 'Current') : 'Replaced'}</Chip>
            </div>
            <div className="small">
              {u.formulaName}
              {u.use.formulaCode ? ` (${u.use.formulaCode})` : ''} from {u.use.effectiveFrom}
            </div>
            <div className="muted small">
              {u.use.setBy}, {dateTimeLabel(u.use.setAt)}: {u.use.reason}
            </div>
          </div>
        ))}
      </div>
      <button className="btn btn-sm btn-ghost" onClick={() => setShowOld(!showOld)}>
        {showOld ? 'Hide earlier choices' : 'Show earlier choices'}
      </button>
      {director && (
        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ fontWeight: 600 }}>
            Choose the formula for a place
          </div>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', marginTop: 4 }}>
            <select
              className="input"
              aria-label="Kind of pay"
              value={kind}
              onChange={(e) => {
                const k = e.target.value as Kind;
                setKind(k);
                if (!SCOPES[k].includes(scope)) setScope('company');
                setCode('');
              }}
            >
              <option value="guard_shift">{KIND.guard_shift}</option>
              <option value="driver_ot">{KIND.driver_ot}</option>
              <option value="staff_ot">{KIND.staff_ot}</option>
            </select>
            <select
              className="input"
              aria-label="Applies to"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as Scope);
                setScopeId('');
              }}
            >
              {SCOPES[kind].map((s) => (
                <option key={s} value={s}>
                  {SCOPE[s]}
                </option>
              ))}
            </select>
            {scope !== 'group' && (
              <select className="input" aria-label="Place" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
                <option value="">Pick the {SCOPE[scope].toLowerCase()}</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <select className="input" aria-label="Formula" value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">{scope === 'group' ? 'Pick the formula' : 'None: use the wider choice'}</option>
              {codes.map(([c, n]) => (
                <option key={c} value={c}>
                  {n} ({c})
                </option>
              ))}
            </select>
            <input className="input" aria-label="Starts from (month)" type="month" min={data.month} value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <input className="input" style={{ marginTop: 8, display: 'block', width: '100%', boxSizing: 'border-box' }} aria-label="Reason" placeholder="Reason (kept with the choice)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <ErrorNotice error={act.error} />
          <button
            className="btn btn-primary btn-sm"
            style={{ marginTop: 8, display: 'block' }}
            disabled={act.busy}
            onClick={() =>
              act
                .run(() => api.setPayFormulaUse({ kind, scope, scopeId: scope === 'group' ? null : scopeId, formulaCode: code || null, effectiveFrom: month, reason }), 'Saved.')
                .then((r) => {
                  if (r) setReason('');
                })
            }
          >
            Save the choice
          </button>
        </div>
      )}
    </section>
  );
}

function Checker({ data }: { data: PayFormulaBoard }) {
  const [kind, setKind] = useState<Kind>('guard_shift');
  const [siteId, setSiteId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [month, setMonth] = useState(data.month);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.payFormulaAt>> | null>(null);
  const act = useAction();
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Which formula pays here?</h2>
      </div>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        <select className="input" aria-label="Kind of pay" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="guard_shift">{KIND.guard_shift}</option>
          <option value="driver_ot">{KIND.driver_ot}</option>
          <option value="staff_ot">{KIND.staff_ot}</option>
        </select>
        <select className="input" aria-label="Company" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setSiteId(''); }}>
          <option value="">Any company</option>
          {data.places.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {kind === 'guard_shift' && (
          <select className="input" aria-label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">Any site</option>
            {data.places.sites
              .filter((s) => !companyId || s.companyId === companyId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        )}
        <input className="input" aria-label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <button
        className="btn btn-sm"
        style={{ marginTop: 8 }}
        disabled={act.busy}
        onClick={() => act.run(() => api.payFormulaAt({ kind, siteId: kind === 'guard_shift' ? siteId || null : null, companyId: companyId || null, month })).then((r) => setResult(r ?? null))}
      >
        Check
      </button>
      <ErrorNotice error={act.error} />
      {result && (
        <div style={{ marginTop: 8 }}>
          {result.formula && result.use ? (
            <>
              <div className="small">
                <b>{result.formula.name}</b> ({result.formula.code} v{result.formula.version}), chosen for{' '}
                {result.use.scope === 'group' ? 'the whole group' : `this ${SCOPE[result.use.scope].toLowerCase()}`} from {result.use.effectiveFrom}.
              </div>
              {result.example && <Worked example={result.example} kind={result.formula.kind} />}
            </>
          ) : (
            <div className="small">No formula is set for this place and month.</div>
          )}
        </div>
      )}
    </section>
  );
}

type Law = PayFormulaBoard['law'];
const LAW_FIELDS: [keyof Law, string, string][] = [
  ['ordinaryRateDivisor', 'Days the basic is divided by (daily rate)', 'EA s.60I: 26'],
  ['minimumWage', 'Minimum wage a month (RM)', 'Minimum Wages Order'],
  ['otMinNormal', 'Lowest overtime rate, working day (x)', 'EA s.60A(3)'],
  ['otMinRestDay', 'Lowest overtime rate, rest day (x)', 'EA s.60(3)'],
  ['otMinPublicHoliday', 'Lowest overtime rate, public holiday (x)', 'EA s.60D(3)'],
  ['restDayDaysMin', "Least extra days' wages, rest day worked", 'EA s.60(3)'],
  ['publicHolidayDaysMin', "Least extra days' wages, public holiday worked", 'EA s.60D(3)'],
  ['otWageLimit', 'Overtime rules bind up to (RM a month)', 'First Schedule'],
  ['otMonthCap', 'Most overtime hours a month (drivers, staff)', 'Overtime Regulations'],
  ['normalHoursDayMax', 'Most normal hours a day (drivers, staff)', 'EA s.60A(1)'],
  ['normalHoursWeekMax', 'Most normal hours a week (drivers, staff)', 'EA s.60A(1)'],
  ['workDaysWeekMax', 'Most working days a week (drivers, staff)', 'EA s.59'],
];

/** Pay law settings (Fauzan, 6 Nov 2026): the CEO changes how pay is counted when a new law comes in. */
function LawSettings({ data }: { data: PayFormulaBoard }) {
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [next, setNext] = useState({ from: '', amount: '', gazetted: false });
  const [note, setNote] = useState('');
  const [month, setMonth] = useState(nextMonth(data.month));
  const [reason, setReason] = useState('');
  const act = useAction();
  const law = data.law;
  const start = () => {
    setVals(Object.fromEntries(LAW_FIELDS.map(([k]) => [k, String(law[k] ?? '')])));
    setNext({ from: law.nextMinimumWage?.from ?? '', amount: law.nextMinimumWage ? String(law.nextMinimumWage.amount) : '', gazetted: !!law.nextMinimumWage?.gazetted });
    setNote(law.lawNote);
    setEditing(true);
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Pay law settings</h2>
        <Chip tone="info">Set by the CEO</Chip>
      </div>
      <p className="muted small">
        How the base is counted and the legal minimums the formulas are checked against. When a new law comes in, the CEO sets the new figures from a
        month; formulas, worked months and the salary calculator follow them. Below a minimum is flagged to the CEO, never refused.
      </p>
      {!editing && (
        <>
          <table className="table small">
            <tbody>
              {LAW_FIELDS.map(([k, label, src]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td style={{ fontWeight: 600 }}>{String(law[k])}</td>
                  <td className="muted">{src}</td>
                </tr>
              ))}
              <tr>
                <td>Next minimum wage</td>
                <td style={{ fontWeight: 600 }}>{law.nextMinimumWage ? `RM${law.nextMinimumWage.amount} from ${law.nextMinimumWage.from}` : 'None'}</td>
                <td className="muted">{law.nextMinimumWage ? (law.nextMinimumWage.gazetted ? 'Gazetted' : 'Announced, not gazetted') : ''}</td>
              </tr>
            </tbody>
          </table>
          <div className="muted small">{law.lawNote}</div>
          {data.lawVersions.map((v) => (
            <div key={v.id} className="muted small">
              From {v.effectiveFrom}
              {v.replacedBy ? ' (replaced)' : ''}: {v.setBy}, {dateTimeLabel(v.setAt)}. {v.reason}
            </div>
          ))}
          {data.canSetLaw && data.ready && (
            <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={start}>
              Change the pay law settings
            </button>
          )}
        </>
      )}
      {editing && (
        <div>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {LAW_FIELDS.map(([k, label]) => (
              <label key={k} style={{ display: 'grid', gap: 2 }}>
                <span className="small">{label}</span>
                <input className="input" type="number" step="any" min={0} value={vals[k] ?? ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
              </label>
            ))}
            <label style={{ display: 'grid', gap: 2 }}>
              <span className="small">Next minimum wage (RM)</span>
              <input className="input" type="number" min={0} value={next.amount} onChange={(e) => setNext({ ...next, amount: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 2 }}>
              <span className="small">Next minimum wage from (month)</span>
              <input className="input" type="month" value={next.from} onChange={(e) => setNext({ ...next, from: e.target.value })} />
            </label>
            <label className="row small" style={{ gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={next.gazetted} onChange={(e) => setNext({ ...next, gazetted: e.target.checked })} /> Gazetted
            </label>
            <label style={{ display: 'grid', gap: 2 }}>
              <span className="small">Starts from (month)</span>
              <input className="input" type="month" min={data.month} value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          </div>
          <input className="input" style={{ marginTop: 8, display: 'block', width: '100%', boxSizing: 'border-box' }} aria-label="What changed in the law" placeholder="What changed in the law (e.g. the gazette)" value={note} onChange={(e) => setNote(e.target.value)} />
          <input className="input" style={{ marginTop: 8, display: 'block', width: '100%', boxSizing: 'border-box' }} aria-label="Reason" placeholder="Reason (kept with the settings)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy}
              onClick={() =>
                act
                  .run(
                    () =>
                      api.savePayLaw({
                        effectiveFrom: month,
                        reason,
                        settings: {
                          ...Object.fromEntries(LAW_FIELDS.map(([k]) => [k, Number(vals[k])])),
                          nextMinimumWage: next.amount && next.from ? { from: next.from, amount: Number(next.amount), gazetted: next.gazetted } : null,
                          lawNote: note,
                        },
                      }),
                    'Pay law settings saved.',
                  )
                  .then((r) => {
                    if (r) setEditing(false);
                  })
              }
            >
              Save the pay law settings
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
