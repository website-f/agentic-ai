import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type PdpaRequestInput, type PdpaRights } from '../api';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';

/**
 * PDPA rights. People's requests about their own data (access and correction within 21 days, refusal only on the
 * Act's grounds, identity checked first) and each company's data protection officer, notified to the Commissioner.
 */

const KIND: Record<PdpaRequestInput['kind'], string> = {
  ACCESS: 'Access to their data',
  CORRECTION: 'Correction',
  PORTABILITY: 'Copy to move elsewhere',
  WITHDRAW_CONSENT: 'Withdraw consent',
  OBJECTION: 'Objection to processing',
};

type RequestRow = PdpaRights['requests'][number];
const requestState = (row: RequestRow): ['ok' | 'info' | 'crit' | 'warn', string] => {
  const r = row.request;
  const [tone, label] = requestState(row);
  return [tone, label];
};
const REQUEST_COLUMNS: DtColumn<RequestRow>[] = [
  { id: 'ref', label: 'Reference', value: (r) => r.request.ref, render: (r) => <strong>{r.request.ref}</strong>, width: '9rem' },
  { id: 'who', label: 'Who asked', value: (r) => r.request.subjectName, phone: 'title' },
  { id: 'kind', label: 'Kind', value: (r) => KIND[r.request.kind], translate: true, phone: 'sub' },
  { id: 'company', label: 'Company', value: (r) => r.companyName, hideBelow: 1100 },
  { id: 'received', label: 'Received', value: (r) => r.request.receivedOn, sort: 'date', hideBelow: 1200 },
  { id: 'due', label: 'Due', value: (r) => r.request.dueOn, sort: 'date' },
  { id: 'id', label: 'Identity', value: (r) => (r.request.idVerified ? 'Checked' : 'Not checked'), translate: true, hideBelow: 1200 },
  { id: 'status', label: 'Status', value: (r) => (r.request.status === 'open' ? r.daysLeft : null), sort: 'number', align: 'left', render: (r) => <Chip tone={requestState(r)[0]}>{requestState(r)[1]}</Chip> },
];
const REQUEST_FILTERS: DtFilter<RequestRow>[] = [
  { id: 'show', label: 'Show', value: (r) => (r.request.status === 'open' ? 'open' : 'closed'), options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
  { id: 'kind', label: 'Kind', value: (r) => r.request.kind, optionLabel: (v) => KIND[v as PdpaRequestInput['kind']] ?? v },
  { id: 'company', label: 'Company', value: (r) => r.companyName },
];

export function RequestsPanel() {
  const { data, error } = useLoad(() => api.pdpaRights(), []);
  const [form, setForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="data requests" />;
  const open = data.requests.find((r) => r.request.id === openId);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Requests about people's own data</h3>
        <div className="row" style={{ gap: 6 }}>
          {data.canAdd && (
            <button className="btn btn-sm" onClick={() => setForm(!form)}>
              Log a request
            </button>
          )}
        </div>
      </div>
      <p className="muted small">
        Answer within {data.rule.requestDays} days (PDPA s.31 and s.35). Check the person's identity first. Refuse only on a ground the Act allows, in writing.
        {data.counts.requestsLate ? ` ${data.counts.requestsLate} past the deadline.` : ''}
      </p>
      {form && <NewRequest data={data} onDone={() => setForm(false)} />}
      <DataTable
        label="Requests about people's own data"
        stateKey="board.pdpa.requests"
        defaults={{ f: { show: 'open' } }}
        rows={data.requests}
        rowKey={(r) => r.request.id}
        columns={REQUEST_COLUMNS}
        filters={REQUEST_FILTERS}
        searchText={(r) => r.request.detail}
        onRowClick={(r) => setOpenId(r.request.id)}
        rowTone={(r) => (requestState(r)[0] === 'crit' ? 'crit' : requestState(r)[0] === 'warn' ? 'warn' : undefined)}
        actions={(r) => [{ label: data.role === 'officer' && r.request.status === 'open' ? 'Act' : 'Open', onClick: () => setOpenId(r.request.id) }]}
        empty={<div className="empty">No open requests.</div>}
      />
      {open && (
        <Drawer title={`${open.request.ref}: ${KIND[open.request.kind]}`} sub={open.companyName} onClose={() => setOpenId(null)}>
          <RequestLine r={open} data={data} />
        </Drawer>
      )}
    </section>
  );
}

function RequestLine({ r: row, data }: { r: PdpaRights['requests'][number]; data: PdpaRights }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [idNote, setIdNote] = useState('');
  const [ground, setGround] = useState(data.rule.refusalGrounds[0]);
  const r = row.request;
  const officer = data.role === 'officer';
  const tone = r.status === 'done' ? 'ok' : r.status === 'refused' ? 'info' : row.late ? 'crit' : row.daysLeft <= 5 ? 'warn' : 'info';
  const label = r.status === 'done' ? 'Answered' : r.status === 'refused' ? 'Refused' : row.late ? `${-row.daysLeft} days late` : `${row.daysLeft} days left`;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {r.ref}: {KIND[r.kind]}, {r.subjectName}
          </div>
          <div className="muted small">
            {row.companyName} · {r.subjectKind} · received {dateLabel(r.receivedOn)}, due {dateLabel(r.dueOn)} ·{' '}
            {r.idVerified ? `identity checked by ${r.idVerified.by}` : 'identity not checked'}
          </div>
          <div className="small">{r.detail}</div>
          {r.closed && (
            <div className="small">
              {r.status === 'done' ? 'Answered' : 'Refused'} by {r.closed.by}: {r.closed.note}
            </div>
          )}
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      {officer && r.status === 'open' && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {!r.idVerified && (
              <>
                <input
                  className="input"
                  aria-label="How the identity was checked"
                  placeholder="How you checked the identity (needed; a short note is fine)"
                  value={idNote}
                  onChange={(e) => setIdNote(e.target.value)}
                />
                <button className="btn btn-sm" disabled={act.busy || !idNote.trim()} onClick={() => act.run(() => api.pdpaRequestStep(r.id, 'verify', idNote), 'Identity checked.')}>
                  Identity checked
                </button>
              </>
            )}
            <input
              className="input"
              aria-label="What was given or changed"
              placeholder="What was given or changed"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || !r.idVerified || !note.trim()}
              onClick={() => act.run(() => api.pdpaRequestStep(r.id, 'done', note), 'Answered.')}
            >
              Answered
            </button>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Select className="input" aria-label="Refusal ground" value={ground} onChange={(e) => setGround(e.target.value)}>
              {data.rule.refusalGrounds.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.pdpaRequestStep(r.id, 'refuse', ground), 'Refusal recorded.')}>
              Refuse on this ground
            </button>
          </div>
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function NewRequest({ data, onDone }: { data: PdpaRights; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState<PdpaRequestInput>({
    companyId: data.companies[0]?.id ?? '',
    kind: 'ACCESS',
    subjectName: '',
    subjectKind: 'guard',
    detail: '',
    receivedOn: '',
  });
  return (
    <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      <Select className="input" aria-label="Company" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
        {data.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select className="input" aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PdpaRequestInput['kind'] })}>
        {Object.entries(KIND).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      <input
        className="input"
        aria-label="Who asked"
        placeholder="Who asked"
        value={f.subjectName}
        onChange={(e) => setF({ ...f, subjectName: e.target.value })}
      />
      <select
        className="input"
        aria-label="They are a"
        value={f.subjectKind}
        onChange={(e) => setF({ ...f, subjectKind: e.target.value as PdpaRequestInput['subjectKind'] })}
      >
        <option value="guard">Guard or officer</option>
        <option value="staff">Staff</option>
        <option value="client">Client contact</option>
        <option value="other">Other</option>
      </select>
      <input
        className="input"
        aria-label="What they asked for"
        placeholder="What they asked for"
        value={f.detail}
        onChange={(e) => setF({ ...f, detail: e.target.value })}
      />
      <label className="small">
        Received on
        <input className="input" type="date" value={f.receivedOn} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} />
      </label>
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy}
        onClick={() =>
          act
            .run(() => api.addPdpaRequest(f), 'Logged. The 21-day clock is running.')
            .then((x) => {
              if (x) onDone();
            })
        }
      >
        Log request
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

type DpoRow = PdpaRights['dpos'][number];
const DPO_STATE: Record<DpoRow['state'], string> = {
  ok: 'Complete',
  unknown: 'Unknown: no DPO',
  notify_late: 'Commissioner not told in time',
  to_notify: 'Tell the Commissioner',
  unpublished: 'Contact not published',
};
const dpoTone = (d: DpoRow) => (d.state === 'ok' ? 'ok' : d.state === 'notify_late' ? 'crit' : 'warn');
const DPO_COLUMNS: DtColumn<DpoRow>[] = [
  { id: 'company', label: 'Company', value: (d) => d.companyName, render: (d) => <strong>{d.companyName}</strong>, phone: 'title' },
  { id: 'name', label: 'DPO', value: (d) => d.dpo?.name, render: (d) => d.dpo?.name ?? <span className="muted">No DPO on file</span>, phone: 'sub' },
  { id: 'email', label: 'Business email', value: (d) => d.dpo?.email, hideBelow: 1200 },
  { id: 'appointed', label: 'Appointed', value: (d) => d.dpo?.appointedOn, sort: 'date' },
  {
    id: 'notified',
    label: 'Notified',
    value: (d) => d.dpo?.notified?.on,
    sort: 'date',
    render: (d) => (d.dpo?.notified ? `${dateLabel(d.dpo.notified.on)} (${d.dpo.notified.ref})` : d.dpo ? `notify by ${dateLabel(d.notifyDue)}` : '–'),
    hideBelow: 1100,
  },
  { id: 'state', label: 'Status', value: (d) => DPO_STATE[d.state], translate: true, render: (d) => <Chip tone={dpoTone(d)}>{DPO_STATE[d.state]}</Chip> },
];
const DPO_FILTERS: DtFilter<DpoRow>[] = [
  { id: 'show', label: 'Show', value: (d) => (d.state === 'ok' ? 'complete' : 'todo'), options: [{ value: 'todo', label: 'Not complete' }, { value: 'complete', label: 'Complete' }] },
  { id: 'state', label: 'Status', value: (d) => d.state, optionLabel: (v) => DPO_STATE[v as DpoRow['state']] ?? v },
];

export function DpoPanel() {
  const { data, error } = useLoad(() => api.pdpaRights(), []);
  const [openId, setOpenId] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="DPO register" />;
  const open = data.dpos.find((d) => d.companyId === openId);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Data protection officer, by company</h3>
      </div>
      <p className="muted small">
        Each company is its own data controller and names a DPO, notified to the PDP Commissioner within {data.rule.dpoNotifyDays} days of appointment, with the
        contact published. A company with no DPO on file is unknown. {data.counts.noDpo} without one, {data.counts.notifyLate} notified late.
      </p>
      <DataTable
        label="Data protection officer, by company"
        stateKey="board.pdpa.dpo"
        defaults={{ f: { show: 'todo' } }}
        rows={data.dpos}
        rowKey={(d) => d.companyId}
        columns={DPO_COLUMNS}
        filters={DPO_FILTERS}
        onRowClick={(d) => setOpenId(d.companyId)}
        rowTone={(d) => (dpoTone(d) === 'crit' ? 'crit' : undefined)}
        actions={(d) => [{ label: d.dpo ? 'Update' : 'Record', hidden: !data.canAdd, onClick: () => setOpenId(d.companyId) }]}
      />
      {open && (
        <Drawer title={open.companyName} sub="Data protection officer" onClose={() => setOpenId(null)}>
          <DpoLine d={open} officer={data.canAdd} startOpen={data.canAdd} />
        </Drawer>
      )}
    </section>
  );
}

function DpoLine({ d, officer, startOpen }: { d: PdpaRights['dpos'][number]; officer: boolean; startOpen?: boolean }) {
  const act = useAction();
  const [open, setOpen] = useState(!!startOpen);
  const [f, setF] = useState({
    name: d.dpo?.name ?? '',
    email: d.dpo?.email ?? '',
    appointedOn: d.dpo?.appointedOn ?? '',
    notifiedOn: d.dpo?.notified?.on ?? '',
    notifyRef: d.dpo?.notified?.ref ?? '',
    published: d.dpo?.published ?? false,
  });
  const tone = dpoTone(d);
  const label = DPO_STATE[d.state];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{d.companyName}</div>
          <div className="muted small">
            {d.dpo
              ? `${d.dpo.name}, ${d.dpo.email} · appointed ${dateLabel(d.dpo.appointedOn)}${d.dpo.notified ? ` · notified ${dateLabel(d.dpo.notified.on)} (${d.dpo.notified.ref})` : ` · notify by ${dateLabel(d.notifyDue)}`}`
              : 'No DPO on file'}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Chip tone={tone}>{label}</Chip>
          {officer && (
            <button className="btn btn-sm" onClick={() => setOpen(!open)}>
              {d.dpo ? 'Update' : 'Record'}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div style={{ display: 'grid', gap: 6 }}>
          <input className="input" aria-label="DPO name" placeholder="DPO name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input
            className="input"
            aria-label="Business email"
            placeholder="Business email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
          <label className="small">
            Appointed on
            <input className="input" type="date" value={f.appointedOn} onChange={(e) => setF({ ...f, appointedOn: e.target.value })} />
          </label>
          <label className="small">
            Notified to the Commissioner on
            <input className="input" type="date" value={f.notifiedOn} onChange={(e) => setF({ ...f, notifiedOn: e.target.value })} />
          </label>
          <input
            className="input"
            aria-label="Commissioner reference"
            placeholder="Commissioner reference"
            value={f.notifyRef}
            onChange={(e) => setF({ ...f, notifyRef: e.target.value })}
          />
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /> Contact published on the website or
            notice
          </label>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () =>
                  api.recordPdpaDpo(d.companyId, {
                    name: f.name,
                    email: f.email,
                    appointedOn: f.appointedOn,
                    notifiedOn: f.notifiedOn || null,
                    notifyRef: f.notifyRef || null,
                    published: f.published,
                  }),
                'Saved.',
              )
            }
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
