// Stock and registration (P85): the balance by owner, holder and condition, registering new items with their labels
// printed and scanned back (paper 3.1), and the labels still to print or to scan back.
import { Select } from '../../SearchSelect';
import { useState } from 'react';
import { PlusIcon, PrinterIcon, TagIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { ITEM_CATEGORIES, STATE_LABEL, labelDisplay, type PhysicalItem } from '@prima/core';
import type { ItemBoard } from '../../api';
import { Card, Empty, Search, Toolbar } from '../../kit';
import { Chip, ErrorNotice, useAction } from '../../ui';
import { PrintRun, type PrintResult } from './PrintRun';
import { ItemImport, addParties, mayRegister as mayRegisterOf } from './AddMenu';
import { CAT_LABEL, STATE_TONE, act, handles, partyName, skuName } from './shared';

export function Stock({ data, onImport, onType }: { data: ItemBoard; onImport?: () => void; onType?: (skuId: string) => void }) {
  const [party, setParty] = useState('');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [reg, setReg] = useState(false);
  const [shown, setShown] = useState(100);
  const skuOf = new Map(data.skus.map((s) => [s.id, s]));
  const rows = data.balance.filter((r) => {
    const s = skuOf.get(r.skuId);
    if (party && r.ownerPartyId !== party && r.holderPartyId !== party) return false;
    if (cat && s?.category !== cat) return false;
    if (!q) return true;
    const t = q.toUpperCase();
    return !!s && (s.name.toUpperCase().includes(t) || s.code.includes(t) || (s.group ?? '').toUpperCase().includes(t));
  });
  const mayRegister = mayRegisterOf(data);
  return (
    <div className="it-stack">
      {mayRegister && !reg && (
        <div className="it-tabbar-add">
          <button className="btn btn-primary" type="button" onClick={() => setReg(true)}>
            <PlusIcon size={16} weight="bold" aria-hidden="true" /> Register items or add stock
          </button>
          {onImport && (
            <button className="btn" type="button" onClick={onImport}>
              <UploadSimpleIcon size={16} weight="bold" aria-hidden="true" /> Import stock list (Excel, CSV, PDF)
            </button>
          )}
          <ItemImport data={data} kinds={['itemUnit']} label="Import units with labels" />
        </div>
      )}
      {mayRegister && (reg ? <RegisterPrint data={data} onClose={() => setReg(false)} /> : null)}
      {mayRegister && !reg && <LabelsToPrint data={data} />}
      <Card
        title="Stock by owner, holder and condition"
        sub="A set counts once, by its parts. Owner and holder are kept apart: a company can hold items another owns."
        flush
      >
        <div className="it-pad">
          <Toolbar>
            <Search value={q} onChange={(v) => (setQ(v), setShown(100))} placeholder="Search item, code or group" />
            <Select className="input" aria-label="Company" value={party} onChange={(e) => setParty(e.target.value)}>
              <option value="">All companies I can see</option>
              {data.parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select className="input" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">All kinds</option>
              {ITEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CAT_LABEL[c]}
                </option>
              ))}
            </Select>
          </Toolbar>
        </div>
        {!rows.length ? (
          <Empty
            title={data.balance.length ? 'Nothing matches.' : 'No stock yet.'}
            action={
              !data.balance.length && onImport ? (
                <button className="btn btn-primary" type="button" onClick={onImport}>
                  <UploadSimpleIcon size={16} aria-hidden="true" /> Import the stock balance
                </button>
              ) : undefined
            }
          >
            {data.balance.length ? 'Change the search, company or kind.' : "Import the old system's stock balance or stock card, or register items and add stock."}
          </Empty>
        ) : (
          <ul className="it-rows">
            {rows.slice(0, shown).map((r, k) => (
              <li key={k} className="it-row">
                <span className="it-row-main">
                  {onType ? (
                    <button type="button" className="it-link" onClick={() => onType(r.skuId)}>
                      {skuName(data, r.skuId)}
                    </button>
                  ) : (
                    <strong>{skuName(data, r.skuId)}</strong>
                  )}
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
        {rows.length > shown && (
          <div className="it-pad">
            <button className="btn" type="button" onClick={() => setShown(shown + 300)}>
              Show more (<span>{rows.length - shown}</span> more)
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Units of the user's stores with no label yet, or a label not yet scanned back. `always`: say so when there are none. */
export function LabelsToPrint({ data, always = false }: { data: ItemBoard; always?: boolean }) {
  const a = useAction();
  const [run, setRun] = useState<PrintResult | null>(null);
  const todo = data.items.filter((i) => (handles(data, i.custody.partyId) || !!data.addRights?.parties.includes(i.custody.partyId)) && i.state !== 'disposed' && ((i.labelGen ?? 1) === 0 || i.labelVerifiedAt === null));
  if (run) return <PrintRun run={run} onDone={() => setRun(null)} />;
  if (!todo.length)
    return always ? (
      <Card title="Unit labels" sub="Units tracked one by one get a P1- label for life: print it, stick it on, scan it back.">
        <p className="muted">No unit labels to print or scan back.</p>
      </Card>
    ) : null;
  const unprinted = todo.filter((i) => (i.labelGen ?? 1) === 0);
  return (
    <Card title={`Labels to print or scan back (${todo.length})`} sub="An item is checked into stock only after its printed label is scanned back.">
      <ul className="it-rows">
        {todo.slice(0, 12).map((i) => (
          <li key={i.id} className="it-row">
            <span className="it-row-main">
              <strong>{skuName(data, i.skuId)}</strong>
              <span className="mono muted">{labelDisplay(i.token)}</span>
              {(i.legacyRef || i.legacyFrom) && <span className="muted small">{oldRecordLine(i)}</span>}
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

/** P91: what the old system said about a unit registered from it, as one line for the store labelling it. */
export function oldRecordLine(i: PhysicalItem) {
  const f = i.legacyFrom;
  return [i.legacyRef ? `Old tag ${i.legacyRef}` : '', f?.where ? `was at ${f.where}` : '', f?.holder ? `held by ${f.holder} (old record)` : '', f?.condition ? `condition ${f.condition}` : ''].filter(Boolean).join(' · ');
}

/**
 * Register units, print their labels and scan them back, in one place (paper 3.1). Bulk stock is added by quantity.
 * P91: opened from the Add menu at the top of the Items screen too, and from the scanner with an old code it does not
 * know (that code is kept as the unit's old tag).
 */
export function RegisterPrint({ data, onClose, legacyRef: scanned = '' }: { data: ItemBoard; onClose: () => void; legacyRef?: string }) {
  const a = useAction();
  // P98: the companies the server lets this person add for (the owner: every company).
  const parties = addParties(data).map(([id, name]) => ({ id, name }));
  const [partyId, setPartyId] = useState(parties[0]?.id ?? '');
  const [skuId, setSkuId] = useState('');
  const [count, setCount] = useState('1');
  const [serials, setSerials] = useState('');
  const [legacy, setLegacy] = useState(!!scanned);
  const [note, setNote] = useState('');
  const [oldTag, setOldTag] = useState(scanned);
  const [run, setRun] = useState<PrintResult | null>(null);
  const sku = data.skus.find((s) => s.id === skuId);
  if (run) return <PrintRun run={run} onDone={onClose} />;
  const save = () =>
    a.run(
      async () => {
        if (sku!.tracking === 'BULK') return act({ kind: 'lot.add', skuId, partyId, qty: Number(count), note });
        const out = (await act({ kind: 'item.register', skuId, partyId, count: Number(count), serials: serials.trim() ? serials.split(',').map((x) => x.trim()) : undefined, legacyUnverified: legacy, note, ...(oldTag.trim() ? { legacyRef: oldTag.trim() } : {}) })) as { result: PhysicalItem[] };
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
          <Select className="input" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="isc-field">
          Item type
          <Select className="input" value={skuId} onChange={(e) => setSkuId(e.target.value)} searchable>
            <option value="">Choose the item type…</option>
            {data.skus
              .filter((s) => s.tracking !== 'KIT')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}: {s.name} ({s.tracking === 'BULK' ? 'by quantity' : 'each unit'})
                </option>
              ))}
          </Select>
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
        {sku?.tracking !== 'BULK' && (
          <label className="isc-field">
            Old tag or ID from the old system (optional, one unit)
            <input className="input mono" value={oldTag} onChange={(e) => setOldTag(e.target.value)} />
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
