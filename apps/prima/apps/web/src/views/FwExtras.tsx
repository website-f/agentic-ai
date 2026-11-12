/**
 * E8 Foreign workers (Fauzan, 11 Nov 2026: "Tell Fitri to build"). On the Hostels screen: who lives in each hostel,
 * checking a worker in, and the check-out memo (FWM or the company office prepares it with the signed copy; the FWM
 * Manager or Deputy approves it; only then the stay ends). On the Foreign workers screen: workers on long SOCSO MC
 * whose permit comes due, with the task to the OM. The server checks every step; nothing is taken from pay.
 */
import { Select } from '../SearchSelect';
import { useState } from 'react';
import { CHECKOUT_REASON_LABEL, WORKER_ACK_LABEL, type CheckoutReason, type ProofInput, type WorkerAck } from '@prima/core';
import { api, type HostelStaysBoard, type PermitsOnMcBoard } from '../api';
import { Card, Empty, Search, Stat, Stats } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';
import { Decide, todayMyt } from './newa-shared';

type HostelRow = HostelStaysBoard['hostels'][number];
type StayRow = HostelRow['stays'][number];

const STATE: Record<StayRow['state'], { label: string; tone: Tone }> = {
  living: { label: 'Living here', tone: 'ok' },
  memo_waiting: { label: 'Check-out memo waiting', tone: 'warn' },
  memo_returned: { label: 'Memo sent back', tone: 'crit' },
  leaving: { label: 'Checked out', tone: 'neutral' },
  left: { label: 'Moved out', tone: 'neutral' },
};

function CheckIn({ h }: { h: HostelRow }) {
  const [open, setOpen] = useState(false);
  const [personId, setPersonId] = useState('');
  const [from, setFrom] = useState(todayMyt());
  const [room, setRoom] = useState('');
  const act = useAction();
  if (!open)
    return (
      <button className="btn btn-sm btn-primary" disabled={h.free === 0 || h.candidates.length === 0} onClick={() => setOpen(true)}>
        Check a worker in
      </button>
    );
  return (
    <div className="nw-stack" style={{ width: '100%' }}>
      <div className="nw-form">
        <label className="field">
          <span className="label">Worker</span>
          <Select className="input" aria-label="Worker" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">Choose</option>
            {h.candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.staffNo})
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="label">Moved in on</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Moved in on" />
        </label>
        <label className="field">
          <span className="label">Room or bed (optional)</span>
          <input className="input" value={room} onChange={(e) => setRoom(e.target.value)} aria-label="Room or bed (optional)" />
        </label>
      </div>
      <div className="nw-actions">
        <button
          className="btn btn-primary"
          disabled={act.busy || !personId}
          onClick={async () => {
            const ok = await act.run(() => api.fwExtraAct('check_in', { hostelId: h.hostel.id, personId, from, room }), 'Checked in.');
            if (ok) {
              setOpen(false);
              setPersonId('');
            }
          }}
        >
          Check in
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function MemoForm({ s, onDone }: { s: StayRow; onDone: () => void }) {
  const [f, setF] = useState({ outOn: todayMyt(), reason: 'LEFT_COMPANY' as CheckoutReason, keyReturned: true, beddingReturned: true, lockerCleared: true, roomOk: true, damage: '', owedNote: '', workerAck: 'SIGNED' as WorkerAck });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const tick = (k: 'keyReturned' | 'beddingReturned' | 'lockerCleared' | 'roomOk', label: string) => (
    <label className="row" style={{ gap: 8, minHeight: 44 }}>
      <input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="nw-item-act">
      <div className="nw-form">
        <label className="field">
          <span className="label">Leaves the hostel on</span>
          <input className="input" type="date" value={f.outOn} onChange={(e) => setF({ ...f, outOn: e.target.value })} aria-label="Leaves the hostel on" />
        </label>
        <label className="field">
          <span className="label">Why</span>
          <Select className="input" aria-label="Why" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value as CheckoutReason })}>
            {(Object.keys(CHECKOUT_REASON_LABEL) as CheckoutReason[]).map((k) => (
              <option key={k} value={k}>
                {CHECKOUT_REASON_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <div className="nw-wide nw-row">
          {tick('keyReturned', 'Key returned')}
          {tick('beddingReturned', 'Bedding and mattress returned')}
          {tick('lockerCleared', 'Locker cleared')}
          {tick('roomOk', 'Room in good order')}
        </div>
        <label className="field nw-wide">
          <span className="label">What is missing or damaged</span>
          <input className="input" value={f.damage} onChange={(e) => setF({ ...f, damage: e.target.value })} aria-label="What is missing or damaged" />
        </label>
        <label className="field nw-wide">
          <span className="label">Money the worker may still owe (for HR; never taken from pay here)</span>
          <input className="input" value={f.owedNote} onChange={(e) => setF({ ...f, owedNote: e.target.value })} aria-label="Money the worker may still owe" />
        </label>
        <label className="field">
          <span className="label">The worker's signature</span>
          <Select className="input" aria-label="The worker's signature" value={f.workerAck} onChange={(e) => setF({ ...f, workerAck: e.target.value as WorkerAck })}>
            {(Object.keys(WORKER_ACK_LABEL) as WorkerAck[]).map((k) => (
              <option key={k} value={k}>
                {WORKER_ACK_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <ProofPicker site={null} refText="Hostel" items={proof} onChange={setProof} documentsOnly required />
      <div className="nw-actions">
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !proof.length}
          onClick={async () => {
            const ok = await act.run(() => api.fwExtraAct('memo', { stayId: s.stay.id, ...f, proof }), 'Memo sent to the FWM Manager.');
            if (ok) onDone();
          }}
        >
          Send the memo for approval
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Close
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function StayItem({ s }: { s: StayRow }) {
  const [memo, setMemo] = useState(false);
  const act = useAction();
  const m = s.stay.checkout;
  return (
    <div className="nw-item">
      <div className="nw-item-main">
        <strong>{s.stay.personName}</strong>
        <span className="nw-note">
          <span>From</span> {dateLabel(s.stay.from)}
          {s.stay.to ? (
            <>
              {' · '}
              <span>to</span> {dateLabel(s.stay.to)}
            </>
          ) : null}
          {s.stay.room ? ` · ${s.stay.room}` : ''}
        </span>
        {m && (
          <div className="nw-steps">
            <span data-done="true">
              <span>Memo by</span> {m.prepared.by}
            </span>
            <span>{CHECKOUT_REASON_LABEL[m.reason]}</span>
            <span>{WORKER_ACK_LABEL[m.workerAck]}</span>
            {m.damage && <span>{m.damage}</span>}
            {m.decided && (
              <span data-done={m.decided.approve}>
                <span>{m.decided.approve ? 'Approved by' : 'Sent back by'}</span> {m.decided.by} · “{m.decided.note}”
              </span>
            )}
          </div>
        )}
      </div>
      <div className="nw-item-side">{m ? dateLabel(m.outOn) : ''}</div>
      <div className="nw-item-end">
        <Chip tone={STATE[s.state].tone}>{STATE[s.state].label}</Chip>
        {s.canMemo && !memo && (
          <button className="btn btn-sm" onClick={() => setMemo(true)}>
            {m ? 'Fix the memo' : 'Check out'}
          </button>
        )}
      </div>
      {memo && <MemoForm s={s} onDone={() => setMemo(false)} />}
      {s.canDecide && (
        <div className="nw-item-act">
          <Decide
            busy={act.busy}
            approveLabel="Approve the check-out"
            refuseLabel="Send back"
            placeholder="Comment (needed to approve or send back)"
            onDecide={(approve, note) => void act.run(() => api.fwExtraAct('memo_decide', { stayId: s.stay.id, approve, note }), approve ? 'Checked out.' : 'Sent back to the person who prepared it.')}
          />
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
  );
}

/** The Hostels screen's "Who lives here" tab. */
export function HostelStaysPanel() {
  const { data, error } = useLoad(() => api.hostelStays(), []);
  const [q, setQ] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="hostel residents" />;
  const needle = q.trim().toLowerCase();
  const living = data.hostels.reduce((n, h) => n + h.residents, 0);
  const free = data.hostels.reduce((n, h) => n + h.free, 0);
  return (
    <div className="nw-stack">
      <Stats>
        <Stat label="Living in hostels" value={living} tone="info" />
        <Stat label="Free beds" value={free} tone={free ? 'ok' : 'warn'} />
        <Stat label="Check-out memos waiting" value={data.waiting} tone={data.waiting ? 'warn' : 'ok'} note="The FWM Manager or Deputy approves" />
      </Stats>
      {data.hostels.length > 3 && <Search value={q} onChange={setQ} placeholder="Search worker or hostel" label="Search worker or hostel" />}
      {data.hostels.length === 0 && (
        <Card>
          <Empty title="No hostel on record.">Add the hostel first; then check workers in here.</Empty>
        </Card>
      )}
      {data.hostels.map((h) => {
        const stays = h.stays.filter((s) => !needle || s.stay.personName.toLowerCase().includes(needle) || h.hostel.name.toLowerCase().includes(needle));
        if (needle && !stays.length) return null;
        return (
          <Card key={h.hostel.id} title={h.hostel.name} sub={`${h.companyName} · ${h.residents} / ${h.hostel.beds}`} actions={data.canCheckIn ? <CheckIn h={h} /> : undefined}>
            {stays.length === 0 ? (
              <p className="nw-note">Nobody is checked in yet.</p>
            ) : (
              <div className="nw-list">
                {stays.map((s) => (
                  <StayItem key={s.stay.id} s={s} />
                ))}
              </div>
            )}
          </Card>
        );
      })}
      <p className="nw-note">Bed-days from these stays share each electricity and water bill. A worker leaves the hostel only when the FWM Manager or Deputy approves the check-out memo.</p>
    </div>
  );
}

// ---------- Permits during long SOCSO MC ----------

export function PermitOnMcCard() {
  const { data, error } = useLoad(() => api.fwPermitsOnMc(), []);
  const act = useAction();
  if (error || !data || data.rows.length === 0) return null;
  return (
    <Card
      title="Permits coming due during SOCSO MC"
      sub={`On SOCSO MC for ${data.longMcDays} days or more in a row, a worker cannot go for the renewal. Send the OM a task to collect the passport and papers; FWM arranges the renewal or a special pass with Immigration.`}
    >
      <div className="nw-stack">
        <ErrorNotice error={act.error} />
        <div className="nw-list">
          {data.rows.map((r) => (
            <div key={`${r.personId}-${r.paper}`} className="nw-item">
              <div className="nw-item-main">
                <strong>
                  {r.name} ({r.staffNo})
                </strong>
                <span className="nw-note">{r.companyName}</span>
                <span className="nw-note">
                  <span>On MC</span> {dateLabel(r.mcFrom)} – {dateLabel(r.mcTo)} · {r.mcDays}
                </span>
              </div>
              <div className="nw-item-side">
                <span>{r.paper === 'PLKS_PERMIT' ? 'PLKS' : r.paper === 'PASSPORT' ? 'Passport' : r.paper === 'FOMEMA' ? 'FOMEMA' : 'Foreign worker insurance'}</span>
                <span>
                  <span>Expires</span> {dateLabel(r.expiresOn)}
                </span>
              </div>
              <div className="nw-item-end">
                {r.taskId ? (
                  <Chip tone="info">Task sent</Chip>
                ) : r.canSend ? (
                  <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.fwExtraAct('permit_task', { personId: r.personId, paper: r.paper }), 'Task sent to the OM.')}>
                    Send the permit task
                  </button>
                ) : (
                  <Chip tone="warn">No task yet</Chip>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
