import { useState } from 'react';
import { api, type CreditBoard, type CreditLoanInput } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * PWVSB credit and collateral (V8, V10). PWVSB lends to, or pays on behalf of, a group company. A beneficial-interest
 * agreement is collateral only. A missed instalment opens an investigation, never a default. A default needs the
 * checks plus the credit officer and the Finance Director (and legal on a template's first default); only then does the
 * enforcement case open. Ownership never changes by software, and steps 7 to 9 stay off until counsel approves.
 */

type Tab = 'cases' | 'loans' | 'add';
type Row = CreditBoard['rows'][number];
type Case = CreditBoard['cases'][number];

const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STAGE: Record<Case['item']['stage'], ['warn' | 'info' | 'crit' | 'ok', string]> = {
  investigating: ['warn', 'Investigating'],
  confirmed: ['crit', 'Default confirmed'],
  suspended: ['info', 'Suspended'],
  cleared: ['ok', 'Cleared'],
};
const CHECKS: [keyof Case['checks'], string][] = [
  ['reconciled', 'Finance reconciled the bank'],
  ['noDispute', 'No open dispute'],
  ['noDeferral', 'No agreed deferral'],
  ['curePassed', 'Cure period passed'],
  ['stillUnpaid', 'Still unpaid'],
];
const COLLATERAL: Record<CreditLoanInput['collateral'], string> = {
  BENEFICIAL_INTEREST: 'Beneficial-interest agreement',
  ASSET_CHARGE: 'Charge over company asset',
  GUARANTEE: 'Guarantee',
  NONE: 'None',
};

export function CreditView() {
  const { data, error } = useLoad(() => api.creditBoard(), []);
  const [tab, setTab] = useState<Tab>('cases');
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="PWVSB credit" />;
  const k = data.kpis;
  const officer = data.roles.includes('officer');
  const canCheck = officer || data.roles.includes('finance');
  const tabs: [Tab, string][] = [
    ['cases', 'Cases'],
    ['loans', 'Loans'],
  ];
  if (officer) tabs.push(['add', 'Add financing']);
  return (
    <div className="page">
      <div className="page-head">
        <h1>PWVSB credit</h1>
        <p className="muted">
          Money PWVSB lends to a company or pays on its behalf. A missed instalment opens an investigation, never a default. A default needs the checks, the
          credit officer and the Finance Director, and legal on a template's first default. Prima never changes ownership.
        </p>
        <p className="notice" data-tone="info">
          Test data. Rate caps follow the Moneylenders Act 1951 s.17A ({data.rule.capSecuredPct}% secured, {data.rule.capUnsecuredPct}% unsecured) and charge
          lodging follows Companies Act 2016 s.352 ({data.rule.chargeLodgeDays} days); counsel to confirm. Enforcement steps 7 to 9 stay off until counsel
          approves the agreement template.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Active financing" value={k.loans} note={rm(k.outstanding) + ' outstanding'} />
        <Kpi label="Companies behind" value={k.overdue} tone={k.overdue ? 'warn' : 'ok'} />
        <Kpi label="Investigating" value={k.investigating} tone={k.investigating ? 'warn' : 'ok'} />
        <Kpi label="Defaults confirmed" value={k.confirmed} tone={k.confirmed ? 'crit' : 'ok'} />
        <Kpi label="Charges to lodge" value={k.chargeLate} tone={k.chargeLate ? 'warn' : 'ok'} />
      </div>
      {canCheck && (
        <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.runCreditCheck(), 'Daily check run: each missed instalment opens an investigation.')}
          >
            Run the daily check
          </button>
          <ErrorNotice error={act.error} />
        </div>
      )}
      <div className="tabbar" role="tablist" aria-label="PWVSB credit">
        {tabs.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'cases' && <Cases data={data} />}
      {tab === 'loans' && <Loans data={data} />}
      {tab === 'add' && officer && <AddLoan onDone={() => setTab('loans')} />}
    </div>
  );
}

function Cases({ data }: { data: CreditBoard }) {
  const [all, setAll] = useState(false);
  const rows = data.cases.filter((c) => all || c.item.stage !== 'cleared');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Investigations and defaults</h3>
        <button className="btn btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Hide cleared' : 'Show cleared'}
        </button>
      </div>
      <div className="list">
        {!rows.length && <div className="empty">No open cases.</div>}
        {rows.map((c) => (
          <CaseLine key={c.item.id} c={c} />
        ))}
      </div>
    </section>
  );
}

function CaseLine({ c }: { c: Case }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const d = c.item;
  const [tone, label] = STAGE[d.stage];
  const confirmWho = c.waiting === 'Credit officer' ? 'credit officer' : c.waiting === 'Finance Director' ? 'Finance Director' : 'legal';
  const nextStep = d.enforcement?.steps.find((s) => s.status !== 'done');
  const steps: [string, Case['item']['reconciled']][] = [
    ['Bank reconciled', d.reconciled],
    ['Credit officer', d.creditConfirm],
    ['Finance Director', d.financeConfirm],
    ...(d.needsLegal ? ([['Legal', d.legalConfirm]] as [string, Case['item']['reconciled']][]) : []),
  ];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {c.companyName}: {c.loanRef}, instalment {d.instalmentNo}
          </div>
          <div className="muted small">
            Due {dateLabel(c.instalment.dueOn)} · {rm(c.instalment.amount)} · paid {rm(c.instalment.paidAmount)} · opened {dateTimeLabel(d.openedAt)}
            {c.waiting ? ` · waiting for ${c.waiting === 'Checks' ? 'the checks' : c.waiting}` : ''}
          </div>
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      {d.stage === 'investigating' && (
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {CHECKS.map(([key, l]) => (
            <Chip key={key} tone={c.checks[key] ? 'ok' : 'warn'}>
              {c.checks[key] ? '✓' : '○'} {l}
            </Chip>
          ))}
        </div>
      )}
      <div className="muted small">
        {steps.map(([l, s]) => (s ? `${l}: ${s.by}, ${dateLabel(s.at.slice(0, 10))}` : `${l}: not yet`)).join(' · ')}
        {d.cleared ? ` · cleared by ${d.cleared.by}: ${d.cleared.note}` : ''}
        {d.suspended ? ` · suspended by ${d.suspended.by}: ${d.suspended.note}` : ''}
      </div>
      {d.enforcement && (
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {d.enforcement.steps.map((s) => (
            <li key={s.no}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                <span>{s.label}</span>
                <Chip tone={s.status === 'done' ? 'ok' : s.status === 'off' ? 'info' : 'warn'}>
                  {s.status === 'done' ? 'Done' : s.status === 'off' ? 'Off until counsel approves' : 'Open'}
                </Chip>
              </div>
              {s.by && <div className="muted small">{`${s.by}, ${dateLabel(s.at!.slice(0, 10))}${s.note ? `: ${s.note}` : ''}`}</div>}
            </li>
          ))}
        </ol>
      )}
      {(c.canAct ||
        (d.stage === 'investigating' && c.role === 'officer') ||
        (d.stage === 'confirmed' && c.role === 'officer') ||
        (d.stage === 'suspended' && (c.role === 'legal' || c.role === 'finance')) ||
        (d.stage === 'confirmed' && c.role === 'legal')) && (
        <>
          <input
            className="input"
            aria-label="Note"
            placeholder="Note (required for reconcile, clear, suspend)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {c.canAct && c.waiting === 'Checks' && (
              <button
                className="btn btn-sm"
                disabled={act.busy || !note.trim()}
                onClick={() => act.run(() => api.creditDecide(d.id, 'reconciled', note), 'Bank reconciliation recorded.')}
              >
                Bank reconciled
              </button>
            )}
            {c.canAct && c.waiting !== 'Checks' && (
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() => act.run(() => api.creditDecide(d.id, 'confirm', note), 'Confirmation recorded.')}
              >
                Confirm default as {confirmWho}
              </button>
            )}
            {d.stage === 'investigating' && (c.role === 'officer' || c.role === 'finance') && (
              <button
                className="btn btn-sm"
                disabled={act.busy || !note.trim()}
                onClick={() => act.run(() => api.creditDecide(d.id, 'clear', note), 'Investigation cleared.')}
              >
                Clear, not a default
              </button>
            )}
            {d.stage === 'confirmed' && (c.role === 'legal' || c.role === 'finance') && (
              <button
                className="btn btn-sm"
                disabled={act.busy || !note.trim()}
                onClick={() => act.run(() => api.creditDecide(d.id, 'suspend', note), 'Enforcement suspended.')}
              >
                Suspend enforcement
              </button>
            )}
            {d.stage === 'suspended' && (c.role === 'legal' || c.role === 'finance') && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.creditDecide(d.id, 'resume', note), 'Enforcement resumed.')}>
                Resume
              </button>
            )}
            {d.stage === 'confirmed' && c.role === 'officer' && nextStep && nextStep.status === 'open' && (
              <button
                className="btn btn-sm"
                disabled={act.busy}
                onClick={() => act.run(() => api.creditEnforcementStep(d.id, nextStep.no, note), 'Step recorded.')}
              >
                Record step {nextStep.no}: {nextStep.label}
              </button>
            )}
            {d.stage === 'confirmed' && c.role === 'officer' && nextStep?.status === 'off' && (
              <span className="muted small">Step {nextStep.no} is off until counsel approves the agreement template.</span>
            )}
          </div>
          <ErrorNotice error={act.error} />
        </>
      )}
    </div>
  );
}

function Loans({ data }: { data: CreditBoard }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const rows = data.rows.filter((r) => all || r.loan.status === 'active');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Loans and amounts paid on behalf</h3>
        <button className="btn btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Hide settled' : 'Show settled'}
        </button>
      </div>
      <div className="list">
        {!rows.length && <div className="empty">No financing.</div>}
        {rows.map((r) => (
          <LoanLine key={r.loan.id} r={r} open={open === r.loan.id} onToggle={() => setOpen(open === r.loan.id ? null : r.loan.id)} />
        ))}
      </div>
    </section>
  );
}

function LoanLine({ r, open, onToggle }: { r: Row; open: boolean; onToggle: () => void }) {
  const l = r.loan;
  const label =
    l.status !== 'active'
      ? 'Settled'
      : r.overCap
        ? 'Rate above cap'
        : r.chargeState === 'overdue'
          ? 'Charge not lodged'
          : r.overdue.length
            ? `${r.overdue.length} instalment${r.overdue.length > 1 ? 's' : ''} behind`
            : r.openDispute
              ? 'Disputed'
              : r.chargeState === 'warn'
                ? 'Lodge charge soon'
                : 'On time';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <button
        className="row"
        style={{
          justifyContent: 'space-between',
          gap: 6,
          flexWrap: 'wrap',
          background: 'none',
          border: 0,
          padding: 0,
          textAlign: 'left',
          color: 'inherit',
          cursor: 'pointer',
        }}
        onClick={onToggle}
        aria-expanded={open}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {r.companyName}: {l.ref}
          </div>
          <div className="muted small">
            {l.kind === 'LOAN' ? 'Loan' : 'Paid on behalf'} · {l.purpose} · {rm(l.principal)} at {l.ratePct}% ({l.secured ? 'secured' : 'unsecured'}) ·{' '}
            {rm(r.outstanding)} outstanding
            {r.next ? ` · next ${dateLabel(r.next.dueOn)}` : ''}
          </div>
        </div>
        <Chip tone={r.tone}>{label}</Chip>
      </button>
      {open && <LoanDetail r={r} />}
    </div>
  );
}

function LoanDetail({ r }: { r: Row }) {
  const act = useAction();
  const l = r.loan;
  const [pay, setPay] = useState({ no: r.overdue[0]?.no ?? r.next?.no ?? 0, amount: '', bankRef: '', paidOn: '' });
  const [ssm, setSsm] = useState({ ref: '', on: '' });
  const [note, setNote] = useState('');
  const unpaid = l.schedule.filter((i) => i.paidAmount < i.amount);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="muted small">
        Agreement {l.agreementRef} (template {l.templateId}){l.stamped ? `, stamped ${l.stamped.ref}` : ', stamping not recorded'} · collateral:{' '}
        {COLLATERAL[l.collateral.kind]}
        {l.collateral.agreementRef ? ` (${l.collateral.agreementRef})` : ''} · cure period {l.cureDays} days
        {l.charge
          ? ` · charge created ${dateLabel(l.charge.createdOn)}${l.charge.lodgedOn ? `, lodged ${dateLabel(l.charge.lodgedOn)} (${l.charge.ssmRef})` : `, not lodged (${r.chargeDays} days)`}`
          : ''}
      </div>
      {l.disputes.map((d, i) => (
        <div key={i} className="notice" data-tone={d.closedAt ? 'info' : 'warn'}>
          Dispute by {d.by}, {dateTimeLabel(d.at)}: {d.note}
          {d.closedAt ? ` (closed ${dateTimeLabel(d.closedAt)})` : ' (open: no default can be confirmed)'}
        </div>
      ))}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>No</th>
              <th>Due</th>
              <th className="num">Amount</th>
              <th className="num">Paid</th>
              <th>Bank ref</th>
            </tr>
          </thead>
          <tbody>
            {l.schedule.map((i) => {
              const late = r.overdue.find((o) => o.no === i.no);
              return (
                <tr key={i.no}>
                  <td>{i.no}</td>
                  <td>
                    {dateLabel(i.dueOn)}
                    {late ? (
                      <>
                        {' '}
                        <Chip tone="warn">{late.daysLate} days late</Chip>
                      </>
                    ) : null}
                  </td>
                  <td className="num">{rm(i.amount)}</td>
                  <td className="num">{i.paidAmount ? rm(i.paidAmount) : '–'}</td>
                  <td className="small">{i.bankRef ?? '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {r.role === 'finance' && l.status === 'active' && unpaid.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="input" aria-label="Instalment" value={pay.no} onChange={(e) => setPay({ ...pay, no: Number(e.target.value) })}>
            {unpaid.map((i) => (
              <option key={i.no} value={i.no}>
                Instalment {i.no}, {dateLabel(i.dueOn)}
              </option>
            ))}
          </select>
          <input
            className="input"
            aria-label="Amount received"
            placeholder="Amount received"
            inputMode="decimal"
            value={pay.amount}
            onChange={(e) => setPay({ ...pay, amount: e.target.value })}
          />
          <input
            className="input"
            aria-label="Bank reference"
            placeholder="Bank reference"
            value={pay.bankRef}
            onChange={(e) => setPay({ ...pay, bankRef: e.target.value })}
          />
          <input className="input" type="date" aria-label="Paid on" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !pay.amount || !pay.bankRef.trim() || !pay.paidOn}
            onClick={() => act.run(() => api.creditRepayment(l.id, pay.no, Number(pay.amount), pay.bankRef, pay.paidOn), 'Repayment recorded.')}
          >
            Record repayment
          </button>
        </div>
      )}
      {r.role === 'officer' && l.charge && !l.charge.lodgedOn && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input
            className="input"
            aria-label="SSM reference"
            placeholder="SSM charge reference"
            value={ssm.ref}
            onChange={(e) => setSsm({ ...ssm, ref: e.target.value })}
          />
          <input className="input" type="date" aria-label="Lodged on" value={ssm.on} onChange={(e) => setSsm({ ...ssm, on: e.target.value })} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !ssm.ref.trim() || !ssm.on}
            onClick={() => act.run(() => api.creditChargeLodged(l.id, ssm.ref, ssm.on), 'Charge lodgement recorded.')}
          >
            Charge lodged with SSM
          </button>
        </div>
      )}
      {((r.role === 'company' && !r.openDispute) || (r.role === 'officer' && r.openDispute)) && l.status === 'active' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input
            className="input"
            aria-label="Note"
            placeholder={r.openDispute ? 'How it was resolved' : 'What is wrong with this schedule'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || !note.trim()}
            onClick={() =>
              act.run(() => api.creditDispute(l.id, r.openDispute ? 'close' : 'raise', note), r.openDispute ? 'Dispute closed.' : 'Dispute raised.')
            }
          >
            {r.openDispute ? 'Close dispute' : 'Raise a dispute'}
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function AddLoan({ onDone }: { onDone: () => void }) {
  const { me } = useApp();
  const act = useAction();
  const [companyId, setCompanyId] = useState(me.companies[0]?.id ?? '');
  const [f, setF] = useState<CreditLoanInput>({
    kind: 'LOAN',
    purpose: '',
    secured: true,
    principal: 0,
    ratePct: 8,
    startOn: '',
    termMonths: 12,
    agreementRef: '',
    templateId: '',
    collateral: 'BENEFICIAL_INTEREST',
    collateralRef: null,
    chargeCreatedOn: null,
  });
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Record new financing</h3>
      </div>
      <p className="muted small">
        Record only financing with a signed, stamped agreement. Prima builds an equal-instalment schedule with simple interest, and blocks rates above the
        Moneylenders Act cap.
      </p>
      <div className="form-grid" style={{ display: 'grid', gap: 6 }}>
        <select className="input" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {me.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CreditLoanInput['kind'] })}>
          <option value="LOAN">Loan</option>
          <option value="PAID_ON_BEHALF">Paid on behalf</option>
        </select>
        <input className="input" aria-label="Purpose" placeholder="Purpose" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} />
        <input
          className="input"
          aria-label="Amount"
          placeholder="Amount (RM)"
          inputMode="decimal"
          value={f.principal || ''}
          onChange={(e) => setF({ ...f, principal: Number(e.target.value) })}
        />
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={f.secured} onChange={(e) => setF({ ...f, secured: e.target.checked })} /> Secured
        </label>
        <input
          className="input"
          aria-label="Rate % a year"
          placeholder="Rate % a year"
          inputMode="decimal"
          value={f.ratePct}
          onChange={(e) => setF({ ...f, ratePct: Number(e.target.value) })}
        />
        <input className="input" type="date" aria-label="Start date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} />
        <input
          className="input"
          aria-label="Term in months"
          placeholder="Term in months"
          inputMode="numeric"
          value={f.termMonths}
          onChange={(e) => setF({ ...f, termMonths: Number(e.target.value) })}
        />
        <input
          className="input"
          aria-label="Signed agreement reference"
          placeholder="Signed agreement reference"
          value={f.agreementRef}
          onChange={(e) => setF({ ...f, agreementRef: e.target.value })}
        />
        <input
          className="input"
          aria-label="Agreement template"
          placeholder="Agreement template (for counsel approval)"
          value={f.templateId}
          onChange={(e) => setF({ ...f, templateId: e.target.value })}
        />
        <select
          className="input"
          aria-label="Collateral"
          value={f.collateral}
          onChange={(e) => setF({ ...f, collateral: e.target.value as CreditLoanInput['collateral'] })}
        >
          {Object.entries(COLLATERAL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {f.collateral !== 'NONE' && (
          <input
            className="input"
            aria-label="Collateral agreement reference"
            placeholder="Collateral agreement reference"
            value={f.collateralRef ?? ''}
            onChange={(e) => setF({ ...f, collateralRef: e.target.value || null })}
          />
        )}
        {f.collateral === 'ASSET_CHARGE' && (
          <label className="small">
            Charge created on
            <input className="input" type="date" value={f.chargeCreatedOn ?? ''} onChange={(e) => setF({ ...f, chargeCreatedOn: e.target.value || null })} />
          </label>
        )}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button
          className="btn btn-primary"
          disabled={act.busy || !companyId}
          onClick={() => act.run(() => api.addCreditLoan(companyId, f), 'Financing recorded.').then((ok) => ok && onDone())}
        >
          Record financing
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </section>
  );
}
