import { Select } from '../SearchSelect';
import { useMemo, useState } from 'react';
import { api, type FinControls, type FinDesk } from '../api';
import { Chip, ErrorNotice, dateLabel, useAction } from '../ui';
import { DataTable } from '../DataTable';

/**
 * Withholding tax, prepayments and accruals, fixed assets and auditor requests (Fauzan, 2 Nov 2026: suggestions 18, 21,
 * 22 and 23). Prima works out the tax, the due day and the monthly amounts; staff record what they did in SQL Account
 * and with LHDN. Money to LHDN is checked by a second person; journals are not.
 */

const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Co = FinDesk['companies'][number];
type Ye = FinControls['yearEnd'];
type Go = (action: string, input: Record<string, unknown>, msg: string) => Promise<unknown>;

const WHT_LABEL: Record<string, string> = {
  services: 'Technical or management services, rent of movable property (s.109B)',
  royalty: 'Royalty (s.109)',
  interest: 'Interest (s.109)',
  contract: 'Contract payment to a non-resident contractor (s.107A)',
  other_income: 'Other income, e.g. commission, guarantee fee (s.109F)',
};
const CLASS_LABEL: Record<string, string> = {
  general: 'Plant and machinery (general)',
  heavy_vehicle: 'Heavy machinery and vehicles',
  office: 'Office furniture and fittings',
  computer: 'Computers and IT equipment',
  motor_car: 'Motor car',
  small_value: 'Small value asset (RM2,000 or less)',
  building: 'Building',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function useForm(init: Record<string, string> = {}) {
  const [f, setF] = useState<Record<string, string>>(init);
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return { f, set, reset: () => setF(init) };
}

/** P107: which table rows are opened (their steps shown under the row). */
function useOpenRows() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return { isOpen: (id: string) => open.has(id), toggle };
}
const block = { display: 'block' } as const;

export function YearEndPanels({ v, co }: { v: FinControls; co: Co }) {
  return (
    <>
      <WithholdingTax v={v} co={co} />
      <Schedules v={v} />
      <FixedAssets v={v} />
      <AuditorRequests v={v} />
    </>
  );
}

// ---------- 18. Withholding tax ----------

function WithholdingTax({ v, co }: { v: FinControls; co: Co }) {
  const act = useAction();
  const ye = v.yearEnd;
  const [adding, setAdding] = useState(false);
  const { f, set, reset } = useForm({ type: 'services' });
  const go: Go = (action, input, msg) => act.run(() => api.finControlAction(v.companyId, 'wht', action, input), msg);
  const rows = useOpenRows();
  const released = co.payments.filter((p) => p.status === 'released' && !ye.wht.some((w) => w.paymentId === p.id));
  const rate = f.treatyRate ? Number(f.treatyRate) : ye.whtRates[f.type as keyof Ye['whtRates']];
  const pay = released.find((p) => p.id === f.paymentId);
  const gross = pay ? pay.amount : Number(f.gross);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Withholding tax (payments to non-residents)</h3>
        <button className="btn btn-sm" onClick={() => setAdding(!adding)}>
          {adding ? 'Close' : 'Add'}
        </button>
      </div>
      <p className="muted small fin-intro">
        When the company pays a non-resident for services, royalty, interest or a contract, tax is withheld and paid to LHDN within one month. Prima works out
        the tax and the due day; late payment adds 10%.
      </p>
      <ErrorNotice error={act.error} />
      {adding && (
        <div className="fin-pad">
          <Field label="Payment in Prima (fills the payee, amount and day)">
            <Select className="select" value={f.paymentId ?? ''} onChange={set('paymentId')}>
              <option value="">Not in Prima: type it</option>
              {released.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.payee} · {rm(p.amount)} · {p.releasedOn ? dateLabel(p.releasedOn) : ''}
                </option>
              ))}
            </Select>
          </Field>
          {!f.paymentId && (
            <>
              <Field label="Non-resident paid">
                <input className="input" value={f.payee ?? ''} onChange={set('payee')} />
              </Field>
              <Field label="Gross amount paid or credited (RM)">
                <input className="input" inputMode="decimal" value={f.gross ?? ''} onChange={set('gross')} />
              </Field>
              <Field label="Day paid or credited">
                <input className="input" type="date" value={f.paidOn ?? ''} onChange={set('paidOn')} />
              </Field>
            </>
          )}
          <Field label="Country of residence">
            <input className="input" value={f.country ?? ''} onChange={set('country')} />
          </Field>
          <Field label="What it pays for">
            <Select className="select" value={f.type} onChange={set('type')}>
              {Object.keys(ye.whtRates).map((k) => (
                <option key={k} value={k}>
                  {WHT_LABEL[k] ?? k} · {ye.whtRates[k as keyof Ye['whtRates']]}%
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Lower treaty rate (%), only with a certificate of residence">
            <input className="input" inputMode="decimal" value={f.treatyRate ?? ''} onChange={set('treatyRate')} />
          </Field>
          {f.treatyRate && (
            <Field label="Certificate of residence (file name)">
              <input className="input" value={f.treatyDoc ?? ''} onChange={set('treatyDoc')} />
            </Field>
          )}
          {Number.isFinite(gross) && gross > 0 && (
            <p className="small">
              Tax to LHDN: {rm(Math.round(gross * rate) / 100)} ({rate}% of {rm(gross)})
            </p>
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              const input = { ...f, gross: f.gross ? Number(f.gross) : undefined, paymentId: f.paymentId || undefined };
              if (await go('add', input, 'Added. Prima shows it until it is paid to LHDN.')) {
                setAdding(false);
                reset();
              }
            }}
          >
            Save
          </button>
        </div>
      )}
      {/* P107: the payments to non-residents as a table; "Act" opens the same steps under the row. */}
      <DataTable
        label="Withholding tax"
        stateKey="fin.wht"
        rows={ye.wht}
        rowKey={(w) => w.id}
        columns={[
          { id: 'payee', label: 'Payee', value: (w) => w.payee, phone: 'title' },
          { id: 'country', label: 'Country', value: (w) => w.country, phone: 'sub' },
          { id: 'gross', label: 'Gross', value: (w) => w.gross, sort: 'money', render: (w) => rm(w.gross) },
          {
            id: 'tax',
            label: 'Tax',
            value: (w) => w.tax,
            sort: 'money',
            render: (w) => (
              <>
                {rm(w.tax)}
                <span className="muted small" style={block}>
                  at {w.rate}%{w.treaty ? ' (treaty)' : ''}
                </span>
              </>
            ),
          },
          { id: 'paidOn', label: 'Paid on', value: (w) => w.paidOn, sort: 'date' },
          {
            id: 'lhdn',
            label: 'Paid to LHDN',
            value: (w) => w.remitted?.on ?? null,
            sort: 'date',
            hideBelow: 1100,
            render: (w) => (w.remitted ? `${dateLabel(w.remitted.on)}, receipt ${w.remitted.receipt}` : '–'),
          },
          { id: 'status', label: 'Status', value: (w) => whtChip(w)[1], translate: true, render: (w) => <Chip tone={whtChip(w)[0]}>{whtChip(w)[1]}</Chip> },
        ]}
        filters={[
          {
            id: 'status',
            label: 'Status',
            value: whtState,
            options: [
              { value: 'due', label: 'Not paid yet' },
              { value: 'late', label: 'Late' },
              { value: 'check', label: 'To check' },
              { value: 'done', label: 'Paid and checked' },
            ],
          },
          { id: 'country', label: 'Country', value: (w) => w.country },
        ]}
        rowEnd={(w) =>
          !w.checked ? (
            <button className="btn btn-sm" onClick={() => rows.toggle(w.id)}>
              {rows.isOpen(w.id) ? 'Close' : 'Act'}
            </button>
          ) : null
        }
        rowDetail={(w) => (rows.isOpen(w.id) && !w.checked ? <WhtLine w={w} go={go} busy={act.busy} /> : null)}
        empty={<div className="list-item muted">No payments to non-residents recorded.</div>}
      />
    </section>
  );
}

type Wht = Ye['wht'][number];
const whtState = (w: Wht) => (w.checked ? 'done' : w.remitted ? 'check' : w.late ? 'late' : 'due');
const whtChip = (w: Wht): [Parameters<typeof Chip>[0]['tone'], string] =>
  w.checked ? ['ok', 'Paid and checked'] : w.remitted ? ['warn', 'To check'] : w.late ? ['crit', 'Late'] : ['info', `Due ${dateLabel(w.dueOn)}`];

/** The next step for one withholding tax line (pay LHDN, then check), under its row once "Act" is pressed. */
function WhtLine({ w, go, busy }: { w: Wht; go: Go; busy: boolean }) {
  const { f, set } = useForm();
  const due = Math.round((w.tax + w.penaltyNow) * 100) / 100;
  return (
    <div className="fin-block">
      {!w.remitted && (
        <div className="row fin-pt fin-end">
          <Field label="Paid to LHDN on">
            <input className="input" type="date" value={f.on ?? ''} onChange={set('on')} />
          </Field>
          <Field label="LHDN receipt number">
            <input className="input" value={f.receipt ?? ''} onChange={set('receipt')} />
          </Field>
          <span className="small">
            Pay {rm(due)}
            {w.penaltyNow ? ` (includes the 10% late penalty ${rm(w.penaltyNow)})` : ''}
          </span>
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => go('remit', { whtId: w.id, on: f.on || undefined, receipt: f.receipt, amount: due }, 'Paid to LHDN. Someone else checks it next.')}
          >
            Record payment to LHDN
          </button>
        </div>
      )}
      {w.remitted && !w.checked && (
        <div className="fin-pt">
          <Field label="What you checked (receipt, rate, form CP37)">
            <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
          </Field>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => go('check', { whtId: w.id, comment: f.comment }, 'Checked.')}>
            Checked
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- 21. Prepayments and accruals ----------

function Schedules({ v }: { v: FinControls }) {
  const act = useAction();
  const ye = v.yearEnd;
  const [adding, setAdding] = useState(false);
  const { f, set, reset } = useForm({ kind: 'prepayment' });
  const go: Go = (action, input, msg) => act.run(() => api.finControlAction(v.companyId, 'schedules', action, input), msg);
  const live = ye.schedules.filter((s) => !s.stopped);
  const rows = useOpenRows();
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Prepayments and accruals</h3>
        <button className="btn btn-sm" onClick={() => setAdding(!adding)}>
          {adding ? 'Close' : 'Add'}
        </button>
      </div>
      <p className="muted small fin-intro">
        A cost paid for many months (insurance, licence, rent ahead) or a cost not yet billed. Prima spreads it month by month; post each month&apos;s journal
        in SQL Account and type its number here. A month not posted keeps the close open.
      </p>
      <ErrorNotice error={act.error} />
      {adding && (
        <div className="fin-pad">
          <Field label="Type">
            <select className="select" value={f.kind} onChange={set('kind')}>
              <option value="prepayment">Prepayment (paid ahead)</option>
              <option value="accrual">Accrual (used, not yet billed)</option>
            </select>
          </Field>
          {(
            [
              ['what', 'What it is (e.g. fire insurance 2027)'],
              ['account', 'SQL Account expense account'],
              ['total', 'Total (RM)'],
              ['months', 'Months'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <input className="input" value={f[k] ?? ''} onChange={set(k)} />
            </Field>
          ))}
          <Field label="First month">
            <input className="input" type="month" value={f.from ?? ''} onChange={set('from')} />
          </Field>
          {Number(f.total) > 0 && Number(f.months) > 0 && (
            <p className="small">About {rm(Math.floor((Number(f.total) / Number(f.months)) * 100) / 100)} a month</p>
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              if (await go('add', { ...f, total: Number(f.total), months: Number(f.months) }, 'Added.')) {
                setAdding(false);
                reset();
              }
            }}
          >
            Save
          </button>
        </div>
      )}
      {/* P107: the running schedules as a table; "Open" shows the months, the next journal and "Stop" under the row. */}
      <DataTable
        label="Prepayments and accruals"
        stateKey="fin.schedules"
        rows={live}
        rowKey={(s) => s.id}
        columns={[
          { id: 'what', label: 'What it is', value: (s) => s.what, phone: 'title' },
          { id: 'kind', label: 'Type', value: schedKind, translate: true, phone: 'sub' },
          { id: 'total', label: 'Total', value: (s) => s.total, sort: 'money', render: (s) => rm(s.total) },
          { id: 'months', label: 'Months', value: (s) => s.months, sort: 'number' },
          { id: 'account', label: 'Account', value: (s) => s.account, hideBelow: 1100 },
          {
            id: 'posted',
            label: 'Posted',
            value: (s) => s.lines.filter((l) => l.posted).length,
            sort: 'number',
            render: (s) => (
              <>
                {s.lines.filter((l) => l.posted).length} of {s.months}
              </>
            ),
          },
          {
            id: 'status',
            label: 'Status',
            value: (s) => schedDue(s, v.banking.period),
            sort: 'number',
            render: (s) => {
              const n = schedDue(s, v.banking.period);
              return <Chip tone={n ? 'warn' : 'ok'}>{n ? `${n} to post` : 'Up to date'}</Chip>;
            },
          },
        ]}
        filters={[{ id: 'kind', label: 'Type', value: schedKind }]}
        rowEnd={(s) => (
          <button className="btn btn-sm" onClick={() => rows.toggle(s.id)}>
            {rows.isOpen(s.id) ? 'Close' : 'Open'}
          </button>
        )}
        rowDetail={(s) => (rows.isOpen(s.id) ? <ScheduleLine s={s} go={go} busy={act.busy} close={v.banking.period} /> : null)}
        empty={<div className="list-item muted">None running.</div>}
      />
    </section>
  );
}

type Sched = Ye['schedules'][number];
const schedKind = (s: Sched) => (s.kind === 'prepayment' ? 'Prepayment' : 'Accrual');
const schedDue = (s: Sched, close: string) => s.lines.filter((l) => l.period <= close && !l.posted).length;

/** One schedule's months, its next journal and "Stop", under its row once "Open" is pressed. */
function ScheduleLine({ s, go, busy, close }: { s: Sched; go: Go; busy: boolean; close: string }) {
  const { f, set } = useForm();
  const due = s.lines.filter((l) => l.period <= close && !l.posted);
  const next = due[0];
  return (
    <div className="fin-block">
      {(
        <div className="fin-pt">
          {next && (
            <div className="row fin-end">
              <span className="small">
                {next.period}: {rm(next.amount)}
              </span>
              <Field label="SQL Account journal number">
                <input className="input" value={f.jv ?? ''} onChange={set('jv')} />
              </Field>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => go('post', { scheduleId: s.id, period: next.period, jv: f.jv }, 'Posted.')}
              >
                Posted
              </button>
            </div>
          )}
          <ul className="small fin-ul">
            {s.lines.map((l) => (
              <li key={l.period}>
                {l.posted ? '✓ ' : ''}
                {l.period} · {rm(l.amount)}
                {l.posted && <span className="muted"> · {l.posted.jv}</span>}
              </li>
            ))}
          </ul>
          <div className="row fin-mt fin-end">
            <Field label="Stop it (team leader, FD, CEO): reason">
              <input className="input" value={f.why ?? ''} onChange={set('why')} />
            </Field>
            <button className="btn btn-sm" disabled={busy || !f.why} onClick={() => go('stop', { scheduleId: s.id, comment: f.why }, 'Stopped.')}>
              Stop
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 22. Fixed assets and capital allowances ----------

function FixedAssets({ v }: { v: FinControls }) {
  const act = useAction();
  const ye = v.yearEnd;
  const [adding, setAdding] = useState(false);
  const [agree, setAgree] = useState(false);
  const { f, set, reset } = useForm({ cls: 'general' });
  const g = useForm({ year: String(ye.year) });
  const go: Go = (action, input, msg) => act.run(() => api.finControlAction(v.companyId, 'assets', action, input), msg);
  const live = ye.assets.filter((a) => !a.disposed);
  const ca = ye.allowances;
  const rows = useOpenRows();
  const assetRows = useMemo(() => ca.rows.map((r) => ({ r, a: ye.assets.find((x) => x.id === r.assetId)! })), [ca.rows, ye.assets]);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Fixed assets and capital allowances</h3>
        <span className="row">
          <button className="btn btn-sm" onClick={() => setAgree(!agree)}>
            {agree ? 'Close' : 'Agree with SQL Account'}
          </button>
          <button className="btn btn-sm" onClick={() => setAdding(!adding)}>
            {adding ? 'Close' : 'Add asset'}
          </button>
        </span>
      </div>
      <p className="muted small fin-intro">
        {live.length} asset(s), cost {rm(live.reduce((n, a) => n + a.cost, 0))}. Capital allowances for {ca.year}: {rm(ca.total)} (for the tax computation;
        rates from Schedule 3, to be confirmed by the Finance Director).
        {ca.smallValueOverCap > 0 &&
          ` Small value assets are ${rm(ca.smallValueOverCap)} over the RM20,000 yearly cap${ye.taxProfile ? '' : ' (record the tax size: an SME has no cap)'}.`}
        {ye.agreed[0] && ` Last agreed ${ye.agreed[0].year}: ${ye.agreed[0].diff ? `difference ${rm(ye.agreed[0].diff)} explained` : 'RM0.00 difference'}.`}
      </p>
      <TaxSize v={v} go={go} busy={act.busy} />
      <ErrorNotice error={act.error} />
      {agree && (
        <div className="row fin-pad fin-end">
          <Field label="Year end">
            <input className="input" value={g.f.year ?? ''} onChange={g.set('year')} />
          </Field>
          <Field label="SQL Account register: total cost (RM)">
            <input className="input" inputMode="decimal" value={g.f.sqlCost ?? ''} onChange={g.set('sqlCost')} />
          </Field>
          <Field label="If different: why">
            <input className="input" value={g.f.comment ?? ''} onChange={g.set('comment')} />
          </Field>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={async () => {
              if (await go('agree', { year: Number(g.f.year), sqlCost: Number(g.f.sqlCost), comment: g.f.comment || undefined }, 'Saved.')) setAgree(false);
            }}
          >
            Save
          </button>
        </div>
      )}
      {adding && (
        <div className="fin-pad">
          {(
            [
              ['name', 'Asset'],
              ['sqlCode', 'SQL Account asset code'],
              ['cost', 'Cost (RM)'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <input className="input" value={f[k] ?? ''} onChange={set(k)} />
            </Field>
          ))}
          <Field label="Class">
            <Select className="select" value={f.cls} onChange={set('cls')}>
              {Object.entries(CLASS_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {f.cls === 'motor_car' && (
            <Field label="Bought new, RM150,000 or less">
              <select className="select" value={f.newCarUnder150k ?? 'no'} onChange={set('newCarUnder150k')}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </Field>
          )}
          <Field label="Bought on">
            <input className="input" type="date" value={f.acquiredOn ?? ''} onChange={set('acquiredOn')} />
          </Field>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              if (await go('add', { ...f, cost: Number(f.cost) }, 'Added.')) {
                setAdding(false);
                reset();
              }
            }}
          >
            Save
          </button>
        </div>
      )}
      {/* P107: the assets as a table (sort by cost, class, year bought); "Dispose" opens the same box under the row. */}
      <DataTable
        label="Fixed assets and capital allowances"
        stateKey="fin.fixed-assets"
        rows={assetRows}
        rowKey={(x) => x.r.assetId}
        searchText={(x) => x.r.note ?? ''}
        columns={[
          { id: 'code', label: 'Code', value: (x) => x.a.sqlCode, phone: 'sub' },
          {
            id: 'name',
            label: 'Asset',
            value: (x) => x.a.name,
            phone: 'title',
            render: (x) => (
              <>
                {x.a.name}
                {x.r.note && (
                  <span className="muted small" style={block}>
                    {x.r.note}
                  </span>
                )}
              </>
            ),
          },
          { id: 'cls', label: 'Class', value: (x) => CLASS_LABEL[x.a.cls] ?? x.a.cls, translate: true, hideBelow: 1200, phone: 'hidden' },
          { id: 'cost', label: 'Cost', value: (x) => x.a.cost, sort: 'money', render: (x) => rm(x.a.cost) },
          { id: 'bought', label: 'Bought on', value: (x) => x.a.acquiredOn, sort: 'date' },
          { id: 'allowance', label: 'Allowance this year', value: (x) => x.r.total, sort: 'money', render: (x) => rm(x.r.total) },
          { id: 'left', label: 'Left', value: (x) => x.r.residual, sort: 'money', render: (x) => rm(x.r.residual) },
        ]}
        filters={[
          { id: 'cls', label: 'Class', value: (x) => x.a.cls, optionLabel: (k) => CLASS_LABEL[k] ?? k },
          { id: 'year', label: 'Year bought', value: (x) => x.a.acquiredOn.slice(0, 4) },
        ]}
        rowEnd={(x) =>
          !x.a.disposed ? (
            <button className="btn btn-sm" onClick={() => rows.toggle(x.r.assetId)}>
              {rows.isOpen(x.r.assetId) ? 'Close' : 'Dispose'}
            </button>
          ) : null
        }
        rowDetail={(x) => (rows.isOpen(x.r.assetId) && !x.a.disposed ? <AssetLine a={x.a} go={go} busy={act.busy} /> : null)}
        empty={<div className="list-item muted">No fixed assets recorded.</div>}
      />
    </section>
  );
}

/** The disposal box for one asset, under its row once "Dispose" is pressed. */
function AssetLine({ a, go, busy }: { a: Ye['assets'][number]; go: Go; busy: boolean }) {
  const { f, set } = useForm();
  return (
    <div className="fin-block">
      {(
        <div className="row fin-end">
          <Field label="Disposed on">
            <input className="input" type="date" value={f.on ?? ''} onChange={set('on')} />
          </Field>
          <Field label="Proceeds (RM)">
            <input className="input" inputMode="decimal" value={f.proceeds ?? ''} onChange={set('proceeds')} />
          </Field>
          <Field label="Sold, scrapped or lost: details">
            <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
          </Field>
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() => go('dispose', { assetId: a.id, on: f.on || undefined, proceeds: Number(f.proceeds || 0), comment: f.comment }, 'Recorded.')}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- 23. Auditor requests ----------

function AuditorRequests({ v }: { v: FinControls }) {
  const act = useAction();
  const ye = v.yearEnd;
  const [adding, setAdding] = useState(false);
  const { f, set, reset } = useForm({ year: String(ye.year) });
  const [doc, setDoc] = useState<Record<string, string>>({});
  const go: Go = (action, input, msg) => act.run(() => api.finControlAction(v.companyId, 'audit', action, input), msg);
  const open = ye.audit.filter((r) => !r.sent);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Auditor requests</h3>
        <button className="btn btn-sm" onClick={() => setAdding(!adding)}>
          {adding ? 'Close' : 'Add'}
        </button>
      </div>
      <p className="muted small fin-intro">
        Paste the auditor&apos;s list, one item per line, and choose who prepares it. Each item shows on that person&apos;s home until it is sent. {open.length}{' '}
        open, {ye.audit.length - open.length} sent.
      </p>
      <ErrorNotice error={act.error} />
      {adding && (
        <div className="fin-pad">
          <Field label="Year audited">
            <input className="input" value={f.year ?? ''} onChange={set('year')} />
          </Field>
          <Field label="Items, one per line">
            <textarea className="textarea" rows={4} value={f.item ?? ''} onChange={set('item')} />
          </Field>
          <Field label="Who prepares them">
            <Select className="select" value={f.ownerId ?? ''} onChange={set('ownerId')}>
              <option value="">Choose</option>
              {v.cash.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due on (blank: 14 days)">
            <input className="input" type="date" value={f.dueOn ?? ''} onChange={set('dueOn')} />
          </Field>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              if (await go('add', { ...f, year: Number(f.year), dueOn: f.dueOn || undefined }, 'Added.')) {
                setAdding(false);
                reset();
              }
            }}
          >
            Save
          </button>
        </div>
      )}
      {/* P107: the auditor's requests as a table; the "What was sent" box stays under each open request. */}
      <DataTable
        label="Auditor requests"
        stateKey="fin.auditor-requests"
        rows={ye.audit}
        rowKey={(r) => r.id}
        columns={[
          { id: 'item', label: 'Request', value: (r) => r.item, phone: 'title' },
          { id: 'year', label: 'Year', value: (r) => r.year, sort: 'number', phone: 'sub', render: (r) => String(r.year) },
          { id: 'owner', label: 'Prepared by', value: (r) => r.owner },
          { id: 'due', label: 'Due', value: (r) => r.dueOn, sort: 'date' },
          {
            id: 'sent',
            label: 'Sent',
            value: (r) => r.sent?.on ?? null,
            sort: 'date',
            hideBelow: 1100,
            render: (r) => (r.sent ? `${dateLabel(r.sent.on)}: ${r.sent.doc}` : '–'),
          },
          { id: 'status', label: 'Status', value: auditState, translate: true, render: (r) => <Chip tone={r.sent ? 'ok' : r.late ? 'crit' : 'info'}>{auditState(r)}</Chip> },
        ]}
        filters={[
          { id: 'year', label: 'Year', value: (r) => String(r.year) },
          { id: 'status', label: 'Status', value: auditState },
          { id: 'owner', label: 'Prepared by', value: (r) => r.owner },
        ]}
        searchText={(r) => r.sent?.doc ?? ''}
        rowDetail={(r) =>
          !r.sent ? (
            <div className="row fin-end">
              <input
                className="input"
                placeholder="What was sent (file name or SharePoint link)"
                value={doc[r.id] ?? ''}
                onChange={(e) => setDoc((x) => ({ ...x, [r.id]: e.target.value }))}
              />
              <button className="btn btn-sm" disabled={act.busy} onClick={() => go('sent', { requestId: r.id, doc: doc[r.id] }, 'Marked sent.')}>
                Sent
              </button>
            </div>
          ) : null
        }
        empty={<div className="list-item muted">No auditor requests.</div>}
      />
    </section>
  );
}

const auditState = (r: Ye['audit'][number]) => (r.sent ? 'Sent' : r.late ? 'Late' : 'Open');

/** The company's tax size (Fauzan, 2 Nov 2026): the FD or CEO records paid-up capital, income and big related companies. */
function TaxSize({ v, go, busy }: { v: FinControls; go: Go; busy: boolean }) {
  const p = v.yearEnd.taxProfile;
  const [open, setOpen] = useState(false);
  const { f, set } = useForm({ bigRelated: 'no' });
  return (
    <div className="fin-padb">
      <span className="small">
        Tax size:{' '}
        {p
          ? `${p.sme ? 'SME' : 'not an SME'} (paid-up ${rm(p.paidUp)}, gross income ${rm(p.grossIncome)}${p.bigRelated ? ', more than 50% linked to a company above RM2.5 million paid-up' : ''}), by ${p.set.by}`
          : 'not recorded'}{' '}
      </span>
      <button className="btn btn-sm" onClick={() => setOpen(!open)}>
        {open ? 'Close' : p ? 'Change' : 'Record (FD or CEO)'}
      </button>
      {open && (
        <div className="row fin-pt fin-end">
          <Field label="Paid-up capital (RM)">
            <input className="input" inputMode="decimal" value={f.paidUp ?? ''} onChange={set('paidUp')} />
          </Field>
          <Field label="Gross business income, last year (RM)">
            <input className="input" inputMode="decimal" value={f.grossIncome ?? ''} onChange={set('grossIncome')} />
          </Field>
          <Field label="More than 50% owned by (or owning) a company above RM2.5 million paid-up?">
            <select className="select" value={f.bigRelated} onChange={set('bigRelated')}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
          <Field label="From (SSM, accounts)">
            <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
          </Field>
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() =>
              go(
                'profile',
                { paidUp: Number(f.paidUp), grossIncome: Number(f.grossIncome), bigRelated: f.bigRelated === 'yes', comment: f.comment || undefined },
                'Saved.',
              )
            }
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
