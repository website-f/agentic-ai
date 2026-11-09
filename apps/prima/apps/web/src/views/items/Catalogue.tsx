import { Select } from '../../SearchSelect';
import { useMemo, useState } from 'react';
import { ITEM_CATEGORIES, SALE_PAPER_LABEL, STATE_LABEL, TAG_METHODS, TAG_METHOD_LABEL, labelDisplay, type BaseUom, type ItemCategory, type SalePaperKind, type TagMethod, type TrackingMode } from '@prima/core';
import { api, type ItemBoard } from '../../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../../ui';
import { act, CAT_LABEL, partyName, readFile, rolesOf, skuName, STATE_TONE } from './shared';
import { CareSettings } from './Care';
import { PlusIcon } from '@phosphor-icons/react';
import { Card } from '../../kit';
import { ItemImport, mayAddTypes } from './AddMenu';

// Item types (SKU catalogue) and each company's tagging choice.
// Moved unchanged from views/Items.tsx in the P85 split; laid out by the item register styles (styles/items.css).

// ---------- Catalogue ----------

/**
 * P91: a new item type, the same form wherever it opens (the Add menu at the top of the Items screen, or the top of the
 * Item types tab). The server's sku.add checks who may add and refuses firearms.
 */
export function SkuForm({ onDone }: { onDone: () => void }) {
  const a = useAction();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ItemCategory>('uniform');
  const [tracking, setTracking] = useState<TrackingMode>('SERIALIZED');
  const [uom, setUom] = useState<BaseUom>('PCS');
  const [size, setSize] = useState('');
  const [consumable, setConsumable] = useState(false);
  return (
        <div className="it-form">
          <input className="input" placeholder="Code, e.g. SHIRT-NAVY-L" value={code} onChange={(e) => setCode(e.target.value)} />
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Select className="input" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as ItemCategory)}>
            {ITEM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CAT_LABEL[c]}
              </option>
            ))}
          </Select>
          <select className="input" aria-label="Tracking" value={tracking} onChange={(e) => setTracking(e.target.value as TrackingMode)}>
            <option value="SERIALIZED">Each unit has its own label</option>
            <option value="BULK">Counted by quantity</option>
          </select>
          <Select className="input" aria-label="Unit" value={uom} onChange={(e) => setUom(e.target.value as BaseUom)}>
            {['PCS', 'PAIR', 'SET', 'BOX', 'BOTTLE', 'LITRE', 'ROLL'].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Select>
          <input className="input" placeholder="Size (optional)" value={size} onChange={(e) => setSize(e.target.value)} />
          {tracking === 'BULK' && (
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={consumable} onChange={(e) => setConsumable(e.target.checked)} /> Used up (not expected back)
            </label>
          )}
          <button className="btn btn-primary it-big" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'sku.add', code, name, category, tracking, uom, size, consumable }), 'Item type added.').then((r) => r && onDone())}>
            Save
          </button>
          <ErrorNotice error={a.error} />
        </div>
  );
}

export function Catalogue({ data }: { data: ItemBoard }) {
  const a = useAction();
  const [form, setForm] = useState(false);
  const [map, setMap] = useState<Record<string, { party: string; code: string }>>({});
  const financeParties = data.roles.filter((r) => r.roles.includes('finance')).map((r) => r.partyId);
  const mayAdd = mayAddTypes(data);
  return (
    <>
    {mayAdd && (
      <div className="it-tabbar-add">
        <button className="btn btn-primary" type="button" aria-expanded={form} onClick={() => setForm(!form)}>
          <PlusIcon size={16} weight="bold" aria-hidden="true" /> New item type
        </button>
        <ItemImport data={data} kinds={['itemType']} label="Import item types from file" />
      </div>
    )}
    {form && (
      <Card title="New item type" sub="The item type says what it is, its size and unit. How a type is tracked is set once." actions={<button className="btn" type="button" onClick={() => setForm(false)}>Cancel</button>}>
        <SkuForm onDone={() => setForm(false)} />
      </Card>
    )}
    <TagChoice data={data} />
    <CareSettings data={data} />
    <section className="panel">
      <div className="panel-head">
        <h3>Item types (catalogue)</h3>
      </div>
      <p className="muted">
        The item type says what it is, its size and unit. Many units share one type, but each unit tracked one by one has its own label. How a type is
        tracked is set once.
      </p>
      <ErrorNotice error={a.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Kind</th>
              <th>Tracked</th>
              <th>SQL item codes</th>
            </tr>
          </thead>
          <tbody>
            {data.skus.map((s) => (
              <tr key={s.id}>
                <td>{s.code}</td>
                <td>{s.name}</td>
                <td>{CAT_LABEL[s.category]}</td>
                <td>{s.tracking === 'BULK' ? (s.consumable ? 'Quantity, used up' : 'Quantity') : s.tracking === 'KIT' ? 'Set' : 'Each unit'}</td>
                <td>
                  {s.sqlCodes.map((c) => `${partyName(data, c.partyId)}: ${c.itemCode} (${c.uom})`).join('; ') || <span className="muted">none</span>}
                  {financeParties.length > 0 && (
                    <div className="row" style={{ gap: 4, marginTop: 4 }}>
                      <Select className="input" aria-label="Book" value={map[s.id]?.party ?? ''} onChange={(e) => setMap({ ...map, [s.id]: { party: e.target.value, code: map[s.id]?.code ?? '' } })}>
                        <option value="">Book…</option>
                        {financeParties.map((p) => (
                          <option key={p} value={p}>
                            {partyName(data, p)}
                          </option>
                        ))}
                      </Select>
                      <input className="input" style={{ width: 120 }} placeholder="Item code" value={map[s.id]?.code ?? ''} onChange={(e) => setMap({ ...map, [s.id]: { party: map[s.id]?.party ?? '', code: e.target.value } })} />
                      <button
                        className="btn btn-sm"
                        disabled={a.busy || !map[s.id]?.party}
                        onClick={() => a.run(() => act({ kind: 'sku.map', skuId: s.id, partyId: map[s.id].party, itemCode: map[s.id].code, uom: s.uom }), 'Code recorded (not connected).')}
                      >
                        Map
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
    </>
  );
}

/**
 * How each company tags its items (Fauzan, 6 Nov 2026): printed barcode, printed QR code or RFID tag. The company's
 * manager chooses, with a reason. Every scan box still accepts all three.
 */
export function TagChoice({ data }: { data: ItemBoard }) {
  const a = useAction();
  const roles = rolesOf(data);
  const [pick, setPick] = useState<Record<string, TagMethod>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const rows = data.tagMethods.filter((t) => (roles.get(t.partyId) ?? []).some((r) => r !== 'view'));
  if (!rows.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>How we tag items</h3>
      </div>
      <p className="muted">
        Each company chooses a printed barcode, a printed QR code or RFID tags. Labels from any company still scan everywhere. With RFID the printed ID is
        kept as the backup. Only the company's manager changes this.
      </p>
      <div className="list">
        {rows.map((t) => {
          const mgr = (roles.get(t.partyId) ?? []).includes('manager') || (t.partyId === 'merdeka' && (roles.get(t.partyId) ?? []).includes('it'));
          const next = pick[t.partyId] ?? t.tagMethod;
          return (
            <div key={t.partyId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <strong>{partyName(data, t.partyId)}</strong>
                <Chip tone="info">{t.label}</Chip>
              </div>
              {t.by && (
                <span className="muted small">
                  Set by {t.by} on {dateTimeLabel(t.at!)}: {t.reason}
                </span>
              )}
              {mgr && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Select className="input" aria-label="Tagging method" value={next} onChange={(e) => setPick({ ...pick, [t.partyId]: e.target.value as TagMethod })}>
                    {TAG_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {TAG_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </Select>
                  {next !== t.tagMethod && (
                    <>
                      <input className="input" placeholder="Reason for the change" value={why[t.partyId] ?? ''} onChange={(e) => setWhy({ ...why, [t.partyId]: e.target.value })} />
                      <button
                        className="btn btn-sm"
                        disabled={a.busy}
                        onClick={() => a.run(() => act({ kind: 'settings.tagMethod', partyId: t.partyId, tagMethod: next, reason: why[t.partyId] ?? '' }), 'Tagging choice saved.')}
                      >
                        Save
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ErrorNotice error={a.error} />
    </section>
  );
}

// ---------- Finance and SQL ----------
