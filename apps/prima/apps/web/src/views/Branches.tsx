import { useState } from 'react';
import type { BranchModel } from '@prima/core';
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
          agreement and reviews every branch action. Figures are test data until SQL Account project codes are read.
        </p>
      </div>
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
                  <Chip tone={r.holds.length ? 'crit' : r.canApprove ? 'warn' : 'ok'}>
                    {r.holds.length ? 'Held' : r.canApprove ? 'To approve' : r.settlement?.status === 'approved' ? 'Approved' : 'In order'}
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
  const [agreementForm, setAgreementForm] = useState(false);
  const s = r.settlement;
  const sp = r.split;
  const manager = r.role === 'manager';
  return (
    <Drawer title={r.branch.name} sub={`${r.companyName} · ${r.sites} sites · ${r.liveContracts} live contracts`} onClose={onClose}>
      <ErrorNotice error={act.error} />
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
          {r.canApprove && (
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy}
              onClick={() => act.run(() => api.approveBranchSettlement(s.id), 'Settlement approved.')}
            >
              Approve settlement
            </button>
          )}
          <p className="muted small">Wages are never held. A hold stops only the payout of the shares.</p>
        </section>
      )}
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
