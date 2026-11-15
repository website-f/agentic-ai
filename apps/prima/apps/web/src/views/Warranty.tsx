import { Select } from '../SearchSelect';
import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type WarrantyBoard } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import { ProofPicker } from './Proof';
import { Card } from '../kit';

/**
 * A8 (Fitri package): equipment warranty claims. The holder or the store reports the fault with a photo; the store or
 * asset owner checks the warranty dates; the claim goes to the supplier; the outcome is recorded and the item follows.
 */
type Claim = WarrantyBoard['claims'][number];
const STATUS: Record<Claim['status'], [string, 'warn' | 'ok' | 'neutral' | 'crit']> = {
  reported: ['Warranty to check', 'warn'],
  checked: ['To send to the supplier', 'warn'],
  sent: ['With the supplier', 'neutral'],
  closed: ['Closed', 'ok'],
};

function ClaimLine({ c, canCheck, results }: { c: Claim; canCheck: boolean; results: WarrantyBoard['results'] }) {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const [f, setF] = useState({ supplier: '', warrantyTo: '', note: '', supplierRef: '', on: today, result: 'repaired' as keyof typeof results, replacementSerial: '' });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const [label, tone] = STATUS[c.status];
  return (
    <div className="item">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>{c.ref}</strong> <span>{c.itemLabel}</span> <Chip tone={c.outcome?.result === 'refused' ? 'crit' : tone}>{c.outcome ? results[c.outcome.result] : label}</Chip>
      </div>
      <div className="muted small">
        Fault found {dateLabel(c.faultOn)}: {c.fault}. Reported by {c.reportedBy}.
        {c.check ? ` Warranty to ${dateLabel(c.check.warrantyTo)}${c.check.fromRecord ? ' (register)' : ' (warranty card)'}, supplier ${c.check.supplier}.` : ''}
        {c.sent ? ` Sent ${dateLabel(c.sent.on)}, reference ${c.sent.supplierRef}.` : ''}
        {c.outcome ? ` ${c.outcome.note}` : ''}
      </div>
      {canCheck && c.status === 'reported' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" placeholder="Supplier or maker" aria-label="Supplier" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
          <label className="small">
            Warranty ends (if not on the register) <input className="input" type="date" value={f.warrantyTo} onChange={(e) => setF({ ...f, warrantyTo: e.target.value })} />
          </label>
          <ProofPicker site={null} refText={c.ref} items={proof} onChange={setProof} documentsOnly />
          <button className="btn btn-sm" disabled={act.busy || f.supplier.trim().length < 2} onClick={() => act.run(() => api.checkWarrantyClaim(c.id, { supplier: f.supplier, warrantyTo: f.warrantyTo || null, proof }), 'Warranty checked.')}>
            Check warranty
          </button>
        </div>
      )}
      {canCheck && c.status === 'checked' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" type="date" aria-label="Sent on" value={f.on} max={today} onChange={(e) => setF({ ...f, on: e.target.value })} />
          <input className="input" placeholder="Supplier's claim or ticket reference" aria-label="Supplier reference" value={f.supplierRef} onChange={(e) => setF({ ...f, supplierRef: e.target.value })} />
          <button className="btn btn-sm" disabled={act.busy || f.supplierRef.trim().length < 2} onClick={() => act.run(() => api.sendWarrantyClaim(c.id, { on: f.on, supplierRef: f.supplierRef }), 'Recorded as sent.')}>
            Sent to the supplier
          </button>
        </div>
      )}
      {canCheck && c.status === 'sent' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Select className="select" aria-label="Outcome" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value as keyof typeof results })}>
            {Object.entries(results).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          {f.result === 'replaced' && <input className="input" placeholder="Serial of the replacement" aria-label="Replacement serial" value={f.replacementSerial} onChange={(e) => setF({ ...f, replacementSerial: e.target.value })} />}
          <input className="input" placeholder={f.result === 'refused' ? "Supplier's reason" : 'What the supplier did'} aria-label="Outcome note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <button className="btn btn-sm" disabled={act.busy || f.note.trim().length < 3} onClick={() => act.run(() => api.closeWarrantyClaim(c.id, { result: f.result, note: f.note, replacementSerial: f.replacementSerial || null }), 'Outcome recorded.')}>
            Record outcome
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** `hideWhenEmpty` (P105): on a person's own screen, nothing is shown while they hold nothing under warranty and have no claim. */
export function WarrantyClaimsSection({ source, hideWhenEmpty }: { source?: 'it_asset' | 'stock'; hideWhenEmpty?: boolean }) {
  const { data, error } = useLoad(() => api.warrantyBoard(), []);
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const [f, setF] = useState({ itemKey: '', fault: '', faultOn: today });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="warranty claims" />;
  if (!data.installed) return hideWhenEmpty ? null : <div className="muted small">Equipment warranty claims are not installed in this database yet.</div>;
  const items = data.items.filter((i) => !source || i.source === source);
  const claims = data.claims.filter((c) => !source || c.source === source);
  const picked = items.find((i) => `${i.source}:${i.id}` === f.itemKey);
  const canCheck = (c: Claim) => (c.source === 'it_asset' ? data.canCheckIt : data.canCheckStock);
  if (hideWhenEmpty && !items.length && !claims.length) return null;
  return (
    <Card title="Warranty claims" sub="A faulty item still under warranty: report it with a photo; the store or IT checks the warranty, sends it to the supplier and records the outcome.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.length > 0 && (
        <div className="row small" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select className="select" aria-label="Item" value={f.itemKey} onChange={(e) => setF({ ...f, itemKey: e.target.value })}>
            <option value="">Choose the faulty item</option>
            {items.map((i) => (
              <option key={`${i.source}:${i.id}`} value={`${i.source}:${i.id}`}>
                {i.label}
                {i.warrantyTo ? `, warranty to ${i.warrantyTo}` : ''}
              </option>
            ))}
          </Select>
          <input className="input" type="date" aria-label="Fault found on" value={f.faultOn} max={today} onChange={(e) => setF({ ...f, faultOn: e.target.value })} />
          <input className="input" placeholder="What is wrong" aria-label="Fault" value={f.fault} onChange={(e) => setF({ ...f, fault: e.target.value })} />
          <ProofPicker site={null} refText="Warranty fault" items={proof} onChange={setProof} required />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || !picked || f.fault.trim().length < 5 || !proof.length}
            onClick={() =>
              act.run(() => api.reportWarrantyFault({ source: picked!.source, itemId: picked!.id, fault: f.fault, faultOn: f.faultOn, proof }), 'Fault reported.').then((r) => {
                if (r !== undefined) {
                  setF({ itemKey: '', fault: '', faultOn: today });
                  setProof([]);
                }
              })
            }
          >
            Report fault
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
      {claims.length === 0 ? <div className="muted small">No warranty claims.</div> : claims.map((c) => <ClaimLine key={c.id} c={c} canCheck={canCheck(c) && c.reportedById !== undefined} results={data.results} />)}
      </div>
    </Card>
  );
}
