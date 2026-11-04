import { useState } from 'react';
import type { CorpChangeKind } from '@prima/core';
import { api, type CorpBoard } from '../api';
import { AuditLegalKpis, AuditPanel, LegalPanel } from './AuditLegal';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * Company secretary (V9). Each company keeps its own licensed secretary, filings and board, and records each filing
 * here. Any change to a company's corporate structure needs PWVSB approval (Chief of Staff or Deputy), citing the
 * signed clause, before the board acts (Fauzan, 24 Oct 2026). Prima never lodges, signs or files.
 */

type Tab = 'filings' | 'changes' | 'audit' | 'legal' | 'companies';
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

export function CorporateView() {
  const { data, error } = useLoad(() => api.corpBoard(), []);
  const al = useLoad(() => api.corpAuditLegal().catch(() => null), []);
  const [tab, setTab] = useState<Tab>('filings');
  if (error && al.data) return <AuditLegalOnly data={al.data} />;
  if (error && !al.loading) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="company secretary" />;
  const k = data.kpis;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Company secretary</h1>
        <p className="muted">
          Each company keeps its own licensed secretary, filings and board. The secretary lodges in MBRS and the company records it here; a filing stays
          awaiting acknowledgement until the SSM receipt is recorded. Any change to a company's structure needs PWVSB approval before the board acts.
        </p>
        <p className="notice" data-tone="info">
          Test data. Deadlines follow the Companies Act 2016 and are for the secretaries to confirm.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Filings overdue" value={k.overdue} tone={k.overdue ? 'crit' : 'ok'} />
        <Kpi label={`Due in ${data.rule.warnDays} days`} value={k.dueSoon} tone={k.dueSoon ? 'warn' : 'ok'} />
        <Kpi label="Waiting for SSM receipt" value={k.awaitingReceipt} tone={k.awaitingReceipt ? 'info' : 'ok'} />
        <Kpi
          label="Changes waiting for PWVSB"
          value={k.changesAwaiting}
          tone={k.changesAwaiting ? 'warn' : 'ok'}
          note={k.boardPending ? `${k.boardPending} for the board` : undefined}
        />
      </div>
      <div className="tabbar" role="tablist" aria-label="Company secretary">
        {(
          [
            ['filings', 'Filings'],
            ['changes', 'Corporate changes'],
            ['audit', 'Audit'],
            ['legal', 'Legal matters'],
            ['companies', 'Companies'],
          ] as [Tab, string][]
        )
          .filter(([t]) => (t !== 'audit' && t !== 'legal') || al.data)
          .map(([t, l]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {l}
            </button>
          ))}
      </div>
      {tab === 'filings' && <Filings data={data} />}
      {tab === 'changes' && <Changes data={data} />}
      {tab === 'audit' && al.data && <AuditPanel data={al.data} />}
      {tab === 'legal' && al.data && <LegalPanel data={al.data} />}
      {tab === 'companies' && <Companies data={data} />}
    </div>
  );
}

/** PWVSB legal sees the audit and legal tabs only, not filings or structure changes. */
function AuditLegalOnly({ data }: { data: NonNullable<Awaited<ReturnType<typeof api.corpAuditLegal>>> }) {
  const [tab, setTab] = useState<'legal' | 'audit'>('legal');
  return (
    <div className="page">
      <div className="page-head">
        <h1>Audit and legal</h1>
        <p className="muted">Each company runs its own audit and keeps its own lawyers. PWVSB legal follows every matter with the company.</p>
        <p className="notice" data-tone="info">
          Test data.
        </p>
      </div>
      <AuditLegalKpis data={data} />
      <div className="tabbar" role="tablist" aria-label="Audit and legal">
        <button role="tab" aria-selected={tab === 'legal'} onClick={() => setTab('legal')}>
          Legal matters
        </button>
        <button role="tab" aria-selected={tab === 'audit'} onClick={() => setTab('audit')}>
          Audit
        </button>
      </div>
      {tab === 'legal' ? <LegalPanel data={data} /> : <AuditPanel data={data} />}
    </div>
  );
}

function Filings({ data }: { data: CorpBoard }) {
  const [all, setAll] = useState(false);
  const rows = data.filings.filter((f) => all || f.tone !== 'ok');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>SSM filings</h3>
        <button className="btn btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Hide completed' : 'Show completed'}
        </button>
      </div>
      <div className="list">
        {!rows.length && <div className="empty">Nothing open.</div>}
        {rows.slice(0, 100).map((f) => (
          <FilingLine key={f.filing.id} f={f} />
        ))}
      </div>
    </section>
  );
}

function FilingLine({ f: row }: { f: FilingRow }) {
  const act = useAction();
  const [ref, setRef] = useState('');
  const f = row.filing;
  const works = row.role === 'manager' || row.role === 'staff';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {row.companyName}: {f.title}
          </div>
          <div className="muted small">
            Due {dateLabel(f.dueOn)} · {f.basis}
            {f.prepared && !f.lodged ? ` · prepared by ${f.prepared.by}` : ''}
            {f.lodged ? ` · lodged ${dateLabel(f.lodged.on)} (${f.lodged.ref})${row.lodgedLate ? ', late' : ''}` : ''}
            {f.receipt ? ` · receipt ${f.receipt.ref}` : ''}
          </div>
        </div>
        <Chip tone={row.tone}>{row.label}</Chip>
      </div>
      {works && f.status !== 'acknowledged' && (
        <>
          {f.status !== 'open' && (
            <input
              className="input"
              aria-label="Reference"
              placeholder={f.status === 'lodged' ? 'SSM receipt number' : 'MBRS lodgement reference from the secretary'}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          )}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {f.status === 'open' && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.corpFilingStep(f.id, 'prepare', {}), 'Marked prepared.')}>
                Papers ready for the secretary
              </button>
            )}
            {f.status === 'prepared' && (
              <button
                className="btn btn-sm"
                disabled={act.busy || !ref.trim()}
                onClick={() => act.run(() => api.corpFilingStep(f.id, 'lodge', { ref }), 'Lodgement recorded.')}
              >
                Secretary lodged it
              </button>
            )}
            {f.status === 'lodged' && (
              <button
                className="btn btn-sm"
                disabled={act.busy || !ref.trim()}
                onClick={() => act.run(() => api.corpFilingStep(f.id, 'receipt', { ref }), 'SSM receipt recorded.')}
              >
                Record SSM receipt
              </button>
            )}
          </div>
          <ErrorNotice error={act.error} />
        </>
      )}
    </div>
  );
}

function Changes({ data }: { data: CorpBoard }) {
  const mine = data.companies.filter((c) => c.role === 'manager');
  const [form, setForm] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Corporate changes</h3>
        {mine.length > 0 && (
          <button className="btn btn-sm" onClick={() => setForm(!form)}>
            Ask PWVSB to approve a change
          </button>
        )}
      </div>
      <p className="muted small">
        The company manager asks, the Chief of Staff or Deputy approves for PWVSB citing the signed clause, then the board acts and the company files with SSM
        within {data.rule.changeFileDays} days. Statutory deadlines are never held back.
      </p>
      {form && <ChangeForm companies={mine} onDone={() => setForm(false)} />}
      <div className="list">
        {!data.changes.length && <div className="empty">No corporate changes.</div>}
        {data.changes.map((c) => (
          <ChangeLine key={c.change.id} c={c} />
        ))}
      </div>
    </section>
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
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {row.companyName}: {c.title}
          </div>
          <div className="muted small">
            {CHANGE[c.kind]} · asked by {c.raisedBy} {dateTimeLabel(c.at)}
            {c.pwvsb ? ` · PWVSB: ${c.pwvsb.by} under ${c.pwvsb.clauseRef}${c.pwvsb.note ? ` (${c.pwvsb.note})` : ''}` : ''}
            {c.board ? ` · board ${c.board.resolutionRef}, effective ${dateLabel(c.board.effectiveOn)}` : ''}
            {row.filing ? ` · SSM filing due ${dateLabel(row.filing.dueOn)}, ${row.filing.status}` : ''}
          </div>
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      {row.canDecide && (
        <>
          <input
            className="input"
            aria-label="Clause"
            placeholder="Signed clause giving PWVSB this approval"
            value={clause}
            onChange={(e) => setClause(e.target.value)}
          />
          <input className="input" aria-label="Note" placeholder="Note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !clause.trim()}
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
        </>
      )}
      {row.canRecordBoard && (
        <>
          <input className="input" aria-label="Resolution" placeholder="Board resolution reference" value={ref} onChange={(e) => setRef(e.target.value)} />
          <input className="input" type="date" aria-label="Effective date" value={on} onChange={(e) => setOn(e.target.value)} />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !ref.trim() || !on}
            onClick={() => act.run(() => api.recordCorpBoard(c.id, ref, on), 'Board resolution recorded; SSM filing opened.')}
          >
            Record board resolution
          </button>
        </>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
      {companies.length > 1 && (
        <select className="select" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {companies.map((c) => (
            <option key={c.profile.companyId} value={c.profile.companyId}>
              {c.companyName}
            </option>
          ))}
        </select>
      )}
      <select className="select" aria-label="What changes" value={kind} onChange={(e) => setKind(e.target.value as CorpChangeKind)}>
        {(Object.keys(CHANGE) as CorpChangeKind[]).map((x) => (
          <option key={x} value={x}>
            {CHANGE[x]}
          </option>
        ))}
      </select>
      <input className="input" aria-label="Change" placeholder="What the change is" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input" aria-label="Details" placeholder="Details (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy || !title.trim()}
        onClick={() => act.run(() => api.raiseCorpChange(companyId, { kind, title, detail }), 'Sent to PWVSB.').then((r) => r && onDone())}
      >
        Send to PWVSB
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Companies({ data }: { data: CorpBoard }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Companies</h3>
      </div>
      <div className="list">
        {data.companies.map((c) => (
          <div key={c.profile.id} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{c.companyName}</div>
              <div className="muted small">
                {c.profile.regNo} · incorporated {dateLabel(c.profile.incorporatedOn)} · year end month {c.profile.fyeMonth} · {c.profile.secretaryFirm} ·{' '}
                {c.profile.auditor} · {c.profile.directors.length} directors
              </div>
            </div>
            <Chip tone={c.worst}>{c.open ? `${c.open} open` : 'In order'}</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}
