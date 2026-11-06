import { useState } from 'react';
import { ChatCircleDotsIcon, ClockCountdownIcon, HandshakeIcon, PlusIcon, ShieldWarningIcon } from '@phosphor-icons/react';
import type { ProofInput } from '@prima/core';
import { api, type PdpaBoard, type PdpaCaseInput, type PdpaStepName } from '../api';
import { Empty, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { DocList, ProofPicker } from './Proof';
import { ProductsPanel, ProposalPanel } from './Products';
import { DpoPanel, RequestsPanel } from './PdpaRights';
import '../styles/hrx.css';

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
  const [shut, setShut] = useState(true);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="PDPA" />
      </div>
    );
  const officer = data.role === 'officer';
  const inTab = data.cases.filter((c) => c.kind === tab);
  const closedCount = inTab.filter((c) => c.status === 'closed').length;
  const rows = shut ? inTab : inTab.filter((c) => c.status !== 'closed');
  const caseTab = tab !== 'PRODUCTS' && tab !== 'PROPOSAL' && tab !== 'REQUESTS' && tab !== 'DPO';
  const go = (k: Kind) => {
    setTab(k);
    setAdding(false);
  };
  return (
    <div className="page">
      <PageHead
        title="PDPA"
        sub="The PDPA officer handles every personal data matter. The Operations Director monitors. A breach goes to the PDP Commissioner within 72 hours, and to the affected people within 7 days after that when the harm is significant."
      />
      {data.counts.late > 0 && (
        <div className="notice" data-tone="crit" role="alert">
          {data.counts.late} breach{data.counts.late === 1 ? '' : 'es'} past the legal notice time.
        </div>
      )}
      <Stats>
        <Stat
          label="Open breaches"
          value={data.counts.breachesOpen}
          tone={data.counts.breachesOpen ? 'warn' : 'ok'}
          icon={<ShieldWarningIcon size={16} />}
          note="72 hours to tell the Commissioner"
          onClick={() => go('BREACH')}
        />
        <Stat
          label="Late notices"
          value={data.counts.late}
          tone={data.counts.late ? 'crit' : 'ok'}
          icon={<ClockCountdownIcon size={16} />}
          note="Past the legal notice time"
          onClick={() => go('BREACH')}
        />
        <Stat
          label="Client consent pending"
          value={data.counts.consentPending}
          tone={data.counts.consentPending ? 'warn' : 'ok'}
          icon={<HandshakeIcon size={16} />}
          onClick={() => go('CLIENT_CONSENT')}
        />
        <Stat
          label="Social media open"
          value={data.counts.socialOpen}
          tone={data.counts.socialOpen ? 'warn' : 'ok'}
          icon={<ChatCircleDotsIcon size={16} />}
          onClick={() => go('SOCIAL')}
        />
      </Stats>
      <div className="tabbar hx-tabs" role="tablist" aria-label="PDPA sections">
        {(Object.keys(TAB_LABEL) as Kind[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => go(k)}>
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
        <section className="k-card">
          <div className="k-card-head">
            <div className="k-card-title">
              <h2>{TAB_LABEL[tab]}</h2>
              <p>
                {rows.length} case{rows.length === 1 ? '' : 's'}
                {closedCount > 0 ? (shut ? `, ${closedCount} closed` : ` open, ${closedCount} closed hidden`) : ''}
              </p>
            </div>
            <div className="k-card-actions">
              {closedCount > 0 && (
                <button className="btn btn-ghost btn-sm" aria-pressed={shut} onClick={() => setShut(!shut)}>
                  {shut ? 'Hide closed' : 'Show closed'}
                </button>
              )}
              {data.canAdd && !adding && (
                <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
                  <PlusIcon size={14} weight="bold" aria-hidden="true" />
                  Open a case
                </button>
              )}
            </div>
          </div>
          {adding && (
            <div className="pd-new">
              <NewCase kind={tab} companies={data.companies} onDone={() => setAdding(false)} />
            </div>
          )}
          {rows.length === 0 ? (
            <Empty title="Nothing here." />
          ) : (
            <ul className="hx-rows">
              {rows.map((c) => (
                <CaseLine key={c.id} c={c} officer={officer} />
              ))}
            </ul>
          )}
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

/** Where a breach or a consent request is in its legal steps, from the dates on the case. */
function caseSteps(c: Case): { label: string; state: StepState; note?: string }[] | null {
  const closed = c.status === 'closed';
  const at = (done: boolean, now: boolean): StepState => (done ? 'done' : now ? 'now' : 'todo');
  if (c.breach) {
    const b = c.breach;
    const k = c.clock;
    const s: { label: string; state: StepState; note?: string }[] = [
      { label: 'Found', state: 'done', note: dateTimeLabel(b.detectedAt) },
      { label: 'Contained', state: at(!!b.contained, !b.contained && !closed) },
      {
        label: 'Commissioner notified',
        state: b.commissionerAt ? 'done' : k?.commissionerLate ? 'stopped' : at(false, !closed),
        note: b.commissionerAt ? dateTimeLabel(b.commissionerAt) : k ? `due ${dateTimeLabel(k.commissionerDue)}` : undefined,
      },
    ];
    if (b.significantHarm)
      s.push({
        label: 'People notified',
        state: b.subjectsAt ? 'done' : k?.subjectsLate ? 'stopped' : at(false, !!b.commissionerAt && !closed),
        note: b.subjectsAt ? dateTimeLabel(b.subjectsAt) : k?.subjectsDue ? `due ${dateLabel(k.subjectsDue)}` : undefined,
      });
    s.push({ label: 'Closed', state: closed ? 'done' : 'todo' });
    return s;
  }
  if (c.consent) {
    const d = c.consent.decision;
    return [
      { label: 'Client advised', state: at(!!c.consent.advisedAt, !c.consent.advisedAt && !closed) },
      {
        label: d === 'refused' ? 'Client refused' : 'Consent given',
        state: d === 'given' ? 'done' : d === 'refused' ? 'stopped' : at(false, !!c.consent.advisedAt && !closed),
      },
      { label: 'Closed', state: closed ? 'done' : 'todo' },
    ];
  }
  return null;
}

function CaseLine({ c, officer }: { c: Case; officer: boolean }) {
  const [open, setOpen] = useState(false);
  const [tone, label] = caseChip(c);
  return (
    <li className="hx-row" data-tone={c.status === 'closed' ? undefined : tone === 'crit' ? 'crit' : tone === 'warn' ? 'warn' : undefined}>
      <div className="hx-row-main">
        <span className="hx-row-title">{c.title}</span>
        <span className="hx-row-meta">
          {c.companyName} · opened {dateTimeLabel(c.openedAt)} by {c.openedBy}
        </span>
        {(c.breach || c.consent || c.social) && (
          <span className="hx-row-meta">
            {c.breach ? `${c.breach.affected} people · ${c.breach.significantHarm ? 'significant harm' : 'no significant harm'}` : ''}
            {c.consent ? `${c.consent.client}: ${c.consent.product}` : ''}
            {c.social ? c.social.platform : ''}
          </span>
        )}
      </div>
      <div className="hx-row-side">
        <Chip tone={tone}>{label}</Chip>
        <button className={`btn btn-sm${officer && c.status === 'open' && !open ? '' : ' btn-ghost'}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : officer && c.status === 'open' ? 'Act' : 'Steps'}
        </button>
      </div>
      {open && (
        <div className="hx-row-body">
          <CaseDetail c={c} officer={officer} />
        </div>
      )}
    </li>
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
  const progress = caseSteps(c);
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
    <div className="pd-detail">
      {progress && <Steps steps={progress} />}
      {c.detail && <p className="pd-text">{c.detail}</p>}
      {c.social?.link && <p className="hx-row-meta">Link: {c.social.link}</p>}
      {k && (
        <p className="hx-row-meta">
          Found {dateTimeLabel(c.breach!.detectedAt)}. Commissioner due {dateTimeLabel(k.commissionerDue)}
          {c.breach!.commissionerAt ? `, notified ${dateTimeLabel(c.breach!.commissionerAt)}` : ''}.
          {k.subjectsDue ? ` People due ${dateLabel(k.subjectsDue)}${c.breach!.subjectsAt ? `, notified ${dateTimeLabel(c.breach!.subjectsAt)}` : ''}.` : ''}
        </p>
      )}
      <div className="pd-sec">
        <span className="label">What was done</span>
        <ol className="pd-log">
          {c.steps.length === 0 && <li className="muted">No steps yet.</li>}
          {c.steps.map((s, i) => (
            <li key={i}>
              <span>{s.what}</span>
              <span className="muted small">
                {s.by}, {dateTimeLabel(s.at)}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {docs.data && <DocList docs={docs.data} />}
      {officer && c.status === 'open' && (
        <div className="hx-form">
          <h3 className="hx-form-title">Record the next step</h3>
          <ProofPicker site={null} refText="PDPA" items={proof} onChange={setProof} documentsOnly />
          <label className="field">
            <span className="label">Note</span>
            <input className="input" aria-label="Note" placeholder="Note (required to close)" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <ErrorNotice error={act.error} />
          <div className="hx-form-actions">
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
        </div>
      )}
    </div>
  );
}

function NewCase({ kind, companies, onDone }: { kind: Kind; companies: PdpaBoard['companies']; onDone: () => void }) {
  const [f, setF] = useState<PdpaCaseInput>({ kind, companyId: null, title: '', detail: '', affected: 0, significantHarm: false, risk: 'low' });
  const act = useAction();
  const set = (p: Partial<PdpaCaseInput>) => setF({ ...f, ...p });
  return (
    <div className="hx-form">
      <h3 className="hx-form-title">New case: {TAB_LABEL[kind].toLowerCase()}</h3>
      <div className="hx-form-grid">
        <label className="field">
          <span className="label">Company</span>
          <select className="select" aria-label="Company" value={f.companyId ?? ''} onChange={(e) => set({ companyId: e.target.value || null })}>
            <option value="">PWVSB (group)</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Title</span>
          <input className="input" aria-label="Title" placeholder="Title" value={f.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="field hx-form-wide">
          <span className="label">What happened</span>
          <textarea className="textarea" aria-label="What happened" placeholder="What happened" value={f.detail} onChange={(e) => set({ detail: e.target.value })} />
        </label>
        {kind === 'BREACH' && (
          <>
            <label className="field">
              <span className="label">Found at</span>
              <input
                className="input"
                type="datetime-local"
                aria-label="Found at"
                onChange={(e) => set({ detectedAt: e.target.value ? `${e.target.value}:00+08:00` : undefined })}
              />
            </label>
            <label className="field">
              <span className="label">People affected</span>
              <input
                className="input"
                type="number"
                min={0}
                aria-label="People affected"
                placeholder="People affected"
                value={f.affected || ''}
                onChange={(e) => set({ affected: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="pd-check hx-form-wide">
              <input type="checkbox" checked={!!f.significantHarm} onChange={(e) => set({ significantHarm: e.target.checked })} /> Significant harm likely
            </label>
          </>
        )}
        {kind === 'CLIENT_CONSENT' && (
          <>
            <label className="field">
              <span className="label">Client</span>
              <input className="input" aria-label="Client" placeholder="Client" value={f.client ?? ''} onChange={(e) => set({ client: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Product</span>
              <input className="input" aria-label="Product" placeholder="Product, e.g. CCTV" value={f.product ?? ''} onChange={(e) => set({ product: e.target.value })} />
            </label>
          </>
        )}
        {kind === 'SOCIAL' && (
          <>
            <label className="field">
              <span className="label">Platform</span>
              <input className="input" aria-label="Platform" placeholder="Platform" value={f.platform ?? ''} onChange={(e) => set({ platform: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Link</span>
              <input className="input" aria-label="Link" placeholder="Link" value={f.link ?? ''} onChange={(e) => set({ link: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Risk</span>
              <select className="select" aria-label="Risk" value={f.risk} onChange={(e) => set({ risk: e.target.value as 'low' | 'medium' | 'high' })}>
                <option value="low">Low risk</option>
                <option value="medium">Medium risk</option>
                <option value="high">High risk</option>
              </select>
            </label>
          </>
        )}
      </div>
      <ErrorNotice error={act.error} />
      <div className="hx-form-actions">
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
