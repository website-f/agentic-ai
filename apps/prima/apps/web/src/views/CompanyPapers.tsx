import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type CompanyPapers } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad, type Tone } from '../ui';
import { DocList, ProofPicker } from './Proof';

const STATE: Record<'OK' | 'DUE' | 'EXPIRED' | 'MISSING', { tone: Tone; label: string }> = {
  OK: { tone: 'ok', label: 'Ready' },
  DUE: { tone: 'warn', label: 'Ending soon' },
  EXPIRED: { tone: 'crit', label: 'Expired' },
  MISSING: { tone: 'crit', label: 'Missing' },
};

/**
 * The company paper library (Marketing item AH7, 23 Nov 2026): papers a bid usually needs, kept once per company with
 * their dates. The company office and the Marketing staff who cover the company add papers; nothing is deleted.
 */
export function CompanyPapersPanel({ companyId }: { companyId: string }) {
  const { data, error } = useLoad(() => api.companyPapers(companyId), [companyId]);
  const [channel, setChannel] = useState<'GOVERNMENT' | 'PRIVATE'>('GOVERNMENT');
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  if (error)
    return (
      <section className="panel">
        <ErrorNotice error={error} />
      </section>
    );
  if (!data)
    return (
      <section className="panel">
        <Loading what="company papers" />
      </section>
    );
  if (!data.installed)
    return (
      <section className="panel">
        <div className="panel-head">
          <h3>Company papers for tenders</h3>
          <Chip tone="unknown">Not installed</Chip>
        </div>
        <p className="muted small">The paper library is not installed in this database yet, so what is on file is unknown.</p>
      </section>
    );
  const needs = data.needs![channel];
  const notReady = needs.filter((n) => n.state !== 'OK').length;
  const live = data.papers.filter((p) => !p.replacedBy);
  const shown = showAll ? data.papers : live;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Company papers for tenders</h3>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="select" aria-label="Kind of bid" value={channel} onChange={(e) => setChannel(e.target.value as 'GOVERNMENT' | 'PRIVATE')}>
            <option value="GOVERNMENT">Government bid</option>
            <option value="PRIVATE">Private bid</option>
          </select>
          <Chip tone={notReady ? 'warn' : 'ok'}>{notReady ? `${notReady} not ready` : 'All ready'}</Chip>
        </div>
      </div>
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        What a bid usually needs. The tender papers decide; licences are kept in the licence register and only shown here.
      </p>
      <div className="list">
        {needs.map((n) => (
          <div key={n.key} className="list-item">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{n.label}</div>
              <div className="muted small">
                {n.detail}
                {n.source === 'licence' ? ' · licence register' : ''}
              </div>
            </div>
            <Chip tone={STATE[n.state].tone}>{STATE[n.state].label}</Chip>
          </div>
        ))}
      </div>
      <div className="panel-head" style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: '1rem' }}>Papers on file ({live.length})</h3>
        <div className="row" style={{ gap: 6 }}>
          {data.papers.length > live.length && (
            <button className="btn btn-sm" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Current only' : 'Show replaced too'}
            </button>
          )}
          {data.canAdd && !adding && (
            <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
              Add a paper
            </button>
          )}
        </div>
      </div>
      {adding && <AddPaper companyId={companyId} data={data} onDone={() => setAdding(false)} />}
      <div className="list">
        {shown.length === 0 && <div className="empty">No papers yet.</div>}
        {shown.map((p) => (
          <div key={p.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{p.title}</div>
                <div className="muted small">
                  {p.label}
                  {p.issuedOn ? ` · issued ${dateLabel(p.issuedOn)}` : ''}
                  {p.expiresOn ? ` · ends ${dateLabel(p.expiresOn)}` : ''} · added by {p.by}
                </div>
              </div>
              {p.replacedBy && <Chip tone="neutral">Replaced</Chip>}
            </div>
            <DocList docs={p.docs} />
          </div>
        ))}
      </div>
    </section>
  );
}

function AddPaper({ companyId, data, onDone }: { companyId: string; data: CompanyPapers; onDone: () => void }) {
  const act = useAction();
  const [kind, setKind] = useState('BANK_STATEMENT');
  const [title, setTitle] = useState('');
  const [period, setPeriod] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const k = data.kinds.find((x) => x.kind === kind)!;
  const months = data.installed ? (data.statementMonths ?? []) : [];
  const years = data.installed ? (data.accountYears ?? []) : [];
  const ready = proof.length > 0 && (kind !== 'BANK_STATEMENT' || !!period) && (kind !== 'AUDITED_ACCOUNTS' || !!period);
  return (
    <div className="notice" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
      <label className="small">
        Kind of paper
        <select
          className="select"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPeriod('');
          }}
        >
          {data.kinds.map((x) => (
            <option key={x.kind} value={x.kind}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      {kind === 'BANK_STATEMENT' && (
        <label className="small">
          Month of the statement
          <input className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          {months.length > 0 && <span className="muted"> Bids now need {months.slice().reverse().join(', ')}.</span>}
        </label>
      )}
      {kind === 'AUDITED_ACCOUNTS' && (
        <label className="small">
          Financial year
          <input className="input" inputMode="numeric" placeholder={years[0] ?? 'YYYY'} value={period} onChange={(e) => setPeriod(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          {years.length > 0 && <span className="muted"> Bids now need {years.join(' and ')}.</span>}
        </label>
      )}
      <label className="small">
        Name on the paper (optional)
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="small">
          Issued on
          <input className="input" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </label>
        {k.expires && (
          <label className="small">
            Ends on
            <input className="input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </label>
        )}
      </div>
      <ProofPicker site={null} refText="Paper" items={proof} onChange={setProof} documentsOnly required />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !ready}
          onClick={() =>
            act
              .run(
                () =>
                  api.addCompanyPaper(
                    companyId,
                    { kind, title: title || undefined, period: period || undefined, issuedOn: issuedOn || undefined, expiresOn: expiresOn || undefined },
                    proof,
                  ),
                'Paper added to the library.',
              )
              .then((r) => r !== undefined && onDone())
          }
        >
          Save paper
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
