import { useState } from 'react';
import { type ProofInput } from '@prima/core';
import { api, type FleetBoard, type FleetRecordsView } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';

/**
 * Transport check (Fauzan, 23 Nov 2026: "Do the gap"). Transport's Do today, and three registers on the Vehicles screen:
 * accidents, traffic summonses and driver licences (module fleet-records-v1). Transport keeps them; a driver may report
 * an accident in the vehicle out with them and sees their own summonses and licence. Nothing is deleted: a record is
 * closed with a comment and proof, a licence is replaced by filing the new one. The driver at the wheel pays a summons:
 * the company pays it on time, then recovers it (Fauzan, 23 Nov 2026, rule FLEET-SUMMONS).
 */

type Rec = FleetRecordsView['records'][number];
type Kind = 'ACCIDENT' | 'SUMMONS' | 'LICENCE' | 'MINE';

const ISSUER: Record<string, string> = { JPJ: 'JPJ', PDRM: 'PDRM (police)', AES: 'AES camera', COUNCIL: 'Local council', OTHER: 'Other' };
const OUTCOME: Record<string, string> = { PAID: 'Paid', APPEALED: 'Appealed', CANCELLED: 'Cancelled', SETTLED: 'Settled', REPLACED: 'Replaced' };
const TITLE: Record<Kind, string> = { ACCIDENT: 'Accidents', SUMMONS: 'Traffic summonses', LICENCE: 'Driver licences', MINE: 'My summonses and licence' };
const NOW_LOCAL = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16);

export function FleetToday({ items }: { items: FleetBoard['today'] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Do today</h3>
          <div className="muted small">Renewals, servicing, payments, bookings, driver hours, summonses, licences and accidents in one list, most urgent first.</div>
        </div>
      </div>
      <div className="list">
        {items.length === 0 && <div className="empty">Nothing to do today.</div>}
        {items.map((t, i) => (
          <div key={i} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>{t.title}</div>
              <div className="muted small">{t.detail}</div>
            </div>
            <Chip tone={t.tone as Tone}>{t.tag}</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FleetRecordsPanel({ kind, board }: { kind: Kind; board: FleetBoard }) {
  const [n, setN] = useState(0);
  const { data, error } = useLoad(() => api.fleetRecords(), [n]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="records" />;
  if (!data.installed)
    return (
      <section className="panel">
        <div className="empty">Not installed yet: accidents, summonses and driver licences need database module fleet-records-v1.</div>
      </section>
    );
  const transport = board.role === 'transport';
  const rows = kind === 'MINE' ? data.records : data.records.filter((r) => r.kind === kind);
  const canAdd = transport && kind !== 'MINE';
  const ownTrip = kind === 'MINE' ? board.myVehicle : null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>{TITLE[kind]}</h3>
          <div className="muted small">
            {kind === 'SUMMONS'
              ? 'Each summons is linked to whoever had the vehicle out at that time, from the log. The company pays it on time, then recovers it from the driver at the wheel (deduction only with signed consent).'
              : kind === 'LICENCE'
                ? 'A vehicle cannot go out to a driver whose licence on file has expired. The licence copy is personal data.'
                : kind === 'ACCIDENT'
                  ? 'Report with photos; close it once the repair and the insurer claim are settled. The OGM and the COO are told while it is open.'
                  : 'Summonses and licences where you are the driver.'}
          </div>
        </div>
      </div>
      {canAdd && <AddRecord kind={kind as Exclude<Kind, 'MINE'>} board={board} onDone={() => setN(n + 1)} />}
      {kind === 'MINE' && ownTrip && <AddRecord kind="ACCIDENT" board={board} onDone={() => setN(n + 1)} vehicleId={ownTrip.id} />}
      <div className="list">
        {rows.length === 0 && <div className="empty">Nothing recorded.</div>}
        {rows.map((r) => (
          <RecordLine
            key={r.id}
            r={r}
            close={transport && r.status === 'open' && r.kind !== 'LICENCE'}
            recover={transport && r.kind === 'SUMMONS' && r.status === 'closed' && r.outcome === 'PAID' && !r.recovery}
            onDone={() => setN(n + 1)}
          />
        ))}
      </div>
    </section>
  );
}

const RECOVERY: Record<string, string> = { DRIVER_PAID: 'Driver paid it back', DEDUCT: 'HR deducts with signed consent', COMPANY_BEARS: 'Company bears it' };

function RecordLine({ r, close, recover, onDone }: { r: Rec; close: boolean; recover: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState('DRIVER_PAID');
  const [outcome, setOutcome] = useState(r.kind === 'ACCIDENT' ? 'SETTLED' : 'PAID');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const title =
    r.kind === 'ACCIDENT'
      ? `${r.plate}: accident at ${r.place}`
      : r.kind === 'SUMMONS'
        ? `${r.plate}: ${ISSUER[r.issuer ?? 'OTHER']} ${r.ref}`
        : `${r.driver}: licence ${(r.classes ?? []).join(' ')}`;
  const detail =
    r.kind === 'LICENCE'
      ? `Expires ${dateLabel(r.expiresOn ?? '')}`
      : `${dateTimeLabel(r.at)} · ${r.driver ? `driver ${r.driver}` : 'no driver logged out then'}${r.what ? ` · ${r.what}` : ''}${r.amountRm != null ? ` · RM${r.amountRm.toFixed(2)}` : ''}${r.dueOn ? ` · pay by ${dateLabel(r.dueOn)}` : ''}${r.policeReport ? ` · police report ${r.policeReport}` : ''}${r.insurerClaim ? ` · insurer claim ${r.insurerClaim}` : ''}`;
  const expired = r.kind === 'LICENCE' && r.status === 'open' && !!r.expiresOn && r.expiresOn < new Date().toISOString().slice(0, 10);
  const tone: Tone = r.status === 'closed' ? 'ok' : expired || r.injured ? 'crit' : 'warn';
  const label = r.status === 'closed' ? OUTCOME[r.outcome ?? ''] ?? 'Closed' : r.kind === 'LICENCE' ? (expired ? 'Expired' : 'On file') : r.injured ? 'Open, someone hurt' : 'Open';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{title}</div>
          <div className="muted small">{detail}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Chip tone={tone}>{label}</Chip>
          {r.recovery && <Chip tone="ok">{RECOVERY[r.recovery.how]}</Chip>}
          {(close || recover) && (
            <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide' : close ? 'Close it' : 'Recover from driver'}
            </button>
          )}
        </div>
      </div>
      {r.history.length > 1 && <div className="muted small">{r.history.map((h) => `${h.what} (${h.by})`).join(' · ')}</div>}
      {open && recover && (
        <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="muted small">The driver at the wheel pays. HR deducts from pay only with the driver's signed consent; otherwise the driver pays back, or the company bears it with a reason.</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <select className="select" aria-label="How it is recovered" value={how} onChange={(e) => setHow(e.target.value)}>
              {Object.entries(RECOVERY).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input className="input" aria-label="Comment" placeholder="Comment (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {how !== 'COMPANY_BEARS' && <ProofPicker site={null} refText={r.ref ?? 'Summons'} items={proof} onChange={setProof} documentsOnly required />}
          <div>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || note.trim().length < 3 || (how !== 'COMPANY_BEARS' && !proof.length)}
              onClick={() => act.run(() => api.fleetRecordAct('recover', { id: r.id, how, note }, proof), 'Recorded.').then((x) => x && onDone())}
            >
              Record
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </div>
      )}
      {open && close && (
        <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <select className="select" aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {r.kind === 'ACCIDENT' ? (
                <option value="SETTLED">Repair and claim settled</option>
              ) : (
                <>
                  <option value="PAID">Paid</option>
                  <option value="APPEALED">Appealed (reduced or dropped)</option>
                  <option value="CANCELLED">Cancelled by the issuer</option>
                </>
              )}
            </select>
            <input className="input" aria-label="Comment" placeholder="Comment (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <ProofPicker site={null} refText={r.plate ?? 'Record'} items={proof} onChange={setProof} documentsOnly required />
          <div>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !proof.length || note.trim().length < 3}
              onClick={() => act.run(() => api.fleetRecordAct('close', { id: r.id, outcome, note }, proof), 'Closed.').then((x) => x && onDone())}
            >
              Close with proof
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
  );
}

function AddRecord({ kind, board, onDone, vehicleId: fixed }: { kind: Exclude<Kind, 'MINE'>; board: FleetBoard; onDone: () => void; vehicleId?: string }) {
  const vehicles: { id: string; plate: string; model: string }[] = board.board.length ? board.board : board.myVehicle ? [board.myVehicle] : [];
  const [vehicleId, setVehicleId] = useState(fixed ?? vehicles[0]?.id ?? '');
  const [at, setAt] = useState(NOW_LOCAL());
  const [place, setPlace] = useState('');
  const [what, setWhat] = useState('');
  const [injured, setInjured] = useState(false);
  const [policeReport, setPoliceReport] = useState('');
  const [insurerClaim, setInsurerClaim] = useState('');
  const [issuer, setIssuer] = useState('JPJ');
  const [ref, setRef] = useState('');
  const [amount, setAmount] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [driverUserId, setDriverUserId] = useState('');
  const [classes, setClasses] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [show, setShow] = useState(false);
  const act = useAction();
  const label = kind === 'ACCIDENT' ? 'Report an accident' : kind === 'SUMMONS' ? 'Record a summons' : 'Add a driver licence';
  if (!show)
    return (
      <div style={{ padding: '0 0 8px' }}>
        <button className="btn btn-primary btn-sm" onClick={() => setShow(true)}>
          {label}
        </button>
      </div>
    );
  const iso = `${at}:00+08:00`;
  const submit = () => {
    if (kind === 'LICENCE') return api.fleetRecordAct('licence', { driverUserId, classes, expiresOn }, proof);
    if (kind === 'ACCIDENT') return api.fleetRecordAct('accident', { vehicleId, at: iso, place, what, injured, policeReport, insurerClaim }, proof);
    return api.fleetRecordAct('summons', { vehicleId, at: iso, issuer, ref, what, place, amountRm: amount === '' ? null : Number(amount), dueOn: dueOn || null }, proof);
  };
  return (
    <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {kind !== 'LICENCE' && !fixed && (
          <select className="select" aria-label="Vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate} · {v.model}
              </option>
            ))}
          </select>
        )}
        {kind !== 'LICENCE' && (
          <label className="small">
            When <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </label>
        )}
        {kind === 'SUMMONS' && (
          <>
            <select className="select" aria-label="Issued by" value={issuer} onChange={(e) => setIssuer(e.target.value)}>
              {Object.entries(ISSUER).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input className="input" aria-label="Summons number" placeholder="Summons number" value={ref} onChange={(e) => setRef(e.target.value)} />
            <input className="input" aria-label="Amount RM" placeholder="Amount RM" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <label className="small">
              Pay by <input className="input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
            </label>
          </>
        )}
        {kind === 'LICENCE' && (
          <>
            <select className="select" aria-label="Driver" value={driverUserId} onChange={(e) => setDriverUserId(e.target.value)}>
              <option value="">Choose the driver</option>
              {board.drivers.map((d) => (
                <option key={d.userId} value={d.userId}>
                  {d.name}
                </option>
              ))}
            </select>
            <input className="input" aria-label="Licence classes" placeholder="Classes, e.g. B2 D" value={classes} onChange={(e) => setClasses(e.target.value)} />
            <label className="small">
              Expires <input className="input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </label>
          </>
        )}
      </div>
      {kind !== 'LICENCE' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Place" placeholder="Place" value={place} onChange={(e) => setPlace(e.target.value)} />
          <input
            className="input"
            aria-label={kind === 'ACCIDENT' ? 'What happened' : 'Offence'}
            placeholder={kind === 'ACCIDENT' ? 'What happened' : 'Offence, e.g. speeding 110 in 90'}
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            style={{ minWidth: 240 }}
          />
          {kind === 'ACCIDENT' && (
            <>
              <input className="input" aria-label="Police report number" placeholder="Police report no. (if any)" value={policeReport} onChange={(e) => setPoliceReport(e.target.value)} />
              <input className="input" aria-label="Insurer claim number" placeholder="Insurer claim no. (if any)" value={insurerClaim} onChange={(e) => setInsurerClaim(e.target.value)} />
              <label className="small">
                <input type="checkbox" checked={injured} onChange={(e) => setInjured(e.target.checked)} /> Someone was hurt
              </label>
            </>
          )}
        </div>
      )}
      <ProofPicker
        site={null}
        refText={kind === 'LICENCE' ? 'Licence' : vehicles.find((v) => v.id === vehicleId)?.plate ?? 'Vehicle'}
        items={proof}
        onChange={setProof}
        documentsOnly
        required
      />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-primary btn-sm" disabled={act.busy || !proof.length} onClick={() => act.run(submit, 'Recorded.').then((x) => x && (setProof([]), setShow(false), onDone()))}>
          Save with proof
        </button>
        <button className="btn btn-sm" onClick={() => setShow(false)}>
          Cancel
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}
