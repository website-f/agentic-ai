import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type PurBoard } from '../api';
import { Select } from '../SearchSelect';
import { Card } from '../kit';
import { Chip, ErrorNotice, dateLabel, useAction } from '../ui';
import { ProofPicker } from './Proof';
import { SitePick } from './SiteSupplies';

/**
 * P121 (Fitri, 21 Nov 2026: returns, damaged or lost items, disposal, Min/Max): the steps Fauzan's rules already allow
 * (docs/SITE_SUPPLIES_REQUESTS.md T4, T9, T11, T12; docs/DISPOSAL_OF_GOODS.md) but that had no form on any screen. Each
 * form calls the existing server action, which checks who may do it again; these screens add no rule of their own.
 */

type URow = {
  issueId: string;
  item: string;
  size: string | null;
  qty: number;
  date: string;
  condition: string | null;
  handedBy: string;
  signed: boolean;
  returned: { on: string; condition: string } | null;
  disposed: string | null;
};
type URecord = { person: { id: string; name: string; staffNo: string }; rows: URow[]; stillHeld: number; note: string };
type Held = { personId: string; name: string; staffNo: string; status: string; held: { issueId: string; itemId: string; qty: number; issuedOn: string }[]; returned: number };

const CONDITION: Record<string, string> = { good: 'Good', worn: 'Worn', damaged: 'Damaged', lost: 'Lost', new: 'New', good_used: 'Good used' };

/**
 * T9 and T11: one guard's uniform record (every piece, signed or not, returned or still held), or every guard of a site
 * with what they still hold. The store may dispose of a returned damaged or worn piece here (T12).
 */
export function UniformRecordCard({ store }: { store?: boolean }) {
  const act = useAction();
  const [staffNo, setStaffNo] = useState('');
  const [siteId, setSiteId] = useState('');
  const [rec, setRec] = useState<URecord | null>(null);
  const [site, setSite] = useState<{ siteName: string | null; rows: Held[] } | null>(null);
  const open = (input: Record<string, unknown>) =>
    act.run(async () => {
      const r = (await api.siteSuppliesAct('uniformRecord', input)) as URecord;
      setRec(r);
      return r;
    });
  const bySite = () =>
    act.run(async () => {
      const r = (await api.siteSuppliesAct('returns', { siteId })) as { siteName: string | null; rows: Held[] };
      setSite(r);
      setRec(null);
      return r;
    });
  return (
    <Card
      title="Uniform record and returns"
      sub="What a guard was given and still holds. At a guard change, exit or contract end, each piece goes back to the store; the store records the return as good, worn, damaged or lost."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" style={{ maxWidth: 200 }} placeholder="Guard's staff number" aria-label="Guard's staff number" value={staffNo} onChange={(e) => setStaffNo(e.target.value)} />
          <button className="btn btn-sm btn-primary" disabled={act.busy || staffNo.trim().length < 2} onClick={() => void open({ staffNo: staffNo.trim() })}>
            Open the record
          </button>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <SitePick value={siteId} onChange={setSiteId} />
          <button className="btn btn-sm" disabled={act.busy || !siteId} onClick={() => void bySite()}>
            Who still holds items at this site
          </button>
        </div>
        <ErrorNotice error={act.error} />
        {site && !rec && (
          <div className="table-wrap">
            {site.rows.length === 0 ? (
              <p className="muted small">Nobody rostered at {site.siteName ?? 'this site'} in the last 60 days still holds a store item.</p>
            ) : (
              <table className="table small">
                <thead>
                  <tr>
                    <th>Guard</th>
                    <th className="num">Pieces held</th>
                    <th>Since</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {site.rows.map((h) => (
                    <tr key={h.personId}>
                      <td>
                        {h.name} <span className="muted">({h.staffNo})</span>
                        {h.status !== 'active' && (
                          <>
                            {' '}
                            <Chip tone="warn">{h.status}</Chip>
                          </>
                        )}
                      </td>
                      <td className="num">{h.held.reduce((n, x) => n + x.qty, 0)}</td>
                      <td>{h.held.map((x) => dateLabel(x.issuedOn)).join(', ')}</td>
                      <td>
                        <button className="btn btn-sm" disabled={act.busy} onClick={() => void open({ personId: h.personId })}>
                          Open the record
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {rec && (
          <>
            <strong>
              {rec.person.name} ({rec.person.staffNo}): {rec.stillHeld} still held
            </strong>
            {rec.rows.length === 0 ? (
              <p className="muted small">Nothing issued from the store on record.</p>
            ) : (
              <div className="table-wrap">
                <table className="table small">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Qty</th>
                      <th>Given</th>
                      <th>Signed</th>
                      <th>Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rec.rows.map((r) => (
                      <tr key={r.issueId}>
                        <td>
                          {r.item}
                          {r.size ? ` (${r.size})` : ''}
                        </td>
                        <td className="num">{r.qty}</td>
                        <td>
                          {dateLabel(r.date)}
                          <div className="muted">{r.handedBy}</div>
                        </td>
                        <td>{r.signed ? <Chip tone="ok">Signed</Chip> : <Chip tone="warn">Not yet</Chip>}</td>
                        <td>
                          {r.disposed ? (
                            `Disposed of ${dateLabel(r.disposed)}`
                          ) : r.returned ? (
                            <>
                              Returned {dateLabel(r.returned.on)}, {CONDITION[r.returned.condition] ?? r.returned.condition}
                              {store && ['damaged', 'worn'].includes(r.returned.condition) && <DisposePiece issueId={r.issueId} />}
                            </>
                          ) : (
                            'Still held'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">{rec.note}</p>
          </>
        )}
      </div>
    </Card>
  );
}

/** T12: a returned damaged or worn piece, disposed of by someone other than the person who recorded the return. */
function DisposePiece({ issueId }: { issueId: string }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [marked, setMarked] = useState(true);
  const [removed, setRemoved] = useState(false);
  const [photo, setPhoto] = useState<ProofInput[]>([]);
  if (!open)
    return (
      <div>
        <button className="btn btn-sm" onClick={() => setOpen(true)}>
          Dispose of it
        </button>
      </div>
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <input className="input" placeholder="Disposal reason" aria-label="Disposal reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      <label className="small">
        <input type="checkbox" checked={marked} onChange={(e) => setMarked(e.target.checked)} /> It has company marks (logo, name tag, beret badge)
      </label>
      {marked && (
        <>
          <label className="small">
            <input type="checkbox" checked={removed} onChange={(e) => setRemoved(e.target.checked)} /> Marks removed
          </label>
          <ProofPicker site={null} refText="Marks removed" items={photo} onChange={setPhoto} required />
        </>
      )}
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy || reason.trim().length < 3 || (marked && (!removed || !photo.length))}
        onClick={() => void act.run(() => api.siteSuppliesAct('dispose', { issueId, reason, marked, marksRemoved: removed, photo }), 'Disposed of.').then((r) => r && setOpen(false))}
      >
        Record the disposal
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

const DISPOSAL_REASONS: [string, string][] = [
  ['damaged', 'Damaged'],
  ['worn_obsolete', 'Worn or out of date'],
  ['unsafe', 'Unsafe'],
  ['not_worth_repairing', 'Not worth repairing'],
  ['not_needed', 'Not needed'],
  ['unsuitable', 'Unsuitable'],
  ['past_life', 'Past its useful life'],
  ['surplus', 'Surplus'],
  ['contract_ended', 'Contract ended'],
  ['not_for_new_contract', 'Not for the new contract'],
];

/**
 * DISPOSAL_OF_GOODS step 1 for site items: the OM covering the site asks; Procurement reviews (never the requester),
 * the OGM approves at RM1,000 or more, sensitive items or a sale, and the case runs on Procurement > Store.
 */
export function SiteDisposalAsk() {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const blank = { siteId: '', name: '', qty: '1', reason: '', condition: '', location: '' };
  const [f, setF] = useState(blank);
  const [photo, setPhoto] = useState<ProofInput[]>([]);
  const needPhoto = f.reason === 'damaged' || f.reason === 'unsafe';
  const ready = f.siteId && f.name.trim() && Number(f.qty) > 0 && f.reason && f.condition.trim() && (!needPhoto || photo.length > 0);
  return (
    <Card title="Ask to dispose of site items" sub="Damaged, unsafe or unneeded kit at a site you cover. Procurement reviews it; the OGM approves big or sensitive cases.">
      {!open ? (
        <button className="btn btn-sm" onClick={() => setOpen(true)}>
          Start a disposal request
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SitePick value={f.siteId} onChange={(siteId) => setF({ ...f, siteId })} />
          <input className="input" placeholder="Item (for example: plastic chair)" aria-label="Item" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="input" style={{ maxWidth: 120 }} inputMode="numeric" placeholder="Quantity" aria-label="Quantity" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          <Select className="select" aria-label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            <option value="">Reason…</option>
            {DISPOSAL_REASONS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <input className="input" placeholder="Condition now" aria-label="Condition now" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} />
          <input className="input" placeholder="Where it is (leave empty for the site)" aria-label="Where it is" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
          <ProofPicker site={null} refText="Disposal photo" items={photo} onChange={setPhoto} required={needPhoto} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || !ready}
              onClick={() =>
                void act
                  .run(
                    () =>
                      api.inventoryAct('disposalRequest', {
                        siteId: f.siteId,
                        lines: [{ name: f.name.trim(), qty: Number(f.qty), reason: f.reason, condition: f.condition.trim(), location: f.location.trim(), photo }],
                      }),
                    'Sent to Procurement for review.',
                  )
                  .then((r) => {
                    if (r !== undefined) {
                      setF(blank);
                      setPhoto([]);
                      setOpen(false);
                    }
                  })
              }
            >
              Send the request
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </Card>
  );
}

type Supply = { id: string; name: string; unit: string; onHand: number | null; min: number | null; max: number | null };

/** T4: the OM proposes a site's Min and Max for a cleaning supply from real usage; the OGM approves it on the store queue. */
export function SiteMinMaxAsk() {
  const act = useAction();
  const [siteId, setSiteId] = useState('');
  const [supplies, setSupplies] = useState<Supply[] | null>(null);
  const [f, setF] = useState({ supplyId: '', min: '', max: '', reason: '' });
  const load = (id: string) => {
    setSiteId(id);
    setSupplies(null);
    if (id) void act.run(async () => setSupplies(((await api.siteSuppliesAct('options', { siteId: id })) as { supplies: Supply[] }).supplies));
  };
  const sup = supplies?.find((s) => s.id === f.supplyId);
  return (
    <Card title="Site Min and Max" sub="Propose the least and most a site should hold of a cleaning supply, from real usage. The OGM approves it.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <SitePick value={siteId} onChange={load} />
        {supplies && supplies.length === 0 && <p className="muted small">This site has no cleaning supplies set up.</p>}
        {supplies && supplies.length > 0 && (
          <>
            <Select className="select" aria-label="Supply" value={f.supplyId} onChange={(e) => setF({ ...f, supplyId: e.target.value })}>
              <option value="">Supply…</option>
              {supplies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (now Min {s.min ?? 'not set'}, Max {s.max ?? 'not set'})
                </option>
              ))}
            </Select>
            {sup && (
              <>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <input className="input" style={{ maxWidth: 120 }} inputMode="numeric" placeholder={`Min (${sup.unit})`} aria-label="Min" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
                  <input className="input" style={{ maxWidth: 120 }} inputMode="numeric" placeholder={`Max (${sup.unit})`} aria-label="Max" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
                </div>
                <input className="input" placeholder="How you set it (real usage)" aria-label="How you set it" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || f.reason.trim().length < 3 || (f.min === '' && f.max === '')}
                  onClick={() =>
                    void act
                      .run(() => api.siteSuppliesAct('siteMinMax', { siteId, supplyId: f.supplyId, min: f.min, max: f.max, reason: f.reason.trim() }), 'Sent to the OGM.')
                      .then((r) => r !== undefined && setF({ supplyId: '', min: '', max: '', reason: '' }))
                  }
                >
                  Send to the OGM
                </button>
              </>
            )}
          </>
        )}
        <ErrorNotice error={act.error} />
      </div>
    </Card>
  );
}

/** T4: the Procurement executive sets the store's Min (reorder level) and Max per item, with how it was set. */
export function StoreMinMax({ data }: { data: PurBoard }) {
  const act = useAction();
  const [f, setF] = useState({ itemId: '', min: '', max: '', reason: '' });
  const items = data.stock;
  const it = items.find((s) => s.item.id === f.itemId)?.item;
  return (
    <Card title="Store Min and Max" sub="The Procurement executive sets each item's reorder level (Min) and most to hold (Max), from real usage. Every change is kept.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Select
          className="select"
          aria-label="Store item"
          value={f.itemId}
          onChange={(e) => {
            const x = items.find((s) => s.item.id === e.target.value)?.item;
            setF({ itemId: e.target.value, min: x ? String(x.reorderAt) : '', max: x?.maxAt != null ? String(x.maxAt) : '', reason: '' });
          }}
        >
          <option value="">Store item…</option>
          {items.map((s) => (
            <option key={s.item.id} value={s.item.id}>
              {s.item.name}
              {s.item.size ? ` ${s.item.size}` : ''} · {s.companyName}
            </option>
          ))}
        </Select>
        {it && (
          <>
            <p className="muted small">
              In store {it.onHand}. Max {it.maxAt != null ? it.maxAt : 'not set'}.
            </p>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input className="input" style={{ maxWidth: 120 }} inputMode="numeric" placeholder="Min" aria-label="Min" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
              <input className="input" style={{ maxWidth: 120 }} inputMode="numeric" placeholder="Max (empty: not set)" aria-label="Max" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
            </div>
            <input className="input" placeholder="How you set it (for example: 3 months of real usage)" aria-label="How you set it" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || f.min === '' || f.reason.trim().length < 3}
              onClick={() => void act.run(() => api.siteSuppliesAct('storeMinMax', { stockItemId: f.itemId, min: f.min, max: f.max === '' ? null : f.max, reason: f.reason.trim() }), 'Min and Max saved.')}
            >
              Save Min and Max
            </button>
          </>
        )}
        <ErrorNotice error={act.error} />
      </div>
    </Card>
  );
}
