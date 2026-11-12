import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type VehicleRentals } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';

/** Today in Malaysia, whatever the device's clock zone (the app keeps Malaysian dates). */
const mytNow = () => new Date(Date.now() + 8 * 3_600_000).toISOString();

type Row = VehicleRentals['vehicles'][number];
const rm = (n: number | null) => (n == null ? 'Unknown' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const monthsAround = (m: string, back: number, ahead: number) =>
  Array.from({ length: back + ahead + 1 }, (_, i) => {
    const d = new Date(`${m}-15T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i - back);
    return d.toISOString().slice(0, 7);
  });

/**
 * Vehicles rented from Perfect Global Logistics (Fauzan, 5 Nov 2026): the Transport department records which vehicles
 * are rented and from when, the Finance Director or the CEO sets each rent with a reason, the OGM and the COO monitor.
 * The month's rent bills are a draft for Finance, not an invoice.
 */
export function VehicleRentalsPanel() {
  const today = mytNow().slice(0, 7);
  const [month, setMonth] = useState(today);
  const { data, error } = useLoad(() => api.vehicleRentals(month), [month]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="rented vehicles" />;
  return (
    <>
      <section className="panel">
        <div className="panel-head" style={{ flexWrap: 'wrap', gap: 6 }}>
          <h3>Rented vehicles</h3>
          <Select className="select" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }}>
            {monthsAround(today, 6, 0).reverse().map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div className="panel-body">
        <p className="muted small">
          Perfect Global Logistics manages the group&apos;s vehicles and rents them to each company. A vehicle owned by one company can be used by another:
          the Transport department records which vehicles are rented, from when, and which company uses each one; the rent goes to the company using it on
          the month&apos;s last day. The Finance Director or the CEO sets each rent from the agreement. Every change needs a reason and is kept.
        </p>
        {data.canRecord && <StartRental data={data} />}
        <div className="list">
          {data.vehicles.length === 0 && <div className="empty">No rented vehicles recorded.</div>}
          {data.vehicles.map((v) => (
            <RentalLine key={v.vehicleId} v={v} data={data} />
          ))}
        </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Vehicle rent bills {data.month} (draft)</h3>
        </div>
        <div className="kpis">
          <Kpi label="Known rent" value={rm(data.total.known)} tone={data.total.unknownBills ? 'warn' : 'ok'} note={data.total.unknownBills ? `plus ${data.total.unknownBills} bill(s) Unknown` : 'all known'} />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th className="hide-sm">Rented from</th>
                <th className="num">Rent</th>
              </tr>
            </thead>
            <tbody>
              {data.bills.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No vehicle rented on the month&apos;s last day.
                  </td>
                </tr>
              )}
              {data.bills.map((b) => (
                <tr key={`${b.ownerId}-${b.companyId}`}>
                  <td>
                    {b.companyName}
                    <div className="muted small">
                      {b.vehicles} vehicle{b.vehicles === 1 ? '' : 's'}
                      {b.unknownPlates.length ? ` · rent not set: ${b.unknownPlates.join(', ')}` : ''}
                    </div>
                  </td>
                  <td className="hide-sm">{b.ownerName}</td>
                  <td className="num">{b.amount == null ? <Chip tone="neutral">Unknown</Chip> : rm(b.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-body">
          {data.notes.map((n) => (
            <p key={n} className="muted small">
              {n}
            </p>
          ))}
        </div>
      </section>
    </>
  );
}

function StartRental({ data }: { data: VehicleRentals }) {
  const act = useAction();
  const [vehicleId, setVehicleId] = useState('');
  const [ownerId, setOwnerId] = useState(data.owners[0]?.id ?? '');
  const [since, setSince] = useState(mytNow().slice(0, 10));
  const [reason, setReason] = useState('');
  if (!data.notRented.length) return null;
  return (
    <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Select className="input" aria-label="Vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Vehicle…</option>
          {data.notRented.map((v) => (
            <option key={v.vehicleId} value={v.vehicleId}>
              {v.plate} · {v.companyName}
            </option>
          ))}
        </Select>
        <Select className="input" aria-label="Rented from" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} style={{ width: 'auto' }}>
          {data.owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <input className="input" type="date" aria-label="Rented from date" value={since} onChange={(e) => setSince(e.target.value)} style={{ width: 'auto' }} />
      </div>
      <input className="input" aria-label="Reason" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !vehicleId || !ownerId || !since || reason.trim().length < 3}
          onClick={() =>
            act.run(async () => {
              await api.recordVehicleRental(vehicleId, { ownerId, since, reason });
              setVehicleId('');
              setReason('');
            }, 'Rental recorded.')
          }
        >
          Record rented vehicle
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function RentalLine({ v, data }: { v: Row; data: VehicleRentals }) {
  const act = useAction();
  const [open, setOpen] = useState<'rent' | 'end' | 'changes' | null>(null);
  const [monthly, setMonthly] = useState(v.rent ? String(v.rent.monthly) : '');
  const [ref, setRef] = useState(v.rent?.agreementRef ?? '');
  const [from, setFrom] = useState(data.month);
  const [on, setOn] = useState(mytNow().slice(0, 10));
  const [reason, setReason] = useState('');
  const toggle = (k: 'rent' | 'end' | 'changes') => {
    setReason('');
    setOpen(open === k ? null : k);
  };
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {v.plate} · {v.model}
          </div>
          <div className="muted small">
            {v.companyName} rents from {v.ownerName} since {dateLabel(v.since)}
            {v.ownedById !== v.companyId ? ` · owned by ${v.ownedByName}` : ''}
            {v.endedOn ? `, last day ${dateLabel(v.endedOn)}` : ''} ·{' '}
            {v.rent ? `RM${v.rent.monthly.toFixed(2)} a month (agreement ${v.rent.agreementRef})` : 'rent not set'}
          </div>
          {v.later.map((l) => (
            <div key={`${l.from}-${l.at}`} className="muted small">
              From {l.from}: RM{l.monthly.toFixed(2)} a month ({l.reason})
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {!v.billed && v.endedOn == null && <Chip tone="neutral">Not billed this month</Chip>}
          <button className="btn btn-sm" onClick={() => toggle('changes')}>
            Changes ({v.changes.length + v.moves.length})
          </button>
          {data.canSetRent && (
            <button className="btn btn-sm" onClick={() => toggle('rent')}>
              Set rent
            </button>
          )}
          {data.canRecord && v.endedOn == null && (
            <button className="btn btn-sm" onClick={() => toggle('end')}>
              End rental
            </button>
          )}
        </div>
      </div>
      {open === 'changes' && (
        <div className="list" style={{ gap: 4 }}>
          {v.changes.map((c) => (
            <div key={`${c.at}-${c.what}`} className="small muted">
              {dateLabel(c.at.slice(0, 10))} · {c.by}: {c.what}. Reason: {c.reason}
            </div>
          ))}
          {v.moves.map((x) => (
            <div key={`move-${x.at}-${x.from}`} className="small muted">
              {dateLabel(x.at.slice(0, 10))} · {x.by}: used by {x.companyName} from {dateLabel(x.from)}. Reason: {x.reason}
            </div>
          ))}
        </div>
      )}
      {open === 'rent' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Monthly rent" inputMode="decimal" placeholder="RM a month" value={monthly} onChange={(e) => setMonthly(e.target.value)} style={{ width: 120 }} />
          <input className="input" aria-label="Agreement reference" placeholder="Agreement reference" value={ref} onChange={(e) => setRef(e.target.value)} />
          <Select className="input" aria-label="Applies from" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }}>
            {monthsAround(mytNow().slice(0, 7), 1, 11).map((m) => (
              <option key={m} value={m}>
                From {m}
              </option>
            ))}
          </Select>
          <input className="input" aria-label="Reason" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || !monthly || !ref.trim() || reason.trim().length < 3}
            onClick={() => act.run(async () => (await api.setVehicleRent(v.vehicleId, { monthly: Number(monthly), agreementRef: ref, reason, from }), setOpen(null)), 'Rent saved.')}
          >
            Save rent
          </button>
        </div>
      )}
      {open === 'end' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" type="date" aria-label="Last rented day" value={on} onChange={(e) => setOn(e.target.value)} style={{ width: 'auto' }} />
          <input className="input" aria-label="Reason" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || !on || reason.trim().length < 3}
            onClick={() => act.run(async () => (await api.endVehicleRental(v.vehicleId, { on, reason }), setOpen(null)), 'Rental ended.')}
          >
            End rental
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
