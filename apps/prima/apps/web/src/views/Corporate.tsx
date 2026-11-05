import { useState } from 'react';
import { CalendarCheckIcon, CalendarXIcon, GavelIcon, ReceiptIcon } from '@phosphor-icons/react';
import type { CorpChangeKind } from '@prima/core';
import { api, type CorpBoard } from '../api';
import { AuditLegalKpis, AuditPanel, LegalPanel } from './AuditLegal';
import { CompanyFilePanel } from './CompanyFile';
import { PanelFirmsPanel } from './PanelFirms';
import { DelegationsPanel } from './Delegations';
import { LegalHoldsPanel } from './LegalHolds';
import { Card, Empty, PageHead, Stat, Stats, Steps, Toolbar, type StepState } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import { CentralAdminGuide } from './CentralAdminGuide';
import '../styles/gov.css';

/**
 * Company secretary (V9). Each company keeps its own licensed secretary, filings and board. Head office Corporate Admin
 * (the Deputy Chief of Staff) records each filing here; the company and the company secretary view them (Central Admin
 * 5A, Fauzan 1 Nov 2026). Any change to a company's corporate structure needs PWVSB approval (the Deputy Chief of Staff,
 * with a reason), citing the signed clause, before the board acts (Fauzan, 24 Oct 2026). Prima never lodges, signs or files.
 */

type Tab = 'filings' | 'changes' | 'audit' | 'legal' | 'companies' | 'files' | 'panel' | 'delegations';
type FilingRow = CorpBoard['filings'][number];
type ChangeRow = CorpBoard['changes'][number];

const CHANGE: Record<CorpChangeKind, string> = {
  DIRECTOR: 'Directors',
  SHARES: 'Shares',
  BENEFICIAL_OWNER: 'Beneficial owners',
  CONSTITUTION: 'Constitution',
  SECRETARY_AUDITOR: 'Secretary or auditor',
  CHARGE: 'Charges',
  KDN_DETAILS: 'KDN licence details',
  BANK_SIGNATORY: 'Bank signatories',
  MERGER_DISSOLUTION: 'Merger or dissolution',
};
const CHANGE_STATUS: Record<ChangeRow['change']['status'], ['warn' | 'info' | 'crit' | 'ok', string]> = {
  awaiting_pwvsb: ['warn', 'Waiting for PWVSB'],
  approved: ['info', 'Approved, board to act'],
  rejected: ['crit', 'Rejected by PWVSB'],
  board_done: ['ok', 'Board resolution recorded'],
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function CorporateView() {
  const { data, error } = useLoad(() => api.corpBoard(), []);
  const al = useLoad(() => api.corpAuditLegal().catch(() => null), []);
  const [tab, setTab] = useState<Tab>('filings');
  if (error && al.data) return <AuditLegalOnly data={al.data} />;
  if (error && !al.loading)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="company secretary" />
      </div>
    );
  const k = data.kpis;
  return (
    <div className="page gv-page">
      <PageHead
        title="Company secretary"
        sub="Each company keeps its own licensed secretary, filings and board. The secretary lodges in MBRS and the company records it here; a filing stays awaiting acknowledgement until the SSM receipt is recorded. Any change to a company's structure needs PWVSB approval before the board acts."
      >
        <p className="notice" data-tone="info">
          Test data. Deadlines follow the Companies Act 2016 and are for the secretaries to confirm.
        </p>
      </PageHead>
      <Stats>
        <Stat
          label="Filings overdue"
          value={k.overdue}
          tone={k.overdue ? 'crit' : 'ok'}
          icon={<CalendarXIcon size={16} />}
          onClick={() => setTab('filings')}
        />
        <Stat
          label={`Due in ${data.rule.warnDays} days`}
          value={k.dueSoon}
          tone={k.dueSoon ? 'warn' : 'ok'}
          icon={<CalendarCheckIcon size={16} />}
          onClick={() => setTab('filings')}
        />
        <Stat
          label="Waiting for SSM receipt"
          value={k.awaitingReceipt}
          tone={k.awaitingReceipt ? 'info' : 'ok'}
          icon={<ReceiptIcon size={16} />}
          onClick={() => setTab('filings')}
        />
        <Stat
          label="Changes waiting for PWVSB"
          value={k.changesAwaiting}
          tone={k.changesAwaiting ? 'warn' : 'ok'}
          note={k.boardPending ? `${k.boardPending} for the board` : undefined}
          icon={<GavelIcon size={16} />}
          onClick={() => setTab('changes')}
        />
      </Stats>
      <div className="tabbar" role="tablist" aria-label="Company secretary">
        {(
          [
            ['filings', 'Filings'],
            ['changes', 'Corporate changes'],
            ['audit', 'Audit'],
            ['legal', 'Legal matters'],
            ['companies', 'Companies'],
            ['files', 'Company files'],
            ['panel', 'Panel firms'],
            ['delegations', 'Delegations'],
          ] as [Tab, string][]
        )
          .filter(([t]) => (t !== 'audit' && t !== 'legal') || al.data)
          .map(([t, l]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {l}
            </button>
          ))}
      </div>
      {(tab === 'files' || tab === 'panel' || tab === 'delegations') && <CentralAdminGuide view="corporate" tab={tab} />}
      {tab === 'filings' && <Filings data={data} />}
      {tab === 'changes' && <Changes data={data} />}
      {tab === 'audit' && al.data && <AuditPanel data={al.data} />}
      {tab === 'legal' && al.data && (
        <div className="gv-stack">
          <LegalPanel data={al.data} />
          <LegalHoldsPanel />
        </div>
      )}
      {tab === 'companies' && <Companies data={data} />}
      {tab === 'files' && <CompanyFilePanel />}
      {tab === 'panel' && <PanelFirmsPanel />}
      {tab === 'delegations' && <DelegationsPanel />}
    </div>
  );
}

/** PWVSB legal sees the audit and legal tabs only, not filings or structure changes. */
function AuditLegalOnly({ data }: { data: NonNullable<Awaited<ReturnType<typeof api.corpAuditLegal>>> }) {
  const [tab, setTab] = useState<'legal' | 'audit' | 'panel'>('legal');
  return (
    <div className="page gv-page">
      <PageHead title="Audit and legal" sub="Each company runs its own audit and keeps its own lawyers. PWVSB legal follows every matter with the company.">
        <p className="notice" data-tone="info">
          Test data.
        </p>
      </PageHead>
      <AuditLegalKpis data={data} />
      <div className="tabbar" role="tablist" aria-label="Audit and legal">
        <button role="tab" aria-selected={tab === 'legal'} onClick={() => setTab('legal')}>
          Legal matters
        </button>
        <button role="tab" aria-selected={tab === 'audit'} onClick={() => setTab('audit')}>
          Audit
        </button>
        <button role="tab" aria-selected={tab === 'panel'} onClick={() => setTab('panel')}>
          Panel firms
        </button>
      </div>
      {tab === 'legal' ? (
        <div className="gv-stack">
          <LegalPanel data={data} />
          <LegalHoldsPanel />
        </div>
      ) : tab === 'audit' ? (
        <AuditPanel data={data} />
      ) : (
        <PanelFirmsPanel />
      )}
    </div>
  );
}

/** The filings calendar: grouped by the month they fall due, with each company's filings filterable. */
function Filings({ data }: { data: CorpBoard }) {
  const [all, setAll] = useState(false);
  const [company, setCompany] = useState('');
  const companies = [...new Set(data.filings.map((f) => f.companyName))].sort((a, b) => a.localeCompare(b));
  const rows = data.filings
    .filter((f) => all || f.tone !== 'ok')
    .filter((f) => !company || f.companyName === company)
    .slice(0, 100)
    .sort((a, b) => a.filing.dueOn.localeCompare(b.filing.dueOn));
  const months: [string, FilingRow[]][] = [];
  for (const r of rows) {
    const m = r.filing.dueOn.slice(0, 7);
    const last = months[months.length - 1];
    if (last && last[0] === m) last[1].push(r);
    else months.push([m, [r]]);
  }
  return (
    <div className="gv-stack-sm">
      <Toolbar
        end={
          <div className="seg" role="group" aria-label="Which filings">
            <button aria-pressed={!all} onClick={() => setAll(false)}>
              Open
            </button>
            <button aria-pressed={all} onClick={() => setAll(true)}>
              All, with completed
            </button>
          </div>
        }
      >
        <select className="select gv-filter" aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Toolbar>
      <Card title="SSM filings" sub={`${rows.length} filing${rows.length === 1 ? '' : 's'}${all ? '' : ' still open'}, by the month they fall due`} flush>
        {!rows.length && <Empty title="Nothing open." />}
        <ul className="gv-list">
          {months.map(([m, list]) => (
            <li key={m} className="gv-group-li">
              <div className="gv-group">
                <span>
                  {MONTHS[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}
                </span>
                <span>
                  {list.length} filing{list.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="gv-list">
                {list.map((f) => (
                  <li key={f.filing.id}>
                    <FilingLine f={f} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function FilingLine({ f: row }: { f: FilingRow }) {
  const act = useAction();
  const [ref, setRef] = useState('');
  const f = row.filing;
  // Head office Corporate Admin (the Deputy Chief of Staff) records filings; the company and the secretary view them.
  const works = row.role === 'owner';
  const order = ['open', 'prepared', 'lodged', 'acknowledged'] as const;
  const at = order.indexOf(f.status);
  const st = (i: number): StepState => (at > i ? 'done' : at === i ? 'now' : 'todo');
  const tone = row.tone === 'crit' ? 'crit' : row.tone === 'warn' ? 'warn' : undefined;
  return (
    <div className="gv-item" data-tone={tone}>
      <div className="gv-item-head gv-with-date">
        <span className="gv-date" data-tone={tone} aria-label={`Due ${dateLabel(f.dueOn)}`}>
          <b>{Number(f.dueOn.slice(8, 10))}</b>
          <span>{MON[Number(f.dueOn.slice(5, 7)) - 1]}</span>
        </span>
        <div className="gv-item-main">
          <div className="gv-item-title">
            <span className="gv-co">{row.companyName}:</span> {f.title}
          </div>
          <div className="gv-item-meta">
            Due {dateLabel(f.dueOn)} · {f.basis}
            {f.prepared && !f.lodged ? ` · prepared by ${f.prepared.by}` : ''}
            {f.lodged ? ` · lodged ${dateLabel(f.lodged.on)} (${f.lodged.ref})${row.lodgedLate ? ', late' : ''}` : ''}
            {f.receipt ? ` · receipt ${f.receipt.ref}` : ''}
          </div>
        </div>
        <div className="gv-item-state">
          <Chip tone={row.tone}>{row.label}</Chip>
        </div>
      </div>
      <Steps
        steps={[
          { label: 'Papers ready', state: st(0), note: f.prepared ? f.prepared.by : undefined },
          { label: 'Lodged in MBRS', state: st(1), note: f.lodged ? f.lodged.ref : undefined },
          { label: 'SSM receipt', state: f.status === 'acknowledged' ? 'done' : st(2), note: f.receipt ? f.receipt.ref : undefined },
        ]}
      />
      {works && f.status !== 'acknowledged' && (
        <div className="gv-box">
          {f.status === 'open' ? (
            <div className="gv-btns">
              <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.corpFilingStep(f.id, 'prepare', {}), 'Marked prepared.')}>
                Papers ready for the secretary
              </button>
            </div>
          ) : (
            <div className="gv-inline">
              <input
                className="input"
                aria-label="Reference"
                placeholder={f.status === 'lodged' ? 'SSM receipt number' : 'MBRS lodgement reference from the secretary'}
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
              {f.status === 'prepared' && (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || !ref.trim()}
                  onClick={() => act.run(() => api.corpFilingStep(f.id, 'lodge', { ref }), 'Lodgement recorded.')}
                >
                  Secretary lodged it
                </button>
              )}
              {f.status === 'lodged' && (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || !ref.trim()}
                  onClick={() => act.run(() => api.corpFilingStep(f.id, 'receipt', { ref }), 'SSM receipt recorded.')}
                >
                  Record SSM receipt
                </button>
              )}
            </div>
          )}
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
  );
}

function Changes({ data }: { data: CorpBoard }) {
  const mine = data.companies.filter((c) => c.role === 'manager' || c.role === 'owner');
  const [form, setForm] = useState(false);
  return (
    <Card
      title="Corporate changes"
      flush
      actions={
        mine.length > 0 && (
          <button className="btn btn-sm btn-primary" aria-expanded={form} onClick={() => setForm(!form)}>
            Ask PWVSB to approve a change
          </button>
        )
      }
    >
      <div className="gv-card-intro">
        <p>
          The company manager asks, the Deputy Chief of Staff approves for PWVSB with a reason and the signed clause (the Chief of Staff monitors), then the
          board acts and head office Corporate Admin files with SSM within {data.rule.changeFileDays} days. Statutory deadlines are never held back.
        </p>
        {form && <ChangeForm companies={mine} onDone={() => setForm(false)} />}
      </div>
      {!data.changes.length && <Empty title="No corporate changes." />}
      <ul className="gv-list">
        {data.changes.map((c) => (
          <li key={c.change.id}>
            <ChangeLine c={c} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ChangeLine({ c: row }: { c: ChangeRow }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [clause, setClause] = useState('');
  const [ref, setRef] = useState('');
  const [on, setOn] = useState('');
  const c = row.change;
  const [tone, label] = CHANGE_STATUS[c.status];
  const decided: StepState = c.status === 'awaiting_pwvsb' ? 'now' : c.status === 'rejected' ? 'stopped' : 'done';
  const board: StepState = c.status === 'board_done' ? 'done' : c.status === 'approved' ? 'now' : 'todo';
  const filed: StepState = row.filing ? (row.filing.status === 'acknowledged' ? 'done' : 'now') : 'todo';
  return (
    <div className="gv-item" data-tone={tone === 'crit' ? 'crit' : tone === 'warn' ? 'warn' : undefined}>
      <div className="gv-item-head">
        <div className="gv-item-main">
          <div className="gv-item-title">
            <span className="gv-co">{row.companyName}:</span> {c.title}
          </div>
          <div className="gv-item-meta">
            {CHANGE[c.kind]} · asked by {c.raisedBy} {dateTimeLabel(c.at)}
            {c.pwvsb ? ` · PWVSB: ${c.pwvsb.by} under ${c.pwvsb.clauseRef}${c.pwvsb.note ? ` (${c.pwvsb.note})` : ''}` : ''}
            {c.board ? ` · board ${c.board.resolutionRef}, effective ${dateLabel(c.board.effectiveOn)}` : ''}
            {row.filing ? ` · SSM filing due ${dateLabel(row.filing.dueOn)}, ${row.filing.status}` : ''}
          </div>
        </div>
        <div className="gv-item-state">
          <Chip tone={tone}>{label}</Chip>
        </div>
      </div>
      <Steps
        steps={[
          { label: 'Asked', state: 'done', note: c.raisedBy },
          { label: 'PWVSB decision', state: decided, note: c.pwvsb ? c.pwvsb.by : undefined },
          { label: 'Board resolution', state: board, note: c.board ? c.board.resolutionRef : undefined },
          { label: 'Filed with SSM', state: filed, note: row.filing ? `Due ${dateLabel(row.filing.dueOn)}` : undefined },
        ]}
      />
      {row.canDecide && (
        <div className="gv-box">
          <div className="gv-box-title">Decide for PWVSB</div>
          <div className="gv-form">
            <label className="field">
              <span className="label">Signed clause</span>
              <input
                className="input"
                aria-label="Clause"
                placeholder="Signed clause giving PWVSB this approval"
                value={clause}
                onChange={(e) => setClause(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">Reason</span>
              <input className="input" aria-label="Reason" placeholder="Reason (always required)" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className="gv-form-foot">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !clause.trim() || !note.trim()}
              onClick={() => act.run(() => api.decideCorpChange(c.id, 'approve', note, clause), 'Approved for PWVSB.')}
            >
              Approve
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || !clause.trim() || !note.trim()}
              onClick={() => act.run(() => api.decideCorpChange(c.id, 'reject', note, clause), 'Rejected.')}
            >
              Reject
            </button>
          </div>
        </div>
      )}
      {row.canRecordBoard && (
        <div className="gv-box">
          <div className="gv-box-title">Record the board resolution</div>
          <div className="gv-form">
            <label className="field">
              <span className="label">Resolution reference</span>
              <input className="input" aria-label="Resolution" placeholder="Board resolution reference" value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Effective date</span>
              <input className="input" type="date" aria-label="Effective date" value={on} onChange={(e) => setOn(e.target.value)} />
            </label>
          </div>
          <div className="gv-form-foot">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !ref.trim() || !on}
              onClick={() => act.run(() => api.recordCorpBoard(c.id, ref, on), 'Board resolution recorded; SSM filing opened.')}
            >
              Record board resolution
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function ChangeForm({ companies, onDone }: { companies: CorpBoard['companies']; onDone: () => void }) {
  const act = useAction();
  const [companyId, setCompanyId] = useState(companies[0].profile.companyId);
  const [kind, setKind] = useState<CorpChangeKind>('DIRECTOR');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  return (
    <div className="gv-box" aria-label="Ask PWVSB to approve a change">
      <div className="gv-form">
        {companies.length > 1 && (
          <label className="field">
            <span className="label">Company</span>
            <select className="select" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.map((c) => (
                <option key={c.profile.companyId} value={c.profile.companyId}>
                  {c.companyName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="label">What changes</span>
          <select className="select" aria-label="What changes" value={kind} onChange={(e) => setKind(e.target.value as CorpChangeKind)}>
            {(Object.keys(CHANGE) as CorpChangeKind[]).map((x) => (
              <option key={x} value={x}>
                {CHANGE[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="field gv-span">
          <span className="label">Change</span>
          <input className="input" aria-label="Change" placeholder="What the change is" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field gv-span">
          <span className="label">Details</span>
          <textarea className="textarea" aria-label="Details" placeholder="Details (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="gv-form-foot">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !title.trim()}
          onClick={() => act.run(() => api.raiseCorpChange(companyId, { kind, title, detail }), 'Sent to PWVSB.').then((r) => r && onDone())}
        >
          Send to PWVSB
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Companies({ data }: { data: CorpBoard }) {
  return (
    <Card title="Companies" sub={`${data.companies.length} compan${data.companies.length === 1 ? 'y' : 'ies'}`} flush>
      {!data.companies.length && <Empty title="No companies." />}
      {data.companies.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Registration</th>
                <th>Incorporated</th>
                <th>Year end month</th>
                <th>Secretary</th>
                <th>Auditor</th>
                <th className="num">Directors</th>
                <th>Filings</th>
              </tr>
            </thead>
            <tbody>
              {data.companies.map((c) => (
                <tr key={c.profile.id}>
                  <td>
                    <strong>{c.companyName}</strong>
                  </td>
                  <td className="mono small">{c.profile.regNo}</td>
                  <td className="small">{dateLabel(c.profile.incorporatedOn)}</td>
                  <td className="small">{c.profile.fyeMonth}</td>
                  <td className="small">{c.profile.secretaryFirm}</td>
                  <td className="small">{c.profile.auditor}</td>
                  <td className="num">{c.profile.directors.length}</td>
                  <td>
                    <Chip tone={c.worst}>{c.open ? `${c.open} open` : 'In order'}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
