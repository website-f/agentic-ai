import { useState } from 'react';
import { CheckCircleIcon, ShirtFoldedIcon, XCircleIcon } from '@phosphor-icons/react';
import { api, type UniformRequests } from '../api';
import { Card, Empty, Search, Stat, Stats, Toolbar } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import { Select } from '../SearchSelect';
import '../styles/uniform-requests.css';

/**
 * I1 (Fauzan, 11 Nov 2026: "Create button from om to need uniform. Let the om collect signature as the shared device or
 * guard app still not available."). A government OM or Regional OM asks the Goodwill store for a guard's uniform; the
 * store issues it to the OM (then the patrolling officer, then the guard, who sign on the OM's phone under "Items to
 * pass on") or refuses with a reason. Allowance (Fauzan, 6 Nov 2026): 3 free pieces in 12 months, a 4th or 5th only
 * when the guard pays (receipt and amount, never from pay), the 6th refused. The server checks every rule.
 *
 * One panel, three places: My details (the OM), Procurement > Store (the storekeepers) and Items and equipment >
 * Uniforms (both). It hides itself for anyone who neither asks nor decides.
 */

type UReq = UniformRequests['requests'][number];

const TONE = { open: 'warn', issued: 'ok', refused: 'crit', cancelled: 'neutral' } as const;
const LABEL = { open: 'Waiting for the store', issued: 'Issued to the OM', refused: 'Refused', cancelled: 'Cancelled' } as const;
const REASONS = ['New guard', 'Worn out', 'Torn or damaged', 'Wrong size', 'Lost'];

/** Loads the requests; says plainly when the module is not installed yet; shows nothing to people with no part in it. */
export function UniformRequestsPanel({ place }: { place: 'mine' | 'store' | 'uniforms' }) {
  const { data, error } = useLoad(() => api.uniformRequests(), []);
  if (error) {
    // Not for this person: nothing to show. Not installed yet: say so in words (the CEO installs the module).
    if (/not installed/i.test(error)) return <p className="notice" data-tone="info">{error}</p>;
    return null;
  }
  if (!data) return place === 'mine' ? null : <Loading what="uniform requests" />;
  if (!data.canRequest && !data.canDecide && place === 'mine') return null;
  return <Panel data={data} place={place} />;
}

function Panel({ data, place }: { data: UniformRequests; place: 'mine' | 'store' | 'uniforms' }) {
  const [asking, setAsking] = useState(false);
  const [show, setShow] = useState<'open' | 'done' | 'all'>('open');
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const open = data.requests.filter((r) => r.status === 'open');
  const rows = data.requests.filter(
    (r) =>
      (show === 'all' || (show === 'open') === (r.status === 'open')) &&
      (!term || [r.personName, r.staffNo, r.itemName, r.requestedBy].some((x) => x.toLowerCase().includes(term))),
  );
  const title = data.canDecide ? 'Uniform requests from Operations Managers' : 'Uniform requests';
  const sub = data.canDecide
    ? 'Issue to the OM who asked (choose the patrolling officer), or refuse with a reason. The OM collects the signatures on their phone.'
    : `Ask the Goodwill store for a guard's uniform. Up to ${data.rule.freePerYear} free pieces in 12 months; a 4th or 5th only if the guard pays (never from pay).`;
  return (
    <Card
      title={title}
      sub={sub}
      flush
      actions={
        data.canRequest ? (
          <button className="btn btn-primary ur-big" type="button" onClick={() => setAsking(true)}>
            <ShirtFoldedIcon size={18} aria-hidden="true" /> Ask for a uniform
          </button>
        ) : undefined
      }
    >
      {place !== 'mine' && data.requests.length > 0 && (
        <div className="ur-pad">
          <Stats>
            <Stat label="Waiting for the store" value={open.length} tone={open.length ? 'warn' : 'ok'} onClick={() => setShow('open')} />
            <Stat label="Issued, last 60 days" value={data.requests.filter((r) => r.status === 'issued').length} tone="neutral" onClick={() => setShow('done')} />
            <Stat label="Guard pays" value={data.requests.filter((r) => r.guardPays).length} tone="neutral" />
          </Stats>
        </div>
      )}
      {data.requests.length > 3 && (
        <div className="ur-pad">
          <Toolbar>
            <Search value={q} onChange={setQ} placeholder="Guard, staff number, item or OM" />
            <Select className="select" aria-label="Which requests" value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
              <option value="open">Waiting</option>
              <option value="done">Decided</option>
              <option value="all">All</option>
            </Select>
          </Toolbar>
        </div>
      )}
      {!rows.length ? (
        <Empty title={data.requests.length ? 'Nothing matches.' : 'No uniform requests in the last 60 days.'}>
          {data.canRequest && !data.requests.length ? 'Choose "Ask for a uniform" when a guard needs one.' : undefined}
        </Empty>
      ) : (
        <ul className="ur-rows">
          {rows.map((r) => (
            <li key={r.id}>
              <RequestLine r={r} data={data} />
            </li>
          ))}
        </ul>
      )}
      {data.canRequest && (
        <p className="muted small ur-pad">When the store issues it, it comes to you. The patrolling officer and the guard sign on your phone under "Items to pass on".</p>
      )}
      {asking && (
        <Drawer title="Ask for a uniform" sub="For one guard or patrolling officer you cover. The Goodwill store decides." onClose={() => setAsking(false)}>
          <AskForm data={data} onDone={() => setAsking(false)} />
        </Drawer>
      )}
    </Card>
  );
}

function RequestLine({ r, data }: { r: UReq; data: UniformRequests }) {
  const mine = data.canRequest && r.status === 'open';
  return (
    <div className="ur-row" data-status={r.status}>
      <div className="ur-row-head">
        <div className="ur-row-main">
          <strong>
            {r.qty} × {r.itemName}
          </strong>
          <span className="ur-who">
            {r.personName} · <span className="mono">{r.staffNo}</span>
          </span>
        </div>
        <Chip tone={TONE[r.status]}>{LABEL[r.status]}</Chip>
      </div>
      <div className="ur-facts">
        <span>{r.reason}</span>
        <span>
          {r.history.pieces} piece{r.history.pieces === 1 ? '' : 's'} in 12 months{r.history.last ? `, last ${dateLabel(r.history.last)}` : ''}
        </span>
        {r.early && <Chip tone="warn">Within 6 months of the last piece</Chip>}
        {r.guardPays && (
          <Chip tone="info">
            Guard pays RM{r.guardPays.amount.toFixed(2)} · receipt {r.guardPays.receiptNo}
          </Chip>
        )}
        <span className="muted">
          Asked by {r.requestedBy}, {dateLabel(r.requestedAt)}
        </span>
      </div>
      {r.decided && (
        <div className="ur-decided small">
          {LABEL[r.status]} by {r.decided.by}, {dateLabel(r.decided.at)}
          {r.decided.note ? `: ${r.decided.note}` : ''}
        </div>
      )}
      {r.status === 'open' && data.canDecide && <Decide r={r} data={data} />}
      {mine && r.requestedById === data.me && <Cancel id={r.id} />}
    </div>
  );
}

function Cancel({ id }: { id: string }) {
  const act = useAction();
  return (
    <div className="ur-actions">
      <button className="btn ur-big" type="button" disabled={act.busy} onClick={() => act.run(() => api.decideUniformRequest(id, 'cancel', {}), 'Request cancelled.')}>
        Cancel request
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Decide({ r, data }: { r: UReq; data: UniformRequests }) {
  const act = useAction();
  const [mode, setMode] = useState<'issue' | 'refuse' | null>(null);
  const [note, setNote] = useState('');
  const patrols = data.patrols.filter((p) => p.companyId === r.billTo);
  const needsPatrol = !data.patrols.some((p) => p.id === r.personId);
  const [patrolPersonId, setPatrolPersonId] = useState('');
  const item = data.uniforms.find((u) => u.id === r.stockItemId);
  const short = !!item && item.onHand < r.qty;
  return (
    <div className="ur-decide">
      {!mode && (
        <div className="ur-actions">
          <button className="btn btn-primary ur-big" type="button" disabled={short} onClick={() => setMode('issue')}>
            <CheckCircleIcon size={18} aria-hidden="true" /> Issue to the OM
          </button>
          <button className="btn ur-big" type="button" onClick={() => setMode('refuse')}>
            <XCircleIcon size={18} aria-hidden="true" /> Refuse
          </button>
          {item && <span className="muted small">{item.onHand} in store</span>}
          {short && <span className="small">Not enough in store. Receive stock first, or refuse with a reason.</span>}
        </div>
      )}
      {mode === 'issue' && (
        <div className="ur-form">
          {needsPatrol && (
            <label className="ur-field">
              <span>Patrolling officer who hands it to the guard</span>
              <Select className="select" aria-label="Patrolling officer" value={patrolPersonId} onChange={(e) => setPatrolPersonId(e.target.value)}>
                <option value="">Choose…</option>
                {patrols.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              {!patrols.length && <span className="small">No active patrolling officer found for this guard's company.</span>}
            </label>
          )}
          <label className="ur-field">
            <span>Note (optional)</span>
            <input className="input" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="ur-actions">
            <button
              className="btn btn-primary ur-big"
              type="button"
              disabled={act.busy || (needsPatrol && !patrolPersonId)}
              onClick={() =>
                act.run(() => api.decideUniformRequest(r.id, 'issue', { note, ...(needsPatrol ? { patrolPersonId } : {}) }), 'Issued. The OM confirms it and collects the signatures.')
              }
            >
              Issue {r.qty} × {r.itemName}
            </button>
            <button className="btn ur-big" type="button" onClick={() => setMode(null)}>
              Back
            </button>
          </div>
        </div>
      )}
      {mode === 'refuse' && (
        <div className="ur-form">
          <label className="ur-field">
            <span>Why it is refused (the OM sees this)</span>
            <input className="input" aria-label="Why it is refused" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="ur-actions">
            <button className="btn btn-danger ur-big" type="button" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.decideUniformRequest(r.id, 'refuse', { note }), 'Refused. The OM can see why.')}>
              Refuse request
            </button>
            <button className="btn ur-big" type="button" onClick={() => setMode(null)}>
              Back
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function AskForm({ data, onDone }: { data: UniformRequests; onDone: () => void }) {
  const act = useAction();
  const [staffNo, setStaffNo] = useState('');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState('');
  const [pays, setPays] = useState(false);
  const [receiptNo, setReceiptNo] = useState('');
  const [amount, setAmount] = useState('');
  const amountOk = Number(amount) > 0;
  const ready = staffNo.trim() && itemId && reason.trim() && (!pays || (receiptNo.trim() && amountOk));
  if (!data.uniforms.length) return <Empty title="No uniforms in the Goodwill store yet.">The storekeepers add uniform items under Procurement, Store.</Empty>;
  return (
    <div className="ur-form">
      <label className="ur-field">
        <span>Guard's staff number</span>
        <input className="input ur-input" aria-label="Guard's staff number" autoCapitalize="characters" value={staffNo} onChange={(e) => setStaffNo(e.target.value)} />
      </label>
      <label className="ur-field">
        <span>Uniform and size</span>
        <Select className="select ur-input" aria-label="Uniform and size" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Choose…</option>
          {data.uniforms.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.onHand} in store)
            </option>
          ))}
        </Select>
      </label>
      <div className="ur-field">
        <span>Pieces</span>
        <div className="ur-seg" role="group" aria-label="Pieces">
          {Array.from({ length: data.rule.maxPerRequest }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" className="btn" aria-pressed={qty === n} onClick={() => setQty(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="ur-field">
        <span>Why the guard needs it</span>
        <div className="ur-chips">
          {REASONS.map((x) => (
            <button key={x} type="button" className="btn btn-sm" aria-pressed={reason === x} onClick={() => setReason(x)}>
              {x}
            </button>
          ))}
        </div>
        <input className="input ur-input" aria-label="Why the guard needs it" placeholder="Or write the reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <label className="ur-check">
        <input type="checkbox" checked={pays} onChange={(e) => setPays(e.target.checked)} />
        <span>The guard pays for this piece (a 4th or 5th in 12 months). Never taken from pay.</span>
      </label>
      {pays && (
        <div className="ur-two">
          <label className="ur-field">
            <span>Receipt number</span>
            <input className="input ur-input" aria-label="Receipt number" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
          </label>
          <label className="ur-field">
            <span>Amount paid (RM)</span>
            <input className="input ur-input" aria-label="Amount paid (RM)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        </div>
      )}
      <p className="muted small">
        The store checks the allowance: up to {data.rule.freePerYear} free pieces in 12 months, usually one every {data.rule.everyMonths} months; a 4th or 5th only when the guard pays; the 6th is refused.
      </p>
      <ErrorNotice error={act.error} />
      <button
        className="btn btn-primary ur-big"
        type="button"
        disabled={act.busy || !ready}
        onClick={() =>
          act
            .run(
              () => api.requestUniform({ staffNo, stockItemId: itemId, qty, reason, guardPays: pays ? { receiptNo, amount: Number(amount) } : null }),
              'Sent to the Goodwill store.',
            )
            .then((r) => r !== undefined && onDone())
        }
      >
        Send to the store
      </button>
    </div>
  );
}
