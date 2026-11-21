import { Select } from '../SearchSelect';
import { useEffect, useState } from 'react';
import { ChatCircleDotsIcon, ClockCountdownIcon, HandshakeIcon, PlusIcon, ShieldWarningIcon } from '@phosphor-icons/react';
import type { ProofInput } from '@prima/core';
import { api, type PdpaBoard, type PdpaCaseInput, type PdpaStepName } from '../api';
import { Card, Empty, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';
import { DocList, ProofPicker } from './Proof';
import { ProductsPanel, ProposalPanel } from './Products';
import { DpoPanel, RequestsPanel } from './PdpaRights';
import { BreachRegisterPanel, ConsentsPanel, RegisterPanel } from './PdpaRegister';
import '../styles/hrx.css';
import { useRouteTab } from '../App';
import { SopHelp } from '../sop/SopHelp';

/**
 * PDPA (Fauzan, 26 Oct 2026). The PDPA officer manages every personal data matter and is monitored by the Operations
 * Director. Breaches: the PDP Commissioner within 72 hours, and the affected people within 7 days of that when the
 * harm is significant. The officer advises clients and gets their consent before a product that needs it is used,
 * and monitors the group's social media.
 */

type Case = PdpaBoard['cases'][number];
type Extra = 'REGISTER' | 'CONSENTS' | 'BREACH_REGISTER' | 'PRODUCTS' | 'PROPOSAL' | 'REQUESTS' | 'DPO' | 'SETTINGS';

const EXTRA_LABEL: Record<Extra, string> = {
  REGISTER: 'Data register',
  CONSENTS: 'Consents',
  BREACH_REGISTER: 'Breach register',
  PRODUCTS: 'Products',
  PROPOSAL: 'Proposal check',
  REQUESTS: 'Data requests',
  DPO: 'DPO register',
  SETTINGS: 'Settings',
};

/** The time now, moving every 30 seconds, so the 72-hour clock counts down on screen without a reload. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Hours and minutes left (or late) to a deadline, for the breach clock. */
function countdown(due: string, now: number): { late: boolean; text: string } {
  const ms = Date.parse(due) - now;
  const mins = Math.floor(Math.abs(ms) / 60_000);
  const text = `${Math.floor(mins / 60)} h ${mins % 60} min`;
  return ms < 0 ? { late: true, text: `${text} late` } : { late: false, text: `${text} left` };
}
type Kind = Case['kind'];

const TAB_LABEL: Record<Kind, string> = { BREACH: 'Breaches', CLIENT_CONSENT: 'Client consent', SOCIAL: 'Social media' };
const PDPA_TABS: readonly (Kind | Extra)[] = [...(Object.keys(TAB_LABEL) as Kind[]), ...(Object.keys(EXTRA_LABEL) as Extra[])];

export function PdpaView() {
  const { data, error } = useLoad(() => api.pdpaBoard(), []);
  // P121: a link may open a section (#pdpa/REQUESTS); the screen itself is only for the PDPA officer and those who monitor.
  const [tab, setTab] = useRouteTab<Kind | Extra>('BREACH', PDPA_TABS);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
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
  const openCase = data.cases.find((c) => c.id === openId);
  const caseTab = tab === 'BREACH' || tab === 'CLIENT_CONSENT' || tab === 'SOCIAL';
  const go = (k: Kind) => {
    setTab(k);
    setAdding(false);
  };
  return (
    <div className="page">
      <PageHead
        title="PDPA"
        sub="The PDPA officer handles every personal data matter. The Operations Director, the Chief of Staff and the CEO monitor. A breach goes to the PDP Commissioner within 72 hours, and to the affected people within 7 days after that when the harm is significant."
        actions={<SopHelp id={tab === 'REQUESTS' || tab === 'DPO' ? 'board-pdpa-request' : 'board-pdpa-breach'} />}
      />
      {!data.settings.enabled && (
        <div className="notice" data-tone="warn" role="status">
          PDPA is switched off by the Chief of Staff: PDPA alerts do not show on the leaders' screens. Records are kept and the legal duties still apply.
        </div>
      )}
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
        {(Object.keys(EXTRA_LABEL) as Extra[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {EXTRA_LABEL[k]}
          </button>
        ))}
      </div>
      {tab === 'REGISTER' && <RegisterPanel />}
      {tab === 'CONSENTS' && <ConsentsPanel />}
      {tab === 'BREACH_REGISTER' && <BreachRegisterPanel data={data} />}
      {tab === 'PRODUCTS' && <ProductsPanel />}
      {tab === 'PROPOSAL' && <ProposalPanel />}
      {tab === 'REQUESTS' && <RequestsPanel />}
      {tab === 'DPO' && <DpoPanel />}
      {tab === 'SETTINGS' && <SettingsPanel s={data.settings} />}
      {caseTab && (
        <section className="k-card">
          <div className="k-card-head">
            <div className="k-card-title">
              <h2>{TAB_LABEL[tab as Kind]}</h2>
              <p>
                {inTab.length} case{inTab.length === 1 ? '' : 's'}
                {closedCount > 0 ? `, ${closedCount} closed` : ''}
              </p>
            </div>
            <div className="k-card-actions">
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
              <NewCase kind={tab as Kind} companies={data.companies} onDone={() => setAdding(false)} />
            </div>
          )}
          <DataTable
            key={tab}
            label={TAB_LABEL[tab as Kind]}
            stateKey={`board.pdpa.cases.${tab}`}
            rows={inTab}
            rowKey={(c) => c.id}
            columns={caseColumns(tab as Kind)}
            filters={CASE_FILTERS}
            searchText={(c) => c.openedBy}
            onRowClick={(c) => setOpenId(c.id)}
            rowTone={(c) => {
              if (c.status === 'closed') return undefined;
              const t = caseChip(c, Date.now())[0];
              return t === 'crit' ? 'crit' : t === 'warn' ? 'warn' : undefined;
            }}
            actions={(c) => [{ label: officer && c.status === 'open' ? 'Act' : 'Steps', onClick: () => setOpenId(c.id) }]}
            empty={<Empty title="Nothing here." />}
          />
          {openCase && (
            <Drawer title={openCase.title} sub={`${openCase.companyName} · opened ${dateTimeLabel(openCase.openedAt)} by ${openCase.openedBy}`} onClose={() => setOpenId(null)}>
              <CaseDetail c={openCase} officer={officer} />
            </Drawer>
          )}
        </section>
      )}
    </div>
  );
}

function caseChip(c: Case, now: number): [Tone, string] {
  if (c.status === 'closed') return ['ok', 'Closed'];
  const k = c.clock;
  if (c.kind === 'BREACH' && k) {
    if (!c.breach!.commissionerAt) {
      const left = countdown(k.commissionerDue, now);
      return left.late ? ['crit', `Commissioner: ${left.text}`] : ['warn', `Commissioner: ${left.text}`];
    }
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

/** The status chip, its countdown kept current. */
function CaseChip({ c }: { c: Case }) {
  const now = useNow();
  const [tone, label] = caseChip(c, now);
  return <Chip tone={tone}>{label}</Chip>;
}

function caseColumns(kind: Kind): DtColumn<Case>[] {
  const extra: DtColumn<Case>[] =
    kind === 'BREACH'
      ? [
          { id: 'affected', label: 'People', value: (c) => c.breach?.affected, sort: 'number' },
          { id: 'harm', label: 'Significant harm', value: (c) => (c.breach?.significantHarm ? 'Yes' : 'No'), translate: true, hideBelow: 1100 },
        ]
      : kind === 'CLIENT_CONSENT'
        ? [
            { id: 'client', label: 'Client', value: (c) => c.consent?.client },
            { id: 'product', label: 'Product', value: (c) => c.consent?.product, hideBelow: 1100 },
          ]
        : [{ id: 'platform', label: 'Platform', value: (c) => c.social?.platform }];
  return [
    { id: 'opened', label: 'Opened', value: (c) => c.openedAt, sort: 'date', render: (c) => dateTimeLabel(c.openedAt), width: '10rem' },
    { id: 'title', label: 'Case', value: (c) => c.title, render: (c) => <strong>{c.title}</strong>, phone: 'title' },
    { id: 'company', label: 'Company', value: (c) => c.companyName, phone: 'sub' },
    ...extra,
    { id: 'by', label: 'Opened by', value: (c) => c.openedBy, hideBelow: 1200 },
    { id: 'status', label: 'Status', value: (c) => caseChip(c, Date.now())[1], translate: true, render: (c) => <CaseChip c={c} /> },
  ];
}
const CASE_FILTERS: DtFilter<Case>[] = [
  { id: 'status', label: 'Status', value: (c) => (c.status === 'closed' ? 'closed' : 'open'), options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
  { id: 'company', label: 'Company', value: (c) => c.companyName },
  { id: 'platform', label: 'Platform', value: (c) => c.social?.platform },
];

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
      {c.breach && (
        <p className="hx-row-meta">
          Data involved: {c.breach.dataKinds || 'not recorded'} · Cause: {c.breach.cause || 'not recorded'}
          {c.breach.remedy ? ` · Action taken: ${c.breach.remedy}` : ''}
        </p>
      )}
      {c.breach && officer && c.status === 'open' && <BreachDetails c={c} />}
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

/**
 * PDPA settings (Fauzan, 5 Nov 2026): the Chief of Staff switches PDPA on or off; the PDPA officer or the Chief of Staff
 * sets how long the breach register is kept, never under 2 years. Every change needs a reason and is kept in the history.
 */
function SettingsPanel({ s }: { s: PdpaBoard['settings'] }) {
  const [years, setYears] = useState(String(s.keepYears));
  const [reason, setReason] = useState('');
  const act = useAction();
  const yearsNum = Number(years);
  const yearsOk = Number.isInteger(yearsNum) && yearsNum >= 2 && yearsNum <= 20 && yearsNum !== s.keepYears;
  const done = () => setReason('');
  return (
    <Card title="Settings" actions={<Chip tone={s.enabled ? 'ok' : 'warn'}>{s.enabled ? 'PDPA on' : 'PDPA off'}</Chip>}>
      {!s.installed && (
        <div className="notice" data-tone="warn" role="status">
          The PDPA settings are not installed in the database yet. They are installed when the CEO runs the database update.
        </div>
      )}
      <ul className="hx-rows">
        <li className="hx-row">
          <div className="hx-row-main">
            <span className="hx-row-title">PDPA on or off</span>
            <span className="hx-row-meta">Only the Chief of Staff switches this. When off, PDPA alerts do not show on the leaders' screens. Records are kept.</span>
          </div>
        </li>
        <li className="hx-row">
          <div className="hx-row-main">
            <span className="hx-row-title">{`Breach register kept for ${s.keepYears} years`}</span>
            <span className="hx-row-meta">Set by the PDPA officer or the Chief of Staff. The law needs at least 2 years.</span>
          </div>
        </li>
      </ul>
      {s.installed && (s.canSwitch || s.canSetKeep) && (
        <div className="hx-form">
          <label className="field">
            <span className="label">Reason for the change</span>
            <input className="input" aria-label="Reason for the change" placeholder="Reason for the change" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <ErrorNotice error={act.error} />
          <div className="hx-form-actions">
            {s.canSwitch && (
              <button
                className="btn btn-sm"
                disabled={act.busy || reason.trim().length < 3}
                onClick={() => act.run(() => api.setPdpaSettings({ enabled: !s.enabled }, reason), 'Saved.').then((r) => r && done())}
              >
                {s.enabled ? 'Switch PDPA off' : 'Switch PDPA on'}
              </button>
            )}
            {s.canSetKeep && (
              <>
                <input
                  className="input"
                  style={{ width: 90 }}
                  type="number"
                  min={2}
                  max={20}
                  aria-label="Years to keep the breach register"
                  value={years}
                  onChange={(e) => setYears(e.target.value)}
                />
                <button
                  className="btn btn-sm"
                  disabled={act.busy || !yearsOk || reason.trim().length < 3}
                  onClick={() => act.run(() => api.setPdpaSettings({ keepYears: yearsNum }, reason), 'Saved.').then((r) => r && done())}
                >
                  Save keep period
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {s.history.length > 0 && (
        <ul className="hx-rows">
          {[...s.history].reverse().map((h, i) => (
            <li className="hx-row" key={i}>
              <div className="hx-row-main">
                <span className="hx-row-title">{h.what}</span>
                <span className="hx-row-meta">
                  {h.by} · {dateTimeLabel(h.at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The breach register details; a breach cannot close without the data involved and the cause. */
function BreachDetails({ c }: { c: Case }) {
  const b = c.breach!;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ dataKinds: b.dataKinds ?? '', cause: b.cause ?? '', remedy: b.remedy ?? '' });
  const act = useAction();
  if (!open)
    return (
      <div>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
          {b.dataKinds && b.cause ? 'Update breach register details' : 'Record breach register details'}
        </button>
      </div>
    );
  return (
    <div className="hx-form">
      <h3 className="hx-form-title">Breach register details</h3>
      <div className="hx-form-grid">
        <label className="field">
          <span className="label">Data involved</span>
          <input className="input" aria-label="Data involved" placeholder="Personal data involved, e.g. names and IC numbers" value={f.dataKinds} onChange={(e) => setF({ ...f, dataKinds: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Cause</span>
          <input className="input" aria-label="Cause" placeholder="How it happened" value={f.cause} onChange={(e) => setF({ ...f, cause: e.target.value })} />
        </label>
        <label className="field hx-form-wide">
          <span className="label">Action taken</span>
          <input className="input" aria-label="Action taken" placeholder="What was done so it does not happen again" value={f.remedy} onChange={(e) => setF({ ...f, remedy: e.target.value })} />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="hx-form-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !f.dataKinds.trim() || f.cause.trim().length < 3}
          onClick={() => act.run(() => api.pdpaBreachDetails(c.id, f), 'Saved.').then((r) => r && setOpen(false))}
        >
          Save details
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
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
          <Select className="select" aria-label="Company" value={f.companyId ?? ''} onChange={(e) => set({ companyId: e.target.value || null })}>
            <option value="">PWVSB (group)</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
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
            <label className="field">
              <span className="label">Data involved</span>
              <input className="input" aria-label="Data involved" placeholder="Personal data involved" value={f.dataKinds ?? ''} onChange={(e) => set({ dataKinds: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Cause</span>
              <input className="input" aria-label="Cause" placeholder="How it happened (if known)" value={f.cause ?? ''} onChange={(e) => set({ cause: e.target.value })} />
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
