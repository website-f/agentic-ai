import { Select } from '../SearchSelect';
import { SiteSuppliesPanel } from './SiteSupplies';
import { useState, type ReactNode } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type MyItems, type UniformRequests } from '../api';
import { Chip, ErrorNotice, dateLabel, useAction, useLoad } from '../ui';
import { ProofPicker } from './Proof';
import { SignaturePad } from './SignaturePad';

type Row = MyItems['items'][number];

/** Where the phone is, if it allows location; never waits more than 5 seconds and never blocks the signature. */
function phonePlace(): Promise<{ lat: number; lng: number; accuracyM: number | null } | null> {
  return new Promise((done) => {
    if (!('geolocation' in navigator)) return done(null);
    navigator.geolocation.getCurrentPosition(
      (p) => done({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null }),
      () => done(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
    );
  });
}
type PassOn = MyItems['toPassOn'][number];

/**
 * Items the store issued to this person (Fauzan, 27 Oct 2026). They confirm they received each one, or say what is
 * wrong. Procurement sees anything not confirmed or disputed. Never charged to them.
 */
export function MyItemsPanel() {
  const { data, error } = useLoad(() => api.myItems(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return null;
  return (
    <>
      {data.canRequestUniform && <UniformRequestPanel />}
      {data.canRequestUniform && <SiteSuppliesPanel canAsk />}
      {data.toPassOn.length > 0 && <PassOnPanel rows={data.toPassOn} />}
      {data.items.length > 0 && <IssuedToMe items={data.items} />}
      {(data.itDevices ?? []).length > 0 && <MyItDevices rows={data.itDevices} />}
      <MyCharges />
    </>
  );
}

/** Part U-X12: a company item damage charge on the person's next pay, shown to them before pay day. */
function MyCharges() {
  const { data } = useLoad(() => api.inventoryAct('myCharges', {}).catch(() => ({ rows: [] })) as Promise<{ rows: { id: string; status: string; item: string; amount: number | null; cause: string; period: string; hr: { decision: string; note: string } | null }[] }>, []);
  if (!data || !data.rows.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Kerosakan / kehilangan barang syarikat</h3>
      </div>
      {data.rows.map((r) => (
        <div key={r.id} className="item small">
          {r.item} · {r.cause} · {r.amount === null ? 'menunggu harga' : `RM${r.amount.toFixed(2)} pada gaji ${r.period}`} <Chip tone={r.status === 'cancelled' ? 'ok' : 'warn'}>{r.status}</Chip>
          {r.hr ? ` · HR: ${r.hr.decision} (${r.hr.note})` : ' · menunggu semakan HR'}
        </div>
      ))}
    </section>
  );
}

type Device = MyItems['itDevices'][number];

/**
 * "Barang saya": the IT devices this person holds (Merdeka circular MN/CIR/IT/003/2026 point 6). Lapor hilang /
 * dicuri / rosak opens a help request linked to the device. For a theft the police report number and photo are
 * optional, with no deadline.
 */
function MyItDevices({ rows }: { rows: Device[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Peranti IT saya</h3>
      </div>
      <div className="list">
        {rows.map((d) => (
          <DeviceLine key={d.assetId} d={d} />
        ))}
      </div>
    </section>
  );
}

function DeviceLine({ d }: { d: Device }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'lost' | 'stolen' | 'damaged' | 'not_working'>('damaged');
  const [detail, setDetail] = useState('');
  const [police, setPolice] = useState('');
  const [photo, setPhoto] = useState<ProofInput[]>([]);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600 }}>{d.name}</div>
          <div className="muted small">
            {d.label}
            {d.serial ? ` · ${d.serial}` : ''}
          </div>
        </div>
        {d.report ? <Chip tone="warn">Dilaporkan: {d.report.ref}</Chip> : <button className="btn btn-sm" onClick={() => setOpen(!open)}>Lapor hilang / dicuri / rosak</button>}
      </div>
      {open && !d.report && (
        <>
          <Select className="select" aria-label="What happened" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="damaged">Rosak</option>
            <option value="not_working">Tidak berfungsi</option>
            <option value="lost">Hilang</option>
            <option value="stolen">Dicuri</option>
          </Select>
          <textarea className="input" aria-label="What happened, where and when" placeholder="Apa berlaku, di mana dan bila" value={detail} onChange={(e) => setDetail(e.target.value)} />
          {kind === 'stolen' && (
            <>
              <input className="input" aria-label="Police report number (optional)" placeholder="Nombor laporan polis (pilihan)" value={police} onChange={(e) => setPolice(e.target.value)} />
              <ProofPicker site={null} refText="Gambar laporan polis (pilihan)" items={photo} onChange={setPhoto} documentsOnly noLinks />
            </>
          )}
          <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.reportItDevice({ assetId: d.assetId, kind, detail, policeReportNo: police || undefined, policePhoto: photo }), 'Dihantar kepada IT.')}>
            Hantar laporan
          </button>
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function IssuedToMe({ items }: { items: Row[] }) {
  const open = items.filter((i) => !i.issue.acknowledged).length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Items issued to me</h3>
        {open > 0 && <Chip tone="warn">{open} to confirm</Chip>}
      </div>
      <p className="muted small">Check each item and confirm you received it. Company items go back to the store when you leave. Nothing is charged to you.</p>
      <div className="list">
        {items.map((r) => (
          <ItemLine key={r.issue.id} r={r} />
        ))}
      </div>
    </section>
  );
}

function ItemLine({ r }: { r: Row }) {
  const act = useAction();
  const [wrong, setWrong] = useState(false);
  const [note, setNote] = useState('');
  const i = r.issue;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {i.qty} x {r.itemName}
          </div>
          <div className="muted small">
            Issued {dateLabel(i.issuedAt.slice(0, 10))} by {i.issuedBy}
            {i.serial ? ` · serial ${i.serial}` : ''}
            {i.returned ? ` · returned ${dateLabel(i.returned.at.slice(0, 10))}` : ''}
            {i.confirmedAt ? ` · you confirmed ${dateLabel(i.confirmedAt.slice(0, 10))}` : ''}
          </div>
          {i.disputed && <div className="small">You said: {i.disputed.note}. The store will contact you.</div>}
        </div>
        {i.acknowledged ? <Chip tone="ok">Received</Chip> : i.disputed ? <Chip tone="crit">Reported</Chip> : <Chip tone="warn">Please confirm</Chip>}
      </div>
      {!i.acknowledged && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => act.run(() => api.confirmMyItem(i.id, true, ''), 'Thank you, confirmed.')}
          >
            I received it
          </button>
          {!i.disputed && (
            <button className="btn btn-sm" onClick={() => setWrong(!wrong)}>
              Something is wrong
            </button>
          )}
        </div>
      )}
      {wrong && !i.acknowledged && !i.disputed && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input
            className="input"
            aria-label="What is wrong"
            placeholder="Not received, wrong size, damaged…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || !note.trim()}
            onClick={() => act.run(() => api.confirmMyItem(i.id, false, note), 'Sent to the store.')}
          >
            Send to the store
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

const STEP_WHO = { om: 'you', patrol: 'the patrolling officer', guard: 'the guard' } as const;

/**
 * Goodwill items the Operations Manager carries to the sites (Fauzan, 2 Nov 2026): confirm receiving each one from the
 * store, then attach the patrolling officer's and the guard's signed slips as it is passed on.
 */
function PassOnPanel({ rows }: { rows: PassOn[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Items to pass on</h3>
        <Chip tone="warn">{rows.length} open</Chip>
      </div>
      <p className="muted small">
        Each item goes from the Goodwill store to you, then to the patrolling officer, then to the guard. Confirm you received it, then the
        patrolling officer and the guard sign on your screen. If they cannot, attach the slip they signed, and for the guard a photo of the guard
        holding the item. The company is billed once the guard has it.
      </p>
      <div className="list">
        {rows.map((r) => (
          <PassOnLine key={r.issue.id} r={r} />
        ))}
      </div>
    </section>
  );
}

function PassOnLine({ r }: { r: PassOn }) {
  const act = useAction();
  const [slip, setSlip] = useState<ProofInput[]>([]);
  const [photo, setPhoto] = useState<ProofInput[]>([]);
  // They sign on this screen, or the OM attaches their signed slip (and for the guard a photo with the item).
  const [mode, setMode] = useState<'sign' | 'slip'>('sign');
  const [signature, setSignature] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);
  const [note, setNote] = useState('');
  const i = r.issue;
  const h = i.handover!;
  const who = r.next === 'om' ? h.omName : r.next === 'patrol' ? h.patrol!.name : i.personName;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {i.qty} x {r.itemName} for {i.personName}
            {r.staffNo ? ` (${r.staffNo})` : ''}
          </div>
          <div className="muted small">
            {r.companyName} · issued {dateLabel(i.issuedAt.slice(0, 10))} by {i.issuedBy}
            {i.serial ? ` · serial ${i.serial}` : ''}
            {h.om ? ` · OM received ${dateLabel(h.om.at.slice(0, 10))}` : ''}
            {h.patrol?.step ? ` · ${h.patrol.name} signed ${dateLabel(h.patrol.step.at.slice(0, 10))}` : ''}
          </div>
          {i.disputed && <div className="small">Reported: {i.disputed.note}. The store will sort it out.</div>}
        </div>
        <Chip tone={i.disputed ? 'crit' : 'warn'}>{r.next === 'om' ? 'Confirm you received it' : `Waiting for ${who}`}</Chip>
      </div>
      {r.canAct && (
        <>
          {r.next !== 'om' && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="radiogroup" aria-label="How they acknowledge">
              <button type="button" className={`btn btn-sm${mode === 'sign' ? ' btn-primary' : ''}`} aria-pressed={mode === 'sign'} onClick={() => setMode('sign')}>
                Sign on this screen
              </button>
              <button type="button" className={`btn btn-sm${mode === 'slip' ? ' btn-primary' : ''}`} aria-pressed={mode === 'slip'} onClick={() => setMode('slip')}>
                {r.next === 'guard' ? 'Signed slip and photo' : 'Signed slip'}
              </button>
            </div>
          )}
          {r.next !== 'om' && mode === 'sign' && (
            <SignaturePad key={`${i.id}-${r.next}`} label={`${who} signs here to confirm receiving ${i.qty} x ${r.itemName}`} onChange={setSignature} />
          )}
          {r.next !== 'om' && mode === 'slip' && (
            <ProofPicker site={null} refText={`Slip signed by ${who}`} items={slip} onChange={setSlip} documentsOnly required />
          )}
          {r.next === 'guard' && mode === 'slip' && (
            <ProofPicker site={null} refText={`Photo of ${who} holding the item`} items={photo} onChange={setPhoto} documentsOnly required />
          )}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={
                act.busy ||
                (r.next !== 'om' && mode === 'sign' && !signature) ||
                (r.next !== 'om' && mode === 'slip' && (!slip.length || (r.next === 'guard' && !photo.length)))
              }
              onClick={() =>
                act.run(
                  async () => {
                    const place = r.next === 'om' ? null : await phonePlace();
                    await api.handoverStep(
                      i.id,
                      r.next,
                      r.next === 'om'
                        ? { received: true }
                        : mode === 'sign'
                          ? { received: true, signature: signature!, place }
                          : { received: true, slip, ...(photo.length ? { photo } : {}), place },
                    );
                    setSlip([]);
                    setPhoto([]);
                    setSignature(null);
                  },
                  r.next === 'om' ? 'Thank you, confirmed.' : `Recorded: ${who} has it.`,
                )
              }
            >
              {r.next === 'om' ? 'I received it' : `${who} received it`}
            </button>
            <button className="btn btn-sm" onClick={() => setWrong(!wrong)}>
              Something is wrong
            </button>
          </div>
          {wrong && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input
                className="input"
                aria-label="What is wrong"
                placeholder={`What ${STEP_WHO[r.next]} found: not received, wrong item, damaged…`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="btn btn-sm"
                disabled={act.busy || !note.trim()}
                onClick={() => act.run(() => api.handoverStep(i.id, r.next, { received: false, note }), 'Sent to the store.')}
              >
                Send to the store
              </button>
            </div>
          )}
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

type UReq = UniformRequests['requests'][number];

export const REQ_TONE = { open: 'warn', issued: 'ok', refused: 'crit', cancelled: 'neutral' } as const;
export const REQ_LABEL = { open: 'Waiting for the store', issued: 'Issued: confirm and collect signatures below', refused: 'Refused', cancelled: 'Cancelled' } as const;

/**
 * An Operations Manager asks the Goodwill store for a uniform for a guard (Fauzan, 11 Nov 2026). Once the store issues
 * it, it appears under "Items to pass on", where the patrolling officer and the guard sign on this phone, because the
 * shared site device and the guard app are not available yet.
 */
function UniformRequestPanel() {
  const { data, error } = useLoad(() => api.uniformRequests(), []);
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [staffNo, setStaffNo] = useState('');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [pays, setPays] = useState(false);
  const [receiptNo, setReceiptNo] = useState('');
  const [amount, setAmount] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return null;
  const waiting = data.requests.filter((r) => r.status === 'open').length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Uniform requests</h3>
        {waiting > 0 && <Chip tone="warn">{waiting} waiting</Chip>}
        <button className="btn btn-sm btn-primary" onClick={() => setOpen(!open)}>
          Ask for a uniform
        </button>
      </div>
      <p className="muted small">
        Ask the Goodwill store for a uniform for a guard. Up to {data.rule.freePerYear} free pieces in 12 months, usually 1 every{' '}
        {data.rule.everyMonths} months. Pieces after the free ones only if the guard pays (never from pay). When the store issues it, it comes to you; the
        patrolling officer and the guard sign on your phone under "Items to pass on".
      </p>
      {open && (
        <div style={{ display: 'grid', gap: 6 }}>
          <input className="input" aria-label="Guard staff number" placeholder="Guard's staff number" value={staffNo} onChange={(e) => setStaffNo(e.target.value)} />
          <Select className="input" aria-label="Uniform" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Uniform and size…</option>
            {data.uniforms.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.onHand} in store)
              </option>
            ))}
          </Select>
          <input className="input" aria-label="Pieces" placeholder="Pieces" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          <input
            className="input"
            aria-label="Why the guard needs it"
            placeholder="Why: new guard, worn out, torn, wrong size…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <label className="small row" style={{ gap: 6 }}>
            <input type="checkbox" checked={pays} onChange={(e) => setPays(e.target.checked)} /> The guard pays for this piece (after the free ones in 12 months)
          </label>
          {pays && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input className="input" aria-label="Receipt number" placeholder="Receipt number" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
              <input className="input" aria-label="Amount paid (RM)" placeholder="Amount paid (RM)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || !staffNo.trim() || !itemId || !reason.trim()}
            onClick={() =>
              act.run(
                async () => {
                  await api.requestUniform({
                    staffNo,
                    stockItemId: itemId,
                    qty: Number(qty),
                    reason,
                    guardPays: pays ? { receiptNo, amount: Number(amount) } : null,
                  });
                  setStaffNo('');
                  setReason('');
                  setPays(false);
                  setReceiptNo('');
                  setAmount('');
                  setOpen(false);
                },
                'Sent to the Goodwill store.',
              )
            }
          >
            Send to the store
          </button>
          <ErrorNotice error={act.error} />
        </div>
      )}
      {data.requests.length > 0 && (
        <div className="list">
          {data.requests.map((r) => (
            <UniformRequestLine key={r.id} r={r} mine />
          ))}
        </div>
      )}
    </section>
  );
}

export function UniformRequestLine({ r, mine, children }: { r: UReq; mine?: boolean; children?: ReactNode }) {
  const act = useAction();
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {r.qty} x {r.itemName} for {r.personName} ({r.staffNo})
          </div>
          <div className="muted small">
            Asked {dateLabel(r.requestedAt.slice(0, 10))} by {r.requestedBy} · {r.reason}
            {` · ${r.history.pieces} piece${r.history.pieces === 1 ? '' : 's'} in 12 months`}
            {r.history.last ? `, last ${dateLabel(r.history.last)}` : ''}
            {r.early ? ' · within 6 months of the last piece' : ''}
            {r.guardPays ? ` · guard pays, receipt ${r.guardPays.receiptNo}, RM${r.guardPays.amount.toFixed(2)}` : ''}
          </div>
          {r.decided && (
            <div className="small">
              {r.decided.by} {dateLabel(r.decided.at.slice(0, 10))}
              {r.decided.note ? `: ${r.decided.note}` : ''}
            </div>
          )}
        </div>
        <Chip tone={REQ_TONE[r.status]}>{REQ_LABEL[r.status]}</Chip>
      </div>
      {mine && r.status === 'open' && (
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.decideUniformRequest(r.id, 'cancel', {}), 'Request cancelled.')}>
            Cancel request
          </button>
        </div>
      )}
      {children}
      <ErrorNotice error={act.error} />
    </div>
  );
}
