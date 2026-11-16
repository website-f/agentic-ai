import { Select } from '../../SearchSelect';
import { useMemo, useState } from 'react';
import { ITEM_CATEGORIES, SALE_PAPER_LABEL, STATE_LABEL, TAG_METHODS, TAG_METHOD_LABEL, labelDisplay, type BaseUom, type ItemCategory, type SalePaperKind, type TagMethod, type TrackingMode } from '@prima/core';
import { api, type ItemBoard } from '../../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../../ui';
import { act, CAT_LABEL, partyName, readFile, rolesOf, skuName, STATE_TONE } from './shared';
import { CareSettings } from './Care';
import { PlusIcon, PrinterIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { Card, Empty } from '../../kit';
import { DataTable } from '../../DataTable';
import { mayAddTypes } from './AddMenu';
import { TypeCard, TypeLabelPrint } from './TypeLabels';

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

/**
 * P98: the item types as a list that reads on a phone and on a PC: search, filters by category, stock group and how it
 * is tracked, the stock of each, ticks to print many QR labels at once, and each type's card (its QR code, units,
 * prices and stock) one tap away. Add and Import sit at the top and in the empty list.
 */
export function Catalogue({ data, onAdd, onImport }: { data: ItemBoard; onAdd?: () => void; onImport?: () => void }) {
  const a = useAction();
  const [form, setForm] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [print, setPrint] = useState<string[] | null>(null);
  const [map, setMap] = useState<Record<string, { party: string; code: string }>>({});
  const financeParties = data.roles.filter((r) => r.roles.includes('finance')).map((r) => r.partyId);
  const mayAdd = mayAddTypes(data);
  const stockOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of data.balance) m.set(b.skuId, (m.get(b.skuId) ?? 0) + b.qty);
    return m;
  }, [data.balance]);
  const trackWord = (s: ItemBoard['skus'][number]) => (s.tracking === 'BULK' ? (s.consumable ? 'Quantity, used up' : 'Quantity') : s.tracking === 'KIT' ? 'Set' : 'Each unit');
  return (
    <div className="it-stack">
      {mayAdd && (
        <div className="it-tabbar-add">
          <button className="btn btn-primary" type="button" aria-expanded={form} onClick={() => (onAdd ? onAdd() : setForm(!form))}>
            <PlusIcon size={16} weight="bold" aria-hidden="true" /> New item type
          </button>
          {onImport && (
            <button className="btn" type="button" onClick={onImport}>
              <UploadSimpleIcon size={16} weight="bold" aria-hidden="true" /> Import item list (Excel, CSV, PDF)
            </button>
          )}
        </div>
      )}
      {form && (
        <Card title="New item type" sub="The item type says what it is, its size and unit. How a type is tracked is set once." actions={<button className="btn" type="button" onClick={() => setForm(false)}>Cancel</button>}>
          <SkuForm onDone={() => setForm(false)} />
        </Card>
      )}
      <Card
        title={
          <>
            Item types <span className="muted">({data.skus.length})</span>
          </>
        }
        sub="What each item is, its unit and how it is tracked. Each type has its own QR code from its code: tick several to print their labels at once."
        flush
      >
        {/* P107: the item types as a data table: search name, code or barcode; category, stock group and tracking
            filters; ticks print many QR labels at once; a type opens its card. No "show more": pages instead. */}
        <div className="it-pad">
          <DataTable
            label="Item types"
            stateKey="items.types"
            defaults={{ sort: 'name', dir: 'asc' }}
            rows={data.skus}
            rowKey={(s) => s.id}
            onRowClick={(s) => setOpen(s.id)}
            searchPlaceholder="Search name, code or barcode"
            searchText={(s) => `${s.sourceCode ?? ''} ${s.supplierBarcodes.join(' ')}`}
            selection={{ selected: sel, onChange: setSel }}
            bulk={
              <>
                <button className="btn btn-primary" type="button" onClick={() => setPrint([...sel])}>
                  <PrinterIcon size={16} aria-hidden="true" /> Print QR labels
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setSel(new Set())}>
                  Clear
                </button>
              </>
            }
            columns={[
              { id: 'name', label: 'Name', value: (s) => s.name, phone: 'title', render: (s) => <strong>{s.name}</strong> },
              { id: 'code', label: 'Code', value: (s) => s.code, phone: 'sub', render: (s) => <span className="mono small">{s.code}</span> },
              { id: 'category', label: 'Category', value: (s) => CAT_LABEL[s.category], translate: true },
              { id: 'group', label: 'Stock group', value: (s) => s.group ?? '', hideBelow: 1000 },
              { id: 'tracking', label: 'Tracked', value: (s) => trackWord(s), translate: true, hideBelow: 1100, render: (s) => <Chip tone="neutral">{trackWord(s)}</Chip> },
              { id: 'stock', label: 'In stock', value: (s) => stockOf.get(s.id) ?? 0, sort: 'number' },
              { id: 'uom', label: 'Unit', value: (s) => s.uomLabel ?? s.uom, hideBelow: 900 },
            ]}
            filters={[
              { id: 'cat', label: 'Category', value: (s) => s.category, allLabel: 'All categories', options: ITEM_CATEGORIES.map((c) => ({ value: c, label: CAT_LABEL[c] })) },
              { id: 'group', label: 'Stock group', value: (s) => s.group ?? null, allLabel: 'All stock groups' },
              {
                id: 'track',
                label: 'Tracked',
                value: (s) => s.tracking,
                allLabel: 'Any tracking',
                options: [
                  { value: 'BULK', label: 'By quantity' },
                  { value: 'SERIALIZED', label: 'Each unit has its own label' },
                  { value: 'KIT', label: 'Sets' },
                ],
              },
            ]}
            empty={
              <Empty
                title="No item types yet."
                action={
                  mayAdd ? (
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                      {onImport && (
                        <button className="btn btn-primary" type="button" onClick={onImport}>
                          <UploadSimpleIcon size={16} aria-hidden="true" /> Import your item list
                        </button>
                      )}
                      <button className="btn" type="button" onClick={() => (onAdd ? onAdd() : setForm(true))}>
                        <PlusIcon size={16} aria-hidden="true" /> Add one by hand
                      </button>
                    </div>
                  ) : undefined
                }
              >
                {mayAdd ? 'Load the list you already have (Excel, CSV or the PDF report from the old system), or add the first item type by hand.' : 'Store staff and managers add item types.'}
              </Empty>
            }
          />
        </div>
      </Card>
      {financeParties.length > 0 && data.skus.length > 0 && (
        <details className="panel">
          <summary>
            <strong>SQL Account item codes</strong> <span className="muted small">(Finance)</span>
          </summary>
          <ErrorNotice error={a.error} />
          <ul className="it-rows">
            {data.skus.map((s) => (
              <li key={s.id} className="it-row" style={{ flexWrap: 'wrap' }}>
                <span className="it-row-main">
                  <strong>{s.name}</strong>
                  <span className="small muted">{s.sqlCodes.map((c) => `${partyName(data, c.partyId)}: ${c.itemCode} (${c.uom})`).join('; ') || 'No SQL code yet'}</span>
                </span>
                <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
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
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <TagChoice data={data} />
      <CareSettings data={data} />
      {open && <TypeCard data={data} skuId={open} onClose={() => setOpen(null)} onPrint={(ids) => (setOpen(null), setPrint(ids))} />}
      {print && <TypeLabelPrint data={data} skuIds={print} onClose={() => setPrint(null)} />}
    </div>
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
