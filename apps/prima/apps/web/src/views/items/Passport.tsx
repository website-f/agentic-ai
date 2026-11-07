// Find an item and its passport (P85; paper section 10): owner, holder, place, condition, the handover history, repairs,
// laundry and swaps, the label's print history and the movements and cases it was part of. A scan only finds the
// record; what you may do still depends on your role. Other companies' staff are never named.
import { useState } from 'react';
import { MagnifyingGlassIcon, PrinterIcon } from '@phosphor-icons/react';
import { STATE_LABEL, labelDisplay, type ItemAction } from '@prima/core';
import { api, type ItemBoard, type ItemPassport } from '../../api';
import { useApp } from '../../App';
import { Card, Empty, Facts } from '../../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../../ui';
import { PrintRun, type PrintResult } from './PrintRun';
import { Scanner } from './Scanner';
import { STATE_TONE, TYPE_LABEL, act, partyName, rolesOf, skuName } from './shared';

export function Find({ data }: { data: ItemBoard }) {
  const [open, setOpen] = useState<{ code?: string; id?: string } | null>(null);
  const recent = data.items.slice(-8).reverse();
  return (
    <div className="it-stack">
      <Card title="Find an item" sub="Scan the QR code, the barcode or the RFID tag, or type the ID printed under the code. Every company's labels scan here; a scan only finds the record.">
        <Scanner purpose="view" title="Find an item" autoFocus onResult={({ verdict, entry }) => verdict.outcome !== 'not_found' && verdict.itemId && setOpen({ code: entry.code })} />
      </Card>
      <Card title="Recent items" flush>
        {!recent.length ? (
          <Empty title="No items you can see yet." />
        ) : (
          <ul className="it-rows">
            {recent.map((i) => (
              <li key={i.id}>
                <button className="it-row it-row-btn" type="button" onClick={() => setOpen({ id: i.id })}>
                  <span className="it-row-main">
                    <strong>{skuName(data, i.skuId)}</strong>
                    <span className="mono muted">
                      {labelDisplay(i.token)}
                      {i.rfidTag ? ' · RFID' : ''}
                    </span>
                  </span>
                  <Chip tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</Chip>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && <Passport data={data} code={open.code} id={open.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function Passport({ data, code, id, onClose }: { data: ItemBoard; code?: string; id?: string; onClose: () => void }) {
  const { data: p, error, reload } = useLoad(() => (id ? api.itemPassport(id) : api.itemResolve(code ?? '')), [code, id]);
  return (
    <Drawer title={p ? skuName(data, p.item.skuId) : 'Item'} sub={p ? p.label : ''} onClose={onClose}>
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
    <div className="it-stack">
      <div className="it-passport-head">
        <span className="mono it-big-id">{p.label}</span>
        <Chip tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</Chip>
        {i.pendingAck && <Chip tone="warn">Waiting for the person to confirm</Chip>}
      </div>
      <Facts
        items={[
          ['Owner', p.owner],
          ['Held by', `${p.holder}: ${i.custody.label}`],
          ['Condition', i.condition],
          ['Label', `${p.gen ? `print ${p.gen}` : 'not printed yet'}${i.labelVerifiedAt === null && p.gen ? ', not scanned back yet' : ''}`],
          ['RFID tag', i.rfidTag ? <span className="mono">{i.rfidTag}</span> : 'None (optional)'],
          ...(i.serial ? ([['Maker serial', i.serial]] as [string, string][]) : []),
          ...(p.followedBy.length ? ([['Followed by', `${p.followedBy.join(' and ')} (whole history; only the owner and holder act on it)`]] as [string, string][]) : []),
          ...(i.dueBack ? ([['Due back to owner', dateLabel(i.dueBack.on)]] as [string, string][]) : []),
          ...(i.legacyUnverified ? ([['Opening balance', 'Counted from the old list, not yet verified']] as [string, string][]) : []),
          ...(i.writeOff ? ([['Write-off', 'For Finance to decide. Never a pay deduction.']] as [string, string][]) : []),
        ]}
      />
      {mineToConfirm && <ConfirmMine token={i.token} onDone={onChanged} />}
      {(mayHandle || isOps) && <ItemActions data={data} p={p} handle={mayHandle} onDone={onChanged} />}
      {p.movements.length > 0 && (
        <Card title="Movements" flush>
          <ul className="it-rows">
            {p.movements.map((m) => (
              <li key={m.id} className="it-row">
                <span className="it-row-main">
                  <strong>
                    {m.ref} · {TYPE_LABEL[m.type]}
                  </strong>
                  {m.commercialRef && <span className="muted">Shared reference {m.commercialRef}</span>}
                </span>
                <Chip tone="neutral">{m.status.replace('_', ' ')}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {p.prints.length > 0 && (
        <Card title="Label prints" sub="A reprint keeps the ID; an older copy no longer moves the item." flush>
          <ul className="it-rows">
            {p.prints.map((x) => (
              <li key={x.id} className="it-row">
                <span className="it-row-main">
                  <strong>
                    Print {x.gen} · {x.kind === 'first' ? 'first label' : 'reprint'}
                  </strong>
                  <span className="muted">
                    {dateTimeLabel(x.at)} by {x.by}
                    {x.reason ? ` · ${x.reason}` : ''}
                  </span>
                </span>
                <Chip tone={x.verified ? 'ok' : 'warn'}>{x.verified ? 'Scanned back' : 'Not scanned back'}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="History" flush>
        <ul className="it-rows">
          {p.events
            .slice()
            .reverse()
            .map((e) => (
              <li key={e.id} className="it-row it-row-col">
                <span className="it-row-line">
                  <strong>{e.kind.replace(/_/g, ' ')}</strong>
                  <span className="muted">{dateTimeLabel(e.at)}</span>
                </span>
                <span className="muted">
                  {e.by}
                  {e.to ? ` → ${e.to.label}` : ''}
                  {e.ownerTo && e.kind === 'ownership' ? ` · owner now ${partyName(data, e.ownerTo)}` : ''}
                </span>
                {e.note && <span>{e.note}</span>}
              </li>
            ))}
        </ul>
      </Card>
      {p.cases.length > 0 && (
        <Card title="Cases" flush>
          <ul className="it-rows">
            {p.cases.map((c) => (
              <li key={c.id} className="it-row it-row-col">
                <span className="it-row-line">
                  <strong>
                    {c.ref} {c.kind.replace(/_/g, ' ')}
                  </strong>
                  <Chip tone={c.status === 'open' ? 'warn' : 'ok'}>{c.status}</Chip>
                </span>
                <span className="muted">{c.note}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** The holder confirms in their own sign-in, by scanning the label or with a tap; or says they did not get it. */
export function ConfirmMine({ token, onDone }: { token: string; onDone: () => void }) {
  const a = useAction();
  const [note, setNote] = useState('');
  return (
    <Card title="Did you get this item?" sub="Scan its label to confirm, or tap Yes. Nothing is ever charged to you.">
      <Scanner purpose="confirm" title="Scan the item to confirm" busy={a.busy} onResult={({ verdict, entry }) => verdict.outcome === 'ok' && a.run(() => act({ kind: 'confirm', scan: entry }), 'Thank you, confirmed.').then(onDone)} />
      <div className="it-form">
        <button className="btn btn-primary it-big" type="button" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'confirm', label: token }), 'Thank you, confirmed.').then(onDone)}>
          Yes, I have it
        </button>
        <input className="input" placeholder="If not: what is wrong" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn" type="button" disabled={a.busy || note.trim().length < 3} onClick={() => a.run(() => act({ kind: 'dispute', label: token, note }), 'Sent to the store to sort out.').then(onDone)}>
          I did not get it
        </button>
      </div>
      <ErrorNotice error={a.error} />
    </Card>
  );
}

function ItemActions({ data, p, handle, onDone }: { data: ItemBoard; p: ItemPassport; handle: boolean; onDone: () => void }) {
  const a = useAction();
  const i = p.item;
  const [what, setWhat] = useState('');
  const [note, setNote] = useState('');
  const [to, setTo] = useState('');
  const [cond, setCond] = useState<'new' | 'good' | 'worn' | 'damaged'>('good');
  const [receipt, setReceipt] = useState('');
  const [amount, setAmount] = useState('');
  const [serialSeen, setSerialSeen] = useState('');
  const [sizeOk, setSizeOk] = useState(false);
  const [run, setRun] = useState<PrintResult | null>(null);
  const uniform = data.skus.find((s) => s.id === i.skuId)?.category === 'uniform';
  const reset = () => (setWhat(''), setNote(''), setReceipt(''), setAmount(''), setSerialSeen(''), setSizeOk(false));
  const go = (x: ItemAction, msg: string) =>
    a.run(() => act(x), msg).then((r) => {
      if (r) {
        reset();
        onDone();
      }
    });
  if (run) return <PrintRun run={run} onDone={() => (setRun(null), onDone())} />;
  const options: [string, string, boolean][] = [
    ['inspect', 'Check it into stock', handle && i.state === 'quarantine'],
    ['issue_person', 'Hand to a person', ['available', 'at_site', 'with_person'].includes(i.state) && !i.pendingAck],
    ['issue_site', 'Place at a site', ['available', 'with_person'].includes(i.state) && !i.pendingAck],
    ['return', 'Take back into the store', ['with_person', 'at_site'].includes(i.state)],
    ['observe', 'Record a site check (moves nothing)', true],
    ['missing', 'Report missing', !['missing', 'lost', 'disposed'].includes(i.state)],
    ['laundry', 'Send to the laundry', handle && ['quarantine', 'available'].includes(i.state)],
    ['laundry_back', 'Back from the laundry', handle && i.state === 'laundry'],
    ['repair', 'Send for repair', handle && ['quarantine', 'available'].includes(i.state)],
    ['repair_back', 'Back from repair', handle && i.state === 'repair'],
    ['print', p.gen ? 'Reprint the label (same ID)' : 'Print the label', handle && i.state !== 'disposed'],
    ['rfid', i.rfidTag ? 'Replace or remove the RFID tag' : 'Add an RFID tag', handle && !['disposed', 'in_transit'].includes(i.state)],
    ['replace', 'Register a replacement (new ID)', handle && ['quarantine', 'lost', 'repair', 'disposed'].includes(i.state) && !i.replacedById],
    ['dispose', 'Ask to dispose of it', handle && i.state === 'quarantine'],
  ];
  const label = i.token;
  const save = () => {
    if (what === 'inspect') return go({ kind: 'item.inspect', label, condition: cond, note, expectedVersion: i.version }, 'Checked.');
    if (what === 'issue_person')
      return go({ kind: 'issue', label, personId: to.trim(), expectedVersion: i.version, reason: note.trim() || undefined, paidByGuard: receipt.trim() ? { receiptRef: receipt.trim(), amount: amount.trim() } : undefined }, 'Handed over. The person confirms in their own sign-in.');
    if (what === 'issue_site') return go({ kind: 'issue', label, siteId: to.trim(), expectedVersion: i.version }, 'Placed at the site.');
    if (what === 'return') return go({ kind: 'return', label, condition: cond === 'new' ? 'good' : cond, note }, 'Back in the store, to check before it is issued again.');
    if (what === 'observe') return go({ kind: 'observe', label, siteId: to.trim(), note }, 'Site check recorded.');
    if (what === 'missing') return go({ kind: 'report.missing', label, note }, 'Reported. A manager decides; no pay deduction.');
    if (what === 'laundry') return go({ kind: 'laundry.out', label, launderer: note, note: '' }, 'Sent to the laundry.');
    if (what === 'laundry_back') return go({ kind: 'laundry.back', label, note }, 'Back from the laundry, to check.');
    if (what === 'repair') return go({ kind: 'repair.out', label, repairer: note, note: '' }, 'Sent for repair.');
    if (what === 'repair_back') return go({ kind: 'repair.back', label, note }, 'Back from repair, to check.');
    if (what === 'rfid') return go({ kind: 'item.rfid', label, tag: to, reason: note }, to.trim() ? 'RFID tag recorded.' : 'RFID tag removed.');
    if (what === 'replace') return go({ kind: 'item.replace', label, note }, 'Replacement registered with a new label.');
    if (what === 'dispose') return go({ kind: 'dispose.ask', label, reason: note }, 'Disposal asked. A manager decides.');
    if (what === 'print')
      return a.run(async () => {
        const r = (await act({ kind: 'label.print', itemIds: [i.id], ...(p.gen ? { reason: note, identity: i.serial ? { serialSeen } : { skuSizeConfirmed: sizeOk } } : {}) })) as { result: PrintResult };
        reset();
        setRun(r.result);
      });
  };
  return (
    <Card title="What to do" sub={`Owner: ${partyName(data, i.ownerPartyId)}. Ownership changes only when Finance records it.`}>
      <div className="it-form">
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
            list={what === 'issue_person' ? undefined : 'it-site-list'}
            aria-label={what === 'issue_person' ? 'Staff record ID' : 'Site ID'}
            placeholder={what === 'issue_person' ? 'Person record ID' : 'Site ID'}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        )}
        <datalist id="it-site-list">
          {data.siteChoices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </datalist>
        {what === 'rfid' && <input className="input mono" aria-label="RFID tag" placeholder={i.rfidTag ? 'New tag (empty to remove)' : 'Read the tag, or type its code'} value={to} onChange={(e) => setTo(e.target.value)} maxLength={80} />}
        {what === 'issue_person' && uniform && (
          <>
            <input className="input" aria-label="Reason if early" placeholder={`Reason, needed if under ${data.uniforms.rule.everyMonths} months since their last uniform piece`} value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="muted small">Only for a 4th or 5th piece in 12 months, which the guard pays for with their own receipt. Never taken from pay.</p>
            <input className="input" aria-label="Guard's receipt number" placeholder="Receipt number" value={receipt} onChange={(e) => setReceipt(e.target.value)} maxLength={60} />
            <input className="input" aria-label="Amount on the receipt (RM)" placeholder="Amount on the receipt (RM)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </>
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
        {what === 'print' && p.gen > 0 && (i.serial ? (
          <input className="input mono" aria-label="Maker serial you can see" placeholder="Maker serial you can see on the item" value={serialSeen} onChange={(e) => setSerialSeen(e.target.value)} />
        ) : (
          <label className="isc-choice">
            <input type="checkbox" checked={sizeOk} onChange={(e) => setSizeOk(e.target.checked)} /> I checked the item type and size match
          </label>
        ))}
        {what && !what.startsWith('issue') && !(what === 'print' && !p.gen) && (
          <input
            className="input"
            aria-label="Note"
            placeholder={what === 'repair' ? 'Repairer name' : what === 'laundry' ? 'Laundry name' : what === 'print' ? 'Why it is reprinted' : what === 'rfid' ? (i.rfidTag ? 'Why the tag is replaced or removed' : 'Note (optional)') : 'Note or reason'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
        {what && (
          <button className="btn btn-primary it-big" type="button" disabled={a.busy} onClick={() => void save()}>
            {what === 'print' ? (
              <>
                <PrinterIcon size={18} aria-hidden="true" /> Print
              </>
            ) : (
              'Save'
            )}
          </button>
        )}
        <ErrorNotice error={a.error} />
      </div>
    </Card>
  );
}

export const FindIcon = MagnifyingGlassIcon;
