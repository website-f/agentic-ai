/**
 * J2 Equipment warranty claims (Fauzan, 11 Nov 2026: "Tell Fitri to build"), a tab of Items and equipment: from an
 * item of the register, a claim to the supplier, approved by the company manager, sent, then repaired, replaced or
 * refused by the supplier with their report, and closed. Insurance claims stay for policies. The server checks every
 * step; nobody approves a claim they raised or closes an outcome they recorded.
 */
import { Select } from '../../SearchSelect';
import { useState } from 'react';
import { WARRANTY_OUTCOME_LABEL, type ProofInput, type WarrantyClaim, type WarrantyOutcome } from '@prima/core';
import { api, type WarrantyBoard } from '../../api';
import { Card, Empty, Search } from '../../kit';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad, type Tone } from '../../ui';
import { ProofPicker } from '../Proof';
import { Decide, todayMyt } from '../newa-shared';

const TONE: Record<WarrantyClaim['status'], Tone> = { raised: 'warn', approved: 'info', refused: 'neutral', sent: 'info', outcome: 'warn', closed: 'ok' };
type Row = Extract<WarrantyBoard, { ready: true }>['rows'][number];

function RaiseForm({ b, onDone }: { b: Extract<WarrantyBoard, { ready: true }>; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState({ itemId: '', supplier: '', fault: '', faultOn: todayMyt(), warrantyTo: '' });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const needle = q.trim().toLowerCase();
  const items = b.items.filter((i) => !needle || [i.token, i.serial ?? '', i.name].some((v) => v.toLowerCase().includes(needle))).slice(0, 50);
  return (
    <div className="nw-stack">
      <Search value={q} onChange={setQ} placeholder="Label, serial or item name" label="Find the item" />
      <div className="nw-form">
        <label className="field nw-wide">
          <span className="label">Item</span>
          <Select className="input" aria-label="Item" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
            <option value="">Choose</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} · {i.token}
                {i.serial ? ` · ${i.serial}` : ''}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="label">Supplier</span>
          <input className="input" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} aria-label="Supplier" />
        </label>
        <label className="field">
          <span className="label">Warranty ends</span>
          <input className="input" type="date" value={f.warrantyTo} onChange={(e) => setF({ ...f, warrantyTo: e.target.value })} aria-label="Warranty ends" />
        </label>
        <label className="field">
          <span className="label">Fault found on</span>
          <input className="input" type="date" value={f.faultOn} onChange={(e) => setF({ ...f, faultOn: e.target.value })} aria-label="Fault found on" />
        </label>
        <label className="field nw-wide">
          <span className="label">The fault</span>
          <input className="input" value={f.fault} onChange={(e) => setF({ ...f, fault: e.target.value })} aria-label="The fault" />
        </label>
      </div>
      <ProofPicker site={null} refText="Warranty" items={proof} onChange={setProof} documentsOnly required />
      <div className="nw-actions">
        <button
          className="btn btn-primary"
          disabled={act.busy || !f.itemId || !proof.length}
          onClick={async () => {
            const ok = await act.run(() => api.warrantyAct('raise', { ...f, warrantyTo: f.warrantyTo || undefined, proof }), 'Claim raised. The company manager approves sending it.');
            if (ok) onDone();
          }}
        >
          Raise the claim
        </button>
        <button className="btn" onClick={onDone}>
          Close
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function SentForm({ r }: { r: Row }) {
  const [f, setF] = useState({ on: todayMyt(), supplierRef: '' });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="nw-item-act">
      <div className="nw-form">
        <label className="field">
          <span className="label">Handed to the supplier on</span>
          <input className="input" type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} aria-label="Handed to the supplier on" />
        </label>
        <label className="field">
          <span className="label">Supplier's claim reference</span>
          <input className="input" value={f.supplierRef} onChange={(e) => setF({ ...f, supplierRef: e.target.value })} aria-label="Supplier's claim reference" />
        </label>
      </div>
      <ProofPicker site={null} refText={r.claim.ref} items={proof} onChange={setProof} documentsOnly required />
      <div className="nw-actions">
        <button className="btn btn-sm btn-primary" disabled={act.busy || !proof.length} onClick={() => act.run(() => api.warrantyAct('sent', { id: r.claim.id, ...f, proof }), 'Recorded as with the supplier.')}>
          Sent to the supplier
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function OutcomeForm({ r }: { r: Row }) {
  const [f, setF] = useState({ result: 'repaired' as WarrantyOutcome, on: todayMyt(), newSerial: '', reason: '' });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="nw-item-act">
      <div className="nw-form">
        <label className="field">
          <span className="label">What the supplier did</span>
          <Select className="input" aria-label="What the supplier did" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value as WarrantyOutcome })}>
            {(Object.keys(WARRANTY_OUTCOME_LABEL) as WarrantyOutcome[]).map((k) => (
              <option key={k} value={k}>
                {WARRANTY_OUTCOME_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="label">Date</span>
          <input className="input" type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} aria-label="Date" />
        </label>
        {f.result === 'replaced' && (
          <label className="field">
            <span className="label">Serial of the replacement</span>
            <input className="input" value={f.newSerial} onChange={(e) => setF({ ...f, newSerial: e.target.value })} aria-label="Serial of the replacement" />
          </label>
        )}
        {f.result === 'refused_by_supplier' && (
          <label className="field nw-wide">
            <span className="label">The supplier's reason</span>
            <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-label="The supplier's reason" />
          </label>
        )}
      </div>
      <ProofPicker site={null} refText={r.claim.ref} items={proof} onChange={setProof} documentsOnly required />
      <div className="nw-actions">
        <button className="btn btn-sm btn-primary" disabled={act.busy || !proof.length} onClick={() => act.run(() => api.warrantyAct('outcome', { id: r.claim.id, ...f, proof }), 'Outcome recorded. The company manager closes it.')}>
          Save the outcome
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function ClaimItem({ r }: { r: Row }) {
  const c = r.claim;
  const act = useAction();
  return (
    <div className="nw-item">
      <div className="nw-item-main">
        <strong>
          {c.ref} · {c.itemLabel}
        </strong>
        <span className="nw-note">
          {c.supplier} · {c.fault}
        </span>
        <div className="nw-steps">
          <span data-done="true">
            <span>Raised by</span> {c.raised.by}
          </span>
          {c.decided && (
            <span data-done={c.decided.approve}>
              <span>{c.decided.approve ? 'Approved by' : 'Refused by'}</span> {c.decided.by} · “{c.decided.note}”
            </span>
          )}
          {c.sent && (
            <span data-done="true">
              <span>Sent</span> {dateLabel(c.sent.on)} · {c.sent.supplierRef}
            </span>
          )}
          {c.outcome && (
            <span data-done="true">
              {WARRANTY_OUTCOME_LABEL[c.outcome.result]} · {dateLabel(c.outcome.on)}
              {c.outcome.newSerial ? ` · ${c.outcome.newSerial}` : ''}
              {c.outcome.reason ? ` · ${c.outcome.reason}` : ''}
            </span>
          )}
          {c.closed && (
            <span data-done="true">
              <span>Closed by</span> {c.closed.by} · “{c.closed.note}”
            </span>
          )}
        </div>
      </div>
      <div className="nw-item-side">
        <span>
          <span>Warranty ends</span> {dateLabel(c.warrantyTo)}
        </span>
        {r.daysWithSupplier != null && <span>{r.daysWithSupplier}</span>}
      </div>
      <div className="nw-item-end">
        <Chip tone={TONE[c.status]}>{r.statusLabel}</Chip>
      </div>
      {r.canDecide && (
        <div className="nw-item-act">
          <Decide busy={act.busy} onDecide={(approve, note) => void act.run(() => api.warrantyAct('decide', { id: c.id, approve, note }), approve ? 'Approved. Send it to the supplier.' : 'Refused.')} />
          <ErrorNotice error={act.error} />
        </div>
      )}
      {r.canSend && <SentForm r={r} />}
      {r.canOutcome && <OutcomeForm r={r} />}
      {r.canClose && (
        <div className="nw-item-act">
          <Decide busy={act.busy} approveLabel="Close the claim" refuseLabel={null} placeholder="Comment (needed to close)" onDecide={(_ok, note) => void act.run(() => api.warrantyAct('close', { id: c.id, note }), 'Closed.')} />
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
  );
}

/** The Items and equipment screen's "Warranty" tab. */
export function WarrantyPanel() {
  const { data, error } = useLoad(() => api.warrantyBoard(), []);
  const [raising, setRaising] = useState(false);
  const [q, setQ] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="warranty claims" />;
  if (!data.ready)
    return (
      <Card>
        <Empty title="Warranty claims are not switched on yet.">The database part waits for the CEO to install it.</Empty>
      </Card>
    );
  const needle = q.trim().toLowerCase();
  const rows = data.rows.filter((r) => !needle || [r.claim.ref, r.claim.itemLabel, r.claim.supplier, r.claim.serial ?? ''].some((v) => v.toLowerCase().includes(needle)));
  return (
    <Card
      title="Warranty claims"
      sub="A faulty item still under warranty goes back to the supplier: raise it with the warranty card, the company manager approves, send it, and record what the supplier did with their report. Insurance claims stay for policies."
      actions={
        data.canRaise && !raising ? (
          <button className="btn btn-sm btn-primary" onClick={() => setRaising(true)}>
            Raise a warranty claim
          </button>
        ) : undefined
      }
    >
      <div className="nw-stack">
        {raising && <RaiseForm b={data} onDone={() => setRaising(false)} />}
        {data.rows.length > 5 && <Search value={q} onChange={setQ} placeholder="Claim, item, supplier or serial" label="Search warranty claims" />}
        {rows.length === 0 ? (
          <Empty title="No warranty claim yet." />
        ) : (
          <div className="nw-list">
            {rows.map((r) => (
              <ClaimItem key={r.claim.id} r={r} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
