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
import { Card, Empty, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import { CentralAdminGuide } from './CentralAdminGuide';
import { ImportButton } from './ImportDrawer';
import '../styles/gov.css';
import { useRouteTab } from '../App';
import { SopHelp } from '../sop/SopHelp';

/**
 * Company secretary (V9). Each company keeps its own licensed secretary, filings and board. Head office Corporate Admin
 * (the Deputy Chief of Staff) records each filing here; the company and the company secretary view them (Central Admin
 * 5A, Fauzan 1 Nov 2026). Any change to a company's corporate structure needs PWVSB approval (the Deputy Chief of Staff,
 * with a reason), citing the signed clause, before the board acts (Fauzan, 24 Oct 2026). Prima never lodges, signs or files.
 */

type Tab = 'filings' | 'changes' | 'audit' | 'legal' | 'companies' | 'files' | 'panel' | 'delegations';
/** P121: the tabs a link may ask for (#corporate/changes). Audit and legal open only for people who have them. */
const CORP_TABS: readonly Tab[] = ['filings', 'changes', 'audit', 'legal', 'companies', 'files', 'panel', 'delegations'];
const CORP_SOP: Record<Tab, string> = {
  filings: 'board-ssm-filing',
  changes: 'board-corporate-change',
  audit: 'board',
  legal: 'board-legal-hold',
  companies: 'board',
  files: 'board-company-record',
  panel: 'board',
  delegations: 'board-delegation',
};
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
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function CorporateView() {
  const { data, error } = useLoad(() => api.corpBoard(), []);
  const al = useLoad(() => api.corpAuditLegal().catch(() => null), []);
  const [tabPick, setTab] = useRouteTab<Tab>('filings', CORP_TABS);
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
  const tab: Tab = (tabPick === 'audit' || tabPick === 'legal') && !al.data ? 'filings' : tabPick;
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
              <SopHelp id={CORP_SOP[tab]} />
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
              {data.canFile.length > 0 && <ImportButton kind="corpFiling" label="Import filings" choices={data.canFile.map((c): [string, string] => [c.id, c.name])} />}
            </>
          ) : (
            <SopHelp id={CORP_SOP[tab]} />
          )
        }
      >
        <p className="notice" data-tone="info">
          Prima opens each company's file, its annual return and financial statements 90 days before they are due, and its audit at each year end, from the
          company record. Deadlines follow the Companies Act 2016 and are for the secretaries to confirm.
        </p>
        {data.cover && (
          <p className="notice" data-tone="warn">
            The Deputy Chief of Staff is on approved leave today, so you stand in for Corporate Admin. Each step you take says so in the audit trail.
          </p>
        )}
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
  const [tab, setTab] = useRouteTab<'legal' | 'audit' | 'panel'>('legal', ['legal', 'audit', 'panel']);
  return (
    <div className="page gv-page">
      <PageHead
        title="Audit and legal"
        sub="Each company runs its own audit and keeps its own lawyers. PWVSB legal follows every matter with the company."
        actions={<SopHelp id={tab === 'legal' ? 'board-legal-hold' : 'board'} />}
      >
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

/** The filings list (P107: a searchable table; the steps and forms open in a drawer). Open filings first, by due date. */
function Filings({ data, onAdd }: { data: CorpBoard; onAdd: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // B7 (Fauzan, 23 Nov 2026): Corporate Admin opens a filing Prima does not open by itself.
  const [opening, setOpening] = useState(false);
  const open = data.filings.find((f) => f.filing.id === openId);
  return (
    <Card
      title="SSM filings"
      sub="Every filing with the date it falls due. Open one to record its next step."
      flush
      actions={
        data.canOpenFiling.length > 0 ? (
          <button className="btn btn-sm" aria-expanded={opening} onClick={() => setOpening(!opening)}>
            {opening ? 'Close' : 'Open another filing'}
          </button>
        ) : undefined
      }
    >
      {opening && (
        <Drawer
          title="Open another filing"
          sub="A filing Prima does not open by itself: a change of address, a new charge, anything else."
          onClose={() => setOpening(false)}
        >
          <OpenFiling data={data} done={() => setOpening(false)} />
        </Drawer>
      )}
      <DataTable
        label="SSM filings"
        stateKey="board.corporate.filings"
        defaults={{ sort: 'due', dir: 'asc', f: { show: 'open' } }}
        rows={data.filings}
        rowKey={(r) => r.filing.id}
        columns={FILING_COLUMNS}
        filters={FILING_FILTERS}
        searchText={(r) => r.filing.basis}
        onView={(r) => setOpenId(r.filing.id)}
        rowTone={(r) => (r.tone === 'crit' ? 'crit' : r.tone === 'warn' ? 'warn' : undefined)}
        actions={(r) => [{ label: (r.can.prepare || r.can.lodge || r.can.receipt) && r.filing.status !== 'acknowledged' ? 'Next step' : 'Open', onClick: () => setOpenId(r.filing.id) }]}
        empty={
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
        }
      />
      {open && (
        <Drawer title={open.filing.title} sub={open.companyName} onClose={() => setOpenId(null)}>
          <FilingLine f={open} />
        </Drawer>
      )}
    </Card>
  );
}

const FILING_COLUMNS: DtColumn<FilingRow>[] = [
  { id: 'due', label: 'Due', value: (r) => r.filing.dueOn, sort: 'date', width: '8rem' },
  { id: 'company', label: 'Company', value: (r) => r.companyName, phone: 'sub' },
  { id: 'title', label: 'Filing', value: (r) => r.filing.title, render: (r) => <strong>{r.filing.title}</strong>, phone: 'title' },
  { id: 'kind', label: 'Type', value: (r) => FILING_KIND[r.filing.kind], translate: true, hideBelow: 1280 },
  {
    id: 'progress',
    label: 'Progress',
    value: (r) =>
      [
        r.filing.prepared && !r.filing.lodged ? `prepared by ${r.filing.prepared.by}` : '',
        r.filing.lodged ? `lodged ${dateLabel(r.filing.lodged.on)} (${r.filing.lodged.ref})${r.lodgedLate ? ', late' : ''}` : '',
        r.filing.receipt ? `receipt ${r.filing.receipt.ref}` : '',
        // B3: the financial statements are ready to circulate once that year's audit is signed.
        r.fs && r.filing.status !== 'acknowledged' && r.filing.status !== 'lodged'
          ? r.fs.auditSigned
            ? `audit signed ${dateLabel(r.fs.auditSignedOn!)}: ready to circulate`
            : 'audit not signed yet'
          : '',
        r.filing.openedBy ? `opened by ${r.filing.openedBy.by}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    sort: false,
    hideBelow: 1100,
  },
  { id: 'status', label: 'Status', value: (r) => r.label, translate: true, render: (r) => <Chip tone={r.tone}>{r.label}</Chip> },
];
const FILING_FILTERS: DtFilter<FilingRow>[] = [
  { id: 'show', label: 'Show', value: (r) => (r.tone === 'ok' ? 'done' : 'open'), options: [{ value: 'open', label: 'Open' }, { value: 'done', label: 'Completed' }] },
  { id: 'company', label: 'Company', value: (r) => r.companyName },
  { id: 'status', label: 'Status', value: (r) => r.label },
  { id: 'kind', label: 'Type', value: (r) => r.filing.kind, optionLabel: (k) => FILING_KIND[k as CorpFilingKind] ?? k },
];

/** B7: Corporate Admin opens a filing Prima does not open by itself (a change of address, a new charge, anything else). */
function OpenFiling({ data, done }: { data: CorpBoard; done: () => void }) {
  const act = useAction();
  const choices = data.companies.filter((c) => data.canOpenFiling.includes(c.profile.companyId));
  const [companyId, setCompanyId] = useState(choices[0]?.profile.companyId ?? '');
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [basis, setBasis] = useState('');
  return (
    <div className="gv-stack-sm" aria-label="Open another filing">
      <label className="field">
        <span className="label">Company</span>
        <Select className="select" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {choices.map((c) => (
            <option key={c.profile.companyId} value={c.profile.companyId}>
              {c.companyName}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span className="label">What must be filed</span>
        <input className="input" aria-label="What must be filed" value={title} placeholder="For example: change of registered address" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Due date</span>
        <input className="input" type="date" aria-label="Due date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Legal basis or reason for the date</span>
        <input
          className="input"
          aria-label="Legal basis or reason for the date"
          value={basis}
          placeholder="For example: Companies Act 2016 s.46, within 14 days"
          onChange={(e) => setBasis(e.target.value)}
        />
      </label>
      <ErrorNotice error={act.error} />
      <div className="gv-form-foot">
        <button
          className="btn btn-primary"
          disabled={act.busy || !companyId || title.trim().length < 3 || !dueOn || !basis.trim()}
          onClick={() => act.run(() => api.openCorpFiling({ companyId, title, dueOn, basis }), 'Filing opened.').then((r) => r && done())}
        >
          Open the filing
        </button>
        <button className="btn btn-ghost" onClick={done}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function FilingLine({ f: row }: { f: FilingRow }) {
  const act = useAction();
  const [ref, setRef] = useState('');
  const f = row.filing;
  // Corporate Admin and the filing executive record every step; the company secretary firm keys in its lodgement and
  // the SSM receipt (Fauzan, 23 Nov 2026); the company views.
  const works = row.can.prepare || row.can.lodge || row.can.receipt;
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
            {f.openedBy ? ` · opened by ${f.openedBy.by}` : ''}
          </div>
        </div>
        <div className="gv-item-state">
          {row.fs && f.status !== 'acknowledged' && f.status !== 'lodged' && (
            <Chip tone={row.fs.auditSigned ? 'ok' : 'neutral'}>{row.fs.auditSigned ? `Audit signed ${dateLabel(row.fs.auditSignedOn!)}: ready to circulate` : 'Audit not signed yet'}</Chip>
          )}
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
          <div className="gv-inline">
            {(f.status !== 'open' || (row.role === 'secretary' && row.can.lodge)) && (
              <input
                className="input"
                aria-label="Reference"
                placeholder={f.status === 'lodged' ? 'SSM receipt number' : 'MBRS lodgement reference from the secretary'}
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
            )}
            {row.can.prepare && (
              <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.corpFilingStep(f.id, 'prepare', {}), 'Marked prepared.')}>
                Papers ready for the secretary
              </button>
            )}
            {row.can.lodge && f.status !== 'lodged' && (row.role === 'secretary' || f.status === 'prepared') && (
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !ref.trim()}
                onClick={() => act.run(() => api.corpFilingStep(f.id, 'lodge', { ref }), 'Lodgement recorded.')}
              >
                Secretary lodged it
              </button>
            )}
            {row.can.receipt && (
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !ref.trim()}
                onClick={() => act.run(() => api.corpFilingStep(f.id, 'receipt', { ref }), 'SSM receipt recorded.')}
              >
                Record SSM receipt
              </button>
            )}
          </div>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
  );
}

const CHANGE_COLUMNS: DtColumn<ChangeRow>[] = [
  { id: 'at', label: 'Asked', value: (r) => r.change.at, sort: 'date', width: '8rem' },
  { id: 'company', label: 'Company', value: (r) => r.companyName, phone: 'sub' },
  { id: 'title', label: 'Change', value: (r) => r.change.title, render: (r) => <strong>{r.change.title}</strong>, phone: 'title' },
  { id: 'kind', label: 'What changes', value: (r) => CHANGE[r.change.kind], translate: true, hideBelow: 1200 },
  { id: 'by', label: 'Asked by', value: (r) => r.change.raisedBy, hideBelow: 1100 },
  { id: 'pwvsb', label: 'PWVSB', value: (r) => r.change.pwvsb?.by, hideBelow: 1280 },
  { id: 'board', label: 'Board resolution', value: (r) => r.change.board?.resolutionRef, hideBelow: 1280 },
  {
    id: 'status',
    label: 'Status',
    value: (r) => CHANGE_STATUS[r.change.status][1],
    translate: true,
    render: (r) => <Chip tone={CHANGE_STATUS[r.change.status][0]}>{CHANGE_STATUS[r.change.status][1]}</Chip>,
  },
];
const CHANGE_FILTERS: DtFilter<ChangeRow>[] = [
  { id: 'status', label: 'Status', value: (r) => r.change.status, optionLabel: (v) => CHANGE_STATUS[v as ChangeRow['change']['status']]?.[1] ?? v },
  { id: 'kind', label: 'What changes', value: (r) => r.change.kind, optionLabel: (v) => CHANGE[v as CorpChangeKind] ?? v },
  { id: 'company', label: 'Company', value: (r) => r.companyName },
];

function Changes({ data, onAdd }: { data: CorpBoard; onAdd: () => void }) {
  const can = data.canRaise.length > 0;
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data.changes.find((c) => c.change.id === openId);
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
      {data.changes.length > 0 && (
        <DataTable
          label="Corporate changes"
          stateKey="board.corporate.changes"
          rows={data.changes}
          rowKey={(r) => r.change.id}
          columns={CHANGE_COLUMNS}
          filters={CHANGE_FILTERS}
          searchText={(r) => `${r.change.detail} ${r.change.pwvsb?.by ?? ''} ${r.change.board?.resolutionRef ?? ''}`}
          onView={(r) => setOpenId(r.change.id)}
          rowTone={(r) => (r.change.status === 'rejected' ? 'crit' : r.change.status === 'awaiting_pwvsb' ? 'warn' : undefined)}
          actions={(r) => [{ label: r.canDecide ? 'Decide' : r.canRecordBoard ? 'Record resolution' : 'Open', onClick: () => setOpenId(r.change.id) }]}
        />
      )}
      {open && (
        <Drawer title={open.change.title} sub={open.companyName} onClose={() => setOpenId(null)}>
          <ChangeLine c={open} />
        </Drawer>
      )}
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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type CompanyRow = CorpBoard['companies'][number];
// Director Office and company secretary gaps (Fauzan, 23 Nov 2026): a missing SSM number, incorporation date, secretary
// firm or auditor says so (no annual return can be opened without the incorporation date); the filing executive shows.
const COMPANY_COLUMNS: DtColumn<CompanyRow>[] = [
  { id: 'name', label: 'Company', value: (c) => c.companyName, render: (c) => <strong>{c.companyName}</strong>, phone: 'title' },
  {
    id: 'reg',
    label: 'Registration',
    value: (c) => c.profile.regNo,
    render: (c) => (c.profile.regNo ? <span className="mono small">{c.profile.regNo}</span> : <span className="muted small">SSM number not keyed in</span>),
    phone: 'sub',
  },
  {
    id: 'inc',
    label: 'Incorporated',
    value: (c) => c.profile.incorporatedOn,
    sort: 'date',
    render: (c) => (c.profile.incorporatedOn ? dateLabel(c.profile.incorporatedOn) : <span className="muted small">Not keyed in (no annual return can be opened)</span>),
    hideBelow: 1100,
  },
  { id: 'fye', label: 'Year ends', value: (c) => MONTHS[(c.profile.fyeMonth || 12) - 1], hideBelow: 1200 },
  { id: 'sec', label: 'Secretary', value: (c) => c.profile.secretaryFirm || 'Secretary firm not keyed in' },
  { id: 'aud', label: 'Auditor', value: (c) => c.profile.auditor || 'Auditor not keyed in' },
  { id: 'dir', label: 'Directors', value: (c) => c.profile.directors.length, sort: 'number' },
  { id: 'filer', label: 'Filing executive', value: (c) => c.filingExec?.name ?? '', hideBelow: 1280 },
  { id: 'open', label: 'Filings', value: (c) => c.open, sort: 'number', align: 'left', render: (c) => <Chip tone={c.worst}>{c.open ? `${c.open} open` : 'In order'}</Chip> },
];
const COMPANY_FILTERS: DtFilter<CompanyRow>[] = [
  { id: 'filings', label: 'Filings', value: (c) => (c.open ? 'open' : 'ok'), options: [{ value: 'open', label: 'Open filings' }, { value: 'ok', label: 'In order' }] },
  { id: 'auditor', label: 'Auditor', value: (c) => c.profile.auditor },
];

function Companies({ data }: { data: CorpBoard }) {
  const [naming, setNaming] = useState(false);
  return (
    <Card
      title="Companies"
      sub={`${data.companies.length} compan${data.companies.length === 1 ? 'y' : 'ies'}`}
      flush
      actions={
        data.canNameFiler ? (
          <button className="btn btn-sm" aria-expanded={naming} onClick={() => setNaming(!naming)}>
            {naming ? 'Close' : 'Name the filing executive'}
          </button>
        ) : undefined
      }
    >
      {naming && (
        <Drawer
          title="Name the filing executive"
          sub="One Chief of Staff office executive records filing steps (papers ready, lodged, SSM receipt)."
          onClose={() => setNaming(false)}
        >
          <FilingExecForm data={data} done={() => setNaming(false)} />
        </Drawer>
      )}
      {!data.companies.length && <Empty title="No companies." />}
      {data.companies.length > 0 && (
        <DataTable details label="Companies" stateKey="board.corporate.companies" rows={data.companies} rowKey={(c) => c.profile.id} columns={COMPANY_COLUMNS} filters={COMPANY_FILTERS} />
      )}
    </Card>
  );
}

/** D1 (Fauzan, 23 Nov 2026): the Deputy Chief of Staff names a Chief of Staff office executive to record filing steps. */
function FilingExecForm({ data, done }: { data: CorpBoard; done: () => void }) {
  const people = useLoad(() => api.corpFilingExecChoices(), []);
  const act = useAction();
  const [companyId, setCompanyId] = useState('all');
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="gv-stack-sm" aria-label="Name the filing executive">
      <p className="muted small">
        Name one Chief of Staff office executive to record filing steps (papers ready, lodged, SSM receipt). They never approve a change or check a company
        file, and they need a company access line for each company.
      </p>
      <label className="field">
        <span className="label">Company</span>
        <Select className="select" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="all">Every company</option>
          {data.companies.map((c) => (
            <option key={c.profile.companyId} value={c.profile.companyId}>
              {c.companyName}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span className="label">Filing executive</span>
        <Select className="select" aria-label="Filing executive" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Nobody (take the name off)</option>
          {(people.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.title ? `, ${p.title}` : ''}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span className="label">Reason</span>
        <input className="input" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ErrorNotice error={act.error ?? people.error} />
      <div className="gv-form-foot">
        <button
          className="btn btn-primary"
          disabled={act.busy || !reason.trim()}
          onClick={() => act.run(async () => { await api.setCorpFilingExec({ companyId, userId: userId || null, reason }); return true; }, 'Saved.').then((r) => r && done())}
        >
          Save
        </button>
        <button className="btn btn-ghost" onClick={done}>
          Cancel
        </button>
      </div>
    </div>
  );
}
