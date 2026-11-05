import { useState } from 'react';
import { api, type CreditBoard, type CreditLoanInput } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import { CentralAdminGuide } from './CentralAdminGuide';

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
      <CentralAdminGuide view="credit" />
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
          <LoanLine
            key={r.loan.id}
            r={r}
            licence={{ can: data.canCheckLicence, last: data.lastLicence }}
            open={open === r.loan.id}
            onToggle={() => setOpen(open === r.loan.id ? null : r.loan.id)}
          />
        ))}
      </div>
    </section>
  );
}

type LicenceCtx = { can: boolean; last: CreditBoard['lastLicence'] };

function LoanLine({ r, licence, open, onToggle }: { r: Row; licence: LicenceCtx; open: boolean; onToggle: () => void }) {
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
      {open && <LoanDetail r={r} licence={licence} />}
    </div>
  );
}

function LoanDetail({ r, licence }: { r: Row; licence: LicenceCtx }) {
  const act = useAction();
  const l = r.loan;
  const [pay, setPay] = useState({ no: r.overdue[0]?.no ?? r.next?.no ?? 0, amount: '', bankRef: '', paidOn: '' });
  const [ssm, setSsm] = useState({ ref: '', on: '' });
  const [stamp, setStamp] = useState({ ref: '', on: '' });
  const [fix, setFix] = useState<{ open: boolean; kind: CreditLoanInput['collateral']; ref: string; reason: string }>({
    open: false,
    kind: l.collateral.kind,
    ref: l.collateral.agreementRef ?? '',
    reason: '',
  });
  const [rec, setRec] = useState<{ open: boolean; field: 'stamp' | 'charge' | 'signedOn'; ref: string; on: string; created: string; reason: string }>({
    open: false,
    field: l.stamped ? 'stamp' : l.charge ? 'charge' : 'signedOn',
    ref: '',
    on: '',
    created: '',
    reason: '',
  });
  const openRec = (field: typeof rec.field) =>
    setRec({
      open: true,
      field,
      ref: field === 'stamp' ? (l.stamped?.ref ?? '') : field === 'charge' ? (l.charge?.ssmRef ?? '') : '',
      on: field === 'stamp' ? (l.stamped?.on ?? '') : field === 'charge' ? (l.charge?.lodgedOn ?? '') : (l.signedOn ?? ''),
      created: l.charge?.createdOn ?? '',
      reason: '',
    });
  const recInput = (): Parameters<typeof api.creditCorrectRecord>[1] =>
    rec.field === 'stamp'
      ? { field: 'stamp', ref: rec.ref.trim() || null, on: rec.on || null, reason: rec.reason }
      : rec.field === 'charge'
        ? { field: 'charge', createdOn: rec.created, ssmRef: rec.ref.trim() || null, lodgedOn: rec.on || null, reason: rec.reason }
        : { field: 'signedOn', signedOn: rec.on || null, reason: rec.reason };
  const [kpkt, setKpkt] = useState({ ref: licence.last?.ref ?? '', validTo: licence.last?.validTo ?? '', note: '' });
  const [note, setNote] = useState('');
  const unpaid = l.schedule.filter((i) => i.paidAmount < i.amount);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="muted small">
        Agreement {l.agreementRef} (template {l.templateId}), {l.signedOn ? `signed ${dateLabel(l.signedOn)}` : 'signing date not recorded'}, starts{' '}
        {dateLabel(l.startOn)}
        {l.stamped ? `, stamped ${l.stamped.ref} on ${dateLabel(l.stamped.on)}` : ', stamping not recorded'} · collateral: {COLLATERAL[l.collateral.kind]}
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
      {r.stampState !== 'ok' && (
        <p className={r.stampState === 'overdue' ? 'error small' : 'small'}>
          Agreement not stamped: {r.stampDays} days since {r.stampFrom === 'signed' ? 'signing' : 'the start date (signing date not recorded)'}; stamp within 30
          days of signing.
        </p>
      )}
      {/* Masterplan §103: the Deputy Chief of Staff records the KPKT licence check; staff never wait on it. */}
      <div className="small" aria-label="KPKT licence check">
        {l.lenderLicence
          ? licence.can
            ? `KPKT licence ${l.lenderLicence.ref} valid to ${dateLabel(l.lenderLicence.validTo)}, ${r.licenceState === 'checked' ? 'valid' : 'not valid'} on the loan date ${dateLabel(r.licenceLoanDate)}; checked by ${l.lenderLicence.by}: ${l.lenderLicence.note}`
            : `KPKT licence check recorded by ${l.lenderLicence.by}.`
          : 'KPKT licence check: waiting for the Deputy Chief of Staff.'}
      </div>
      {licence.can && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} aria-label="Record KPKT licence check">
          <input
            className="input"
            aria-label="KPKT licence number"
            placeholder="KPKT licence number"
            value={kpkt.ref}
            onChange={(e) => setKpkt({ ...kpkt, ref: e.target.value })}
          />
          <label className="small">
            Valid to{' '}
            <input
              className="input"
              type="date"
              aria-label="Licence valid to"
              value={kpkt.validTo}
              onChange={(e) => setKpkt({ ...kpkt, validTo: e.target.value })}
            />
          </label>
          <input
            className="input"
            aria-label="How it was checked"
            placeholder="How it was checked (e.g. counsel's confirmation)"
            value={kpkt.note}
            onChange={(e) => setKpkt({ ...kpkt, note: e.target.value })}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || !kpkt.ref.trim() || !kpkt.validTo || kpkt.note.trim().length < 5}
            onClick={() => act.run(() => api.creditCheckLenderLicence(l.id, kpkt), 'Licence check recorded.')}
          >
            {l.lenderLicence ? 'Record a new check' : 'Record licence check'}
          </button>
        </div>
      )}
      {r.collateralMissing && <p className="small">The collateral agreement reference is not on file. The credit officer can correct the record below.</p>}
      {(l.corrections ?? []).length > 0 && (
        <div className="small muted" aria-label="Record corrections">
          Corrections:
          <ul style={{ margin: '2px 0 0 16px' }}>
            {(l.corrections ?? []).map((c, i) => (
              <li key={i}>
                {dateTimeLabel(c.at)}, {c.by}: {c.from} to {c.to}. Reason: {c.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.role === 'officer' && l.status === 'active' && !fix.open && (
        <div>
          <button className="btn btn-sm btn-ghost" onClick={() => setFix({ ...fix, open: true })}>
            Correct collateral record
          </button>
        </div>
      )}
      {r.role === 'officer' && l.status === 'active' && fix.open && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} aria-label="Correct collateral">
          <select
            className="input"
            aria-label="Collateral kind"
            value={fix.kind}
            onChange={(e) => setFix({ ...fix, kind: e.target.value as CreditLoanInput['collateral'] })}
          >
            {(Object.keys(COLLATERAL) as CreditLoanInput['collateral'][]).map((k) => (
              <option key={k} value={k}>
                {COLLATERAL[k]}
              </option>
            ))}
          </select>
          {fix.kind !== 'NONE' && (
            <input
              className="input"
              aria-label="Collateral agreement reference"
              placeholder="Collateral agreement reference"
              value={fix.ref}
              onChange={(e) => setFix({ ...fix, ref: e.target.value })}
            />
          )}
          <input
            className="input"
            aria-label="Reason for correction"
            placeholder="Why (required)"
            value={fix.reason}
            onChange={(e) => setFix({ ...fix, reason: e.target.value })}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || fix.reason.trim().length < 5 || (fix.kind !== 'NONE' && !fix.ref.trim())}
            onClick={() =>
              act.run(() => api.creditCorrectCollateral(l.id, fix.kind, fix.kind === 'NONE' ? null : fix.ref, fix.reason), 'Collateral record corrected.')
            }
          >
            Save correction
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setFix({ ...fix, open: false })}>
            Cancel
          </button>
        </div>
      )}
      {r.role === 'officer' && !rec.open && (
        <div>
          <button className="btn btn-sm btn-ghost" onClick={() => openRec(l.stamped ? 'stamp' : l.charge ? 'charge' : 'signedOn')}>
            Correct stamping, charge or signing date
          </button>
        </div>
      )}
      {r.role === 'officer' && rec.open && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} aria-label="Correct a recorded entry">
          <select className="input" aria-label="What to correct" value={rec.field} onChange={(e) => openRec(e.target.value as typeof rec.field)}>
            {l.stamped && <option value="stamp">Stamping</option>}
            {l.charge && <option value="charge">SSM charge</option>}
            <option value="signedOn">Signing date</option>
          </select>
          {rec.field === 'charge' && (
            <label className="small">
              Charge created on{' '}
              <input
                className="input"
                type="date"
                aria-label="Charge created on"
                value={rec.created}
                onChange={(e) => setRec({ ...rec, created: e.target.value })}
              />
            </label>
          )}
          {rec.field !== 'signedOn' && (
            <input
              className="input"
              aria-label={rec.field === 'stamp' ? 'Corrected stamp certificate' : 'Corrected SSM reference'}
              placeholder={rec.field === 'stamp' ? 'Stamp certificate (empty to take off)' : 'SSM reference (empty if not lodged)'}
              value={rec.ref}
              onChange={(e) => setRec({ ...rec, ref: e.target.value })}
            />
          )}
          <input
            className="input"
            type="date"
            aria-label={rec.field === 'stamp' ? 'Corrected stamping date' : rec.field === 'charge' ? 'Corrected lodgement date' : 'Signing date'}
            value={rec.on}
            onChange={(e) => setRec({ ...rec, on: e.target.value })}
          />
          <input
            className="input"
            aria-label="Reason for record correction"
            placeholder="Why (required)"
            value={rec.reason}
            onChange={(e) => setRec({ ...rec, reason: e.target.value })}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || rec.reason.trim().length < 5 || (rec.field === 'charge' && !rec.created)}
            onClick={() =>
              act.run(() => api.creditCorrectRecord(l.id, recInput()), 'Correction saved.').then((ok) => ok && setRec({ ...rec, open: false, reason: '' }))
            }
          >
            Save record correction
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setRec({ ...rec, open: false })}>
            Cancel
          </button>
        </div>
      )}
      {r.role === 'officer' && !l.stamped && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input
            className="input"
            aria-label="Stamp certificate"
            placeholder="Stamp certificate number"
            value={stamp.ref}
            onChange={(e) => setStamp({ ...stamp, ref: e.target.value })}
          />
          <input className="input" type="date" aria-label="Stamped on" value={stamp.on} onChange={(e) => setStamp({ ...stamp, on: e.target.value })} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !stamp.ref.trim() || !stamp.on}
            onClick={() => act.run(() => api.creditStamped(l.id, stamp.ref, stamp.on), 'Stamping recorded.')}
          >
            Agreement stamped
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
        <label className="small">
          Signed on (if known){' '}
          <input
            className="input"
            type="date"
            aria-label="Signed on"
            value={f.signedOn ?? ''}
            onChange={(e) => setF({ ...f, signedOn: e.target.value || null })}
          />
        </label>
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
