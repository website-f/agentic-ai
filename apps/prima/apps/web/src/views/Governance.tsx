import { useState } from 'react';
import type { GovArea } from '@prima/core';
import { api, type GovBoard, type GovMandateInput } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';

/**
 * Governance and authority (V7, V8, V12). PWVSB acts in a company only under a signed management agreement or board
 * mandate that the company's board confirmed and PWVSB legal verified. Areas with no live mandate show as unknown,
 * never as covered. Every company matter is controlled by the licensed company or monitored by it (Fauzan, V12).
 */

type Tab = 'mandates' | 'coverage' | 'matrix';
type Row = GovBoard['rows'][number];

const STATE: Record<Row['state'], ['ok' | 'warn' | 'crit' | 'info', string]> = {
  active: ['ok', 'In force'],
  expiring: ['warn', 'Ending soon'],
  expired: ['crit', 'Expired'],
  unconfirmed: ['warn', 'Board resolution needed'],
  unverified: ['warn', 'Legal to verify'],
  not_started: ['info', 'Not started'],
  terminated: ['info', 'Ended'],
};
const rm = (n: number) => `RM${n.toLocaleString('en-MY')}`;

export function GovernanceView() {
  const { data, error } = useLoad(() => api.govBoard(), []);
  const [tab, setTab] = useState<Tab>('mandates');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="mandates" />;
  const k = data.kpis;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Mandates and authority</h1>
        <p className="muted">
          PWVSB acts in a company only under a signed management agreement or board mandate, confirmed by the company's board and verified by PWVSB legal. Where
          there is none, PWVSB only monitors and the area shows as unknown.
        </p>
        <p className="notice" data-tone="info">
          Test data. The areas and wording are proposals for counsel to check against the signed agreements.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Mandates in force" value={k.active} tone="ok" />
        <Kpi label={`Ending within ${data.rule.warnDays} days`} value={k.expiring} tone={k.expiring ? 'warn' : 'ok'} />
        <Kpi label="Expired" value={k.expired} tone={k.expired ? 'crit' : 'ok'} />
        <Kpi label="Waiting for board or legal" value={k.waiting} tone={k.waiting ? 'warn' : 'ok'} />
        <Kpi label="Companies with no mandate" value={k.noMandate} tone={k.noMandate ? 'warn' : 'ok'} note="shown as unknown" />
        <Kpi label="Acting access without a mandate" value={k.unsupportedGrants} tone={k.unsupportedGrants ? 'warn' : 'ok'} />
      </div>
      <div className="tabbar" role="tablist" aria-label="Mandates">
        {(
          [
            ['mandates', 'Mandates'],
            ['coverage', 'By company'],
            ['matrix', 'Who approves what'],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'mandates' && <Mandates data={data} />}
      {tab === 'coverage' && <Coverage data={data} />}
      {tab === 'matrix' && <Matrix data={data} />}
    </div>
  );
}

function Mandates({ data }: { data: GovBoard }) {
  const [form, setForm] = useState(false);
  const [all, setAll] = useState(false);
  const canAdd = data.roles.includes('legal') || data.roles.includes('control');
  const rows = data.rows.filter((r) => all || r.state !== 'terminated');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Management agreements and board mandates</h3>
        <div className="row" style={{ gap: 6 }}>
          {canAdd && (
            <button className="btn btn-sm" onClick={() => setForm(!form)}>
              Register a mandate
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setAll(!all)}>
            {all ? 'Hide ended' : 'Show ended'}
          </button>
        </div>
      </div>
      {form && <NewMandate data={data} onDone={() => setForm(false)} />}
      <div className="list">
        {!rows.length && <div className="empty">No mandates registered.</div>}
        {rows.map((r) => (
          <MandateLine key={r.mandate.id} r={r} data={data} />
        ))}
      </div>
    </section>
  );
}

function MandateLine({ r, data }: { r: Row; data: GovBoard }) {
  const act = useAction();
  const { me } = useApp();
  const [text, setText] = useState('');
  const m = r.mandate;
  const [tone, label] = STATE[r.state];
  const areaLabel = (a: GovArea) => data.rule.areas.find((x) => x.area === a)?.label ?? a;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {r.companyName}: {m.ref}
          </div>
          <div className="muted small">
            {m.kind === 'BOARD_MANDATE' ? 'Board mandate' : 'Management agreement'} · {m.title} · signed {dateLabel(m.signedOn)} · runs {dateLabel(m.validFrom)}{' '}
            to {m.validTo ? dateLabel(m.validTo) : 'until ended'}
            {r.daysLeft !== null && r.daysLeft >= 0 && r.live ? ` (${r.daysLeft} days left)` : ''}
          </div>
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {m.powers.map((p, i) => (
          <Chip key={i} tone={p.scope === 'act' ? 'info' : 'ok'}>
            {areaLabel(p.area)}: {p.scope === 'act' ? `act${p.limit != null ? ` to ${rm(p.limit)}` : ''}` : 'monitor'}
          </Chip>
        ))}
      </div>
      <div className="muted small">
        Registered by {m.addedBy}
        {m.companyConfirm ? ` · board resolution ${m.companyConfirm.resolutionRef}` : ' · no board resolution yet'}
        {m.legalVerify ? ` · verified by ${m.legalVerify.by}` : ' · not verified by legal'}
        {m.terminated ? ` · ended by ${m.terminated.by}: ${m.terminated.note}` : ''}
      </div>
      {!m.terminated && (
        <>
          {r.role === 'company' && !m.companyConfirm && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input
                className="input"
                aria-label="Board resolution"
                placeholder="Board resolution reference"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !text.trim()}
                onClick={() => act.run(() => api.govMandateStep(m.id, 'confirm', { resolutionRef: text }), 'Board confirmation recorded.')}
              >
                Board confirmed it
              </button>
            </div>
          )}
          {r.role === 'legal' && m.companyConfirm && !m.legalVerify && m.addedById !== me.user.id && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input className="input" aria-label="Verification note" placeholder="What you checked" value={text} onChange={(e) => setText(e.target.value)} />
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() => act.run(() => api.govMandateStep(m.id, 'verify', { note: text }), 'Verified.')}
              >
                Signed copy verified
              </button>
            </div>
          )}
          {(r.role === 'legal' || r.role === 'control') && (r.state === 'expired' || r.state === 'expiring' || r.state === 'active') && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input className="input" aria-label="Reason it ended" placeholder="Reason it ended" value={text} onChange={(e) => setText(e.target.value)} />
              <button
                className="btn btn-sm"
                disabled={act.busy || !text.trim()}
                onClick={() => act.run(() => api.govMandateStep(m.id, 'terminate', { note: text }), 'Recorded as ended.')}
              >
                Mark ended
              </button>
            </div>
          )}
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function NewMandate({ data, onDone }: { data: GovBoard; onDone: () => void }) {
  const act = useAction();
  const companies = data.coverage.map((c) => ({ id: c.companyId, name: c.companyName })).sort((a, b) => a.name.localeCompare(b.name));
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [f, setF] = useState<Omit<GovMandateInput, 'powers'>>({ kind: 'MANAGEMENT_AGREEMENT', ref: '', title: '', signedOn: '', validFrom: '', validTo: null });
  const [powers, setPowers] = useState<Record<string, { scope: 'none' | 'monitor' | 'act'; limit: string }>>({});
  const list = data.rule.areas.map((a) => ({ ...a, v: powers[a.area] ?? { scope: 'none' as const, limit: '' } }));
  const input: GovMandateInput = {
    ...f,
    powers: list
      .filter((a) => a.v.scope !== 'none')
      .map((a) => ({ area: a.area, scope: a.v.scope as 'act' | 'monitor', limit: a.v.limit ? Number(a.v.limit) : null })),
  };
  return (
    <div className="panel" style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      <select className="input" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select className="input" aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as GovMandateInput['kind'] })}>
        <option value="MANAGEMENT_AGREEMENT">Management agreement</option>
        <option value="BOARD_MANDATE">Board mandate</option>
      </select>
      <input className="input" aria-label="Reference" placeholder="Reference" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
      <input className="input" aria-label="Title" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <label className="small">
        Signed on
        <input className="input" type="date" value={f.signedOn} onChange={(e) => setF({ ...f, signedOn: e.target.value })} />
      </label>
      <label className="small">
        Runs from
        <input className="input" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
      </label>
      <label className="small">
        Runs to (leave empty if open-ended)
        <input className="input" type="date" value={f.validTo ?? ''} onChange={(e) => setF({ ...f, validTo: e.target.value || null })} />
      </label>
      <div className="small" style={{ fontWeight: 600 }}>
        Powers the signed document gives PWVSB
      </div>
      {list.map((a) => (
        <div key={a.area} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="small" style={{ minWidth: 160 }}>
            {a.label}
          </span>
          <select
            className="input"
            aria-label={`${a.label} power`}
            value={a.v.scope}
            onChange={(e) => setPowers({ ...powers, [a.area]: { ...a.v, scope: e.target.value as 'none' | 'monitor' | 'act' } })}
          >
            <option value="none">None</option>
            <option value="monitor">Monitor</option>
            <option value="act">Act</option>
          </select>
          {a.v.scope === 'act' && (
            <input
              className="input"
              aria-label={`${a.label} limit`}
              placeholder="Limit RM (optional)"
              inputMode="decimal"
              value={a.v.limit}
              onChange={(e) => setPowers({ ...powers, [a.area]: { ...a.v, limit: e.target.value } })}
            />
          )}
        </div>
      ))}
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy || !companyId}
        onClick={() =>
          act
            .run(() => api.addGovMandate(companyId, input), 'Registered. The company board confirms it next.')
            .then((x) => {
              if (x) onDone();
            })
        }
      >
        Register
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Coverage({ data }: { data: GovBoard }) {
  const label = (a: GovArea) => data.rule.areas.find((x) => x.area === a)?.label ?? a;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>What PWVSB may do, by company</h3>
      </div>
      <p className="muted small">From live, confirmed and verified mandates only. Unknown means nothing verified is on file, so PWVSB only monitors.</p>
      <div className="list">
        {data.coverage.map((c) => (
          <div key={c.companyId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 600 }}>{c.companyName}</div>
              <Chip tone={c.liveMandates ? 'ok' : 'warn'}>{c.liveMandates ? `${c.liveMandates} in force` : 'No mandate on file'}</Chip>
            </div>
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {c.areas.map((a) => (
                <Chip key={a.area} tone={a.status === 'act' ? 'info' : a.status === 'monitor' ? 'ok' : 'warn'}>
                  {label(a.area)}: {a.status === 'act' ? `act${a.limit != null ? ` to ${rm(a.limit)}` : ''}` : a.status === 'monitor' ? 'monitor' : 'unknown'}
                </Chip>
              ))}
            </div>
            {c.unsupportedGrants.length > 0 && (
              <div className="small">
                Acting access with no mandate behind it: {c.unsupportedGrants.map((g) => `${g.userName} (${g.grant.basis})`).join('; ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Matrix({ data }: { data: GovBoard }) {
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Controlled by the company, monitored by PWVSB</h3>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Matter</th>
                <th>Company</th>
                <th>PWVSB</th>
              </tr>
            </thead>
            <tbody>
              {data.rule.areas.map((a) => (
                <tr key={a.area}>
                  <td>{a.label}</td>
                  <td className="small">{a.company}</td>
                  <td className="small">{a.pwvsb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Who approves what</h3>
        </div>
        <div className="list">
          {data.rule.matrix.map((m) => (
            <div key={m.matter} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
              <div style={{ fontWeight: 600 }}>{m.matter}</div>
              <div className="small">{m.approves}</div>
              <div className="muted small">
                {m.source}
                {/proposed|assumption/i.test(m.source) ? ' · needs your confirmation' : ''}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
