import { Select } from '../SearchSelect';
import { useState } from 'react';
import { CalendarXIcon, HourglassIcon, KeyIcon, PlusIcon, ScalesIcon, SealCheckIcon, WarningIcon } from '@phosphor-icons/react';
import type { GovArea } from '@prima/core';
import { api, type GovBoard, type GovMandateInput } from '../api';
import { useApp } from '../App';
import { Card, Empty, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import '../styles/gov.css';

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
  const [adding, setAdding] = useState(false);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="mandates" />
      </div>
    );
  const k = data.kpis;
  // PWVSB legal, the Chief of Staff and the owner register mandates (P78); the server checks again on save.
  const canAdd = data.roles.includes('legal') || data.roles.includes('control');
  const add = () => {
    setTab('mandates');
    setAdding(true);
  };
  return (
    <div className="page gv-page">
      <PageHead
        title="Mandates and authority"
        sub="PWVSB acts in a company only under a signed management agreement or board mandate, confirmed by the company's board and verified by PWVSB legal. Where there is none, PWVSB only monitors and the area shows as unknown."
        actions={
          canAdd ? (
            <button className="btn btn-primary" onClick={add}>
              <PlusIcon size={16} /> Add mandate
            </button>
          ) : undefined
        }
      >
        <p className="notice" data-tone="info">
          Test data. The areas and wording are proposals for counsel to check against the signed agreements.
        </p>
      </PageHead>
      <Stats>
        <Stat label="Mandates in force" value={k.active} tone="ok" icon={<SealCheckIcon size={16} />} />
        <Stat
          label={`Ending within ${data.rule.warnDays} days`}
          value={k.expiring}
          tone={k.expiring ? 'warn' : 'ok'}
          icon={<HourglassIcon size={16} />}
        />
        <Stat label="Expired" value={k.expired} tone={k.expired ? 'crit' : 'ok'} icon={<CalendarXIcon size={16} />} />
        <Stat label="Waiting for board or legal" value={k.waiting} tone={k.waiting ? 'warn' : 'ok'} icon={<ScalesIcon size={16} />} />
        <Stat
          label="Companies with no mandate"
          value={k.noMandate}
          tone={k.noMandate ? 'warn' : 'ok'}
          note="shown as unknown"
          icon={<WarningIcon size={16} />}
          onClick={() => setTab('coverage')}
        />
        <Stat
          label="Acting access without a mandate"
          value={k.unsupportedGrants}
          tone={k.unsupportedGrants ? 'warn' : 'ok'}
          icon={<KeyIcon size={16} />}
          onClick={() => setTab('coverage')}
        />
      </Stats>
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
      {tab === 'mandates' && <Mandates data={data} canAdd={canAdd} onAdd={add} />}
      {tab === 'coverage' && <Coverage data={data} />}
      {tab === 'matrix' && <Matrix data={data} />}
      {adding && (
        <Drawer
          title="Add a mandate"
          sub="A signed management agreement or board mandate. After you save it, the company's board confirms it and PWVSB legal verifies the signed copy before it is in force."
          onClose={() => setAdding(false)}
        >
          <NewMandate data={data} onDone={() => setAdding(false)} />
        </Drawer>
      )}
    </div>
  );
}

function Mandates({ data, canAdd, onAdd }: { data: GovBoard; canAdd: boolean; onAdd: () => void }) {
  const [all, setAll] = useState(false);
  const rows = data.rows.filter((r) => all || r.state !== 'terminated');
  return (
    <Card
      title="Management agreements and board mandates"
      sub={`${rows.length} on the register${all ? '' : ', ended ones hidden'}`}
      flush
      actions={
        <>
          <button className="btn btn-sm" aria-pressed={all} onClick={() => setAll(!all)}>
            {all ? 'Hide ended' : 'Show ended'}
          </button>
        </>
      }
    >
      {!rows.length && (
        <Empty
          title="No mandates registered."
          action={
            canAdd ? (
              <button className="btn btn-primary" onClick={onAdd}>
                <PlusIcon size={16} /> Add mandate
              </button>
            ) : undefined
          }
        >
          {canAdd ? 'Add each signed management agreement or board mandate, with the powers it gives PWVSB.' : 'PWVSB legal or the Chief of Staff adds them.'}
        </Empty>
      )}
      <ul className="gv-list">
        {rows.map((r) => (
          <li key={r.mandate.id}>
            <MandateLine r={r} data={data} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** How far through its term a mandate is, for the validity bar; null when it has no end date. */
function elapsed(from: string, to: string | null): number | null {
  if (!to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return Math.min(1, Math.max(0, (Date.now() - a) / (b - a)));
}

function MandateLine({ r, data }: { r: Row; data: GovBoard }) {
  const act = useAction();
  const { me } = useApp();
  const [text, setText] = useState('');
  const m = r.mandate;
  const [tone, label] = STATE[r.state];
  const areaLabel = (a: GovArea) => data.rule.areas.find((x) => x.area === a)?.label ?? a;
  const ended = !!m.terminated;
  const inForce: StepState = r.state === 'active' || r.state === 'expiring' ? 'done' : r.state === 'expired' || ended ? 'stopped' : 'todo';
  const steps: { label: string; state: StepState; note?: string }[] = [
    { label: 'Registered', state: 'done', note: m.addedBy },
    {
      label: 'Board resolution',
      state: m.companyConfirm ? 'done' : ended ? 'todo' : 'now',
      note: m.companyConfirm ? m.companyConfirm.resolutionRef : 'The company board confirms',
    },
    {
      label: 'Legal verified',
      state: m.legalVerify ? 'done' : m.companyConfirm && !ended ? 'now' : 'todo',
      note: m.legalVerify ? m.legalVerify.by : 'PWVSB legal checks the signed copy',
    },
    { label: 'In force', state: inForce },
  ];
  const share = r.live ? elapsed(m.validFrom, m.validTo) : null;
  return (
    <div className="gv-item" data-tone={tone === 'crit' ? 'crit' : tone === 'warn' ? 'warn' : undefined}>
      <div className="gv-item-head">
        <div className="gv-item-main">
          <div className="gv-item-title">
            <span className="gv-co">{r.companyName}:</span> {m.ref}
          </div>
          <div className="gv-item-meta">
            {m.kind === 'BOARD_MANDATE' ? 'Board mandate' : 'Management agreement'} · {m.title} · signed {dateLabel(m.signedOn)}
          </div>
        </div>
        <div className="gv-item-state">
          <Chip tone={tone}>{label}</Chip>
        </div>
      </div>
      <div className="gv-validity">
        <span>
          Runs {dateLabel(m.validFrom)} to {m.validTo ? dateLabel(m.validTo) : 'until ended'}
          {r.daysLeft !== null && r.daysLeft >= 0 && r.live ? ` (${r.daysLeft} days left)` : ''}
        </span>
        {share !== null && (
          <span className="gv-bar" data-tone={tone === 'crit' ? 'crit' : tone === 'warn' ? 'warn' : undefined} aria-hidden="true">
            <span style={{ width: `${Math.round(share * 100)}%` }} />
          </span>
        )}
      </div>
      <Steps steps={steps} />
      <div className="gv-chips" aria-label="Powers">
        {m.powers.map((p, i) => (
          <Chip key={i} tone={p.scope === 'act' ? 'info' : 'ok'}>
            {areaLabel(p.area)}: {p.scope === 'act' ? `act${p.limit != null ? ` to ${rm(p.limit)}` : ''}` : 'monitor'}
          </Chip>
        ))}
      </div>
      <div className="gv-item-meta">
        Registered by {m.addedBy}
        {m.companyConfirm ? ` · board resolution ${m.companyConfirm.resolutionRef}` : ' · no board resolution yet'}
        {m.legalVerify ? ` · verified by ${m.legalVerify.by}` : ' · not verified by legal'}
        {m.terminated ? ` · ended by ${m.terminated.by}: ${m.terminated.note}` : ''}
      </div>
      {!m.terminated && (
        <>
          {r.role === 'company' && !m.companyConfirm && (
            <div className="gv-box">
              <div className="gv-box-title">Record the board's confirmation</div>
              <div className="gv-inline">
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
            </div>
          )}
          {r.role === 'legal' && m.companyConfirm && !m.legalVerify && m.addedById !== me.user.id && (
            <div className="gv-box">
              <div className="gv-box-title">Verify the signed copy</div>
              <div className="gv-inline">
                <input className="input" aria-label="Verification note" placeholder="What you checked" value={text} onChange={(e) => setText(e.target.value)} />
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || !text.trim()}
                  onClick={() => act.run(() => api.govMandateStep(m.id, 'verify', { note: text }), 'Verified.')}
                >
                  Signed copy verified
                </button>
              </div>
            </div>
          )}
          {(r.role === 'legal' || r.role === 'control') && (r.state === 'expired' || r.state === 'expiring' || r.state === 'active') && (
            <div className="gv-box">
              <div className="gv-box-title">End this mandate</div>
              <div className="gv-inline">
                <input className="input" aria-label="Reason it ended" placeholder="Reason it ended" value={text} onChange={(e) => setText(e.target.value)} />
                <button
                  className="btn btn-sm"
                  disabled={act.busy || !text.trim()}
                  onClick={() => act.run(() => api.govMandateStep(m.id, 'terminate', { note: text }), 'Recorded as ended.')}
                >
                  Mark ended
                </button>
              </div>
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
  const [tried, setTried] = useState(false);
  const list = data.rule.areas.map((a) => ({ ...a, v: powers[a.area] ?? { scope: 'none' as const, limit: '' } }));
  const input: GovMandateInput = {
    ...f,
    powers: list
      .filter((a) => a.v.scope !== 'none')
      .map((a) => ({ area: a.area, scope: a.v.scope as 'act' | 'monitor', limit: a.v.limit ? Number(a.v.limit) : null })),
  };
  const badLimit = input.powers.some((p) => p.limit !== null && !(Number.isFinite(p.limit) && p.limit >= 0));
  const missing = !companyId
    ? 'Choose the company.'
    : !f.ref.trim()
      ? 'Give the reference on the signed document.'
      : !f.title.trim()
        ? 'Give its title.'
        : !f.signedOn
          ? 'Give the date it was signed.'
          : !f.validFrom
            ? 'Give the date it runs from.'
            : f.validTo && f.validTo < f.validFrom
              ? 'It cannot end before it starts.'
              : !input.powers.length
                ? 'Choose at least one power the signed document gives PWVSB.'
                : badLimit
                  ? 'A limit must be an amount in RM.'
                  : '';
  const save = () => {
    setTried(true);
    if (missing) return;
    act.run(() => api.addGovMandate(companyId, input), 'Mandate added. The company board confirms it next.').then((x) => {
      if (x) onDone();
    });
  };
  return (
    <div className="gv-stack-sm" aria-label="Add a mandate">
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
        <span className="label">Kind</span>
        <select className="select" aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as GovMandateInput['kind'] })}>
          <option value="MANAGEMENT_AGREEMENT">Management agreement</option>
          <option value="BOARD_MANDATE">Board mandate</option>
        </select>
      </label>
      <label className="field">
        <span className="label">Reference</span>
        <input className="input" aria-label="Reference" placeholder="For example, MA/INAS/2026/01" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Title</span>
        <input className="input" aria-label="Title" placeholder="What the document covers" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Signed on</span>
        <input className="input" type="date" aria-label="Signed on" value={f.signedOn} onChange={(e) => setF({ ...f, signedOn: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Runs from</span>
        <input className="input" type="date" aria-label="Runs from" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Runs to</span>
        <input className="input" type="date" aria-label="Runs to" value={f.validTo ?? ''} onChange={(e) => setF({ ...f, validTo: e.target.value || null })} />
        <span className="help">Leave empty if it runs until it is ended.</span>
      </label>
      <div className="gv-box-title">Powers the signed document gives PWVSB</div>
      {list.map((a) => (
        <div key={a.area} className="field">
          <span className="label">{a.label}</span>
          <div className="gv-btns">
            <select
              className="select"
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
        </div>
      ))}
      {tried && missing && (
        <p className="help" role="alert">
          {missing}
        </p>
      )}
      <ErrorNotice error={act.error} />
      <div className="gv-form-foot">
        <button className="btn btn-primary" disabled={act.busy} onClick={save}>
          {act.busy ? 'Saving...' : 'Add mandate'}
        </button>
        <button className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Coverage({ data }: { data: GovBoard }) {
  const grants = data.coverage.filter((c) => c.unsupportedGrants.length > 0);
  return (
    <div className="gv-stack">
      <Card
        title="What PWVSB may do, by company"
        sub="From live, confirmed and verified mandates only. Unknown means nothing verified is on file, so PWVSB only monitors."
        flush
      >
        {!data.coverage.length && <Empty title="No companies." />}
        {data.coverage.length > 0 && (
          <div className="table-wrap">
            <table className="table gv-matrix">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Mandates</th>
                  {data.rule.areas.map((a) => (
                    <th key={a.area}>{a.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.coverage.map((c) => (
                  <tr key={c.companyId}>
                    <td>
                      <strong>{c.companyName}</strong>
                    </td>
                    <td>
                      <Chip tone={c.liveMandates ? 'ok' : 'warn'}>{c.liveMandates ? `${c.liveMandates} in force` : 'No mandate on file'}</Chip>
                    </td>
                    {data.rule.areas.map((area) => {
                      const a = c.areas.find((x) => x.area === area.area);
                      if (!a) return <td key={area.area} className="muted">–</td>;
                      return (
                        <td key={area.area}>
                          <Chip tone={a.status === 'act' ? 'info' : a.status === 'monitor' ? 'ok' : 'warn'}>
                            {a.status === 'act' ? `act${a.limit != null ? ` to ${rm(a.limit)}` : ''}` : a.status === 'monitor' ? 'monitor' : 'unknown'}
                          </Chip>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {grants.length > 0 && (
        <Card title="Acting access with no mandate behind it" flush>
          <ul className="gv-list">
            {grants.map((c) => (
              <li key={c.companyId} className="gv-item" data-tone="warn">
                <div className="gv-item-title">{c.companyName}</div>
                <div className="gv-lines">
                  Acting access with no mandate behind it: {c.unsupportedGrants.map((g) => `${g.userName} (${g.grant.basis})`).join('; ')}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Matrix({ data }: { data: GovBoard }) {
  return (
    <div className="gv-stack">
      <Card title="Controlled by the company, monitored by PWVSB" flush>
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
                  <td>
                    <strong>{a.label}</strong>
                  </td>
                  <td className="small">{a.company}</td>
                  <td className="small">{a.pwvsb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Who approves what" flush>
        <ul className="gv-list">
          {data.rule.matrix.map((m) => (
            <li key={m.matter} className="gv-item">
              <div className="gv-item-head">
                <div className="gv-item-main">
                  <div className="gv-item-title">{m.matter}</div>
                  <div className="gv-lines">{m.approves}</div>
                  <div className="gv-item-meta">{m.source}</div>
                </div>
                {/proposed|assumption/i.test(m.source) && (
                  <div className="gv-item-state">
                    <Chip tone="warn">needs your confirmation</Chip>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
