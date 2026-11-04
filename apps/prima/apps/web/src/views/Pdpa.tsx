import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type PdpaBoard, type PdpaCaseInput, type PdpaStepName } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { DocList, ProofPicker } from './Proof';
import { ProductsPanel, ProposalPanel } from './Products';
import { DpoPanel, RequestsPanel } from './PdpaRights';

/**
 * PDPA (Fauzan, 26 Oct 2026). The PDPA officer manages every personal data matter and is monitored by the Operations
 * Director. Breaches: the PDP Commissioner within 72 hours, and the affected people within 7 days of that when the
 * harm is significant. The officer advises clients and gets their consent before a product that needs it is used,
 * and monitors the group's social media.
 */

type Case = PdpaBoard['cases'][number];
type Kind = Case['kind'];

const TAB_LABEL: Record<Kind, string> = { BREACH: 'Breaches', CLIENT_CONSENT: 'Client consent', SOCIAL: 'Social media' };

export function PdpaView() {
  const { data, error } = useLoad(() => api.pdpaBoard(), []);
  const [tab, setTab] = useState<Kind | 'PRODUCTS' | 'PROPOSAL' | 'REQUESTS' | 'DPO'>('BREACH');
  const [adding, setAdding] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="PDPA" />;
  const officer = data.role === 'officer';
  const rows = data.cases.filter((c) => c.kind === tab);
  const caseTab = tab !== 'PRODUCTS' && tab !== 'PROPOSAL' && tab !== 'REQUESTS' && tab !== 'DPO';
  return (
    <div className="page">
      <div className="page-head">
        <h1>PDPA</h1>
        <p className="muted">
          The PDPA officer handles every personal data matter. The Operations Director monitors. A breach goes to the PDP Commissioner within 72 hours, and to
          the affected people within 7 days after that when the harm is significant.
        </p>
      </div>
      {data.counts.late > 0 && (
        <div className="notice" data-tone="crit" role="alert" style={{ marginBottom: 12 }}>
          {data.counts.late} breach{data.counts.late === 1 ? '' : 'es'} past the legal notice time.
        </div>
      )}
      <div className="kpis">
        <Kpi label="Open breaches" value={data.counts.breachesOpen} tone={data.counts.breachesOpen ? 'warn' : 'ok'} />
        <Kpi label="Late notices" value={data.counts.late} tone={data.counts.late ? 'crit' : 'ok'} />
        <Kpi label="Client consent pending" value={data.counts.consentPending} tone={data.counts.consentPending ? 'warn' : 'ok'} />
        <Kpi label="Social media open" value={data.counts.socialOpen} tone={data.counts.socialOpen ? 'warn' : 'ok'} />
      </div>
      <div className="tabbar" role="tablist" aria-label="PDPA sections">
        {(Object.keys(TAB_LABEL) as Kind[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {TAB_LABEL[k]}
          </button>
        ))}
        <button role="tab" aria-selected={tab === 'PRODUCTS'} onClick={() => setTab('PRODUCTS')}>
          Products
        </button>
        <button role="tab" aria-selected={tab === 'PROPOSAL'} onClick={() => setTab('PROPOSAL')}>
          Proposal check
        </button>
        <button role="tab" aria-selected={tab === 'REQUESTS'} onClick={() => setTab('REQUESTS')}>
          Data requests
        </button>
        <button role="tab" aria-selected={tab === 'DPO'} onClick={() => setTab('DPO')}>
          DPO register
        </button>
      </div>
      {tab === 'PRODUCTS' && <ProductsPanel />}
      {tab === 'PROPOSAL' && <ProposalPanel />}
      {tab === 'REQUESTS' && <RequestsPanel />}
      {tab === 'DPO' && <DpoPanel />}
      {caseTab && (
        <section className="panel">
          <div className="panel-head">
            <h3>{TAB_LABEL[tab]}</h3>
            {officer && !adding && (
              <button className="btn btn-sm" onClick={() => setAdding(true)}>
                Open a case
              </button>
            )}
          </div>
          {adding && <NewCase kind={tab} companies={data.companies} onDone={() => setAdding(false)} />}
          <div className="list">
            {rows.length === 0 && <div className="empty">Nothing here.</div>}
            {rows.map((c) => (
              <CaseLine key={c.id} c={c} officer={officer} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function caseChip(c: Case): [Tone, string] {
  if (c.status === 'closed') return ['ok', 'Closed'];
  const k = c.clock;
  if (c.kind === 'BREACH' && k) {
    if (!c.breach!.commissionerAt) return k.commissionerLate ? ['crit', 'Commissioner overdue'] : ['warn', `Commissioner in ${k.hoursLeft} h`];
    if (k.subjectsDue && !c.breach!.subjectsAt)
      return k.subjectsLate ? ['crit', 'People notice overdue'] : ['warn', `Tell people by ${dateLabel(k.subjectsDue)}`];
    return ['info', 'Notified, to close'];
  }
  if (c.kind === 'CLIENT_CONSENT') {
    const d = c.consent!.decision;
    if (d === 'given') return ['ok', 'Consent given'];
    if (d === 'refused') return ['crit', 'Client refused'];
    return ['warn', c.consent!.advisedAt ? 'Waiting for client' : 'Advise client'];
  }
  return [c.social?.risk === 'high' ? 'crit' : 'warn', `${c.social?.risk ?? 'low'} risk`];
}

function CaseLine({ c, officer }: { c: Case; officer: boolean }) {
  const [open, setOpen] = useState(false);
  const [tone, label] = caseChip(c);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{c.title}</div>
          <div className="muted small">
            {c.companyName} · opened {dateTimeLabel(c.openedAt)} by {c.openedBy}
            {c.breach ? ` · ${c.breach.affected} people · ${c.breach.significantHarm ? 'significant harm' : 'no significant harm'}` : ''}
            {c.consent ? ` · ${c.consent.client}: ${c.consent.product}` : ''}
            {c.social ? ` · ${c.social.platform}` : ''}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Chip tone={tone}>{label}</Chip>
          <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : officer && c.status === 'open' ? 'Act' : 'Steps'}
          </button>
        </div>
      </div>
      {open && <CaseDetail c={c} officer={officer} />}
    </div>
  );
}

function CaseDetail({ c, officer }: { c: Case; officer: boolean }) {
  const docs = useLoad(() => api.pdpaDocs(c.id), [c.id, c.steps.length]);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const k = c.clock;
  const steps: [PdpaStepName, string, boolean][] = [];
  if (c.breach) {
    if (!c.breach.contained) steps.push(['contained', 'Contained', false]);
    if (!c.breach.commissionerAt) steps.push(['commissioner', 'Commissioner notified', true]);
    if (c.breach.significantHarm && !c.breach.subjectsAt) steps.push(['subjects', 'People notified', true]);
  }
  if (c.consent && c.consent.decision === 'pending') {
    if (!c.consent.advisedAt) steps.push(['advised', 'Client advised', false]);
    else steps.push(['consent_given', 'Consent given', true], ['consent_refused', 'Client refused', false]);
  }
  steps.push(['note', 'Add note', false], ['close', 'Close', false]);
  const run = (s: PdpaStepName) =>
    act
      .run(() => api.pdpaStep(c.id, s, note, proof), 'Saved.')
      .then((r) => {
        if (r) {
          setNote('');
          setProof([]);
        }
      });
  return (
    <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {c.detail && <div style={{ whiteSpace: 'pre-wrap' }}>{c.detail}</div>}
      {c.social?.link && <div className="muted">Link: {c.social.link}</div>}
      {k && (
        <div>
          Found {dateTimeLabel(c.breach!.detectedAt)}. Commissioner due {dateTimeLabel(k.commissionerDue)}
          {c.breach!.commissionerAt ? `, notified ${dateTimeLabel(c.breach!.commissionerAt)}` : ''}.
          {k.subjectsDue ? ` People due ${dateLabel(k.subjectsDue)}${c.breach!.subjectsAt ? `, notified ${dateTimeLabel(c.breach!.subjectsAt)}` : ''}.` : ''}
        </div>
      )}
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {c.steps.length === 0 && <li className="muted">No steps yet.</li>}
        {c.steps.map((s, i) => (
          <li key={i}>
            {s.what} · {s.by}, {dateTimeLabel(s.at)}
          </li>
        ))}
      </ul>
      {docs.data && <DocList docs={docs.data} />}
      {officer && c.status === 'open' && (
        <>
          <ProofPicker site={null} refText="PDPA" items={proof} onChange={setProof} documentsOnly />
          <input className="input" aria-label="Note" placeholder="Note (required to close)" value={note} onChange={(e) => setNote(e.target.value)} />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {steps.map(([s, label, needsProof]) => (
              <button
                key={s}
                className={`btn btn-sm${s === 'close' ? '' : ' btn-primary'}`}
                disabled={act.busy || (needsProof && !proof.length)}
                title={needsProof ? 'Attach the proof first' : undefined}
                onClick={() => run(s)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NewCase({ kind, companies, onDone }: { kind: Kind; companies: PdpaBoard['companies']; onDone: () => void }) {
  const [f, setF] = useState<PdpaCaseInput>({ kind, companyId: null, title: '', detail: '', affected: 0, significantHarm: false, risk: 'low' });
  const act = useAction();
  const set = (p: Partial<PdpaCaseInput>) => setF({ ...f, ...p });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
      <select className="select" aria-label="Company" value={f.companyId ?? ''} onChange={(e) => set({ companyId: e.target.value || null })}>
        <option value="">PWVSB (group)</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input className="input" aria-label="Title" placeholder="Title" value={f.title} onChange={(e) => set({ title: e.target.value })} />
      <textarea
        className="textarea"
        aria-label="What happened"
        placeholder="What happened"
        value={f.detail}
        onChange={(e) => set({ detail: e.target.value })}
      />
      {kind === 'BREACH' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="small">
            Found at{' '}
            <input
              className="input"
              type="datetime-local"
              aria-label="Found at"
              onChange={(e) => set({ detectedAt: e.target.value ? `${e.target.value}:00+08:00` : undefined })}
            />
          </label>
          <input
            className="input"
            type="number"
            min={0}
            aria-label="People affected"
            placeholder="People affected"
            value={f.affected || ''}
            onChange={(e) => set({ affected: Number(e.target.value) || 0 })}
          />
          <label className="small">
            <input type="checkbox" checked={!!f.significantHarm} onChange={(e) => set({ significantHarm: e.target.checked })} /> Significant harm likely
          </label>
        </div>
      )}
      {kind === 'CLIENT_CONSENT' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Client" placeholder="Client" value={f.client ?? ''} onChange={(e) => set({ client: e.target.value })} />
          <input
            className="input"
            aria-label="Product"
            placeholder="Product, e.g. CCTV"
            value={f.product ?? ''}
            onChange={(e) => set({ product: e.target.value })}
          />
        </div>
      )}
      {kind === 'SOCIAL' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Platform" placeholder="Platform" value={f.platform ?? ''} onChange={(e) => set({ platform: e.target.value })} />
          <input className="input" aria-label="Link" placeholder="Link" value={f.link ?? ''} onChange={(e) => set({ link: e.target.value })} />
          <select className="select" aria-label="Risk" value={f.risk} onChange={(e) => set({ risk: e.target.value as 'low' | 'medium' | 'high' })}>
            <option value="low">Low risk</option>
            <option value="medium">Medium risk</option>
            <option value="high">High risk</option>
          </select>
        </div>
      )}
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || f.title.trim().length < 3}
          onClick={() => act.run(() => api.openPdpaCase({ ...f, kind }), 'Case opened.').then((r) => r && onDone())}
        >
          Open case
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
