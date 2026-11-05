import { useState } from 'react';
import { useApp } from '../App';
import { RecordButton } from './RecordForm';
import type { ProofInput, VehicleRenewal } from '@prima/core';
import { api, type FleetBoard } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';

/**
 * Fleet (Fauzan, 26 Oct 2026). The head of Transport monitors every company vehicle and is reminded of renewals,
 * servicing and payments; staff request a vehicle and the Transport head approves, and each use is logged out and in.
 * CMS monitors the tracker, dashcam and driver health; nothing is connected yet, so those show as unknown. The PDPA
 * officer files each driver's consent before a monitored vehicle goes out.
 */

type Row = FleetBoard['board'][number];
type Request = FleetBoard['requests'][number];

const RENEWAL_LABEL: Record<VehicleRenewal, string> = { ROAD_TAX: 'Road tax', INSURANCE: 'Insurance', PUSPAKOM: 'PUSPAKOM', PERMIT: 'Permit' };
const DEVICE: Record<string, [Tone, string]> = {
  live: ['ok', 'Live'],
  unknown: ['unknown', 'Unknown'],
  none: ['neutral', 'None fitted'],
  idle: ['neutral', 'Parked'],
};
const STATUS: Record<Request['status'], [Tone, string]> = {
  requested: ['warn', 'Waiting for Transport'],
  approved: ['info', 'Approved'],
  rejected: ['crit', 'Rejected'],
  out: ['info', 'Out'],
  returned: ['ok', 'Returned'],
  cancelled: ['neutral', 'Cancelled'],
};

export function FleetView() {
  const { data, error } = useLoad(() => api.fleetBoard(), []);
  const [tab, setTab] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="vehicles" />;
  const full = data.role === 'transport' || data.role === 'leader';
  const tabs: [string, string, number][] = full
    ? [
        ['due', 'Reminders', data.reminders.length],
        ['vehicles', 'Vehicles', 0],
        ['requests', 'Requests', data.requests.filter((r) => r.status === 'requested').length],
        ['monitor', 'Monitor', 0],
        ['hours', 'Trips and driving hours', 0],
      ]
    : data.role === 'cms'
      ? [
          ['monitor', 'Monitor', 0],
          ['hours', 'Trips and driving hours', 0],
        ]
      : data.role === 'pdpa'
        ? [
            ['consent', 'Driver consent', data.consentNeeded.length],
            ['mine', 'My requests', 0],
          ]
        : [['mine', 'My requests', 0]];
  const view = tab && tabs.some((t) => t[0] === tab) ? tab : tabs[0][0];
  const unknown = data.board.filter((v) => v.tracker === 'unknown' || v.dashcam === 'unknown' || v.health === 'unknown').length;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Vehicles</h1>
        <p className="muted">
          The head of Transport runs every company vehicle: renewals, servicing, payments, and each trip out and in. Staff request a vehicle here. CMS watches
          trackers, dashcams and driver health.
        </p>
      </div>
      {data.board.length > 0 && (
        <div className="kpis">
          {full && (
            <Kpi
              label="Due or overdue"
              value={data.reminders.length}
              tone={data.reminders.some((r) => r.tone === 'crit') ? 'crit' : data.reminders.length ? 'warn' : 'ok'}
            />
          )}
          <Kpi label="Out now" value={data.board.filter((v) => v.out).length} />
          <Kpi label="Devices unknown" value={unknown} tone={unknown ? 'unknown' : 'ok'} note="Not connected or silent" />
        </div>
      )}
      {tabs.length > 1 && (
        <div className="tabbar" role="tablist" aria-label="Vehicle sections">
          {tabs.map(([k, label, n]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setTab(k)}>
              {label}
              {n > 0 && <span className="tab-count">{n}</span>}
            </button>
          ))}
        </div>
      )}
      {view === 'due' && <Reminders data={data} />}
      {view === 'vehicles' && <Vehicles data={data} edit={data.role === 'transport'} />}
      {view === 'requests' && <Requests data={data} edit={data.role === 'transport'} />}
      {view === 'monitor' && <Monitor rows={data.board} />}
      {view === 'hours' && <TripsAndHours />}
      {view === 'consent' && <Consent data={data} />}
      {view === 'mine' && <Mine data={data} />}
    </div>
  );
}

function Reminders({ data }: { data: FleetBoard }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Renewals, servicing and payments</h3>
      </div>
      <div className="list">
        {data.reminders.length === 0 && <div className="empty">Nothing due.</div>}
        {data.reminders.map((r, i) => (
          <div key={i} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>
                {r.plate}: {r.what}
              </div>
              <div className="muted small">
                {r.companyName} · {dateLabel(r.due)}
              </div>
            </div>
            <Chip tone={r.tone}>{r.days < 0 ? `${-r.days} days late` : r.days === 0 ? 'Today' : `${r.days} days`}</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}

function Vehicles({ data, edit }: { data: FleetBoard; edit: boolean }) {
  const { companyId, company } = useApp();
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Vehicles</h3>
        <RecordButton kind="vehicle" companyId={companyId} label={company ? `Add vehicle (${company.code})` : 'Add vehicle'} />
      </div>
      <div className="list">
        {data.board.map((v) => (
          <VehicleLine key={v.id} v={v} edit={edit} approved={data.requests.filter((r) => r.status === 'approved' && r.vehicleId === v.id)} />
        ))}
      </div>
    </section>
  );
}

function VehicleLine({ v, edit, approved }: { v: Row; edit: boolean; approved: Request[] }) {
  const [open, setOpen] = useState(false);
  const [km, setKm] = useState(0);
  const [requestId, setRequestId] = useState(approved[0]?.id ?? '');
  const [driver, setDriver] = useState('');
  const [note, setNote] = useState('');
  const [work, setWork] = useState<'RENEWAL' | 'SERVICE' | 'PAYMENT'>('RENEWAL');
  const [renewal, setRenewal] = useState<VehicleRenewal>((Object.keys(v.renewals ?? {})[0] as VehicleRenewal) ?? 'ROAD_TAX');
  const [nextDue, setNextDue] = useState('');
  const [nextDueKm, setNextDueKm] = useState(0);
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const worst = v.reminders?.[0];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {v.plate} · {v.model}
          </div>
          <div className="muted small">
            {v.companyName} · {v.odometerKm?.toLocaleString()} km{v.out ? ` · out with ${v.out.driver} since ${dateTimeLabel(v.out.at)}` : ' · in the yard'}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {worst ? <Chip tone={worst.tone}>{worst.what}</Chip> : <Chip tone="ok">Up to date</Chip>}
          <RecordButton kind="vehicle" id={v.id} />
          <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : edit ? 'Act' : 'Details'}
          </button>
        </div>
      </div>
      {open && (
        <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            {Object.entries(v.renewals ?? {})
              .map(([k, d]) => `${RENEWAL_LABEL[k as VehicleRenewal]} ${dateLabel(d)}`)
              .join(' · ')}
          </div>
          <div>
            Service by {dateLabel(v.service?.dueOn)} or {v.service?.dueKm.toLocaleString()} km
            {v.payment ? ` · ${v.payment.lender} RM${v.payment.monthly.toFixed(2)} on day ${v.payment.dayOfMonth}, until ${dateLabel(v.payment.endsOn)}` : ''}
          </div>
          {v.log && v.log.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {v.log.map((l, i) => (
                <li key={i}>
                  {l.what} · {l.by}, {dateTimeLabel(l.at)}
                </li>
              ))}
            </ul>
          )}
          {edit && (
            <>
              <div style={{ fontWeight: 600 }}>{v.out ? 'Log it back in' : 'Log it out'}</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {!v.out && (
                  <select className="select" aria-label="Approved request" value={requestId} onChange={(e) => setRequestId(e.target.value)}>
                    {approved.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}: {r.purpose}
                      </option>
                    ))}
                    <option value="">No request (name the driver)</option>
                  </select>
                )}
                {!v.out && !requestId && (
                  <input className="input" aria-label="Driver" placeholder="Driver" value={driver} onChange={(e) => setDriver(e.target.value)} />
                )}
                <input
                  className="input"
                  type="number"
                  aria-label="Odometer km"
                  placeholder="Odometer km"
                  value={km || ''}
                  onChange={(e) => setKm(Number(e.target.value) || 0)}
                />
                {v.out && <input className="input" aria-label="Note" placeholder="Condition note" value={note} onChange={(e) => setNote(e.target.value)} />}
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || !km}
                  onClick={() =>
                    act.run(
                      () => (v.out ? api.vehicleIn(v.id, km, note) : api.vehicleOut(v.id, requestId || null, km, driver)),
                      v.out ? 'Logged in.' : 'Logged out.',
                    )
                  }
                >
                  {v.out ? 'Log in' : 'Log out'}
                </button>
              </div>
              <div style={{ fontWeight: 600 }}>Record a renewal, service or payment</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <select className="select" aria-label="Work" value={work} onChange={(e) => setWork(e.target.value as typeof work)}>
                  <option value="RENEWAL">Renewal</option>
                  <option value="SERVICE">Service</option>
                  {v.payment && <option value="PAYMENT">Instalment paid</option>}
                </select>
                {work === 'RENEWAL' && (
                  <select className="select" aria-label="Renewal" value={renewal} onChange={(e) => setRenewal(e.target.value as VehicleRenewal)}>
                    {Object.keys(v.renewals ?? {}).map((k) => (
                      <option key={k} value={k}>
                        {RENEWAL_LABEL[k as VehicleRenewal]}
                      </option>
                    ))}
                  </select>
                )}
                {work !== 'PAYMENT' && (
                  <label className="small">
                    {work === 'RENEWAL' ? 'New expiry' : 'Next service'}{' '}
                    <input className="input" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
                  </label>
                )}
                {work === 'SERVICE' && (
                  <input
                    className="input"
                    type="number"
                    aria-label="Next service km"
                    placeholder="Next service km"
                    value={nextDueKm || ''}
                    onChange={(e) => setNextDueKm(Number(e.target.value) || 0)}
                  />
                )}
              </div>
              <ProofPicker site={null} refText={v.plate} items={proof} onChange={setProof} documentsOnly required />
              <div>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || !proof.length || (work !== 'PAYMENT' && !nextDue)}
                  onClick={() =>
                    act
                      .run(
                        () => api.recordVehicleWork(v.id, { kind: work, renewal, nextDue: nextDue || undefined, nextDueKm: nextDueKm || undefined }, proof),
                        'Recorded.',
                      )
                      .then((r) => r && setProof([]))
                  }
                >
                  Record with receipt
                </button>
              </div>
            </>
          )}
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
  );
}

function Requests({ data, edit }: { data: FleetBoard; edit: boolean }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Requests</h3>
      </div>
      <div className="list">
        {data.requests.length === 0 && <div className="empty">No requests.</div>}
        {data.requests.map((r) => (
          <RequestLine key={r.id} r={r} edit={edit && r.status === 'requested'} vehicles={data.board} />
        ))}
      </div>
    </section>
  );
}

function RequestLine({ r, edit, vehicles }: { r: Request; edit: boolean; vehicles: Row[] }) {
  const [vehicleId, setVehicleId] = useState(r.vehicleId ?? vehicles.find((v) => !v.out)?.id ?? '');
  const [note, setNote] = useState('');
  const act = useAction();
  const [tone, label] = STATUS[r.status];
  const plate = vehicles.find((v) => v.id === r.vehicleId)?.plate;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {r.name}: {r.purpose}
          </div>
          <div className="muted small">
            {dateTimeLabel(r.from)} to {dateTimeLabel(r.to)}
            {plate ? ` · ${plate}` : ''}
            {r.decision?.note ? ` · ${r.decision.note}` : ''}
          </div>
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      {edit && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="select" aria-label="Vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate} · {v.model}
              </option>
            ))}
          </select>
          <input className="input" aria-label="Note" placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !vehicleId}
            onClick={() => act.run(() => api.decideVehicleRequest(r.id, true, vehicleId, note), 'Approved.')}
          >
            Approve
          </button>
          <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.decideVehicleRequest(r.id, false, null, note), 'Rejected.')}>
            Reject
          </button>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
  );
}

function Monitor({ rows }: { rows: Row[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Trackers, dashcams and driver health</h3>
          <div className="muted small">CMS monitors; the Transport head acts. Unknown means not connected or silent for over 30 minutes, never fine.</div>
        </div>
      </div>
      <div className="list">
        {rows.map((v) => (
          <div key={v.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div style={{ fontWeight: 600 }}>
              {v.plate} · {v.companyName}
              {v.out ? <span className="muted"> · out with {v.out.driver}</span> : null}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Chip tone={DEVICE[v.tracker][0]}>Tracker: {DEVICE[v.tracker][1]}</Chip>
              <Chip tone={DEVICE[v.dashcam][0]}>Dashcam: {DEVICE[v.dashcam][1]}</Chip>
              <Chip tone={DEVICE[v.health][0]}>Driver health: {DEVICE[v.health][1]}</Chip>
              {v.driverConsent === 'missing' && <Chip tone="crit">Driver consent missing</Chip>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Consent({ data }: { data: FleetBoard }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Driver consent to monitoring</h3>
          <div className="muted small">
            Dashcam footage and health readings are personal data. File each driver's signed consent before they drive a monitored vehicle.
          </div>
        </div>
      </div>
      <div className="list">
        {data.consentNeeded.length === 0 && <div className="empty">No driver is waiting for consent.</div>}
        {data.consentNeeded.map((c) => (
          <ConsentLine key={c.personId} c={c} />
        ))}
      </div>
    </section>
  );
}

function ConsentLine({ c }: { c: FleetBoard['consentNeeded'][number] }) {
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div style={{ fontWeight: 600 }}>
        {c.name} <span className="muted small">· asked for {c.for}</span>
      </div>
      <ProofPicker site={null} refText="Consent" items={proof} onChange={setProof} documentsOnly required />
      <div>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !proof.length}
          onClick={() => act.run(() => api.fileMonitoringConsent(c.personId, proof), 'Consent filed.')}
        >
          File consent
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Mine({ data }: { data: FleetBoard }) {
  const [purpose, setPurpose] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const act = useAction();
  const iso = (v: string) => `${v}:00+08:00`;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Request a vehicle</h3>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        <input className="input" aria-label="Purpose" placeholder="What it is for" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <label className="small">
            From <input className="input" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="small">
            To <input className="input" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <select className="select" aria-label="Vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Any vehicle (Transport chooses)</option>
            {data.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate} · {v.model}
                {v.busy ? ' (out now)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || purpose.trim().length < 3 || !from || !to}
            onClick={() =>
              act
                .run(() => api.requestVehicle({ purpose, from: iso(from), to: iso(to), vehicleId: vehicleId || null }), 'Sent to Transport.')
                .then((r) => {
                  if (r) setPurpose('');
                })
            }
          >
            Send request
          </button>
        </div>
        <ErrorNotice error={act.error} />
      </div>
      <div className="list">
        {data.mine.length === 0 && <div className="empty">No requests yet.</div>}
        {data.mine.map((r) => (
          <RequestLine key={r.id} r={r} edit={false} vehicles={[]} />
        ))}
      </div>
    </section>
  );
}

/**
 * Live trips from the vehicle trackers and each driver's hours today (slice 4F). Positions are kept only while a
 * vehicle is out on a trip. The hour limits are proposals until Transport confirms them.
 */
function TripsAndHours() {
  const { data, error } = useLoad(() => api.transportBoard(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="trips" />;
  const h = (min: number) => `${Math.round(min / 6) / 10} h`;
  return (
    <>
      {data.alerts.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Driver alerts</h2>
          </div>
          <div className="list">
            {data.alerts.map((a, i) => (
              <div key={i} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>{a.title}</div>
                  <div className="muted small">{a.detail}</div>
                </div>
                <Chip tone={a.tone}>{a.tone === 'crit' ? 'Stop' : 'Break'}</Chip>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>On the road</h2>
          <span className="muted small">
            Proposed limits: {h(data.rule.maxDayMin)} a day, a {data.rule.breakMin} minute break after {h(data.rule.maxStretchMin)}, {data.rule.speedLimitKmh} km/h
          </span>
        </div>
        <div className="list">
          {data.onTheRoad.length === 0 && <div className="empty">No vehicle out now.</div>}
          {data.onTheRoad.map((v) => (
            <div key={v.vehicleId} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {v.plate} · {v.driver}
                </div>
                <div className="muted small">
                  {v.trip ? `${v.trip.km} km since ${dateTimeLabel(v.trip.start)} · top ${v.trip.maxKmh} km/h${v.trip.overSpeed ? ` · ${v.trip.overSpeed} over-speed` : ''}` : 'Tracker not sending'}
                </div>
              </div>
              <Chip tone={v.trip?.panicAt ? 'crit' : v.tracker === 'live' ? 'ok' : 'unknown'}>{v.trip?.panicAt ? 'Panic' : v.tracker}</Chip>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Driving hours today</h2>
        </div>
        <div className="list">
          {data.hours.length === 0 && <div className="empty">No driving recorded today.</div>}
          {data.hours.map((d) => (
            <div key={d.driverUserId} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>{d.driver}</div>
                <div className="muted small">
                  {h(d.drivingMin)} driven · {h(d.stretchMin)} since the last break · {d.vehicles.join(', ')}
                </div>
              </div>
              <Chip tone={d.overDay ? 'crit' : d.needsBreak ? 'warn' : 'ok'}>{d.overDay ? 'Over the day' : d.needsBreak ? 'Break due' : 'Fine'}</Chip>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
