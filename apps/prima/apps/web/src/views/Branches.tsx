import { Select } from '../SearchSelect';
import { useState } from 'react';
import { ClockCountdownIcon, HandPalmIcon, ListChecksIcon, PlusIcon, StampIcon } from '@phosphor-icons/react';
import { BRANCH_APPROVER_LABEL, BRANCH_COST_KINDS, BRANCH_COST_LABEL, TERMINATION_LABEL, TERMINATION_STEPS, isOwnerAdmin, type BranchModel } from '@prima/core';
import { api, type BranchBoard, type BranchJv } from '../api';
import { useApp } from '../App';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import '../styles/biz.css';

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

/** The branch's state in one word, and its tone. */
function branchState(r: Row): [Tone, string] {
  const tone: Tone = r.status === 'proposed' ? 'warn' : r.holds.length ? 'crit' : r.canApprove ? 'warn' : 'ok';
  const label =
    r.status === 'proposed'
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
                  : 'In order';
  return [tone, label];
}

export function BranchesView() {
  const { data, error } = useLoad(() => api.branchBoard(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="branches" />
      </div>
    );
  const waiting = data.rows.reduce((n, r) => n + r.queue.length, 0);
  const late = data.rows.reduce((n, r) => n + r.queue.filter((q) => q.level).length, 0);
  const held = data.rows.filter((r) => r.settlement?.status === 'draft' && r.holds.length).length;
  const toApprove = data.rows.filter((r) => r.canApprove).length;
  const row = data.rows.find((r) => r.branch.id === open) ?? null;
  const companies = [...new Set(data.rows.map((r) => r.companyName))];
  return (
    <div className="page bz-br-page">
      <PageHead
        title="Branches"
        sub="A branch works inside its licensed company: same licence, employer and accounts. The company approves each month's settlement under the signed agreement and reviews every branch action. A month prepared from SQL Account lines shows its references; older test months are marked as not prepared from SQL. Prima records payments; it never makes them."
        actions={
          data.canAdd.length > 0 && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <PlusIcon size={16} weight="bold" aria-hidden="true" />
              Propose a new branch
            </button>
          )
        }
      />
      <Stats>
        <Stat label={`${data.prev} settlements to approve`} value={toApprove} tone={toApprove ? 'warn' : 'ok'} icon={<StampIcon size={16} />} />
        <Stat label="Settlements held" value={held} tone={held ? 'crit' : 'ok'} note="Agreement, bank, wages or licence" icon={<HandPalmIcon size={16} />} />
        <Stat label="Branch actions to review" value={waiting} tone={waiting ? 'warn' : 'ok'} note="Done by a branch, checked by the company" icon={<ListChecksIcon size={16} />} />
        <Stat
          label={`Not reviewed in ${data.rule.reviewDays} days`}
          value={late}
          tone={late ? 'crit' : 'ok'}
          note={late ? 'Escalated for review' : 'Nothing overdue'}
          icon={<ClockCountdownIcon size={16} />}
        />
      </Stats>
      {companies.length === 0 && (
        <Card>
          <Empty
            title="No branches yet."
            action={
              data.canAdd.length > 0 && (
                <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
                  Propose a new branch
                </button>
              )
            }
          >
            A branch works inside its licensed company under a signed agreement. Propose it here; the company manager approves its settlements.
          </Empty>
        </Card>
      )}
      {companies.map((name) => {
        const rows = data.rows.filter((r) => r.companyName === name);
        return (
          <Card key={name} title={name} sub={`${rows.length} branch${rows.length === 1 ? '' : 'es'}`} flush>
            <ul className="bz-rows">
              {rows.map((r) => {
                const [tone, label] = branchState(r);
                return (
                  <li key={r.branch.id}>
                    <button className="bz-row bz-br-row" data-tone={tone === 'ok' ? undefined : tone} onClick={() => setOpen(r.branch.id)}>
                      <span className="bz-row-main">
                        <span className="bz-row-title">{r.branch.name}</span>
                        <span className="bz-row-meta">
                          {r.agreement ? `Model ${r.agreement.model} · ${r.agreement.managerName}` : 'No signed agreement'} · {r.sites} sites
                        </span>
                        {r.queue.length > 0 && <span className="bz-row-meta bz-br-todo">{r.queue.length} to review</span>}
                        {r.purchasesAwaiting ? (
                          <span className="bz-row-meta bz-br-todo">
                            {r.purchasesAwaiting} request{r.purchasesAwaiting === 1 ? '' : 's'} (purchases or expenses) to decide
                          </span>
                        ) : null}
                      </span>
                      <span className="bz-row-side">
                        {r.split && (
                          <>
                            <span className="bz-amt">{rm(r.split.companyShare)}</span>
                            <span className="bz-sub">company keeps</span>
                          </>
                        )}
                        <Chip tone={tone}>{label}</Chip>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
      {row && <BranchDrawer row={row} onClose={() => setOpen(null)} />}
      {adding && <AddBranch companies={data.canAdd} onClose={() => setAdding(false)} />}
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
  // P78: the owner records a signed agreement too (the server allows it); approvals stay with the company manager.
  const owner = isOwnerAdmin(useApp().me.user);
  const [tone, label] = branchState(r);
  return (
    <Drawer title={r.branch.name} sub={`${r.companyName} · ${r.sites} sites · ${r.liveContracts} live contracts`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <div className="bz-chips">
        <Chip tone={tone}>{label}</Chip>
        {r.agreement && <Chip tone="neutral">Model {r.agreement.model}</Chip>}
        {r.queue.length > 0 && <Chip tone="warn">{r.queue.length} to review</Chip>}
      </div>
      {s && sp && (
        <section className="bz-sec">
          <div className="bz-sec-head">
            <h3>{s.period} settlement</h3>
            <Chip tone={r.holds.length ? 'crit' : s.status === 'draft' ? 'warn' : 'ok'}>
              {r.holds.length ? 'Held' : s.status === 'draft' ? 'To approve' : `Approved by ${s.approvedBy}`}
            </Chip>
          </div>
          <dl className="bz-br-ledger">
            <div>
              <dt>Billing</dt>
              <dd>{rm(s.billing)}</dd>
            </div>
            <div>
              <dt>Wages, statutory and other costs</dt>
              <dd>({rm(sp.costs)})</dd>
            </div>
            <div>
              <dt>Branch net</dt>
              <dd>{rm(sp.net)}</dd>
            </div>
            <div className="bz-br-ledger-total">
              <dt>{sp.model === 'B' ? 'Company keeps the whole result' : `Company keeps${sp.pct != null ? ` (${sp.pct}%)` : ''}`}</dt>
              <dd>{rm(sp.companyShare)}</dd>
            </div>
            {sp.model === 'B' ? (
              <div>
                <dt>{r.agreement?.managerKind === 'partner_company' ? 'Partner company fixed amount, by its invoice (in the costs above)' : 'Branch Manager salary, paid through payroll (in the costs above)'}</dt>
                <dd>{s.managerSalary ? rm(s.managerSalary.paid) : s.lines?.length ? 'Not on this month' : 'Test figures, no salary line'}</dd>
              </div>
            ) : (
              <div>
                <dt>Branch Manager</dt>
                <dd>{rm(sp.managerShare)}</dd>
              </div>
            )}
          </dl>
          {r.margin?.low && (
            <div className="notice" data-tone="warn">
              {r.margin.period}: profit {r.margin.pct == null ? 'with no billing' : `${r.margin.pct}% of billing`}, under {r.lowMarginPct}%. Flagged to the CEO.
            </div>
          )}
          {s.managerSalary && s.managerSalary.paid !== s.managerSalary.signed && (
            <div className="notice" data-tone="warn">
              Salary this month {rm(s.managerSalary.paid)} against the signed {rm(s.managerSalary.signed)}: {s.managerSalary.note}
            </div>
          )}
          {sp.shortfall > 0 && (
            <div className="notice" data-tone="warn">
              Shortfall {rm(sp.shortfall)}: costs ran past the manager's part. Wages are paid in full; the company covers it and records it against the manager.
            </div>
          )}
          {r.holds.map((h) => (
            <div key={h} className="notice" data-tone="crit">
              {h}
            </div>
          ))}
          {r.canApprove && <ApproveSettlement id={s.id} />}
          <p className="bz-note">
            {sp.model === 'B'
              ? 'Wages are never held. The manager has no share and the company keeps the result; the Finance Director decides any payout.'
              : 'Wages are never held. A hold stops only the payout of the shares.'}
          </p>
        </section>
      )}
      <section className="bz-sec">
        <div className="bz-sec-head">
          <h3>Branch actions to review</h3>
          {r.queue.length > 0 && <span className="bz-count">{r.queue.length}</span>}
        </div>
        {r.queue.length === 0 && <p className="muted small">Nothing waiting.</p>}
        {r.queue.length > 0 && (
          <ul className="bz-br-list">
            {r.queue.map((q) => (
              <ActionLine key={q.action.id} q={q} canDecide={manager} />
            ))}
          </ul>
        )}
        {r.reviewed.length > 0 && (
          <ul className="bz-br-log">
            {r.reviewed.map((a) => (
              <li key={a.id}>
                {a.title}: {a.status} by {a.reviewedBy}
                {a.note ? ` (${a.note})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
      <MonthsPanel row={r} />
      <section className="bz-sec">
        <div className="bz-sec-head">
          <h3>Agreement</h3>
          {(manager || owner) && (
            <button className="btn btn-sm" aria-expanded={agreementForm} onClick={() => setAgreementForm(!agreementForm)}>
              New signed version
            </button>
          )}
        </div>
        {r.agreement ? (
          <div className="bz-br-card">
            <div className="bz-br-card-top">
              <span>{MODEL[r.agreement.model]}</span>
              <strong className="bz-amt">
                {r.agreement.model === 'A' && (r.agreement.companyBillingSharePct != null ? `${r.agreement.companyBillingSharePct}%` : 'No % signed')}
                {r.agreement.model === 'C' && (r.agreement.companyNetProfitSharePct != null ? `${r.agreement.companyNetProfitSharePct}%` : 'No % signed')}
                {r.agreement.model === 'C' && r.agreement.managerSalary != null && ` + salary ${rm(r.agreement.managerSalary)} a month`}
                {r.agreement.model === 'B' && (r.agreement.managerSalary != null ? `${rm(r.agreement.managerSalary)} a month` : 'No salary signed')}
              </strong>
            </div>
            <div className="bz-sub">
              v{r.agreement.version} from {dateLabel(r.agreement.effectiveFrom)} · {r.agreement.managerName} ({r.agreement.managerKind === 'employee' ? 'employee' : 'partner company'}) ·{' '}
              {r.agreement.signedRef}
            </div>
          </div>
        ) : (
          <p className="muted small">No signed agreement on record.</p>
        )}
        {agreementForm && <AgreementForm branchId={r.branch.id} current={r.agreement} onDone={() => setAgreementForm(false)} />}
        {r.canSetFee && <FeeForm row={r} />}
        {r.canSetSalary && <SalaryForm row={r} />}
      </section>
      {(r.agreement?.model === 'A' || r.agreement?.model === 'C') && <JvPanel row={r} />}
      {r.agreement?.model === 'B' && <SalariedPanel row={r} />}
      <SetupPanel row={r} />
      {r.treasury && <TreasuryPanel row={r} />}
      <BusinessCasePanel row={r} />
      {(r.role === 'manager' || r.role === 'view' || r.role === 'staff') && <ClosePanel row={r} />}
    </Drawer>
  );
}

function ActionLine({ q, canDecide }: { q: Row['queue'][number]; canDecide: boolean }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const a = q.action;
  return (
    <li className="bz-br-item" data-tone={q.level ? 'crit' : 'warn'}>
      <div className="bz-br-item-top">
        <div className="bz-row-main">
          <span className="bz-row-title">{a.title}</span>
          <span className="bz-row-meta">
            {a.control === 'C' ? 'Needs the company first' : 'Done by the branch, company may reverse'} · {a.by} · {dateTimeLabel(a.at)}
            {a.amount != null ? ` · ${rm(a.amount)}` : ''}
          </span>
        </div>
        <Chip tone={q.level ? 'crit' : 'warn'}>{q.level ? `${q.age} days, with ${q.level}` : `${q.age} day${q.age === 1 ? '' : 's'}`}</Chip>
      </div>
      {canDecide && (
        <>
          <div className="bz-br-inline">
            <input className="input" aria-label="Note" placeholder="Comment (needed to accept or reverse)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn btn-sm btn-primary" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.reviewBranchAction(a.id, 'accepted', note), 'Accepted.')}>
              {a.control === 'C' ? 'Approve' : 'Accept'}
            </button>
            <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.reviewBranchAction(a.id, 'reversed', note), 'Reversed.')}>
              {a.control === 'C' ? 'Refuse' : 'Reverse'}
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </>
      )}
    </li>
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
    <div className="bz-act">
      <div className="bz-form">
        <label className="field bz-span">
          <span className="label">Model</span>
          <Select className="select" value={model} onChange={(e) => setModel(e.target.value as BranchModel)}>
            {(['A', 'B', 'C'] as const).map((m) => (
              <option key={m} value={m}>
                {MODEL[m]}
              </option>
            ))}
          </Select>
        </label>
        {model === 'B' ? (
          <label className="field">
            <span className="label">Branch Manager salary, RM a month</span>
            <input className="input" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} />
          </label>
        ) : (
          <label className="field">
            <span className="label">Signed % the company keeps</span>
            <input className="input" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span className="label">Branch Manager</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Manager is</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'employee' | 'partner_company')}>
            <option value="partner_company">Partner company</option>
            <option value="employee">Employee</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Starts on the first day of a month, after the last settled month</span>
          <input id="ag-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field bz-span">
          <span className="label">Signed agreement reference</span>
          <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
      </div>
      <div className="bz-actions">
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
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function ApproveSettlement({ id }: { id: string }) {
  const act = useAction();
  const [note, setNote] = useState('');
  return (
    <div className="bz-act">
      <div className="bz-br-inline">
        <input className="input" aria-label="Approval comment" placeholder="Comment (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || note.trim().length < 3}
          onClick={() => act.run(() => api.approveBranchSettlement(id, note), 'Settlement approved.')}
        >
          Approve settlement
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

const STATES = ['Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya'];

function AddBranch({ companies, onClose }: { companies: BranchBoard['canAdd']; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ companyId: companies[0]?.id ?? '', name: '', state: 'Selangor', model: 'A' as BranchModel });
  return (
    <Drawer title="Propose a new branch" onClose={onClose}>
      <p className="bz-note">
        It starts as proposed. You activate it once the signed agreement, KDN and council references, insurance, the SQL project code and a verified company bank
        account are on record.
      </p>
      <div className="bz-form">
        {companies.length > 1 && (
          <label className="field bz-span">
            <span className="label">Company</span>
            <Select className="select" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="field bz-span">
          <span className="label">Branch name</span>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">State</span>
          <Select className="select" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>
            {STATES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="label">Model</span>
          <Select className="select" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value as BranchModel })}>
            {(['A', 'B', 'C'] as const).map((m) => (
              <option key={m} value={m}>
                {MODEL[m]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="bz-form-foot">
        <button
          className="btn btn-primary"
          disabled={act.busy || f.name.trim().length < 3}
          onClick={async () => {
            if (await act.run(() => api.addBranch(f.companyId, { name: f.name, state: f.state, model: f.model }), 'Branch proposed.')) onClose();
          }}
        >
          Propose
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Drawer>
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
    <section className="bz-sec">
      <div className="bz-sec-head">
        <h3>Papers and accounts</h3>
        <Chip tone={r.status === 'proposed' ? 'warn' : 'ok'}>{r.status === 'proposed' ? 'Proposed' : r.status}</Chip>
      </div>
      {r.activationGaps.length > 0 && (
        <div className="notice" data-tone="warn">
          Before activation: {r.activationGaps.join('; ')}.
        </div>
      )}
      <dl className="bz-br-ledger bz-br-kv">
        <div>
          <dt>KDN approval</dt>
          <dd>{b.setup?.kdnRef ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Premises or council licence</dt>
          <dd>{b.setup?.premisesRef ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Insurance</dt>
          <dd>{b.setup?.insuranceRef ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt>SQL Account project code</dt>
          <dd>{b.setup?.sqlProjectCode ? `${b.setup.sqlProjectCode} (${b.setup.sqlProjectCodeBy})` : 'Finance to set'}</dd>
        </div>
        <div>
          <dt>Legal employer</dt>
          <dd>{b.setup?.legalEmployer ?? 'Not confirmed'}</dd>
        </div>
      </dl>
      {(b.accounts ?? []).length > 0 && (
        <ul className="bz-br-list">
          {(b.accounts ?? []).map((a) => (
            <li key={a.id} className="bz-br-item">
              <div className="bz-br-item-top">
                <div className="bz-row-main">
                  <span className="bz-row-title">{ACCOUNT_KIND[a.kind]}</span>
                  <span className="bz-row-meta">
                    {a.holder}
                    {a.last4 ? ` · ${a.bank} …${a.last4}` : ''}
                  </span>
                </div>
                {a.verifiedBy ? <Chip tone="ok">Verified by {a.verifiedBy}</Chip> : !r.finance && <Chip tone="warn">Finance to verify</Chip>}
              </div>
              {!a.verifiedBy && r.finance && (
                <div className="bz-br-inline">
                  <input className="input" aria-label="Checked against" placeholder="Checked against (bank letter)" value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} />
                  <button
                    className="btn btn-sm"
                    disabled={act.busy || verifyNote.trim().length < 3}
                    onClick={() => act.run(() => api.branchAct(b.id, 'verify_account', { accountId: a.id, note: verifyNote }), 'Account verified.')}
                  >
                    Verify
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {staff && r.status !== 'closed' && (
        <details className="bz-br-more">
          <summary>Record papers</summary>
          <div className="bz-form">
            <label className="field bz-span">
              <span className="label">KDN branch or operating-area approval reference</span>
              <input className="input" value={refs.kdnRef} onChange={(e) => setRefs({ ...refs, kdnRef: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Premises or council licence reference</span>
              <input className="input" value={refs.premisesRef} onChange={(e) => setRefs({ ...refs, premisesRef: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Insurance policy reference</span>
              <input className="input" value={refs.insuranceRef} onChange={(e) => setRefs({ ...refs, insuranceRef: e.target.value })} />
            </label>
          </div>
          <div className="bz-actions">
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.branchAct(b.id, 'setup', refs), 'Papers saved.')}>
              Save papers
            </button>
            {r.role === 'manager' && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.branchAct(b.id, 'setup', { legalEmployerConfirmed: true }), 'Employer confirmed.')}>
                Confirm {r.companyName} is the employer
              </button>
            )}
          </div>
        </details>
      )}
      {staff && r.status !== 'closed' && (
        <details className="bz-br-more">
          <summary>Add an account</summary>
          <div className="bz-form">
            <label className="field bz-span">
              <span className="label">Account type</span>
              <Select className="select" value={acct.kind} onChange={(e) => setAcct({ ...acct, kind: e.target.value })}>
                {Object.entries(ACCOUNT_KIND).map(([k, t]) => (
                  <option key={k} value={k}>
                    {t}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field bz-span">
              <span className="label">Account holder (exact name)</span>
              <input className="input" value={acct.holder} onChange={(e) => setAcct({ ...acct, holder: e.target.value })} />
            </label>
            {acct.kind !== 'project_ledger' && (
              <>
                <label className="field">
                  <span className="label">Bank</span>
                  <input className="input" value={acct.bank} onChange={(e) => setAcct({ ...acct, bank: e.target.value })} />
                </label>
                <label className="field">
                  <span className="label">Last 4 digits only</span>
                  <input className="input" inputMode="numeric" maxLength={4} value={acct.last4} onChange={(e) => setAcct({ ...acct, last4: e.target.value })} />
                </label>
                <label className="field bz-span">
                  <span className="label">Named signatories</span>
                  <input className="input" value={acct.signatories} onChange={(e) => setAcct({ ...acct, signatories: e.target.value })} />
                </label>
              </>
            )}
            {acct.kind === 'partner_entity' && (
              <label className="field bz-span">
                <span className="label">Partner&apos;s SSM registration number</span>
                <input className="input" value={acct.ssmRegNo} onChange={(e) => setAcct({ ...acct, ssmRegNo: e.target.value })} />
              </label>
            )}
          </div>
          <div className="bz-actions">
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.branchAct(b.id, 'add_account', acct), 'Account added; Finance verifies it.')}>
              Add account
            </button>
          </div>
        </details>
      )}
      {r.finance && (
        <div className="bz-br-inline">
          <input className="input" aria-label="SQL Account project code" placeholder="SQL Account project code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn btn-sm" disabled={act.busy || code.trim().length < 2} onClick={() => act.run(() => api.branchAct(b.id, 'project_code', { code }), 'Project code set.')}>
            Set project code
          </button>
        </div>
      )}
      {r.role === 'manager' && r.status === 'proposed' && (
        <div className="bz-act">
          <div className="bz-br-inline">
            <input className="input" aria-label="Activation comment" placeholder="Comment (needed)" value={activateNote} onChange={(e) => setActivateNote(e.target.value)} />
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || r.activationGaps.length > 0 || activateNote.trim().length < 3}
              onClick={() => act.run(() => api.branchAct(b.id, 'activate', { note: activateNote }), 'Branch activated.')}
            >
              Activate branch
            </button>
          </div>
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

/** Model B months: the Finance Director determines and approves the payout after validation (Fauzan, 5 Nov 2026). */
const SALARIED_STATUS_LABEL: Record<string, string> = { validated: 'Validated, Finance Director to decide the payout' };

const LINE_KINDS = ['billing', 'credit_note', 'true_up', ...BRANCH_COST_KINDS] as const;
const LINE_LABEL: Record<string, string> = { billing: 'Invoice billed (excl. SST)', credit_note: 'Credit note (negative)', true_up: 'True-up for an earlier month', ...BRANCH_COST_LABEL };

function MonthsPanel({ row: r }: { row: Row }) {
  const [prep, setPrep] = useState<string | null>(null);
  const canPrepare = (r.role === 'manager' || r.role === 'staff' || r.finance) && ['active', 'step_in', 'terminating'].includes(r.status);
  return (
    <section className="bz-sec">
      <div className="bz-sec-head">
        <h3>Months</h3>
        {canPrepare && (
          <button className="btn btn-sm" aria-expanded={prep !== null} onClick={() => setPrep(prep ? null : '')}>
            Prepare a month
          </button>
        )}
      </div>
      {prep !== null && <PrepareMonth row={r} period={prep} onDone={() => setPrep(null)} />}
      {r.months.length === 0 && <p className="muted small">No months yet.</p>}
      {r.months.length > 0 && (
        <ul className="bz-br-list">
          {r.months.map((m) => (
            <MonthLine key={m.id} row={r} m={m} onCorrect={() => setPrep(m.period)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MonthLine({ row: r, m, onCorrect }: { row: Row; m: Row['months'][number]; onCorrect: () => void }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [bankRef, setBankRef] = useState('');
  const manager = r.role === 'manager';
  const salaried = !!m.noPayout || !!m.payout || r.agreement?.model === 'B';
  const [amount, setAmount] = useState('0');
  const label =
    (salaried && m.status === 'paid' ? (m.payout && m.payout.amount > 0 ? `Payout ${rm(m.payout.amount)} approved by the Finance Director` : 'Closed, nothing paid out') : undefined) ??
    (salaried ? SALARIED_STATUS_LABEL[m.status] : undefined) ??
    STATUS_LABEL[m.status] ??
    m.status;
  return (
    <li className="bz-br-item" data-tone={m.status === 'returned' ? 'crit' : undefined}>
      <div className="bz-br-item-top">
        <div className="bz-row-main">
          <span className="bz-row-title">{m.period}</span>
          <span className="bz-row-meta">
            billing {rm(m.billing)}
            {m.preparedBy ? ` · prepared by ${m.preparedBy}` : ''}
          </span>
        </div>
        <Chip tone={m.status === 'paid' ? 'ok' : m.status === 'returned' ? 'crit' : 'warn'}>{label}</Chip>
      </div>
      {m.legacy && <div className="bz-sub">Test figures: not prepared from SQL Account lines.</div>}
      {(m.lines ?? []).length > 0 && (
        <details className="bz-br-more">
          <summary>
            {m.lines!.length} lines · payroll {m.payrollRef}
          </summary>
          <ul className="bz-br-log">
            {m.lines!.map((l, i) => (
              <li key={i}>
                {LINE_LABEL[l.kind] ?? l.kind}: {l.ref} {rm(l.amount)}
                {l.note ? ` (${l.note})` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {(m.steps ?? []).length > 0 && (
        <ul className="bz-br-log">
          {(m.steps ?? []).map((st, i) => (
            <li key={i}>
              {dateTimeLabel(st.at)} {st.by}: {st.what}
              {st.note ? `. ${st.note}` : ''}
            </li>
          ))}
        </ul>
      )}
      {m.status === 'returned' && (r.role === 'manager' || r.role === 'staff' || r.finance) && (
        <div className="bz-actions">
          <button className="btn btn-sm" onClick={onCorrect}>
            Correct and resubmit
          </button>
        </div>
      )}
      {((m.status === 'draft' && manager) || (m.status === 'approved' && r.finance) || (m.status === 'validated' && (salaried ? r.canDecidePayout : r.finance))) && (
        <div className="bz-act">
          {m.status === 'validated' && salaried && (
            <input className="input" aria-label="Payout amount" placeholder="Payout (RM), 0 when nothing is paid out" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          )}
          {m.status === 'validated' && (!salaried || Number(amount) > 0) && (
            <input className="input" aria-label="Bank reference" placeholder="Bank reference of the payment" value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
          )}
          <input className="input" aria-label="Comment" placeholder="Comment or reason (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="bz-actions">
            {m.status === 'approved' && !m.legacy && (
              <button className="btn btn-sm btn-primary" disabled={act.busy || note.trim().length < 5} onClick={() => act.run(() => api.branchSettlementAct(m.id, 'validate', { note }), 'Validated.')}>
                Agreed to SQL Account
              </button>
            )}
            {m.status === 'validated' && !salaried && (
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || note.trim().length < 3 || bankRef.trim().length < 3}
                onClick={() => act.run(() => api.branchSettlementAct(m.id, 'paid', { bankRef, note }), 'Payment recorded.')}
              >
                Record payment
              </button>
            )}
            {m.status === 'validated' && salaried && (
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || note.trim().length < 3 || amount.trim() === '' || (Number(amount) > 0 && bankRef.trim().length < 3)}
                onClick={() => act.run(() => api.branchSettlementAct(m.id, 'paid', { note, bankRef, amount: Number(amount) }), 'Payout decided.')}
              >
                {Number(amount) > 0 ? 'Approve payout' : 'Close month (nothing paid out)'}
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
    </li>
  );
}

type LineDraft = { kind: string; ref: string; siteId: string; amount: string; note: string };

function PrepareMonth({ row: r, period: initial, onDone }: { row: Row; period: string; onDone: () => void }) {
  const act = useAction();
  const existing = r.months.find((m) => m.period === initial);
  const [period, setPeriod] = useState(initial);
  const [payrollRef, setPayrollRef] = useState(existing?.payrollRef ?? '');
  const salaried = r.agreement?.model === 'B';
  const [salaryNote, setSalaryNote] = useState(existing?.managerSalary?.note ?? '');
  const [lines, setLines] = useState<LineDraft[]>(
    existing?.lines?.map((l) => ({ kind: l.kind, ref: l.ref, siteId: l.siteId ?? '', amount: String(l.amount), note: l.note })) ?? [
      { kind: 'billing', ref: '', siteId: '', amount: '', note: '' },
      { kind: 'wages', ref: '', siteId: '', amount: '', note: '' },
    ],
  );
  const set = (i: number, k: keyof LineDraft, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="bz-act">
      <p className="bz-note">
        Every line cites its SQL Account document (invoice, credit note, bill or journal) or payroll reference. Billing lines name a site of this branch with a signed
        contract; one invoice belongs to one branch month.
      </p>
      <div className="bz-form">
        <label className="field" htmlFor="bm-period">
          <span className="label">Month</span>
          <input id="bm-period" className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Payroll run or JA pay summary reference</span>
          <input className="input" value={payrollRef} onChange={(e) => setPayrollRef(e.target.value)} />
        </label>
        {salaried && (
          <label className="field">
            <span className="label">Why the salary differs</span>
            <input
              className="input"
              aria-label="Why the salary differs"
              placeholder="If the salary differs from the signed amount, say why"
              value={salaryNote}
              onChange={(e) => setSalaryNote(e.target.value)}
            />
          </label>
        )}
      </div>
      {salaried && (
        <p className="bz-note">
          Salaried branch: the month carries the Branch Manager's salary on its own line
          {r.agreement?.managerSalary != null ? ` (signed: ${rm(r.agreement.managerSalary)} a month)` : ''}. It comes from the approved staff pay run, or add a
          &quot;Branch Manager salary&quot; line citing the payroll. Approved purchases that were bought are added by themselves.
        </p>
      )}
      <ol className="bz-br-lines">
        {lines.map((l, i) => (
          <li key={i} className="bz-br-line">
            <Select className="select" aria-label={`Line ${i + 1} kind`} value={l.kind} onChange={(e) => set(i, 'kind', e.target.value)}>
              {LINE_KINDS.filter((k) => salaried || k !== 'manager_salary').map((k) => (
                <option key={k} value={k}>
                  {LINE_LABEL[k]}
                </option>
              ))}
            </Select>
            <input className="input" aria-label={`Line ${i + 1} reference`} placeholder="SQL doc / payroll ref" value={l.ref} onChange={(e) => set(i, 'ref', e.target.value)} />
            {l.kind === 'billing' && (
              <input className="input" aria-label={`Line ${i + 1} site`} placeholder="Site ID" value={l.siteId} onChange={(e) => set(i, 'siteId', e.target.value)} />
            )}
            <input className="input" aria-label={`Line ${i + 1} amount`} placeholder="RM" inputMode="decimal" value={l.amount} onChange={(e) => set(i, 'amount', e.target.value)} />
            <button className="btn btn-sm btn-ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
      </ol>
      <div className="bz-actions">
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
                  ...(salaried ? { salaryNote } : {}),
                }),
              existing ? 'Corrected and resubmitted.' : 'Month prepared.',
            );
            if (ok) onDone();
          }}
        >
          {existing ? 'Resubmit' : 'Submit for approval'}
        </button>
      </div>
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
    <section className="bz-sec">
      <h3>Step-in and closing</h3>
      {!b.stepIn && done.length === 0 && r.status === 'active' && r.role !== 'manager' && <p className="muted small">The company has not stepped in and the branch is not closing.</p>}
      {b.stepIn && (
        <p className="bz-note">
          Company stepped in {dateTimeLabel(b.stepIn.at)} by {b.stepIn.by}: {b.stepIn.reason}
          {b.stepIn.endedAt ? ` · ended ${dateTimeLabel(b.stepIn.endedAt)} by ${b.stepIn.endedBy}` : ''}
        </p>
      )}
      {done.length > 0 && (
        <ul className="bz-br-log">
          {done.map((d) => (
            <li key={d.step}>
              ✓ {TERMINATION_LABEL[d.step]} · {d.by}, {dateTimeLabel(d.at)}: {d.note}
            </li>
          ))}
        </ul>
      )}
      {r.role === 'manager' && r.status !== 'closed' && (
        <div className="bz-act">
          <input className="input" aria-label="Reason or note" placeholder="Reason or note (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="bz-actions">
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
              <button className="btn btn-sm btn-danger" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.branchAct(b.id, 'terminate', { step: next, note }), 'Step recorded.')}>
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
    <label className="field">
      <span className="label">{label}</span>
      <input className="input" inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <section className="bz-sec">
      <div className="bz-sec-head">
        <h3>Business case and 13-week cash</h3>
        {bc ? <Chip tone={bc.reviewedBy ? 'ok' : 'warn'}>{bc.reviewedBy ? `v${bc.version} reviewed` : `v${bc.version} to review`}</Chip> : <Chip tone="warn">None</Chip>}
      </div>
      <p className="bz-note">The company&apos;s own estimates. They are not payments or approvals of spending.</p>
      {bc && (
        <>
          <dl className="bz-br-ledger bz-br-kv">
            <div>
              <dt>Sites and guards expected</dt>
              <dd>
                {bc.sites} sites · {bc.guards} guards
              </dd>
            </div>
            <div>
              <dt>Monthly billing / costs</dt>
              <dd>
                {rm(bc.monthlyBilling)} / {rm(bc.monthlyCosts)}
              </dd>
            </div>
            <div>
              <dt>Start-up cost and funding</dt>
              <dd>
                {rm(bc.startupCost)} · {bc.fundingSource}
              </dd>
            </div>
            <div>
              <dt>Entered by</dt>
              <dd>
                {bc.by} · {dateTimeLabel(bc.at)}
              </dd>
            </div>
            {bc.reviewedBy && (
              <div>
                <dt>Finance review</dt>
                <dd>
                  {bc.reviewedBy}: {bc.reviewNote}
                </dd>
              </div>
            )}
          </dl>
          <p className="bz-br-text">{bc.assumptions}</p>
          <div className="table-wrap">
            <table className="small">
              <thead>
                <tr>
                  <th>Week</th>
                  <th className="num">In</th>
                  <th className="num">Out</th>
                  <th className="num">Cash at end</th>
                </tr>
              </thead>
              <tbody>
                {bc.summary.weeks.map((w) => (
                  <tr key={w.week}>
                    <td>{w.week}</td>
                    <td className="num">{rm(w.inflow)}</td>
                    <td className="num">{rm(w.outflow)}</td>
                    <td className="num" data-short={w.closing < 0 ? 'yes' : undefined}>
                      {rm(w.closing)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bc.summary.firstShortWeek && (
            <div className="notice" data-tone="warn">
              Cash runs short from week {bc.summary.firstShortWeek} (lowest {rm(bc.summary.lowest)}). The Finance review must say how it is covered.
            </div>
          )}
          {r.finance && !bc.reviewedBy && (
            <div className="bz-br-inline">
              <input className="input" aria-label="Business case review comment" placeholder="Review comment (what you checked)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.branchAct(b.id, 'review_business_case', { note }), 'Business case reviewed.')}>
                Mark reviewed
              </button>
            </div>
          )}
        </>
      )}
      {staff && r.status !== 'closed' && r.status !== 'terminating' && (
        <details className="bz-br-more" open={show} onToggle={(e) => setShow((e.target as HTMLDetailsElement).open)}>
          <summary>{bc ? 'Enter a new version' : 'Enter the business case'}</summary>
          <div className="bz-form">
            {field('sites', 'Sites expected')}
            {field('guards', 'Guards expected')}
            {field('monthlyBilling', 'Monthly billing (RM, excl. SST)')}
            {field('monthlyCosts', 'Monthly costs (RM)')}
            {field('startupCost', 'Start-up cost (RM)')}
            {field('openingCash', 'Opening cash (RM)')}
            <label className="field bz-span">
              <span className="label">Where start-up money comes from</span>
              <input className="input" value={f.fundingSource} onChange={(e) => setF({ ...f, fundingSource: e.target.value })} />
            </label>
            <label className="field bz-span">
              <span className="label">Main assumptions: clients, rates, start date</span>
              <textarea className="textarea" value={f.assumptions} onChange={(e) => setF({ ...f, assumptions: e.target.value })} />
            </label>
          </div>
          <div className="table-wrap">
            <table className="small bz-br-weeks">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Money in (RM)</th>
                  <th>Money out (RM)</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w, i) => (
                  <tr key={w.week}>
                    <td>{w.week}</td>
                    <td>
                      <input
                        className="input"
                        aria-label={`Week ${w.week} in`}
                        inputMode="decimal"
                        value={w.inflow}
                        onChange={(e) => setWeeks(weeks.map((x, j) => (j === i ? { ...x, inflow: e.target.value } : x)))}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        aria-label={`Week ${w.week} out`}
                        inputMode="decimal"
                        value={w.outflow}
                        onChange={(e) => setWeeks(weeks.map((x, j) => (j === i ? { ...x, outflow: e.target.value } : x)))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bz-actions">
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
    <section className="bz-sec">
      <div className="bz-sec-head">
        <h3>Branch cash</h3>
        <Chip tone={tone}>{label}</Chip>
      </div>
      <p className="bz-note">Recorded by Finance from the bank statement. Prima does not read the bank or make payments.</p>
      {t.flags.length > 0 && (
        <div className="notice" data-tone={t.state === 'attention' ? 'warn' : undefined}>
          {t.flags.join('; ')}.
        </div>
      )}
      {t.latest && (
        <dl className="bz-br-ledger bz-br-kv">
          <div>
            <dt>Bank balance</dt>
            <dd>
              {rm(t.latest.bankBalance)} on {dateLabel(t.latest.on)} ({t.latest.statementRef})
            </dd>
          </div>
          <div>
            <dt>Cash float held</dt>
            <dd>
              {rm(t.latest.floatHeld)}
              {r.floatLimit ? ` of ${rm(r.floatLimit.amount)} limit` : ''}
            </dd>
          </div>
          <div>
            <dt>Next payroll</dt>
            <dd>{t.latest.payrollDueOn ? `${rm(t.latest.payrollDueAmount ?? 0)} on ${dateLabel(t.latest.payrollDueOn)} (${t.latest.payrollRef})` : 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Other payments due in 7 days</dt>
            <dd>{rm(t.latest.paymentsDue7d)}</dd>
          </div>
        </dl>
      )}
      {r.finance && r.status !== 'closed' && (
        <details className="bz-br-more">
          <summary>Record today&apos;s figures</summary>
          <div className="bz-form">
            <label className="field">
              <span className="label">Statement date</span>
              <input className="input" type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Bank balance (RM)</span>
              <input className="input" inputMode="decimal" value={f.bankBalance} onChange={(e) => setF({ ...f, bankBalance: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Bank statement reference</span>
              <input className="input" value={f.statementRef} onChange={(e) => setF({ ...f, statementRef: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Cash float held (RM)</span>
              <input className="input" inputMode="decimal" value={f.floatHeld} onChange={(e) => setF({ ...f, floatHeld: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Next payroll date</span>
              <input className="input" type="date" value={f.payrollDueOn} onChange={(e) => setF({ ...f, payrollDueOn: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Payroll amount due (RM)</span>
              <input className="input" inputMode="decimal" value={f.payrollDueAmount} onChange={(e) => setF({ ...f, payrollDueAmount: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Payroll run or JA pay summary ref</span>
              <input className="input" value={f.payrollRef} onChange={(e) => setF({ ...f, payrollRef: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Other payments due in 7 days (RM)</span>
              <input className="input" inputMode="decimal" value={f.paymentsDue7d} onChange={(e) => setF({ ...f, paymentsDue7d: e.target.value })} />
            </label>
          </div>
          <div className="bz-actions">
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
        <div className="bz-br-inline">
          <input
            className="input"
            aria-label="Float limit"
            placeholder={r.floatLimit ? `Float limit (now ${rm(r.floatLimit.amount)})` : 'Cash float limit (RM)'}
            inputMode="decimal"
            value={limit.amount}
            onChange={(e) => setLimit({ ...limit, amount: e.target.value })}
          />
          <input className="input" aria-label="Float limit reason" placeholder="Reason" value={limit.reason} onChange={(e) => setLimit({ ...limit, reason: e.target.value })} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !limit.amount.trim() || limit.reason.trim().length < 3}
            onClick={() => act.run(() => api.branchAct(b.id, 'float_limit', { amount: Number(limit.amount), reason: limit.reason }), 'Float limit set.')}
          >
            Set float limit
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

/** The Finance Director sets a Model B or C Branch Manager's monthly salary (Fauzan, 5 Nov 2026). */
function SalaryForm({ row: r }: { row: Row }) {
  const act = useAction();
  const [f, setF] = useState({ effectiveFrom: '', amount: '', reason: '' });
  const now = r.agreement?.managerSalary;
  return (
    <details className="bz-br-more">
      <summary>Set the Branch Manager salary (Finance Director){now != null ? `: now ${rm(now)} a month` : ''}</summary>
      <div className="bz-form">
        <label className="field">
          <span className="label">From month</span>
          <input className="input" type="month" aria-label="Salary from month" value={f.effectiveFrom.slice(0, 7)} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value ? `${e.target.value}-01` : '' })} />
        </label>
        <label className="field">
          <span className="label">Monthly salary (RM)</span>
          <input className="input" aria-label="Monthly salary" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Reason</span>
          <input className="input" aria-label="Salary reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </label>
      </div>
      <p className="bz-note">
        {r.agreement?.model === 'C' ? 'Model C: the salary is a branch cost before the profit split. 0 ends it. ' : ''}Starts on the first day of the month, never in a settled
        month. Update the signed agreement to match.
      </p>
      <div className="bz-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !f.effectiveFrom || f.amount.trim() === '' || f.reason.trim().length < 5}
          onClick={() => act.run(() => api.branchAct(r.branch.id, 'manager_salary', { effectiveFrom: f.effectiveFrom, amount: Number(f.amount), reason: f.reason }), 'Salary set.')}
        >
          Set salary
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </details>
  );
}

/** The CEO sets the company's management fee for a JV branch from a month (Fauzan, 4 Nov 2026). */
function FeeForm({ row: r }: { row: Row }) {
  const act = useAction();
  const [f, setF] = useState({ effectiveFrom: '', pct: '', reason: '' });
  const of = r.agreement?.model === 'A' ? 'billing' : 'net profit';
  return (
    <details className="bz-br-more">
      <summary>Set the management fee (CEO){r.feePct != null ? `: now ${r.feePct}% of ${of}` : ''}</summary>
      <div className="bz-form">
        <label className="field">
          <span className="label">From month</span>
          <input className="input" type="month" aria-label="From month" value={f.effectiveFrom.slice(0, 7)} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value ? `${e.target.value}-01` : '' })} />
        </label>
        <label className="field">
          <span className="label">Company fee, % of {of}</span>
          <input className="input" aria-label="Fee percentage" inputMode="decimal" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Reason</span>
          <input className="input" aria-label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </label>
      </div>
      <p className="bz-note">Starts on the first day of the month, never in a settled month. Update the signed agreement with the Branch Manager to match.</p>
      <div className="bz-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !f.effectiveFrom || f.pct.trim() === '' || f.reason.trim().length < 5}
          onClick={() => act.run(() => api.branchAct(r.branch.id, 'fee', { effectiveFrom: f.effectiveFrom, pct: Number(f.pct), reason: f.reason }), 'Management fee set.')}
        >
          Set fee
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </details>
  );
}

/**
 * A JV branch (Model A or C): its staff, their pay from the company's staff payroll, and what the Branch Manager bought
 * (Fauzan, 4 Nov 2026). The Branch Manager buys from any supplier; the company sees every purchase and may ask about
 * it but does not block it. Firearms and ammunition go through Arms Control.
 */
function JvPanel({ row: r }: { row: Row }) {
  const { data, error } = useLoad(() => api.branchJv(r.branch.id), [r.branch.id]);
  const act = useAction();
  const [f, setF] = useState({ on: '', supplier: '', item: '', kind: 'equipment', amount: '', invoiceRef: '' });
  const [ask, setAsk] = useState<Record<string, string>>({});
  const [pf, setPf] = useState({ personId: '', to: '', effectiveOn: '', reason: '' });
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="branch staff and purchases" />;
  const d: BranchJv = data;
  const pay = d.pay[0] ?? null;
  return (
    <section className="bz-sec">
      <div className="bz-sec-head">
        <h3>JV branch: staff, pay and purchases</h3>
        {d.openQueries > 0 && <Chip tone="warn">{d.openQueries} question{d.openQueries === 1 ? '' : 's'} open</Chip>}
      </div>
      <p className="bz-note">
        The Branch Manager runs this branch: buys from any supplier, sets branch staff pay and decides their leave. The company and HR see the records and may ask
        questions. Staff stay employed by the licensed company. Firearms and ammunition go through Arms Control.
      </p>
      <h4>Staff ({d.staff.length})</h4>
      {d.staff.length ? (
        <ul className="bz-br-log">
          {d.staff.slice(0, 50).map((p) => (
            <li key={p.id}>
              {p.name} <span className="bz-sub">{p.staffNo}</span> · {p.role} · {p.status}
              {p.basicPay != null ? ` · ${rm(p.basicPay)}` : ''}
            </li>
          ))}
          {d.staff.length > 50 && <li className="bz-sub">and {d.staff.length - 50} more</li>}
        </ul>
      ) : (
        <p className="muted small">No staff are tagged to this branch.</p>
      )}
      {d.canSetPay && d.staff.some((p) => p.role === 'office' && p.status === 'active') && (
        <details className="bz-br-more">
          <summary>Set a staff member&apos;s basic pay</summary>
          <div className="bz-form">
            <label className="field">
              <span className="label">Staff member</span>
              <Select className="select" aria-label="Staff member" value={pf.personId} onChange={(e) => setPf({ ...pf, personId: e.target.value })}>
                <option value="">Choose staff</option>
                {d.staff
                  .filter((p) => p.role === 'office' && p.status === 'active')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </label>
            <label className="field">
              <span className="label">New basic pay (RM)</span>
              <input className="input" aria-label="New basic pay" inputMode="decimal" value={pf.to} onChange={(e) => setPf({ ...pf, to: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Pay starts on</span>
              <input className="input" type="date" aria-label="Pay starts on" value={pf.effectiveOn} onChange={(e) => setPf({ ...pf, effectiveOn: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Reason</span>
              <input className="input" aria-label="Pay reason" value={pf.reason} onChange={(e) => setPf({ ...pf, reason: e.target.value })} />
            </label>
          </div>
          <p className="bz-note">Applies without company approval; the company and HR see it. Guard pay stays in the JA app; your own pay goes through the company.</p>
          <div className="bz-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !pf.personId || !pf.to.trim() || !pf.effectiveOn || pf.reason.trim().length < 3}
              onClick={() => act.run(() => api.branchAct(r.branch.id, 'staff_pay', { ...pf, to: Number(pf.to) }), 'Pay set.')}
            >
              Set pay
            </button>
          </div>
        </details>
      )}
      <h4>Staff pay</h4>
      {pay && pay.people ? (
        <>
          <dl className="bz-br-ledger">
            <div className="bz-br-ledger-total">
              <dt>
                {pay.period} ({pay.stage}), {pay.people} staff
              </dt>
              <dd>
                {rm(pay.wages)} + employer {rm(pay.statutory)}
              </dd>
            </div>
            {pay.lines.map((l) => (
              <div key={l.personId}>
                <dt>{l.name}</dt>
                <dd>{rm(l.gross)}</dd>
              </div>
            ))}
          </dl>
          <p className="bz-note">Approved pay is added to the month&apos;s P&amp;L when it is prepared.</p>
        </>
      ) : (
        <p className="muted small">No branch staff in the latest staff pay run.</p>
      )}
      <h4>Purchases</h4>
      {d.purchaseMonths.length > 0 && (
        <p className="bz-note">
          {d.purchaseMonths
            .slice(0, 3)
            .map((m) => `${m.period}: ${rm(m.total)}`)
            .join(' · ')}
        </p>
      )}
      {d.purchases.length ? (
        <ul className="bz-br-list">
          {d.purchases.slice(0, 30).map((p) => {
            const open = p.queries.find((q) => !q.answer);
            return (
              <li key={p.id} className="bz-br-item" data-tone={open ? 'warn' : undefined}>
                <div className="bz-br-item-top">
                  <div className="bz-row-main">
                    <span className="bz-row-title">
                      {p.item} <span className="bz-sub">({p.kind})</span>
                    </span>
                    <span className="bz-row-meta">
                      {dateLabel(p.on)} · {p.supplier} · {p.invoiceRef} · {p.by}
                    </span>
                  </div>
                  <strong className="bz-amt">{rm(p.amount)}</strong>
                </div>
                {p.queries.length > 0 && (
                  <ul className="bz-br-log">
                    {p.queries.map((q, i) => (
                      <li key={i}>
                        Asked by {q.by}: {q.text}
                        {q.answer ? ` · Answer: ${q.answer.text}` : ' · waiting for the Branch Manager'}
                      </li>
                    ))}
                  </ul>
                )}
                {((d.canQuery && !open) || (d.canAnswer && open)) && (
                  <div className="bz-br-inline">
                    <input className="input" aria-label={d.canAnswer ? 'Answer' : 'Question'} placeholder={d.canAnswer ? 'Your answer' : 'Ask about this purchase'} value={ask[p.id] ?? ''} onChange={(e) => setAsk({ ...ask, [p.id]: e.target.value })} />
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || (ask[p.id] ?? '').trim().length < 3}
                      onClick={() => act.run(() => api.branchAct(r.branch.id, d.canAnswer ? 'purchase_answer' : 'purchase_query', { purchaseId: p.id, text: ask[p.id] }), d.canAnswer ? 'Answer sent.' : 'Question sent.')}
                    >
                      {d.canAnswer ? 'Answer' : 'Ask'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">No purchases recorded.</p>
      )}
      {d.canBuy && (
        <details className="bz-br-more">
          <summary>Record a purchase</summary>
          <div className="bz-form">
            <label className="field">
              <span className="label">Invoice date</span>
              <input className="input" type="date" aria-label="Invoice date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Supplier</span>
              <input className="input" aria-label="Supplier" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">What was bought</span>
              <input className="input" aria-label="Item" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Kind</span>
              <Select className="select" aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {d.kinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span className="label">Amount (RM)</span>
              <input className="input" aria-label="Amount" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Supplier invoice number</span>
              <input className="input" aria-label="Invoice reference" value={f.invoiceRef} onChange={(e) => setF({ ...f, invoiceRef: e.target.value })} />
            </label>
          </div>
          <div className="bz-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !f.on || !f.supplier.trim() || !f.item.trim() || !f.amount.trim() || !f.invoiceRef.trim()}
              onClick={() => act.run(() => api.branchAct(r.branch.id, 'purchase', { ...f, amount: Number(f.amount) }), 'Purchase recorded.')}
            >
              Record purchase
            </button>
          </div>
        </details>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

/**
 * A Model B branch (salaried Branch Manager, V12): the company runs it. The manager is the company's employee on the
 * signed salary, and every purchase is approved by the company manager first. Approved purchases count in the month only
 * once the supplier invoice is recorded. Firearms and ammunition go through Arms Control.
 */
function SalariedPanel({ row: r }: { row: Row }) {
  const { data, error } = useLoad(() => api.branchJv(r.branch.id), [r.branch.id]);
  const act = useAction();
  const [f, setF] = useState({ category: 'purchase', supplier: '', item: '', kind: 'equipment', amount: '', quoteRef: '' });
  const exp = f.category === 'expense';
  const [note, setNote] = useState<Record<string, string>>({});
  const [inv, setInv] = useState<Record<string, { on: string; amount: string; invoiceRef: string }>>({});
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="branch purchases" />;
  const d: BranchJv = data;
  const requests = d.purchases.filter((p) => p.approval);
  const STATE: Record<string, string> = {
    awaiting: "Waiting for the company manager's consent",
    consented: 'Consented, waiting for the Finance Director or CEO',
    approved: 'Approved, to buy',
    refused: 'Refused',
    bought: 'Bought',
  };
  return (
    <section className="bz-sec">
      <div className="bz-sec-head">
        <h3>Salaried branch: manager, purchases and expenses</h3>
        {d.awaiting > 0 && <Chip tone="warn">{d.awaiting} to decide</Chip>}
      </div>
      <p className="bz-note">
        The company runs this branch. The Branch Manager is paid a fixed amount
        {d.managerSalary != null ? ` of ${rm(d.managerSalary)} a month` : ''} (an employee through payroll, a partner company by its invoice), with no share of
        the result. Purchases and expenses follow the approval style below, which the Finance Director sets. Staff pay and leave follow the company&apos;s usual
        approvals. Firearms and ammunition go through Arms Control.
      </p>
      <h4>Purchase and expense requests</h4>
      {requests.length ? (
        <ul className="bz-br-list">
          {requests.slice(0, 30).map((p) => {
            const a = p.approval!;
            const i = inv[p.id] ?? { on: '', amount: String(a.quotedAmount), invoiceRef: '' };
            return (
              <li key={p.id} className="bz-br-item" data-tone={d.actionFor[p.id] ? 'warn' : undefined}>
                <div className="bz-br-item-top">
                  <div className="bz-row-main">
                    <span className="bz-row-title">
                      {p.category === 'expense' ? 'Expense: ' : ''}
                      {p.item} <span className="bz-sub">({p.kind})</span>
                    </span>
                    <span className="bz-row-meta">
                      {p.supplier} · {p.category === 'expense' ? 'estimate' : 'quotation'} {a.quoteRef} · asked by {a.requestedBy} {dateLabel(a.requestedAt.slice(0, 10))}
                    </span>
                    <span className="bz-row-meta">
                      {a.status === 'consented' && a.rule ? `Waiting for the ${BRANCH_APPROVER_LABEL[a.rule.approver]}` : (STATE[a.status] ?? a.status)}
                      {a.consentBy ? ` · consent ${a.consentBy}: ${a.consentNote}` : ''}
                      {a.decidedBy && a.decidedById !== a.consentById ? ` · ${a.decidedBy}: ${a.decisionNote}` : ''}
                      {a.status === 'bought' ? ` · invoice ${p.invoiceRef} on ${dateLabel(p.on)}` : ''}
                    </span>
                  </div>
                  <strong className="bz-amt">{rm(a.status === 'bought' ? p.amount : a.quotedAmount)}</strong>
                </div>
                {d.actionFor[p.id] && (
                  <div className="bz-br-inline">
                    <input className="input" aria-label="Decision comment" placeholder="Comment or reason (needed)" value={note[p.id] ?? ''} onChange={(e) => setNote({ ...note, [p.id]: e.target.value })} />
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={act.busy || (note[p.id] ?? '').trim().length < 3}
                      onClick={() =>
                        act.run(
                          () =>
                            a.status === 'awaiting'
                              ? api.branchAct(r.branch.id, 'purchase_consent', { purchaseId: p.id, consent: true, note: note[p.id] })
                              : api.branchAct(r.branch.id, 'purchase_decide', { purchaseId: p.id, approve: true, note: note[p.id] }),
                          a.status === 'awaiting' ? 'Consent given.' : 'Approved.',
                        )
                      }
                    >
                      {a.status === 'awaiting' ? 'Consent' : 'Approve'}
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || (note[p.id] ?? '').trim().length < 3}
                      onClick={() =>
                        act.run(
                          () =>
                            a.status === 'awaiting'
                              ? api.branchAct(r.branch.id, 'purchase_consent', { purchaseId: p.id, consent: false, note: note[p.id] })
                              : api.branchAct(r.branch.id, 'purchase_decide', { purchaseId: p.id, approve: false, note: note[p.id] }),
                          a.status === 'awaiting' ? 'Declined.' : 'Refused.',
                        )
                      }
                    >
                      {a.status === 'awaiting' ? 'Decline' : 'Refuse'}
                    </button>
                  </div>
                )}
                {a.status === 'approved' && d.canRecordBought && (
                  <div className="bz-br-inline">
                    <input className="input" type="date" aria-label="Invoice date" value={i.on} onChange={(e) => setInv({ ...inv, [p.id]: { ...i, on: e.target.value } })} />
                    <input className="input" aria-label="Invoiced amount" inputMode="decimal" placeholder="Invoiced amount (RM)" value={i.amount} onChange={(e) => setInv({ ...inv, [p.id]: { ...i, amount: e.target.value } })} />
                    <input className="input" aria-label="Invoice number" placeholder={p.category === 'expense' ? 'Invoice or receipt number' : 'Supplier invoice number'} value={i.invoiceRef} onChange={(e) => setInv({ ...inv, [p.id]: { ...i, invoiceRef: e.target.value } })} />
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={act.busy || !i.on || !i.amount.trim() || i.invoiceRef.trim().length < 2}
                      onClick={() => act.run(() => api.branchAct(r.branch.id, 'purchase_bought', { purchaseId: p.id, on: i.on, amount: Number(i.amount), invoiceRef: i.invoiceRef }), 'Invoice recorded.')}
                    >
                      Record invoice
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">No purchase or expense requests.</p>
      )}
      <ApprovalStyle row={r} d={d} />
      {d.canRequest && (
        <details className="bz-br-more">
          <summary>Ask the company for a purchase or an expense</summary>
          <div className="bz-form">
            <label className="field">
              <span className="label">Purchase or expense</span>
              <select className="select" aria-label="Purchase or expense" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                <option value="purchase">Purchase (goods to buy)</option>
                <option value="expense">Expense (a service or cost to pay)</option>
              </select>
            </label>
            <label className="field">
              <span className="label">{exp ? 'Who is to be paid' : 'Supplier'}</span>
              <input className="input" aria-label="Supplier" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">{exp ? 'What the expense is for' : 'What is to be bought'}</span>
              <input className="input" aria-label="Item" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Kind</span>
              <Select className="select" aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {d.kinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span className="label">{exp ? 'Estimated amount (RM)' : 'Quoted amount (RM)'}</span>
              <input className="input" aria-label="Quoted amount" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">{exp ? 'Quotation or estimate reference' : 'Supplier quotation number'}</span>
              <input className="input" aria-label="Quotation number" value={f.quoteRef} onChange={(e) => setF({ ...f, quoteRef: e.target.value })} />
            </label>
          </div>
          <div className="bz-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !f.supplier.trim() || !f.item.trim() || !f.amount.trim() || !f.quoteRef.trim()}
              onClick={() => act.run(() => api.branchAct(r.branch.id, 'purchase_request', { ...f, amount: Number(f.amount) }), 'Request sent to the company manager.')}
            >
              Send request
            </button>
          </div>
        </details>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

/** The Model B approval style in force, and the Finance Director's form to change it (Fauzan, 5 Nov 2026). */
function ApprovalStyle({ row: r, d }: { row: Row; d: BranchJv }) {
  const act = useAction();
  const p = d.approvalPolicy;
  const [f, setF] = useState({
    purchase: { ...p.purchase, noApprovalUpTo: String(p.purchase.noApprovalUpTo) },
    expense: { ...p.expense, noApprovalUpTo: String(p.expense.noApprovalUpTo) },
    payout: p.payout as string,
    reason: '',
  });
  const say = (x: typeof p.purchase) =>
    `${x.consent === 'company_manager' ? 'company manager consents, then ' : ''}${BRANCH_APPROVER_LABEL[x.approver]} approves${x.noApprovalUpTo > 0 ? `; no approval needed up to ${rm(x.noApprovalUpTo)}` : ''}`;
  const rule = (k: 'purchase' | 'expense', label: string) => (
    <>
      <label className="field">
        <span className="label">{label}: consent step</span>
        <select className="select" aria-label={`${label} consent step`} value={f[k].consent} onChange={(e) => setF({ ...f, [k]: { ...f[k], consent: e.target.value } })}>
          <option value="company_manager">Company manager consents first</option>
          <option value="none">No consent step</option>
        </select>
      </label>
      <label className="field">
        <span className="label">{label}: approver</span>
        <Select className="select" aria-label={`${label} approver`} value={f[k].approver} onChange={(e) => setF({ ...f, [k]: { ...f[k], approver: e.target.value } })}>
          {Object.entries(BRANCH_APPROVER_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l} approves
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span className="label">{label}: no approval needed up to (RM), 0 for none</span>
        <input className="input" aria-label={`${label} no-approval limit`} inputMode="decimal" value={f[k].noApprovalUpTo} onChange={(e) => setF({ ...f, [k]: { ...f[k], noApprovalUpTo: e.target.value } })} />
      </label>
    </>
  );
  return (
    <>
      <h4>Approval style</h4>
      <ul className="bz-br-log">
        <li>Purchases: {say(p.purchase)}.</li>
        <li>Expenses: {say(p.expense)}.</li>
        <li>Payout decided by the {p.payout === 'fd' ? 'Finance Director' : 'Finance Director or CEO'}.</li>
        <li>{d.approvalPolicySet ? `Set by ${d.approvalPolicySet.by}: ${d.approvalPolicySet.reason}` : 'Default style; the Finance Director can change it.'}</li>
      </ul>
      {d.canSetApproval && (
        <details className="bz-br-more">
          <summary>Change the approval style (Finance Director)</summary>
          <div className="bz-form">
            {rule('purchase', 'Purchases')}
            {rule('expense', 'Expenses')}
            <label className="field">
              <span className="label">Payout decided by</span>
              <select className="select" aria-label="Payout decided by" value={f.payout} onChange={(e) => setF({ ...f, payout: e.target.value })}>
                <option value="fd">Finance Director decides the payout</option>
                <option value="fd_or_ceo">Finance Director or CEO decides the payout</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Reason</span>
              <input className="input" aria-label="Approval style reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            </label>
          </div>
          <p className="bz-note">Applies to new requests. Requests already sent keep the style they were sent with. Nobody approves their own request.</p>
          <div className="bz-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || f.reason.trim().length < 5}
              onClick={() =>
                act.run(
                  () =>
                    api.branchAct(r.branch.id, 'approval_style', {
                      purchase: { ...f.purchase, noApprovalUpTo: Number(f.purchase.noApprovalUpTo || 0) },
                      expense: { ...f.expense, noApprovalUpTo: Number(f.expense.noApprovalUpTo || 0) },
                      payout: f.payout,
                      reason: f.reason,
                    }),
                  'Approval style set.',
                )
              }
            >
              Save approval style
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </details>
      )}
    </>
  );
}
