// Sending and receiving (P85; paper sections 3.3 to 3.5). The sender scans each unit against the pick list; the receiver,
// a different person, scans what arrived. Receipt scans are staged on the phone, marked "not saved", and committed in
// one go with a result per line; a unit not on the delivery opens a case and is not received. A sale never changes the
// owner by itself: Finance records ownership with the sale papers.
import { Select } from '../../SearchSelect';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRightIcon, PackageIcon, TruckIcon, XIcon } from '@phosphor-icons/react';
import { labelDisplay, type ScanEntry } from '@prima/core';
import { ApiError, type ItemBoard } from '../../api';
import { Card, Empty, Facts, Search, Steps, Toolbar, type StepState } from '../../kit';
import { Chip, Drawer, ErrorNotice, dateLabel, dateTimeLabel, useAction } from '../../ui';
import { SalePapers } from './SalePapers';
import { Scanner } from './Scanner';
import { FilterChips, LINE_TONE, MOVE_TONE, TYPE_LABEL, TabIntro, act, any, hasText, partyName, rolesOf, skuName } from './shared';

type Move = ItemBoard['movements'][number];

// P98: a list to search and filter (open, in transit, received), the main action at the top, and an empty state that
// says what to do first.
const OPEN_MOVE = (x: Move) => x.status !== 'received' && x.status !== 'cancelled';
export function Moves({ data }: { data: ItemBoard }) {
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [show, setShow] = useState<'open' | 'transit' | 'done' | 'all'>(data.movements.some(OPEN_MOVE) ? 'open' : 'all');
  const [q, setQ] = useState('');
  const m = data.movements.find((x) => x.id === open) ?? null;
  const mayMove = any(data, 'store', 'manager', 'ops', 'it');
  const pick = (x: Move) => (show === 'open' ? OPEN_MOVE(x) : show === 'transit' ? x.status === 'dispatched' || x.status === 'partly_received' : show === 'done' ? !OPEN_MOVE(x) : true);
  const list = data.movements.filter((x) => pick(x) && hasText(q, x.ref, TYPE_LABEL[x.type], partyName(data, x.fromPartyId), x.to.label, x.purpose, x.commercialRef));
  const newButton = mayMove && !form && (
    <button className="btn btn-primary" type="button" onClick={() => setForm(true)}>
      <TruckIcon size={16} aria-hidden="true" /> New movement
    </button>
  );
  return (
    <div className="it-stack">
      <TabIntro
        title="Send and receive"
        sub="Sales, rentals, loans, transfers and returns between companies and sites. The sender scans each item out; the receiver scans what arrived. A sale changes the owner only when Finance records it."
        actions={newButton || undefined}
      />
      {form && <NewMove data={data} onDone={(id) => (setForm(false), id && setOpen(id))} />}
      {data.checks.inTransit.length > 0 && mayMove && <ReceiveByScan />}
      <Card title="Movements" flush>
        <div className="it-pad">
          <Toolbar>
            <Search value={q} onChange={setQ} placeholder="Search reference, company or site" />
          </Toolbar>
          <FilterChips
            label="Show"
            value={show}
            onChange={setShow}
            options={[
              ['open', 'Open', data.movements.filter(OPEN_MOVE).length],
              ['transit', 'In transit', data.movements.filter((x) => x.status === 'dispatched' || x.status === 'partly_received').length],
              ['done', 'Done', data.movements.filter((x) => !OPEN_MOVE(x)).length],
              ['all', 'All', data.movements.length],
            ]}
          />
        </div>
        {!data.movements.length ? (
          <Empty title="No movements yet." action={newButton || undefined}>
            {mayMove ? 'Start one to send items to another company or a site: pick the items, scan them out, and the receiver scans them in.' : 'Deliveries to and from your companies show here.'}
          </Empty>
        ) : !list.length ? (
          <Empty title="Nothing matches.">Change the search or choose another filter.</Empty>
        ) : (
          <ul className="it-rows">
            {list.map((x) => (
              <li key={x.id}>
                <button className="it-row it-row-btn" type="button" onClick={() => setOpen(x.id)}>
                  <span className="it-row-main">
                    <strong>
                      {x.ref} · {TYPE_LABEL[x.type]}
                    </strong>
                    <span className="muted">
                      {partyName(data, x.fromPartyId)} <ArrowRightIcon size={12} aria-hidden="true" /> {x.to.label} · {x.lines.length} units
                      {x.lotLines.length ? ` + ${x.lotLines.length} stock lines` : ''}
                    </span>
                  </span>
                  <Chip tone={MOVE_TONE[x.status]}>{x.status.replace('_', ' ')}</Chip>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {m && (
        <Drawer title={`${m.ref} ${TYPE_LABEL[m.type]}`} sub={`${partyName(data, m.fromPartyId)} → ${m.to.label}`} onClose={() => setOpen(null)}>
          <MoveDetail data={data} m={m} />
        </Drawer>
      )}
    </div>
  );
}

/** Arrival by scanning, any delivery: each scanned unit in transit to you is received on its own movement. */
function ReceiveByScan() {
  const a = useAction();
  const [last, setLast] = useState<string | null>(null);
  return (
    <Card title="Receive by scanning" sub="Scan each item that arrived. Only deliveries to you are received, never by the person who sent them. Items not scanned stay waiting.">
      <Scanner
        purpose="view"
        title="Scan an item that arrived"
        continuous
        busy={a.busy}
        onResult={({ verdict, entry }) =>
          verdict.outcome === 'ok' &&
          a.run(
            () => act({ kind: 'move.receiveScan', scans: [entry] }),
            (r) => {
              const out = (r as { result: { received: { ref: string; count: number }[]; notInTransit: string[]; superseded: string[] } }).result;
              const msg = out.received.length ? `Received on ${out.received.map((x) => x.ref).join(', ')}.` : out.notInTransit.length ? 'Not in transit to you.' : out.superseded.length ? 'Old copy of the label: not received.' : 'Nothing received.';
              setLast(msg);
              return msg;
            },
          )
        }
      />
      {last && <p className="muted">{last}</p>}
      <ErrorNotice error={a.error} />
    </Card>
  );
}

function NewMove({ data, onDone }: { data: ItemBoard; onDone: (id?: string) => void }) {
  const a = useAction();
  const roles = rolesOf(data);
  const mine = data.parties.filter((p) => (roles.get(p.id) ?? []).some((r) => r !== 'view' && r !== 'finance' && r !== 'hr'));
  const [type, setType] = useState<keyof typeof TYPE_LABEL>('sale');
  const [from, setFrom] = useState((mine.find((p) => p.id === 'goodwill') ?? mine.find((p) => p.kind === 'security_company') ?? mine[0])?.id ?? '');
  const [to, setTo] = useState('');
  const [site, setSite] = useState('');
  const [purpose, setPurpose] = useState('');
  const [due, setDue] = useState('');
  const [orig, setOrig] = useState('');
  const [pick, setPick] = useState<{ skuId: string; qty: string }[]>([]);
  const targets = data.parties.filter((p) => (type === 'transfer' ? p.id === from : p.id !== from));
  const toParty = type === 'transfer' ? from : to;
  return (
    <Card
      title="New movement"
      sub="Prepare it, scan each unit onto it against the pick list, then confirm it has left."
      actions={
        <button className="btn" type="button" onClick={() => onDone()}>
          Cancel
        </button>
      }
    >
      <div className="it-form">
        <div className="seg it-seg" role="group" aria-label="Type">
          {Object.entries(TYPE_LABEL).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={type === v} onClick={() => setType(v as typeof type)}>
              {l}
            </button>
          ))}
        </div>
        <label className="isc-field">
          From
          <Select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
            {mine.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        {type !== 'transfer' && (
          <label className="isc-field">
            To
            <Select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose the company…</option>
              {targets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="isc-field">
          Receiving site (empty for the store)
          <input className="input" list="it-sites" value={site} placeholder="Site ID" onChange={(e) => setSite(e.target.value)} />
          <datalist id="it-sites">
            {data.siteChoices
              .filter((s) => s.companyId === toParty)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </datalist>
        </label>
        <label className="isc-field">
          What it is for
          <input className="input" value={purpose} placeholder="Request, site or reason" onChange={(e) => setPurpose(e.target.value)} />
        </label>
        {(type === 'rental' || type === 'loan') && (
          <label className="isc-field">
            Due back
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        )}
        {type === 'supplier_return' && (
          <label className="isc-field">
            Original sale
            <Select className="input" value={orig} onChange={(e) => setOrig(e.target.value)}>
              <option value="">Choose the sale…</option>
              {data.movements
                .filter((m) => m.type === 'sale' && m.toPartyId === from)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.ref} from {partyName(data, m.fromPartyId)}
                  </option>
                ))}
            </Select>
          </label>
        )}
        <fieldset className="it-pick">
          <legend>Pick list (optional): what to send</legend>
          {pick.map((p, k) => (
            <div key={k} className="it-pick-row">
              <Select className="input" aria-label="Item type" value={p.skuId} onChange={(e) => setPick(pick.map((x, j) => (j === k ? { ...x, skuId: e.target.value } : x)))}>
                <option value="">Item type…</option>
                {data.skus
                  .filter((s) => s.tracking !== 'BULK')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code}
                    </option>
                  ))}
              </Select>
              <input className="input it-qty-in" aria-label="How many" inputMode="numeric" value={p.qty} onChange={(e) => setPick(pick.map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)))} />
              <button className="btn btn-ghost" type="button" aria-label="Remove line" onClick={() => setPick(pick.filter((_, j) => j !== k))}>
                <XIcon size={16} />
              </button>
            </div>
          ))}
          <button className="btn" type="button" onClick={() => setPick([...pick, { skuId: '', qty: '1' }])}>
            Add a line
          </button>
        </fieldset>
        <button
          className="btn btn-primary it-big"
          type="button"
          disabled={a.busy}
          onClick={() =>
            a
              .run(
                () =>
                  act({
                    kind: 'move.create',
                    type,
                    fromPartyId: from,
                    toPartyId: toParty,
                    toSiteId: site.trim() || undefined,
                    purpose,
                    dueBackOn: due || undefined,
                    originalMovementId: orig || undefined,
                    expected: pick.filter((p) => p.skuId).map((p) => ({ skuId: p.skuId, qty: Number(p.qty) })),
                  }),
                'Prepared. Scan the items onto it, then send.',
              )
              .then((r) => r && onDone((r as { result: { id: string } }).result.id))
          }
        >
          Prepare
        </button>
        <ErrorNotice error={a.error} />
      </div>
    </Card>
  );
}

function steps(m: Move): { label: string; state: StepState }[] {
  const sent = m.status !== 'draft' && m.status !== 'cancelled';
  const all = m.status === 'received';
  return [
    { label: 'Picked', state: m.status === 'cancelled' ? 'stopped' : sent ? 'done' : 'now' },
    { label: 'Sent', state: sent ? 'done' : 'todo' },
    { label: 'Received', state: all ? 'done' : m.status === 'partly_received' ? 'now' : sent ? 'now' : 'todo' },
    ...(m.type === 'sale' ? [{ label: 'Ownership', state: (m.ownership ? 'done' : all ? 'now' : 'todo') as StepState }] : []),
  ];
}

function MoveDetail({ data, m }: { data: ItemBoard; m: Move }) {
  const a = useAction();
  const roles = rolesOf(data);
  const sender = (roles.get(m.fromPartyId) ?? []).some((r) => r !== 'view' && r !== 'finance' && r !== 'hr');
  const receiver = (roles.get(m.toPartyId) ?? []).some((r) => r !== 'view' && r !== 'finance' && r !== 'hr');
  const finance = (roles.get(m.fromPartyId) ?? []).includes('finance') || (roles.get(m.toPartyId) ?? []).includes('finance');
  const [eff, setEff] = useState('');
  const [basis, setBasis] = useState('');
  const open = m.status === 'dispatched' || m.status === 'partly_received';
  return (
    <div className="it-stack">
      <Steps steps={steps(m)} />
      <Facts
        items={[
          ['Purpose', m.purpose],
          ...(m.commercialRef ? ([['Shared reference', `${m.commercialRef} (on both companies' documents)`]] as [string, string][]) : []),
          ...(m.dueBackOn ? ([['Due back', dateLabel(m.dueBackOn)]] as [string, string][]) : []),
          ...(m.dispatched ? ([['Sent', `${dateTimeLabel(m.dispatched.at)} by ${m.dispatched.by}, carried by ${m.dispatched.carrier}`]] as [string, string][]) : []),
          ...(m.ownership ? ([['Ownership', `Passed ${dateLabel(m.ownership.effectiveOn)} (${m.ownership.basis}), recorded by ${m.ownership.by}`]] as [string, string][]) : []),
          ...(m.cancelled ? ([['Cancelled', `${dateTimeLabel(m.cancelled.at)} by ${m.cancelled.by}: ${m.cancelled.reason}`]] as [string, string][]) : []),
        ]}
      />
      {sender && m.status === 'draft' ? <SendScan data={data} m={m} /> : receiver && open ? <ReceiveScan data={data} m={m} /> : <Lines data={data} m={m} />}
      {m.type === 'sale' && m.status !== 'draft' && m.status !== 'cancelled' && <SalePapers data={data} m={m} />}
      {finance && (m.type === 'sale' || m.type === 'supplier_return') && !m.ownership && m.lines.some((l) => l.result === 'received') && (
        <Card title="Finance: record when ownership passes" sub="Separate from the physical receipt; a scan never changes the owner.">
          {m.type === 'sale' && (data.checks.ownershipPending.find((x) => x.id === m.id)?.missing ?? []).length > 0 && (
            <p className="notice" data-tone="warn">
              Not yet. Still missing: {data.checks.ownershipPending.find((x) => x.id === m.id)!.missing.join('; ')}.
            </p>
          )}
          <div className="it-form">
            <input className="input" type="date" aria-label="Ownership date" value={eff} onChange={(e) => setEff(e.target.value)} />
            <input className="input" aria-label="Sale terms" placeholder="Sale terms or contract clause" value={basis} onChange={(e) => setBasis(e.target.value)} />
            <button className="btn btn-primary" type="button" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'move.ownership', movementId: m.id, effectiveOn: eff, basis }), 'Ownership recorded.')}>
              Record ownership
            </button>
          </div>
          <ErrorNotice error={a.error} />
        </Card>
      )}
    </div>
  );
}

/** The lines, read only. */
function Lines({ data, m }: { data: ItemBoard; m: Move }) {
  const itemOf = (id: string) => data.items.find((i) => i.id === id);
  return (
    <ul className="it-rows">
      {m.lines.map((l) => {
        const it = itemOf(l.itemId);
        return (
          <li key={l.itemId} className="it-row">
            <span className="it-row-main">
              <strong>{it ? skuName(data, it.skuId) : 'Unit'}</strong>
              <span className="mono muted">{it ? labelDisplay(it.token) : 'Not visible to you'}</span>
            </span>
            <span className="it-row-side">
              {l.scan?.manual || l.pick?.manual ? <Chip tone="warn">Typed</Chip> : null}
              <Chip tone={LINE_TONE[l.result]}>{l.result.replace('_', ' ')}</Chip>
            </span>
          </li>
        );
      })}
      {m.lotLines.map((l) => (
        <li key={l.lotId} className="it-row">
          <span className="it-row-main">
            <strong>{skuName(data, l.skuId)}</strong>
            <span className="muted">
              {l.qtySent} sent{l.qtyReceived != null ? `, ${l.qtyReceived} received` : ''}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The sender's pick: scan each unit; the pick list says what is still to find. */
function SendScan({ data, m }: { data: ItemBoard; m: Move }) {
  const a = useAction();
  const [carrier, setCarrier] = useState('');
  const [over, setOver] = useState<{ entry: ScanEntry; message: string } | null>(null);
  const [why, setWhy] = useState('');
  const [cancelWhy, setCancelWhy] = useState('');
  const manager = (rolesOf(data).get(m.fromPartyId) ?? []).includes('manager');
  const itemOf = (id: string) => data.items.find((i) => i.id === id);
  const picked = useMemo(() => {
    const n = new Map<string, number>();
    const kits = new Set<string>();
    for (const l of m.lines) {
      const it = itemOf(l.itemId);
      if (!it) continue;
      if (it.kitId) {
        if (kits.has(it.kitId)) continue;
        kits.add(it.kitId);
        const kit = itemOf(it.kitId);
        if (kit) n.set(kit.skuId, (n.get(kit.skuId) ?? 0) + 1);
        continue;
      }
      n.set(it.skuId, (n.get(it.skuId) ?? 0) + 1);
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.lines, data.items]);
  const expected = m.expected ?? [];
  const short = expected.filter((e) => (picked.get(e.skuId) ?? 0) < e.qty);
  return (
    <div className="it-stack">
      {expected.length > 0 && (
        <Card title="Pick list" flush>
          <ul className="it-rows">
            {expected.map((e) => {
              const got = picked.get(e.skuId) ?? 0;
              return (
                <li key={e.skuId} className="it-row">
                  <span className="it-row-main">
                    <strong>{skuName(data, e.skuId)}</strong>
                  </span>
                  <span className="it-row-side">
                    <span className="it-qty">
                      {got} / {e.qty}
                    </span>
                    <Chip tone={got === e.qty ? 'ok' : got > e.qty ? 'warn' : 'neutral'}>{got === e.qty ? 'Done' : got > e.qty ? 'More than asked' : 'To pick'}</Chip>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Card title="Scan each unit" sub="Wrong item types, duplicates, units held elsewhere or not available are refused before anything is saved.">
        <Scanner
          purpose="pick"
          contextId={m.id}
          title={`Pick for ${m.ref}`}
          continuous
          busy={a.busy}
          onResult={async ({ verdict, entry }) => {
            if (verdict.outcome === 'ok') await a.run(() => act({ kind: 'move.add', movementId: m.id, scan: entry }));
            else if ((verdict.outcome === 'wrong_sku' || verdict.outcome === 'not_on_list') && manager) setOver({ entry, message: verdict.message });
          }}
        />
        {over && (
          <div className="it-form it-override">
            <p className="notice" data-tone="warn">
              {over.message} As a manager you may add it with a reason.
            </p>
            <input className="input" placeholder="Why it is sent anyway" value={why} onChange={(e) => setWhy(e.target.value)} />
            <div className="isc-actions">
              <button className="btn" type="button" onClick={() => setOver(null)}>
                Leave it out
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={a.busy || why.trim().length < 5}
                onClick={() => a.run(() => act({ kind: 'move.add', movementId: m.id, scan: over.entry, overrideReason: why }), 'Added with your reason.').then((r) => r && (setOver(null), setWhy('')))}
              >
                Add it
              </button>
            </div>
          </div>
        )}
        <ErrorNotice error={a.error} />
      </Card>
      <Card title={`On this movement (${m.lines.length})`} flush>
        {!m.lines.length ? (
          <Empty title="Nothing scanned yet." />
        ) : (
          <ul className="it-rows">
            {m.lines.map((l) => {
              const it = itemOf(l.itemId);
              return (
                <li key={l.itemId} className="it-row">
                  <span className="it-row-main">
                    <strong>{it ? skuName(data, it.skuId) : 'Unit'}</strong>
                    <span className="mono muted">{it ? labelDisplay(it.token) : ''}</span>
                  </span>
                  <span className="it-row-side">
                    {l.pick?.manual && <Chip tone="warn">Typed</Chip>}
                    {l.pick?.override && <Chip tone="info">Added by manager</Chip>}
                    <button className="btn btn-ghost" type="button" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'move.remove', movementId: m.id, itemId: l.itemId }), 'Taken off.')} aria-label="Take it off">
                      <XIcon size={16} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Send" sub={short.length ? `Still short on the pick list: ${short.map((s) => skuName(data, s.skuId)).join(', ')}.` : 'Check the destination and the list, then confirm it has left.'}>
        <div className="it-form">
          <input className="input" aria-label="Carrier" placeholder="Who carries it (driver, officer, courier)" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          <button className="btn btn-primary it-big" type="button" disabled={a.busy || !m.lines.length && !m.lotLines.length} onClick={() => a.run(() => act({ kind: 'move.dispatch', movementId: m.id, carrier, expectedVersion: m.version }), 'Sent. The receiver checks each item.')}>
            <TruckIcon size={18} aria-hidden="true" /> Confirm it has left
          </button>
          <details>
            <summary className="muted">Cancel this movement</summary>
            <div className="it-form">
              <input className="input" placeholder="Why it is cancelled" value={cancelWhy} onChange={(e) => setCancelWhy(e.target.value)} />
              <button className="btn" type="button" disabled={a.busy || cancelWhy.trim().length < 5} onClick={() => a.run(() => act({ kind: 'move.cancel', movementId: m.id, reason: cancelWhy }), 'Cancelled. Every unit is back.')}>
                Cancel and put everything back
              </button>
            </div>
          </details>
        </div>
      </Card>
    </div>
  );
}

type Staged = { result: 'received' | 'damaged' | 'missing' | 'wrong_item' | 'leave'; note: string; entry: ScanEntry | null; baseVersion: number | null };
type Draft = { at: number; lines: Record<string, Staged>; unexpected: ScanEntry[] };
const DRAFT_HOURS = 12;
const draftKey = (id: string) => `prima.items.receive.${id}`;
/** A receipt being scanned is kept on this phone until it is saved (item IDs and codes only, no names), for 12 hours. */
function loadDraft(id: string): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(id)) ?? 'null') as Draft | null;
    if (d && Date.now() - d.at < DRAFT_HOURS * 3600_000) return d;
  } catch {
    /* no storage */
  }
  return { at: Date.now(), lines: {}, unexpected: [] };
}
function saveDraft(id: string, d: Draft | null) {
  try {
    if (d) localStorage.setItem(draftKey(id), JSON.stringify(d));
    else localStorage.removeItem(draftKey(id));
  } catch {
    /* no storage */
  }
}

/** The receiver's scan: staged as "not saved", then committed with one result per line. */
function ReceiveScan({ data, m }: { data: ItemBoard; m: Move }) {
  const a = useAction();
  const [draft, setDraft] = useState<Draft>(() => loadDraft(m.id));
  const [conflict, setConflict] = useState<{ itemId: string; label: string }[]>([]);
  const [outcomes, setOutcomes] = useState<{ label: string; result: string; caseRef: string | null }[] | null>(null);
  const [lotQty, setLotQty] = useState<Record<string, string>>({});
  useEffect(() => saveDraft(m.id, Object.keys(draft.lines).length || draft.unexpected.length ? draft : null), [m.id, draft]);
  const itemOf = (id: string) => data.items.find((i) => i.id === id);
  const pending = m.lines.filter((l) => l.result === 'pending' || l.result === 'missing');
  const set = (itemId: string, s: Partial<Staged>) =>
    setDraft((d) => ({ ...d, at: Date.now(), lines: { ...d.lines, [itemId]: { result: 'received', note: '', entry: null, baseVersion: null, ...(d.lines[itemId] as Partial<Staged> | undefined), ...s } as Staged } }));
  const unmarked = pending.filter((l) => !draft.lines[l.itemId]);
  const commit = () =>
    a.run(
      async () => {
        try {
          const r = (await act({
            kind: 'move.receive',
            movementId: m.id,
            lines: Object.entries(draft.lines)
              .filter(([, s]) => s.result !== 'leave')
              .map(([itemId, s]) => ({ itemId, result: s.result as 'received', note: s.note, ...(s.entry ? { scan: s.entry } : {}), ...(s.baseVersion != null ? { baseVersion: s.baseVersion } : {}) })),
            lotLines: Object.entries(lotQty)
              .filter(([, q]) => q !== '')
              .map(([lotId, q]) => ({ lotId, qty: Number(q) })),
            unexpected: draft.unexpected,
          })) as { result: { outcomes: { label: string; result: string; caseRef: string | null }[]; unexpected: { label: string | null; caseRef: string }[] } };
          setOutcomes([...r.result.outcomes, ...r.result.unexpected.map((u) => ({ label: u.label ?? 'Unknown label', result: 'not on this delivery', caseRef: u.caseRef }))]);
          setDraft({ at: Date.now(), lines: {}, unexpected: [] });
          saveDraft(m.id, null);
          setConflict([]);
          return r;
        } catch (e) {
          const d = (e as ApiError & { details?: { lines?: { itemId: string; label: string }[] } }).details;
          if (e instanceof ApiError && e.status === 409 && d?.lines) setConflict(d.lines);
          throw e;
        }
      },
      'Receipt saved.',
    );
  const staged = Object.keys(draft.lines).length + draft.unexpected.length;
  return (
    <div className="it-stack">
      <Card title="Scan what arrived" sub="Each scan is checked against this delivery. A unit that is not on it is listed separately and is not received.">
        <Scanner
          purpose="receive"
          contextId={m.id}
          title={`Receive ${m.ref}`}
          continuous
          busy={a.busy}
          onResult={({ verdict, entry }) => {
            if (verdict.outcome === 'ok' && verdict.itemId) set(verdict.itemId, { result: 'received', entry, baseVersion: verdict.version ?? null });
            else if (verdict.outcome === 'not_on_list' || verdict.outcome === 'not_found')
              setDraft((d) => (d.unexpected.some((u) => u.code === entry.code) ? d : { ...d, at: Date.now(), unexpected: [...d.unexpected, entry] }));
          }}
        />
        {staged > 0 && (
          <p className="notice" data-tone="info">
            {staged} scan{staged === 1 ? '' : 's'} kept on this phone, not saved yet.
          </p>
        )}
      </Card>
      <Card title={`On this delivery (${pending.length} to check)`} flush>
        <ul className="it-rows">
          {pending.map((l) => {
            const it = itemOf(l.itemId);
            const s = draft.lines[l.itemId];
            const bad = conflict.find((c) => c.itemId === l.itemId);
            return (
              <li key={l.itemId} className="it-row it-row-col" data-tone={bad ? 'crit' : undefined}>
                <span className="it-row-line">
                  <span className="it-row-main">
                    <strong>{it ? skuName(data, it.skuId) : 'Unit'}</strong>
                    <span className="mono muted">{it ? labelDisplay(it.token) : ''}</span>
                  </span>
                  {s ? (
                    <Chip tone={s.result === 'received' ? 'ok' : s.result === 'leave' ? 'neutral' : 'warn'}>
                      {s.result === 'leave' ? 'Leave waiting' : s.result.replace('_', ' ')}
                      {s.entry?.source === 'typed' ? ' (typed)' : ''}
                    </Chip>
                  ) : (
                    <Chip tone="neutral">{l.result === 'missing' ? 'Missing earlier' : 'Not scanned'}</Chip>
                  )}
                </span>
                {bad && <span className="muted">Changed since it was scanned: scan it again or leave it out.</span>}
                <span className="it-mark">
                  {(['damaged', 'wrong_item', 'missing', 'leave'] as const).map((r) => (
                    <button key={r} type="button" className="btn btn-sm" aria-pressed={s?.result === r} onClick={() => set(l.itemId, { result: r })} disabled={r === 'missing' && l.result === 'missing'}>
                      {r === 'wrong_item' ? 'Wrong item' : r === 'leave' ? 'Leave waiting' : r[0].toUpperCase() + r.slice(1)}
                    </button>
                  ))}
                  {s && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft((d) => ({ ...d, lines: Object.fromEntries(Object.entries(d.lines).filter(([k]) => k !== l.itemId)) }))}>
                      Undo
                    </button>
                  )}
                </span>
                {s && (s.result === 'damaged' || s.result === 'wrong_item' || s.result === 'missing') && (
                  <input className="input" placeholder="What is wrong" value={s.note} onChange={(e) => set(l.itemId, { note: e.target.value })} />
                )}
              </li>
            );
          })}
          {m.lotLines
            .filter((l) => l.qtyReceived == null)
            .map((l) => (
              <li key={l.lotId} className="it-row">
                <span className="it-row-main">
                  <strong>{skuName(data, l.skuId)}</strong>
                  <span className="muted">{l.qtySent} sent</span>
                </span>
                <input className="input it-qty-in" aria-label="Quantity received" inputMode="numeric" value={lotQty[l.lotId] ?? ''} onChange={(e) => setLotQty({ ...lotQty, [l.lotId]: e.target.value })} />
              </li>
            ))}
        </ul>
      </Card>
      {draft.unexpected.length > 0 && (
        <Card title={`Not on this delivery (${draft.unexpected.length})`} sub="Each opens a case when saved. These units are not received and stay where they are recorded.">
          <ul className="it-rows">
            {draft.unexpected.map((u) => (
              <li key={u.code} className="it-row" data-tone="crit">
                <span className="mono">{u.code.length > 20 ? `${u.code.slice(0, 20)}…` : u.code}</span>
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => setDraft((d) => ({ ...d, unexpected: d.unexpected.filter((x) => x.code !== u.code) }))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Save the receipt" sub={unmarked.length ? `${unmarked.length} line(s) not scanned: scan them, or mark them missing or leave them waiting before saving.` : 'Each line keeps its own result. Nothing is received in full unless every unit was scanned.'}>
        <button className="btn btn-primary it-big" type="button" disabled={a.busy || unmarked.length > 0 || (!staged && !Object.values(lotQty).some((q) => q !== ''))} onClick={() => void commit()}>
          <PackageIcon size={18} aria-hidden="true" /> Save what arrived
        </button>
        <ErrorNotice error={a.error} />
        {outcomes && (
          <ul className="it-rows">
            {outcomes.map((o, k) => (
              <li key={k} className="it-row">
                <span className="mono">{o.label}</span>
                <span className="it-row-side">
                  <Chip tone={o.result === 'received' ? 'ok' : 'warn'}>{o.result.replace('_', ' ')}</Chip>
                  {o.caseRef && <span className="muted">case {o.caseRef}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
