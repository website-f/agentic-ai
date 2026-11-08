import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type ManagementFeeBills, type ManagementFees } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';

/** Today in Malaysia, whatever the device's clock zone (the app keeps Malaysian dates). */
const mytNow = () => new Date(Date.now() + 8 * 3_600_000).toISOString();

type Data = ManagementFees;
type Row = Data['companies'][number];
type Fee = { kind: 'percent' | 'fixed'; value: number; agreementRef: string; by: string; at: string; from?: string; reason?: string; inSiteProfit?: boolean } | null;
const rm = (n: number | null) => (n == null ? 'Unknown' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const feeText = (f: Fee) => (!f ? 'no fee' : f.kind === 'percent' ? `${f.value}% of billing` : `RM${f.value.toFixed(2)} a month`);
const inProfit = (by: string, f: NonNullable<Fee>, d: Data) => f.inSiteProfit ?? d.chargers.find((c) => c.id === by)?.inSiteProfitDefault ?? false;
const basisText = (b: 'government' | 'private' | 'all') => (b === 'government' ? 'government sites' : b === 'private' ? 'private sites' : 'all its sites');

/**
 * Management fees (Fauzan, 2 Nov 2026; widened 5 Nov 2026): the Finance Director or the CEO sets the fee any PWVSB group
 * company bills another, from the signed management agreement, with a reason. Each change applies from a chosen month
 * and is kept. Goodwill Empire's and Sasa Team's fees also feed each site's profit and loss.
 */
export function ManagementFeesPanel() {
  const { data, error } = useLoad(() => api.managementFees(), []);
  const [q, setQ] = useState('');
  const shown = data ? data.companies.filter((c) => !q.trim() || c.companyName.toLowerCase().includes(q.trim().toLowerCase())) : [];
  const withFee = data ? data.companies.filter((c) => c.fees.some((f) => f.now)).length : 0;
  return (
    <>
      <section className="panel">
        <div className="panel-head" style={{ flexWrap: 'wrap', gap: 6 }}>
          <h3>Management fees between group companies</h3>
          {data && <Chip tone="neutral">{withFee} paying a fee now</Chip>}
        </div>
        <div className="panel-body">
        <p className="muted small">
          Set the fee one group company bills another, from the signed management agreement. Any group company can bill or be billed a fee, including
          PWVSB, Merdeka, Goodwill, Sasa Team, Perfect Global Logistics and companies added later. Goodwill Empire&apos;s fee is on government sites and
          Sasa Team&apos;s on private sites (site profit and loss stays Unknown until they are in); any other company&apos;s fee is on all the paying
          company&apos;s sites. You choose whether each fee is taken off site profit and loss. Give a reason for every change. A change applies from the
          month you choose, so earlier bills stay as they were. Every change is kept and logged.
        </p>
        {error ? (
          <ErrorNotice error={error} />
        ) : !data ? (
          <Loading what="the fees" />
        ) : (
          <>
            <input className="input" aria-label="Find a company" placeholder="Find a company" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="list">
              {shown.map((r) => (
                <CompanyFees key={r.companyId} r={r} d={data} />
              ))}
            </div>
          </>
        )}
        </div>
      </section>
      <ManagementFeeBillsPanel />
    </>
  );
}

function CompanyFees({ r, d }: { r: Row; d: Data }) {
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState(false);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, minWidth: 0 }}>{r.companyName}</div>
        <div className="row" style={{ gap: 6 }}>
          {r.history.length > 0 && (
            <button className="btn btn-sm" onClick={() => setHistory(!history)}>
              {history ? 'Hide changes' : `Changes (${r.history.length})`}
            </button>
          )}
          <button className="btn btn-sm" disabled={!r.finId && !r.central} onClick={() => setAdding(!adding)}>
            Add a fee
          </button>
        </div>
      </div>
      {!r.finId && !r.central && <div className="muted small">No Finance record yet, so no fee can be set.</div>}
      {!r.finId && r.central && <div className="muted small">No Finance record yet: setting a fee opens one (SQL Account not connected).</div>}
      {r.fees.length === 0 && r.finId && <div className="muted small">No management fee billed to this company.</div>}
      {r.fees.map((f) => (
        <FeeLine key={f.chargedBy} r={r} d={d} f={f} />
      ))}
      {adding && <FeeForm r={r} d={d} onDone={() => setAdding(false)} />}
      {history && (
        <div className="list" style={{ gap: 4 }}>
          {r.history.map((h) => (
            <div key={`${h.chargedBy}-${h.at}-${h.from}`} className="small muted">
              {dateLabel(h.at.slice(0, 10))} · {h.by}: {h.chargedByName} {h.fee ? `set to ${feeText(h.fee)} (agreement ${h.fee.agreementRef}${h.fee.inSiteProfit === false ? ', not taken off site profit' : h.fee.inSiteProfit ? ', taken off site profit' : ''})` : 'fee ended'}
              {h.from === '0000-01' ? ' (entered before changes were kept)' : ` from ${h.from}`}. Reason: {h.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FeeLine({ r, d, f }: { r: Row; d: Data; f: Row['fees'][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div className="small" style={{ minWidth: 0 }}>
          {f.chargedByName} ({basisText(f.basis)}):{' '}
          <span className="muted">
            {f.now
              ? `${feeText(f.now)} · agreement ${f.now.agreementRef} · ${inProfit(f.chargedBy, f.now, d) ? 'taken off' : 'not taken off'} site profit and loss · ${f.now.by}, ${dateLabel(f.now.at.slice(0, 10))}`
              : `no fee in ${d.month}`}
          </span>
          {f.later.map((l) => (
            <div key={`${l.from}-${l.at}`} className="muted">
              From {l.from}: {l.fee ? feeText(l.fee) : 'fee ends'} ({l.by}; {l.reason})
            </div>
          ))}
        </div>
        <button className="btn btn-sm" disabled={!r.finId} onClick={() => setOpen(!open)}>
          Change or end
        </button>
      </div>
      {open && <FeeForm r={r} d={d} chargedBy={f.chargedBy} current={f.now} onDone={() => setOpen(false)} />}
    </div>
  );
}

function FeeForm({ r, d, chargedBy, current, onDone }: { r: Row; d: Data; chargedBy?: string; current?: Fee; onDone: () => void }) {
  const act = useAction();
  const chargers = d.chargers.filter((c) => c.id !== r.companyId);
  const [by, setBy] = useState(chargedBy ?? '');
  const [kind, setKind] = useState<'percent' | 'fixed' | 'end'>(current?.kind ?? 'percent');
  const [value, setValue] = useState(current ? String(current.value) : '');
  const [ref, setRef] = useState(current?.agreementRef ?? '');
  const [from, setFrom] = useState(d.month);
  const [reason, setReason] = useState('');
  const [inSite, setInSite] = useState<boolean | null>(current ? inProfit(chargedBy!, current, d) : null);
  const inSiteNow = inSite ?? (d.chargers.find((c) => c.id === by)?.inSiteProfitDefault ?? false);
  const months = [d.earliestFrom, ...Array.from({ length: 12 }, (_, i) => {
    const dt = new Date(`${d.month}-15T00:00:00Z`);
    dt.setUTCMonth(dt.getUTCMonth() + i);
    return dt.toISOString().slice(0, 7);
  })];
  const ready = by && reason.trim().length >= 3 && (kind === 'end' || (value && ref.trim()));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {!chargedBy && (
          <Select className="input" aria-label="Billed by" value={by} onChange={(e) => setBy(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Billed by…</option>
            {chargers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Select className="input" aria-label="Fee type" value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'fixed' | 'end')} style={{ width: 'auto' }}>
          <option value="percent">% of billing</option>
          <option value="fixed">RM a month</option>
          {chargedBy && <option value="end">End the fee</option>}
        </Select>
        {kind !== 'end' && (
          <>
            <input
              className="input"
              aria-label="Fee"
              inputMode="decimal"
              placeholder={kind === 'percent' ? 'e.g. 5' : 'e.g. 15000'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ width: 120 }}
            />
            <input className="input" aria-label="Agreement reference" placeholder="Agreement reference" value={ref} onChange={(e) => setRef(e.target.value)} />
          </>
        )}
        <Select className="input" aria-label="Applies from" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }}>
          {months.map((m) => (
            <option key={m} value={m}>
              From {m}
            </option>
          ))}
        </Select>
      </div>
      {kind !== 'end' && (
        <label className="small row" style={{ gap: 6 }}>
          <input type="checkbox" checked={inSiteNow} onChange={(e) => setInSite(e.target.checked)} />
          Take this fee off site profit and loss
        </label>
      )}
      <input className="input" aria-label="Reason" placeholder="Reason for this change (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !ready}
          onClick={() =>
            act.run(async () => {
              await api.setManagementFee(r.companyId, {
                chargedBy: by,
                kind,
                ...(kind === 'end' ? {} : { value: Number(value), agreementRef: ref, inSiteProfit: inSiteNow }),
                reason,
                from,
              });
              onDone();
            }, 'Saved.')
          }
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/**
 * The month's management fee bills between group companies (Goodwill Empire, Sasa Team and any other): a draft for Finance to raise in
 * SQL Account, not an invoice. Unknown when a fee or a site's billing is missing.
 */
export function ManagementFeeBillsPanel() {
  const today = mytNow().slice(0, 10);
  const [month, setMonth] = useState(today.slice(0, 7));
  const { data, error } = useLoad(() => api.managementFeeBills(month), [month]);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${today.slice(0, 7)}-15T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    return d.toISOString().slice(0, 7);
  });
  return (
    <section className="panel">
      <div className="panel-head" style={{ flexWrap: 'wrap', gap: 6 }}>
        <h3>Management fee bills (draft)</h3>
        <Select className="select" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }}>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </div>
      {error ? <ErrorNotice error={error} /> : !data ? <Loading what="the fee bills" /> : <Bills d={data} />}
    </section>
  );
}

function Bills({ d }: { d: ManagementFeeBills }) {
  return (
    <>
      <div className="kpis">
        {d.totals.map((t) => (
          <Kpi
            key={t.chargedById}
            label={t.chargedByName}
            value={rm(t.known)}
            tone={t.unknownCompanies ? 'warn' : 'ok'}
            note={t.unknownCompanies ? `plus ${t.unknownCompanies} compan${t.unknownCompanies === 1 ? 'y' : 'ies'} Unknown` : 'all companies known'}
          />
        ))}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th className="hide-sm">Billed by</th>
              <th className="num hide-sm">Billing</th>
              <th className="num">Fee</th>
            </tr>
          </thead>
          <tbody>
            {d.bills.map((b) => (
              <tr key={`${b.chargedById}-${b.companyId}`}>
                <td>
                  {b.companyName}
                  <div className="muted small">
                    {b.sites} site{b.sites === 1 ? '' : 's'} ·{' '}
                    {b.fee ? feeText(b.fee) : 'fee not entered'}
                  </div>
                  {b.fee && b.unknownSites.length > 0 && (
                    <div className="muted small">
                      Unknown billing: {b.unknownSites.slice(0, 3).join(', ')}
                      {b.unknownSites.length > 3 ? ` and ${b.unknownSites.length - 3} more` : ''}
                    </div>
                  )}
                </td>
                <td className="hide-sm">
                  {b.chargedByName}
                  <div className="muted small">on {basisText(b.basis)}</div>
                </td>
                <td className="num hide-sm">{rm(b.billing)}</td>
                <td className="num">{b.amount == null ? <Chip tone="neutral">Unknown</Chip> : rm(b.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-body">
        {d.notes.map((n) => (
          <p key={n} className="muted small">
            {n}
          </p>
        ))}
      </div>
    </>
  );
}
