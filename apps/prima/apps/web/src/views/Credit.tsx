import { useState, type ReactNode } from 'react';
import { BankIcon, CalendarCheckIcon, GavelIcon, MagnifyingGlassIcon, PlusIcon, StampIcon } from '@phosphor-icons/react';
import { api, type CreditBoard, type CreditLoanInput } from '../api';
import { useApp } from '../App';
import { Card, Empty, Facts, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import { CentralAdminGuide } from './CentralAdminGuide';
import '../styles/biz.css';

/**
 * PWVSB credit and collateral (V8, V10). PWVSB lends to, or pays on behalf of, a group company. A beneficial-interest
 * agreement is collateral only. A missed instalment opens an investigation, never a default. A default needs the
 * checks plus the credit officer and the Finance Director (and legal on a template's first default); only then does the
 * enforcement case open. Ownership never changes by software, and steps 7 to 9 stay off until counsel approves.
 */

type Tab = 'cases' | 'loans';
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

/** A labelled control. */
function F({ label, children, span }: { label: string; children: ReactNode; span?: boolean }) {
  return (
    <label className={span ? 'field bz-span' : 'field'}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function CreditView() {
  const { data, error } = useLoad(() => api.creditBoard(), []);
  const [tab, setTab] = useState<Tab>('cases');
  const [adding, setAdding] = useState(false);
  const act = useAction();
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="PWVSB credit" />
      </div>
    );
  const k = data.kpis;
  // P78: the owner records new financing too (never a default confirmation).
  const officer = data.roles.includes('officer') || data.owner;
  const canCheck = officer || data.roles.includes('finance');
  const openCases = data.cases.filter((c) => c.item.stage !== 'cleared').length;
  const activeLoans = data.rows.filter((r) => r.loan.status === 'active').length;
  const tabs: [Tab, string, number][] = [
    ['cases', 'Cases', openCases],
    ['loans', 'Loans', activeLoans],
  ];
  return (
    <div className="page bz-cr">
      <PageHead
        title="PWVSB credit"
        sub="Money PWVSB lends to a company or pays on its behalf. A missed instalment opens an investigation, never a default. A default needs the checks, the credit officer and the Finance Director, and legal on a template's first default. Prima never changes ownership."
        actions={
          (canCheck || officer) && (
            <>
              {canCheck && (
                <button
                  className="btn"
                  disabled={act.busy}
                  onClick={() => act.run(() => api.runCreditCheck(), 'Daily check run: each missed instalment opens an investigation.')}
                >
                  <CalendarCheckIcon size={16} aria-hidden="true" />
                  Run the daily check
                </button>
              )}
              {officer && (
                <button className="btn btn-primary" onClick={() => setAdding(true)}>
                  <PlusIcon size={16} weight="bold" aria-hidden="true" />
                  Add financing
                </button>
              )}
            </>
          )
        }
      >
        <p className="notice" data-tone="info">
          Test data. Rate caps follow the Moneylenders Act 1951 s.17A ({data.rule.capSecuredPct}% secured, {data.rule.capUnsecuredPct}% unsecured) and charge
          lodging follows Companies Act 2016 s.352 ({data.rule.chargeLodgeDays} days); counsel to confirm. Enforcement steps 7 to 9 stay off until counsel
          approves the agreement template.
        </p>
      </PageHead>
      <ErrorNotice error={act.error} />

      <Stats>
        <Stat label="Active financing" value={k.loans} note={rm(k.outstanding) + ' outstanding'} tone="info" icon={<BankIcon size={16} />} onClick={() => setTab('loans')} />
        <Stat label="Companies behind" value={k.overdue} tone={k.overdue ? 'warn' : 'ok'} icon={<CalendarCheckIcon size={16} />} onClick={() => setTab('loans')} />
        <Stat label="Investigating" value={k.investigating} tone={k.investigating ? 'warn' : 'ok'} icon={<MagnifyingGlassIcon size={16} />} onClick={() => setTab('cases')} />
        <Stat label="Defaults confirmed" value={k.confirmed} tone={k.confirmed ? 'crit' : 'ok'} icon={<GavelIcon size={16} />} onClick={() => setTab('cases')} />
        <Stat label="Charges to lodge" value={k.chargeLate} tone={k.chargeLate ? 'warn' : 'ok'} icon={<StampIcon size={16} />} onClick={() => setTab('loans')} />
      </Stats>

      <CentralAdminGuide view="credit" />

      <div className="tabbar" role="tablist" aria-label="PWVSB credit">
        {tabs.map(([t, l, n]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {l}
            <span className="bz-count">{n}</span>
          </button>
        ))}
      </div>
      {tab === 'cases' && <Cases data={data} />}
      {tab === 'loans' && <Loans data={data} />}
      {adding && officer && (
        <Drawer
          title="Record new financing"
          sub="Record only financing with a signed, stamped agreement. Prima builds an equal-instalment schedule with simple interest, and blocks rates above the Moneylenders Act cap."
          onClose={() => setAdding(false)}
        >
          <AddLoan
            onDone={() => {
              setAdding(false);
              setTab('loans');
            }}
          />
        </Drawer>
      )}
    </div>
  );
}

function Cases({ data }: { data: CreditBoard }) {
  const [all, setAll] = useState(false);
  const rows = data.cases.filter((c) => all || c.item.stage !== 'cleared');
  return (
    <Card
      title="Investigations and defaults"
      sub="A missed instalment opens an investigation. A default needs every check and each confirmation."
      actions={
        <div className="seg" role="group" aria-label="Which cases">
          <button aria-pressed={!all} onClick={() => setAll(false)}>
            Open
          </button>
          <button aria-pressed={all} onClick={() => setAll(true)}>
            Show cleared
          </button>
        </div>
      }
      flush
    >
      {!rows.length ? (
        <Empty title="No open cases." />
      ) : (
        <ul className="bz-rows">
          {rows.map((c) => (
            <li key={c.item.id}>
              <CaseLine c={c} />
            </li>
          ))}
        </ul>
      )}
    </Card>
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
  const firstOpen = steps.findIndex(([, s]) => !s);
  const canSee =
    c.canAct ||
    (d.stage === 'investigating' && c.role === 'officer') ||
    (d.stage === 'confirmed' && c.role === 'officer') ||
    (d.stage === 'suspended' && (c.role === 'legal' || c.role === 'finance')) ||
    (d.stage === 'confirmed' && c.role === 'legal');
  return (
    <div className="bz-row bz-cr-case" data-tone={tone === 'crit' ? 'crit' : tone === 'warn' ? 'warn' : undefined}>
      <span className="bz-row-main">
        <span className="bz-row-title">
          {c.companyName}: {c.loanRef}, instalment {d.instalmentNo}
        </span>
        <span className="bz-row-meta">
          Due {dateLabel(c.instalment.dueOn)} · opened {dateTimeLabel(d.openedAt)}
          {c.waiting ? ` · waiting for ${c.waiting === 'Checks' ? 'the checks' : c.waiting}` : ''}
        </span>
      </span>
      <span className="bz-row-side">
        <span className="bz-amt">{rm(c.instalment.amount)}</span>
        <span className="bz-sub">paid {rm(c.instalment.paidAmount)}</span>
        <Chip tone={tone}>{label}</Chip>
      </span>
      <div className="bz-cr-body">
        {d.stage === 'investigating' && (
          <div className="bz-chips" aria-label="Checks before a default">
            {CHECKS.map(([key, l]) => (
              <span key={key} className="bz-cr-check" data-ok={c.checks[key]}>
                {c.checks[key] ? '✓' : '○'} {l}
              </span>
            ))}
          </div>
        )}
        <Steps
          steps={steps.map(([l, s], i) => ({
            label: l,
            state: (s ? 'done' : d.stage === 'investigating' && i === firstOpen ? 'now' : 'todo') as StepState,
            note: s ? `${s.by}, ${dateLabel(s.at.slice(0, 10))}` : 'not yet',
          }))}
        />
        {(d.cleared || d.suspended) && (
          <p className="bz-note">
            {d.cleared ? `Cleared by ${d.cleared.by}: ${d.cleared.note}` : ''}
            {d.cleared && d.suspended ? ' · ' : ''}
            {d.suspended ? `Suspended by ${d.suspended.by}: ${d.suspended.note}` : ''}
          </p>
        )}
        {d.enforcement && (
          <section className="bz-sec">
            <h3>Enforcement</h3>
            <ol className="bz-cr-enf">
              {d.enforcement.steps.map((s) => (
                <li key={s.no} data-status={s.status}>
                  <span className="bz-cr-enf-no" aria-hidden="true">
                    {s.status === 'done' ? '✓' : s.no}
                  </span>
                  <span className="bz-row-main">
                    <span>{s.label}</span>
                    {s.by && <span className="bz-row-meta">{`${s.by}, ${dateLabel(s.at!.slice(0, 10))}${s.note ? `: ${s.note}` : ''}`}</span>}
                  </span>
                  <Chip tone={s.status === 'done' ? 'ok' : s.status === 'off' ? 'info' : 'warn'}>
                    {s.status === 'done' ? 'Done' : s.status === 'off' ? 'Off until counsel approves' : 'Open'}
                  </Chip>
                </li>
              ))}
            </ol>
          </section>
        )}
        {canSee && (
          <div className="bz-act">
            <F label="Note">
              <input className="input" placeholder="Note (needed for reconcile, confirm, clear, suspend)" value={note} onChange={(e) => setNote(e.target.value)} />
            </F>
            <div className="bz-actions">
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
                <button className="btn btn-sm btn-primary" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.creditDecide(d.id, 'confirm', note), 'Confirmation recorded.')}>
                  Confirm default as {confirmWho}
                </button>
              )}
              {d.stage === 'investigating' && (c.role === 'officer' || c.role === 'finance') && (
                <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.creditDecide(d.id, 'clear', note), 'Investigation cleared.')}>
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
                <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.creditEnforcementStep(d.id, nextStep.no, note), 'Step recorded.')}>
                  Record step {nextStep.no}: {nextStep.label}
                </button>
              )}
              {d.stage === 'confirmed' && c.role === 'officer' && nextStep?.status === 'off' && (
                <span className="bz-note">Step {nextStep.no} is off until counsel approves the agreement template.</span>
              )}
            </div>
            <ErrorNotice error={act.error} />
          </div>
        )}
      </div>
    </div>
  );
}

function Loans({ data }: { data: CreditBoard }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const rows = data.rows.filter((r) => all || r.loan.status === 'active');
  const current = data.rows.find((r) => r.loan.id === open);
  return (
    <>
      <Card
        title="Loans and amounts paid on behalf"
        sub="Open a loan for its schedule, papers and records."
        actions={
          <div className="seg" role="group" aria-label="Which loans">
            <button aria-pressed={!all} onClick={() => setAll(false)}>
              Active
            </button>
            <button aria-pressed={all} onClick={() => setAll(true)}>
              Show settled
            </button>
          </div>
        }
        flush
      >
        {!rows.length ? (
          <Empty title="No financing.">
            {data.roles.includes('officer') || data.owner
              ? "Record a signed loan, or an amount PWVSB paid on a company's behalf, with Add financing above."
              : 'The credit officer records financing once the agreement is signed.'}
          </Empty>
        ) : (
          <ul className="bz-rows">
            {rows.map((r) => (
              <li key={r.loan.id}>
                <LoanLine r={r} onOpen={() => setOpen(r.loan.id)} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {current && (
        <Drawer
          title={`${current.companyName}: ${current.loan.ref}`}
          sub={`${current.loan.kind === 'LOAN' ? 'Loan' : 'Paid on behalf'} · ${current.loan.purpose}`}
          onClose={() => setOpen(null)}
        >
          <LoanDetail key={current.loan.id} r={current} owner={data.owner} licence={{ can: data.canCheckLicence, last: data.lastLicence }} />
        </Drawer>
      )}
    </>
  );
}

type LicenceCtx = { can: boolean; last: CreditBoard['lastLicence'] };

function loanLabel(r: Row): string {
  const l = r.loan;
  return l.status !== 'active'
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
}

/** How much of the schedule has been paid, as a share of what is due over the whole term. */
function repaid(r: Row): { paid: number; total: number } {
  const total = r.loan.schedule.reduce((s, i) => s + i.amount, 0);
  const paid = r.loan.schedule.reduce((s, i) => s + i.paidAmount, 0);
  return { paid, total };
}

function LoanLine({ r, onOpen }: { r: Row; onOpen: () => void }) {
  const l = r.loan;
  const { paid, total } = repaid(r);
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  return (
    <button type="button" className="bz-row bz-cr-loan" data-tone={r.tone === 'crit' ? 'crit' : r.tone === 'warn' ? 'warn' : undefined} onClick={onOpen}>
      <span className="bz-row-main">
        <span className="bz-row-title">
          {r.companyName}: <span className="mono">{l.ref}</span>
        </span>
        <span className="bz-row-meta">
          {l.kind === 'LOAN' ? 'Loan' : 'Paid on behalf'} · {l.purpose}
        </span>
        <span className="bz-row-meta">
          {rm(l.principal)} at {l.ratePct}% ({l.secured ? 'secured' : 'unsecured'})
        </span>
        <span className="bz-cr-paid">
          <span className="bz-meter" data-tone={r.overdue.length ? 'warn' : undefined}>
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="bz-sub">{pct}% of the schedule paid</span>
        </span>
      </span>
      <span className="bz-row-side">
        <span className="bz-amt">{rm(r.outstanding)}</span>
        <span className="bz-sub">outstanding{r.next ? ` · next ${dateLabel(r.next.dueOn)}` : ''}</span>
        <Chip tone={r.tone}>{loanLabel(r)}</Chip>
      </span>
    </button>
  );
}

function LoanDetail({ r, licence, owner = false }: { r: Row; licence: LicenceCtx; owner?: boolean }) {
  const act = useAction();
  // P78: the owner records what the credit officer or Finance records: repayments, stamping, the charge, corrections.
  const officerRec = r.role === 'officer' || owner;
  const financeRec = r.role === 'finance' || owner;
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
  const facts: [ReactNode, ReactNode][] = [
    ['Outstanding', <strong key="o">{rm(r.outstanding)}</strong>],
    ['Status', <Chip key="s" tone={r.tone}>{loanLabel(r)}</Chip>],
    ['Amount and rate', `${rm(l.principal)} at ${l.ratePct}% (${l.secured ? 'secured' : 'unsecured'})`],
    ['Next instalment', r.next ? dateLabel(r.next.dueOn) : '–'],
    ['Agreement', `${l.agreementRef} (template ${l.templateId})`],
    ['Signed', l.signedOn ? dateLabel(l.signedOn) : 'Signing date not recorded'],
    ['Starts', dateLabel(l.startOn)],
    ['Stamped', l.stamped ? `${l.stamped.ref} on ${dateLabel(l.stamped.on)}` : 'Stamping not recorded'],
    ['Collateral', `${COLLATERAL[l.collateral.kind]}${l.collateral.agreementRef ? ` (${l.collateral.agreementRef})` : ''}`],
    ['Cure period', `${l.cureDays} days`],
  ];
  if (l.charge)
    facts.push([
      'Charge',
      `Created ${dateLabel(l.charge.createdOn)}${l.charge.lodgedOn ? `, lodged ${dateLabel(l.charge.lodgedOn)} (${l.charge.ssmRef})` : `, not lodged (${r.chargeDays} days)`}`,
    ]);
  return (
    <>
      <div className="bz-facts">
        <Facts items={facts} />
      </div>
      {r.stampState !== 'ok' && (
        <p className="notice" data-tone={r.stampState === 'overdue' ? 'crit' : 'warn'}>
          Agreement not stamped: {r.stampDays} days since {r.stampFrom === 'signed' ? 'signing' : 'the start date (signing date not recorded)'}; stamp within 30
          days of signing.
        </p>
      )}
      {r.collateralMissing && (
        <p className="notice" data-tone="warn">
          The collateral agreement reference is not on file. The credit officer can correct the record below.
        </p>
      )}
      {l.disputes.map((d, i) => (
        <div key={i} className="notice" data-tone={d.closedAt ? 'info' : 'warn'}>
          Dispute by {d.by}, {dateTimeLabel(d.at)}: {d.note}
          {d.closedAt ? ` (closed ${dateTimeLabel(d.closedAt)})` : ' (open: no default can be confirmed)'}
        </div>
      ))}

      <section className="bz-sec bz-cr-sched">
        <h3>Schedule</h3>
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
                        <div>
                          <Chip tone="warn">{late.daysLate} days late</Chip>
                        </div>
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
      </section>

      {financeRec && l.status === 'active' && unpaid.length > 0 && (
        <section className="bz-act" aria-label="Record repayment">
          <h3 className="bz-cr-acth">Record a repayment</h3>
          <div className="bz-form">
            <F label="Instalment" span>
              <select className="select" value={pay.no} onChange={(e) => setPay({ ...pay, no: Number(e.target.value) })}>
                {unpaid.map((i) => (
                  <option key={i.no} value={i.no}>
                    Instalment {i.no}, {dateLabel(i.dueOn)}
                  </option>
                ))}
              </select>
            </F>
            <F label="Amount received">
              <input className="input num" placeholder="Amount received" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            </F>
            <F label="Paid on">
              <input className="input" type="date" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} />
            </F>
            <F label="Bank reference" span>
              <input className="input" placeholder="Bank reference" value={pay.bankRef} onChange={(e) => setPay({ ...pay, bankRef: e.target.value })} />
            </F>
          </div>
          <div className="bz-actions">
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || !pay.amount || !pay.bankRef.trim() || !pay.paidOn}
              onClick={() => act.run(() => api.creditRepayment(l.id, pay.no, Number(pay.amount), pay.bankRef, pay.paidOn), 'Repayment recorded.')}
            >
              Record repayment
            </button>
          </div>
        </section>
      )}

      {/* Masterplan §103: the Deputy Chief of Staff records the KPKT licence check; staff never wait on it. */}
      <section className="bz-sec">
        <h3>KPKT licence</h3>
        <p className="bz-note bz-cr-ink" aria-label="KPKT licence check">
          {l.lenderLicence
            ? licence.can
              ? `KPKT licence ${l.lenderLicence.ref} valid to ${dateLabel(l.lenderLicence.validTo)}, ${r.licenceState === 'checked' ? 'valid' : 'not valid'} on the loan date ${dateLabel(r.licenceLoanDate)}; checked by ${l.lenderLicence.by}: ${l.lenderLicence.note}`
              : `KPKT licence check recorded by ${l.lenderLicence.by}.`
            : 'KPKT licence check: waiting for the Deputy Chief of Staff.'}
        </p>
        {licence.can && (
          <div className="bz-act" aria-label="Record KPKT licence check">
            <div className="bz-form">
              <F label="KPKT licence number">
                <input className="input" placeholder="KPKT licence number" value={kpkt.ref} onChange={(e) => setKpkt({ ...kpkt, ref: e.target.value })} />
              </F>
              <F label="Licence valid to">
                <input className="input" type="date" value={kpkt.validTo} onChange={(e) => setKpkt({ ...kpkt, validTo: e.target.value })} />
              </F>
              <F label="How it was checked" span>
                <input
                  className="input"
                  placeholder="How it was checked (e.g. counsel's confirmation)"
                  value={kpkt.note}
                  onChange={(e) => setKpkt({ ...kpkt, note: e.target.value })}
                />
              </F>
            </div>
            <div className="bz-actions">
              <button
                className="btn btn-sm"
                disabled={act.busy || !kpkt.ref.trim() || !kpkt.validTo || kpkt.note.trim().length < 5}
                onClick={() => act.run(() => api.creditCheckLenderLicence(l.id, kpkt), 'Licence check recorded.')}
              >
                {l.lenderLicence ? 'Record a new check' : 'Record licence check'}
              </button>
            </div>
          </div>
        )}
      </section>

      {officerRec && !l.stamped && (
        <section className="bz-act" aria-label="Agreement stamped">
          <h3 className="bz-cr-acth">Record stamping</h3>
          <div className="bz-form">
            <F label="Stamp certificate">
              <input className="input" placeholder="Stamp certificate number" value={stamp.ref} onChange={(e) => setStamp({ ...stamp, ref: e.target.value })} />
            </F>
            <F label="Stamped on">
              <input className="input" type="date" value={stamp.on} onChange={(e) => setStamp({ ...stamp, on: e.target.value })} />
            </F>
          </div>
          <div className="bz-actions">
            <button
              className="btn btn-sm"
              disabled={act.busy || !stamp.ref.trim() || !stamp.on}
              onClick={() => act.run(() => api.creditStamped(l.id, stamp.ref, stamp.on), 'Stamping recorded.')}
            >
              Agreement stamped
            </button>
          </div>
        </section>
      )}
      {officerRec && l.charge && !l.charge.lodgedOn && (
        <section className="bz-act" aria-label="Charge lodged">
          <h3 className="bz-cr-acth">Record the SSM charge</h3>
          <div className="bz-form">
            <F label="SSM reference">
              <input className="input" placeholder="SSM charge reference" value={ssm.ref} onChange={(e) => setSsm({ ...ssm, ref: e.target.value })} />
            </F>
            <F label="Lodged on">
              <input className="input" type="date" value={ssm.on} onChange={(e) => setSsm({ ...ssm, on: e.target.value })} />
            </F>
          </div>
          <div className="bz-actions">
            <button
              className="btn btn-sm"
              disabled={act.busy || !ssm.ref.trim() || !ssm.on}
              onClick={() => act.run(() => api.creditChargeLodged(l.id, ssm.ref, ssm.on), 'Charge lodgement recorded.')}
            >
              Charge lodged with SSM
            </button>
          </div>
        </section>
      )}
      {((r.role === 'company' && !r.openDispute) || (r.role === 'officer' && r.openDispute)) && l.status === 'active' && (
        <section className="bz-act" aria-label={r.openDispute ? 'Close dispute' : 'Raise a dispute'}>
          <F label="Note">
            <input
              className="input"
              placeholder={r.openDispute ? 'How it was resolved' : 'What is wrong with this schedule'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </F>
          <div className="bz-actions">
            <button
              className="btn btn-sm"
              disabled={act.busy || !note.trim()}
              onClick={() => act.run(() => api.creditDispute(l.id, r.openDispute ? 'close' : 'raise', note), r.openDispute ? 'Dispute closed.' : 'Dispute raised.')}
            >
              {r.openDispute ? 'Close dispute' : 'Raise a dispute'}
            </button>
          </div>
        </section>
      )}

      {((l.corrections ?? []).length > 0 || officerRec) && (
        <section className="bz-sec">
          <h3>Record corrections</h3>
          {(l.corrections ?? []).length > 0 && (
            <ul className="bz-cr-corr" aria-label="Record corrections">
              {(l.corrections ?? []).map((c, i) => (
                <li key={i}>
                  {dateTimeLabel(c.at)}, {c.by}: {c.from} to {c.to}. Reason: {c.reason}
                </li>
              ))}
            </ul>
          )}
          {officerRec && (
            <div className="bz-actions">
              {l.status === 'active' && !fix.open && (
                <button className="btn btn-sm btn-ghost" onClick={() => setFix({ ...fix, open: true })}>
                  Correct collateral record
                </button>
              )}
              {!rec.open && (
                <button className="btn btn-sm btn-ghost" onClick={() => openRec(l.stamped ? 'stamp' : l.charge ? 'charge' : 'signedOn')}>
                  Correct stamping, charge or signing date
                </button>
              )}
            </div>
          )}
          {officerRec && l.status === 'active' && fix.open && (
            <div className="bz-act" aria-label="Correct collateral">
              <div className="bz-form">
                <F label="Collateral kind">
                  <select className="select" value={fix.kind} onChange={(e) => setFix({ ...fix, kind: e.target.value as CreditLoanInput['collateral'] })}>
                    {(Object.keys(COLLATERAL) as CreditLoanInput['collateral'][]).map((k) => (
                      <option key={k} value={k}>
                        {COLLATERAL[k]}
                      </option>
                    ))}
                  </select>
                </F>
                {fix.kind !== 'NONE' && (
                  <F label="Collateral agreement reference">
                    <input className="input" placeholder="Collateral agreement reference" value={fix.ref} onChange={(e) => setFix({ ...fix, ref: e.target.value })} />
                  </F>
                )}
                <F label="Reason for correction" span>
                  <input className="input" placeholder="Why (required)" value={fix.reason} onChange={(e) => setFix({ ...fix, reason: e.target.value })} />
                </F>
              </div>
              <div className="bz-actions">
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || fix.reason.trim().length < 5 || (fix.kind !== 'NONE' && !fix.ref.trim())}
                  onClick={() => act.run(() => api.creditCorrectCollateral(l.id, fix.kind, fix.kind === 'NONE' ? null : fix.ref, fix.reason), 'Collateral record corrected.')}
                >
                  Save correction
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setFix({ ...fix, open: false })}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {officerRec && rec.open && (
            <div className="bz-act" aria-label="Correct a recorded entry">
              <div className="bz-form">
                <F label="What to correct" span>
                  <select className="select" value={rec.field} onChange={(e) => openRec(e.target.value as typeof rec.field)}>
                    {l.stamped && <option value="stamp">Stamping</option>}
                    {l.charge && <option value="charge">SSM charge</option>}
                    <option value="signedOn">Signing date</option>
                  </select>
                </F>
                {rec.field === 'charge' && (
                  <F label="Charge created on">
                    <input className="input" type="date" value={rec.created} onChange={(e) => setRec({ ...rec, created: e.target.value })} />
                  </F>
                )}
                {rec.field !== 'signedOn' && (
                  <F label={rec.field === 'stamp' ? 'Corrected stamp certificate' : 'Corrected SSM reference'}>
                    <input
                      className="input"
                      placeholder={rec.field === 'stamp' ? 'Stamp certificate (empty to take off)' : 'SSM reference (empty if not lodged)'}
                      value={rec.ref}
                      onChange={(e) => setRec({ ...rec, ref: e.target.value })}
                    />
                  </F>
                )}
                <F label={rec.field === 'stamp' ? 'Corrected stamping date' : rec.field === 'charge' ? 'Corrected lodgement date' : 'Signing date'}>
                  <input className="input" type="date" value={rec.on} onChange={(e) => setRec({ ...rec, on: e.target.value })} />
                </F>
                <F label="Reason for record correction" span>
                  <input className="input" placeholder="Why (required)" value={rec.reason} onChange={(e) => setRec({ ...rec, reason: e.target.value })} />
                </F>
              </div>
              <div className="bz-actions">
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || rec.reason.trim().length < 5 || (rec.field === 'charge' && !rec.created)}
                  onClick={() => act.run(() => api.creditCorrectRecord(l.id, recInput()), 'Correction saved.').then((ok) => ok && setRec({ ...rec, open: false, reason: '' }))}
                >
                  Save record correction
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setRec({ ...rec, open: false })}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      <ErrorNotice error={act.error} />
    </>
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
    <>
      <div className="bz-form">
        <F label="Company" span>
          <select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {me.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </F>
        <F label="Kind">
          <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CreditLoanInput['kind'] })}>
            <option value="LOAN">Loan</option>
            <option value="PAID_ON_BEHALF">Paid on behalf</option>
          </select>
        </F>
        <F label="Purpose">
          <input className="input" placeholder="Purpose" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} />
        </F>
        <F label="Amount">
          <input className="input num" placeholder="Amount (RM)" inputMode="decimal" value={f.principal || ''} onChange={(e) => setF({ ...f, principal: Number(e.target.value) })} />
        </F>
        <F label="Rate % a year">
          <input className="input num" placeholder="Rate % a year" inputMode="decimal" value={f.ratePct} onChange={(e) => setF({ ...f, ratePct: Number(e.target.value) })} />
        </F>
        <label className="row small bz-span">
          <input type="checkbox" checked={f.secured} onChange={(e) => setF({ ...f, secured: e.target.checked })} /> Secured
        </label>
        <F label="Start date">
          <input className="input" type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} />
        </F>
        <F label="Signed on (if known)">
          <input className="input" type="date" value={f.signedOn ?? ''} onChange={(e) => setF({ ...f, signedOn: e.target.value || null })} />
        </F>
        <F label="Term in months">
          <input className="input num" placeholder="Term in months" inputMode="numeric" value={f.termMonths} onChange={(e) => setF({ ...f, termMonths: Number(e.target.value) })} />
        </F>
        <F label="Signed agreement reference">
          <input className="input" placeholder="Signed agreement reference" value={f.agreementRef} onChange={(e) => setF({ ...f, agreementRef: e.target.value })} />
        </F>
        <F label="Agreement template" span>
          <input
            className="input"
            placeholder="Agreement template (for counsel approval)"
            value={f.templateId}
            onChange={(e) => setF({ ...f, templateId: e.target.value })}
          />
        </F>
        <F label="Collateral" span={f.collateral === 'NONE'}>
          <select className="select" value={f.collateral} onChange={(e) => setF({ ...f, collateral: e.target.value as CreditLoanInput['collateral'] })}>
            {Object.entries(COLLATERAL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </F>
        {f.collateral !== 'NONE' && (
          <F label="Collateral agreement reference">
            <input
              className="input"
              placeholder="Collateral agreement reference"
              value={f.collateralRef ?? ''}
              onChange={(e) => setF({ ...f, collateralRef: e.target.value || null })}
            />
          </F>
        )}
        {f.collateral === 'ASSET_CHARGE' && (
          <F label="Charge created on">
            <input className="input" type="date" value={f.chargeCreatedOn ?? ''} onChange={(e) => setF({ ...f, chargeCreatedOn: e.target.value || null })} />
          </F>
        )}
      </div>
      <ErrorNotice error={act.error} />
      <div className="bz-form-foot">
        <button
          className="btn btn-primary"
          disabled={act.busy || !companyId}
          onClick={() => act.run(() => api.addCreditLoan(companyId, f), 'Financing recorded.').then((ok) => ok && onDone())}
        >
          Record financing
        </button>
      </div>
    </>
  );
}
