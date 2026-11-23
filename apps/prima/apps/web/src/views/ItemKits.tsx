import { useState } from 'react';
import { api } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';

/**
 * Sets and parts (Fauzan, 23 Nov 2026). The Inventory Manager breaks a set (for example a guard uniform) into its parts:
 * epaulettes, badges, trousers, shoes, belt. Each part is its own store item with its own stock, so a guard who needs
 * only trousers is asked for that part alone, and asking for a whole set asks for every part. A set holds no stock.
 * The server checks every rule again; this screen only offers the steps.
 */

type Part = { stockItemId: string; name: string; kind: string | null; qty: number; onHand: number };
type Kit = { id: string; companyId: string; sku: string; name: string; parts: Part[]; setsInStore: number; history: { at: string; by: string; note: string }[] };
type Kits = { canEdit: boolean; kits: Kit[]; items: { id: string; name: string; kind: string; onHand: number }[] };

const KINDS: [string, string][] = [
  ['UNIFORM', 'Uniform'],
  ['EQUIPMENT', 'Guard equipment'],
  ['DEVICE', 'Device'],
  ['PATROL_DEVICE', 'Patrol device or NFC token'],
  ['CLEANING', 'Cleaning equipment or product'],
];

export function KitsPanel({ storeId = 'goodwill' }: { storeId?: string }) {
  const { data, error } = useLoad(() => api.inventoryAct('kits', { storeId }) as Promise<Kits>, [storeId]);
  const [making, setMaking] = useState(false);
  if (error) return null;
  if (!data) return <Loading what="sets and parts" />;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Sets and parts</h3>
        {data.canEdit && !making && (
          <button className="btn btn-sm" onClick={() => setMaking(true)}>
            Make an item a set
          </button>
        )}
      </div>
      <p className="muted small">
        A set (for example a guard uniform) lists its parts. Each part is its own store item with its own stock, so a guard who needs only trousers is asked for the trousers alone. Asking for one set asks for every part. A set holds no stock of its own. To add a new set, first add it as a store item with no opening stock, then make it a set here.
      </p>
      {making && <MakeSet data={data} onDone={() => setMaking(false)} />}
      {data.kits.length === 0 && <p className="muted small">No sets yet.</p>}
      <div className="list">
        {data.kits.map((k) => (
          <KitRow key={k.id} kit={k} data={data} />
        ))}
      </div>
    </section>
  );
}

function KitRow({ kit, data }: { kit: Kit; data: Kits }) {
  const [edit, setEdit] = useState<'parts' | 'add' | null>(null);
  return (
    <div className="item">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <strong>{kit.name}</strong> <span className="muted small">{kit.sku}</span>{' '}
          <Chip tone={kit.setsInStore > 0 ? 'ok' : 'warn'}>{kit.setsInStore} whole sets in store</Chip>
        </div>
        {data.canEdit && (
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-sm" onClick={() => setEdit(edit === 'add' ? null : 'add')}>
              Add a new part
            </button>
            <button className="btn btn-sm" onClick={() => setEdit(edit === 'parts' ? null : 'parts')}>
              Change parts
            </button>
          </div>
        )}
      </div>
      <table className="table small" style={{ marginTop: 6 }}>
        <thead>
          <tr>
            <th>Part</th>
            <th className="num">In one set</th>
            <th className="num">In store</th>
          </tr>
        </thead>
        <tbody>
          {kit.parts.map((p) => (
            <tr key={p.stockItemId}>
              <td>{p.name}</td>
              <td className="num">{p.qty}</td>
              <td className="num">
                {p.onHand}
                {p.onHand < p.qty && (
                  <>
                    {' '}
                    <Chip tone="warn">Short</Chip>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {kit.history.length > 0 && <div className="muted small">Last change: {dateLabel(kit.history.at(-1)!.at.slice(0, 10))}, {kit.history.at(-1)!.by}: {kit.history.at(-1)!.note}</div>}
      {edit === 'add' && <AddPart kit={kit} onDone={() => setEdit(null)} />}
      {edit === 'parts' && <EditParts kitId={kit.id} start={kit.parts.map((p) => ({ stockItemId: p.stockItemId, qty: String(p.qty) }))} data={data} onDone={() => setEdit(null)} />}
    </div>
  );
}

function AddPart({ kit, onDone }: { kit: Kit; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ name: '', sku: '', size: '', kind: 'UNIFORM', qty: '1', reorderAt: '0' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <strong>New part for {kit.name}</strong>
      <span className="muted small">The part starts with no stock. Stock comes in through goods received, or a storekeeper's witnessed opening count.</span>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input className="input" aria-label="Part name" placeholder="Part (for example Epaulette, Badge, Trousers)" value={f.name} onChange={(e) => set({ name: e.target.value })} />
        <input className="input" style={{ width: 120 }} aria-label="Item code" placeholder="Item code" value={f.sku} onChange={(e) => set({ sku: e.target.value })} />
        <input className="input" style={{ width: 80 }} aria-label="Size" placeholder="Size" value={f.size} onChange={(e) => set({ size: e.target.value })} />
        <select className="select" aria-label="Kind" value={f.kind} onChange={(e) => set({ kind: e.target.value })}>
          {KINDS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <label className="small">
          In one set <input className="input" style={{ width: 60 }} aria-label="In one set" value={f.qty} onChange={(e) => set({ qty: e.target.value })} />
        </label>
        <label className="small">
          Reorder at <input className="input" style={{ width: 70 }} aria-label="Reorder at" value={f.reorderAt} onChange={(e) => set({ reorderAt: e.target.value })} />
        </label>
      </div>
      <span className="muted small">Everything a guard wears counts toward the yearly uniform allowance, item by item (shirts, trousers, badges, shoes and so on, each on its own).</span>
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-sm"
          disabled={act.busy}
          onClick={() => act.run(() => api.inventoryAct('kitAddPart', { kitId: kit.id, ...f, qty: Number(f.qty), reorderAt: Number(f.reorderAt) }), 'Part added.').then((x) => x && onDone())}
        >
          Add part
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Close
        </button>
      </div>
    </div>
  );
}

function EditParts({ kitId, start, data, onDone }: { kitId: string; start: { stockItemId: string; qty: string }[]; data: Kits; onDone: () => void }) {
  const act = useAction();
  const [parts, setParts] = useState(start.length ? start : [{ stockItemId: '', qty: '1' }]);
  const [reason, setReason] = useState('');
  const upd = (k: number, p: Partial<(typeof parts)[number]>) => setParts(parts.map((x, i) => (i === k ? { ...x, ...p } : x)));
  const choices = data.items.filter((it) => it.id !== kitId);
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <strong>Parts</strong>
      {parts.map((p, k) => (
        <div key={k} className="row small" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="select" aria-label={`Part ${k + 1}`} value={p.stockItemId} onChange={(e) => upd(k, { stockItemId: e.target.value })}>
            <option value="">Choose a store item</option>
            {choices.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name} · in store {it.onHand}
              </option>
            ))}
          </select>
          <input className="input" style={{ width: 60 }} aria-label={`Part ${k + 1} in one set`} value={p.qty} onChange={(e) => upd(k, { qty: e.target.value })} />
          <button className="btn btn-sm" onClick={() => setParts(parts.filter((_, i) => i !== k))}>
            Remove
          </button>
        </div>
      ))}
      <button className="btn btn-sm" onClick={() => setParts([...parts, { stockItemId: '', qty: '1' }])}>
        Add a line
      </button>
      <input className="input" aria-label="Reason" placeholder="Why the set changes" value={reason} onChange={(e) => setReason(e.target.value)} />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-sm"
          disabled={act.busy}
          onClick={() =>
            act
              .run(() => api.inventoryAct('kitParts', { itemId: kitId, reason, parts: parts.filter((x) => x.stockItemId).map((x) => ({ stockItemId: x.stockItemId, qty: Number(x.qty) })) }), 'Set saved.')
              .then((x) => x && onDone())
          }
        >
          Save set
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Close
        </button>
      </div>
    </div>
  );
}

function MakeSet({ data, onDone }: { data: Kits; onDone: () => void }) {
  const [itemId, setItemId] = useState('');
  const empty = data.items.filter((it) => it.onHand === 0);
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label className="small">
        Item that becomes the set{' '}
        <select className="select" aria-label="Item that becomes the set" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Choose (items with no stock)</option>
          {empty.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name}
            </option>
          ))}
        </select>
      </label>
      {itemId ? <EditParts kitId={itemId} start={[]} data={data} onDone={onDone} /> : <button className="btn btn-sm" onClick={onDone}>Close</button>}
    </div>
  );
}
