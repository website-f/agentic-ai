// Stock and registration (P85): the balance by owner, holder and condition, registering new items with their labels
// printed and scanned back (paper 3.1), and the labels still to print or to scan back.
import { useState } from 'react';
import { PlusIcon, PrinterIcon, TagIcon } from '@phosphor-icons/react';
import { ITEM_CATEGORIES, STATE_LABEL, labelDisplay, type PhysicalItem } from '@prima/core';
import type { ItemBoard } from '../../api';
import { Card, Empty, Toolbar } from '../../kit';
import { Chip, ErrorNotice, useAction } from '../../ui';
import { PrintRun, type PrintResult } from './PrintRun';
import { CAT_LABEL, STATE_TONE, act, any, handles, partyName, rolesOf, skuName } from './shared';

export function Stock({ data }: { data: ItemBoard }) {
  const [party, setParty] = useState('');
  const [cat, setCat] = useState('');
  const [reg, setReg] = useState(false);
  const rows = data.balance.filter((r) => (!party || r.ownerPartyId === party || r.holderPartyId === party) && (!cat || data.skus.find((s) => s.id === r.skuId)?.category === cat));
  const mayRegister = any(data, 'store', 'manager', 'it');
  return (
    <div className="it-stack">
      {mayRegister && (reg ? <RegisterPrint data={data} onClose={() => setReg(false)} /> : null)}
      {mayRegister && !reg && <LabelsToPrint data={data} />}
      <Card
        title="Stock by owner, holder and condition"
        sub="A set counts once, by its parts. Owner and holder are kept apart: a company can hold items another owns."
        actions={
          mayRegister && !reg ? (
            <button className="btn btn-primary" type="button" onClick={() => setReg(true)}>
              <PlusIcon size={16} aria-hidden="true" /> Register items
            </button>
          ) : undefined
        }
        flush
      >
        <div className="it-pad">
          <Toolbar>
            <select className="input" aria-label="Company" value={party} onChange={(e) => setParty(e.target.value)}>
              <option value="">All companies I can see</option>
              {data.parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select className="input" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">All kinds</option>
              {ITEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CAT_LABEL[c]}
                </option>
              ))}
            </select>
          </Toolbar>
        </div>
        {!rows.length ? (
          <Empty title="Nothing here.">Change the company or kind, or register items.</Empty>
        ) : (
          <ul className="it-rows">
            {rows.map((r, k) => (
              <li key={k} className="it-row">
                <span className="it-row-main">
                  <strong>{skuName(data, r.skuId)}</strong>
                  <span className="muted">
                    Owner {partyName(data, r.ownerPartyId)} · held by {partyName(data, r.holderPartyId)}: {r.where}
                  </span>
                </span>
                <span className="it-row-side">
                  <Chip tone={STATE_TONE[r.state] ?? 'neutral'}>{r.state === 'bulk' ? 'By quantity' : STATE_LABEL[r.state as keyof typeof STATE_LABEL]}</Chip>
                  <span className="muted">{r.condition}</span>
                  <span className="it-qty">{r.qty}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Units of the user's stores with no label yet, or a label not yet scanned back. */
function LabelsToPrint({ data }: { data: ItemBoard }) {
  const a = useAction();
  const [run, setRun] = useState<PrintResult | null>(null);
  const todo = data.items.filter((i) => handles(data, i.custody.partyId) && i.state !== 'disposed' && ((i.labelGen ?? 1) === 0 || i.labelVerifiedAt === null));
  if (run) return <PrintRun run={run} onDone={() => setRun(null)} />;
  if (!todo.length) return null;
  const unprinted = todo.filter((i) => (i.labelGen ?? 1) === 0);
  return (
    <Card title={`Labels to print or scan back (${todo.length})`} sub="An item is checked into stock only after its printed label is scanned back.">
      <ul className="it-rows">
        {todo.slice(0, 12).map((i) => (
          <li key={i.id} className="it-row">
            <span className="it-row-main">
              <strong>{skuName(data, i.skuId)}</strong>
              <span className="mono muted">{labelDisplay(i.token)}</span>
            </span>
            <Chip tone="warn">{(i.labelGen ?? 1) === 0 ? 'No label yet' : 'Not scanned back'}</Chip>
          </li>
        ))}
      </ul>
      {todo.length > 12 && <p className="muted small">And {todo.length - 12} more.</p>}
      {unprinted.length > 0 && (
        <button
          className="btn btn-primary it-big"
          type="button"
          disabled={a.busy}
          onClick={() =>
            a.run(async () => {
              const r = (await act({ kind: 'label.print', itemIds: unprinted.slice(0, 200).map((i) => i.id) })) as { result: PrintResult };
              setRun(r.result);
            })
          }
        >
          <PrinterIcon size={18} aria-hidden="true" /> Print {Math.min(200, unprinted.length)} label{unprinted.length === 1 ? '' : 's'}
        </button>
      )}
      <ErrorNotice error={a.error} />
    </Card>
  );
}

/** Register units, print their labels and scan them back, in one place (paper 3.1). Bulk stock is added by quantity. */
function RegisterPrint({ data, onClose }: { data: ItemBoard; onClose: () => void }) {
  const a = useAction();
  const roles = rolesOf(data);
  const parties = data.parties.filter((p) => (roles.get(p.id) ?? []).some((r) => r === 'store' || r === 'manager' || r === 'it'));
  const [partyId, setPartyId] = useState(parties[0]?.id ?? '');
  const [skuId, setSkuId] = useState('');
  const [count, setCount] = useState('1');
  const [serials, setSerials] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [note, setNote] = useState('');
  const [run, setRun] = useState<PrintResult | null>(null);
  const sku = data.skus.find((s) => s.id === skuId);
  if (run) return <PrintRun run={run} onDone={onClose} />;
  const save = () =>
    a.run(
      async () => {
        if (sku!.tracking === 'BULK') return act({ kind: 'lot.add', skuId, partyId, qty: Number(count), note });
        const out = (await act({ kind: 'item.register', skuId, partyId, count: Number(count), serials: serials.trim() ? serials.split(',').map((x) => x.trim()) : undefined, legacyUnverified: legacy, note })) as { result: PhysicalItem[] };
        const printed = (await act({ kind: 'label.print', itemIds: out.result.map((i) => i.id) })) as { result: PrintResult };
        setRun(printed.result);
        return printed;
      },
      sku?.tracking === 'BULK' ? 'Stock added.' : 'Registered. Print the labels, then scan each one back.',
    );
  return (
    <Card
      title="Register items"
      sub="Each unit gets one label for life. Print it, stick it on, scan it back; then check the item into stock."
      actions={
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <div className="it-form">
        <label className="isc-field">
          Company
          <select className="input" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="isc-field">
          Item type
          <select className="input" value={skuId} onChange={(e) => setSkuId(e.target.value)}>
            <option value="">Choose the item type…</option>
            {data.skus
              .filter((s) => s.tracking !== 'KIT')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}: {s.name} ({s.tracking === 'BULK' ? 'by quantity' : 'each unit'})
                </option>
              ))}
          </select>
        </label>
        <label className="isc-field">
          {sku?.tracking === 'BULK' ? 'Quantity' : 'How many units'}
          <input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
        {sku?.tracking === 'SERIALIZED' && (
          <label className="isc-field">
            Maker serials (optional, one per unit, comma separated)
            <input className="input mono" value={serials} onChange={(e) => setSerials(e.target.value)} />
          </label>
        )}
        <label className="isc-field">
          {sku?.tracking === 'BULK' ? 'Order or delivery note' : 'Order, delivery note or source'}
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {sku?.tracking === 'SERIALIZED' && (
          <label className="isc-choice">
            <input type="checkbox" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} /> Opening balance from the old list (not verified)
          </label>
        )}
        <button className="btn btn-primary it-big" type="button" disabled={a.busy || !sku} onClick={() => void save().then((r) => r && sku?.tracking === 'BULK' && onClose())}>
          {sku?.tracking === 'BULK' ? (
            'Add stock'
          ) : (
            <>
              <TagIcon size={18} aria-hidden="true" /> Register and print labels
            </>
          )}
        </button>
        <ErrorNotice error={a.error} />
      </div>
    </Card>
  );
}
