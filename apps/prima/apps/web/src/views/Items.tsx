import { useMemo, useState } from 'react';
import { ITEM_CATEGORIES, SALE_PAPER_LABEL, STATE_LABEL, TAG_METHODS, TAG_METHOD_LABEL, type SalePaperKind, labelDisplay, type ItemAction, type ItemCategory, type TagMethod, type TrackingMode, type BaseUom } from '@prima/core';
import { api, type ItemBoard, type ItemPassport } from '../api';
import { useApp } from '../App';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import { code128Svg } from './code128';
import { ReadsBox, ScanBox, qrSvg } from './ScanBox';

/**
 * One item register for the whole group (Fauzan, 6 Nov 2026; Fitri's paper v1.0). Every uniform, shoe, vest, radio,
 * phone, IT device, office item, piece of furniture and cleaning stock in every company: one label for life, owner and
 * holder kept apart, every handover confirmed by the person who gets it. Firearms stay in the Arms Control records.
 * SQL Account is not connected: the SQL tab only shows what Finance would post and why it is not ready.
 */

type Tab = 'find' | 'stock' | 'moves' | 'care' | 'uniforms' | 'cases' | 'counts' | 'catalogue' | 'sql' | 'mine';
type Role = 'store' | 'manager' | 'ops' | 'finance' | 'it' | 'view';

const rid = () => `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const act = (a: ItemAction) => api.itemAct(rid(), a);

const CAT_LABEL: Record<ItemCategory, string> = {
  uniform: 'Uniform',
  footwear: 'Shoes and boots',
  vest: 'Vests',
  torchlight: 'Torchlights',
  radio: 'Radios',
  phone: 'Phones',
  patrol_device: 'Patrol devices',
  bodycam: 'Body cameras',
  it_device: 'IT devices',
  office: 'Office items',
  furniture: 'Furniture',
  cleaning: 'Cleaning',
  safety: 'Safety gear',
  tools: 'Tools',
  other: 'Other',
};
const TYPE_LABEL = { sale: 'Sale', rental: 'Rental', loan: 'Loan', transfer: 'Transfer', supplier_return: 'Return to supplier' } as const;
const MOVE_TONE = { draft: 'neutral', dispatched: 'info', partly_received: 'warn', received: 'ok', cancelled: 'neutral' } as const;
const STATE_TONE: Record<string, 'ok' | 'warn' | 'crit' | 'info' | 'neutral'> = {
  quarantine: 'warn',
  available: 'ok',
  reserved: 'info',
  in_transit: 'info',
  with_person: 'ok',
  at_site: 'ok',
  repair: 'warn',
  missing: 'crit',
  lost: 'crit',
  disposed: 'neutral',
};

function rolesOf(b: ItemBoard) {
  const m = new Map<string, Role[]>();
  for (const r of b.roles) m.set(r.partyId, r.roles as Role[]);
  return m;
}
const any = (b: ItemBoard, ...rs: Role[]) => b.roles.some((r) => r.roles.some((x) => rs.includes(x as Role)));

export function ItemsView() {
  const { data, error } = useLoad(() => api.itemBoard(), []);
  const [tab, setTab] = useState<Tab | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="item register" />;
  const handles = any(data, 'store', 'manager', 'ops', 'it');
  const tabs: [Tab, string, boolean][] = [
    ['find', 'Find or scan', data.roles.length > 0],
    ['stock', 'Stock', data.roles.length > 0],
    ['moves', 'Send and receive', data.roles.length > 0],
    ['care', `After-sale care${data.care.filter((c) => c.status === 'overdue' || c.status === 'end_of_life').length ? ` (${data.care.filter((c) => c.status === 'overdue' || c.status === 'end_of_life').length})` : ''}`, data.roles.length > 0],
    ['uniforms', `Uniforms${data.uniforms.rows.filter((r) => r.status === 'due').length ? ` (${data.uniforms.rows.filter((r) => r.status === 'due').length} due)` : ''}`, data.uniforms.rows.length > 0],
    ['cases', `Cases (${data.cases.filter((c) => c.status === 'open').length})`, data.roles.length > 0],
    ['counts', 'Counts', handles],
    ['catalogue', 'Item types', data.roles.length > 0],
    ['sql', 'Finance and SQL', any(data, 'finance', 'manager', 'view')],
    ['mine', `My items (${data.mine.length})`, true],
  ];
  const shown = tabs.filter((t) => t[2]);
  const current = tab ?? (data.roles.length ? 'find' : 'mine');
  const c = data.checks;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Items and equipment</h1>
        <p className="muted">
          One register for everything the group must keep track of: uniforms, shoes, vests, torchlights, radios, phones, IT devices, office items, furniture
          and cleaning stock, in every company. Each item keeps one label for life, printed as a barcode or QR code, with an optional RFID tag. Who owns it
          and who holds it are kept apart; after a sale the seller and the buyer both follow the item's whole life. A person confirms what they get in their
          own sign-in or with a face check on the post's shared device, and nothing is ever charged to them automatically.
        </p>
        <p className="notice" data-tone="info">
          Test data. {data.armsNote} {data.sqlConnection.note}
        </p>
      </div>
      {data.roles.length > 0 && (
        <div className="kpis">
          <Kpi label="In transit" value={c.inTransit.length} tone={c.inTransit.length ? 'warn' : 'ok'} />
          <Kpi label="Open cases" value={c.openCases} tone={c.openCases ? 'warn' : 'ok'} />
          <Kpi label="Waiting for the person to confirm" value={c.unconfirmedHandovers.length} tone={c.unconfirmedHandovers.length ? 'warn' : 'ok'} />
          <Kpi label="Ownership for Finance to record" value={c.ownershipPending.length} tone={c.ownershipPending.length ? 'warn' : 'ok'} />
          <Kpi label="Rental or loan overdue" value={c.overdueReturns.length} tone={c.overdueReturns.length ? 'crit' : 'ok'} />
          <Kpi label="Opening balance not verified" value={c.legacyUnverified} tone={c.legacyUnverified ? 'warn' : 'ok'} />
        </div>
      )}
      <div className="tabbar" role="tablist" aria-label="Items">
        {shown.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={current === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      {current === 'find' && <Find data={data} />}
      {current === 'stock' && <Stock data={data} />}
      {current === 'moves' && <Moves data={data} />}
      {current === 'care' && <Care data={data} />}
      {current === 'uniforms' && <Uniforms data={data} />}
      {current === 'cases' && <Cases data={data} />}
      {current === 'counts' && <Counts data={data} />}
      {current === 'catalogue' && <Catalogue data={data} />}
      {current === 'sql' && <Sql data={data} />}
      {current === 'mine' && <Mine data={data} />}
    </div>
  );
}

const partyName = (b: ItemBoard, id: string) => b.parties.find((p) => p.id === id)?.name ?? id;
const skuName = (b: ItemBoard, id: string) => {
  const s = b.skus.find((x) => x.id === id);
  return s ? `${s.code}: ${s.name}` : id;
};

// ---------- Find / passport ----------

function Find({ data }: { data: ItemBoard }) {
  const [label, setLabel] = useState<string | null>(null);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Find an item</h3>
      </div>
      <p className="muted">
        Scan the barcode, QR code or RFID tag, or type the ID printed under the code (it starts with P1-). Every company's labels scan here, whatever it
        chose. A scan only finds the record; what you may do still depends on your role.
      </p>
      <ScanBox onScan={(v) => setLabel(v)} autoFocus />
      <h3 style={{ marginTop: 12 }}>Recent items</h3>
      <div className="list">
        {data.items.slice(-8).reverse().map((i) => (
          <button key={i.id} className="list-item" onClick={() => setLabel(i.token)}>
            <div>
              <strong>{skuName(data, i.skuId)}</strong>
              <div className="muted">
                {labelDisplay(i.token)}
                {i.rfidTag ? ' · RFID' : ''}
              </div>
            </div>
            <Chip tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</Chip>
          </button>
        ))}
      </div>
      {label && <Passport data={data} label={label} onClose={() => setLabel(null)} />}
    </section>
  );
}

function Passport({ data, label, onClose }: { data: ItemBoard; label: string; onClose: () => void }) {
  const { data: p, error, reload } = useLoad(() => api.itemByLabel(label), [label]);
  return (
    <Drawer title={p ? skuName(data, p.item.skuId) : 'Item'} sub={p ? p.label : label} onClose={onClose}>
      {error && <ErrorNotice error={error} />}
      {!p && !error && <Loading what="item" />}
      {p && <PassportBody data={data} p={p} onChanged={reload} />}
    </Drawer>
  );
}

function PassportBody({ data, p, onChanged }: { data: ItemBoard; p: ItemPassport; onChanged: () => void }) {
  const i = p.item;
  const roles = rolesOf(data);
  const holderRoles = roles.get(i.custody.partyId) ?? [];
  const mayHandle = holderRoles.some((r) => r === 'store' || r === 'manager' || r === 'it');
  const isOps = holderRoles.includes('ops');
  const { me } = useApp();
  const mineToConfirm = !!me.user.personId && i.pendingAck?.personId === me.user.personId;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <LabelCard token={i.token} sku={p.sku?.code ?? ''} size={p.sku?.size ?? null} method={methodOf(data, i.custody.partyId)} />
      <dl className="facts">
        <dt>Owner</dt>
        <dd>{p.owner}</dd>
        <dt>Held by</dt>
        <dd>
          {p.holder}: {i.custody.label}
        </dd>
        <dt>State</dt>
        <dd>
          <Chip tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</Chip> {i.pendingAck && <Chip tone="warn">Waiting for the person to confirm</Chip>}
        </dd>
        <dt>Condition</dt>
        <dd>{i.condition}</dd>
        <dt>RFID tag</dt>
        <dd>{i.rfidTag ? <span style={{ fontFamily: 'monospace' }}>{i.rfidTag}</span> : 'None (optional)'}</dd>
        {p.followedBy.length > 0 && (
          <>
            <dt>Followed by</dt>
            <dd>{p.followedBy.join(' and ')} (whole history; only the owner and holder act on it)</dd>
          </>
        )}
        {i.serial && (
          <>
            <dt>Maker serial</dt>
            <dd>{i.serial}</dd>
          </>
        )}
        {i.dueBack && (
          <>
            <dt>Due back to owner</dt>
            <dd>{dateLabel(i.dueBack.on)}</dd>
          </>
        )}
        {i.legacyUnverified && (
          <>
            <dt>Opening balance</dt>
            <dd>Counted from the old list, not yet verified</dd>
          </>
        )}
        {i.writeOff && (
          <>
            <dt>Write-off</dt>
            <dd>For Finance to decide. Never a pay deduction.</dd>
          </>
        )}
      </dl>
      {mineToConfirm && <ConfirmMine label={i.token} onDone={onChanged} />}
      {(mayHandle || isOps) && <ItemActions data={data} p={p} handle={mayHandle} onDone={onChanged} />}
      <h3>History</h3>
      <div className="list">
        {p.events
          .slice()
          .reverse()
          .map((e) => (
            <div key={e.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{e.kind.replace(/_/g, ' ')}</strong>
                <span className="muted">{dateTimeLabel(e.at)}</span>
              </div>
              <div className="muted">
                {e.by}
                {e.to ? ` → ${e.to.label}` : ''}
                {e.ownerTo && e.kind === 'ownership' ? ` · owner now ${partyName(data, e.ownerTo)}` : ''}
              </div>
              {e.note && <div>{e.note}</div>}
            </div>
          ))}
      </div>
      {p.cases.length > 0 && (
        <>
          <h3>Cases</h3>
          {p.cases.map((c) => (
            <div key={c.id} className="list-item">
              <div>
                <strong>
                  {c.ref} {c.kind.replace(/_/g, ' ')}
                </strong>
                <div className="muted">{c.note}</div>
              </div>
              <Chip tone={c.status === 'open' ? 'warn' : 'ok'}>{c.status}</Chip>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** The company's chosen way of tagging (barcode by default). */
const methodOf = (b: ItemBoard, partyId: string): TagMethod => b.tagMethods.find((t) => t.partyId === partyId)?.tagMethod ?? 'barcode';

/**
 * The printed label: the same ID as a Code 128 barcode or a QR code (the company's choice; either can be printed),
 * the ID to type, the short SKU and size. No names, prices or owner. With RFID the printed ID is the backup.
 */
function LabelCard({ token, sku, size, method }: { token: string; sku: string; size: string | null; method: TagMethod }) {
  const [as, setAs] = useState<'barcode' | 'qr'>(method === 'barcode' ? 'barcode' : 'qr');
  const svg = useMemo(() => (as === 'qr' ? qrSvg(token) : code128Svg(token)), [token, as]);
  return (
    <div className="panel item-label" style={{ textAlign: 'center', background: '#fff', color: '#111' }}>
      <div
        aria-label={`${as === 'qr' ? 'QR code' : 'Barcode'} ${labelDisplay(token)}`}
        style={as === 'qr' ? { width: 140, margin: '0 auto' } : undefined}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div style={{ fontFamily: 'monospace', fontSize: 15, letterSpacing: 1 }}>{labelDisplay(token)}</div>
      <div style={{ fontSize: 12 }}>
        {sku}
        {size ? ` · ${size}` : ''}
      </div>
      <div className="row no-print" style={{ gap: 6, justifyContent: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <div className="seg">
          <button aria-pressed={as === 'barcode'} onClick={() => setAs('barcode')}>
            Barcode
          </button>
          <button aria-pressed={as === 'qr'} onClick={() => setAs('qr')}>
            QR code
          </button>
        </div>
        <button className="btn btn-sm" onClick={() => window.print()}>
          Print label
        </button>
      </div>
      {method === 'rfid' && <div className="muted small no-print">This company uses RFID tags; the printed ID is the backup when a reader fails.</div>}
    </div>
  );
}

function ConfirmMine({ label, onDone }: { label: string; onDone: () => void }) {
  const a = useAction();
  const [note, setNote] = useState('');
  return (
    <div className="panel" style={{ display: 'grid', gap: 6 }}>
      <strong>Did you get this item?</strong>
      <span className="muted small">Scan its label or tag to confirm, or press Yes.</span>
      <ScanBox
        label="Scan the item to confirm"
        button="Confirm"
        busy={a.busy}
        onScan={(v) => a.run(() => act({ kind: 'confirm', label: v }), 'Thank you, confirmed.').then(onDone)}
      />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'confirm', label }), 'Thank you, confirmed.').then(onDone)}>
          Yes, I have it
        </button>
        <input className="input" placeholder="If not: what is wrong" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn" disabled={a.busy || note.trim().length < 3} onClick={() => a.run(() => act({ kind: 'dispute', label, note }), 'Sent to the store to sort out.').then(onDone)}>
          I did not get it
        </button>
      </div>
      <ErrorNotice error={a.error} />
    </div>
  );
}

function ItemActions({ data, p, handle, onDone }: { data: ItemBoard; p: ItemPassport; handle: boolean; onDone: () => void }) {
  const a = useAction();
  const i = p.item;
  const [what, setWhat] = useState<string>('');
  const [note, setNote] = useState('');
  const [to, setTo] = useState('');
  const [cond, setCond] = useState<'new' | 'good' | 'worn' | 'damaged'>('good');
  const [receipt, setReceipt] = useState('');
  const [amount, setAmount] = useState('');
  const run = (x: ItemAction, msg: string) =>
    a.run(() => act(x), msg).then((r) => {
      if (r) {
        setWhat('');
        setNote('');
        setReceipt('');
        setAmount('');
        onDone();
      }
    });
  const options: [string, string, boolean][] = [
    ['inspect', 'Check it (quarantine to store)', handle && i.state === 'quarantine'],
    ['issue_person', 'Hand to a person', ['available', 'at_site', 'with_person'].includes(i.state) && !i.pendingAck],
    ['issue_site', 'Place at a site', ['available', 'with_person'].includes(i.state) && !i.pendingAck],
    ['return', 'Take back into the store', ['with_person', 'at_site'].includes(i.state)],
    ['observe', 'Record a site check (moves nothing)', true],
    ['missing', 'Report missing', !['missing', 'lost', 'disposed'].includes(i.state)],
    ['repair', 'Send for repair', handle && ['quarantine', 'available'].includes(i.state)],
    ['repair_back', 'Back from repair', handle && i.state === 'repair'],
    ['reprint', 'Reprint the label (same ID)', handle && i.state !== 'disposed'],
    ['rfid', i.rfidTag ? 'Replace or remove the RFID tag' : 'Add an RFID tag', handle && !['disposed', 'in_transit'].includes(i.state)],
    ['replace', 'Register a replacement (new ID)', handle && ['quarantine', 'lost', 'repair', 'disposed'].includes(i.state) && !i.replacedById],
    ['dispose', 'Ask to dispose of it', handle && i.state === 'quarantine'],
  ];
  return (
    <div className="panel" style={{ display: 'grid', gap: 6 }}>
      <select className="input" aria-label="Action" value={what} onChange={(e) => setWhat(e.target.value)}>
        <option value="">Choose what to do…</option>
        {options
          .filter((o) => o[2])
          .map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
      </select>
      {(what === 'issue_person' || what === 'issue_site' || what === 'observe') && (
        <input
          className="input"
          aria-label={what === 'issue_person' ? 'Staff record ID' : 'Site ID'}
          placeholder={what === 'issue_person' ? 'Person record ID (e.g. pr-sasa-0212)' : 'Site ID (e.g. st-sasa-001)'}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      )}
      {what === 'rfid' && (
        <input className="input" aria-label="RFID tag" placeholder={i.rfidTag ? 'New tag (empty to remove the tag)' : 'Read the tag with the reader, or type its code'} value={to} onChange={(e) => setTo(e.target.value)} maxLength={80} />
      )}
      {what === 'issue_person' && data.skus.find((s) => s.id === i.skuId)?.category === 'uniform' && (
        <input
          className="input"
          aria-label="Reason if early"
          placeholder={`Reason, needed if under ${data.uniforms.rule.everyMonths} months since their last uniform piece`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      {what === 'issue_person' && data.skus.find((s) => s.id === i.skuId)?.category === 'uniform' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="muted small" style={{ flexBasis: '100%' }}>
            Only for a 4th or 5th piece in 12 months, which the guard pays for. Never taken from pay.
          </span>
          <input className="input" aria-label="Guard's receipt number" placeholder="Receipt number" value={receipt} onChange={(e) => setReceipt(e.target.value)} maxLength={60} />
          <input className="input" aria-label="Amount paid (RM)" placeholder="Amount on the receipt (RM)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      )}
      {(what === 'inspect' || what === 'return') && (
        <select className="input" aria-label="Condition" value={cond} onChange={(e) => setCond(e.target.value as typeof cond)}>
          {(what === 'inspect' ? ['new', 'good', 'worn', 'damaged'] : ['good', 'worn', 'damaged']).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
      {what && !what.startsWith('issue') && (
        <input
          className="input"
          aria-label="Note"
          placeholder={
            what === 'repair'
              ? 'Repairer name'
              : what === 'reprint'
                ? 'Why reprinted, and how you checked it is the same item'
                : what === 'rfid'
                  ? i.rfidTag
                    ? 'Why the tag is replaced or removed'
                    : 'Note (optional)'
                  : 'Note or reason'
          }
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      {what && (
        <button
          className="btn"
          disabled={a.busy}
          onClick={() => {
            const label = i.token;
            if (what === 'inspect') run({ kind: 'item.inspect', label, condition: cond, note, expectedVersion: i.version }, 'Checked.');
            if (what === 'issue_person') run({ kind: 'issue', label, personId: to.trim(), expectedVersion: i.version, reason: note.trim() || undefined, paidByGuard: receipt.trim() ? { receiptRef: receipt.trim(), amount: Number(amount) } : undefined }, 'Handed over. The person confirms in their own sign-in.');
            if (what === 'issue_site') run({ kind: 'issue', label, siteId: to.trim(), expectedVersion: i.version }, 'Placed at the site.');
            if (what === 'return') run({ kind: 'return', label, condition: cond === 'new' ? 'good' : cond, note }, 'Back in the store, to check before it is issued again.');
            if (what === 'observe') run({ kind: 'observe', label, siteId: to.trim(), note }, 'Site check recorded.');
            if (what === 'missing') run({ kind: 'report.missing', label, note }, 'Reported. A manager decides; no pay deduction.');
            if (what === 'repair') run({ kind: 'repair.out', label, repairer: note, note: '' }, 'Sent for repair.');
            if (what === 'repair_back') run({ kind: 'repair.back', label, note }, 'Back from repair, to check.');
            if (what === 'reprint') run({ kind: 'item.reprint', label, reason: note }, 'Label reprinted with the same ID.');
            if (what === 'rfid') run({ kind: 'item.rfid', label, tag: to, reason: note }, to.trim() ? 'RFID tag recorded.' : 'RFID tag removed.');
            if (what === 'replace') run({ kind: 'item.replace', label, note }, 'Replacement registered with a new label.');
            if (what === 'dispose') run({ kind: 'dispose.ask', label, reason: note }, 'Disposal asked. A manager decides.');
          }}
        >
          Save
        </button>
      )}
      <ErrorNotice error={a.error} />
      <span className="muted">Owner: {partyName(data, i.ownerPartyId)}. Ownership changes only when Finance records it.</span>
    </div>
  );
}

// ---------- Stock ----------

function Stock({ data }: { data: ItemBoard }) {
  const [party, setParty] = useState('');
  const [cat, setCat] = useState('');
  const [reg, setReg] = useState(false);
  const rows = data.balance.filter((r) => (!party || r.ownerPartyId === party || r.holderPartyId === party) && (!cat || data.skus.find((s) => s.id === r.skuId)?.category === cat));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Stock by owner, holder and condition</h3>
        {any(data, 'store', 'manager', 'it') && (
          <button className="btn btn-sm" onClick={() => setReg(!reg)}>
            Register items
          </button>
        )}
      </div>
      {reg && <Register data={data} onDone={() => setReg(false)} />}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
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
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item type</th>
              <th>Owner</th>
              <th>Held by / where</th>
              <th>State</th>
              <th>Condition</th>
              <th>Qty</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={6} className="empty">
                  Nothing here.
                </td>
              </tr>
            )}
            {rows.map((r, k) => (
              <tr key={k}>
                <td>{skuName(data, r.skuId)}</td>
                <td>{partyName(data, r.ownerPartyId)}</td>
                <td>
                  {partyName(data, r.holderPartyId)}: {r.where}
                </td>
                <td>{r.state === 'bulk' ? 'Counted by quantity' : STATE_LABEL[r.state as keyof typeof STATE_LABEL]}</td>
                <td>{r.condition}</td>
                <td>{r.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Register({ data, onDone }: { data: ItemBoard; onDone: () => void }) {
  const a = useAction();
  const roles = rolesOf(data);
  const parties = data.parties.filter((p) => (roles.get(p.id) ?? []).some((r) => r === 'store' || r === 'manager' || r === 'it'));
  const [partyId, setPartyId] = useState(parties[0]?.id ?? '');
  const [skuId, setSkuId] = useState('');
  const [count, setCount] = useState('1');
  const [serials, setSerials] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [note, setNote] = useState('');
  const sku = data.skus.find((s) => s.id === skuId);
  return (
    <div className="panel" style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      <select className="input" aria-label="Company" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
        {parties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select className="input" aria-label="Item type" value={skuId} onChange={(e) => setSkuId(e.target.value)}>
        <option value="">Choose the item type…</option>
        {data.skus
          .filter((s) => s.tracking !== 'KIT')
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.code}: {s.name} ({s.tracking === 'BULK' ? 'by quantity' : 'each unit'})
            </option>
          ))}
      </select>
      <input className="input" aria-label={sku?.tracking === 'BULK' ? 'Quantity' : 'How many units'} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
      {sku?.tracking === 'SERIALIZED' && (
        <input className="input" aria-label="Maker serials" placeholder="Maker serials, comma separated (optional; one per unit)" value={serials} onChange={(e) => setSerials(e.target.value)} />
      )}
      <input className="input" aria-label="Note" placeholder={sku?.tracking === 'BULK' ? 'Order or delivery note' : 'Order, delivery note or source'} value={note} onChange={(e) => setNote(e.target.value)} />
      {sku?.tracking === 'SERIALIZED' && (
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} /> Opening balance from the old list (not verified)
        </label>
      )}
      <button
        className="btn"
        disabled={a.busy || !sku}
        onClick={() =>
          a
            .run(
              () =>
                sku!.tracking === 'BULK'
                  ? act({ kind: 'lot.add', skuId, partyId, qty: Number(count), note })
                  : act({
                      kind: 'item.register',
                      skuId,
                      partyId,
                      count: Number(count),
                      serials: serials.trim() ? serials.split(',').map((x) => x.trim()) : undefined,
                      legacyUnverified: legacy,
                      note,
                    }),
              sku!.tracking === 'BULK' ? 'Stock added.' : 'Registered. Labels printed; check each item before it is issued.',
            )
            .then((r) => r && onDone())
        }
      >
        Save
      </button>
      <ErrorNotice error={a.error} />
    </div>
  );
}

// ---------- Movements ----------

function Moves({ data }: { data: ItemBoard }) {
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const m = data.movements.find((x) => x.id === open) ?? null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Sales, rentals, loans, transfers and returns</h3>
        {any(data, 'store', 'manager', 'ops', 'it') && (
          <button className="btn btn-sm" onClick={() => setForm(!form)}>
            New movement
          </button>
        )}
      </div>
      <p className="muted">
        The receiver checks each item on arrival: received, damaged, missing or wrong item. A sale does not change the owner until Finance records it under
        the sale terms. A rental or loan never changes the owner.
      </p>
      {form && <NewMove data={data} onDone={() => setForm(false)} />}
      {data.checks.inTransit.length > 0 && any(data, 'store', 'manager', 'ops', 'it') && <ReceiveByScan />}
      <div className="list">
        {!data.movements.length && <div className="empty">No movements.</div>}
        {data.movements.map((x) => (
          <button key={x.id} className="list-item" onClick={() => setOpen(x.id)}>
            <div>
              <strong>
                {x.ref} {TYPE_LABEL[x.type]}
              </strong>
              <div className="muted">
                {partyName(data, x.fromPartyId)} → {x.to.label} · {x.lines.length} units{x.lotLines.length ? ` + ${x.lotLines.length} stock lines` : ''}
              </div>
            </div>
            <Chip tone={MOVE_TONE[x.status]}>{x.status.replace('_', ' ')}</Chip>
          </button>
        ))}
      </div>
      {m && (
        <Drawer title={`${m.ref} ${TYPE_LABEL[m.type]}`} sub={`${partyName(data, m.fromPartyId)} → ${m.to.label}`} onClose={() => setOpen(null)}>
          <MoveBody data={data} m={m} />
        </Drawer>
      )}
    </section>
  );
}

/**
 * Declare arrival by scanning: the receiving store, the site supervisor or the area OM scans each label, QR or RFID
 * tag. Every scanned unit still in transit is received on its own movement; anything not scanned stays waiting.
 */
function ReceiveByScan() {
  const a = useAction();
  const [last, setLast] = useState<string | null>(null);
  const send = (reads: string[]) =>
    a.run(
      () => act({ kind: 'move.receiveScan', reads }),
      (r) => {
        const out = (r as { result: { received: { ref: string; count: number }[]; notInTransit: string[]; unknown: string[] } }).result;
        const got = out.received.map((x) => `${x.count} on ${x.ref}`).join(', ');
        const msg = `${got ? `Received: ${got}.` : 'Nothing received.'}${out.notInTransit.length ? ` Not in transit: ${out.notInTransit.join(', ')}.` : ''}${out.unknown.length ? ` Not found: ${out.unknown.length}.` : ''}`;
        setLast(msg);
        return msg;
      },
    );
  return (
    <div className="panel" style={{ display: 'grid', gap: 6 }}>
      <strong>Receive by scanning</strong>
      <span className="muted small">
        Scan each item that arrived. Only your company's deliveries are received, never by the person who sent them. Items not scanned stay waiting; mark
        damaged or missing items on the movement.
      </span>
      <ScanBox label="Scan an item that arrived" button="Received" busy={a.busy} onScan={(v) => send([v])} />
      <details>
        <summary className="muted small">Many RFID reads at once</summary>
        <ReadsBox button="Receive all read" busy={a.busy} onSend={send} />
      </details>
      {last && <span className="small">{last}</span>}
      <ErrorNotice error={a.error} />
    </div>
  );
}

function NewMove({ data, onDone }: { data: ItemBoard; onDone: () => void }) {
  const a = useAction();
  const roles = rolesOf(data);
  const mine = data.parties.filter((p) => (roles.get(p.id) ?? []).some((r) => r !== 'view' && r !== 'finance'));
  const [type, setType] = useState<keyof typeof TYPE_LABEL>('sale');
  // Procurement runs both the Goodwill and head-office stores; most of its sending is from Goodwill.
  const [from, setFrom] = useState((mine.find((p) => p.id === 'goodwill') ?? mine.find((p) => p.kind === 'security_company') ?? mine[0])?.id ?? '');
  const [to, setTo] = useState('');
  const [site, setSite] = useState('');
  const [purpose, setPurpose] = useState('');
  const [due, setDue] = useState('');
  const [orig, setOrig] = useState('');
  const targets = data.parties.filter((p) => (type === 'transfer' ? p.id === from : p.id !== from));
  return (
    <div className="panel" style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      <select className="input" aria-label="Type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
        {Object.entries(TYPE_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <select className="input" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)}>
        {mine.map((p) => (
          <option key={p.id} value={p.id}>
            From {p.name}
          </option>
        ))}
      </select>
      <select className="input" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">To…</option>
        {targets.map((p) => (
          <option key={p.id} value={p.id}>
            To {p.name}
          </option>
        ))}
      </select>
      <input className="input" aria-label="Site" placeholder="Receiving site ID (leave empty for the store)" value={site} onChange={(e) => setSite(e.target.value)} />
      <input className="input" aria-label="Purpose" placeholder="What it is for (request, site or reason)" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      {(type === 'rental' || type === 'loan') && <input className="input" type="date" aria-label="Due back" value={due} onChange={(e) => setDue(e.target.value)} />}
      {type === 'supplier_return' && (
        <select className="input" aria-label="Original sale" value={orig} onChange={(e) => setOrig(e.target.value)}>
          <option value="">Original sale…</option>
          {data.movements
            .filter((m) => m.type === 'sale' && m.toPartyId === from)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.ref} from {partyName(data, m.fromPartyId)}
              </option>
            ))}
        </select>
      )}
      <button
        className="btn"
        disabled={a.busy}
        onClick={() =>
          a
            .run(
              () =>
                act({
                  kind: 'move.create',
                  type,
                  fromPartyId: from,
                  toPartyId: type === 'transfer' ? from : to,
                  toSiteId: site.trim() || undefined,
                  purpose,
                  dueBackOn: due || undefined,
                  originalMovementId: orig || undefined,
                }),
              'Prepared. Scan the items onto it, then send.',
            )
            .then((r) => r && onDone())
        }
      >
        Prepare
      </button>
      <ErrorNotice error={a.error} />
    </div>
  );
}

function MoveBody({ data, m }: { data: ItemBoard; m: ItemBoard['movements'][number] }) {
  const a = useAction();
  const roles = rolesOf(data);
  const sender = (roles.get(m.fromPartyId) ?? []).some((r) => r !== 'view' && r !== 'finance');
  const receiver = (roles.get(m.toPartyId) ?? []).some((r) => r !== 'view' && r !== 'finance');
  const finance = (roles.get(m.fromPartyId) ?? []).includes('finance') || (roles.get(m.toPartyId) ?? []).includes('finance');
  const [scan, setScan] = useState('');
  const [carrier, setCarrier] = useState('');
  const [results, setResults] = useState<Record<string, 'received' | 'damaged' | 'missing' | 'wrong_item' | ''>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [lotQty, setLotQty] = useState<Record<string, string>>({});
  const [eff, setEff] = useState('');
  const [basis, setBasis] = useState('');
  const itemOf = (id: string) => data.items.find((i) => i.id === id);
  const openLines = m.lines.filter((l) => l.result === 'pending' || l.result === 'missing');
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <dl className="facts">
        <dt>Purpose</dt>
        <dd>{m.purpose}</dd>
        {m.commercialRef && (
          <>
            <dt>Shared reference</dt>
            <dd>{m.commercialRef} (on both companies' documents)</dd>
          </>
        )}
        {m.dueBackOn && (
          <>
            <dt>Due back</dt>
            <dd>{dateLabel(m.dueBackOn)}</dd>
          </>
        )}
        {m.dispatched && (
          <>
            <dt>Sent</dt>
            <dd>
              {dateTimeLabel(m.dispatched.at)} by {m.dispatched.by}, carried by {m.dispatched.carrier}
            </dd>
          </>
        )}
        {m.ownership && (
          <>
            <dt>Ownership</dt>
            <dd>
              Passed {dateLabel(m.ownership.effectiveOn)} ({m.ownership.basis}), recorded by {m.ownership.by}
            </dd>
          </>
        )}
      </dl>
      <div className="list">
        {m.lines.map((l) => {
          const it = itemOf(l.itemId);
          return (
            <div key={l.itemId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  {it ? `${skuName(data, it.skuId)} · ${labelDisplay(it.token)}` : 'Unit (not visible to you)'}
                </span>
                <Chip tone={l.result === 'received' ? 'ok' : l.result === 'pending' ? 'neutral' : l.result === 'missing' ? 'crit' : 'warn'}>{l.result.replace('_', ' ')}</Chip>
              </div>
              {receiver && (m.status === 'dispatched' || m.status === 'partly_received') && l.result === 'pending' && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <select className="input" aria-label="Result" value={results[l.itemId] ?? ''} onChange={(e) => setResults({ ...results, [l.itemId]: e.target.value as never })}>
                    <option value="">Not checked yet</option>
                    <option value="received">Received in good order</option>
                    <option value="damaged">Damaged</option>
                    <option value="missing">Missing</option>
                    <option value="wrong_item">Wrong item or size</option>
                  </select>
                  {results[l.itemId] && results[l.itemId] !== 'received' && (
                    <input className="input" placeholder="What is wrong" value={notes[l.itemId] ?? ''} onChange={(e) => setNotes({ ...notes, [l.itemId]: e.target.value })} />
                  )}
                </div>
              )}
            </div>
          );
        })}
        {m.lotLines.map((l) => (
          <div key={l.lotId} className="list-item">
            <span>
              {skuName(data, l.skuId)}: {l.qtySent} sent{l.qtyReceived != null ? `, ${l.qtyReceived} received` : ''}
            </span>
            {receiver && l.qtyReceived == null && m.status !== 'draft' && (
              <input className="input" style={{ width: 90 }} aria-label="Quantity received" inputMode="numeric" value={lotQty[l.lotId] ?? ''} onChange={(e) => setLotQty({ ...lotQty, [l.lotId]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      {sender && m.status === 'draft' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <form
            className="row"
            style={{ gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              a.run(() => act({ kind: 'move.add', movementId: m.id, label: scan }), 'Added.').then((r) => r && setScan(''));
            }}
          >
            <input className="input" aria-label="Scan label" placeholder="Scan or type each label" value={scan} onChange={(e) => setScan(e.target.value)} maxLength={40} />
            <button className="btn" type="submit" disabled={a.busy}>
              Add
            </button>
          </form>
          <input className="input" aria-label="Carrier" placeholder="Who carries it (driver, officer, courier)" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          <button className="btn" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'move.dispatch', movementId: m.id, carrier, expectedVersion: m.version }), 'Sent. The receiver checks each item.')}>
            Confirm it has left
          </button>
        </div>
      )}
      {receiver && (m.status === 'dispatched' || m.status === 'partly_received') && (openLines.some((l) => l.result === 'pending') || m.lotLines.some((l) => l.qtyReceived == null)) && (
        <button
          className="btn"
          disabled={a.busy}
          onClick={() =>
            a.run(
              () =>
                act({
                  kind: 'move.receive',
                  movementId: m.id,
                  lines: Object.entries(results)
                    .filter(([, r]) => r)
                    .map(([itemId, result]) => ({ itemId, result: result as 'received', note: notes[itemId] ?? '' })),
                  lotLines: Object.entries(lotQty)
                    .filter(([, q]) => q !== '')
                    .map(([lotId, q]) => ({ lotId, qty: Number(q) })),
                }),
              'Receipt recorded.',
            )
          }
        >
          Save what arrived
        </button>
      )}
      {m.type === 'sale' && m.status !== 'draft' && m.status !== 'cancelled' && <SalePapers data={data} m={m} />}
      {finance && (m.type === 'sale' || m.type === 'supplier_return') && !m.ownership && m.lines.some((l) => l.result === 'received') && (
        <div className="panel" style={{ display: 'grid', gap: 6 }}>
          <strong>Finance: record when ownership passes</strong>
          {m.type === 'sale' && (data.checks.ownershipPending.find((x) => x.id === m.id)?.missing ?? []).length > 0 && (
            <p className="notice" data-tone="warn">
              Not yet. Still missing: {data.checks.ownershipPending.find((x) => x.id === m.id)!.missing.join('; ')}.
            </p>
          )}
          <input className="input" type="date" aria-label="Ownership date" value={eff} onChange={(e) => setEff(e.target.value)} />
          <input className="input" aria-label="Sale terms" placeholder="Sale terms or contract clause" value={basis} onChange={(e) => setBasis(e.target.value)} />
          <button className="btn" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'move.ownership', movementId: m.id, effectiveOn: eff, basis }), 'Ownership recorded.')}>
            Record ownership
          </button>
        </div>
      )}
      <ErrorNotice error={a.error} />
    </div>
  );
}

// ---------- After-sale care ----------

const CARE_LABEL = { overdue: 'Service overdue', end_of_life: 'Past expected life', due_soon: 'Service due soon', ok: 'Up to date', not_set: 'Interval not set' } as const;
const CARE_TONE = { overdue: 'crit', end_of_life: 'crit', due_soon: 'warn', ok: 'ok', not_set: 'neutral' } as const;

/**
 * After-sale care (Fauzan, 6 Nov 2026): even after a sale, the seller keeps looking after each unit's health,
 * maintenance and life as a service, and the owning company watches the same list. The seller records service checks;
 * the owner asks for service. Neither moves the item or changes the owner.
 */
function Care({ data }: { data: ItemBoard }) {
  const a = useAction();
  const roles = rolesOf(data);
  const [filter, setFilter] = useState<'attention' | 'all'>('attention');
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<'service' | 'request'>('service');
  const [cond, setCond] = useState<'good' | 'worn' | 'damaged'>('good');
  const [note, setNote] = useState('');
  const [label, setLabel] = useState<string | null>(null);
  const handles = (p: string | null, ...rs: Role[]) => !!p && (roles.get(p) ?? []).some((r) => rs.includes(r as Role));
  const rows = data.care
    .filter((c) => filter === 'all' || ['overdue', 'end_of_life', 'due_soon'].includes(c.status) || c.openServiceRequest)
    .sort((x, y) => (x.nextDue ?? '9999').localeCompare(y.nextDue ?? '9999'));
  const count = (k: keyof typeof CARE_LABEL) => data.care.filter((c) => c.status === k).length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>After-sale care: health, service and life</h3>
      </div>
      <p className="muted">
        Every unit your company owns, holds or sold and still looks after. The seller keeps servicing what it sold, and the owning company sees the same dates
        and can ask for service. Service intervals and expected life come from each item type; where none is set it says so, and nothing is assumed.
      </p>
      <div className="kpis">
        <Kpi label="Service overdue" value={count('overdue')} tone={count('overdue') ? 'crit' : 'ok'} />
        <Kpi label="Due in 14 days" value={count('due_soon')} tone={count('due_soon') ? 'warn' : 'ok'} />
        <Kpi label="Past expected life" value={count('end_of_life')} tone={count('end_of_life') ? 'crit' : 'ok'} />
        <Kpi label="Service requests open" value={data.care.filter((c) => c.openServiceRequest).length} tone={data.care.some((c) => c.openServiceRequest) ? 'warn' : 'ok'} />
        <Kpi label="Interval not set" value={count('not_set')} tone="neutral" />
      </div>
      <div className="seg" style={{ margin: '8px 0' }}>
        <button aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')}>
          Needs attention
        </button>
        <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All ({data.care.length})
        </button>
      </div>
      <div className="list">
        {!rows.length && <div className="empty">Nothing needs attention.</div>}
        {rows.slice(0, 200).map((c) => {
          const seller = handles(c.seller, 'store', 'manager', 'it');
          const owner = handles(c.ownerPartyId, 'store', 'manager', 'it', 'ops') || handles(c.holderPartyId, 'store', 'manager', 'it', 'ops');
          return (
            <div key={c.itemId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                <button className="link-button" onClick={() => setLabel(c.token)} style={{ textAlign: 'left' }}>
                  <strong>{skuName(data, c.skuId)}</strong>
                  <div className="muted small mono">{labelDisplay(c.token)}</div>
                </button>
                <Chip tone={CARE_TONE[c.status]}>{CARE_LABEL[c.status]}</Chip>
              </div>
              <div className="muted small">
                Owner {partyName(data, c.ownerPartyId)}
                {c.seller ? ` · sold by ${partyName(data, c.seller)} (after-sale care)` : ''} · condition {c.condition} · last check {dateLabel(c.lastCheck.slice(0, 10))}
                {c.nextDue ? ` · next service ${dateLabel(c.nextDue)}` : ''} · age {c.ageMonths} month(s){c.lifeEnds ? `, life ends ${dateLabel(c.lifeEnds)}` : ''} · {c.services} service(s)
                {c.openServiceRequest ? ` · service request ${c.openServiceRequest} open` : ''}
              </div>
              {(seller || owner) && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setOpen(open === c.itemId && mode === 'service' ? null : c.itemId);
                      setMode('service');
                    }}
                  >
                    Record service check
                  </button>
                  {owner && c.seller && !c.openServiceRequest && (
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setOpen(open === c.itemId && mode === 'request' ? null : c.itemId);
                        setMode('request');
                      }}
                    >
                      Ask {partyName(data, c.seller)} for service
                    </button>
                  )}
                </div>
              )}
              {open === c.itemId && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {mode === 'service' && (
                    <select className="input" aria-label="Condition found" value={cond} onChange={(e) => setCond(e.target.value as typeof cond)}>
                      <option value="good">Good</option>
                      <option value="worn">Worn</option>
                      <option value="damaged">Damaged</option>
                    </select>
                  )}
                  <input className="input" aria-label={mode === 'service' ? 'What was checked or serviced' : 'What is wrong'} placeholder={mode === 'service' ? 'What was checked or serviced' : 'What is wrong or what service is needed'} value={note} onChange={(e) => setNote(e.target.value)} />
                  <button
                    className="btn btn-sm"
                    disabled={a.busy}
                    onClick={() =>
                      a
                        .run(
                          () => act(mode === 'service' ? { kind: 'item.service', label: c.token, condition: cond, note } : { kind: 'service.request', label: c.token, note }),
                          mode === 'service' ? 'Service check recorded.' : 'Service requested.',
                        )
                        .then((r) => {
                          if (r) {
                            setOpen(null);
                            setNote('');
                          }
                        })
                    }
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ErrorNotice error={a.error} />
      {label && <Passport data={data} label={label} onClose={() => setLabel(null)} />}
    </section>
  );
}

/** Service interval and expected life per item type, entered by a central store manager with the source. */
function CareSettings({ data }: { data: ItemBoard }) {
  const a = useAction();
  const roles = rolesOf(data);
  const mgr = ['goodwill', 'pwvsb', 'merdeka'].some((p) => (roles.get(p) ?? []).includes('manager')) || (roles.get('merdeka') ?? []).includes('it');
  const [sku, setSku] = useState('');
  const [every, setEvery] = useState('');
  const [life, setLife] = useState('');
  const [why, setWhy] = useState('');
  const set = data.skus.filter((s) => s.care);
  if (!mgr && !set.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Service interval and expected life</h3>
      </div>
      <p className="muted">How often a unit of each type is checked or serviced, and how long it should last. Entered from the maker's manual, contract or policy; never assumed.</p>
      <div className="list">
        {!set.length && <div className="empty">Not set for any item type yet.</div>}
        {set.map((s) => (
          <div key={s.id} className="list-item">
            <div>
              <strong>{s.code}</strong>
              <div className="muted small">
                Check every {s.care!.everyDays ?? 'not set'} days · expected life {s.care!.lifeMonths ?? 'not set'} months · {s.care!.reason} ({s.care!.by})
              </div>
            </div>
          </div>
        ))}
      </div>
      {mgr && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <select className="input" aria-label="Item type" value={sku} onChange={(e) => setSku(e.target.value)}>
            <option value="">Item type…</option>
            {data.skus
              .filter((s) => s.tracking !== 'BULK')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
          </select>
          <input className="input" style={{ width: 130 }} inputMode="numeric" aria-label="Days between checks" placeholder="Days between checks" value={every} onChange={(e) => setEvery(e.target.value)} />
          <input className="input" style={{ width: 130 }} inputMode="numeric" aria-label="Expected life in months" placeholder="Life in months" value={life} onChange={(e) => setLife(e.target.value)} />
          <input className="input" aria-label="Source" placeholder="Source: maker manual, contract, policy" value={why} onChange={(e) => setWhy(e.target.value)} />
          <button
            className="btn btn-sm"
            disabled={a.busy || !sku}
            onClick={() =>
              a.run(() => act({ kind: 'sku.care', skuId: sku, everyDays: every.trim() ? Number(every) : null, lifeMonths: life.trim() ? Number(life) : null, reason: why }), 'Saved.')
            }
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={a.error} />
    </section>
  );
}

// ---------- Sale papers ----------

const readFile = (f: File) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(new Error('The file could not be read.'));
    r.readAsDataURL(f);
  });

/**
 * The four things a sale needs before ownership passes (Fauzan, 6 Nov 2026): the receipt, the seller's invoice, the
 * buyer's payment slip and the buyer's signed letter of acknowledgement of the items received.
 */
function SalePapers({ data, m }: { data: ItemBoard; m: ItemBoard['movements'][number] }) {
  const a = useAction();
  const roles = rolesOf(data);
  const sellerFinance = (roles.get(m.fromPartyId) ?? []).includes('finance');
  const buyerFinance = (roles.get(m.toPartyId) ?? []).includes('finance');
  const buyerManager = (roles.get(m.toPartyId) ?? []).includes('manager');
  const papers = m.papers ?? [];
  const cur = new Map(papers.map((p) => [p.kind, p]));
  const received = m.lines.some((l) => l.result === 'received') || m.lotLines.some((l) => (l.qtyReceived ?? 0) > 0);
  const [open, setOpen] = useState<SalePaperKind | null>(null);
  const [ref, setRef] = useState('');
  const [date, setDate] = useState('');
  const [signedBy, setSignedBy] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const may = (k: SalePaperKind) => !m.ownership && (k === 'invoice' ? sellerFinance : k === 'payment_slip' ? buyerFinance && !!cur.get('invoice') : buyerManager);
  const view = async (id: string) => {
    const d = await api.itemPaper(id);
    // Open the stored file as a local copy; nothing is sent anywhere.
    const bin = atob(d.data.slice(d.data.indexOf(',') + 1));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: d.mime }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const save = async () => {
    if (!open) return;
    const doc = file ? { name: file.name, data: await readFile(file) } : null;
    const r = await a.run(
      () =>
        open === 'acknowledgement'
          ? act({ kind: 'move.acknowledge', movementId: m.id, ref, date, signedBy, doc, reason })
          : act({ kind: 'move.paper', movementId: m.id, paper: open, ref, date, doc: doc ?? { name: '', data: '' }, reason }),
      'Paper recorded.',
    );
    if (r) {
      setOpen(null);
      setRef('');
      setDate('');
      setReason('');
      setFile(null);
    }
  };
  const rows: [string, boolean, string][] = [
    ['Goods received and checked', received, received ? `${m.lines.filter((l) => l.result === 'received').length} unit(s) received` : 'Not yet'],
    ...(['invoice', 'payment_slip', 'acknowledgement'] as SalePaperKind[]).map((k): [string, boolean, string] => {
      const p = cur.get(k);
      return [SALE_PAPER_LABEL[k], !!p, p ? `${p.ref}, dated ${dateLabel(p.date)}, by ${p.by}` : 'Missing'];
    }),
  ];
  const ack = cur.get('acknowledgement');
  return (
    <div className="panel" style={{ display: 'grid', gap: 8 }}>
      <strong>Sale papers: ownership passes only when all four are in</strong>
      <div className="list">
        {rows.map(([label, ok, note]) => (
          <div key={label} className="list-item">
            <div>
              <div>{label}</div>
              <div className="muted small">{note}</div>
            </div>
            <Chip tone={ok ? 'ok' : 'warn'}>{ok ? 'In' : 'Missing'}</Chip>
          </div>
        ))}
      </div>
      {papers.some((p) => p.docId) && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {papers
            .filter((p) => p.docId)
            .map((p) => (
              <button key={`${p.kind}-${p.at}`} className="btn btn-sm" onClick={() => void view(p.docId!)}>
                Open {SALE_PAPER_LABEL[p.kind].split(' (')[0].toLowerCase()} {p.ref}
              </button>
            ))}
        </div>
      )}
      {ack?.letter && (
        <div className="panel item-letter" style={{ background: '#fff', color: '#111' }}>
          <strong>Letter of acknowledgement {ack.ref}</strong>
          <p style={{ margin: '6px 0' }}>{ack.letter.text}</p>
          <span className="small">Dated {dateLabel(ack.date)} · recorded by {ack.by}</span>
        </div>
      )}
      {!m.ownership && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {(['invoice', 'payment_slip', 'acknowledgement'] as SalePaperKind[])
            .filter(may)
            .map((k) => (
              <button key={k} className="btn btn-sm" aria-pressed={open === k} onClick={() => setOpen(open === k ? null : k)}>
                {cur.get(k) ? 'Replace' : k === 'acknowledgement' ? 'Sign' : 'Attach'} {SALE_PAPER_LABEL[k].split(' (')[0].toLowerCase()}
              </button>
            ))}
        </div>
      )}
      {open && (
        <div style={{ display: 'grid', gap: 6 }}>
          {open === 'acknowledgement' && (
            <span className="muted small">
              The letter is made from the receipt as it stands now: only items received in good order are acknowledged. Damaged, missing and wrong items stay
              with their cases. The person who checked the goods in does not also sign.
            </span>
          )}
          <input className="input" aria-label="Paper reference" placeholder={open === 'invoice' ? 'Invoice number' : open === 'payment_slip' ? 'Payment or bank reference' : 'Letter reference'} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} />
          <input className="input" type="date" aria-label="Date on the paper" value={date} onChange={(e) => setDate(e.target.value)} />
          {open === 'acknowledgement' && <input className="input" aria-label="Signed by" placeholder="Name and position of the person signing" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} />}
          <label className="field">
            <span className="label">{open === 'acknowledgement' ? 'Signed copy (optional, PDF or photo)' : 'Scanned paper (PDF or photo)'}</span>
            <input className="input" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {cur.get(open) && <input className="input" aria-label="Why it is replaced" placeholder="Why the earlier paper is replaced" value={reason} onChange={(e) => setReason(e.target.value)} />}
          <button className="btn" disabled={a.busy || (open !== 'acknowledgement' && !file)} onClick={() => void save()}>
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={a.error} />
    </div>
  );
}

// ---------- Cases ----------

const OUTCOMES: Record<string, string[]> = {
  short: ['arrived', 'lost'],
  damaged: ['usable', 'repair', 'dispose'],
  wrong_item: ['sent_back', 'kept_with_approval'],
  wrong_place: ['checked'],
  dispute: ['person_has_it', 'back_in_store', 'missing'],
  missing: ['found', 'confirmed_lost'],
  count_not_found: ['found', 'report_missing'],
  count_extra: ['checked'],
  label_mismatch: ['identity_confirmed', 'label_withdrawn'],
  dispose: ['approved', 'rejected'],
};

function Cases({ data }: { data: ItemBoard }) {
  const [all, setAll] = useState(false);
  const rows = data.cases.filter((c) => all || c.status === 'open');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Cases</h3>
        <button className="btn btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Open only' : 'Show closed'}
        </button>
      </div>
      <p className="muted">Differences stay open until someone closes them with a reason. A loss or disposal is decided by a manager who did not open the case.</p>
      <div className="list">
        {!rows.length && <div className="empty">No open cases.</div>}
        {rows.map((c) => (
          <CaseRow key={c.id} data={data} c={c} />
        ))}
      </div>
    </section>
  );
}

function CaseRow({ data, c }: { data: ItemBoard; c: ItemBoard['cases'][number] }) {
  const a = useAction();
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>
          {c.ref} {c.kind.replace(/_/g, ' ')} · {partyName(data, c.partyId)}
        </strong>
        <Chip tone={c.status === 'open' ? 'warn' : 'ok'}>{c.status}</Chip>
      </div>
      <div className="muted">
        {c.note} ({c.openedBy}, {dateTimeLabel(c.at)})
      </div>
      {c.resolution && (
        <div>
          Closed: {c.resolution.outcome.replace(/_/g, ' ')} by {c.resolution.by}. {c.resolution.note}
        </div>
      )}
      {c.status === 'open' && data.roles.some((r) => r.partyId === c.partyId && r.roles.some((x) => x !== 'view' && x !== 'finance')) && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="input" aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Close as…</option>
            {(OUTCOMES[c.kind] ?? []).map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input className="input" placeholder="Reason and the proof you checked" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-sm" disabled={a.busy || !outcome} onClick={() => a.run(() => act({ kind: 'case.resolve', caseId: c.id, outcome, note }), 'Case closed.')}>
            Close case
          </button>
        </div>
      )}
      <ErrorNotice error={a.error} />
    </div>
  );
}

// ---------- Counts ----------

function Counts({ data }: { data: ItemBoard }) {
  const a = useAction();
  const roles = rolesOf(data);
  const parties = data.parties.filter((p) => (roles.get(p.id) ?? []).some((r) => r !== 'view' && r !== 'finance'));
  const [partyId, setPartyId] = useState(parties[0]?.id ?? '');
  const [site, setSite] = useState('');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Counts</h3>
      </div>
      <p className="muted">A count takes a snapshot at the start. Anything not scanned is "not found yet", never lost straight away. Nothing is adjusted without a recount and a case.</p>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <select className="input" aria-label="Company" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Site ID (empty: the store)" value={site} onChange={(e) => setSite(e.target.value)} />
        <button className="btn" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'count.start', partyId, siteId: site.trim() || undefined }), 'Count started.')}>
          Start count
        </button>
      </div>
      <ErrorNotice error={a.error} />
      <div className="list">
        {data.counts.map((c) => (
          <div key={c.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <strong>
              {c.where.label}: {c.found.length} of {c.expected.length} found{c.extra.length ? `, ${c.extra.length} not expected here` : ''}
            </strong>
            <span className="muted">
              Started {dateTimeLabel(c.cutoffAt)} by {c.startedBy}
              {c.closed ? ` · closed, ${c.closed.notFound.length} not found, ${c.closed.movedAfterCutoff.length} moved after the start` : ''}
            </span>
            {!c.closed && (
              <div style={{ display: 'grid', gap: 6 }}>
                <ScanBox label="Scan each label or tag" button="Scan" busy={a.busy} onScan={(v) => a.run(() => act({ kind: 'count.scan', countId: c.id, label: v }))} />
                <details>
                  <summary className="muted small">Many RFID reads at once</summary>
                  <ReadsBox
                    button="Count all read"
                    busy={a.busy}
                    onSend={(reads) =>
                      a.run(
                        () => act({ kind: 'count.scanMany', countId: c.id, reads }),
                        (r) => {
                          const x = (r as { result: { found: number; extra: number; already: number; unknown: string[] } }).result;
                          return `${x.found} found, ${x.extra} not expected here, ${x.already} already counted, ${x.unknown.length} unknown tags (set aside and check).`;
                        },
                      )
                    }
                  />
                </details>
                <button className="btn btn-sm" type="button" style={{ justifySelf: 'start' }} onClick={() => a.run(() => act({ kind: 'count.close', countId: c.id }), 'Count closed.')}>
                  Close count
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Catalogue ----------

function Catalogue({ data }: { data: ItemBoard }) {
  const a = useAction();
  const [form, setForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ItemCategory>('uniform');
  const [tracking, setTracking] = useState<TrackingMode>('SERIALIZED');
  const [uom, setUom] = useState<BaseUom>('PCS');
  const [size, setSize] = useState('');
  const [consumable, setConsumable] = useState(false);
  const [map, setMap] = useState<Record<string, { party: string; code: string }>>({});
  const financeParties = data.roles.filter((r) => r.roles.includes('finance')).map((r) => r.partyId);
  return (
    <>
    <TagChoice data={data} />
    <CareSettings data={data} />
    <section className="panel">
      <div className="panel-head">
        <h3>Item types (catalogue)</h3>
        {any(data, 'store', 'manager', 'it') && (
          <button className="btn btn-sm" onClick={() => setForm(!form)}>
            New item type
          </button>
        )}
      </div>
      <p className="muted">
        The item type says what it is, its size and unit. Many units share one type, but each unit tracked one by one has its own label. How a type is
        tracked is set once.
      </p>
      {form && (
        <div className="panel" style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
          <input className="input" placeholder="Code, e.g. SHIRT-NAVY-L" value={code} onChange={(e) => setCode(e.target.value)} />
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="input" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as ItemCategory)}>
            {ITEM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CAT_LABEL[c]}
              </option>
            ))}
          </select>
          <select className="input" aria-label="Tracking" value={tracking} onChange={(e) => setTracking(e.target.value as TrackingMode)}>
            <option value="SERIALIZED">Each unit has its own label</option>
            <option value="BULK">Counted by quantity</option>
          </select>
          <select className="input" aria-label="Unit" value={uom} onChange={(e) => setUom(e.target.value as BaseUom)}>
            {['PCS', 'PAIR', 'SET', 'BOX', 'BOTTLE', 'LITRE', 'ROLL'].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          <input className="input" placeholder="Size (optional)" value={size} onChange={(e) => setSize(e.target.value)} />
          {tracking === 'BULK' && (
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={consumable} onChange={(e) => setConsumable(e.target.checked)} /> Used up (not expected back)
            </label>
          )}
          <button className="btn" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'sku.add', code, name, category, tracking, uom, size, consumable }), 'Item type added.').then((r) => r && setForm(false))}>
            Save
          </button>
        </div>
      )}
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
                      <select className="input" aria-label="Book" value={map[s.id]?.party ?? ''} onChange={(e) => setMap({ ...map, [s.id]: { party: e.target.value, code: map[s.id]?.code ?? '' } })}>
                        <option value="">Book…</option>
                        {financeParties.map((p) => (
                          <option key={p} value={p}>
                            {partyName(data, p)}
                          </option>
                        ))}
                      </select>
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
function TagChoice({ data }: { data: ItemBoard }) {
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
                  <select className="input" aria-label="Tagging method" value={next} onChange={(e) => setPick({ ...pick, [t.partyId]: e.target.value as TagMethod })}>
                    {TAG_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {TAG_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </select>
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

function Sql({ data }: { data: ItemBoard }) {
  const c = data.checks;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Finance and SQL Account</h3>
      </div>
      <p className="notice" data-tone="warn">
        Not connected. Nothing on this page has been sent to SQL Account. Each line shows the document each company's book would need, and why it is not
        ready. A movement can be received physically while its documents are still not posted.
      </p>
      <div className="kpis">
        <Kpi label="Documents waiting" value={data.syncJobs.length} />
        <Kpi label="One side only" value={c.oneSidedDocuments.length} tone={c.oneSidedDocuments.length ? 'warn' : 'ok'} />
        <Kpi label="Ownership to record" value={c.ownershipPending.length} tone={c.ownershipPending.length ? 'warn' : 'ok'} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Book</th>
              <th>Document</th>
              <th>Movement</th>
              <th>Lines</th>
              <th>Status</th>
              <th>Why not ready</th>
            </tr>
          </thead>
          <tbody>
            {data.syncJobs.map((j) => (
              <tr key={j.id}>
                <td>{partyName(data, j.partyId)}</td>
                <td>{j.docType.replace(/_/g, ' ')}</td>
                <td>
                  {data.movements.find((m) => m.id === j.sourceId)?.ref ?? ''} {j.payload.commercialRef ? `(${j.payload.commercialRef})` : ''} r{j.revision}
                </td>
                <td>{j.payload.lines.map((l) => `${l.itemCode ?? '(no code)'} × ${l.qty}`).join(', ')}</td>
                <td>
                  <Chip tone="warn">{j.status.replace('_', ' ')}</Chip>
                </td>
                <td>{j.reasons.join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 12 }}>Legal entities</h3>
      <div className="list">
        {data.parties.map((p) => (
          <div key={p.id} className="list-item">
            <div>
              <strong>{p.name}</strong>
              <div className="muted">{p.note}</div>
            </div>
            <Chip tone="warn">not verified</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- My items ----------

function Mine({ data }: { data: ItemBoard }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Items with me</h3>
      </div>
      <p className="muted">
        What the company has handed to you. Scan each item's label to confirm you got it, or say if you did not. You can also confirm on the post's shared
        device with your face. Nothing is ever charged to you automatically.
      </p>
      {data.myUniform && (
        <p className="notice" data-tone="info">
          Uniform this year: {data.myUniform.free} free piece(s) in the last 12 months (at least {data.myUniform.rule.minPerYear}, at most {data.myUniform.rule.maxPerYear})
        {data.myUniform.paid ? `, plus ${data.myUniform.paid} you paid for` : ''}. A 4th or 5th piece is paid by you.
          {data.myUniform.nextDue ? ` Next piece usually from ${dateLabel(data.myUniform.nextDue)}.` : ' You can ask your store for one.'}
        </p>
      )}
      <div className="list">
        {!data.mine.length && <div className="empty">Nothing is recorded with you.</div>}
        {data.mine.map(({ item, sku }) => (
          <div key={item.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{sku ? sku.name : 'Item'}</strong>
              {item.pendingAck ? <Chip tone="warn">Please confirm</Chip> : <Chip tone="ok">Confirmed</Chip>}
            </div>
            <span className="muted">{labelDisplay(item.token)}</span>
            {item.pendingAck && <ConfirmMine label={item.token} onDone={() => undefined} />}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Uniform allowance ----------

const UNIFORM_LABEL = { due: 'Due now', ok: 'Not due yet', at_max: 'Had 3 free; more paid by guard' } as const;
const UNIFORM_TONE = { due: 'warn', ok: 'ok', at_max: 'neutral' } as const;

function Uniforms({ data }: { data: ItemBoard }) {
  const u = data.uniforms;
  const [filter, setFilter] = useState<'due' | 'all'>('due');
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const rows = u.rows.filter((r) => (filter === 'all' || r.status === 'due') && (!term || r.name.toLowerCase().includes(term) || r.staffNo.toLowerCase().includes(term)));
  const n = (k: keyof typeof UNIFORM_LABEL) => u.rows.filter((r) => r.status === k).length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Uniform allowance per guard</h3>
      </div>
      <p className="muted">
        Each guard gets at least {u.rule.minPerYear} and at most {u.rule.maxPerYear} uniform pieces a year, usually one every {u.rule.everyMonths} months ({u.rule.source}).
        Counted over the last 12 months; a uniform set counts as one piece. Handing one over sooner needs a reason. A 4th or 5th piece is paid by the guard, with the receipt recorded; more than {u.rule.paidMaxPerYear} is
        refused. Pieces given before this register count only once a manager records them below.
      </p>
      <div className="kpis">
        <Kpi label="Due now" value={n('due')} tone={n('due') ? 'warn' : 'ok'} />
        <Kpi label={`Below ${u.rule.minPerYear} this year`} value={u.rows.filter((r) => r.belowMin).length} tone="neutral" />
        <Kpi label={`Had ${u.rule.maxPerYear} this year`} value={n('at_max')} tone="neutral" />
        <Kpi label="Guards" value={u.rows.length} tone="neutral" />
      </div>
      {u.recordsFor.length > 0 && <PastUniforms data={data} />}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
        <div className="seg">
          <button aria-pressed={filter === 'due'} onClick={() => setFilter('due')}>
            Due now
          </button>
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All ({u.rows.length})
          </button>
        </div>
        <input className="input" aria-label="Find a guard" placeholder="Name or staff number" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="list">
        {!rows.length && <div className="empty">No guard here.</div>}
        {rows.slice(0, 200).map((r) => (
          <div key={r.personId} className="list-item" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
            <div>
              <strong>{r.name}</strong>
              <div className="muted small">
                {r.staffNo} · {partyName(data, r.companyId)}
                {r.siteName ? ` · ${r.siteName}` : ''}
                {r.zone ? ` · ${r.zone}` : ''} · {r.free} of {u.rule.maxPerYear} free{r.paid ? ` + ${r.paid} paid` : ''} in 12 months · last {r.last ? dateLabel(r.last) : 'none recorded'}
                {r.status === 'ok' ? ` · next from ${dateLabel(r.nextDue)}` : ''}
              </div>
            </div>
            <Chip tone={UNIFORM_TONE[r.status]}>{UNIFORM_LABEL[r.status]}</Chip>
          </div>
        ))}
        {rows.length > 200 && <div className="muted small">Showing 200 of {rows.length}. Search by name or staff number to find others.</div>}
      </div>
      <p className="muted small">To hand over a piece, open the uniform from Find or scan and choose "Hand to a person". The person confirms it in their own sign-in or on the post device.</p>
    </section>
  );
}

/** Bulk entry of pieces handed over before this register: one guard, a site, a zone (state) or a region. */
function PastUniforms({ data }: { data: ItemBoard }) {
  const u = data.uniforms;
  const a = useAction();
  const [company, setCompany] = useState(u.recordsFor[0] ?? '');
  const [kind, setKind] = useState<'site' | 'zone' | 'region' | 'person'>('zone');
  const [id, setId] = useState('');
  const [on, setOn] = useState('');
  const [pieces, setPieces] = useState('1');
  const [reason, setReason] = useState('');
  const [out, setOut] = useState<{ scope: string; recorded: number; skipped: { staffNo: string; why: string }[] } | null>(null);
  const mine = u.rows.filter((r) => r.companyId === company);
  const options: [string, string][] =
    kind === 'site'
      ? [...new Map(mine.filter((r) => r.siteId).map((r) => [r.siteId!, r.siteName ?? r.siteId!])).entries()]
      : kind === 'zone'
        ? [...new Set(mine.map((r) => r.zone).filter((z): z is string => !!z))].sort().map((z) => [z, z])
        : kind === 'region'
          ? u.regions.filter((g) => mine.some((r) => r.regionId === g.id)).map((g) => [g.id, g.name])
          : [];
  const matched =
    kind === 'site'
      ? mine.filter((r) => r.siteId === id)
      : kind === 'zone'
        ? mine.filter((r) => r.zone === id)
        : kind === 'region'
          ? mine.filter((r) => r.regionId === id)
          : mine.filter((r) => r.staffNo === id.trim().toUpperCase());
  return (
    <details className="panel" style={{ margin: '8px 0' }}>
      <summary>
        <strong>Record past pieces</strong> <span className="muted small">(given before this register, for one guard or a whole site, zone or region)</span>
      </summary>
      <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
        {u.recordsFor.length > 1 && (
          <select className="input" aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
            {u.recordsFor.map((p) => (
              <option key={p} value={p}>
                {partyName(data, p)}
              </option>
            ))}
          </select>
        )}
        <div className="seg">
          {(['site', 'zone', 'region', 'person'] as const).map((k) => (
            <button
              key={k}
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setId('');
              }}
            >
              {k === 'site' ? 'Site' : k === 'zone' ? 'Zone (state)' : k === 'region' ? 'Region' : 'One guard'}
            </button>
          ))}
        </div>
        {kind === 'person' ? (
          <input className="input" aria-label="Staff number" placeholder="Staff number" value={id} onChange={(e) => setId(e.target.value)} />
        ) : (
          <select className="input" aria-label={kind === 'site' ? 'Site' : kind === 'zone' ? 'Zone' : 'Region'} value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Choose…</option>
            {options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        )}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <label className="small">
            Date handed over <input className="input" type="date" aria-label="Date handed over" value={on} onChange={(e) => setOn(e.target.value)} max={data.today} />
          </label>
          <label className="small">
            Pieces per guard{' '}
            <select className="input" aria-label="Pieces per guard" value={pieces} onChange={(e) => setPieces(e.target.value)}>
              {[1, 2, 3].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <input
          className="input"
          aria-label="Where this comes from"
          placeholder="Where this comes from (for example: store issue book, June 2026)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
        />
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn"
            disabled={a.busy || !id.trim() || !on || reason.trim().length < 5}
            onClick={() =>
              a.run(() => act({ kind: 'uniform.past', companyId: company, scope: { kind, id: id.trim() }, on, pieces: Number(pieces), reason: reason.trim() }), 'Past pieces recorded.').then((r) => {
                if (r) setOut(r.result as never);
              })
            }
          >
            Record for {matched.length} guard{matched.length === 1 ? '' : 's'}
          </button>
          <span className="muted small">Each guard is checked on their own; anyone who would go over {u.rule.maxPerYear} free pieces is skipped and listed.</span>
        </div>
        <ErrorNotice error={a.error} />
        {out && (
          <p className="notice" data-tone={out.skipped.length ? 'warn' : 'ok'}>
            {out.scope}: recorded for {out.recorded} guard(s).
            {out.skipped.length
              ? ` Skipped ${out.skipped.length}: ${out.skipped
                  .slice(0, 5)
                  .map((x) => `${x.staffNo} (${x.why})`)
                  .join('; ')}${out.skipped.length > 5 ? '…' : ''}`
              : ''}
          </p>
        )}
      </div>
    </details>
  );
}
