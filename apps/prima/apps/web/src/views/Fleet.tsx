import { Select } from '../SearchSelect';
import { useRef, useState } from 'react';
import { CalendarCheckIcon, CarIcon, ClipboardTextIcon, QuestionIcon } from '@phosphor-icons/react';
import { useApp } from '../App';
import { RecordButton } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import { p91MayImport, type ProofInput, type VehicleRenewal } from '@prima/core';
import { api, type FleetBoard } from '../api';
import { Card, Empty, Facts, PageHead, Split, Stat, Stats } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';
import { VehicleRentalsPanel } from './VehicleRentals';
import { VehicleTransfersPanel } from './VehicleTransfers';
import { FuelUsagePanel, MyFuel } from './FuelUsage';
import '../styles/ops.css';

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

const dueText = (days: number) => (days < 0 ? `${-days} days late` : days === 0 ? 'Today' : `${days} days`);

export function FleetView() {
  const { companyId, company, me } = useApp();
  const { data, error } = useLoad(() => api.fleetBoard(), []);
  const [tab, setTab] = useState<string | null>(null);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="vehicles" />
      </div>
    );
  const full = data.role === 'transport' || data.role === 'leader';
  const waiting = data.requests.filter((r) => r.status === 'requested').length;
  // Rented vehicles (5 Nov 2026): Transport records, the FD or the CEO sets rents, the OGM and the COO monitor.
  const rentals =
    data.role === 'transport' ||
    me.user.opsTier === 'ceo' ||
    me.user.opsTier === 'coo' ||
    me.user.opsTier === 'ogm' ||
    (me.user.role === 'pwvsb_officer' && me.user.leadership === 'finance_director');
  const tabs: [string, string, number][] = full
    ? [
        ['due', 'Reminders', data.reminders.length],
        ['vehicles', 'Vehicles', 0],
        ['requests', 'Requests', waiting],
        ['monitor', 'Monitor', 0],
        ['hours', 'Trips and driving hours', 0],
        ['usage', 'Fuel and usage', 0],
        ...(rentals ? ([['rentals', 'Rented vehicles', 0]] as [string, string, number][]) : []),
        // E6 (P100): moving a vehicle to another company's use; Transport asks and hands over, the COO watches.
        ['transfers', 'Move between companies', 0],
      ]
    : me.user.opsTier === 'ogm'
      ? [
          ['mine', 'My requests', 0],
          ['usage', 'Fuel and usage', 0],
          ['rentals', 'Rented vehicles', 0],
          ['transfers', 'Move between companies', 0],
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
  const go = (k: string) => (tabs.some((t) => t[0] === k) ? () => setTab(k) : undefined);
  return (
    <div className="page">
      <PageHead
        title="Vehicles"
        sub="The head of Transport runs every company vehicle: renewals, servicing, payments, and each trip out and in. Staff request a vehicle here. CMS watches trackers, dashcams and driver health."
        actions={
          full && (
            <>
              <ImportButton kind="vehicle" companyId={companyId} />
              <RecordButton kind="vehicle" companyId={companyId} label={company ? `Add vehicle (${company.code})` : 'Add vehicle'} primary />
              {/* P91: fuel and subsidy cards load from the old list by plate (Transport only). */}
              {p91MayImport(me.user, 'fuelCard') && <ImportButton kind="fuelCard" label="Import fuel cards" />}
            </>
          )
        }
      />
      {data.board.length > 0 && (
        <Stats>
          {full && (
            <Stat
              label="Due or overdue"
              value={data.reminders.length}
              tone={data.reminders.some((r) => r.tone === 'crit') ? 'crit' : data.reminders.length ? 'warn' : 'ok'}
              note="Road tax, insurance, service, payments"
              icon={<CalendarCheckIcon size={16} />}
              onClick={go('due')}
            />
          )}
          <Stat label="Out now" value={data.board.filter((v) => v.out).length} note={`Of ${data.board.length} vehicles`} icon={<CarIcon size={16} />} tone="info" />
          {full && (
            <Stat
              label="Requests waiting"
              value={waiting}
              tone={waiting ? 'warn' : undefined}
              note="For Transport to decide"
              icon={<ClipboardTextIcon size={16} />}
              onClick={go('requests')}
            />
          )}
          <Stat
            label="Devices unknown"
            value={unknown}
            tone={unknown ? 'unknown' : 'ok'}
            note="Not connected or silent"
            icon={<QuestionIcon size={16} />}
            onClick={go('monitor')}
          />
        </Stats>
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
      {view === 'rentals' && <VehicleRentalsPanel />}
      {view === 'transfers' && <VehicleTransfersPanel />}
      {view === 'usage' && <FuelUsagePanel />}
      {view === 'mine' && <MyFuel />}
    </div>
  );
}

function Reminders({ data }: { data: FleetBoard }) {
  return (
    <Card title="Renewals, servicing and payments" sub="Most urgent first" flush>
      {data.reminders.length === 0 && <Empty title="Nothing due." />}
      <ul className="op-list">
        {[...data.reminders]
          .sort((a, b) => a.days - b.days)
          .map((r, i) => (
            <li key={i} className="op-item" data-tone={r.tone}>
              <div className="op-line">
                <div className="op-main">
                  <span className="op-title">
                    <span className="fl-plate">{r.plate}</span>: {r.what}
                  </span>
                  <span className="op-meta">
                    {r.companyName} · {dateLabel(r.due)}
                  </span>
                </div>
                <Chip tone={r.tone}>{dueText(r.days)}</Chip>
              </div>
            </li>
          ))}
      </ul>
    </Card>
  );
}

function Vehicles({ data, edit }: { data: FleetBoard; edit: boolean }) {
  const { companyId, company } = useApp();
  const [pick, setPick] = useState<string | null>(null);
  const detail = useRef<HTMLDivElement>(null);
  const sel = data.board.find((v) => v.id === pick) ?? data.board[0];
  const choose = (id: string) => {
    setPick(id);
    const el = detail.current;
    if (el && window.matchMedia('(max-width: 860px)').matches) requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const list = (
    <Card
      title="Vehicles"
      sub={`${data.board.length} vehicles`}
      actions={
        <>
          <ImportButton kind="vehicle" companyId={companyId} />
          <RecordButton kind="vehicle" companyId={companyId} label={company ? `Add vehicle (${company.code})` : 'Add vehicle'} />
        </>
      }
      flush
    >
      {data.board.length === 0 && (
        <Empty title="No vehicles yet." action={<RecordButton kind="vehicle" companyId={companyId} label="Add vehicle" primary />}>
          Add each company vehicle with its road tax, insurance and service dates; Prima reminds Transport before they fall due.
        </Empty>
      )}
      <ul className="op-list">
        {data.board.map((v) => {
          const worst = v.reminders?.[0];
          return (
            <li key={v.id}>
              <button className="op-item fl-item" data-tone={worst?.tone} aria-current={sel?.id === v.id} onClick={() => choose(v.id)}>
                <span className="op-main">
                  <span className="op-title">
                    <span className="fl-plate">{v.plate}</span> · {v.model}
                  </span>
                  <span className="op-meta">{v.out ? `Out with ${v.out.driver}` : 'In the yard'}</span>
                  <span className="op-co">
                    {v.companyName}
                    {v.usedByName ? ` (used by ${v.usedByName})` : ''}
                  </span>
                </span>
                {worst ? <Chip tone={worst.tone}>{worst.what}</Chip> : <Chip tone="ok">Up to date</Chip>}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
  return (
    <Split
      list={list}
      detail={
        <div ref={detail} className="fl-detail">
          {sel ? (
            <VehicleDetail key={sel.id} v={sel} edit={edit} approved={data.requests.filter((r) => r.status === 'approved' && r.vehicleId === sel.id)} />
          ) : (
            <Card title="Vehicle">
              <Empty title="No vehicle chosen." />
            </Card>
          )}
        </div>
      }
    />
  );
}

function VehicleDetail({ v, edit, approved }: { v: Row; edit: boolean; approved: Request[] }) {
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
  const facts: [string, string][] = [
    ['Where', v.out ? `Out with ${v.out.driver} since ${dateTimeLabel(v.out.at)}` : 'In the yard'],
    ['Odometer', `${v.odometerKm?.toLocaleString() ?? '-'} km`],
    ...Object.entries(v.renewals ?? {}).map(([k, d]) => [RENEWAL_LABEL[k as VehicleRenewal], dateLabel(d)] as [string, string]),
    ['Service by', `${dateLabel(v.service?.dueOn)} or ${v.service?.dueKm.toLocaleString()} km`],
    ...(v.payment
      ? [['Instalment', `${v.payment.lender} RM${v.payment.monthly.toFixed(2)} on day ${v.payment.dayOfMonth}, until ${dateLabel(v.payment.endsOn)}`] as [string, string]]
      : []),
  ];
  return (
    <Card title={`${v.plate} · ${v.model}`} sub={v.usedByName ? `${v.companyName} (used by ${v.usedByName})` : v.companyName} actions={<RecordButton kind="vehicle" id={v.id} label="Edit vehicle" />}>
      <div className="op-chips">
        {v.reminders && v.reminders.length > 0 ? (
          v.reminders.map((r, i) => (
            <Chip key={i} tone={r.tone}>
              {r.what} · {dueText(r.days)}
            </Chip>
          ))
        ) : (
          <Chip tone="ok">Up to date</Chip>
        )}
      </div>
      <div className="op-facts">
        <Facts items={facts} />
      </div>

      {edit && (
        <section className="op-sec">
          <div className="op-sec-head">
            <h3>{v.out ? 'Log it back in' : 'Log it out'}</h3>
          </div>
          <div className="op-form-grid">
            {!v.out && (
              <label className="field">
                <span className="label">Approved request</span>
                <Select className="select" aria-label="Approved request" value={requestId} onChange={(e) => setRequestId(e.target.value)}>
                  {approved.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}: {r.purpose}
                    </option>
                  ))}
                  <option value="">No request (name the driver)</option>
                </Select>
              </label>
            )}
            {!v.out && !requestId && (
              <label className="field">
                <span className="label">Driver</span>
                <input className="input" aria-label="Driver" placeholder="Driver" value={driver} onChange={(e) => setDriver(e.target.value)} />
              </label>
            )}
            <label className="field">
              <span className="label">Odometer km</span>
              <input
                className="input"
                type="number"
                aria-label="Odometer km"
                placeholder="Odometer km"
                value={km || ''}
                onChange={(e) => setKm(Number(e.target.value) || 0)}
              />
            </label>
            {v.out && (
              <label className="field">
                <span className="label">Condition note</span>
                <input className="input" aria-label="Note" placeholder="Condition note" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            )}
          </div>
          <div className="op-form-actions">
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
        </section>
      )}

      {edit && (
        <section className="op-sec">
          <div className="op-sec-head">
            <h3>Record a renewal, service or payment</h3>
          </div>
          <div className="op-form-grid">
            <label className="field">
              <span className="label">Work</span>
              <Select className="select" aria-label="Work" value={work} onChange={(e) => setWork(e.target.value as typeof work)}>
                <option value="RENEWAL">Renewal</option>
                <option value="SERVICE">Service</option>
                {v.payment && <option value="PAYMENT">Instalment paid</option>}
              </Select>
            </label>
            {work === 'RENEWAL' && (
              <label className="field">
                <span className="label">Renewal</span>
                <Select className="select" aria-label="Renewal" value={renewal} onChange={(e) => setRenewal(e.target.value as VehicleRenewal)}>
                  {Object.keys(v.renewals ?? {}).map((k) => (
                    <option key={k} value={k}>
                      {RENEWAL_LABEL[k as VehicleRenewal]}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {work !== 'PAYMENT' && (
              <label className="field">
                <span className="label">{work === 'RENEWAL' ? 'New expiry' : 'Next service'}</span>
                <input className="input" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
              </label>
            )}
            {work === 'SERVICE' && (
              <label className="field">
                <span className="label">Next service km</span>
                <input
                  className="input"
                  type="number"
                  aria-label="Next service km"
                  placeholder="Next service km"
                  value={nextDueKm || ''}
                  onChange={(e) => setNextDueKm(Number(e.target.value) || 0)}
                />
              </label>
            )}
          </div>
          <ProofPicker site={null} refText={v.plate} items={proof} onChange={setProof} documentsOnly required />
          <div className="op-form-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !proof.length || (work !== 'PAYMENT' && !nextDue)}
              onClick={() =>
                act
                  .run(() => api.recordVehicleWork(v.id, { kind: work, renewal, nextDue: nextDue || undefined, nextDueKm: nextDueKm || undefined }, proof), 'Recorded.')
                  .then((r) => r && setProof([]))
              }
            >
              Record with receipt
            </button>
          </div>
        </section>
      )}
      <ErrorNotice error={act.error} />

      {v.log && v.log.length > 0 && (
        <section className="op-sec">
          <div className="op-sec-head">
            <h3>Recent history</h3>
          </div>
          <ul className="fl-log">
            {v.log.map((l, i) => (
              <li key={i}>
                <span>{l.what}</span>
                <span className="op-meta">
                  {l.by}, {dateTimeLabel(l.at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Card>
  );
}

function Requests({ data, edit }: { data: FleetBoard; edit: boolean }) {
  const order = [...data.requests].sort((a, b) => (a.status === 'requested' ? 0 : 1) - (b.status === 'requested' ? 0 : 1));
  return (
    <Card title="Requests" sub="Waiting for Transport first" flush>
      {data.requests.length === 0 && <Empty title="No requests." />}
      <ul className="op-list">
        {order.map((r) => (
          <RequestLine key={r.id} r={r} edit={edit && r.status === 'requested'} vehicles={data.board} />
        ))}
      </ul>
    </Card>
  );
}

function RequestLine({ r, edit, vehicles }: { r: Request; edit: boolean; vehicles: Row[] }) {
  const [vehicleId, setVehicleId] = useState(r.vehicleId ?? vehicles.find((v) => !v.out)?.id ?? '');
  const [note, setNote] = useState('');
  const act = useAction();
  const [tone, label] = STATUS[r.status];
  const plate = vehicles.find((v) => v.id === r.vehicleId)?.plate;
  return (
    <li className="op-item" data-tone={r.status === 'requested' ? 'warn' : undefined}>
      <div className="op-line">
        <div className="op-main">
          <span className="op-title">
            {r.name}: {r.purpose}
          </span>
          <span className="op-meta">
            {dateTimeLabel(r.from)} to {dateTimeLabel(r.to)}
            {plate ? ` · ${plate}` : ''}
            {r.decision?.note ? ` · ${r.decision.note}` : ''}
          </span>
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      {edit && (
        <div className="op-act">
          <Select className="select" aria-label="Vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate} · {v.model}
              </option>
            ))}
          </Select>
          <input className="input" aria-label="Note" placeholder="Comment (needed to approve or reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !vehicleId || !note.trim()}
            onClick={() => act.run(() => api.decideVehicleRequest(r.id, true, vehicleId, note), 'Approved.')}
          >
            Approve
          </button>
          <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.decideVehicleRequest(r.id, false, null, note), 'Rejected.')}>
            Reject
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </li>
  );
}

function Monitor({ rows }: { rows: Row[] }) {
  return (
    <Card
      title="Trackers, dashcams and driver health"
      sub="CMS monitors; the Transport head acts. Unknown means not connected or silent for over 30 minutes, never fine."
      flush
    >
      {rows.length === 0 && <Empty title="No vehicles." />}
      <ul className="op-list">
        {rows.map((v) => (
          <li key={v.id} className="op-item" data-tone={v.driverConsent === 'missing' ? 'crit' : undefined}>
            <div className="op-main">
              <span className="op-title">
                <span className="fl-plate">{v.plate}</span> · {v.companyName}
              </span>
              {v.out && <span className="op-meta">Out with {v.out.driver}</span>}
            </div>
            <div className="op-chips">
              <Chip tone={DEVICE[v.tracker][0]}>Tracker: {DEVICE[v.tracker][1]}</Chip>
              <Chip tone={DEVICE[v.dashcam][0]}>Dashcam: {DEVICE[v.dashcam][1]}</Chip>
              <Chip tone={DEVICE[v.health][0]}>Driver health: {DEVICE[v.health][1]}</Chip>
              {v.driverConsent === 'missing' && <Chip tone="crit">Driver consent missing</Chip>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Consent({ data }: { data: FleetBoard }) {
  return (
    <Card
      title="Driver consent to monitoring"
      sub="Dashcam footage and health readings are personal data. File each driver's signed consent before they drive a monitored vehicle."
      flush
    >
      {data.consentNeeded.length === 0 && <Empty title="No driver is waiting for consent." />}
      <ul className="op-list">
        {data.consentNeeded.map((c) => (
          <ConsentLine key={c.personId} c={c} />
        ))}
      </ul>
    </Card>
  );
}

function ConsentLine({ c }: { c: FleetBoard['consentNeeded'][number] }) {
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <li className="op-item">
      <div className="op-main">
        <span className="op-title">{c.name}</span>
        <span className="op-meta">Asked for {c.for}</span>
      </div>
      <ProofPicker site={null} refText="Consent" items={proof} onChange={setProof} documentsOnly required />
      <div className="op-act">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !proof.length}
          onClick={() => act.run(() => api.fileMonitoringConsent(c.personId, proof), 'Consent filed.')}
        >
          File consent
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </li>
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
    <div className="op-grid-2">
      <Card
        title="Request a vehicle"
        sub="Transport approves and chooses the vehicle if you leave it open"
        footer={
          <button
            className="btn btn-primary"
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
        }
      >
        <div className="op-form">
          <label className="field">
            <span className="label">What it is for</span>
            <input className="input" aria-label="Purpose" placeholder="What it is for" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </label>
          <div className="op-form-grid">
            <label className="field">
              <span className="label">From</span>
              <input className="input" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">To</span>
              <input className="input" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span className="label">Vehicle</span>
            <Select className="select" aria-label="Vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Any vehicle (Transport chooses)</option>
              {data.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} · {v.model}
                  {v.busy ? ' (out now)' : ''}
                </option>
              ))}
            </Select>
          </label>
          <ErrorNotice error={act.error} />
        </div>
      </Card>
      <Card title="My requests" flush>
        {data.mine.length === 0 && <Empty title="No requests yet." />}
        <ul className="op-list">
          {data.mine.map((r) => (
            <RequestLine key={r.id} r={r} edit={false} vehicles={[]} />
          ))}
        </ul>
      </Card>
    </div>
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
        <Card title="Driver alerts" flush>
          <ul className="op-list">
            {data.alerts.map((a, i) => (
              <li key={i} className="op-item" data-tone={a.tone}>
                <div className="op-line">
                  <div className="op-main">
                    <span className="op-title">{a.title}</span>
                    <span className="op-meta">{a.detail}</span>
                  </div>
                  <Chip tone={a.tone}>{a.tone === 'crit' ? 'Stop' : 'Break'}</Chip>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="op-grid-2">
        <Card
          title="On the road"
          sub={`Proposed limits: ${h(data.rule.maxDayMin)} a day, a ${data.rule.breakMin} minute break after ${h(data.rule.maxStretchMin)}, ${data.rule.speedLimitKmh} km/h`}
          flush
        >
          {data.onTheRoad.length === 0 && <Empty title="No vehicle out now." />}
          <ul className="op-list">
            {data.onTheRoad.map((v) => (
              <li key={v.vehicleId} className="op-item" data-tone={v.trip?.panicAt ? 'crit' : undefined}>
                <div className="op-line">
                  <div className="op-main">
                    <span className="op-title">
                      <span className="fl-plate">{v.plate}</span> · {v.driver}
                    </span>
                    <span className="op-meta">
                      {v.trip
                        ? `${v.trip.km} km since ${dateTimeLabel(v.trip.start)} · top ${v.trip.maxKmh} km/h${v.trip.overSpeed ? ` · ${v.trip.overSpeed} over-speed` : ''}`
                        : 'Tracker not sending'}
                    </span>
                  </div>
                  <Chip tone={v.trip?.panicAt ? 'crit' : v.tracker === 'live' ? 'ok' : 'unknown'}>{v.trip?.panicAt ? 'Panic' : v.tracker}</Chip>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Driving hours today" flush>
          {data.hours.length === 0 && <Empty title="No driving recorded today." />}
          <ul className="op-list">
            {data.hours.map((d) => (
              <li key={d.driverUserId} className="op-item">
                <div className="op-line">
                  <div className="op-main">
                    <span className="op-title">{d.driver}</span>
                    <span className="op-meta">
                      {h(d.drivingMin)} driven · {h(d.stretchMin)} since the last break · {d.vehicles.join(', ')}
                    </span>
                  </div>
                  <Chip tone={d.overDay ? 'crit' : d.needsBreak ? 'warn' : 'ok'}>{d.overDay ? 'Over the day' : d.needsBreak ? 'Break due' : 'Fine'}</Chip>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
