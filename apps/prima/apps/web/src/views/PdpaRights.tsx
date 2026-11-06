import { useState } from 'react';
import { api, type PdpaRequestInput, type PdpaRights } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';

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

export function RequestsPanel() {
  const { data, error } = useLoad(() => api.pdpaRights(), []);
  const [form, setForm] = useState(false);
  const [all, setAll] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="data requests" />;
  const rows = data.requests.filter((r) => all || r.request.status === 'open');
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
          <button className="btn btn-sm" onClick={() => setAll(!all)}>
            {all ? 'Hide closed' : 'Show closed'}
          </button>
        </div>
      </div>
      <p className="muted small">
        Answer within {data.rule.requestDays} days (PDPA s.31 and s.35). Check the person's identity first. Refuse only on a ground the Act allows, in writing.
        {data.counts.requestsLate ? ` ${data.counts.requestsLate} past the deadline.` : ''}
      </p>
      {form && <NewRequest data={data} onDone={() => setForm(false)} />}
      <div className="list">
        {!rows.length && <div className="empty">No open requests.</div>}
        {rows.map((r) => (
          <RequestLine key={r.request.id} r={r} data={data} />
        ))}
      </div>
    </section>
  );
}

function RequestLine({ r: row, data }: { r: PdpaRights['requests'][number]; data: PdpaRights }) {
  const act = useAction();
  const [note, setNote] = useState('');
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
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.pdpaRequestStep(r.id, 'verify', ''), 'Identity checked.')}>
                Identity checked
              </button>
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
            <select className="input" aria-label="Refusal ground" value={ground} onChange={(e) => setGround(e.target.value)}>
              {data.rule.refusalGrounds.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
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
      <select className="input" aria-label="Company" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
        {data.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select className="input" aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PdpaRequestInput['kind'] })}>
        {Object.entries(KIND).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
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

export function DpoPanel() {
  const { data, error } = useLoad(() => api.pdpaRights(), []);
  const [all, setAll] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="DPO register" />;
  const rows = data.dpos.filter((d) => all || d.state !== 'ok');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Data protection officer, by company</h3>
        <button className="btn btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Hide complete' : 'Show complete'}
        </button>
      </div>
      <p className="muted small">
        Each company is its own data controller and names a DPO, notified to the PDP Commissioner within {data.rule.dpoNotifyDays} days of appointment, with the
        contact published. A company with no DPO on file is unknown. {data.counts.noDpo} without one, {data.counts.notifyLate} notified late.
      </p>
      <div className="list">
        {rows.slice(0, 60).map((d) => (
          <DpoLine key={d.companyId} d={d} officer={data.canAdd} />
        ))}
      </div>
    </section>
  );
}

function DpoLine({ d, officer }: { d: PdpaRights['dpos'][number]; officer: boolean }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: d.dpo?.name ?? '',
    email: d.dpo?.email ?? '',
    appointedOn: d.dpo?.appointedOn ?? '',
    notifiedOn: d.dpo?.notified?.on ?? '',
    notifyRef: d.dpo?.notified?.ref ?? '',
    published: d.dpo?.published ?? false,
  });
  const tone = d.state === 'ok' ? 'ok' : d.state === 'notify_late' ? 'crit' : 'warn';
  const label = {
    ok: 'Complete',
    unknown: 'Unknown: no DPO',
    notify_late: 'Commissioner not told in time',
    to_notify: 'Tell the Commissioner',
    unpublished: 'Contact not published',
  }[d.state];
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
