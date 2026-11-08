import { Select } from '../SearchSelect';
import { useState } from 'react';
import { CalendarCheckIcon, CalendarXIcon, GavelIcon, PlusIcon, ReceiptIcon } from '@phosphor-icons/react';
import type { CorpChangeKind, CorpFilingKind } from '@prima/core';
import { api, type CorpBoard } from '../api';
import { AuditLegalKpis, AuditPanel, LegalPanel } from './AuditLegal';
import { CompanyFilePanel } from './CompanyFile';
import { PanelFirmsPanel } from './PanelFirms';
import { DelegationsPanel } from './Delegations';
import { LegalHoldsPanel } from './LegalHolds';
import { Card, Empty, PageHead, Stat, Stats, Steps, Toolbar, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
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
const FILING_KIND: Record<CorpFilingKind, string> = {
  ANNUAL_RETURN: 'Annual return',
  FINANCIAL_STATEMENTS: 'Financial statements',
  DIRECTOR_CHANGE: 'Change of directors',
  BO_CHANGE: 'Change of beneficial owners',
  SHARE_CHANGE: 'Change of shares',
  OTHER: 'Other SSM lodgement',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function CorporateView() {
  const { data, error } = useLoad(() => api.corpBoard(), []);
  const al = useLoad(() => api.corpAuditLegal().catch(() => null), []);
  const [tab, setTab] = useState<Tab>('filings');
  const [adding, setAdding] = useState<'filing' | 'change' | null>(null);
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
  const addFiling = () => {
    setTab('filings');
    setAdding('filing');
  };
  const addChange = () => {
    setTab('changes');
    setAdding('change');
  };
  return (
    <div className="page gv-page">
      <PageHead
        title="Company secretary"
        sub="Each company keeps its own licensed secretary, filings and board. The secretary lodges in MBRS and the company records it here; a filing stays awaiting acknowledgement until the SSM receipt is recorded. Any change to a company's structure needs PWVSB approval before the board acts."
        actions={
          data.canFile.length > 0 || data.canRaise.length > 0 ? (
            <>
              {data.canRaise.length > 0 && (
                <button className="btn" onClick={addChange}>
                  <PlusIcon size={16} /> Ask for a change
                </button>
              )}
              {data.canFile.length > 0 && (
                <button className="btn btn-primary" onClick={addFiling}>
                  <PlusIcon size={16} /> Add filing
                </button>
              )}
            </>
          ) : undefined
        }
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
      {tab === 'filings' && <Filings data={data} onAdd={addFiling} />}
      {tab === 'changes' && <Changes data={data} onAdd={addChange} />}
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
      {adding === 'filing' && (
        <Drawer
          title="Add a filing"
          sub="An SSM lodgement with its due date. Then mark the papers ready, record the MBRS lodgement reference, and record the SSM receipt."
          onClose={() => setAdding(null)}
        >
          <FilingForm companies={data.canFile} onDone={() => setAdding(null)} />
        </Drawer>
      )}
      {adding === 'change' && (
        <Drawer
          title="Ask PWVSB to approve a change"
          sub="A change to a company's directors, shares, owners or other corporate details. The Deputy Chief of Staff decides for PWVSB, then the board acts and the SSM filing opens."
          onClose={() => setAdding(null)}
        >
          <ChangeForm companies={data.canRaise} onDone={() => setAdding(null)} />
        </Drawer>
      )}
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
function Filings({ data, onAdd }: { data: CorpBoard; onAdd: () => void }) {
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
        <Select className="select gv-filter" aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Toolbar>
      <Card title="SSM filings" sub={`${rows.length} filing${rows.length === 1 ? '' : 's'}${all ? '' : ' still open'}, by the month they fall due`} flush>
        {!rows.length && (
          <Empty
            title="Nothing open."
            action={
              data.canFile.length > 0 ? (
                <button className="btn btn-primary" onClick={onAdd}>
                  <PlusIcon size={16} /> Add filing
                </button>
              ) : undefined
            }
          >
            {data.canFile.length > 0 ? 'Add each annual return, set of financial statements or other SSM lodgement with its due date.' : undefined}
          </Empty>
        )}
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
  // Head office Corporate Admin (the Deputy Chief of Staff) and the owner record filings; the company and the secretary view them.
  const works = row.canWork;
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

function Changes({ data, onAdd }: { data: CorpBoard; onAdd: () => void }) {
  const can = data.canRaise.length > 0;
  return (
    <Card
      title="Corporate changes"
      flush
      actions={
        can && (
          <button className="btn btn-sm btn-primary" onClick={onAdd}>
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
      </div>
      {!data.changes.length && (
        <Empty
          title="No corporate changes."
          action={
            can ? (
              <button className="btn btn-primary" onClick={onAdd}>
                <PlusIcon size={16} /> Ask for a change
              </button>
            ) : undefined
          }
        >
          {can ? 'A new director, a share transfer or a change of owner starts here.' : undefined}
        </Empty>
      )}
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

function ChangeForm({ companies, onDone }: { companies: CorpBoard['canRaise']; onDone: () => void }) {
  const act = useAction();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [kind, setKind] = useState<CorpChangeKind>('DIRECTOR');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [tried, setTried] = useState(false);
  const missing = !companyId ? 'Choose the company.' : !title.trim() ? 'Say what the change is.' : '';
  const save = () => {
    setTried(true);
    if (missing) return;
    act.run(() => api.raiseCorpChange(companyId, { kind, title, detail }), 'Sent to PWVSB.').then((r) => r && onDone());
  };
  return (
    <div className="gv-stack-sm" aria-label="Ask PWVSB to approve a change">
      <label className="field">
        <span className="label">Company</span>
        <Select className="select" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span className="label">What changes</span>
        <Select className="select" aria-label="What changes" value={kind} onChange={(e) => setKind(e.target.value as CorpChangeKind)}>
          {(Object.keys(CHANGE) as CorpChangeKind[]).map((x) => (
            <option key={x} value={x}>
              {CHANGE[x]}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span className="label">Change</span>
        <input className="input" aria-label="Change" placeholder="For example, appoint a new director" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Details</span>
        <textarea className="textarea" aria-label="Details" placeholder="Details (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
        <span className="help">The Deputy Chief of Staff decides it for PWVSB; nobody decides a change they asked for.</span>
      </label>
      {tried && missing && (
        <p className="help" role="alert">
          {missing}
        </p>
      )}
      <ErrorNotice error={act.error} />
      <div className="gv-form-foot">
        <button className="btn btn-primary" disabled={act.busy} onClick={save}>
          {act.busy ? 'Sending...' : 'Send to PWVSB'}
        </button>
        <button className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const FILING_BASIS: Partial<Record<CorpFilingKind, string>> = {
  ANNUAL_RETURN: 'Companies Act 2016 s.68: within 30 days of the anniversary of incorporation',
  FINANCIAL_STATEMENTS: 'Companies Act 2016 s.259: within 30 days of circulating them to members',
};

function FilingForm({ companies, onDone }: { companies: CorpBoard['canFile']; onDone: () => void }) {
  const act = useAction();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [kind, setKind] = useState<CorpFilingKind>('ANNUAL_RETURN');
  const [title, setTitle] = useState(FILING_KIND.ANNUAL_RETURN);
  const [dueOn, setDueOn] = useState('');
  const [basis, setBasis] = useState(FILING_BASIS.ANNUAL_RETURN ?? '');
  const [tried, setTried] = useState(false);
  // Fill in the usual wording for the chosen filing; the person can still change it.
  const pick = (k: CorpFilingKind) => {
    setKind(k);
    setTitle(FILING_KIND[k]);
    setBasis(FILING_BASIS[k] ?? 'Companies Act 2016');
  };
  const missing = !companyId
    ? 'Choose the company.'
    : title.trim().length < 3
      ? 'Say what is being filed.'
      : !dueOn
        ? 'Give the date it is due.'
        : basis.trim().length < 3
          ? 'Give the rule that sets the deadline.'
          : '';
  const save = () => {
    setTried(true);
    if (missing) return;
    act.run(() => api.addCorpFiling(companyId, { kind, title, dueOn, basis }), 'Filing added.').then((r) => r && onDone());
  };
  return (
    <div className="gv-stack-sm" aria-label="Add a filing">
      <label className="field">
        <span className="label">Company</span>
        <Select className="select" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span className="label">What is being filed</span>
        <Select className="select" aria-label="What is being filed" value={kind} onChange={(e) => pick(e.target.value as CorpFilingKind)}>
          {(Object.keys(FILING_KIND) as CorpFilingKind[]).map((x) => (
            <option key={x} value={x}>
              {FILING_KIND[x]}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span className="label">Title</span>
        <input className="input" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Due on</span>
        <input className="input" type="date" aria-label="Due on" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Deadline rule</span>
        <input className="input" aria-label="Deadline rule" value={basis} onChange={(e) => setBasis(e.target.value)} />
        <span className="help">The company secretary confirms the date. Prima never lodges with SSM; it keeps the steps and the receipt.</span>
      </label>
      {tried && missing && (
        <p className="help" role="alert">
          {missing}
        </p>
      )}
      <ErrorNotice error={act.error} />
      <div className="gv-form-foot">
        <button className="btn btn-primary" disabled={act.busy} onClick={save}>
          {act.busy ? 'Saving...' : 'Add filing'}
        </button>
        <button className="btn btn-ghost" onClick={onDone}>
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
