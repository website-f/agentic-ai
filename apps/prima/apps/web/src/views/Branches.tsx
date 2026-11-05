import { useState } from 'react';
import { BRANCH_COST_KINDS, BRANCH_COST_LABEL, TERMINATION_LABEL, TERMINATION_STEPS, type BranchModel } from '@prima/core';
import { api, type BranchBoard } from '../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * Branches (V11, V12, V12.1). A branch sits inside its licensed company. The company manager approves each month's
 * settlement under the signed agreement and reviews what the branch did; PWVSB sees anything left unreviewed.
 */

type Row = BranchBoard['rows'][number];

const MODEL: Record<BranchModel, string> = {
  A: 'Model A: company keeps a signed % of billing',
  B: 'Model B: salaried Branch Manager',
  C: 'Model C: company keeps a signed % of net profit',
};
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function BranchesView() {
  const { data, error } = useLoad(() => api.branchBoard(), []);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="branches" />;
  const waiting = data.rows.reduce((n, r) => n + r.queue.length, 0);
  const late = data.rows.reduce((n, r) => n + r.queue.filter((q) => q.level).length, 0);
  const held = data.rows.filter((r) => r.settlement?.status === 'draft' && r.holds.length).length;
  const toApprove = data.rows.filter((r) => r.canApprove).length;
  const row = data.rows.find((r) => r.branch.id === open) ?? null;
  const companies = [...new Set(data.rows.map((r) => r.companyName))];
  return (
    <div className="page">
      <div className="page-head">
        <h1>Branches</h1>
        <p className="muted">
          A branch works inside its licensed company: same licence, employer and accounts. The company approves each month's settlement under the signed
          agreement and reviews every branch action. A month prepared from SQL Account lines shows its references; older test months are marked as not
          prepared from SQL. Prima records payments; it never makes them.
        </p>
      </div>
      {data.canAdd.length > 0 && <AddBranch companies={data.canAdd} />}
      <div className="kpis">
        <Kpi label={`${data.prev} settlements to approve`} value={toApprove} tone={toApprove ? 'warn' : 'ok'} />
        <Kpi label="Settlements held" value={held} tone={held ? 'crit' : 'ok'} note="Agreement, bank, wages or licence" />
        <Kpi label="Branch actions to review" value={waiting} tone={waiting ? 'warn' : 'ok'} />
        <Kpi label={`Not reviewed in ${data.rule.reviewDays} days`} value={late} tone={late ? 'crit' : 'ok'} />
      </div>
      {companies.map((name) => (
        <section key={name} className="panel">
          <div className="panel-head">
            <h3>{name}</h3>
          </div>
          <div className="list">
            {data.rows
              .filter((r) => r.companyName === name)
              .map((r) => (
                <button
                  key={r.branch.id}
                  className="list-item"
                  style={{ width: '100%', textAlign: 'left', flexWrap: 'wrap', gap: 6 }}
                  onClick={() => setOpen(r.branch.id)}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{r.branch.name}</div>
                    <div className="muted small">
                      {r.agreement ? `Model ${r.agreement.model} · ${r.agreement.managerName}` : 'No signed agreement'} · {r.sites} sites
                      {r.split ? ` · company ${rm(r.split.companyShare)}` : ''}
                      {r.queue.length ? ` · ${r.queue.length} to review` : ''}
                    </div>
                  </div>
                  <Chip tone={r.status === 'proposed' ? 'warn' : r.holds.length ? 'crit' : r.canApprove ? 'warn' : 'ok'}>
                    {r.status === 'proposed'
                      ? 'Proposed'
                      : r.status === 'closed'
                        ? 'Closed'
                        : r.status === 'step_in'
                          ? 'Company stepped in'
                          : r.status === 'terminating'
                            ? 'Closing'
                            : r.holds.length
                              ? 'Held'
                              : r.canApprove
                                ? 'To approve'
                                : r.settlement?.status === 'approved'
                                  ? 'Approved'
                                  : 'In order'}
                  </Chip>
                </button>
              ))}
          </div>
        </section>
      ))}
      {row && <BranchDrawer row={row} onClose={() => setOpen(null)} />}
    </div>
  );
}

function BranchDrawer({ row: r, onClose }: { row: Row; onClose: () => void }) {
  const act = useAction();
  void act;
  const [agreementForm, setAgreementForm] = useState(false);
  const s = r.settlement;
  const sp = r.split;
  const manager = r.role === 'manager';
  return (
    <Drawer title={r.branch.name} sub={`${r.companyName} · ${r.sites} sites · ${r.liveContracts} live contracts`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <SetupPanel row={r} />
      <BusinessCasePanel row={r} />
      {r.treasury && <TreasuryPanel row={r} />}
      <section className="panel">
        <div className="panel-head">
          <h3>Agreement</h3>
          {manager && (
            <button className="btn btn-sm" onClick={() => setAgreementForm(!agreementForm)}>
              New signed version
            </button>
          )}
        </div>
        {r.agreement ? (
          <div className="list">
            <div className="list-item">
              <span>{MODEL[r.agreement.model]}</span>
              <span>
                {r.agreement.model === 'A' && (r.agreement.companyBillingSharePct != null ? `${r.agreement.companyBillingSharePct}%` : 'No % signed')}
                {r.agreement.model === 'C' && (r.agreement.companyNetProfitSharePct != null ? `${r.agreement.companyNetProfitSharePct}%` : 'No % signed')}
                {r.agreement.model === 'B' && (r.agreement.managerSalary != null ? `${rm(r.agreement.managerSalary)} a month` : 'No salary signed')}
              </span>
            </div>
            <div className="muted small">
              v{r.agreement.version} from {dateLabel(r.agreement.effectiveFrom)} · {r.agreement.managerName} (
              {r.agreement.managerKind === 'employee' ? 'employee' : 'partner company'}) · {r.agreement.signedRef}
            </div>
          </div>
        ) : (
          <div className="empty">No signed agreement on record.</div>
        )}
        {agreementForm && <AgreementForm branchId={r.branch.id} current={r.agreement} onDone={() => setAgreementForm(false)} />}
      </section>
      {s && sp && (
        <section className="panel">
          <div className="panel-head">
            <h3>{s.period} settlement</h3>
            <Chip tone={r.holds.length ? 'crit' : s.status === 'draft' ? 'warn' : 'ok'}>
              {r.holds.length ? 'Held' : s.status === 'draft' ? 'To approve' : `Approved by ${s.approvedBy}`}
            </Chip>
          </div>
          <div className="list">
            <div className="list-item">
              <span>Billing</span>
              <span>{rm(s.billing)}</span>
            </div>
            <div className="list-item">
              <span>Wages, statutory and other costs</span>
              <span>({rm(sp.costs)})</span>
            </div>
            <div className="list-item">
              <span>Branch net</span>
              <span>{rm(sp.net)}</span>
            </div>
            <div className="list-item" style={{ fontWeight: 700 }}>
              <span>Company keeps{sp.pct != null ? ` (${sp.pct}%)` : ''}</span>
              <span>{rm(sp.companyShare)}</span>
            </div>
            <div className="list-item">
              <span>{r.agreement?.model === 'B' ? 'Branch Manager (salary through payroll)' : 'Branch Manager'}</span>
              <span>{rm(sp.managerShare)}</span>
            </div>
            {sp.shortfall > 0 && (
              <div className="notice" data-tone="warn">
                Shortfall {rm(sp.shortfall)}: costs ran past the manager's part. Wages are paid in full; the company covers it and records it against the
                manager.
              </div>
            )}
          </div>
          {r.holds.map((h) => (
            <div key={h} className="notice" data-tone="crit">
              {h}
            </div>
          ))}
          {r.canApprove && <ApproveSettlement id={s.id} />}
          <p className="muted small">Wages are never held. A hold stops only the payout of the shares.</p>
        </section>
      )}
      <MonthsPanel row={r} />
      {(r.role === 'manager' || r.role === 'view') && <ClosePanel row={r} />}
      <section className="panel">
        <div className="panel-head">
          <h3>Branch actions to review</h3>
        </div>
        <div className="list">
          {r.queue.length === 0 && <div className="empty">Nothing waiting.</div>}
          {r.queue.map((q) => (
            <ActionLine key={q.action.id} q={q} canDecide={manager} />
          ))}
          {r.reviewed.map((a) => (
            <div key={a.id} className="muted small">
              {a.title}: {a.status} by {a.reviewedBy}
              {a.note ? ` (${a.note})` : ''}
            </div>
          ))}
        </div>
      </section>
    </Drawer>
  );
}

function ActionLine({ q, canDecide }: { q: Row['queue'][number]; canDecide: boolean }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const a = q.action;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div>{a.title}</div>
          <div className="muted small">
            {a.control === 'C' ? 'Needs the company first' : 'Done by the branch, company may reverse'} · {a.by} · {dateTimeLabel(a.at)}
            {a.amount != null ? ` · ${rm(a.amount)}` : ''}
          </div>
        </div>
        <Chip tone={q.level ? 'crit' : 'warn'}>{q.level ? `${q.age} days, with ${q.level}` : `${q.age} day${q.age === 1 ? '' : 's'}`}</Chip>
      </div>
      {canDecide && (
        <>
          <input className="input" aria-label="Note" placeholder="Note (needed to reverse)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.reviewBranchAction(a.id, 'accepted', note), 'Accepted.')}>
              {a.control === 'C' ? 'Approve' : 'Accept'}
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || !note.trim()}
              onClick={() => act.run(() => api.reviewBranchAction(a.id, 'reversed', note), 'Reversed.')}
            >
              {a.control === 'C' ? 'Refuse' : 'Reverse'}
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </>
      )}
    </div>
  );
}

function AgreementForm({ branchId, current, onDone }: { branchId: string; current: Row['agreement']; onDone: () => void }) {
  const act = useAction();
  const [model, setModel] = useState<BranchModel>(current?.model ?? 'A');
  const [from, setFrom] = useState('');
  const [pct, setPct] = useState('');
  const [salary, setSalary] = useState('');
  const [name, setName] = useState(current?.managerName ?? '');
  const [kind, setKind] = useState<'employee' | 'partner_company'>(current?.managerKind ?? 'partner_company');
  const [ref, setRef] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <select className="select" aria-label="Model" value={model} onChange={(e) => setModel(e.target.value as BranchModel)}>
        {(['A', 'B', 'C'] as const).map((m) => (
          <option key={m} value={m}>
            {MODEL[m]}
          </option>
        ))}
      </select>
      {model === 'B' ? (
        <input
          className="input"
          inputMode="decimal"
          aria-label="Salary"
          placeholder="Branch Manager salary, RM a month"
          value={salary}
          onChange={(e) => setSalary(e.target.value)}
        />
      ) : (
        <input
          className="input"
          inputMode="decimal"
          aria-label="Percentage"
          placeholder="Signed % the company keeps"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
        />
      )}
      <input className="input" aria-label="Branch Manager" placeholder="Branch Manager" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="select" aria-label="Manager is" value={kind} onChange={(e) => setKind(e.target.value as 'employee' | 'partner_company')}>
        <option value="partner_company">Partner company</option>
        <option value="employee">Employee</option>
      </select>
      <label className="small muted" htmlFor="ag-from">
        Starts on the first day of a month, after the last settled month
      </label>
      <input id="ag-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <input
        className="input"
        aria-label="Signed agreement reference"
        placeholder="Signed agreement reference"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
      />
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy || !from || !ref.trim() || !name.trim()}
        onClick={async () => {
          const ok = await act.run(
            () =>
              api.addBranchAgreement(branchId, {
                effectiveFrom: from,
                model,
                managerName: name,
                managerKind: kind,
                pct: model === 'B' ? null : Number(pct),
                managerSalary: model === 'B' ? Number(salary) : null,
                signedRef: ref,
              }),
            'Agreement recorded.',
          );
          if (ok) onDone();
        }}
      >
        Save version
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function ApproveSettlement({ id }: { id: string }) {
  const act = useAction();
  const [note, setNote] = useState('');
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <input className="input" aria-label="Approval comment" placeholder="Comment (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy || note.trim().length < 3}
        onClick={() => act.run(() => api.approveBranchSettlement(id, note), 'Settlement approved.')}
      >
        Approve settlement
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

const STATES = ['Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya'];

function AddBranch({ companies }: { companies: BranchBoard['canAdd'] }) {
  const act = useAction();
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ companyId: companies[0]?.id ?? '', name: '', state: 'Selangor', model: 'A' as BranchModel });
  if (!show)
    return (
      <button className="btn btn-sm" onClick={() => setShow(true)}>
        Propose a new branch
      </button>
    );
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Propose a new branch</h3>
      </div>
      <p className="muted small">It starts as proposed. You activate it once the signed agreement, KDN and council references, insurance, the SQL project code and a verified company bank account are on record.</p>
      <div style={{ display: 'grid', gap: 6 }}>
        {companies.length > 1 && (
          <select className="select" aria-label="Company" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <input className="input" aria-label="Branch name" placeholder="Branch name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select className="select" aria-label="State" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>
          {STATES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select className="select" aria-label="Model" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value as BranchModel })}>
          {(['A', 'B', 'C'] as const).map((m) => (
            <option key={m} value={m}>
              {MODEL[m]}
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || f.name.trim().length < 3}
          onClick={async () => {
            if (await act.run(() => api.addBranch(f.companyId, { name: f.name, state: f.state, model: f.model }), 'Branch proposed.')) setShow(false);
          }}
        >
          Propose
        </button>
        <ErrorNotice error={act.error} />
      </div>
    </section>
  );
}

const ACCOUNT_KIND: Record<string, string> = {
  company_branch_bank: "Company's own bank account for the branch",
  project_ledger: 'SQL Account project ledger',
  partner_entity: "Partner's own business account (manager's fee only)",
};

function SetupPanel({ row: r }: { row: Row }) {
  const act = useAction();
  const b = r.branch;
  const staff = r.role === 'manager' || r.role === 'staff';
  const [refs, setRefs] = useState({ kdnRef: b.setup?.kdnRef ?? '', premisesRef: b.setup?.premisesRef ?? '', insuranceRef: b.setup?.insuranceRef ?? '' });
  const [code, setCode] = useState(b.setup?.sqlProjectCode ?? '');
  const [acct, setAcct] = useState({ kind: 'company_branch_bank', holder: r.companyName, bank: '', last4: '', ssmRegNo: '', signatories: '' });
  const [verifyNote, setVerifyNote] = useState('');
  const [activateNote, setActivateNote] = useState('');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Papers and accounts</h3>
        <Chip tone={r.status === 'proposed' ? 'warn' : 'ok'}>{r.status === 'proposed' ? 'Proposed' : r.status}</Chip>
      </div>
      {r.activationGaps.length > 0 && (
        <div className="notice" data-tone="warn">
          Before activation: {r.activationGaps.join('; ')}.
        </div>
      )}
      <div className="list">
        <div className="list-item">
          <span>KDN approval</span>
          <span>{b.setup?.kdnRef ?? 'Not recorded'}</span>
        </div>
        <div className="list-item">
          <span>Premises or council licence</span>
          <span>{b.setup?.premisesRef ?? 'Not recorded'}</span>
        </div>
        <div className="list-item">
          <span>Insurance</span>
          <span>{b.setup?.insuranceRef ?? 'Not recorded'}</span>
        </div>
        <div className="list-item">
          <span>SQL Account project code</span>
          <span>{b.setup?.sqlProjectCode ? `${b.setup.sqlProjectCode} (${b.setup.sqlProjectCodeBy})` : 'Finance to set'}</span>
        </div>
        <div className="list-item">
          <span>Legal employer</span>
          <span>{b.setup?.legalEmployer ?? 'Not confirmed'}</span>
        </div>
        {(b.accounts ?? []).map((a) => (
          <div key={a.id} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
            <span>
              {ACCOUNT_KIND[a.kind]}: {a.holder}
              {a.last4 ? ` · ${a.bank} …${a.last4}` : ''}
            </span>
            {a.verifiedBy ? (
              <Chip tone="ok">Verified by {a.verifiedBy}</Chip>
            ) : r.finance ? (
              <span className="row" style={{ gap: 4 }}>
                <input className="input" aria-label="Checked against" placeholder="Checked against (bank letter)" value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} />
                <button
                  className="btn btn-sm"
                  disabled={act.busy || verifyNote.trim().length < 3}
                  onClick={() => act.run(() => api.branchAct(b.id, 'verify_account', { accountId: a.id, note: verifyNote }), 'Account verified.')}
                >
                  Verify
                </button>
              </span>
            ) : (
              <Chip tone="warn">Finance to verify</Chip>
            )}
          </div>
        ))}
      </div>
      {staff && r.status !== 'closed' && (
        <details>
          <summary className="small">Record papers</summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            <input className="input" aria-label="KDN reference" placeholder="KDN branch or operating-area approval reference" value={refs.kdnRef} onChange={(e) => setRefs({ ...refs, kdnRef: e.target.value })} />
            <input className="input" aria-label="Premises reference" placeholder="Premises or council licence reference" value={refs.premisesRef} onChange={(e) => setRefs({ ...refs, premisesRef: e.target.value })} />
            <input className="input" aria-label="Insurance reference" placeholder="Insurance policy reference" value={refs.insuranceRef} onChange={(e) => setRefs({ ...refs, insuranceRef: e.target.value })} />
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.branchAct(b.id, 'setup', refs), 'Papers saved.')}>
                Save papers
              </button>
              {r.role === 'manager' && (
                <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.branchAct(b.id, 'setup', { legalEmployerConfirmed: true }), 'Employer confirmed.')}>
                  Confirm {r.companyName} is the employer
                </button>
              )}
            </div>
          </div>
        </details>
      )}
      {staff && r.status !== 'closed' && (
        <details>
          <summary className="small">Add an account</summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            <select className="select" aria-label="Account type" value={acct.kind} onChange={(e) => setAcct({ ...acct, kind: e.target.value })}>
              {Object.entries(ACCOUNT_KIND).map(([k, t]) => (
                <option key={k} value={k}>
                  {t}
                </option>
              ))}
            </select>
            <input className="input" aria-label="Account holder" placeholder="Account holder (exact name)" value={acct.holder} onChange={(e) => setAcct({ ...acct, holder: e.target.value })} />
            {acct.kind !== 'project_ledger' && (
              <>
                <input className="input" aria-label="Bank" placeholder="Bank" value={acct.bank} onChange={(e) => setAcct({ ...acct, bank: e.target.value })} />
                <input className="input" aria-label="Last 4 digits" placeholder="Last 4 digits only" inputMode="numeric" maxLength={4} value={acct.last4} onChange={(e) => setAcct({ ...acct, last4: e.target.value })} />
                <input className="input" aria-label="Signatories" placeholder="Named signatories" value={acct.signatories} onChange={(e) => setAcct({ ...acct, signatories: e.target.value })} />
              </>
            )}
            {acct.kind === 'partner_entity' && (
              <input className="input" aria-label="SSM number" placeholder="Partner's SSM registration number" value={acct.ssmRegNo} onChange={(e) => setAcct({ ...acct, ssmRegNo: e.target.value })} />
            )}
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.branchAct(b.id, 'add_account', acct), 'Account added; Finance verifies it.')}>
              Add account
            </button>
          </div>
        </details>
      )}
      {r.finance && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <input className="input" aria-label="SQL Account project code" placeholder="SQL Account project code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn btn-sm" disabled={act.busy || code.trim().length < 2} onClick={() => act.run(() => api.branchAct(b.id, 'project_code', { code }), 'Project code set.')}>
            Set project code
          </button>
        </div>
      )}
      {r.role === 'manager' && r.status === 'proposed' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <input className="input" aria-label="Activation comment" placeholder="Comment (needed)" value={activateNote} onChange={(e) => setActivateNote(e.target.value)} />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || r.activationGaps.length > 0 || activateNote.trim().length < 3}
            onClick={() => act.run(() => api.branchAct(b.id, 'activate', { note: activateNote }), 'Branch activated.')}
          >
            Activate branch
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Prepared, to approve',
  returned: 'Returned for correction',
  approved: 'Approved, Finance to validate',
  validated: 'Validated, Finance to pay',
  paid: 'Paid',
};

const LINE_KINDS = ['billing', 'credit_note', 'true_up', ...BRANCH_COST_KINDS] as const;
const LINE_LABEL: Record<string, string> = { billing: 'Invoice billed (excl. SST)', credit_note: 'Credit note (negative)', true_up: 'True-up for an earlier month', ...BRANCH_COST_LABEL };

function MonthsPanel({ row: r }: { row: Row }) {
  const [prep, setPrep] = useState<string | null>(null);
  const canPrepare = (r.role === 'manager' || r.role === 'staff' || r.finance) && ['active', 'step_in', 'terminating'].includes(r.status);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Months</h3>
        {canPrepare && (
          <button className="btn btn-sm" onClick={() => setPrep(prep ? null : '')}>
            Prepare a month
          </button>
        )}
      </div>
      {prep !== null && <PrepareMonth row={r} period={prep} onDone={() => setPrep(null)} />}
      <div className="list">
        {r.months.length === 0 && <div className="empty">No months yet.</div>}
        {r.months.map((m) => (
          <MonthLine key={m.id} row={r} m={m} onCorrect={() => setPrep(m.period)} />
        ))}
      </div>
    </section>
  );
}

function MonthLine({ row: r, m, onCorrect }: { row: Row; m: Row['months'][number]; onCorrect: () => void }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [bankRef, setBankRef] = useState('');
  const manager = r.role === 'manager';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <span>
          {m.period} · billing {rm(m.billing)}
          {m.preparedBy ? ` · prepared by ${m.preparedBy}` : ''}
        </span>
        <Chip tone={m.status === 'paid' ? 'ok' : m.status === 'returned' ? 'crit' : 'warn'}>{STATUS_LABEL[m.status] ?? m.status}</Chip>
      </div>
      {m.legacy && <div className="muted small">Test figures: not prepared from SQL Account lines.</div>}
      {(m.lines ?? []).length > 0 && (
        <details>
          <summary className="small">{m.lines!.length} lines · payroll {m.payrollRef}</summary>
          {m.lines!.map((l, i) => (
            <div key={i} className="muted small">
              {LINE_LABEL[l.kind] ?? l.kind}: {l.ref} {rm(l.amount)}
              {l.note ? ` (${l.note})` : ''}
            </div>
          ))}
        </details>
      )}
      {(m.steps ?? []).map((st, i) => (
        <div key={i} className="muted small">
          {dateTimeLabel(st.at)} {st.by}: {st.what}
          {st.note ? `. ${st.note}` : ''}
        </div>
      ))}
      {m.status === 'returned' && (r.role === 'manager' || r.role === 'staff' || r.finance) && (
        <button className="btn btn-sm" onClick={onCorrect}>
          Correct and resubmit
        </button>
      )}
      {((m.status === 'draft' && manager) || (m.status === 'approved' && r.finance) || (m.status === 'validated' && r.finance)) && (
        <div style={{ display: 'grid', gap: 4 }}>
          {m.status === 'validated' && (
            <input className="input" aria-label="Bank reference" placeholder="Bank reference of the payment" value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
          )}
          <input className="input" aria-label="Comment" placeholder="Comment or reason (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {m.status === 'approved' && !m.legacy && (
              <button className="btn btn-sm btn-primary" disabled={act.busy || note.trim().length < 5} onClick={() => act.run(() => api.branchSettlementAct(m.id, 'validate', { note }), 'Validated.')}>
                Agreed to SQL Account
              </button>
            )}
            {m.status === 'validated' && (
              <button className="btn btn-sm btn-primary" disabled={act.busy || note.trim().length < 3 || bankRef.trim().length < 3} onClick={() => act.run(() => api.branchSettlementAct(m.id, 'paid', { bankRef, note }), 'Payment recorded.')}>
                Record payment
              </button>
            )}
            {(m.status === 'draft' || m.status === 'approved') && (
              <button className="btn btn-sm" disabled={act.busy || note.trim().length < 5} onClick={() => act.run(() => api.branchSettlementAct(m.id, 'return', { reason: note }), 'Returned.')}>
                Return for correction
              </button>
            )}
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

type LineDraft = { kind: string; ref: string; siteId: string; amount: string; note: string };

function PrepareMonth({ row: r, period: initial, onDone }: { row: Row; period: string; onDone: () => void }) {
  const act = useAction();
  const existing = r.months.find((m) => m.period === initial);
  const [period, setPeriod] = useState(initial);
  const [payrollRef, setPayrollRef] = useState(existing?.payrollRef ?? '');
  const [lines, setLines] = useState<LineDraft[]>(
    existing?.lines?.map((l) => ({ kind: l.kind, ref: l.ref, siteId: l.siteId ?? '', amount: String(l.amount), note: l.note })) ?? [
      { kind: 'billing', ref: '', siteId: '', amount: '', note: '' },
      { kind: 'wages', ref: '', siteId: '', amount: '', note: '' },
    ],
  );
  const set = (i: number, k: keyof LineDraft, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      <p className="muted small">
        Every line cites its SQL Account document (invoice, credit note, bill or journal) or payroll reference. Billing lines name a site of this branch with a
        signed contract; one invoice belongs to one branch month.
      </p>
      <label className="small" htmlFor="bm-period">
        Month
      </label>
      <input id="bm-period" className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
      <input className="input" aria-label="Payroll reference" placeholder="Payroll run or JA pay summary reference" value={payrollRef} onChange={(e) => setPayrollRef(e.target.value)} />
      {lines.map((l, i) => (
        <div key={i} className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <select className="select" aria-label={`Line ${i + 1} kind`} value={l.kind} onChange={(e) => set(i, 'kind', e.target.value)}>
            {LINE_KINDS.map((k) => (
              <option key={k} value={k}>
                {LINE_LABEL[k]}
              </option>
            ))}
          </select>
          <input className="input" aria-label={`Line ${i + 1} reference`} placeholder="SQL doc / payroll ref" value={l.ref} onChange={(e) => set(i, 'ref', e.target.value)} />
          {l.kind === 'billing' && (
            <input className="input" aria-label={`Line ${i + 1} site`} placeholder="Site ID" value={l.siteId} onChange={(e) => set(i, 'siteId', e.target.value)} />
          )}
          <input className="input" aria-label={`Line ${i + 1} amount`} placeholder="RM" inputMode="decimal" value={l.amount} onChange={(e) => set(i, 'amount', e.target.value)} />
          <button className="btn btn-sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button className="btn btn-sm" onClick={() => setLines([...lines, { kind: 'other', ref: '', siteId: '', amount: '', note: '' }])}>
        Add line
      </button>
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy || !period}
        onClick={async () => {
          const ok = await act.run(
            () =>
              api.branchAct(r.branch.id, 'prepare', {
                period,
                payrollRef,
                lines: lines.map((l) => ({ kind: l.kind, ref: l.ref, siteId: l.siteId || null, amount: Number(l.amount), note: l.note })),
              }),
            existing ? 'Corrected and resubmitted.' : 'Month prepared.',
          );
          if (ok) onDone();
        }}
      >
        {existing ? 'Resubmit' : 'Submit for approval'}
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function ClosePanel({ row: r }: { row: Row }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const b = r.branch;
  const done = b.termination ?? [];
  const next = TERMINATION_STEPS[done.length];
  if (r.status === 'proposed') return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Step-in and closing</h3>
      </div>
      {b.stepIn && (
        <div className="muted small">
          Company stepped in {dateTimeLabel(b.stepIn.at)} by {b.stepIn.by}: {b.stepIn.reason}
          {b.stepIn.endedAt ? ` · ended ${dateTimeLabel(b.stepIn.endedAt)} by ${b.stepIn.endedBy}` : ''}
        </div>
      )}
      {done.map((d) => (
        <div key={d.step} className="muted small">
          ✓ {TERMINATION_LABEL[d.step]} · {d.by}, {dateTimeLabel(d.at)}: {d.note}
        </div>
      ))}
      {r.role === 'manager' && r.status !== 'closed' && (
        <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
          <input className="input" aria-label="Reason or note" placeholder="Reason or note (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {(r.status === 'active' || r.status === 'step_in') && (
              <button
                className="btn btn-sm"
                disabled={act.busy || note.trim().length < 5}
                onClick={() => act.run(() => api.branchAct(b.id, r.status === 'step_in' ? 'step_out' : 'step_in', { reason: note }), 'Saved.')}
              >
                {r.status === 'step_in' ? 'Hand back to the branch' : 'Company steps in'}
              </button>
            )}
            {next && (
              <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.branchAct(b.id, 'terminate', { step: next, note }), 'Step recorded.')}>
                {done.length ? `Next: ${TERMINATION_LABEL[next]}` : 'Start closing: notice given'}
              </button>
            )}
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}


/** Masterplan 145: the business case and 13-week cash forecast. Company staff enter it; Finance reviews it. */
function BusinessCasePanel({ row: r }: { row: Row }) {
  const act = useAction();
  const b = r.branch;
  const bc = r.businessCase;
  const staff = r.role === 'manager' || r.role === 'staff';
  const [show, setShow] = useState(false);
  const [note, setNote] = useState('');
  const blankWeeks = () => Array.from({ length: 13 }, (_, i) => ({ week: i + 1, inflow: '', outflow: '' }));
  const [f, setF] = useState({ sites: '', guards: '', monthlyBilling: '', monthlyCosts: '', startupCost: '', openingCash: '', fundingSource: '', assumptions: '' });
  const [weeks, setWeeks] = useState(blankWeeks);
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const field = (k: keyof typeof f, label: string) => (
    <input className="input" aria-label={label} placeholder={label} inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Business case and 13-week cash</h3>
        {bc ? <Chip tone={bc.reviewedBy ? 'ok' : 'warn'}>{bc.reviewedBy ? `v${bc.version} reviewed` : `v${bc.version} to review`}</Chip> : <Chip tone="warn">None</Chip>}
      </div>
      <p className="small muted">The company&apos;s own estimates. They are not payments or approvals of spending.</p>
      {bc && (
        <>
          <div className="list">
            <div className="list-item"><span>Sites and guards expected</span><span>{bc.sites} sites · {bc.guards} guards</span></div>
            <div className="list-item"><span>Monthly billing / costs</span><span>{rm(bc.monthlyBilling)} / {rm(bc.monthlyCosts)}</span></div>
            <div className="list-item"><span>Start-up cost and funding</span><span>{rm(bc.startupCost)} · {bc.fundingSource}</span></div>
            <div className="list-item"><span>Entered by</span><span>{bc.by} · {dateTimeLabel(bc.at)}</span></div>
            {bc.reviewedBy && <div className="list-item"><span>Finance review</span><span>{bc.reviewedBy}: {bc.reviewNote}</span></div>}
          </div>
          <p className="small">{bc.assumptions}</p>
          <div className="table-wrap">
            <table className="small">
              <thead><tr><th>Week</th><th>In</th><th>Out</th><th>Cash at end</th></tr></thead>
              <tbody>
                {bc.summary.weeks.map((w) => (
                  <tr key={w.week}><td>{w.week}</td><td>{rm(w.inflow)}</td><td>{rm(w.outflow)}</td><td style={{ color: w.closing < 0 ? 'var(--crit)' : undefined }}>{rm(w.closing)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {bc.summary.firstShortWeek && (
            <div className="notice" data-tone="warn">Cash runs short from week {bc.summary.firstShortWeek} (lowest {rm(bc.summary.lowest)}). The Finance review must say how it is covered.</div>
          )}
          {r.finance && !bc.reviewedBy && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input className="input" aria-label="Business case review comment" placeholder="Review comment (what you checked)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.branchAct(b.id, 'review_business_case', { note }), 'Business case reviewed.')}>
                Mark reviewed
              </button>
            </div>
          )}
        </>
      )}
      {staff && r.status !== 'closed' && r.status !== 'terminating' && (
        <details open={show} onToggle={(e) => setShow((e.target as HTMLDetailsElement).open)}>
          <summary className="small">{bc ? 'Enter a new version' : 'Enter the business case'}</summary>
          <div className="list" style={{ gap: 6 }}>
            {field('sites', 'Sites expected')}
            {field('guards', 'Guards expected')}
            {field('monthlyBilling', 'Monthly billing (RM, excl. SST)')}
            {field('monthlyCosts', 'Monthly costs (RM)')}
            {field('startupCost', 'Start-up cost (RM)')}
            {field('openingCash', 'Opening cash (RM)')}
            <input className="input" aria-label="Funding source" placeholder="Where start-up money comes from" value={f.fundingSource} onChange={(e) => setF({ ...f, fundingSource: e.target.value })} />
            <textarea className="input" aria-label="Assumptions" placeholder="Main assumptions: clients, rates, start date" value={f.assumptions} onChange={(e) => setF({ ...f, assumptions: e.target.value })} />
            <div className="table-wrap">
              <table className="small">
                <thead><tr><th>Week</th><th>Money in (RM)</th><th>Money out (RM)</th></tr></thead>
                <tbody>
                  {weeks.map((w, i) => (
                    <tr key={w.week}>
                      <td>{w.week}</td>
                      <td><input className="input" aria-label={`Week ${w.week} in`} inputMode="decimal" value={w.inflow} onChange={(e) => setWeeks(weeks.map((x, j) => (j === i ? { ...x, inflow: e.target.value } : x)))} /></td>
                      <td><input className="input" aria-label={`Week ${w.week} out`} inputMode="decimal" value={w.outflow} onChange={(e) => setWeeks(weeks.map((x, j) => (j === i ? { ...x, outflow: e.target.value } : x)))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy}
              onClick={async () => {
                const ok = await act.run(
                  () =>
                    api.branchAct(b.id, 'business_case', {
                      sites: num(f.sites),
                      guards: num(f.guards),
                      monthlyBilling: num(f.monthlyBilling),
                      monthlyCosts: num(f.monthlyCosts),
                      startupCost: num(f.startupCost),
                      openingCash: num(f.openingCash),
                      fundingSource: f.fundingSource,
                      assumptions: f.assumptions,
                      cash13: weeks.map((w) => ({ week: w.week, inflow: num(w.inflow || '0'), outflow: num(w.outflow || '0') })),
                    }),
                  'Business case saved. Finance reviews it next.',
                );
                if (ok) {
                  setShow(false);
                  setWeeks(blankWeeks());
                }
              }}
            >
              Save business case
            </button>
          </div>
        </details>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

/** Branch treasury: figures Finance records from the bank statement. Unknown when nothing recent is recorded. */
function TreasuryPanel({ row: r }: { row: Row }) {
  const act = useAction();
  const b = r.branch;
  const t = r.treasury!;
  const [f, setF] = useState({ on: '', bankBalance: '', statementRef: '', floatHeld: '', payrollDueOn: '', payrollDueAmount: '', payrollRef: '', paymentsDue7d: '' });
  const [limit, setLimit] = useState({ amount: '', reason: '' });
  const tone = t.state === 'ok' ? 'ok' : t.state === 'attention' ? 'warn' : 'neutral';
  const label = t.state === 'ok' ? 'Fine' : t.state === 'attention' ? 'Needs attention' : 'Unknown';
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Branch cash</h3>
        <Chip tone={tone}>{label}</Chip>
      </div>
      <p className="small muted">Recorded by Finance from the bank statement. Prima does not read the bank or make payments.</p>
      {t.flags.length > 0 && <div className="notice" data-tone={t.state === 'attention' ? 'warn' : undefined}>{t.flags.join('; ')}.</div>}
      {t.latest && (
        <div className="list">
          <div className="list-item"><span>Bank balance</span><span>{rm(t.latest.bankBalance)} on {dateLabel(t.latest.on)} ({t.latest.statementRef})</span></div>
          <div className="list-item"><span>Cash float held</span><span>{rm(t.latest.floatHeld)}{r.floatLimit ? ` of ${rm(r.floatLimit.amount)} limit` : ''}</span></div>
          <div className="list-item"><span>Next payroll</span><span>{t.latest.payrollDueOn ? `${rm(t.latest.payrollDueAmount ?? 0)} on ${dateLabel(t.latest.payrollDueOn)} (${t.latest.payrollRef})` : 'Not recorded'}</span></div>
          <div className="list-item"><span>Other payments due in 7 days</span><span>{rm(t.latest.paymentsDue7d)}</span></div>
        </div>
      )}
      {r.finance && r.status !== 'closed' && (
        <details>
          <summary className="small">Record today&apos;s figures</summary>
          <div className="list" style={{ gap: 6 }}>
            <input className="input" type="date" aria-label="Statement date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
            <input className="input" aria-label="Bank balance" placeholder="Bank balance (RM)" inputMode="decimal" value={f.bankBalance} onChange={(e) => setF({ ...f, bankBalance: e.target.value })} />
            <input className="input" aria-label="Statement reference" placeholder="Bank statement reference" value={f.statementRef} onChange={(e) => setF({ ...f, statementRef: e.target.value })} />
            <input className="input" aria-label="Cash float held" placeholder="Cash float held (RM)" inputMode="decimal" value={f.floatHeld} onChange={(e) => setF({ ...f, floatHeld: e.target.value })} />
            <input className="input" type="date" aria-label="Next payroll date" value={f.payrollDueOn} onChange={(e) => setF({ ...f, payrollDueOn: e.target.value })} />
            <input className="input" aria-label="Payroll amount" placeholder="Payroll amount due (RM)" inputMode="decimal" value={f.payrollDueAmount} onChange={(e) => setF({ ...f, payrollDueAmount: e.target.value })} />
            <input className="input" aria-label="Payroll reference" placeholder="Payroll run or JA pay summary ref" value={f.payrollRef} onChange={(e) => setF({ ...f, payrollRef: e.target.value })} />
            <input className="input" aria-label="Payments due in 7 days" placeholder="Other payments due in 7 days (RM)" inputMode="decimal" value={f.paymentsDue7d} onChange={(e) => setF({ ...f, paymentsDue7d: e.target.value })} />
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy}
              onClick={() =>
                act.run(
                  () =>
                    api.branchAct(b.id, 'treasury', {
                      on: f.on,
                      bankBalance: f.bankBalance.trim() === '' ? NaN : Number(f.bankBalance),
                      statementRef: f.statementRef,
                      floatHeld: Number(f.floatHeld || '0'),
                      payrollDueOn: f.payrollDueOn || null,
                      payrollDueAmount: f.payrollDueAmount.trim() === '' ? null : Number(f.payrollDueAmount),
                      payrollRef: f.payrollRef || null,
                      paymentsDue7d: Number(f.paymentsDue7d || '0'),
                    }),
                  'Figures recorded.',
                )
              }
            >
              Record figures
            </button>
          </div>
        </details>
      )}
      {r.role === 'manager' && r.status !== 'closed' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <input className="input" aria-label="Float limit" placeholder={r.floatLimit ? `Float limit (now ${rm(r.floatLimit.amount)})` : 'Cash float limit (RM)'} inputMode="decimal" value={limit.amount} onChange={(e) => setLimit({ ...limit, amount: e.target.value })} />
          <input className="input" aria-label="Float limit reason" placeholder="Reason" value={limit.reason} onChange={(e) => setLimit({ ...limit, reason: e.target.value })} />
          <button className="btn btn-sm" disabled={act.busy || !limit.amount.trim() || limit.reason.trim().length < 3} onClick={() => act.run(() => api.branchAct(b.id, 'float_limit', { amount: Number(limit.amount), reason: limit.reason }), 'Float limit set.')}>
            Set float limit
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

