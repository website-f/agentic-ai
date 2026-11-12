import { Select } from '../SearchSelect';
import { Plan3 } from './FinancePlan3';
import { Fragment, useState } from 'react';
import { FIN_PLAN_LINES, finPayeeFromEInvoice, type FinCheckSection, type FinPlanLine } from '@prima/core';
import { api, type FinControlArea, type FinControls, type FinDesk } from '../api';
import { Guarantees, HostelWatch, RegularPayments } from './FinanceRegular';
import { Advances, Cards, Mandates, PettyCash } from './FinanceCash';
import { MoneyInPanels } from './FinanceMoneyIn';
import { DailyCash, MyDailyCash } from './FinanceDailyCash';
import { CashForecast, Intercompany } from './FinanceGroup4';
import { ClientDeposits, ContractEnds } from './FinanceContractEnd';
import { BankCharges, FixedDeposits } from './FinanceBanking';
import { YearEndPanels } from './FinanceYearEnd';
import { LedgerPanels } from './FinanceLedger';
import { ClientCredit, SupplierStatements } from './FinanceCredit';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';

/**
 * Finance Phase 2, part 2 (Fauzan, 31 Oct 2026). The monthly checks that keep the books from going Unknown:
 * payees verified by call-back (paid to the right person), bank statements matched to approved payments,
 * customer and supplier ageing every month, SST returns and the payment to Customs, and the budget and forecast.
 * SQL Account stays the books; these are the checks around it. The server enforces who may do each step.
 */

type Co = FinDesk['companies'][number];
const rm = (n: number | null | undefined) => (n == null ? '–' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const LINE_LABEL: Record<FinPlanLine, string> = {
  revenue: 'Revenue',
  guard_cost: 'Guard pay',
  misc_payroll: 'Miscellaneous payroll expenses',
  staff_cost: 'Staff pay',
  statutory: 'EPF, SOCSO, EIS, HRD',
  premises: 'Premises',
  vehicles: 'Vehicles',
  equipment: 'Equipment',
  insurance: 'Insurance',
  other_opex: 'Other expenses',
  finance_cost: 'Finance cost',
  tax: 'Tax',
  capex: 'Capital spending',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function useControl(companyId: string) {
  const act = useAction();
  const go = (area: FinControlArea, action: string, input: Record<string, unknown>, msg: string) => act.run(() => api.finControlAction(companyId, area, action, input), msg);
  return { act, go };
}

const SECTIONS: [FinCheckSection, string, string][] = [
  ['out', 'Paying out', 'Payees, supplier statements, regular payments, guarantees, hostel bills, daily cash and bank mandates'],
  ['bank', 'Bank', 'Statements, matching, bank reconciliations, where the money sits, fixed deposits and bank charges'],
  ['in', 'Money in', 'Invoices per contract, government claims, money in, stamp duty, contracts that ended, deposits held by clients, client credit limits, ageing and overdue invoices'],
  ['cash', 'Cash and cards', 'Staff advances, petty cash, company cards and the 13-week cash forecast'],
  ['tax', 'Tax and month-end', 'Tax calendar, e-Invoice, SST, intercompany balances, budget, statement checks FS-01 to FS-12, chart of accounts mapping, SQL Account connection, withholding tax, prepayments and accruals, fixed assets, auditor requests and audit dates'],
];

/**
 * The monthly checks, one section at a time (staff-eye review, Fauzan 2 Nov 2026: "make sure its not too complicated").
 * The company list shows where this person's work is and opens on the busiest company; each section shows its count.
 */
export function ChecksTab({ desk, target }: { desk: FinDesk; target?: { section?: FinCheckSection; companyId?: string } | null }) {
  const { data: todo } = useLoad(() => api.finChecksTodo().catch(() => ({}) as Record<string, Partial<Record<FinCheckSection, number>>>), []);
  const [chosen, setChosen] = useState<string | null>(target?.companyId ?? null);
  const [section, setSection] = useState<FinCheckSection | null>(target?.section ?? null);
  const total = (id: string) => Object.values(todo?.[id] ?? {}).reduce((n, x) => n + (x ?? 0), 0);
  const companies = [...desk.companies].sort((x, y) => total(y.companyId) - total(x.companyId));
  const companyId = chosen ?? (todo ? companies[0]?.companyId : desk.companies[0]?.companyId) ?? '';
  const co = desk.companies.find((c) => c.companyId === companyId) ?? null;
  const mine = todo?.[companyId] ?? {};
  const sec: FinCheckSection = section ?? SECTIONS.map((x) => x[0]).find((k) => (mine[k] ?? 0) > 0) ?? 'out';
  const { data, error } = useLoad(() => (companyId ? api.finControls(companyId) : Promise.resolve(null)), [companyId]);
  const lead = desk.actor.kind === 'director' || desk.actor.kind === 'ceo';
  return (
    <>
      <MyDailyCash />
      <div className="fin-checks-bar">
        <label className="field fin-checks-co">
          <span>Company</span>
          <Select
            className="select"
            value={companyId}
            onChange={(e) => {
              setChosen(e.target.value);
              setSection(null);
            }}
          >
            {companies.map((c) => (
              <option key={c.companyId} value={c.companyId}>
                {c.companyName} (Team {c.team}){total(c.companyId) ? ` · ${total(c.companyId)} to do` : ''}
              </option>
            ))}
          </Select>
        </label>
        <div className="tabbar fin-tabs" role="tablist" aria-label="Checks section">
          {SECTIONS.map(([k, label, what]) => (
            <button key={k} role="tab" aria-selected={sec === k} title={what} onClick={() => setSection(k)}>
              {label}
              {(mine[k] ?? 0) > 0 && <span className="fin-count">{mine[k]}</span>}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small fin-section-note">
        {SECTIONS.find((x) => x[0] === sec)![2]}. Test data: SQL Account and the banks are not connected; figures are typed or loaded from files.
      </p>
      {error && <ErrorNotice error={error} />}
      {!data && !error && <Loading what="checks" />}
      {data && co && data.companyId === co.companyId && (
        // Keyed by company so a form started for one company never carries its choices (bank account) to another.
        <Fragment key={co.companyId}>
          {sec === 'out' && (
            <>
              <RegularPayments v={data} co={co} />
              <HostelWatch v={data} />
              <DailyCash v={data} co={co} />
              <Payees v={data} co={co} />
              <SupplierStatements v={data} />
              <Guarantees v={data} co={co} />
              <Mandates v={data} co={co} />
            </>
          )}
          {sec === 'bank' && (
            <>
              <Statements v={data} co={co} />
              <BankRecs v={data} co={co} />
              <FixedDeposits v={data} />
              <BankCharges v={data} />
              <MatchRules v={data} co={co} />
            </>
          )}
          {sec === 'in' && (
            <>
              <MoneyInPanels v={data} co={co} />
              <ContractEnds v={data} />
              <ClientDeposits v={data} />
              <ClientCredit v={data} />
              <InvoiceCases v={data} co={co} lead={lead} />
              <Ageing v={data} co={co} />
              <Reminders v={data} co={co} />
            </>
          )}
          {sec === 'cash' && (
            <>
              <CashForecast v={data} co={co} />
              <Advances v={data} co={co} />
              <PettyCash v={data} co={co} />
              <Cards v={data} co={co} />
            </>
          )}
          {sec === 'tax' && (
            <>
              <TaxCalendar v={data} co={co} />
              <Sst v={data} co={co} lead={lead} />
              <EInvoice v={data} co={co} lead={lead} />
              <Intercompany v={data} co={co} />
              <Plan v={data} co={co} lead={lead} me={desk.me} />
              <LedgerPanels v={data} co={co} lead={lead} me={desk.me} reviewer={lead || desk.actor.kind === 'leader' || desk.actor.kind === 'deputy'} />
              <YearEndPanels v={data} co={co} />
              <AuditDates v={data} />
            </>
          )}
        </Fragment>
      )}
    </>
  );
}

// ---------- Payees ----------

function Payees({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useControl(v.companyId);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({ kind: 'supplier' });
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const sel = v.payees.find((p) => p.id === open) ?? null;
  const tone = (s: string) => (s === 'verified' ? 'ok' : s === 'blocked' ? 'crit' : 'warn');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Payees: paid to the right person</h3>
        {co.canAct && (
          <button className="btn btn-sm" onClick={() => setAdding((x) => !x)}>
            {adding ? 'Close' : 'Add payee'}
          </button>
        )}
      </div>
      <p className="muted small fin-intro">
        A new payee or a change of bank account is verified by someone other than the person who entered it, by calling back on a number from your own records
        (never the number on the request). Payments to a payee that is not verified cannot be approved or released.
      </p>
      <ErrorNotice error={act.error} />
      {adding && (
        <div className="fin-pad">
          <Field label="Fill from the supplier's e-Invoice (paste the MyInvois document, optional)">
            <textarea className="input" rows={3} value={f.einv ?? ''} onChange={set('einv')} />
          </Field>
          {f.einv && (
            <button
              className="btn btn-sm"
              onClick={() => {
                try {
                  const p = finPayeeFromEInvoice(f.einv);
                  setF((x) => ({ ...x, name: p.name ?? x.name ?? '', regNo: p.brn ?? p.tin ?? x.regNo ?? '', source: `e-Invoice: TIN ${p.tin ?? '-'}, BRN ${p.brn ?? '-'}${p.address ? `, ${p.address}` : ''}`.slice(0, 200) }));
                } catch (e) {
                  setF((x) => ({ ...x, einvError: (e as Error).message }));
                }
              }}
            >
              Fill name and registration number
            </button>
          )}
          {f.einvError && <p className="small fin-crit">{f.einvError}</p>}
          <Field label="Type">
            <Select className="select" value={f.kind} onChange={set('kind')}>
              {['supplier', 'statutory', 'payroll', 'tax', 'intercompany', 'other'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
          </Field>
          <Field label="Name">
            <input className="input" value={f.name ?? ''} onChange={set('name')} />
          </Field>
          <Field label="Registration number (SSM, KWSP, LHDN or Customs)">
            <input className="input" value={f.regNo ?? ''} onChange={set('regNo')} />
          </Field>
          <Field label="Bank">
            <input className="input" value={f.bank ?? ''} onChange={set('bank')} />
          </Field>
          <Field label="Last 4 digits of the account (never the full number)">
            <input className="input" inputMode="numeric" maxLength={4} value={f.accountLast4 ?? ''} onChange={set('accountLast4')} />
          </Field>
          <Field label="Account name as the bank shows it">
            <input className="input" value={f.accountName ?? ''} onChange={set('accountName')} />
          </Field>
          <Field label="Where the details came from (letter, form, invoice)">
            <input className="input" value={f.source ?? ''} onChange={set('source')} />
          </Field>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={async () => {
              if (await go('payees', 'add', (({ einv: _e, einvError: _x, ...rest }) => rest)(f), 'Payee added. Someone else verifies it next.')) {
                setAdding(false);
                setF({ kind: 'supplier' });
              }
            }}
          >
            Add payee
          </button>
        </div>
      )}
      <div className="list">
        {v.payees.length === 0 && <div className="empty">No payees yet.</div>}
        {v.payees.map((p) => (
          <button key={p.id} className="list-item" onClick={() => setOpen(open === p.id ? null : p.id)}>
            <div className="fin-min0">
              <div className="fin-strong">{p.name}</div>
              <div className="muted small">
                {p.kind} · {p.regNo} · {p.bank} ending {p.accountLast4} · {p.accountName}
                {p.held ? ` · ${p.held} payment(s) on hold` : ''}
              </div>
            </div>
            <Chip tone={tone(p.status)}>{p.status === 'pending' ? 'To verify' : p.status === 'verified' ? 'Verified' : 'Blocked'}</Chip>
          </button>
        ))}
      </div>
      {sel && co.canAct && <PayeeActions v={v} p={sel} />}
    </section>
  );
}

function PayeeActions({ v, p }: { v: FinControls; p: FinControls['payees'][number] }) {
  const { act, go } = useControl(v.companyId);
  const [f, setF] = useState<Record<string, string>>({ method: 'callback' });
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [mode, setMode] = useState<'verify' | 'change' | 'block' | null>(p.status === 'pending' ? 'verify' : null);
  const run = (action: string, msg: string) => go('payees', action, { ...f, payeeId: p.id }, msg).then((r) => r && setMode(null));
  return (
    <div className="fin-pad fin-sep">
      <div className="muted small">
        Entered by {p.entered.by}, {dateTimeLabel(p.entered.at)}
        {p.verified ? ` · verified by ${p.verified.by} (${p.verified.method}, ${p.verified.contact}), ${dateTimeLabel(p.verified.at)}` : ''}
      </div>
      {p.history.length > 0 && <div className="muted small">Earlier: {p.history.map((h) => `${h.bank} ending ${h.accountLast4} until ${dateLabel(h.until.slice(0, 10))}`).join('; ')}</div>}
      <ErrorNotice error={act.error} />
      <div className="row fin-my">
        {p.status === 'pending' && (
          <button className="btn btn-sm" onClick={() => setMode('verify')}>
            Verify
          </button>
        )}
        {p.status !== 'blocked' && (
          <button className="btn btn-sm" onClick={() => setMode('change')}>
            Change bank details
          </button>
        )}
        <button className="btn btn-sm" onClick={() => setMode('block')}>
          {p.status === 'blocked' ? 'Unblock' : 'Block'}
        </button>
      </div>
      {mode === 'verify' && (
        <>
          <Field label="How it was checked">
            <select className="select" value={f.method} onChange={set('method')}>
              <option value="callback">Call-back on an independent number</option>
              <option value="document">Bank letter or statement header</option>
              <option value="bank_name_check">Bank portal / DuitNow name check</option>
            </select>
          </Field>
          <Field label="Who confirmed it on the payee side">
            <input className="input" value={f.contact ?? ''} onChange={set('contact')} />
          </Field>
          <Field label="Where the number or document came from (not the request itself)">
            <input className="input" value={f.numberSource ?? ''} onChange={set('numberSource')} />
          </Field>
          <Field label="Comment (needed)">
            <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
          </Field>
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => run('verify', 'Payee verified.')}>
            Mark verified
          </button>
        </>
      )}
      {mode === 'change' && (
        <>
          <p className="notice" data-tone="warn">
            A change of bank account is the most common payment fraud. The payee goes back to "To verify" and its open payments are held until someone else
            verifies the new details by call-back.
          </p>
          <Field label="New bank">
            <input className="input" value={f.bank ?? ''} onChange={set('bank')} />
          </Field>
          <Field label="New last 4 digits">
            <input className="input" inputMode="numeric" maxLength={4} value={f.accountLast4 ?? ''} onChange={set('accountLast4')} />
          </Field>
          <Field label="New account name as the bank shows it">
            <input className="input" value={f.accountName ?? ''} onChange={set('accountName')} />
          </Field>
          <Field label="What asked for the change (at least 10 characters)">
            <input className="input" value={f.source ?? ''} onChange={set('source')} />
          </Field>
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => run('change', 'Details changed; payee to verify again.')}>
            Save change
          </button>
        </>
      )}
      {mode === 'block' && (
        <>
          <Field label="Why (at least 10 characters)">
            <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
          </Field>
          <button className="btn btn-sm" disabled={act.busy} onClick={() => run(p.status === 'blocked' ? 'unblock' : 'block', 'Done.')}>
            {p.status === 'blocked' ? 'Unblock (back to To verify)' : 'Block payee'}
          </button>
        </>
      )}
    </div>
  );
}

// ---------- Bank statements ----------

/**
 * Automatic bank reconciliation (Fauzan, 1 Nov 2026): with the bank statement loaded above, staff paste SQL Account's
 * ledger for the account; Prima pairs the lines and shows what is left. Someone else reviews when it balances.
 */
function BankRecs({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useControl(v.companyId);
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [pick, setPick] = useState<{ lines: string[]; ledger: string[] }>({ lines: [], ledger: [] });
  const toggle = (k: 'lines' | 'ledger', id: string) => setPick((p) => ({ ...p, [k]: p[k].includes(id) ? p[k].filter((x) => x !== id) : [...p[k], id] }));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Bank reconciliation with SQL Account, {v.period}</h3>
      </div>
      <p className="muted small fin-intro">
        Load the bank statement above, then paste SQL Account&apos;s ledger for the same bank account (GL Ledger or Cash Book export: date, document no, description,
        debit, credit). Prima matches every line by reference, then by amount and date, then batches, carries last month&apos;s outstanding items forward, and
        proves the balance. Whoever paid from the account does not reconcile it; someone else reviews.
      </p>
      <ErrorNotice error={act.error} />
      {v.statements.map((s) => {
        const rec = s.rec;
        const r = rec?.result;
        const tone: Tone = !rec ? 'neutral' : rec.reviewed ? 'ok' : r && Math.abs(r.difference) < 0.005 && !r.unexplained.length ? 'info' : 'warn';
        const label = !s.statement ? 'Statement not loaded' : !rec ? 'Not reconciled' : rec.reviewed ? 'Reviewed' : r && Math.abs(r.difference) >= 0.005 ? `Off by ${rm(r.difference)}` : r?.unexplained.length ? `${r.unexplained.length} to explain` : 'Balances, to review';
        const matchedL = new Set(rec?.pairs.flatMap((p) => p.lineIds) ?? []);
        const matchedG = new Set(rec?.pairs.flatMap((p) => p.ledgerIds) ?? []);
        return (
          <div key={s.bank.id} className="fin-sep">
            <div className="list-item">
              <div className="fin-min0">
                <div className="fin-strong">
                  {s.bank.bank} {s.bank.accountMasked}
                </div>
                {r && (
                  <div className="muted small">
                    {r.matchedLines} of {r.lines} bank lines matched · bank {rm(r.statementClosing)} → adjusted {rm(r.adjustedBank)} · SQL {rm(r.ledgerClosing)} → adjusted{' '}
                    {rm(r.adjustedBook)} · run by {rec!.run.by}
                    {rec!.reviewed ? ` · reviewed by ${rec!.reviewed.by}` : ''}
                  </div>
                )}
              </div>
              <div className="row">
                <Chip tone={tone}>{label}</Chip>
                {co.canAct && s.statement && (
                  <button className="btn btn-sm" onClick={() => setOpen(open === s.bank.id ? null : s.bank.id)}>
                    {rec ? 'Run again' : 'Reconcile'}
                  </button>
                )}
              </div>
            </div>
            {open === s.bank.id && (
              <div className="fin-pad">
                <Field label="SQL Account opening balance for the month (RM)">
                  <input className="input" inputMode="decimal" value={f.opening ?? ''} onChange={set('opening')} />
                </Field>
                <Field label="SQL Account closing balance for the month (RM)">
                  <input className="input" inputMode="decimal" value={f.closing ?? ''} onChange={set('closing')} />
                </Field>
                <Field label="Export file name">
                  <input className="input" value={f.source ?? ''} onChange={set('source')} />
                </Field>
                <Field label="SQL Account ledger lines (paste the CSV)">
                  <textarea className="textarea" rows={5} value={f.csv ?? ''} onChange={set('csv')} placeholder="2026-10-03,PV-1001,Uniform Maju,0.00,4200.00" />
                </Field>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy}
                  onClick={async () => {
                    const ok = await go(
                      'bankrec',
                      'run',
                      { bankId: s.bank.id, period: v.period, ledgerOpening: Number(f.opening), ledgerClosing: Number(f.closing), source: f.source, ledgerCsv: f.csv },
                      'Reconciled automatically. Check what is left below.',
                    );
                    if (ok) setOpen(null);
                  }}
                >
                  Reconcile now
                </button>
              </div>
            )}
            {rec && r && (
              <div className="fin-padb">
                {r.outstanding.length > 0 && (
                  <p className="small">
                    <b>Payments in SQL Account not yet at the bank:</b>{' '}
                    {r.outstanding.map((g) => `${g.docNo} ${rm(g.amount)} (${dateLabel(g.date)}${g.carriedFrom ? `, from ${g.carriedFrom}` : ''})`).join('; ')}
                  </p>
                )}
                {r.inTransit.length > 0 && (
                  <p className="small">
                    <b>Deposits in SQL Account not yet credited:</b> {r.inTransit.map((g) => `${g.docNo} ${rm(g.amount)} (${dateLabel(g.date)})`).join('; ')}
                  </p>
                )}
                {r.stale.length > 0 && (
                  <p className="notice" data-tone="warn">
                    {r.stale.length} item(s) outstanding for more than 60 days: check for stale cheques or failed transfers.
                  </p>
                )}
                {r.bankOnly.length > 0 && (
                  <div className="list">
                    <div className="muted small">Bank lines with no SQL Account entry (post them in SQL Account, or match by hand):</div>
                    {r.bankOnly.map((l) => (
                      <div key={l.id} className="list-item">
                        <label className="fin-min0">
                          {co.canAct && !rec.reviewed && <input type="checkbox" checked={pick.lines.includes(l.id)} onChange={() => toggle('lines', l.id)} />} {dateLabel(l.date)} ·{' '}
                          {l.description} · {l.ref} · <b>{rm(l.amount)}</b>
                          {l.explained && <span className="muted small"> · {l.explained.note}</span>}
                        </label>
                        {co.canAct && !rec.reviewed && !l.explained && (
                          <button
                            className="btn btn-sm"
                            disabled={act.busy || (f[`x-${l.id}`] ?? '').trim().length < 10}
                            onClick={() => go('bankrec', 'explain', { recId: rec.id, lineId: l.id, comment: f[`x-${l.id}`] }, 'Explained.')}
                          >
                            Explain
                          </button>
                        )}
                        {co.canAct && !rec.reviewed && !l.explained && (
                          <input className="input" placeholder="What it is, and its SQL Account posting no." value={f[`x-${l.id}`] ?? ''} onChange={set(`x-${l.id}`)} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {co.canAct && !rec.reviewed && rec.ledger.some((g) => !matchedG.has(g.id)) && r.bankOnly.length > 0 && (
                  <details>
                    <summary className="small">Match by hand</summary>
                    <div className="list">
                      {rec.ledger
                        .filter((g) => !matchedG.has(g.id))
                        .map((g) => (
                          <label key={g.id} className="list-item small">
                            <input type="checkbox" checked={pick.ledger.includes(g.id)} onChange={() => toggle('ledger', g.id)} /> SQL {dateLabel(g.date)} · {g.docNo} · {g.description} · {rm(g.amount)}
                          </label>
                        ))}
                    </div>
                    <input className="input" placeholder="Why these belong together" value={f.handNote ?? ''} onChange={set('handNote')} />
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || !pick.lines.filter((x) => !matchedL.has(x)).length || !pick.ledger.length}
                      onClick={async () => {
                        const ok = await go('bankrec', 'match', { recId: rec.id, lineIds: pick.lines, ledgerIds: pick.ledger, comment: f.handNote }, 'Matched.');
                        if (ok) setPick({ lines: [], ledger: [] });
                      }}
                    >
                      Match selected
                    </button>
                  </details>
                )}
                {co.canAct && !rec.reviewed && Math.abs(r.difference) < 0.005 && !r.unexplained.length && (
                  <div className="row fin-mt">
                    <input className="input" placeholder="Review comment" value={f[`rv-${rec.id}`] ?? ''} onChange={set(`rv-${rec.id}`)} />
                    <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => go('bankrec', 'review', { recId: rec.id, rev: rec.rev ?? 1, comment: f[`rv-${rec.id}`] }, 'Reconciliation reviewed.')}>
                      Review
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Statements({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useControl(v.companyId);
  const [loading, setLoading] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [line, setLine] = useState<Record<string, { paymentId?: string; comment?: string }>>({});
  const released = co.payments.filter((p) => p.status === 'released');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Bank statements, {v.period}</h3>
      </div>
      <p className="muted small fin-intro">
        Load each bank's statement (CSV from the bank portal: date, description, reference, amount, with money out negative). Prima matches money out to released
        payments by amount and bank reference. Every other payment out must be explained before the close.
      </p>
      <ErrorNotice error={act.error} />
      {v.uncleared.length > 0 && (
        <p className="notice" data-tone="warn">
          Released but not on a statement yet: {v.uncleared.map((u) => `${u.payee} ${rm(u.amount)} (${dateLabel(u.releasedOn)})`).join('; ')}
        </p>
      )}
      {v.afterPayment.length > 0 && (
        <details className="fin-padb" open={v.afterPayment.some((x) => x.status === 'fail' || x.status === 'review')}>
          <summary className="small">
            Check after payment (automatic): {v.afterPayment.filter((x) => x.status === 'pass').length} passed, {v.afterPayment.filter((x) => x.status === 'fail').length} failed,{' '}
            {v.afterPayment.filter((x) => x.status === 'review').length} to compare, {v.afterPayment.filter((x) => x.status === 'waiting').length} waiting for the statement
          </summary>
          <div className="list">
            {v.afterPayment.map((x) => (
              <div key={x.id} className="list-item">
                <span className="fin-min0 fin-flex">
                  {x.payee} {rm(x.amount)} · released {x.releasedOn ? dateLabel(x.releasedOn) : '-'}
                  {(x.status === 'fail' || x.status === 'review') && (
                    <span className="muted small">
                      {' '}
                      · {x.checks.filter((c) => c.ok === false || (c.ok === null && c.key !== 'bank')).map((c) => c.label + (c.detail ? ` (${c.detail})` : '')).join('; ')}
                    </span>
                  )}
                </span>
                <Chip tone={x.status === 'pass' ? 'ok' : x.status === 'fail' ? 'crit' : 'warn'}>{x.status === 'pass' ? 'Passed' : x.status === 'fail' ? 'Failed' : x.status === 'review' ? 'Compare' : 'Waiting'}</Chip>
              </div>
            ))}
          </div>
        </details>
      )}
      {v.statements.map((s) => (
        <div key={s.bank.id} className="fin-sep">
          <div className="list-item">
            <div className="fin-min0">
              <div className="fin-strong">
                {s.bank.bank} {s.bank.accountMasked}
              </div>
              <div className="muted small">
                {s.statement
                  ? `Opening ${rm(s.statement.opening)} · closing ${rm(s.statement.closing)} · ${s.statement.loaded.source} · ${s.statement.loaded.by}`
                  : 'Not loaded'}
              </div>
            </div>
            <div className="row">
              {s.statement && <Chip tone={s.unmatchedOut ? 'warn' : 'ok'}>{s.unmatchedOut ? `${s.unmatchedOut} to match` : 'All matched'}</Chip>}
              {co.canAct && (
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setLoading(loading === s.bank.id ? null : s.bank.id);
                    setF(s.prevClosing != null ? { opening: s.prevClosing.toFixed(2) } : {});
                  }}
                >
                  {s.statement ? 'Replace' : 'Load'}
                </button>
              )}
            </div>
          </div>
          {loading === s.bank.id && (
            <div className="fin-pad">
              <Field label="Statement file from the bank portal (CSV)">
                <input
                  className="input"
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const csv = await file.text();
                      setF((x) => ({ ...x, csv, source: file.name }));
                    }
                  }}
                />
              </Field>
              {f.csv && (
                <p className="muted small">
                  {f.source}: {f.csv.split(/\r?\n/).filter((l) => l.trim()).length} line(s) read.
                </p>
              )}
              <Field label={s.prevClosing != null ? "Opening balance (RM), last month's closing" : 'Opening balance (RM)'}>
                <input className="input" inputMode="decimal" value={f.opening ?? ''} onChange={set('opening')} />
              </Field>
              <Field label="Closing balance on the statement (RM)">
                <input className="input" inputMode="decimal" value={f.closing ?? ''} onChange={set('closing')} />
              </Field>
              <details className="small">
                <summary>No file? Paste the lines instead</summary>
                <Field label="Statement file name">
                  <input className="input" value={f.source ?? ''} onChange={set('source')} />
                </Field>
                <Field label="Statement lines (date, description, reference, amount; money out negative)">
                  <textarea className="textarea" rows={5} value={f.csv ?? ''} onChange={set('csv')} placeholder="2026-10-03,IBG UNIFORM MAJU,PV-1001,-4200.00" />
                </Field>
              </details>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={async () => {
                  const r = await go(
                    'statements',
                    'load',
                    { bankId: s.bank.id, period: v.period, opening: Number(f.opening), closing: Number(f.closing), source: f.source, csv: f.csv },
                    'Statement loaded and matched.',
                  );
                  if (r) setLoading(null);
                }}
              >
                Load statement
              </button>
            </div>
          )}
          {s.statement && (
            <div className="list">
              {s.lines.map((l) => {
                const st = line[l.id] ?? {};
                const setL = (k: 'paymentId' | 'comment', val: string) => setLine((x) => ({ ...x, [l.id]: { ...x[l.id], [k]: val } }));
                return (
                  <div key={l.id} className="list-item">
                    <div className="fin-min0">
                      <div>
                        {dateLabel(l.date)} · {l.description} · {l.ref} · <b>{rm(l.amount)}</b>
                      </div>
                      <div className="muted small">
                        {l.match?.kind === 'payment' && `Matched to the payment to ${l.payee} (${l.match.by})`}
                        {l.match?.kind === 'other' && `Explained: ${l.match.note} (${l.match.by})`}
                        {l.match?.kind === 'receipt' && `Customer receipt found by Prima for invoice case ${l.match.caseId}`}
                        {l.match?.kind === 'regular' && `Direct debit found by Prima for ${l.match.regularId} (${l.match.period})`}
                        {l.match?.kind === 'guarantee' && `Guarantee collateral paid back, found by Prima (${l.match.guaranteeId})`}
                        {l.match?.kind === 'hostel' && `Hostel bill paid by the company, found by Prima (${l.match.hostelBillId})`}
                        {l.match?.kind === 'deposit' && `Client deposit or retention paid back, found by Prima (${l.match.depositId})`}
                        {l.match?.kind === 'fd' && `Fixed deposit placed or uplifted, found by Prima (${l.match.fdId})`}
                        {!l.match && (l.amount < 0 ? 'Money out with no approved payment' : 'Money in')}
                      </div>
                      {l.nameSeen === false && <div className="small fin-crit">The payee's name is not on this bank line. Check who was paid.</div>}
                    </div>
                    {co.canAct && !l.match && l.suggest.length > 0 && (
                      <div className="row">
                        {l.suggest.map((x) => (
                          <button
                            key={x.paymentId}
                            className="btn btn-sm btn-primary"
                            disabled={act.busy}
                            onClick={() =>
                              go('statements', 'match', { statementId: s.statement!.id, lineId: l.id, paymentId: x.paymentId, comment: `Accepted Prima's suggestion: same amount, ${x.days} day(s) from the release` }, 'Matched.')
                            }
                          >
                            Match to {x.payee} {rm(x.amount)} (released {x.releasedOn ? dateLabel(x.releasedOn) : '?'})
                          </button>
                        ))}
                      </div>
                    )}
                    {co.canAct && !l.match && l.amount < 0 && (
                      <div className="row">
                        <Select className="select" value={st.paymentId ?? ''} onChange={(e) => setL('paymentId', e.target.value)}>
                          <option value="">Match to a payment…</option>
                          {released.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.payee} {rm(p.amount)}
                            </option>
                          ))}
                        </Select>
                        <input className="input" placeholder="Comment, or why it is not a payment (10+ characters)" value={st.comment ?? ''} onChange={(e) => setL('comment', e.target.value)} />
                        <button
                          className="btn btn-sm"
                          disabled={act.busy || !st.paymentId || !(st.comment ?? '').trim()}
                          onClick={() => go('statements', 'match', { statementId: s.statement!.id, lineId: l.id, paymentId: st.paymentId, comment: st.comment }, 'Matched.')}
                        >
                          Match
                        </button>
                        <button
                          className="btn btn-sm"
                          disabled={act.busy || (st.comment ?? '').trim().length < 10}
                          onClick={() => go('statements', 'explain', { statementId: s.statement!.id, lineId: l.id, comment: st.comment }, 'Explained.')}
                        >
                          Explain
                        </button>
                        <button
                          className="btn btn-sm"
                          title="Explain it and let Prima explain the same kind of line next time"
                          disabled={act.busy || (st.comment ?? '').trim().length < 10}
                          onClick={() => go('statements', 'explain', { statementId: s.statement!.id, lineId: l.id, comment: st.comment, remember: true }, 'Explained and remembered.')}
                        >
                          Explain and remember
                        </button>
                      </div>
                    )}
                    {co.canAct && l.match && (
                      <div className="row">
                        <input className="input" placeholder="Why unmatch (10+ characters)" value={st.comment ?? ''} onChange={(e) => setL('comment', e.target.value)} />
                        <button
                          className="btn btn-sm"
                          disabled={act.busy || (st.comment ?? '').trim().length < 10}
                          onClick={() => go('statements', 'unmatch', { statementId: s.statement!.id, lineId: l.id, comment: st.comment }, 'Unmatched.')}
                        >
                          Unmatch
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

// ---------- Invoice problems and bad debt ----------

type ArCase = FinControls['ar']['cases'][number];
const AR_REASON: Record<ArCase['reason'], string> = {
  wrong_payer: 'Wrong payer',
  site_changed: 'Site changed',
  dispute: 'Disputed',
  refused: 'Refuses to pay',
  insolvent: 'Insolvent / bankrupt',
  govt_late: 'Government, pays late',
  other: 'Other',
};
const AR_STATUS: Record<ArCase['status'], [Tone, string]> = {
  open: ['warn', 'Open'],
  reissue_pending: ['info', 'Re-issue to approve'],
  provision_pending: ['info', 'Provision to approve'],
  writeoff_pending: ['crit', 'Write-off to approve'],
  reissued: ['ok', 'Re-issued'],
  written_off: ['neutral', 'Written off'],
  recovered: ['ok', 'Paid'],
  closed: ['neutral', 'Closed'],
};

function InvoiceCases({ v, co, lead }: { v: FinControls; co: Co; lead: boolean }) {
  const { act, go } = useControl(v.companyId);
  const ar = v.ar;
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({ reason: 'wrong_payer' });
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const sel = ar.cases.find((c) => c.id === openId) ?? null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Invoice problems and bad debt</h3>
        {co.canAct && (
          <button className="btn btn-sm" onClick={() => setAdding((x) => !x)}>
            {adding ? 'Close' : 'New case'}
          </button>
        )}
      </div>
      <p className="muted small fin-intro">
        An invoice is never deleted. A wrong payer or site is fixed with a credit note and a new invoice to the right payer (an e-Invoice only within 72 hours
        can be cancelled in MyInvois instead). A customer who will not pay is followed up at least every {ar.rule.followUpDays} days, provided for, and after{' '}
        {ar.rule.writeOffMinDays} days of recovery steps (or insolvency) written off with evidence and the Finance Director's or the CEO's approval. Every invoice
        unpaid {ar.rule.caseFromDays} days or more needs a case.
      </p>
      <ErrorNotice error={act.error} />
      <div className="list-item muted small">
        <span>
          {ar.auditedTo
            ? `Audited accounts signed to ${dateLabel(ar.auditedTo.date)} (${ar.auditedTo.set.comment}). Nothing on or before that date is changed: corrections go in the current month and the auditor is told.`
            : 'No audited year recorded yet.'}
        </span>
      </div>
      {ar.over90.cases > 0 && (
        <div className="list-item">
          <div className="fin-min0">
            <div className="fin-strong">
              Over 90 days: {ar.over90.cases} invoice(s), {rm(ar.over90.unpaid)} unpaid{ar.over90.noFollowUp ? `, ${ar.over90.noFollowUp} with no follow-up this month` : ''}
            </div>
            <div className="muted small">
              Followed up at least every month until paid, government sites included. The Finance Director checks this every month.
              {ar.fdReview ? ` Reviewed for ${ar.month} by ${ar.fdReview.sign.by}: "${ar.fdReview.sign.comment}"` : ` Not yet reviewed for ${ar.month}.`}
            </div>
          </div>
          {lead && !ar.fdReview && <FdReview v={v} />}
        </div>
      )}
      {ar.uncovered != null && ar.uncovered > 0 && (
        <p className="notice" data-tone="crit">
          The {v.period} ageing shows {rm(ar.ageingOver90)} over 90 days, but cases cover only {rm(ar.covered)}. Open a case for each of the other invoices.
        </p>
      )}
      {adding && (
        <div className="fin-pad">
          <Field label="SQL Account invoice number">
            <input className="input" value={f.invoiceNo ?? ''} onChange={set('invoiceNo')} />
          </Field>
          <Field label="Invoice date">
            <input className="input" type="date" value={f.invoiceDate ?? ''} onChange={set('invoiceDate')} />
          </Field>
          <Field label="Customer billed">
            <input className="input" value={f.customer ?? ''} onChange={set('customer')} />
          </Field>
          <Field label="Invoice amount (RM)">
            <input className="input" inputMode="decimal" value={f.amount ?? ''} onChange={set('amount')} />
          </Field>
          <Field label="Still unpaid (RM, blank = all)">
            <input className="input" inputMode="decimal" value={f.outstanding ?? ''} onChange={set('outstanding')} />
          </Field>
          <Field label="e-Invoice UUID (if validated)">
            <input className="input" value={f.eInvoiceUuid ?? ''} onChange={set('eInvoiceUuid')} />
          </Field>
          <Field label="What is wrong">
            <Select className="select" value={f.reason} onChange={set('reason')}>
              {Object.entries(AR_REASON).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What happened (at least 10 characters)">
            <input className="input" value={f.detail ?? ''} onChange={set('detail')} />
          </Field>
          <Field label="Next follow-up">
            <input className="input" type="date" value={f.nextOn ?? ''} onChange={set('nextOn')} />
          </Field>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={async () => {
              const r = await go('ar', 'open', { ...f, amount: Number(f.amount), outstanding: f.outstanding ? Number(f.outstanding) : null, nextOn: f.nextOn || null }, 'Case opened.');
              if (r) {
                setAdding(false);
                setF({ reason: 'wrong_payer' });
              }
            }}
          >
            Open case
          </button>
        </div>
      )}
      <div className="list">
        {ar.cases.length === 0 && <div className="empty">No invoice problems recorded.</div>}
        {ar.cases.map((c) => (
          <button key={c.id} className="list-item" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
            <div className="fin-min0">
              <div className="fin-strong">
                {c.invoiceNo} · {c.customer} · {rm(c.outstanding)} unpaid
              </div>
              <div className="muted small">
                {AR_REASON[c.reason]} · {dateLabel(c.invoiceDate)} ({c.ageDays} days)
                {c.priorYear ? ' · in an audited year' : ''}
                {c.stale ? ' · FOLLOW-UP OVERDUE' : ''}
              </div>
            </div>
            <Chip tone={AR_STATUS[c.status][0]}>{AR_STATUS[c.status][1]}</Chip>
          </button>
        ))}
      </div>
      {sel && <CaseDetail v={v} co={co} c={sel} />}
      {co.canAct && (
        <details className="fin-pad">
          <summary>Record the latest audited year (Finance Director or CEO)</summary>
          <Field label="Financial year end of the signed audited accounts">
            <input className="input" type="date" value={f.auditDate ?? ''} onChange={set('auditDate')} />
          </Field>
          <Field label="Auditor and date the report was signed">
            <input className="input" value={f.auditComment ?? ''} onChange={set('auditComment')} />
          </Field>
          <button className="btn btn-sm" disabled={act.busy} onClick={() => go('ar', 'auditedTo', { date: f.auditDate, comment: f.auditComment }, 'Audited year recorded.')}>
            Save
          </button>
        </details>
      )}
    </section>
  );
}

function FdReview({ v }: { v: FinControls }) {
  const { act, go } = useControl(v.companyId);
  const [comment, setComment] = useState('');
  return (
    <div className="row">
      <ErrorNotice error={act.error} />
      <input className="input" placeholder="Finance Director's review comment" value={comment} onChange={(e) => setComment(e.target.value)} />
      <button className="btn btn-sm btn-primary" disabled={act.busy || !comment.trim()} onClick={() => go('ar', 'fdReview', { comment }, 'Monthly review recorded.')}>
        Sign off this month
      </button>
    </div>
  );
}

function CaseDetail({ v, co, c }: { v: FinControls; co: Co; c: ArCase }) {
  const { act, go } = useControl(v.companyId);
  const [mode, setMode] = useState<string>('note');
  const [f, setF] = useState<Record<string, string>>({ kind: 'follow_up', method: 'credit_note' });
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const run = (action: string, input: Record<string, unknown>, msg: string) => go('ar', action, { caseId: c.id, ...input }, msg);
  const pending = c.status.endsWith('_pending');
  const modes: [string, string][] =
    c.status === 'open'
      ? [
          ['note', 'Follow-up'],
          ['payment', 'Payment received'],
          ['reissue', 'Credit note and re-issue'],
          ['provision', 'Doubtful debt provision'],
          ['writeoff', 'Bad debt write-off'],
          ['close', 'Close case'],
        ]
      : pending
        ? [
            ['note', 'Follow-up'],
            ['decide', 'Approve or return'],
          ]
        : c.status === 'written_off' && c.writeOff && c.writeOff.sstPaid > 0 && !c.writeOff.sstRelief
          ? [['sstRelief', 'SST bad debt relief']]
          : [];
  return (
    <div className="fin-pad fin-sep">
      <div className="small">{c.detail}</div>
      {(c.receipts ?? []).map((r) => (
        <div key={r.id} className="small">
          Receipt {r.ref} {rm(r.amount)} on {dateLabel(r.on)} ({r.by}):{' '}
          <Chip tone={r.matched ? 'ok' : 'warn'}>{r.matched ? `on the bank statement ${dateLabel(r.matched.date)}` : 'waiting for the bank statement'}</Chip>
        </div>
      ))}
      {c.priorYear && (
        <p className="notice" data-tone="warn">
          This invoice is in a year whose audited accounts are signed. Do not change that year in SQL Account: the credit note or write-off is dated in the current
          month, and the Finance Director tells the auditor and decides with them whether the prior year must be restated.
        </p>
      )}
      {c.ageDays >= 300 && ['open', 'reissue_pending', 'provision_pending', 'writeoff_pending'].includes(c.status) && (
        <p className="notice" data-tone="info">
          Service tax is paid when the customer pays (group rule). By law it also becomes due 12 months after the invoice if still unpaid; if it was paid and
          the debt is written off, bad debt relief needs a full document pack and Customs' approval.
        </p>
      )}
      {c.reissue && (
        <div className="muted small">
          {c.reissue.method === 'cancel72h' ? 'Cancelled in MyInvois' : `Credit note ${c.reissue.creditNoteNo} (${dateLabel(c.reissue.creditNoteDate)})`}, new invoice{' '}
          {c.reissue.newInvoiceNo} to {c.reissue.newCustomer} {rm(c.reissue.newAmount)} · asked by {c.reissue.requested.by}
          {c.reissue.approved ? ` · approved by ${c.reissue.approved.by}` : ''}
        </div>
      )}
      {c.provision && (
        <div className="muted small">
          Provision {rm(c.provision.amount)} · {c.provision.requested.comment}
          {c.provision.approved ? ` · approved by ${c.provision.approved.by}` : ' · to approve'}
        </div>
      )}
      {c.writeOff && (
        <div className="muted small">
          Write-off {rm(c.writeOff.amount)} ({c.writeOff.sqlRef}) · evidence: {c.writeOff.evidence.join(', ')} · {c.writeOff.steps}
          {c.writeOff.approved ? ` · approved by ${c.writeOff.approved.by}: "${c.writeOff.approved.comment}"` : ' · waiting for the Finance Director or the CEO'}
          {c.writeOff.sstPaid > 0 ? ` · SST paid ${rm(c.writeOff.sstPaid)}${c.writeOff.sstRelief ? `, relief claimed ${c.writeOff.sstRelief.ref}` : ', relief not claimed yet'}` : ''}
        </div>
      )}
      <div className="list">
        {[...c.log].reverse().map((l, i) => (
          <div key={i} className="list-item small">
            <span>
              {l.kind.replace('_', ' ')}: {l.text}
            </span>
            <span className="muted">
              {l.by}, {dateTimeLabel(l.at)}
            </span>
          </div>
        ))}
      </div>
      {co.canAct && modes.length > 0 && (
        <>
          <ErrorNotice error={act.error} />
          <div className="row fin-my">
            {modes.map(([k, l]) => (
              <button key={k} className={`btn btn-sm${mode === k ? ' btn-primary' : ''}`} onClick={() => setMode(k)}>
                {l}
              </button>
            ))}
          </div>
          {mode === 'note' && (
            <>
              <Field label="What was done">
                <select className="select" value={f.kind} onChange={set('kind')}>
                  <option value="follow_up">Follow-up</option>
                  <option value="reminder">Reminder sent</option>
                  <option value="call">Call</option>
                  <option value="meeting">Meeting</option>
                  <option value="demand_letter">Letter of demand</option>
                  <option value="lawyer">Lawyer / legal action</option>
                </select>
              </Field>
              <Field label="Details (at least 10 characters)">
                <input className="input" value={f.text ?? ''} onChange={set('text')} />
              </Field>
              <Field label="Next follow-up">
                <input className="input" type="date" value={f.nextOn ?? ''} onChange={set('nextOn')} />
              </Field>
              <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => run('note', { kind: f.kind, text: f.text, nextOn: f.nextOn || null }, 'Follow-up recorded.')}>
                Save
              </button>
            </>
          )}
          {mode === 'payment' && (
            <>
              <Field label="Amount received (RM)">
                <input className="input" inputMode="decimal" value={f.paid ?? ''} onChange={set('paid')} />
              </Field>
              <Field label="SQL Account receipt number">
                <input className="input" value={f.ref ?? ''} onChange={set('ref')} />
              </Field>
              <Field label="Date the money came in">
                <input className="input" type="date" value={f.on ?? ''} onChange={set('on')} />
              </Field>
              <Field label="Paid into">
                <Select className="select" value={f.bankId ?? ''} onChange={set('bankId')}>
                  <option value="">Choose the bank account</option>
                  {co.banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bank} {b.accountMasked}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="muted small">The invoice stays unpaid until Prima finds this money on the bank statement of that account. Nobody confirms it by hand.</p>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !f.bankId}
                onClick={() => run('payment', { amount: Number(f.paid), ref: f.ref, on: f.on || undefined, bankId: f.bankId }, 'Receipt recorded. It counts once Prima finds it on the bank statement.')}
              >
                Save
              </button>
            </>
          )}
          {mode === 'reissue' && (
            <>
              <Field label="How the wrong invoice is reversed">
                <select className="select" value={f.method} onChange={set('method')}>
                  <option value="credit_note">Credit note in SQL Account (and its e-Invoice)</option>
                  <option value="cancel72h">Cancel in MyInvois (only within 72 hours of validation)</option>
                </select>
              </Field>
              {f.method === 'credit_note' && (
                <>
                  <Field label="Credit note number">
                    <input className="input" value={f.creditNoteNo ?? ''} onChange={set('creditNoteNo')} />
                  </Field>
                  <Field label="Credit note date (in the current open month)">
                    <input className="input" type="date" value={f.creditNoteDate ?? ''} onChange={set('creditNoteDate')} />
                  </Field>
                </>
              )}
              <Field label="New invoice number">
                <input className="input" value={f.newInvoiceNo ?? ''} onChange={set('newInvoiceNo')} />
              </Field>
              <Field label="The right payer">
                <input className="input" value={f.newCustomer ?? ''} onChange={set('newCustomer')} />
              </Field>
              <Field label="New invoice amount (RM)">
                <input className="input" inputMode="decimal" value={f.newAmount ?? String(c.amount)} onChange={set('newAmount')} />
              </Field>
              <Field label="What changed (payer, site, address, PO)">
                <input className="input" value={f.note ?? ''} onChange={set('note')} />
              </Field>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() =>
                  run(
                    'reissue',
                    { method: f.method, creditNoteNo: f.creditNoteNo, creditNoteDate: f.creditNoteDate || undefined, newInvoiceNo: f.newInvoiceNo, newCustomer: f.newCustomer, newAmount: Number(f.newAmount ?? c.amount), note: f.note },
                    'Sent for approval.',
                  )
                }
              >
                Send for approval
              </button>
            </>
          )}
          {mode === 'provision' && (
            <>
              <Field label="Provision (RM)">
                <input className="input" inputMode="decimal" value={f.prov ?? ''} onChange={set('prov')} />
              </Field>
              <Field label="Why it may not be paid (at least 10 characters)">
                <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
              </Field>
              <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => run('provision', { amount: Number(f.prov), comment: f.comment }, 'Sent for approval.')}>
                Send for approval
              </button>
            </>
          )}
          {mode === 'writeoff' && (
            <>
              <p className="notice" data-tone="warn">
                Bad debt is written off only after recovery steps ({ar_days(v)} days, or insolvency), with evidence, and approved by the Finance Director or the CEO.
              </p>
              <Field label="Amount to write off (RM, blank = all unpaid)">
                <input className="input" inputMode="decimal" value={f.woAmount ?? ''} onChange={set('woAmount')} />
              </Field>
              <Field label="Evidence, one per line (demand letter, lawyer's letter, liquidation or bankruptcy notice)">
                <textarea className="textarea" rows={3} value={f.evidence ?? ''} onChange={set('evidence')} />
              </Field>
              <Field label="Recovery steps taken">
                <input className="input" value={f.steps ?? ''} onChange={set('steps')} />
              </Field>
              <Field label="SQL Account credit note or journal for the write-off">
                <input className="input" value={f.sqlRef ?? ''} onChange={set('sqlRef')} />
              </Field>
              <Field label="Service tax already paid to Customs on this invoice (RM, 0 if none)">
                <input className="input" inputMode="decimal" value={f.sstPaid ?? ''} onChange={set('sstPaid')} />
              </Field>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() =>
                  run(
                    'writeoff',
                    {
                      amount: f.woAmount ? Number(f.woAmount) : null,
                      evidence: (f.evidence ?? '').split('\n').map((x) => x.trim()).filter(Boolean),
                      steps: f.steps,
                      sqlRef: f.sqlRef,
                      sstPaid: f.sstPaid ? Number(f.sstPaid) : 0,
                    },
                    'Write-off sent to the Finance Director or the CEO.',
                  )
                }
              >
                Send for approval
              </button>
            </>
          )}
          {mode === 'decide' && (
            <div className="row">
              <input className="input" placeholder="Comment (needed; 10+ characters to return)" value={f.comment ?? ''} onChange={set('comment')} />
              <button className="btn btn-sm btn-primary" disabled={act.busy || !(f.comment ?? '').trim()} onClick={() => run('approve', { comment: f.comment }, 'Approved.')}>
                Approve
              </button>
              <button className="btn btn-sm" disabled={act.busy || (f.comment ?? '').trim().length < 10} onClick={() => run('return', { comment: f.comment }, 'Returned.')}>
                Return
              </button>
            </div>
          )}
          {mode === 'close' && (
            <div className="row">
              <input className="input" placeholder="Why it is settled (10+ characters)" value={f.comment ?? ''} onChange={set('comment')} />
              <button className="btn btn-sm" disabled={act.busy || (f.comment ?? '').trim().length < 10} onClick={() => run('close', { comment: f.comment }, 'Case closed.')}>
                Close case
              </button>
            </div>
          )}
          {mode === 'sstRelief' && (
            <>
              <p className="notice" data-tone="info">
                Customs needs the full documents and must approve the claim; money is rarely recovered. The claim then appears under Service tax, where a team
                leader, the FD or the CEO (not you) submits it and records Customs' answer.
              </p>
              <Field label="Documents, one per line (invoice and credit note, SST-02 and Customs receipt, customer payment record, write-off approval, recovery evidence)">
                <textarea className="textarea" rows={4} value={f.docs ?? ''} onChange={set('docs')} />
              </Field>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() => run('sstRelief', { documents: (f.docs ?? '').split('\n').map((x) => x.trim()).filter(Boolean) }, 'Customs claim prepared.')}
              >
                Prepare the Customs claim
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
const ar_days = (v: FinControls) => v.ar.rule.writeOffMinDays;

// ---------- Ageing ----------

const BUCKETS = [
  ['current', 'Not due'],
  ['d1to30', '1-30 days'],
  ['d31to60', '31-60 days'],
  ['d61to90', '61-90 days'],
  ['over90', 'Over 90 days'],
] as const;

function Ageing({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useControl(v.companyId);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [comment, setComment] = useState('');
  const r = v.ageing.record;
  const bucket = (side: 'ar' | 'ap') => Object.fromEntries(BUCKETS.map(([k]) => [k, Number(f[`${side}.${k}`] ?? 0)]));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Customer and supplier ageing, {v.period}</h3>
        <Chip tone={r?.reviewed ? 'ok' : r ? 'warn' : v.ageing.late ? 'crit' : 'warn'}>{r?.reviewed ? 'Reviewed' : r ? 'To review' : v.ageing.late ? 'Late' : `Due ${dateLabel(v.ageing.dueOn)}`}</Chip>
      </div>
      <p className="muted small fin-intro">
        Every month, from the SQL Account Customer and Supplier Aging reports. The totals must agree with debtors and creditors in the ledger, or the difference
        becomes a close exception.
      </p>
      <ErrorNotice error={act.error} />
      {r && (
        <>
          <div className="fin-scroll fin-sep fin-mt">
            <table className="fin-table">
              <thead>
                <tr>
                  <th />
                  {BUCKETS.map(([k, l]) => (
                    <th key={k} className="fin-num">
                      {l}
                    </th>
                  ))}
                  <th className="fin-num">Total</th>
                  <th className="fin-num">Ledger</th>
                </tr>
              </thead>
              <tbody>
                {(['ar', 'ap'] as const).map((side) => (
                  <tr key={side}>
                    <td className="fin-strong">{side === 'ar' ? 'Customers owe' : 'We owe suppliers'}</td>
                    {BUCKETS.map(([k]) => (
                      <td key={k} className="fin-num">
                        {rm(r[side][k])}
                      </td>
                    ))}
                    <td className="fin-num fin-strong">{rm(side === 'ar' ? v.ageing.arTotal : v.ageing.apTotal)}</td>
                    <td className="fin-num">{rm(side === 'ar' ? r.glAr : r.glAp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small fin-intro fin-mb">
            {r.source} · prepared by {r.prepared.by}
            {r.reviewed ? ` · reviewed by ${r.reviewed.by}: "${r.reviewed.comment}"` : ''}
          </p>
        </>
      )}
      {co.canAct && r && !r.reviewed && (
        <div className="row fin-pad">
          <input className="input" placeholder="Review comment (needed)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn btn-sm btn-primary" disabled={act.busy || !comment.trim()} onClick={() => go('ageing', 'review', { period: v.period, comment }, 'Ageing reviewed.')}>
            Mark reviewed
          </button>
        </div>
      )}
      {co.canAct && !r?.reviewed && (
        <details className="fin-pad">
          <summary>{r ? 'Record again' : 'Record the ageing'}</summary>
          {(['ar', 'ap'] as const).map((side) => (
            <div key={side}>
              <div className="fin-strong fin-subhead">{side === 'ar' ? 'Customers (receivables)' : 'Suppliers (payables)'}</div>
              <div className="row">
                {BUCKETS.map(([k, l]) => (
                  <input key={k} className="input fin-maxw" inputMode="decimal" placeholder={l} value={f[`${side}.${k}`] ?? ''} onChange={set(`${side}.${k}`)} />
                ))}
              </div>
            </div>
          ))}
          <Field label="Debtors in the ledger (RM)">
            <input className="input" inputMode="decimal" value={f.glAr ?? ''} onChange={set('glAr')} />
          </Field>
          <Field label="Creditors in the ledger (RM)">
            <input className="input" inputMode="decimal" value={f.glAp ?? ''} onChange={set('glAp')} />
          </Field>
          <Field label="SQL Account ageing report filed (file name or SharePoint link)">
            <input className="input" value={f.source ?? ''} onChange={set('source')} />
          </Field>
          <Field label="Note: long overdue customers, disputes, collection actions">
            <input className="input" value={f.note ?? ''} onChange={set('note')} />
          </Field>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              go('ageing', 'record', { period: v.period, ar: bucket('ar'), ap: bucket('ap'), glAr: Number(f.glAr), glAp: Number(f.glAp), source: f.source, note: f.note }, 'Ageing recorded.')
            }
          >
            Save ageing
          </button>
        </details>
      )}
      {v.ageingHistory.length > 0 && (
        <div className="list">
          {v.ageingHistory.map((h) => (
            <div key={h.period} className="list-item small">
              <span>{h.period}</span>
              <span className="muted">
                Customers {rm(h.ar)} (over 90 days {rm(h.over90)}) · Suppliers {rm(h.ap)} {h.reviewed ? '' : '· not reviewed'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- e-Invoice ----------

const EI_COUNTS = [
  ['issued', 'Sales documents issued (invoices, credit and debit notes)'],
  ['valid', 'Valid in MyInvois'],
  ['invalid', 'Invalid (rejected by LHDN)'],
  ['submitting', 'Stuck in "Submitting"'],
  ['notSubmitted', 'Not submitted'],
  ['largeInConsolidated', 'Single sales above RM10,000 put in the consolidated e-Invoice'],
  ['selfBilledNeeded', 'Self-billed e-Invoices needed (foreign suppliers, agents)'],
  ['selfBilledValid', 'Self-billed e-Invoices validated'],
  ['suppliersWithout', 'Supplier invoices posted with no validated e-Invoice'],
  ['lateCancels', 'Cancelled after 72 hours (should be a credit note)'],
] as const;

function EInvoice({ v, co, lead }: { v: FinControls; co: Co; lead: boolean }) {
  const { act, go } = useControl(v.companyId);
  const e = v.einvoice;
  const r = e.record;
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (ev: { target: { value: string } }) => setF((x) => ({ ...x, [k]: ev.target.value }));
  const [comment, setComment] = useState('');
  const open = r ? r.invalid + r.submitting + r.notSubmitted : 0;
  const tone = !e.setup?.required ? 'neutral' : r?.reviewed && !open ? 'ok' : !r && e.late ? 'crit' : 'warn';
  const label = !e.setup ? 'Not set up' : !e.setup.required ? 'Not required' : !r ? (e.late ? 'Late' : `Due ${dateLabel(e.dueOn)}`) : open ? `${open} not validated` : r.reviewed ? 'Checked' : 'To review';
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>e-Invoice (LHDN MyInvois), {v.period}</h3>
        <Chip tone={tone}>{label}</Chip>
      </div>
      <p className="muted small fin-intro">
        Each company is tested on its own turnover: from RM3 million it must issue e-Invoices. SQL Account sends the e-Invoices to MyInvois. Each month, count from SQL Account's MyInvois Transaction listing (after Batch Check E-Invoice Status):
        every sales document must be Valid, sales to buyers who did not ask for an e-Invoice go into one consolidated e-Invoice by the 7th
        ({dateLabel(e.consolidateBy)}), a single sale above RM10,000 gets its own e-Invoice, and after 72 hours a mistake is corrected with a credit note,
        not a cancellation.
      </p>
      <ErrorNotice error={act.error} />
      {e.setup && (
        <div className="list-item muted small">
          {e.setup.required ? `Required since ${dateLabel(e.setup.startOn)}, sent via ${e.setup.via === 'sql_account' ? 'SQL Account' : e.setup.via}` : 'Not required'} · {e.setup.basis} ·
          set by {e.setup.set.by}
        </div>
      )}
      {r && (
        <div className="list">
          <div className="list-item">
            <div className="fin-min0">
              <div className="fin-strong">
                {r.valid} of {r.issued} valid · {r.invalid} invalid · {r.submitting} stuck · {r.notSubmitted} not submitted
              </div>
              <div className="muted small">
                Consolidated: {r.consolidated ? `${r.consolidated.uuid}, submitted ${dateLabel(r.consolidated.submittedOn)}` : r.consolidatedNeeded ? 'MISSING' : 'not needed'} · self-billed{' '}
                {r.selfBilledValid}/{r.selfBilledNeeded} · supplier invoices without e-Invoice {r.suppliersWithout}
                {r.largeInConsolidated ? ` · ${r.largeInConsolidated} big sale(s) consolidated` : ''}
                {r.lateCancels ? ` · ${r.lateCancels} late cancellation(s)` : ''}
              </div>
              <div className="muted small">
                {r.source} · recorded by {r.prepared.by}
                {r.reviewed ? ` · reviewed by ${r.reviewed.by}: "${r.reviewed.comment}"` : ''}
              </div>
            </div>
          </div>
        </div>
      )}
      {co.canAct && r && !r.reviewed && (
        <div className="row fin-pad">
          <input className="input" placeholder="Review comment (needed)" value={comment} onChange={(ev) => setComment(ev.target.value)} />
          <button className="btn btn-sm btn-primary" disabled={act.busy || !comment.trim()} onClick={() => go('einvoice', 'review', { period: v.period, rev: r.rev ?? 1, comment }, 'e-Invoice check reviewed.')}>
            Mark reviewed
          </button>
        </div>
      )}
      {co.canAct && r?.reviewed && (
        <details className="fin-pad">
          <summary className="small">Reopen (team leader, Finance Director or CEO)</summary>
          <div className="row">
            <input className="input" placeholder="Why it is reopened (needed)" value={comment} onChange={(ev) => setComment(ev.target.value)} />
            <button className="btn btn-sm" disabled={act.busy || !comment.trim()} onClick={() => go('einvoice', 'reopen', { period: v.period, comment }, 'e-Invoice check reopened.')}>
              Reopen
            </button>
          </div>
        </details>
      )}
      {co.canAct && e.setup?.required && !r?.reviewed && (
        <details className="fin-pad">
          <summary>{r ? 'Count again' : 'Record the month’s e-Invoice check'}</summary>
          {EI_COUNTS.map(([k, l]) => (
            <Field key={k} label={l}>
              <input className="input" inputMode="numeric" value={f[k] ?? ''} onChange={set(k)} />
            </Field>
          ))}
          <Field label="Were there sales to consolidate (buyers who did not ask for an e-Invoice)?">
            <select className="select" value={f.consolidatedNeeded ?? 'no'} onChange={set('consolidatedNeeded')}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
          <Field label="Consolidated e-Invoice UUID (from SQL Account or the MyInvois Portal)">
            <input className="input" value={f.consolidatedUuid ?? ''} onChange={set('consolidatedUuid')} />
          </Field>
          <Field label="Date it was submitted">
            <input className="input" type="date" value={f.consolidatedOn ?? ''} onChange={set('consolidatedOn')} />
          </Field>
          <Field label="MyInvois Transaction listing filed (file name or SharePoint link)">
            <input className="input" value={f.source ?? ''} onChange={set('source')} />
          </Field>
          <Field label="Note">
            <input className="input" value={f.note ?? ''} onChange={set('note')} />
          </Field>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              go(
                'einvoice',
                'record',
                {
                  period: v.period,
                  ...Object.fromEntries(EI_COUNTS.map(([k]) => [k, Number(f[k] || 0)])),
                  consolidatedNeeded: f.consolidatedNeeded === 'yes',
                  consolidatedUuid: f.consolidatedUuid,
                  consolidatedOn: f.consolidatedOn,
                  source: f.source,
                  note: f.note,
                },
                'e-Invoice check recorded.',
              )
            }
          >
            Save
          </button>
        </details>
      )}
      {e.setup?.required && e.paymentsWithout.length > 0 && (
        <p className="notice" data-tone="warn">
          Supplier payments with no e-Invoice UUID: {e.paymentsWithout.slice(0, 5).map((p) => `${p.payee} ${rm(p.amount)}`).join('; ')}
          {e.paymentsWithout.length > 5 ? ` and ${e.paymentsWithout.length - 5} more` : ''}. Ask the supplier for its validated e-Invoice before paying.
        </p>
      )}
      {co.canAct && lead && (
        <details className="fin-pad">
          <summary>e-Invoice set-up (Finance Director or CEO)</summary>
          <Field label="Must this company issue e-Invoices?">
            <select className="select" value={f.required ?? (e.setup?.required === false ? 'no' : 'yes')} onChange={set('required')}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
          <Field label="This company's own annual turnover, last financial year (RM). Each company is tested on its own, not group sales">
            <input className="input" inputMode="decimal" value={f.revenue ?? (e.setup?.revenue != null ? String(e.setup.revenue) : '')} onChange={set('revenue')} />
          </Field>
          <Field label="Basis (turnover; or why it issues e-Invoices voluntarily)">
            <input className="input" value={f.basis ?? e.setup?.basis ?? ''} onChange={set('basis')} />
          </Field>
          <Field label="Started issuing e-Invoices on">
            <input className="input" type="date" value={f.startOn ?? e.setup?.startOn ?? ''} onChange={set('startOn')} />
          </Field>
          <Field label="Sent to MyInvois through">
            <select className="select" value={f.via ?? e.setup?.via ?? 'sql_account'} onChange={set('via')}>
              <option value="sql_account">SQL Account (MyInvois module)</option>
              <option value="portal">MyInvois Portal</option>
              <option value="other">Another system</option>
            </select>
          </Field>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() =>
              go(
                'einvoice',
                'setup',
                {
                  required: (f.required ?? (e.setup?.required === false ? 'no' : 'yes')) === 'yes',
                  basis: f.basis ?? e.setup?.basis,
                  startOn: f.startOn ?? e.setup?.startOn,
                  via: f.via ?? e.setup?.via ?? 'sql_account',
                  revenue: Number(f.revenue ?? e.setup?.revenue ?? ''),
                },
                'e-Invoice set-up saved.',
              )
            }
          >
            Save
          </button>
        </details>
      )}
      {e.history.length > 1 && (
        <div className="list">
          {e.history.map((h) => (
            <div key={h.period} className="list-item small">
              <span>{h.period}</span>
              <span className="muted">
                {h.valid}/{h.issued} valid{h.open ? ` · ${h.open} not validated` : ''}
                {h.reviewed ? '' : ' · not reviewed'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- SST ----------

function Sst({ v, co, lead }: { v: FinControls; co: Co; lead: boolean }) {
  const { act, go } = useControl(v.companyId);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const s = v.sst;
  const tax = co.payments.filter((p) => p.payeeKind === 'tax' && !['cancelled', 'returned'].includes(p.status));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Service tax (SST) to Customs</h3>
      </div>
      <p className="muted small fin-intro">
        Security services are taxable at 8%. A registered company files SST-02 in MySST every two months and pays Customs by the last day of the month after
        the period. Late payment adds 10%, then 15% and 15% more (up to 40%). The payment to Customs goes through a normal Prima payment and must equal the
        declared tax exactly.
      </p>
      <ErrorNotice error={act.error} />
      {s?.mustRegister && <p className="notice" data-tone="crit">Taxable services in the last 12 months are above the registration threshold: register with Customs.</p>}
      {s && (
        <div className="list-item muted small">
          {s.registered ? `Registered, ${s.sstNo}, periods start in month ${s.cycleStartMonth}` : 'Not registered'}
          {s.last12Months != null ? ` · last 12 months ${rm(s.last12Months)}` : ''}
        </div>
      )}
      <div className="list">
        {(s?.returns ?? []).map((r) => (
          <div key={r.from} className="list-item fin-stack">
            <div className="row fin-between">
              <div className="fin-min0">
                <div className="fin-strong">
                  {r.from} to {r.to} · due {dateLabel(r.dueOn)}
                </div>
                <div className="muted small">
                  {r.record
                    ? `${r.basis === 'legacy' ? 'Old basis (value × 8%, no receipts comparison) · ' : ''}${r.record.received != null ? `Received ${rm(r.record.received)} × 8/108 = ${rm(r.expected)}${r.record.invoiceSst != null ? ` · invoices' SST ${rm(r.record.invoiceSst)}` : ''}` : `Taxable ${rm(r.record.taxableValue)} × ${(r.record.rate * 100).toFixed(0)}% = ${rm(r.expected)}`} · declared ${rm(r.record.declared)}${r.record.differenceNote ? ` (${r.record.differenceNote})` : ''}`
                    : 'Not prepared'}
                  {r.record?.filed ? ` · filed ${dateLabel(r.record.filed.filedOn)}, ack ${r.record.filed.ackRef}` : ''}
                  {r.payment ? ` · payment ${rm(r.payment.amount)} ${r.payment.status}` : ''}
                </div>
                {r.record && r.problems.length > 0 && <div className="small">{r.problems.join(' · ')}</div>}
                {r.penalty > 0 && <div className="small fin-crit">Late payment penalty so far: {rm(r.penalty)}</div>}
              </div>
              <Chip tone={r.tone}>{r.tone === 'ok' ? 'Filed and paid' : r.tone === 'crit' ? 'Late' : 'Open'}</Chip>
            </div>
            {co.canAct && s?.registered && (
              <SstReturnActions companyId={v.companyId} r={r} tax={tax} busy={act.busy} go={go} />
            )}
          </div>
        ))}
      </div>
      {s && <SstClaims v={v} co={co} claims={s.claims} />}
      {co.canAct && lead && (
        <details className="fin-pad">
          <summary>SST registration (Finance Director or CEO)</summary>
          <Field label="Registered with Customs?">
            <select className="select" value={f.registered ?? (s?.registered ? 'yes' : 'no')} onChange={set('registered')}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
          <Field label="SST registration number">
            <input className="input" value={f.sstNo ?? s?.sstNo ?? ''} onChange={set('sstNo')} />
          </Field>
          <Field label="First month of a taxable period (1-12, from the registration letter)">
            <input className="input" inputMode="numeric" value={f.cycleStartMonth ?? String(s?.cycleStartMonth ?? 1)} onChange={set('cycleStartMonth')} />
          </Field>
          <Field label="Taxable services, last 12 months (RM)">
            <input className="input" inputMode="decimal" value={f.last12Months ?? (s?.last12Months != null ? String(s.last12Months) : '')} onChange={set('last12Months')} />
          </Field>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() =>
              go(
                'sst',
                'setup',
                {
                  registered: (f.registered ?? (s?.registered ? 'yes' : 'no')) === 'yes',
                  sstNo: f.sstNo ?? s?.sstNo,
                  cycleStartMonth: Number(f.cycleStartMonth ?? s?.cycleStartMonth ?? 1),
                  last12Months: f.last12Months ?? s?.last12Months ?? null,
                },
                'SST registration saved.',
              )
            }
          >
            Save
          </button>
        </details>
      )}
    </section>
  );
}

type SstRow = NonNullable<FinControls['sst']>['returns'][number];
type Claim = NonNullable<FinControls['sst']>['claims'][number];

/** Claims to Customs: bad debt relief (from an invoice case) or a wrong payment. Full documents; Customs decides. */
function SstClaims({ v, co, claims }: { v: FinControls; co: Co; claims: Claim[] }) {
  const { act, go } = useControl(v.companyId);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const docs = (k: string) => (f[k] ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
  return (
    <div className="fin-padb">
      <div className="fin-strong fin-subhead">Claims to Customs</div>
      <ErrorNotice error={act.error} />
      {claims.length === 0 && <div className="muted small">None. Tax is paid when the customer pays, so bad debt relief should rarely be needed.</div>}
      {claims.map((c) => (
        <div key={c.id} className="list-item fin-stack">
          <div className="row fin-between">
            <div className="fin-min0">
              <div className="fin-strong">
                {c.kind === 'bad_debt_relief' ? 'Bad debt relief' : 'Wrong payment'} · {rm(c.amount)}
              </div>
              <div className="muted small">
                {c.reason} · {c.documents.length} documents: {c.documents.join('; ')} · prepared by {c.prepared.by}
                {c.submitted ? ` · submitted ${dateLabel(c.submitted.on)}, ref ${c.submitted.ref}, by ${c.submitted.by}` : ''}
                {c.result ? ` · Customs ${c.result.outcome} ${rm(c.result.amount)} on ${dateLabel(c.result.on)}: ${c.result.comment}` : ''}
              </div>
            </div>
            <Chip tone={!c.submitted ? 'warn' : !c.result ? 'info' : c.result.outcome === 'approved' ? 'ok' : 'crit'}>
              {!c.submitted ? 'To submit' : !c.result ? 'With Customs' : c.result.outcome === 'approved' ? 'Approved' : 'Rejected'}
            </Chip>
          </div>
          {co.canAct && !c.submitted && (
            <div className="row">
              <input className="input" placeholder="Customs claim reference" value={f[`ref-${c.id}`] ?? ''} onChange={set(`ref-${c.id}`)} />
              <input className="input" placeholder="Comment: documents checked (needed)" value={f[`cm-${c.id}`] ?? ''} onChange={set(`cm-${c.id}`)} />
              <button className="btn btn-sm" disabled={act.busy} onClick={() => go('sst', 'claimSubmit', { claimId: c.id, ref: f[`ref-${c.id}`], comment: f[`cm-${c.id}`] }, 'Claim submitted.')}>
                Record submission
              </button>
            </div>
          )}
          {co.canAct && c.submitted && !c.result && (
            <div className="row">
              <select className="select" value={f[`out-${c.id}`] ?? 'approved'} onChange={set(`out-${c.id}`)}>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <input className="input" inputMode="decimal" placeholder="Amount approved (RM)" value={f[`amt-${c.id}`] ?? ''} onChange={set(`amt-${c.id}`)} />
              <input className="input" placeholder="Customs' letter and comment (needed)" value={f[`res-${c.id}`] ?? ''} onChange={set(`res-${c.id}`)} />
              <button
                className="btn btn-sm"
                disabled={act.busy}
                onClick={() => go('sst', 'claimResult', { claimId: c.id, outcome: f[`out-${c.id}`] ?? 'approved', amount: Number(f[`amt-${c.id}`] || 0), comment: f[`res-${c.id}`] }, 'Answer recorded.')}
              >
                Record Customs' answer
              </button>
            </div>
          )}
        </div>
      ))}
      {co.canAct && (
        <details className="fin-mt">
          <summary>Claim back a wrong payment to Customs</summary>
          <Field label="Amount (RM)">
            <input className="input" inputMode="decimal" value={f.amount ?? ''} onChange={set('amount')} />
          </Field>
          <Field label="What was paid wrongly and why (at least 10 characters)">
            <input className="input" value={f.reason ?? ''} onChange={set('reason')} />
          </Field>
          <Field label="Documents, one per line (at least 3: SST-02, payment receipt, bank statement, working, letter to Customs)">
            <textarea className="textarea" rows={4} value={f.docs ?? ''} onChange={set('docs')} />
          </Field>
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => go('sst', 'claim', { amount: Number(f.amount), reason: f.reason, documents: docs('docs') }, 'Claim prepared.')}>
            Prepare claim
          </button>
        </details>
      )}
    </div>
  );
}

function SstReturnActions({
  r,
  tax,
  busy,
  go,
}: {
  companyId: string;
  r: SstRow;
  tax: Co['payments'];
  busy: boolean;
  go: (area: FinControlArea, action: string, input: Record<string, unknown>, msg: string) => Promise<unknown>;
}) {
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const rec = r.record;
  if (rec?.filed && rec.paymentId) return null;
  return (
    <details>
      <summary>{!rec ? 'Prepare the return' : !rec.reviewed ? 'Review' : !rec.filed ? 'Record filing in MySST' : 'Link the payment to Customs'}</summary>
      {(!rec || !rec.reviewed) && !rec && (
        <>
          <Field label="Money received in the period for taxable services, SST included (RM, from SQL Account receipts)">
            <input className="input" inputMode="decimal" value={f.received ?? ''} onChange={set('received')} />
          </Field>
          <Field label="SST shown on the invoices those receipts paid (RM, 8% of the bill without SST)">
            <input className="input" inputMode="decimal" value={f.invoiceSst ?? ''} onChange={set('invoiceSst')} />
          </Field>
          {f.received && Number(f.received) > 0 && <div className="muted small">Tax on money received: 8/108 × {rm(Number(f.received))} = {rm(Math.round(((Number(f.received) * 8) / 108) * 100) / 100)}</div>}
          <Field label="Service tax declared on the SST-02 (RM)">
            <input className="input" inputMode="decimal" value={f.declared ?? ''} onChange={set('declared')} />
          </Field>
          <Field label="Why it differs, if it does (part or short payments, wrong SST on an invoice, exempt services, credit notes)">
            <input className="input" value={f.differenceNote ?? ''} onChange={set('differenceNote')} />
          </Field>
          <Field label="SQL Account SST-02 draft or listing filed">
            <input className="input" value={f.source ?? ''} onChange={set('source')} />
          </Field>
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() =>
              go('sst', 'prepare', { month: r.from, received: Number(f.received), invoiceSst: Number(f.invoiceSst), declared: Number(f.declared), differenceNote: f.differenceNote, source: f.source }, 'Return prepared.')
            }
          >
            Prepare
          </button>
        </>
      )}
      {rec && !rec.reviewed && (
        <div className="row">
          <input className="input" placeholder="Review comment (needed)" value={f.comment ?? ''} onChange={set('comment')} />
          <button className="btn btn-sm btn-primary" disabled={busy || !(f.comment ?? '').trim()} onClick={() => go('sst', 'review', { returnId: rec.id, comment: f.comment }, 'Return reviewed.')}>
            Mark reviewed
          </button>
        </div>
      )}
      {rec?.reviewed && !rec.filed && (
        <>
          <Field label="MySST acknowledgement number">
            <input className="input" value={f.ackRef ?? ''} onChange={set('ackRef')} />
          </Field>
          <Field label="Filing date">
            <input className="input" type="date" value={f.filedOn ?? ''} onChange={set('filedOn')} />
          </Field>
          <Field label="Comment (needed)">
            <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
          </Field>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => go('sst', 'file', { returnId: rec.id, ackRef: f.ackRef, filedOn: f.filedOn || undefined, comment: f.comment }, 'Filing recorded.')}>
            Record filing
          </button>
        </>
      )}
      {rec?.reviewed && !rec.paymentId && (
        <div className="row fin-mt">
          <Select className="select" value={f.paymentId ?? ''} onChange={set('paymentId')}>
            <option value="">Payment to Customs…</option>
            {tax.map((p) => (
              <option key={p.id} value={p.id}>
                {p.payee} {rm(p.amount)} ({p.status})
              </option>
            ))}
          </Select>
          <button className="btn btn-sm" disabled={busy || !f.paymentId} onClick={() => go('sst', 'linkPayment', { returnId: rec.id, paymentId: f.paymentId }, 'Payment linked.')}>
            Link payment
          </button>
          <span className="muted small">Prepare it under Payments to the Customs payee for exactly {rm(rec.declared)}.</span>
        </div>
      )}
    </details>
  );
}

// ---------- Budget and forecast ----------

/** "120000" spreads evenly over 12 months; "10000, 9000, …" (12 numbers) gives each month. */
function months(s: string): number[] | null {
  const parts = s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 12) return parts;
  if (parts.length !== 1) return null;
  const each = Math.round((parts[0] / 12) * 100) / 100;
  return Array.from({ length: 12 }, (_, i) => (i < 11 ? each : Math.round((parts[0] - each * 11) * 100) / 100));
}

function Plan({ v, co, lead, me }: { v: FinControls; co: Co; lead: boolean; me: string }) {
  const [which, setWhich] = useState<'this' | 'next'>('this');
  const pv = which === 'this' ? v.plan : v.nextPlan;
  const { act, go } = useControl(v.companyId);
  const [lines, setLines] = useState<Record<string, string>>({});
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [why, setWhy] = useState<Record<string, string>>({});
  const b = pv.plan?.budget ?? null;
  const figures = () => {
    const out: Record<string, number[]> = {};
    for (const l of FIN_PLAN_LINES) {
      const t = (lines[l] ?? '').trim();
      if (!t) continue;
      const m = months(t);
      if (!m) throw new Error(`${LINE_LABEL[l]}: give one yearly amount or 12 monthly amounts.`);
      out[l] = m;
    }
    return out;
  };
  const closed = pv.months.filter((m) => m.closed);
  const totals = (key: 'budget' | 'actual' | 'forecast', line: FinPlanLine) => pv.months.reduce((n, m) => n + (m.rows.find((r) => r.line === line)?.[key] ?? 0), 0);
  const shown = pv.months[0]?.rows.map((r) => r.line) ?? [];
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Budget and forecast, {pv.year}</h3>
        <div className="row">
          <button className={`btn btn-sm${which === 'this' ? ' btn-primary' : ''}`} onClick={() => setWhich('this')}>
            {v.plan.year}
          </button>
          <button className={`btn btn-sm${which === 'next' ? ' btn-primary' : ''}`} onClick={() => setWhich('next')}>
            {v.nextPlan.year}
          </button>
        </div>
      </div>
      <p className="muted small fin-intro">
        The budget is set once a year and approved by the Finance Director or the CEO. It is not changed after approval: a revision approved by the Finance Director or the CEO applies from an open month, and other changes go into the forecasts,
        made yearly (the whole year's outlook) and quarterly (after each quarter closes). Differences above the Finance Director's threshold need a reason.
      </p>
      <ErrorNotice error={act.error} />
      {b && (
        <div className="list-item muted small">
          <Chip tone={b.status === 'approved' ? 'ok' : b.status === 'returned' ? 'crit' : 'warn'}>{b.status}</Chip>
          <span>
            {b.prepared ? `Prepared by ${b.prepared.by}` : ''}
            {b.approved ? ` · approved by ${b.approved.by}: "${b.approved.comment}"` : ''}
            {b.returned && b.status === 'returned' ? ` · returned by ${b.returned.by}: "${b.returned.comment}"` : ''}
            {pv.latestForecast ? ` · latest ${pv.latestKind} forecast as of ${pv.latestForecast}` : ''}
          </span>
        </div>
      )}
      {b?.assumptions && <div className="list-item small">Assumptions: {b.assumptions}</div>}
      {pv.forecastsOwed.length > 0 && (
        <p className="notice" data-tone={pv.forecastDue ? 'crit' : 'warn'}>
          Quarterly forecast owed: {pv.forecastsOwed.map((q) => `as of ${q.asOf} (due ${dateLabel(q.dueOn)}${q.overdue ? ', overdue' : ''})`).join('; ')}
        </p>
      )}
      {pv.yearlyDue && <p className="notice" data-tone="warn">The yearly forecast for {pv.year} has not been made.</p>}
      {shown.length > 0 && (
        <div className="fin-padx fin-scroll">
          <table className="table small">
            <thead>
              <tr>
                <th>Line</th>
                <th>Budget in force (year)</th>
                <th>Actual so far ({closed.length} months)</th>
                <th>Budget so far</th>
                <th>Latest forecast (year)</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l}>
                  <td>{LINE_LABEL[l]}</td>
                  <td>{rm(totals('budget', l))}</td>
                  <td>{rm(closed.reduce((n, m) => n + (m.rows.find((r) => r.line === l)?.actual ?? 0), 0))}</td>
                  <td>{rm(closed.reduce((n, m) => n + (m.rows.find((r) => r.line === l)?.budget ?? 0), 0))}</td>
                  <td>{pv.latestForecast ? rm(totals('forecast', l)) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pv.toExplain.length > 0 && (
        <div className="list">
          <div className="list-item fin-strong">
            Differences to explain
          </div>
          {pv.toExplain.map((x) => (
            <div key={x.key} className="list-item">
              <span>
                {x.month} {LINE_LABEL[x.line]}: budget {rm(x.budget)}, actual {rm(x.actual)} ({x.diff! > 0 ? '+' : ''}
                {rm(x.diff)})
                <span className="muted small">
                  {' '}
                  · owner {x.owner} · explain by {dateLabel(x.dueOn)}
                </span>
                {x.overdue && <Chip tone="crit">Late</Chip>}
              </span>
              {co.canAct && (
                <div className="row">
                  <input className="input" placeholder="Why (10+ characters)" value={why[x.key] ?? ''} onChange={(e) => setWhy((w) => ({ ...w, [x.key]: e.target.value }))} />
                  <button
                    className="btn btn-sm"
                    disabled={act.busy || (why[x.key] ?? '').trim().length < 10}
                    onClick={() => go('plan', 'explain', { year: pv.year, key: x.key, text: why[x.key] }, 'Explained.')}
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {pv.toAccept.length > 0 && (
        <div className="list">
          <div className="list-item fin-strong">
            Explanations to accept (Finance Director or CEO)
          </div>
          {pv.toAccept.map((x) => (
            <div key={x.key} className="list-item">
              <span>
                {x.key}: {x.text} <span className="muted small">· {x.by}</span>
              </span>
              {lead && co.canAct && x.byId !== me && (
                <div className="row">
                  <input className="input" placeholder="Comment (needed)" value={why[`a-${x.key}`] ?? ''} onChange={(e) => setWhy((w) => ({ ...w, [`a-${x.key}`]: e.target.value }))} />
                  <button
                    className="btn btn-sm"
                    disabled={act.busy || !(why[`a-${x.key}`] ?? '').trim()}
                    onClick={() => go('plan', 'acceptVariance', { year: pv.year, key: x.key, comment: why[`a-${x.key}`] }, 'Accepted.')}
                  >
                    Accept
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {co.canAct && (
        <div className="fin-pad">
          {b?.status === 'submitted' && (
            <div className="row fin-mb">
              <input className="input" placeholder="Comment (needed; 10+ characters to return)" value={f.comment ?? ''} onChange={set('comment')} />
              <button className="btn btn-sm btn-primary" disabled={act.busy || !(f.comment ?? '').trim()} onClick={() => go('plan', 'approve', { year: pv.year, seq: b.seq ?? 0, comment: f.comment }, 'Budget approved.')}>
                Approve budget
              </button>
              <button className="btn btn-sm" disabled={act.busy || (f.comment ?? '').trim().length < 10} onClick={() => go('plan', 'return', { year: pv.year, seq: b.seq ?? 0, comment: f.comment }, 'Budget returned.')}>
                Return
              </button>
            </div>
          )}
          {(b?.status === 'draft' || b?.status === 'returned') && b.prepared && (
            <button className="btn btn-sm btn-primary fin-mb" disabled={act.busy} onClick={() => go('plan', 'submit', { year: pv.year, seq: b.seq ?? 0 }, 'Budget submitted for approval.')}>
              Submit budget for approval
            </button>
          )}
          <details>
            <summary>
              {!b || b.status === 'draft' || b.status === 'returned' ? 'Draft the budget' : 'Re-forecast'} (one yearly amount per line, or 12 monthly amounts)
            </summary>
            {FIN_PLAN_LINES.map((l) => (
              <Field key={l} label={LINE_LABEL[l]}>
                <input className="input" value={lines[l] ?? ''} onChange={(e) => setLines((x) => ({ ...x, [l]: e.target.value }))} />
              </Field>
            ))}
            {!b || b.status === 'draft' || b.status === 'returned' ? (
              <>
                <Field label="Assumptions (guards and sites, rates, new or ending contracts, wage changes)">
                  <textarea className="textarea" rows={3} value={f.assumptions ?? ''} onChange={set('assumptions')} />
                </Field>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy}
                  onClick={() => act.run(async () => api.finControlAction(v.companyId, 'plan', 'draft', { year: pv.year, ...(b?.prepared ? { seq: b.seq ?? 0 } : {}), months: figures(), assumptions: f.assumptions }), 'Budget draft saved.')}
                >
                  Save draft
                </button>
              </>
            ) : (
              <>
                <Field label="What changed since the budget or the last forecast (10+ characters)">
                  <textarea className="textarea" rows={2} value={f.note ?? ''} onChange={set('note')} />
                </Field>
                <div className="row">
                  {(pv.quarterEnd || pv.forecastsOwed.length > 0) && (
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={act.busy}
                      onClick={() => act.run(async () => api.finControlAction(v.companyId, 'plan', 'forecast', { year: pv.year, kind: 'quarterly', asOf: pv.forecastsOwed[0]?.asOf ?? v.period, months: figures(), note: f.note }), 'Quarterly forecast saved.')}
                    >
                      Save quarterly forecast as of {pv.forecastsOwed[0]?.asOf ?? v.period}
                    </button>
                  )}
                  <button
                    className="btn btn-sm"
                    disabled={act.busy}
                    onClick={() => act.run(async () => api.finControlAction(v.companyId, 'plan', 'forecast', { year: pv.year, kind: 'yearly', asOf: v.period, months: figures(), note: f.note }), 'Yearly forecast saved.')}
                  >
                    Save yearly forecast for {pv.year}
                  </button>
                </div>
              </>
            )}
          </details>
          {b?.status === 'approved' && Number(v.period.slice(0, 4)) === pv.year && <Actuals v={v} year={pv.year} />}
          <Plan3 v={v} pv={pv} canAct={co.canAct} me={me} />
        </div>
      )}
    </section>
  );
}

function Actuals({ v, year }: { v: FinControls; year: number }) {
  const { act, go } = useControl(v.companyId);
  const [month, setMonth] = useState(v.period);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [source, setSource] = useState('');
  return (
    <details className="fin-mt">
      <summary>Record a month's actuals from the SQL Account profit and loss</summary>
      <ErrorNotice error={act.error} />
      <Field label="Month">
        <input className="input" type="month" value={month} max={v.period} min={`${year}-01`} onChange={(e) => setMonth(e.target.value)} />
      </Field>
      {FIN_PLAN_LINES.map((l) => (
        <Field key={l} label={LINE_LABEL[l]}>
          <input className="input" inputMode="decimal" value={vals[l] ?? ''} onChange={(e) => setVals((x) => ({ ...x, [l]: e.target.value }))} />
        </Field>
      ))}
      <Field label="SQL Account P&L filed (file name or SharePoint link)">
        <input className="input" value={source} onChange={(e) => setSource(e.target.value)} />
      </Field>
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy}
        onClick={() =>
          go('plan', 'actuals', { year, month, source, values: Object.fromEntries(Object.entries(vals).filter(([, x]) => x.trim()).map(([k, x]) => [k, Number(x)])) }, 'Actuals recorded.')
        }
      >
        Save actuals
      </button>
    </details>
  );
}

// ---------- Audit deadlines ----------

function AuditDates({ v }: { v: FinControls }) {
  const a = v.audit;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Year-end audit deadlines (financial year ended {dateLabel(a.lastFyEnd)})</h3>
      </div>
      <div className="list">
        <div className="list-item">
          <span>Audited accounts circulated to members (Companies Act 2016 s.258, 6 months)</span>
          <span>{dateLabel(a.circulateBy)}</span>
        </div>
        <div className="list-item">
          <span>Lodged with SSM (s.259, 30 days after circulation)</span>
          <span>{dateLabel(a.lodgeBy)}</span>
        </div>
        <div className="list-item">
          <span>Form C to LHDN (7 months)</span>
          <span>{dateLabel(a.formCBy)}</span>
        </div>
      </div>
      <p className="muted small fin-padb">
        The monthly audit file (in each company's drawer) keeps the auditor's usual requests up every month: trial balance, ageing, fixed assets, payroll, SST,
        accruals, contracts, minutes, intercompany and customer confirmations.
      </p>
    </section>
  );
}

/** Automation A6 (Fauzan, 2 Nov 2026): explanations Prima remembers and applies to the same kind of bank line. */
function MatchRules({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useControl(v.companyId);
  const [why, setWhy] = useState<Record<string, string>>({});
  if (!v.matchRules.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Remembered explanations</h3>
        {co.canAct && (
          <button className="btn btn-sm" disabled={act.busy} onClick={() => go('statements', 'applyRules', {}, 'Applied to the loaded statements.')}>
            Apply to loaded statements
          </button>
        )}
      </div>
      <p className="muted small fin-intro">
        Prima explains a bank line with these words, in this direction and up to this amount, the way a reviewer did before. The reconciliation reviewer still sees each one.
      </p>
      <ErrorNotice error={act.error} />
      <div className="list">
        {v.matchRules.map((r) => (
          <div key={r.id} className="list-item">
            <div className="fin-min0">
              <div className="fin-strong">
                &quot;{r.pattern}&quot;, money {r.direction}, up to {rm(r.maxAmount)}
              </div>
              <div className="muted small">
                {r.note} · by {r.by} · used {r.used} time(s)
              </div>
            </div>
            {co.canAct && (
              <div className="row">
                <input className="input" placeholder="Why remove (10+ characters)" value={why[r.id] ?? ''} onChange={(e) => setWhy((x) => ({ ...x, [r.id]: e.target.value }))} />
                <button className="btn btn-sm" disabled={act.busy || (why[r.id] ?? '').trim().length < 10} onClick={() => go('statements', 'forget', { ruleId: r.id, comment: why[r.id] }, 'Removed.')}>
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Automation A10 (Fauzan, 2 Nov 2026): every tax and statutory deadline from the company's year end, done ones ticked. */
function TaxCalendar({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useControl(v.companyId);
  const [f, setF] = useState<Record<string, { ref?: string; filedOn?: string }>>({});
  const TONE: Record<string, [Tone, string]> = { done: ['ok', 'Done'], due: ['warn', 'Due soon'], late: ['crit', 'Late'], upcoming: ['info', 'Upcoming'] };
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Tax and statutory calendar</h3>
      </div>
      <p className="muted small fin-intro">
        Built from the financial year end. Prima ticks what it can see (SST filed, payments made from the regular payments list, the consolidated e-Invoice). Record the
        others once filed in the portal. The Finance Director confirms the dates from LHDN and Customs.
      </p>
      <ErrorNotice error={act.error} />
      <div className="list">
        {v.taxCalendar.map((x) => (
          <div key={x.key} className="list-item">
            <div className="fin-min0">
              <div>
                <b>{dateLabel(x.dueOn)}</b> · {x.what} · {x.body}
              </div>
              <div className="muted small">{x.doneBy ?? x.law}</div>
            </div>
            <Chip tone={TONE[x.status][0]}>{TONE[x.status][1]}</Chip>
            {co.canAct && x.status !== 'done' && (
              <div className="row">
                <input className="input" type="date" value={f[x.key]?.filedOn ?? ''} onChange={(e) => setF((y) => ({ ...y, [x.key]: { ...y[x.key], filedOn: e.target.value } }))} />
                <input className="input" placeholder="Acknowledgement or receipt no." value={f[x.key]?.ref ?? ''} onChange={(e) => setF((y) => ({ ...y, [x.key]: { ...y[x.key], ref: e.target.value } }))} />
                <button className="btn btn-sm" disabled={act.busy} onClick={() => go('tax', 'file', { key: x.key, ...f[x.key] }, 'Recorded as filed.')}>
                  Filed
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Automation A12 (Fauzan, 2 Nov 2026): reminder letters Prima drafted; staff send them and mark them sent. */
function Reminders({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useControl(v.companyId);
  const [open, setOpen] = useState<string | null>(null);
  if (!v.reminders.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Client reminders to send</h3>
      </div>
      <p className="muted small fin-intro">
        Prima drafts a reminder at 30, 60 and 90 days after the invoice date. Read it, send it by email or letter, then mark it sent. Prima sends nothing.
      </p>
      <ErrorNotice error={act.error} />
      <div className="list">
        {v.reminders.map((r) => (
          <div key={r.caseId} className="list-item fin-block">
            <div className="row fin-between">
              <div>
                <b>{r.customer}</b> · invoice {r.invoiceNo} · {rm(r.outstanding)} · {r.days} days
                {r.lastReminder ? ` · last reminder ${dateLabel(r.lastReminder)}` : ''}
              </div>
              <div className="row">
                <button className="btn btn-sm btn-ghost" onClick={() => setOpen(open === r.caseId ? null : r.caseId)}>
                  {open === r.caseId ? 'Hide draft' : 'Show draft'}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => navigator.clipboard?.writeText(`${r.subject}\n\n${r.text}`).catch(() => undefined)}>
                  Copy
                </button>
                {co.canAct && (
                  <button className="btn btn-sm" disabled={act.busy} onClick={() => go('ar', 'note', { caseId: r.caseId, kind: 'reminder', text: `${r.subject} sent to ${r.customer}` }, 'Marked sent.')}>
                    Mark sent
                  </button>
                )}
              </div>
            </div>
            {open === r.caseId && (
              <pre className="small fin-mt fin-pre">
                {r.subject}
                {'\n\n'}
                {r.text}
              </pre>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
