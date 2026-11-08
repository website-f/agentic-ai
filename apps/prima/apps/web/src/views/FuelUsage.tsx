import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type VehicleUsage } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';

/** Today in Malaysia, whatever the device's clock zone (the app keeps Malaysian dates). */
const mytNow = () => new Date(Date.now() + 8 * 3_600_000).toISOString();

/**
 * Transport usage (Fauzan, 5 Nov 2026): the Transport department monitors how every vehicle is used: fuel cards,
 * subsidy cards, the tracker and every fill-up. Checks raise flags for someone else to review; the COO and the OGM
 * monitor. A driver records the fill-ups of the vehicle out with them.
 */

type Row = VehicleUsage['vehicles'][number];
type Fill = VehicleUsage['toReview'][number];
type Mine = VehicleUsage['mine'][number];
type FuelType = 'RON95' | 'RON97' | 'DIESEL' | 'LPG' | 'OTHER';
type Paid = 'FUEL_CARD' | 'SUBSIDY_CARD' | 'CASH' | 'OWN_MONEY';

const FUELS: [FuelType, string][] = [
  ['RON95', 'RON95'],
  ['RON97', 'RON97'],
  ['DIESEL', 'Diesel'],
  ['LPG', 'LPG (gas)'],
  ['OTHER', 'Other'],
];
const PAID: [Paid, string][] = [
  ['FUEL_CARD', 'Fuel card'],
  ['SUBSIDY_CARD', 'Subsidy card'],
  ['CASH', 'Company cash'],
  ['OWN_MONEY', 'Own money (claim it separately)'],
];
const TRACKER: Record<string, [Tone, string]> = { live: ['ok', 'Tracker live'], unknown: ['unknown', 'Tracker unknown'], none: ['neutral', 'No tracker'] };
const OUTCOME: Record<string, string> = { EXPLAINED: 'Explained', RECOVER: 'Recover from driver', CASE: 'Refer for investigation' };
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthsBack = (m: string, n: number) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const d = new Date(`${m}-15T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    return d.toISOString().slice(0, 7);
  });
// Receipt times are Malaysia time, whatever the device's clock zone (the app keeps times as +08:00).
const localNow = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 16);
const mytIso = (v: string) => `${v}:00+08:00`;

export function FuelUsagePanel() {
  const thisMonth = localNow().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [tick, setTick] = useState(0);
  const { data, error } = useLoad(() => api.vehicleUsage(month), [month, tick]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="vehicle usage" />;
  const reload = () => setTick((t) => t + 1);
  const transport = data.role === 'transport';
  return (
    <>
      <section className="panel">
        <div className="panel-head" style={{ flexWrap: 'wrap', gap: 6 }}>
          <h3>Fuel and usage</h3>
          <select className="select" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }}>
            {monthsBack(thisMonth, 6).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {data.total && (
          <div className="kpis">
            <Kpi label="Fuel this month" value={rm(data.total.rm)} note={`${data.total.litres.toLocaleString('en-MY')} litres`} />
            <Kpi label="To review" value={data.total.openFlags} tone={data.total.openFlags ? 'warn' : 'ok'} />
            <Kpi label="Trackers not live" value={data.total.trackerUnknown} tone={data.total.trackerUnknown ? 'unknown' : 'ok'} note="Not fitted, not connected or silent" />
          </div>
        )}
        <div className="panel-body">
          {data.notes.map((n) => (
            <p key={n} className="muted small">
              {n}
            </p>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>To review ({data.toReview.length})</h3>
        </div>
        <div className="list">
          {data.toReview.length === 0 && <div className="empty">Nothing flagged.</div>}
          {data.toReview.map((f) => (
            <FillLine key={f.id} f={f} showPlate onDone={reload} />
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Vehicles {data.month}</h3>
        </div>
        <div className="list">
          {data.vehicles.map((v) => (
            <UsageLine key={v.id} v={v} transport={transport} onDone={reload} />
          ))}
        </div>
      </section>
    </>
  );
}

function UsageLine({ v, transport, onDone }: { v: Row; transport: boolean; onDone: () => void }) {
  const [open, setOpen] = useState<'fills' | 'fill' | 'card' | 'fuel' | null>(null);
  const toggle = (k: 'fills' | 'fill' | 'card' | 'fuel') => setOpen(open === k ? null : k);
  const u = v.usage;
  const [tone, label] = TRACKER[v.tracker] ?? TRACKER.unknown;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {v.plate} · {v.model}
          </div>
          <div className="muted small">
            {v.usedByName}
            {v.usedByName !== v.ownerName ? ` (owned by ${v.ownerName})` : ''} · {v.fuelType ?? 'fuel not set'} · tank {v.tankLitres == null ? 'Unknown' : `${v.tankLitres} litres`}
            {v.out ? ` · out with ${v.out.driver}` : ''}
          </div>
          <div className="small">
            {u.fills} fill-up{u.fills === 1 ? '' : 's'} · {u.litres} litres · {rm(u.rm)} · {u.km == null ? 'km Unknown' : `${u.km.toLocaleString('en-MY')} km`} ·{' '}
            {u.kmPerLitre == null ? 'km per litre Unknown' : `${u.kmPerLitre} km per litre`}
            {u.rmPerKm != null ? ` · ${rm(u.rmPerKm)} per km` : ''} · tracker distance {v.trackerKm == null ? 'Unknown' : `${v.trackerKm} km`}
          </div>
          {v.cards
            .filter((c) => c.endedOn == null)
            .map((c) => {
              const cap = c.kind === 'SUBSIDY' ? c.monthlyQuotaLitres : c.monthlyLimitRm;
              const used = c.kind === 'SUBSIDY' ? c.monthLitres : c.monthRm;
              const over = cap != null && used > cap;
              return (
                <div key={c.id} className="small">
                  {c.kind === 'SUBSIDY' ? 'Subsidy card' : 'Fuel card'} {c.issuer} ending {c.last4} ({c.fuel}, kept by {c.holder}):{' '}
                  <span style={over ? { color: 'var(--crit)', fontWeight: 600 } : undefined}>
                    {c.kind === 'SUBSIDY' ? `${used} litres` : rm(used)} of {cap == null ? 'Unknown' : c.kind === 'SUBSIDY' ? `${cap} litres` : rm(cap)}
                  </span>
                  {c.alsoOn.length > 0 && (
                    <span className="muted">
                      {' '}
                      · also used for {c.alsoOn.join(', ')}
                      {c.consent ? ` (Transport head consent by ${c.consent.by}: ${c.consent.reason})` : ''}
                    </span>
                  )}
                  {transport && <EndCard vehicleId={v.id} cardId={c.id} onDone={onDone} />}
                </div>
              );
            })}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Chip tone={tone}>{label}</Chip>
          {v.openFlags > 0 && <Chip tone="warn">{v.openFlags} to review</Chip>}
          <button className="btn btn-sm" aria-expanded={open === 'fills'} onClick={() => toggle('fills')}>
            Fill-ups ({v.fills.length})
          </button>
          {transport && (
            <>
              <button className="btn btn-sm btn-primary" onClick={() => toggle('fill')}>
                Record fill-up
              </button>
              <button className="btn btn-sm" onClick={() => toggle('card')}>
                Add card
              </button>
              <button className="btn btn-sm" onClick={() => toggle('fuel')}>
                Fuel and tank
              </button>
            </>
          )}
        </div>
      </div>
      {open === 'fills' && (
        <div className="list">
          {v.fills.length === 0 && <div className="empty">No fill-ups this month.</div>}
          {v.fills.map((f) => (
            <FillLine key={f.id} f={f} onDone={onDone} />
          ))}
        </div>
      )}
      {open === 'fill' && (
        <FillForm
          vehicleId={v.id}
          defaultFuel={(v.fuelType as FuelType | null) ?? 'RON95'}
          cards={v.cards.filter((c) => c.endedOn == null).map((c) => ({ id: c.id, kind: c.kind, label: `${c.kind === 'SUBSIDY' ? 'Subsidy' : 'Fuel'} card ${c.issuer} ending ${c.last4}` }))}
          askDriver
          defaultDriver={v.out?.driver ?? ''}
          onDone={() => {
            setOpen('fills');
            onDone();
          }}
        />
      )}
      {open === 'card' && (
        <CardForm
          vehicleId={v.id}
          defaultFuel={(v.fuelType as FuelType | null) ?? 'DIESEL'}
          onDone={() => {
            setOpen(null);
            onDone();
          }}
        />
      )}
      {open === 'fuel' && (
        <FuelForm
          v={v}
          onDone={() => {
            setOpen(null);
            onDone();
          }}
        />
      )}
    </div>
  );
}

function FillLine({ f, showPlate, onDone }: { f: Fill; showPlate?: boolean; onDone: () => void }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<'EXPLAINED' | 'RECOVER' | 'CASE'>('EXPLAINED');
  const [reason, setReason] = useState('');
  const [recover, setRecover] = useState('');
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {showPlate ? `${f.plate} · ` : ''}
            {f.litres} litres {f.fuel} · {rm(f.amountRm)} · {f.odometerKm.toLocaleString('en-MY')} km
          </div>
          <div className="muted small">
            {dateTimeLabel(f.at)} · {f.station} · {f.driver} ·{' '}
            {f.card ? `${f.card.label}${f.card.keptFor !== f.plate ? ` (kept for ${f.card.keptFor})` : ''}` : PAID.find((p) => p[0] === f.paidWith)?.[1]} · recorded by {f.recordedBy}
            {f.docId ? ' · receipt attached' : ''}
          </div>
          {f.flagLabels.length > 0 && (
            <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
              {f.flagLabels.map((l) => (
                <Chip key={l} tone={f.review ? 'neutral' : 'warn'}>
                  {l}
                </Chip>
              ))}
            </div>
          )}
          {f.review && (
            <div className="small">
              Reviewed by {f.review.by}, {dateLabel(f.review.at.slice(0, 10))}: {OUTCOME[f.review.outcome]}
              {f.review.recoverRm != null ? ` ${rm(f.review.recoverRm)}` : ''}. {f.review.reason}
            </div>
          )}
        </div>
        {f.canReview && (
          <button className="btn btn-sm btn-primary" aria-expanded={open} onClick={() => setOpen(!open)}>
            Review
          </button>
        )}
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <select className="input" aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} style={{ width: 'auto' }}>
              {Object.entries(OUTCOME).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            {outcome === 'RECOVER' && (
              <input className="input" inputMode="decimal" aria-label="Amount to recover (RM)" placeholder="RM to recover" value={recover} onChange={(e) => setRecover(e.target.value)} style={{ width: 140 }} />
            )}
          </div>
          <input className="input" aria-label="Reason" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div>
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || reason.trim().length < 3 || (outcome === 'RECOVER' && !(Number(recover) > 0))}
              onClick={() =>
                act.run(async () => {
                  await api.reviewFuel(f.vehicleId, f.id, { outcome, reason, recoverRm: outcome === 'RECOVER' ? Number(recover) : null });
                  setOpen(false);
                  onDone();
                }, 'Review saved.')
              }
            >
              Save review
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
  );
}

function FillForm({
  vehicleId,
  defaultFuel,
  cards,
  askDriver,
  defaultDriver,
  onDone,
}: {
  vehicleId: string;
  defaultFuel: FuelType;
  cards: { id: string; kind: 'FUEL' | 'SUBSIDY'; label: string }[];
  askDriver?: boolean;
  defaultDriver?: string;
  onDone: () => void;
}) {
  const act = useAction();
  const [at, setAt] = useState(localNow());
  const [paidWith, setPaidWith] = useState<Paid>(cards.some((c) => c.kind === 'SUBSIDY') ? 'SUBSIDY_CARD' : cards.length ? 'FUEL_CARD' : 'CASH');
  const usable = cards.filter((c) => (paidWith === 'SUBSIDY_CARD' ? c.kind === 'SUBSIDY' : paidWith === 'FUEL_CARD' ? c.kind === 'FUEL' : false));
  const [cardId, setCardId] = useState('');
  const card = usable.find((c) => c.id === cardId) ?? usable[0] ?? null;
  const [fuel, setFuel] = useState<FuelType>(defaultFuel);
  const [litres, setLitres] = useState('');
  const [amount, setAmount] = useState('');
  const [odo, setOdo] = useState('');
  const [station, setStation] = useState('');
  const [driver, setDriver] = useState(defaultDriver ?? '');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const byCard = paidWith === 'FUEL_CARD' || paidWith === 'SUBSIDY_CARD';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input className="input" type="datetime-local" aria-label="Date and time on the receipt (Malaysia time)" value={at} onChange={(e) => setAt(e.target.value)} style={{ width: 'auto' }} />
        <select className="input" aria-label="Paid with" value={paidWith} onChange={(e) => setPaidWith(e.target.value as Paid)} style={{ width: 'auto' }}>
          {PAID.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        {byCard && (
          <select className="input" aria-label="Card" value={card?.id ?? ''} onChange={(e) => setCardId(e.target.value)} style={{ width: 'auto' }}>
            {usable.length === 0 && <option value="">No card kept for this vehicle</option>}
            {usable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <select className="input" aria-label="Fuel" value={fuel} onChange={(e) => setFuel(e.target.value as FuelType)} style={{ width: 'auto' }}>
          {FUELS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input className="input" inputMode="decimal" aria-label="Litres" placeholder="Litres" value={litres} onChange={(e) => setLitres(e.target.value)} style={{ width: 110 }} />
        <input className="input" inputMode="decimal" aria-label="Amount (RM)" placeholder="RM" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} />
        <input className="input" inputMode="numeric" aria-label="Odometer (km)" placeholder="Odometer km" value={odo} onChange={(e) => setOdo(e.target.value)} style={{ width: 140 }} />
      </div>
      <input className="input" aria-label="Station" placeholder="Station (name and place)" value={station} onChange={(e) => setStation(e.target.value)} />
      {askDriver && <input className="input" aria-label="Driver" placeholder="Driver" value={driver} onChange={(e) => setDriver(e.target.value)} />}
      <ProofPicker site={null} refText="fuel receipt" items={proof} onChange={setProof} documentsOnly />
      {!proof.length && <div className="muted small">Attach the receipt. A fill-up without one is flagged for review.</div>}
      <div>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !at || !(Number(litres) > 0) || !(Number(amount) > 0) || !odo || station.trim().length < 2 || (byCard && !card) || (askDriver && driver.trim().length < 2)}
          onClick={() =>
            act.run(async () => {
              await api.recordFuel(
                vehicleId,
                {
                  at: mytIso(at),
                  paidWith,
                  cardId: byCard ? (card?.id ?? null) : null,
                  fuel,
                  litres: Number(litres),
                  amountRm: Number(amount),
                  odometerKm: Number(odo),
                  station,
                  driver: askDriver ? driver : undefined,
                },
                proof,
              );
              onDone();
            }, 'Fill-up recorded.')
          }
        >
          Save fill-up
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function CardForm({ vehicleId, defaultFuel, onDone }: { vehicleId: string; defaultFuel: FuelType; onDone: () => void }) {
  const act = useAction();
  const [kind, setKind] = useState<'FUEL' | 'SUBSIDY'>('FUEL');
  const [issuer, setIssuer] = useState('');
  const [last4, setLast4] = useState('');
  const [fuel, setFuel] = useState<FuelType>(defaultFuel);
  const [cap, setCap] = useState('');
  const [holder, setHolder] = useState('');
  const [since, setSince] = useState(mytNow().slice(0, 10));
  const [reason, setReason] = useState('');
  const [share, setShare] = useState(false);
  const [shareReason, setShareReason] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <select className="input" aria-label="Card type" value={kind} onChange={(e) => {
            const k = e.target.value as 'FUEL' | 'SUBSIDY';
            setKind(k);
            if (k === 'SUBSIDY' && fuel !== 'DIESEL' && fuel !== 'RON95') setFuel('DIESEL');
          }} style={{ width: 'auto' }}>
          <option value="FUEL">Fuel (petrol) card</option>
          <option value="SUBSIDY">Fleet subsidy card (diesel or petrol)</option>
        </select>
        <select className="input" aria-label="Fuel the card buys" value={fuel} onChange={(e) => setFuel(e.target.value as FuelType)} style={{ width: 'auto' }}>
          {(kind === 'SUBSIDY' ? FUELS.filter(([k]) => k === 'DIESEL' || k === 'RON95') : FUELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input
          className="input"
          inputMode="numeric"
          maxLength={4}
          aria-label="Last 4 digits"
          placeholder="Last 4 digits"
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
          style={{ width: 120 }}
        />
      </div>
      <input
        className="input"
        aria-label={kind === 'SUBSIDY' ? 'Subsidy scheme' : 'Card company'}
        placeholder={kind === 'SUBSIDY' ? 'Fleet subsidy scheme, as on the card' : 'Card company'}
        value={issuer}
        onChange={(e) => setIssuer(e.target.value)}
      />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input
          className="input"
          inputMode="decimal"
          aria-label={kind === 'SUBSIDY' ? 'Monthly quota (litres)' : 'Monthly limit (RM)'}
          placeholder={kind === 'SUBSIDY' ? 'Quota litres a month (if known)' : 'Limit RM a month (if known)'}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          style={{ width: 220 }}
        />
        <input className="input" type="date" aria-label="Kept for this vehicle from" value={since} onChange={(e) => setSince(e.target.value)} style={{ width: 'auto' }} />
      </div>
      <input className="input" aria-label="Kept by" placeholder="Who keeps the card" value={holder} onChange={(e) => setHolder(e.target.value)} />
      <input className="input" aria-label="Reason" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
        This card is also kept for another vehicle. As Transport head, I consent to it being used for both.
      </label>
      {share && kind === 'SUBSIDY' && (
        <div className="small" style={{ color: 'var(--warn, #b45309)' }}>
          Check the subsidy scheme&apos;s terms first: a fleet subsidy card is usually registered to one vehicle.
        </div>
      )}
      {share && (
        <input className="input" aria-label="Reason for consent" placeholder="Reason for using one card for both (required)" value={shareReason} onChange={(e) => setShareReason(e.target.value)} />
      )}
      <div className="muted small">Only the last 4 digits. Never enter the full card number or the PIN. A shared card has one limit or quota for all its vehicles.</div>
      <div>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || last4.length !== 4 || issuer.trim().length < 2 || holder.trim().length < 2 || !since || reason.trim().length < 3 || (share && shareReason.trim().length < 3)}
          onClick={() =>
            act.run(async () => {
              const n = cap.trim() === '' ? null : Number(cap);
              await api.addVehicleCard(vehicleId, {
                kind,
                issuer,
                last4,
                fuel,
                monthlyLimitRm: kind === 'FUEL' ? n : null,
                monthlyQuotaLitres: kind === 'SUBSIDY' ? n : null,
                holder,
                since,
                reason,
                ...(share ? { shareConsent: true, shareReason } : {}),
              });
              onDone();
            }, 'Card added.')
          }
        >
          Add card
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function EndCard({ vehicleId, cardId, onDone }: { vehicleId: string; cardId: string; onDone: () => void }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(mytNow().slice(0, 10));
  const [reason, setReason] = useState('');
  if (!open)
    return (
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        End
      </button>
    );
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      <input className="input" type="date" aria-label="Last day" value={on} onChange={(e) => setOn(e.target.value)} style={{ width: 'auto' }} />
      <input className="input" aria-label="Reason for ending" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 220 }} />
      <button
        className="btn btn-sm"
        disabled={act.busy || reason.trim().length < 3}
        onClick={() =>
          act.run(async () => {
            await api.endVehicleCard(vehicleId, cardId, { on, reason });
            onDone();
          }, 'Card ended.')
        }
      >
        End card
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function FuelForm({ v, onDone }: { v: Row; onDone: () => void }) {
  const act = useAction();
  const [fuelType, setFuelType] = useState<FuelType>((v.fuelType as FuelType | null) ?? 'RON95');
  const [tank, setTank] = useState(v.tankLitres == null ? '' : String(v.tankLitres));
  const [reason, setReason] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <select className="input" aria-label="Vehicle fuel" value={fuelType} onChange={(e) => setFuelType(e.target.value as FuelType)} style={{ width: 'auto' }}>
          {FUELS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input className="input" inputMode="decimal" aria-label="Tank size (litres)" placeholder="Tank litres (if known)" value={tank} onChange={(e) => setTank(e.target.value)} style={{ width: 180 }} />
      </div>
      <input className="input" aria-label="Reason" placeholder="Reason, e.g. from the vehicle papers" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || reason.trim().length < 3}
          onClick={() =>
            act.run(async () => {
              await api.setVehicleFuel(v.id, { fuelType, tankLitres: tank.trim() === '' ? null : Number(tank), reason });
              onDone();
            }, 'Saved.')
          }
        >
          Save
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** For a driver: record a fill-up of the vehicle out with them. Shows nothing when no vehicle is out with them. */
export function MyFuel() {
  const [tick, setTick] = useState(0);
  const { data } = useLoad(() => api.vehicleUsage().catch(() => null), [tick]);
  if (!data || !data.mine.length) return null;
  return (
    <>
      {data.mine.map((m) => (
        <MyVehicle key={m.id} m={m} onDone={() => setTick((t) => t + 1)} />
      ))}
    </>
  );
}

function MyVehicle({ m, onDone }: { m: Mine; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head" style={{ flexWrap: 'wrap', gap: 6 }}>
        <h3>
          {m.plate} is with you
        </h3>
        <button className="btn btn-sm btn-primary" aria-expanded={open} onClick={() => setOpen(!open)}>
          Record fill-up
        </button>
      </div>
      <div className="panel-body">
        <p className="muted small">
          Out with you since {dateTimeLabel(m.outAt)}. Record each fill-up with the receipt photo. Use the vehicle&apos;s card only for this vehicle.
        </p>
        {open && (
          <FillForm
            vehicleId={m.id}
            defaultFuel={(m.fuelType as FuelType | null) ?? 'RON95'}
            cards={m.cards}
            onDone={() => {
              setOpen(false);
              onDone();
            }}
          />
        )}
        <div className="list">
          {m.myFills.map((f) => (
            <FillLine key={f.id} f={f} onDone={onDone} />
          ))}
        </div>
      </div>
    </section>
  );
}
