import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type MyItems } from '../api';
import { Chip, ErrorNotice, dateLabel, useAction, useLoad } from '../ui';
import { ProofPicker } from './Proof';
import { SignaturePad } from './SignaturePad';
import { UniformRequestsPanel } from './UniformRequests';

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
      {/* I1 (Fauzan, 11 Nov 2026): a government OM asks the Goodwill store for a guard's uniform. */}
      {data.canRequestUniform && <UniformRequestsPanel place="mine" />}
      {data.toPassOn.length > 0 && <PassOnPanel rows={data.toPassOn} />}
      {data.items.length > 0 && <IssuedToMe items={data.items} />}
    </>
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
