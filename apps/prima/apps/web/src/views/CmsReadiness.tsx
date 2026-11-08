// CMS site readiness (audit decision 4, Fauzan 5 Nov 2026): what each site has and what is prepared before CMS links to
// it. The device brand is the client's choice. Nothing on this screen connects a device.
import { useState } from 'react';
import { api } from '../api';
import type { CmsDeviceInput, CmsReadinessBoard } from '../api/types';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';

type Row = CmsReadinessBoard['sites'][number];
type Status = Row['view']['status'];
type Kinds = CmsReadinessBoard['deviceKinds'];
type DeviceKind = keyof Kinds;

const STATUS_TONE: Record<Status, Tone> = {
  not_started: 'unknown',
  in_progress: 'warn',
  needs_fix: 'crit',
  ready_for_check: 'info',
  ready_to_connect: 'ok',
};

const ITEM_TONE: Record<Row['view']['items'][number]['state'], Tone> = { done: 'ok', gap: 'crit', unknown: 'unknown', not_needed: 'neutral' };
const ITEM_LABEL: Record<Row['view']['items'][number]['state'], string> = { done: 'Done', gap: 'Gap', unknown: 'Not known yet', not_needed: 'Not needed' };
const VALUE_LABEL = { yes: 'Yes', no: 'No', unknown: 'Not known yet' } as const;

export function CmsReadinessView() {
  const { data, error } = useLoad(() => api.cmsReadiness(), []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="CMS site readiness" />
      </div>
    );
  const ql = q.trim().toLowerCase();
  const rows = data.sites.filter(
    (r) =>
      (status === 'all' || r.view.status === status) &&
      (!ql || [r.site.name, r.site.code, r.site.client, r.companyName].some((x) => x.toLowerCase().includes(ql))),
  );
  const row = open ? data.sites.find((r) => r.site.id === open) ?? null : null;
  const t = data.tiles;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>CMS site readiness</h1>
          <p>{data.notice}</p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" placeholder="Search site, client or company" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as Status | 'all')} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="needs_fix">Needs fixing</option>
            <option value="ready_for_check">Waiting for check</option>
            <option value="in_progress">In progress</option>
            <option value="not_started">Not started</option>
            <option value="ready_to_connect">Ready to connect</option>
          </select>
        </div>
      </div>
      <div className="kpis">
        <Kpi label="Sites" value={t.sites} />
        <Kpi label="Needs fixing" value={t.needsFix} tone={t.needsFix ? 'crit' : undefined} />
        <Kpi label="Waiting for check" value={t.waitingCheck} tone={t.waitingCheck ? 'info' : undefined} />
        <Kpi label="In progress" value={t.inProgress} />
        <Kpi label="Not started" value={t.notStarted} tone={t.notStarted ? 'unknown' : undefined} />
        <Kpi label="Ready to connect" value={t.readyToConnect} note="Prepared and checked" tone={t.readyToConnect ? 'ok' : undefined} />
        <Kpi label="Connected" value={t.connected} note="Connections come later" />
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th className="hide-sm">Company</th>
                <th className="num">Done</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.site.id} className="clickable" onClick={() => setOpen(r.site.id)}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.site.name}</div>
                    <div className="muted small">
                      <span className="mono">{r.site.code}</span> · {r.site.client}
                      {r.readiness.devices.length > 0 && ` · ${r.readiness.devices.map((d) => d.brand).join(', ')}`}
                    </div>
                  </td>
                  <td className="hide-sm">{r.companyName}</td>
                  <td className="num">
                    {r.view.done} / {r.view.total}
                  </td>
                  <td>
                    <Chip tone={STATUS_TONE[r.view.status]}>{r.view.statusLabel}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">{data.sites.length ? 'No site matches.' : 'No sites you can see.'}</div>}
        </div>
      </section>
      {row && <SiteReadiness row={row} kinds={data.deviceKinds} items={data.items} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SiteReadiness({
  row,
  kinds,
  items,
  onClose,
}: {
  row: Row;
  kinds: Kinds;
  items: CmsReadinessBoard['items'];
  onClose: () => void;
}) {
  const [editDevice, setEditDevice] = useState<string | 'new' | null>(null);
  const [editItem, setEditItem] = useState<string | null>(null);
  const v = row.view;
  return (
    <Drawer title={row.site.name} sub={`${row.site.code} · ${row.site.client} · ${row.companyName}`} onClose={onClose}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Chip tone={STATUS_TONE[v.status]}>{v.statusLabel}</Chip>
        <span className="muted small">
          {v.done} of {v.total} done · Not connected: device links come later.
        </span>
      </div>
      {v.returned && (
        <div className="notice" data-tone="warn" style={{ marginTop: 8 }}>
          Returned by {v.returned.by} on {dateTimeLabel(v.returned.at)}: {v.returned.note}
        </div>
      )}
      {v.check && (
        <div className="notice" data-tone="ok" style={{ marginTop: 8 }}>
          Checked by {v.check.by} on {dateTimeLabel(v.check.at)}: {v.check.note}
        </div>
      )}
      {v.staleCheck && (
        <div className="notice" data-tone="warn" style={{ marginTop: 8 }}>
          Checked earlier by {v.staleCheck.by}, but things changed since. It needs a new check.
        </div>
      )}

      <section>
        <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
          <h3>Devices at the site</h3>
          {row.canRecord && editDevice === null && (
            <button className="btn btn-sm" onClick={() => setEditDevice('new')}>
              Add device
            </button>
          )}
        </div>
        <p className="muted small">The brand is the client’s choice. Record what the client chose and where they wrote it.</p>
        {editDevice === 'new' && <DeviceForm siteId={row.site.id} kinds={kinds} onDone={() => setEditDevice(null)} />}
        <div className="list">
          {row.readiness.devices.length === 0 && <div className="empty">No devices listed yet.</div>}
          {row.readiness.devices.map((d) =>
            editDevice === d.id ? (
              <DeviceForm key={d.id} siteId={row.site.id} kinds={kinds} device={d} onDone={() => setEditDevice(null)} />
            ) : (
              <div key={d.id} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {kinds[d.kind].label}: {d.brand}
                    {d.model && ` ${d.model}`} × {d.count}
                  </div>
                  <div className="muted small">
                    Owner {d.owner} · Client choice: {d.clientChoiceRef || 'not referenced yet'} · Vendor: {d.vendorName || '—'} {d.vendorPhone}
                  </div>
                  <div className="muted small">
                    Link: {d.linkMethod || 'not known'} · Vendor confirmed: {VALUE_LABEL[d.linkConfirmed]}
                    {d.note && ` · ${d.note}`}
                  </div>
                  <div className="muted small">
                    Recorded by {d.by}, {dateTimeLabel(d.at)}
                  </div>
                </div>
                {row.canRecord && editDevice === null && (
                  <button className="btn btn-sm" onClick={() => setEditDevice(d.id)}>
                    Edit
                  </button>
                )}
              </div>
            ),
          )}
        </div>
      </section>

      <section>
        <h3>Checklist</h3>
        <div className="list">
          {v.items.map((i) => {
            const spec = items.find((s) => s.key === i.key);
            const answer = spec ? row.readiness.answers[spec.key] : undefined;
            return (
              <div key={i.key} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'nowrap' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{i.label}</div>
                    <div className="muted small">{i.detail}</div>
                    {answer && (
                      <div className="muted small">
                        {answer.by}, {dateTimeLabel(answer.at)}
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <Chip tone={ITEM_TONE[i.state]}>{ITEM_LABEL[i.state]}</Chip>
                    {spec && row.canRecord && i.state !== 'not_needed' && editItem !== i.key && (
                      <button className="btn btn-sm" onClick={() => setEditItem(i.key)}>
                        Answer
                      </button>
                    )}
                  </div>
                </div>
                {spec && editItem === i.key && <AnswerForm siteId={row.site.id} spec={spec} answer={answer} onDone={() => setEditItem(null)} />}
              </div>
            );
          })}
        </div>
      </section>

      {row.checker && <ReviewPanel row={row} />}
    </Drawer>
  );
}

type DeviceRow = Row['readiness']['devices'][number];

function DeviceForm({ siteId, kinds, device, onDone }: { siteId: string; kinds: Kinds; device?: DeviceRow; onDone: () => void }) {
  const [f, setF] = useState<CmsDeviceInput>(
    device
      ? { ...device }
      : {
          kind: 'CCTV_RECORDER',
          brand: '',
          model: '',
          count: 1,
          owner: 'client',
          clientChoiceRef: '',
          vendorName: '',
          vendorPhone: '',
          linkMethod: '',
          linkConfirmed: 'unknown',
          note: '',
        },
  );
  const [reason, setReason] = useState('');
  const { run, busy, error } = useAction();
  const set = (k: keyof CmsDeviceInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === 'count' ? Number(e.target.value) : e.target.value });
  const kind = (f.kind ?? 'CCTV_RECORDER') as DeviceKind;
  const save = async () => {
    const r = await run(() => api.saveCmsReadinessDevice(siteId, { ...f, id: device?.id }), 'Device saved');
    if (r) onDone();
  };
  const remove = async () => {
    if (!device) return;
    const r = await run(() => api.removeCmsReadinessDevice(siteId, device.id, reason), 'Device removed');
    if (r) onDone();
  };
  const id = (k: string) => `crd-${device?.id ?? 'new'}-${k}`;
  return (
    <div className="list" style={{ gap: 10, margin: '10px 0' }}>
      <ErrorNotice error={error} />
      <div className="field">
        <label htmlFor={id('kind')}>Kind</label>
        <select id={id('kind')} className="select" value={kind} onChange={set('kind')}>
          {(Object.keys(kinds) as DeviceKind[]).map((k) => (
            <option key={k} value={k}>
              {kinds[k].label}
            </option>
          ))}
        </select>
        <div className="muted small">{kinds[kind].linkHint}</div>
      </div>
      <div className="field">
        <label htmlFor={id('brand')}>Brand the client chose</label>
        <input id={id('brand')} className="input" value={f.brand ?? ''} onChange={set('brand')} />
      </div>
      <div className="field">
        <label htmlFor={id('model')}>Model</label>
        <input id={id('model')} className="input" value={f.model ?? ''} onChange={set('model')} />
      </div>
      <div className="field">
        <label htmlFor={id('count')}>How many</label>
        <input id={id('count')} className="input" type="number" min={1} max={500} value={f.count ?? 1} onChange={set('count')} />
      </div>
      <div className="field">
        <label htmlFor={id('owner')}>Owner</label>
        <select id={id('owner')} className="select" value={f.owner} onChange={set('owner')}>
          <option value="client">Client</option>
          <option value="company">Security company</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={id('ref')}>Where the client chose the brand</label>
        <input id={id('ref')} className="input" placeholder="e.g. Client email 1 Nov, PO 1234, contract clause 7" value={f.clientChoiceRef ?? ''} onChange={set('clientChoiceRef')} />
      </div>
      <div className="field">
        <label htmlFor={id('vendor')}>Installer or vendor</label>
        <input id={id('vendor')} className="input" value={f.vendorName ?? ''} onChange={set('vendorName')} />
      </div>
      <div className="field">
        <label htmlFor={id('phone')}>Vendor phone</label>
        <input id={id('phone')} className="input" inputMode="tel" value={f.vendorPhone ?? ''} onChange={set('vendorPhone')} />
      </div>
      <div className="field">
        <label htmlFor={id('link')}>How it can share health and events (vendor’s answer)</label>
        <input id={id('link')} className="input" placeholder="e.g. ONVIF Profile S, SIA DC-09, brand API" value={f.linkMethod ?? ''} onChange={set('linkMethod')} />
      </div>
      <div className="field">
        <label htmlFor={id('confirmed')}>Vendor confirmed in writing</label>
        <select id={id('confirmed')} className="select" value={f.linkConfirmed} onChange={set('linkConfirmed')}>
          <option value="unknown">Not known yet</option>
          <option value="yes">Yes</option>
          <option value="no">No, it cannot yet</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={id('note')}>Note</label>
        <input id={id('note')} className="input" value={f.note ?? ''} onChange={set('note')} />
        <div className="muted small">Never type a password, PIN or code here.</div>
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          Save
        </button>
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
      {device && (
        <div className="row" style={{ gap: 6 }}>
          <input className="input" placeholder="Why remove it" aria-label="Why remove it" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn" disabled={busy || !reason.trim()} onClick={remove}>
            Remove device
          </button>
        </div>
      )}
    </div>
  );
}

function AnswerForm({
  siteId,
  spec,
  answer,
  onDone,
}: {
  siteId: string;
  spec: CmsReadinessBoard['items'][number];
  answer?: Row['readiness']['answers'][keyof Row['readiness']['answers']];
  onDone: () => void;
}) {
  const [value, setValue] = useState<'yes' | 'no' | 'unknown'>(answer?.value ?? 'yes');
  const [note, setNote] = useState(answer?.note ?? '');
  const [ref, setRef] = useState(answer?.ref ?? '');
  const { run, busy, error } = useAction();
  const save = async () => {
    const r = await run(() => api.setCmsReadinessAnswer(siteId, spec.key, { value, note, ref: ref || null }), 'Saved');
    if (r) onDone();
  };
  return (
    <div className="list" style={{ gap: 10, marginTop: 10 }}>
      <div className="muted small">{spec.help}</div>
      <ErrorNotice error={error} />
      <div className="field">
        <label htmlFor={`ans-${spec.key}`}>Answer</label>
        <select id={`ans-${spec.key}`} className="select" value={value} onChange={(e) => setValue(e.target.value as typeof value)}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
          <option value="unknown">Not known yet</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`note-${spec.key}`}>{value === 'no' ? 'What is missing' : 'Note'}</label>
        <input id={`note-${spec.key}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {spec.needsRef && (
        <div className="field">
          <label htmlFor={`ref-${spec.key}`}>Proof reference</label>
          <input id={`ref-${spec.key}`} className="input" placeholder="Report, letter or photo reference" value={ref} onChange={(e) => setRef(e.target.value)} />
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          Save
        </button>
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ReviewPanel({ row }: { row: Row }) {
  const [note, setNote] = useState('');
  const { run, busy, error } = useAction();
  const v = row.view;
  const review = (decision: 'pass' | 'return') =>
    run(() => api.reviewCmsReadiness(row.site.id, { decision, note, fingerprint: v.fingerprint }), decision === 'pass' ? 'Checked: ready to connect' : 'Returned to the company');
  if (!row.canCheck)
    return (
      <section>
        <h3>Arms Control check</h3>
        <p className="muted small">You recorded part of this site’s readiness, so another Arms Control officer checks it.</p>
      </section>
    );
  return (
    <section>
      <h3>Arms Control check</h3>
      <p className="muted small">Passing means the site is prepared. It does not connect any device.</p>
      <ErrorNotice error={error} />
      <div className="field">
        <label htmlFor="crd-review-note">Your reason</label>
        <input id="crd-review-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || v.status !== 'ready_for_check' || !note.trim()} onClick={() => review('pass')}>
          Pass
        </button>
        <button className="btn" disabled={busy || v.status === 'not_started' || !note.trim()} onClick={() => review('return')}>
          Return with what to fix
        </button>
      </div>
    </section>
  );
}
