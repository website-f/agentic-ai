import { useMemo, useState } from 'react';
import { ITEM_CATEGORIES, SALE_PAPER_LABEL, STATE_LABEL, TAG_METHODS, TAG_METHOD_LABEL, labelDisplay, type BaseUom, type ItemCategory, type SalePaperKind, type TagMethod, type TrackingMode } from '@prima/core';
import { api, type ItemBoard } from '../../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../../ui';
import { act, any, CAT_LABEL, partyName, readFile, rolesOf, skuName, STATE_TONE } from './shared';

// Uniform allowance per guard (Fauzan, 6 Nov 2026). Never taken from pay.
// Moved unchanged from views/Items.tsx in the P85 split; laid out by the item register styles (styles/items.css).

// ---------- Uniform allowance ----------

const UNIFORM_LABEL = { due: 'Due now', ok: 'Not due yet', at_max: 'Had 3 free; more paid by guard' } as const;
const UNIFORM_TONE = { due: 'warn', ok: 'ok', at_max: 'neutral' } as const;

export function Uniforms({ data }: { data: ItemBoard }) {
  const u = data.uniforms;
  const [filter, setFilter] = useState<'due' | 'all'>('due');
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const rows = u.rows.filter((r) => (filter === 'all' || r.status === 'due') && (!term || r.name.toLowerCase().includes(term) || r.staffNo.toLowerCase().includes(term)));
  const n = (k: keyof typeof UNIFORM_LABEL) => u.rows.filter((r) => r.status === k).length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Uniform allowance per guard</h3>
      </div>
      <p className="muted">
        Each guard gets at least {u.rule.minPerYear} and at most {u.rule.maxPerYear} uniform pieces a year, usually one every {u.rule.everyMonths} months ({u.rule.source}).
        Counted over the last 12 months; a uniform set counts as one piece. Handing one over sooner needs a reason. A 4th or 5th piece is paid by the guard, with the receipt recorded; more than {u.rule.paidMaxPerYear} is
        refused. Pieces given before this register count only once a manager records them below.
      </p>
      <div className="kpis">
        <Kpi label="Due now" value={n('due')} tone={n('due') ? 'warn' : 'ok'} />
        <Kpi label={`Below ${u.rule.minPerYear} this year`} value={u.rows.filter((r) => r.belowMin).length} tone="neutral" />
        <Kpi label={`Had ${u.rule.maxPerYear} this year`} value={n('at_max')} tone="neutral" />
        <Kpi label="Guards" value={u.rows.length} tone="neutral" />
      </div>
      {u.recordsFor.length > 0 && <PastUniforms data={data} />}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
        <div className="seg">
          <button aria-pressed={filter === 'due'} onClick={() => setFilter('due')}>
            Due now
          </button>
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All ({u.rows.length})
          </button>
        </div>
        <input className="input" aria-label="Find a guard" placeholder="Name or staff number" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="list">
        {!rows.length && <div className="empty">No guard here.</div>}
        {rows.slice(0, 200).map((r) => (
          <div key={r.personId} className="list-item" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
            <div>
              <strong>{r.name}</strong>
              <div className="muted small">
                {r.staffNo} · {partyName(data, r.companyId)}
                {r.siteName ? ` · ${r.siteName}` : ''}
                {r.zone ? ` · ${r.zone}` : ''} · {r.free} of {u.rule.maxPerYear} free{r.paid ? ` + ${r.paid} paid` : ''} in 12 months · last {r.last ? dateLabel(r.last) : 'none recorded'}
                {r.status === 'ok' ? ` · next from ${dateLabel(r.nextDue)}` : ''}
              </div>
            </div>
            <Chip tone={UNIFORM_TONE[r.status]}>{UNIFORM_LABEL[r.status]}</Chip>
          </div>
        ))}
        {rows.length > 200 && <div className="muted small">Showing 200 of {rows.length}. Search by name or staff number to find others.</div>}
      </div>
      <p className="muted small">To hand over a piece, open the uniform from Find or scan and choose "Hand to a person". The person confirms it in their own sign-in or on the post device.</p>
    </section>
  );
}

/** Bulk entry of pieces handed over before this register: one guard, a site, a zone (state) or a region. */
export function PastUniforms({ data }: { data: ItemBoard }) {
  const u = data.uniforms;
  const a = useAction();
  const [company, setCompany] = useState(u.recordsFor[0] ?? '');
  const [kind, setKind] = useState<'site' | 'zone' | 'region' | 'person'>('zone');
  const [id, setId] = useState('');
  const [on, setOn] = useState('');
  const [pieces, setPieces] = useState('1');
  const [reason, setReason] = useState('');
  const [out, setOut] = useState<{ scope: string; recorded: number; skipped: { staffNo: string; why: string }[] } | null>(null);
  const mine = u.rows.filter((r) => r.companyId === company);
  const options: [string, string][] =
    kind === 'site'
      ? [...new Map(mine.filter((r) => r.siteId).map((r) => [r.siteId!, r.siteName ?? r.siteId!])).entries()]
      : kind === 'zone'
        ? [...new Set(mine.map((r) => r.zone).filter((z): z is string => !!z))].sort().map((z) => [z, z])
        : kind === 'region'
          ? u.regions.filter((g) => mine.some((r) => r.regionId === g.id)).map((g) => [g.id, g.name])
          : [];
  const matched =
    kind === 'site'
      ? mine.filter((r) => r.siteId === id)
      : kind === 'zone'
        ? mine.filter((r) => r.zone === id)
        : kind === 'region'
          ? mine.filter((r) => r.regionId === id)
          : mine.filter((r) => r.staffNo === id.trim().toUpperCase());
  return (
    <details className="panel" style={{ margin: '8px 0' }}>
      <summary>
        <strong>Record past pieces</strong> <span className="muted small">(given before this register, for one guard or a whole site, zone or region)</span>
      </summary>
      <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
        {u.recordsFor.length > 1 && (
          <select className="input" aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
            {u.recordsFor.map((p) => (
              <option key={p} value={p}>
                {partyName(data, p)}
              </option>
            ))}
          </select>
        )}
        <div className="seg">
          {(['site', 'zone', 'region', 'person'] as const).map((k) => (
            <button
              key={k}
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setId('');
              }}
            >
              {k === 'site' ? 'Site' : k === 'zone' ? 'Zone (state)' : k === 'region' ? 'Region' : 'One guard'}
            </button>
          ))}
        </div>
        {kind === 'person' ? (
          <input className="input" aria-label="Staff number" placeholder="Staff number" value={id} onChange={(e) => setId(e.target.value)} />
        ) : (
          <select className="input" aria-label={kind === 'site' ? 'Site' : kind === 'zone' ? 'Zone' : 'Region'} value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Choose…</option>
            {options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        )}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <label className="small">
            Date handed over <input className="input" type="date" aria-label="Date handed over" value={on} onChange={(e) => setOn(e.target.value)} max={data.today} />
          </label>
          <label className="small">
            Pieces per guard{' '}
            <select className="input" aria-label="Pieces per guard" value={pieces} onChange={(e) => setPieces(e.target.value)}>
              {[1, 2, 3].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <input
          className="input"
          aria-label="Where this comes from"
          placeholder="Where this comes from (for example: store issue book, June 2026)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
        />
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn"
            disabled={a.busy || !id.trim() || !on || reason.trim().length < 5}
            onClick={() =>
              a.run(() => act({ kind: 'uniform.past', companyId: company, scope: { kind, id: id.trim() }, on, pieces: Number(pieces), reason: reason.trim() }), 'Past pieces recorded.').then((r) => {
                if (r) setOut(r.result as never);
              })
            }
          >
            Record for {matched.length} guard{matched.length === 1 ? '' : 's'}
          </button>
          <span className="muted small">Each guard is checked on their own; anyone who would go over {u.rule.maxPerYear} free pieces is skipped and listed.</span>
        </div>
        <ErrorNotice error={a.error} />
        {out && (
          <p className="notice" data-tone={out.skipped.length ? 'warn' : 'ok'}>
            {out.scope}: recorded for {out.recorded} guard(s).
            {out.skipped.length
              ? ` Skipped ${out.skipped.length}: ${out.skipped
                  .slice(0, 5)
                  .map((x) => `${x.staffNo} (${x.why})`)
                  .join('; ')}${out.skipped.length > 5 ? '…' : ''}`
              : ''}
          </p>
        )}
      </div>
    </details>
  );
}
