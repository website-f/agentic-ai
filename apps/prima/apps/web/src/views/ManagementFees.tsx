import { useState } from 'react';
import { api, type ManagementFeeBills, type ManagementFees } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';

type Row = ManagementFees[number];
type OpsCo = 'goodwill' | 'sasateam';
const OPS: { id: OpsCo; name: string; sites: string }[] = [
  { id: 'goodwill', name: 'Goodwill Empire', sites: 'government sites' },
  { id: 'sasateam', name: 'Sasa Team', sites: 'private sites' },
];
const rm = (n: number | null) => (n == null ? 'Unknown' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * Management fees (Fauzan, 2 Nov 2026): what Goodwill Empire (government sites) and Sasa Team (private sites) bill each
 * company, entered by the Finance Director or the CEO from the signed management agreements. A site's profit and loss
 * stays Unknown until its company's fee is in.
 */
export function ManagementFeesPanel() {
  const { data, error } = useLoad(() => api.managementFees(), []);
  const missing = data ? data.reduce((n, r) => n + (r.goodwill ? 0 : 1) + (r.sasateam ? 0 : 1), 0) : 0;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Management fees from the agreements</h3>
          {data && <Chip tone={missing ? 'warn' : 'ok'}>{missing} not entered</Chip>}
        </div>
        <p className="muted small">
          Enter each company's fees from its signed management agreements: Goodwill Empire for government sites, Sasa Team for private sites. Site profit and
          loss uses them and stays Unknown until they are entered. Every change is logged.
        </p>
        {error ? (
          <ErrorNotice error={error} />
        ) : !data ? (
          <Loading what="the fees" />
        ) : (
          <div className="list">
            {data.map((r) => (
              <div key={r.companyId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div style={{ fontWeight: 600 }}>{r.companyName}</div>
                {OPS.map((o) => (
                  <FeeLine key={o.id} r={r} ops={o} />
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
      <ManagementFeeBillsPanel />
    </>
  );
}

function FeeLine({ r, ops }: { r: Row; ops: (typeof OPS)[number] }) {
  const fee = r[ops.id];
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'percent' | 'fixed'>(fee?.kind ?? 'percent');
  const [value, setValue] = useState(fee ? String(fee.value) : '');
  const [ref, setRef] = useState(fee?.agreementRef ?? '');
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div className="small" style={{ minWidth: 0 }}>
          {ops.name} ({ops.sites}):{' '}
          <span className="muted">
            {fee
              ? `${fee.kind === 'percent' ? `${fee.value}% of billing` : `RM${fee.value.toFixed(2)} a month`} · agreement ${fee.agreementRef} · ${fee.by}, ${dateLabel(fee.at.slice(0, 10))}`
              : 'Not entered'}
          </span>
        </div>
        <button className="btn btn-sm" disabled={!r.finId} onClick={() => setOpen(!open)}>
          {fee ? 'Change' : 'Enter'}
        </button>
      </div>
      {open && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="input" aria-label="Fee type" value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'fixed')} style={{ width: 'auto' }}>
            <option value="percent">% of billing</option>
            <option value="fixed">RM a month</option>
          </select>
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
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || !value || !ref.trim()}
            onClick={() =>
              act.run(async () => {
                await api.setManagementFee(r.companyId, { opsCompany: ops.id, kind, value: Number(value), agreementRef: ref });
                setOpen(false);
              }, 'Saved.')
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

/**
 * The month's management fee bills from Goodwill Empire and Sasa Team to each company: a draft for Finance to raise in
 * SQL Account, not an invoice. Unknown when a fee or a site's billing is missing.
 */
export function ManagementFeeBillsPanel() {
  const today = new Date().toISOString().slice(0, 10);
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
        <select className="select" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }}>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
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
            key={t.opsCompanyId}
            label={t.opsCompanyName}
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
              <th className="num hide-sm">Site billing</th>
              <th className="num">Fee</th>
            </tr>
          </thead>
          <tbody>
            {d.bills.map((b) => (
              <tr key={`${b.opsCompanyId}-${b.companyId}`}>
                <td>
                  {b.companyName}
                  <div className="muted small">
                    {b.sites} site{b.sites === 1 ? '' : 's'} ·{' '}
                    {b.fee ? (b.fee.kind === 'percent' ? `${b.fee.value}% of billing` : `RM${b.fee.value.toFixed(2)} a month`) : 'fee not entered'}
                  </div>
                  {b.fee && b.unknownSites.length > 0 && (
                    <div className="muted small">
                      Unknown billing: {b.unknownSites.slice(0, 3).join(', ')}
                      {b.unknownSites.length > 3 ? ` and ${b.unknownSites.length - 3} more` : ''}
                    </div>
                  )}
                </td>
                <td className="hide-sm">{b.opsCompanyName}</td>
                <td className="num hide-sm">{rm(b.billing)}</td>
                <td className="num">{b.amount == null ? <Chip tone="neutral">Unknown</Chip> : rm(b.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.notes.map((n) => (
        <p key={n} className="muted small">
          {n}
        </p>
      ))}
    </>
  );
}
