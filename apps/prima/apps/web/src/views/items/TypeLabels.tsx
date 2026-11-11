// P98 (Fitri, 11 Nov 2026: "form a QR code to scan automatically based on the code"): every item type has its own QR
// code and Code 128 barcode, made from its Prima code (PT- and the code), so it never changes while the code stays. They
// go on shelves, bins and boxes of stock counted by quantity; scanning one opens the item type. A unit tracked one by one
// still gets its own P1- label for life, printed and scanned back as before.
import { useMemo, useState } from 'react';
import { PrinterIcon } from '@phosphor-icons/react';
import { STATE_LABEL, labelDisplay, typeLabelPayload, type ItemSku } from '@prima/core';
import type { ItemBoard } from '../../api';
import { Card, Facts, Search, Toolbar } from '../../kit';
import { Select } from '../../SearchSelect';
import { Chip, Drawer } from '../../ui';
import { LabelSheet, type PrintLabel } from './LabelSheet';
import { barcodeSvg, qrSvg } from './labels';
import { CAT_LABEL, STATE_TONE, partyName } from './shared';

/** The label of one item type, as the sheet prints it. */
export function typeLabel(s: Pick<ItemSku, 'id' | 'code' | 'name' | 'size'>, copy = 0): PrintLabel {
  return { printId: `${s.id}-${copy}`, payload: typeLabelPayload(s.code), display: s.code, sku: s.name.slice(0, 40), size: s.size, gen: 1 };
}

/** The QR code (and the barcode under it) of one item type, on screen. */
export function TypeCodes({ sku, barcode = true }: { sku: Pick<ItemSku, 'code'>; barcode?: boolean }) {
  const payload = typeLabelPayload(sku.code);
  const qr = useMemo(() => qrSvg(payload), [payload]);
  const bar = useMemo(() => (barcode ? barcodeSvg(payload) : ''), [payload, barcode]);
  return (
    <div className="it-type-codes">
      <div className="it-type-qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label={`QR code ${payload}`} />
      {barcode && <div className="it-type-bar" dangerouslySetInnerHTML={{ __html: bar }} aria-label={`Barcode ${payload}`} />}
      <span className="mono small">{payload}</span>
    </div>
  );
}

/** Print the QR labels of several item types, with how many copies of each. */
export function TypeLabelPrint({ skuIds, data, onClose }: { skuIds: string[]; data: ItemBoard; onClose: () => void }) {
  const [copies, setCopies] = useState(1);
  const skus = data.skus.filter((s) => skuIds.includes(s.id));
  const labels = skus.flatMap((s) => Array.from({ length: copies }, (_, k) => typeLabel(s, k)));
  return (
    <Drawer title="Print QR labels" sub={`${skus.length} item types`} onClose={onClose}>
      {!skus.length ? (
        <p className="muted">These item types are not on the screen yet. Close and open the Items screen again, then print them from Item types.</p>
      ) : (
        <>
          <label className="isc-field">
            Copies of each label
            <input className="input" type="number" min={1} max={50} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          </label>
          <LabelSheet labels={labels} template="a4_l7160_21" symbols={['qr', 'code128']} scanBack={false} />
        </>
      )}
    </Drawer>
  );
}

/** One item type: what it is, the old system's units and prices, its stock and units, and its QR code. */
export function TypeCard({ data, skuId, onClose, onPrint }: { data: ItemBoard; skuId: string; onClose: () => void; onPrint: (ids: string[]) => void }) {
  const s = data.skus.find((x) => x.id === skuId);
  if (!s)
    return (
      <Drawer title="Item type" onClose={onClose}>
        <p className="muted">This item type is not on the screen. Reload the Items screen.</p>
      </Drawer>
    );
  const stock = data.balance.filter((b) => b.skuId === s.id);
  const units = data.items.filter((i) => i.skuId === s.id);
  const money = data.seesMoney !== false;
  const legacy = s.legacy;
  return (
    <Drawer title={s.name} sub={s.code} onClose={onClose}>
      <div className="it-type-head">
        <TypeCodes sku={s} />
        <button className="btn btn-primary it-big" type="button" onClick={() => onPrint([s.id])}>
          <PrinterIcon size={18} aria-hidden="true" /> Print its QR label
        </button>
      </div>
      <Facts
        items={[
          ['Category', CAT_LABEL[s.category]],
          ['Tracked', s.tracking === 'BULK' ? (s.consumable ? 'By quantity, used up' : 'By quantity') : s.tracking === 'KIT' ? 'As a set' : 'Each unit has its own label'],
          ['Unit', s.uomLabel ? `${s.uomLabel} (as ${s.uom})` : s.uom],
          ...(s.group ? ([['Stock group', s.group]] as [string, string][]) : []),
          ...(s.sourceCode ? ([['Old system code', s.sourceCode]] as [string, string][]) : []),
          ...(s.size ? ([['Size', s.size]] as [string, string][]) : []),
        ]}
      />
      {!!s.units?.length && (
        <section>
          <h3 className="it-h3">Units in the old system</h3>
          <ul className="it-rows it-rows-tight">
            {s.units.map((u, k) => (
              <li key={k} className="it-row">
                <span className="it-row-main">
                  <strong>{u.uom}</strong>
                  {u.rate && u.rate !== 1 ? <span className="muted small">{u.rate} base units</span> : null}
                </span>
                {money && (
                  <span className="it-row-side small">
                    <span>Cost {u.cost ?? '-'}</span>
                    <span>Price {u.price ?? '-'}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {money && s.lastCost && (
            <p className="muted small">
              Last supplier cost {s.lastCost.cost}
              {s.lastCost.uom ? ` per ${s.lastCost.uom}` : ''}
              {s.lastCost.supplier ? ` (${s.lastCost.supplier})` : ''}
            </p>
          )}
        </section>
      )}
      <section>
        <h3 className="it-h3">Stock</h3>
        {!stock.length ? (
          <p className="muted small">No stock of this item in Prima yet.</p>
        ) : (
          <ul className="it-rows it-rows-tight">
            {stock.map((b, k) => (
              <li key={k} className="it-row">
                <span className="it-row-main">
                  <strong>{partyName(data, b.ownerPartyId)}</strong>
                  <span className="muted small">{b.where}</span>
                </span>
                <span className="it-row-side">
                  <Chip tone={STATE_TONE[b.state] ?? 'neutral'}>{b.state === 'bulk' ? 'By quantity' : STATE_LABEL[b.state as keyof typeof STATE_LABEL]}</Chip>
                  <span className="it-qty">{b.qty}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {legacy && (
          <p className="muted small">
            Old system: {legacy.qty ?? '-'}
            {legacy.qtyAsOf ? ` as at ${legacy.qtyAsOf}` : ''}
            {legacy.card ? `; stock card ${legacy.card.from ?? ''} to ${legacy.card.to ?? ''}: opening ${legacy.card.opening ?? '-'}, in ${legacy.card.in}, out ${legacy.card.out}, closing ${legacy.card.balance ?? '-'} (${legacy.card.lines} lines)` : ''}
            {legacy.stocked ? `. Opening stock ${legacy.stocked.qty} recorded for ${partyName(data, legacy.stocked.partyId)}.` : '. No opening stock recorded from it.'}
          </p>
        )}
      </section>
      {units.length > 0 && (
        <section>
          <h3 className="it-h3">
            Units with their own label (<span>{units.length}</span>)
          </h3>
          <ul className="it-rows it-rows-tight">
            {units.slice(0, 20).map((i) => (
              <li key={i.id} className="it-row">
                <span className="mono small">{labelDisplay(i.token)}</span>
                <Chip tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</Chip>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Drawer>
  );
}

/** The Labels tab: choose item types (search, a category or a stock group, or all shown) and print their QR labels. */
export function TypeLabelsPicker({ data }: { data: ItemBoard }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [print, setPrint] = useState(false);
  const groups = [...new Set(data.skus.map((s) => s.group).filter((g): g is string => !!g))].sort();
  const list = data.skus.filter((s) => (!group || s.group === group) && (!q || s.name.toUpperCase().includes(q.toUpperCase()) || s.code.includes(q.toUpperCase())));
  return (
    <Card title="QR labels for item types" sub="Each item type's own QR code and barcode, made from its code, for shelves, bins and boxes. Scanning one opens the item type.">
      {!data.skus.length ? (
        <p className="muted">No item types yet: add or import them first.</p>
      ) : (
        <div className="it-stack">
          <Toolbar>
            <Search value={q} onChange={setQ} placeholder="Search item types" />
            {groups.length > 0 && (
              <Select className="input" aria-label="Stock group" value={group} onChange={(e) => setGroup(e.target.value)} searchable>
                <option value="">All stock groups</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            )}
          </Toolbar>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => setSel(new Set([...sel, ...list.map((s) => s.id)]))}>
              Tick all shown (<span>{list.length}</span>)
            </button>
            <button className="btn btn-ghost" type="button" disabled={!sel.size} onClick={() => setSel(new Set())}>
              Clear
            </button>
            <button className="btn btn-primary" type="button" disabled={!sel.size} onClick={() => setPrint(true)}>
              <PrinterIcon size={16} aria-hidden="true" /> Print <span>{sel.size}</span> QR labels
            </button>
          </div>
          <ul className="it-rows it-rows-tight it-pick">
            {list.slice(0, 120).map((s) => (
              <li key={s.id}>
                <label className="it-check it-pick-row">
                  <input
                    type="checkbox"
                    checked={sel.has(s.id)}
                    onChange={(e) =>
                      setSel((cur) => {
                        const n = new Set(cur);
                        if (e.target.checked) n.add(s.id);
                        else n.delete(s.id);
                        return n;
                      })
                    }
                  />
                  <span className="it-row-main">
                    <strong>{s.name}</strong>
                    <span className="mono small muted">{typeLabelPayload(s.code)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {list.length > 120 && <p className="muted small">Search or choose a group to see the rest; Tick all shown ticks every item that matches.</p>}
        </div>
      )}
      {print && <TypeLabelPrint data={data} skuIds={[...sel]} onClose={() => setPrint(false)} />}
    </Card>
  );
}
