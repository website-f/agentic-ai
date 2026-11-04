import { useState } from 'react';
import type { ClaimVehicle, ProofInput, StaffClaimKind } from '@prima/core';
import { api, type StaffClaims, type StaffClaimInput } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';
import { ProofPicker } from './Proof';

/**
 * Staff claims (Fauzan, 26 Oct 2026). Staff are everyone except guards, patrolling officers and officers. Medical
 * with dental up to RM1,000 a year, optical RM500 every 2 years, the yearly check-up separately, and travel at the
 * rate the Chief of Staff publishes each month. A trip is asked before it is made; one not approved beforehand, or more than 10% off the system km, goes to
 * the Chief of Staff first; HR checks every claim and the COO approves it.
 */

type Claim = StaffClaims['mine'][number];
type QueueRow = StaffClaims['queue'][number];
type Trip = StaffClaims['myTrips'][number];

const KIND_LABEL: Record<StaffClaimKind, string> = { MEDICAL: 'Medical', DENTAL: 'Dental', OPTICAL: 'Optical', CHECKUP: 'Yearly check-up', TRAVEL: 'Travel' };
const VEHICLE_LABEL: Record<ClaimVehicle, string> = { CAR: 'Own car', MOTORCYCLE: 'Own motorcycle', COMPANY_CAR: 'Company car' };
const rm = (n: number) => `RM${n.toFixed(2)}`;

function today(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function ClaimsView() {
  const { data, error } = useLoad(() => api.staffClaims(), []);
  const [tab, setTab] = useState<'mine' | 'queue' | 'enter' | 'rates' | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="claims" />;
  const view = tab ?? (data.role ? (data.role === 'cos' && data.missingRates.length ? 'rates' : 'queue') : 'mine');
  const waiting = data.queue.filter((r) => r.canCos || r.canHr || r.canCoo || r.canPay).length + data.tripQueue.filter((t) => t.status === 'pending').length;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Claims</h1>
        <p className="muted">
          Medical with dental up to RM1,000 a year, optical RM500 every 2 years, the yearly check-up at a panel clinic separately, and travel at the published
          rate per km. Valet parking cannot be claimed.
        </p>
      </div>
      {data.canSetRates && data.missingRates.length > 0 && (
        <div className="notice" data-tone="warn" role="status" style={{ marginBottom: 12 }}>
          Publish the {data.thisMonth} mileage rates: {data.missingRates.map((v) => VEHICLE_LABEL[v]).join(', ')} still missing. Staff cannot claim travel this
          month until they are published.
        </div>
      )}
      {data.limits && (
        <div className="kpis">
          <Kpi label="Medical and dental left" value={rm(data.limits.medicalLeft)} note="This year, of RM1,000" />
          <Kpi label="Optical left" value={rm(data.limits.opticalLeft)} note="Over 2 years, of RM500" />
          {data.role && <Kpi label="Waiting for you" value={waiting} tone={waiting ? 'warn' : 'ok'} />}
        </div>
      )}
      <div className="tabbar" role="tablist" aria-label="Claim sections">
        {data.canClaim && (
          <button role="tab" aria-selected={view === 'mine'} onClick={() => setTab('mine')}>
            My claims
          </button>
        )}
        {data.role && (
          <button role="tab" aria-selected={view === 'queue'} onClick={() => setTab('queue')}>
            {data.role === 'cos' ? 'For the Chief of Staff' : data.role === 'coo' ? 'For the COO' : 'All claims'}
            {waiting > 0 && <span className="tab-count">{waiting}</span>}
          </button>
        )}
        {data.enterFor.length > 0 && (
          <button role="tab" aria-selected={view === 'enter'} onClick={() => setTab('enter')}>
            Enter for staff
          </button>
        )}
        <button role="tab" aria-selected={view === 'rates'} onClick={() => setTab('rates')}>
          Mileage rates
          {data.canSetRates && data.missingRates.length > 0 && <span className="tab-count">{data.missingRates.length}</span>}
        </button>
      </div>
      {view === 'mine' && data.canClaim && <Mine data={data} />}
      {view === 'mine' && !data.canClaim && <div className="empty">Staff claims are for office and management staff.</div>}
      {view === 'queue' && data.tripQueue.length > 0 && <TripQueue trips={data.tripQueue} />}
      {view === 'queue' && <Queue rows={data.queue} />}
      {view === 'enter' && <EnterFor data={data} />}
      {view === 'rates' && <Rates data={data} />}
    </div>
  );
}

function Mine({ data }: { data: StaffClaims }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>My claims</h3>
        {!adding && (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            New claim
          </button>
        )}
      </div>
      {adding && <NewClaim data={data} onDone={() => setAdding(false)} />}
      <div className="list">
        {data.mine.length === 0 && <div className="empty">No claims yet.</div>}
        {data.mine.map((c) => (
          <ClaimLine key={c.id} c={c} self />
        ))}
      </div>
      <Trips data={data} />
    </section>
  );
}

function tripChip(t: Trip) {
  if (t.claimId) return <Chip tone="neutral">Claimed</Chip>;
  if (t.status === 'approved') return <Chip tone="ok">Approved</Chip>;
  if (t.status === 'rejected') return <Chip tone="crit">Rejected</Chip>;
  return <Chip tone="warn">Chief of Staff to approve</Chip>;
}

/** Trips are asked before they are made; the claim then picks the approved trip (insider abuse audit, 27 Oct 2026). */
function Trips({ data }: { data: StaffClaims }) {
  const [form, setForm] = useState({ date: today(), destination: '', purpose: '' });
  const act = useAction();
  return (
    <div style={{ marginTop: 16 }}>
      <h3>Trips to approve before you go</h3>
      <p className="muted small">Ask the Chief of Staff before the trip. A travel claim for an approved trip goes straight to HR.</p>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <input className="input" type="date" aria-label="Trip date" min={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <input
          className="input"
          aria-label="Where to"
          placeholder="Where to"
          value={form.destination}
          onChange={(e) => setForm({ ...form, destination: e.target.value })}
        />
        <input className="input" aria-label="Why" placeholder="Why" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        <button
          className="btn btn-sm"
          disabled={act.busy || !form.destination.trim() || form.purpose.trim().length < 3}
          onClick={() =>
            act.run(() => api.requestTrip(form), 'Sent to the Chief of Staff.').then((x) => {
              if (x) setForm({ date: today(), destination: '', purpose: '' });
            })
          }
        >
          Ask to travel
        </button>
      </div>
      <ErrorNotice error={act.error} />
      <div className="list">
        {data.myTrips.map((t) => (
          <div key={t.id} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>
                {t.destination} · {dateLabel(t.date)}
              </div>
              <div className="muted small">
                {t.purpose}
                {t.decision ? ` · ${t.decision.by}${t.decision.note ? `: ${t.decision.note}` : ''}` : ''}
              </div>
            </div>
            {tripChip(t)}
          </div>
        ))}
      </div>
    </div>
  );
}

function TripQueue({ trips }: { trips: Trip[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Trips asked before they are made</h3>
      </div>
      <div className="list">
        {trips.map((t) => (
          <TripLine key={t.id} t={t} />
        ))}
      </div>
    </section>
  );
}

function TripLine({ t }: { t: Trip }) {
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {t.personName}: {t.destination} · {dateLabel(t.date)}
          </div>
          <div className="muted small">{t.purpose}</div>
        </div>
        {tripChip(t)}
      </div>
      {t.status === 'pending' && (
        <>
          <input className="input" aria-label="Note" placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => act.run(() => api.decideTrip(t.id, true, note), 'Trip approved.')}>
              Approve
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || note.trim().length < 3}
              onClick={() => act.run(() => api.decideTrip(t.id, false, note), 'Trip rejected.')}
            >
              Reject
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </>
      )}
    </div>
  );
}

function statusChip(c: Claim) {
  if (c.status === 'approved') return c.paid ? <Chip tone="ok">Paid</Chip> : <Chip tone="ok">Approved, Finance to pay</Chip>;
  if (c.status === 'rejected') return <Chip tone="crit">Rejected</Chip>;
  if (c.travel?.cosReasons.length && !c.cosApproval) return <Chip tone="warn">Chief of Staff to approve</Chip>;
  if (c.status === 'hr_checked') return <Chip tone="warn">COO to approve</Chip>;
  return <Chip tone="warn">HR to decide</Chip>;
}

function ClaimLine({ c, children, self }: { c: Claim; children?: React.ReactNode; self?: boolean }) {
  const t = c.travel;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {KIND_LABEL[c.kind]} · {rm(c.allowed)}
            {c.allowed < c.amount ? <span className="muted"> of {rm(c.amount)}</span> : null}
          </div>
          <div className="muted small">
            {c.personName} · {dateLabel(c.date)}
            {c.note ? ` · ${c.note}` : ''}
            {c.enteredBy ? ` · entered by HR (${c.enteredBy.by})` : ''}
            {c.paid ? ` · paid by ${c.paid.by}, ${c.paid.ref}` : ''}
          </div>
        </div>
        {statusChip(c)}
      </div>
      {t && (
        <div className="small">
          {t.destination} ({t.preApproved ? 'pre-approved' : 'not pre-approved'}) · {VEHICLE_LABEL[t.vehicle]} {t.kmClaimed} km claimed
          {self ? ` · mileage ${rm(t.mileage)}` : <>, system {t.kmSystem === null ? 'unknown' : `${t.kmSystem} km`} × {rm(t.perKm)} = {rm(t.mileage)}</>}
          {t.toll ? ` · toll ${rm(t.toll)}` : ''}
          {t.parking ? ` · parking ${rm(t.parking)}` : ''}
          {t.overnightNights ? ` · ${t.overnightNights} night(s), hotel ${rm(t.hotel)}` : ''}
          {t.food ? ` · food ${rm(t.food)}` : ''}
          {t.cosReasons.length > 0 && <div className="muted">Needs the Chief of Staff: {t.cosReasons.join('; ')}.</div>}
        </div>
      )}
      {c.cosApproval && (
        <div className="muted small">
          Chief of Staff: {c.cosApproval.by}
          {c.cosApproval.note ? `, ${c.cosApproval.note}` : ''}
        </div>
      )}
      {c.hrDecision && (
        <div className="muted small">
          HR: {c.hrDecision.by}
          {c.hrDecision.note ? `, ${c.hrDecision.note}` : ''}
        </div>
      )}
      {children}
    </div>
  );
}

/** Pilot phase 1 (Fauzan, 28 Oct 2026): the HR administrator enters claims and trips for IT staff who are not signed in. */
function EnterFor({ data }: { data: StaffClaims }) {
  const [personId, setPersonId] = useState('');
  const [what, setWhat] = useState<'claim' | 'trip' | null>(null);
  const [trip, setTrip] = useState({ date: today(), destination: '', purpose: '' });
  const act = useAction();
  const who = data.enterFor.find((p) => p.id === personId);
  return (
    <section className="panel">
      <p className="muted small">
        During the pilot the staff member gives you the receipt or the trip details on Teams, email or in person, and you enter it here for them. The record shows it was
        entered by HR. Another person checks and approves it as usual.
      </p>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <select className="select" aria-label="Staff member" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">Choose the staff member…</option>
          {data.enterFor.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" disabled={!personId} aria-pressed={what === 'claim'} onClick={() => setWhat('claim')}>
          New claim
        </button>
        <button className="btn btn-sm" disabled={!personId} aria-pressed={what === 'trip'} onClick={() => setWhat('trip')}>
          Ask to travel
        </button>
      </div>
      {who && what === 'claim' && <NewClaim data={data} forPersonId={who.id} key={who.id} onDone={() => setWhat(null)} />}
      {who && what === 'trip' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" type="date" aria-label="Trip date" min={today()} value={trip.date} onChange={(e) => setTrip({ ...trip, date: e.target.value })} />
          <input className="input" aria-label="Where to" placeholder="Where to" value={trip.destination} onChange={(e) => setTrip({ ...trip, destination: e.target.value })} />
          <input className="input" aria-label="Why" placeholder="Why" value={trip.purpose} onChange={(e) => setTrip({ ...trip, purpose: e.target.value })} />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || !trip.destination.trim() || trip.purpose.trim().length < 3}
            onClick={() =>
              act.run(() => api.requestTrip({ ...trip, forPersonId: who.id }), 'Sent for approval.').then((x) => {
                if (x) {
                  setTrip({ date: today(), destination: '', purpose: '' });
                  setWhat(null);
                }
              })
            }
          >
            Send for {who.name}
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

function NewClaim({ data, onDone, forPersonId }: { data: StaffClaims; onDone: () => void; forPersonId?: string }) {
  const [kind, setKind] = useState<StaffClaimKind>('MEDICAL');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [trip, setTrip] = useState({
    destination: '',
    tripId: null as string | null,
    vehicle: 'CAR' as ClaimVehicle,
    kmClaimed: 0,
    toll: 0,
    parking: 0,
    overnightNights: 0,
    hotel: 0,
  });
  const act = useAction();
  const travel = kind === 'TRAVEL';
  const earliest = new Date(Date.parse(today()) - data.claimMaxAgeDays * 86_400_000).toISOString().slice(0, 10);
  const usable = forPersonId ? [] : data.myTrips.filter((t) => t.status === 'approved' && !t.claimId && t.date <= today());
  const receiptsNeeded = !travel || trip.toll + trip.parking + trip.hotel > 0;
  const num = (v: string) => Math.max(0, Number(v) || 0);
  const input: StaffClaimInput = travel ? { kind, date, note, travel: trip, forPersonId } : { kind, date, amount, note, forPersonId };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <select className="select" aria-label="Kind of claim" value={kind} onChange={(e) => setKind(e.target.value as StaffClaimKind)}>
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input className="input" type="date" aria-label="Date" value={date} min={earliest} max={today()} onChange={(e) => setDate(e.target.value)} />
        {!travel && (
          <input
            className="input"
            type="number"
            min={0}
            step="0.01"
            aria-label="Receipt amount RM"
            placeholder="Receipt RM"
            value={amount || ''}
            onChange={(e) => setAmount(num(e.target.value))}
          />
        )}
      </div>
      <p className="muted small">Claims are made within {data.claimMaxAgeDays} days of the receipt or trip. The same receipt or trip cannot be claimed twice.</p>
      {travel && (
        <>
          <select
            className="select"
            aria-label="Approved trip"
            value={trip.tripId ?? ''}
            onChange={(e) => {
              const t = usable.find((x) => x.id === e.target.value);
              setTrip({ ...trip, tripId: t?.id ?? null, destination: t ? t.destination : trip.destination });
              if (t) setDate(t.date);
            }}
          >
            <option value="">No approved trip (goes to the Chief of Staff)</option>
            {usable.map((t) => (
              <option key={t.id} value={t.id}>
                {dateLabel(t.date)} · {t.destination}
              </option>
            ))}
          </select>
          <input
            className="input"
            aria-label="Where you went"
            placeholder="Where you went and why"
            value={trip.destination}
            onChange={(e) => setTrip({ ...trip, destination: e.target.value })}
          />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <select
              className="select"
              aria-label="Vehicle"
              value={trip.vehicle}
              onChange={(e) => setTrip({ ...trip, vehicle: e.target.value as ClaimVehicle })}
            >
              {Object.entries(VEHICLE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input
              className="input"
              type="number"
              min={0}
              aria-label="Km, office there and back"
              placeholder="Km, office there and back"
              value={trip.kmClaimed || ''}
              onChange={(e) => setTrip({ ...trip, kmClaimed: num(e.target.value) })}
            />
            <input
              className="input"
              type="number"
              min={0}
              aria-label="Toll RM"
              placeholder="Toll RM"
              value={trip.toll || ''}
              onChange={(e) => setTrip({ ...trip, toll: num(e.target.value) })}
            />
            <input
              className="input"
              type="number"
              min={0}
              aria-label="Parking RM (no valet)"
              placeholder="Parking RM (no valet)"
              value={trip.parking || ''}
              onChange={(e) => setTrip({ ...trip, parking: num(e.target.value) })}
            />
            <input
              className="input"
              type="number"
              min={0}
              aria-label="Nights away"
              placeholder="Nights away"
              value={trip.overnightNights || ''}
              onChange={(e) => setTrip({ ...trip, overnightNights: num(e.target.value) })}
            />
            {trip.overnightNights > 0 && (
              <input
                className="input"
                type="number"
                min={0}
                aria-label="Hotel RM"
                placeholder="Hotel RM (up to RM200 a night)"
                value={trip.hotel || ''}
                onChange={(e) => setTrip({ ...trip, hotel: num(e.target.value) })}
              />
            )}
          </div>
          <p className="muted small">
            Food: RM25 when over 90 km one way, or RM50 a night when you stay overnight. The app checks the km against your location while clocked in; more than
            10% apart, or a trip not approved before it was made, goes to the Chief of Staff. Toll, parking and hotel need their receipts.
          </p>
        </>
      )}
      <ProofPicker site={null} refText="Receipt" items={proof} onChange={setProof} documentsOnly required={receiptsNeeded} />
      {kind === 'CHECKUP' && <p className="muted small">Upload the panel clinic receipt and the result. Only HR sees the result.</p>}
      <input className="input" aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || (travel ? !trip.destination.trim() || !trip.kmClaimed || (receiptsNeeded && !proof.length) : !amount || !proof.length)}
          onClick={async () => {
            if (await act.run(() => api.submitStaffClaim(input, proof), 'Claim sent.')) onDone();
          }}
        >
          Send the claim
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Queue({ rows }: { rows: QueueRow[] }) {
  return (
    <section className="panel">
      <div className="list">
        {rows.length === 0 && <div className="empty">No claims.</div>}
        {rows.map((r) => (
          <ClaimLine key={r.claim.id} c={r.claim}>
            {(r.canCos || r.canHr || r.canCoo) && <Decide r={r} />}
            {r.canPay && <Pay r={r} />}
          </ClaimLine>
        ))}
      </div>
    </section>
  );
}

function Decide({ r }: { r: QueueRow }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const by = r.canCos ? 'cos' : r.canCoo ? 'coo' : 'hr';
  return (
    <>
      <input className="input" aria-label="Decision note" placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy}
          onClick={() => act.run(() => api.decideStaffClaim(r.claim.id, by, true, note), by === 'hr' ? 'Checked, sent to the COO.' : 'Approved.')}
        >
          {by === 'hr' ? 'Checked, to COO' : 'Approve'}
        </button>
        <button
          className="btn btn-sm"
          disabled={act.busy || note.trim().length < 3}
          onClick={() => act.run(() => api.decideStaffClaim(r.claim.id, by, false, note), 'Rejected.')}
        >
          Reject
        </button>
      </div>
    </>
  );
}

/** Finance pays the approved claim and records the reference; the Finance Director in the pilot (Fauzan, 28 Oct 2026). */
function Pay({ r }: { r: QueueRow }) {
  const [ref, setRef] = useState('');
  const act = useAction();
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" aria-label="Payment reference" placeholder="Payment reference" value={ref} onChange={(e) => setRef(e.target.value)} />
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || ref.trim().length < 3}
          onClick={() => act.run(() => api.decideStaffClaim(r.claim.id, 'finance', true, ref), 'Payment recorded.')}
        >
          Record payment
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </>
  );
}

function Rates({ data }: { data: StaffClaims }) {
  const [vehicle, setVehicle] = useState<ClaimVehicle>(data.missingRates[0] ?? 'CAR');
  const [perKm, setPerKm] = useState(0);
  const act = useAction();
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Mileage rates</h3>
          <div className="muted small">The Chief of Staff sets and publishes the approved rate per km for each vehicle every month.</div>
        </div>
      </div>
      {data.canSetRates && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <select className="select" aria-label="Vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value as ClaimVehicle)}>
            {Object.entries(VEHICLE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="number"
            min={0}
            step="0.01"
            aria-label="RM per km"
            placeholder="RM per km"
            value={perKm || ''}
            onChange={(e) => setPerKm(Math.max(0, Number(e.target.value) || 0))}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !perKm}
            onClick={() => act.run(() => api.setClaimRate(data.thisMonth, vehicle, perKm), `Published for ${data.thisMonth}.`)}
          >
            Publish for {data.thisMonth}
          </button>
          <ErrorNotice error={act.error} />
        </div>
      )}
      <div className="list">
        {data.rates.length === 0 && <div className="empty">No rates published yet.</div>}
        {data.rates.map((r) => (
          <div key={r.id} className="list-item">
            <div>
              {r.month} · {VEHICLE_LABEL[r.vehicle]}
            </div>
            <div>{rm(r.perKm)} a km</div>
          </div>
        ))}
      </div>
    </section>
  );
}
