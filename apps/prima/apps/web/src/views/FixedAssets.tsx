import { useState } from 'react';
import { api, type DisposalBody, type FixedAssets } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import { Card } from '../kit';
import '../styles/finance.css';

/**
 * Fixed assets in the books (V5 asset lifecycle). Prima works out each month's straight-line depreciation per owner
 * entity and drafts the journal; Finance posts it in SQL Account and records the journal number. Disposals: the Asset
 * Management team asks, the Finance Director approves (the COO above the limit), the team records it, Finance posts it.
 */

type Disposal = FixedAssets['disposals'][number];
const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CATEGORY = { FURNITURE: 'Furniture', FITTING: 'Fittings', RENOVATION: 'Renovations', OTHER: 'Other' } as const;
export const METHOD: Record<NonNullable<DisposalBody['method']>, string> = {
  SALE: 'Sale',
  SCRAP: 'Scrap',
  DONATE: 'Donation',
  WRITE_OFF: 'Write-off',
  TRADE_IN: 'Trade-in',
};
const STATE: Record<Disposal['state'], ['crit' | 'warn' | 'info' | 'ok', string]> = {
  no_request: ['warn', 'Marked for disposal, no request'],
  to_decide: ['warn', 'Waiting for a decision'],
  rejected: ['info', 'Rejected, kept in use'],
  to_dispose: ['info', 'Approved, to dispose'],
  to_post: ['warn', 'Done, Finance to post'],
  closed: ['ok', 'Posted in SQL Account'],
};

export function FixedAssetsPanel() {
  const { data, error } = useLoad(() => api.fixedAssets(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="fixed assets" />;
  const k = data.kpis;
  const lives = Object.entries(data.rule.lifeYears)
    .map(([c, y]) => `${CATEGORY[c as keyof typeof CATEGORY]} ${y} years`)
    .join(', ');
  return (
    <div className="fin fin-stack-page">
      <Card
        title="Depreciation for SQL Account"
        sub={`Straight line with no residual value, from the month after purchase (${lives}).`}
        flush
      >
        <p className="muted small fin-intro">
          These lives are confirmed; the auditors confirm the method. Prima drafts the journal; Finance posts it in SQL Account and records the journal
          number here. A month with no number is not posted.
        </p>
        <dl className="fin-figs fin-figs-inset">
          <div>
            <dt>Cost in use</dt>
            <dd>{rm(k.cost)}</dd>
          </div>
          <div>
            <dt>Net book value</dt>
            <dd>{rm(k.nbv)}</dd>
          </div>
          <div>
            <dt>Charge for {data.period}</dt>
            <dd>{rm(k.monthCharge)}</dd>
          </div>
          <div data-tone={k.unposted ? 'warn' : 'ok'}>
            <dt>Months not posted</dt>
            <dd>{k.unposted}</dd>
          </div>
        </dl>
        <div className="list fin-sep">
          {data.entities.map((e) => (
            <EntityLine key={e.ownerEntity} e={e} data={data} />
          ))}
        </div>
        {k.itNoCost > 0 && (
          <p className="notice fin-inset" data-tone="warn">
            {k.itNoCost} IT items in the IT register have no cost recorded, so their depreciation is unknown here. IT should add the cost from the invoice.
          </p>
        )}
      </Card>
      <EndOfLife data={data} />
      <Disposals data={data} />
    </div>
  );
}

type Old = FixedAssets['endOfLife'][number];
const LIFE: Record<Old['state'], ['warn' | 'info' | 'ok', string]> = {
  to_review: ['warn', 'To review'],
  keep: ['ok', 'Kept in use'],
  rehab: ['info', 'Refurbished'],
};

/** Written off but still in use (Fauzan, 27 Oct 2026): keep using it or refurbish it; dispose only when neither works. */
function EndOfLife({ data }: { data: FixedAssets }) {
  const [all, setAll] = useState(false);
  const rows = data.endOfLife.filter((x) => all || x.state === 'to_review');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Written off, still in use</h3>
        <button className="btn btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Only to review' : `Show all ${data.endOfLife.length}`}
        </button>
      </div>
      <p className="muted small">
        Fully written off after its useful life. If it can still be used, keep using it or refurbish it, and check it again every{' '}
        {data.rule.endOfLifeReviewMonths} months. Dispose only when it can no longer be used or refurbished. Finance decides whether a refurbishment cost is
        added to the asset or expensed.
      </p>
      <div className="list">
        {!rows.length && <div className="empty">Nothing to review.</div>}
        {rows.slice(0, 30).map((x) => (
          <OldLine key={x.asset.id} x={x} canAct={data.can.ask} />
        ))}
      </div>
    </section>
  );
}

function OldLine({ x, canAct }: { x: Old; canAct: boolean }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');
  const a = x.asset;
  const [tone, label] = LIFE[x.state];
  return (
    <div className="list-item fin-stack">
      <div className="row fin-between">
        <div className="fin-min0">
          <div className="fin-strong">
            {a.tag} {a.description}
          </div>
          <div className="muted small">
            {a.location} · bought {dateLabel(a.boughtOn)} for {rm(a.cost)} · condition {a.condition}
            {x.last
              ? ` · ${x.last.decision === 'rehab' ? `refurbished ${rm(x.last.cost ?? 0)}` : 'kept'} ${dateLabel(x.last.on)}, next check ${dateLabel(x.last.nextReviewOn)}`
              : ''}
          </div>
          {x.last?.note && <div className="small">{x.last.note}</div>}
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      {canAct && (
        <button className="btn btn-sm fin-self-start" onClick={() => setOpen(!open)}>
          Review
        </button>
      )}
      {open && (
        <div className="row">
          <input
            className="input"
            aria-label="Condition or work done"
            placeholder="Condition, or what is refurbished"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <input
            className="input"
            aria-label="Refurbishment cost"
            placeholder="Refurbishment cost (RM)"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || !note.trim()}
            onClick={() => act.run(() => api.amLifeReview(a.id, 'keep', { note }), 'Kept in use.')}
          >
            Keep using
          </button>
          <button
            className="btn btn-sm"
            disabled={act.busy || !note.trim() || !cost}
            onClick={() => act.run(() => api.amLifeReview(a.id, 'rehab', { note, cost: Number(cost) }), 'Refurbishment recorded.')}
          >
            Refurbish
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function EntityLine({ e, data }: { e: FixedAssets['entities'][number]; data: FixedAssets }) {
  const act = useAction();
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const acc = data.rule.accounts;
  return (
    <div className="list-item fin-stack">
      <div className="fin-strong">{e.ownerEntity}</div>
      <div className="muted small">
        {e.assets} assets · cost {rm(e.cost)} · depreciated {rm(e.accumulated)} · book value {rm(e.nbv)}
      </div>
      {e.months.map((m) => (
        <div key={m.period} className="row fin-between">
          <span className="small">
            {m.period}: {rm(m.amount)}
          </span>
          {m.posting ? (
            <Chip tone="ok">SQL {m.posting.sqlRef}</Chip>
          ) : m.amount === 0 ? (
            <Chip tone="info">Nothing to post</Chip>
          ) : data.can.post ? (
            <span className="row">
              <input
                className="input fin-w-sm"
                aria-label={`SQL journal for ${m.period}`}
                placeholder="SQL journal no."
                value={refs[m.period] ?? ''}
                onChange={(ev) => setRefs({ ...refs, [m.period]: ev.target.value })}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() => act.run(() => api.postDepreciation(e.ownerEntity, m.period, refs[m.period] ?? ''), 'Posting recorded.')}
              >
                Posted
              </button>
            </span>
          ) : (
            <Chip tone="warn">Not posted</Chip>
          )}
        </div>
      ))}
      {e.journal.length > 0 && (
        <button className="btn btn-sm fin-self-start" onClick={() => setShow(!show)}>
          {show ? 'Hide journal' : `Journal for ${data.period}`}
        </button>
      )}
      {show && (
        <ul className="small fin-ul">
          {e.journal.map((l) => (
            <li key={l.category}>
              Debit {acc.expense} Depreciation, {CATEGORY[l.category]}: {rm(l.amount)} · Credit {acc.accumulated} Accumulated depreciation
            </li>
          ))}
        </ul>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Disposals({ data }: { data: FixedAssets }) {
  const [all, setAll] = useState(false);
  const rows = data.disposals.filter((d) => all || d.state !== 'closed');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Disposals</h3>
        <button className="btn btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Hide posted' : 'Show posted'}
        </button>
      </div>
      <p className="muted small">
        The Asset Management team asks with the reason and method. The Finance Director approves a book value up to {rm(data.rule.fdApprovesUpTo)}, the COO
        above that; the person who asked never decides. Then the team records the receipt or scrap note, and Finance posts the gain or loss in SQL Account.
      </p>
      <div className="list">
        {!rows.length && (
          <div className="empty">
            No disposals open.{' '}
            {data.can.ask
              ? 'To start one, mark the asset "waiting for disposal" with Edit on the Assets tab, or choose Dispose on a written-off asset above.'
              : 'The Asset Management team starts them.'}
          </div>
        )}
        {rows.slice(0, 40).map((d) => (
          <DisposalLine key={d.asset.id} d={d} data={data} />
        ))}
      </div>
    </section>
  );
}

function DisposalLine({ d, data }: { d: Disposal; data: FixedAssets }) {
  const act = useAction();
  const a = d.asset;
  const x = a.disposal ?? null;
  const [f, setF] = useState({
    reason: '',
    method: 'SCRAP' as NonNullable<DisposalBody['method']>,
    estProceeds: '0',
    note: '',
    on: '',
    proceeds: '',
    party: '',
    proofRef: '',
    sqlRef: '',
  });
  const team = data.can.ask;
  const run = (action: Parameters<typeof api.amDisposalStep>[1], body: DisposalBody, msg: string) => act.run(() => api.amDisposalStep(a.id, action, body), msg);
  return (
    <div className="list-item fin-stack">
      <div className="row fin-between">
        <div className="fin-min0">
          <div className="fin-strong">
            {a.tag}: {a.description}
          </div>
          <div className="muted small">
            {a.ownerEntity} · {a.location} · cost {rm(a.cost)} · book value {rm(d.nbv)} · decided by the {d.approver === 'fd' ? 'Finance Director' : 'COO'}
          </div>
          {x && (
            <div className="small">
              {METHOD[x.method]}: {x.reason} · asked by {x.askedBy}
              {x.estProceeds ? `, expects ${rm(x.estProceeds)}` : ''}
            </div>
          )}
          {x?.decision && (
            <div className="small">
              {x.decision.approve ? 'Approved' : 'Rejected'} by {x.decision.by}
              {x.decision.note ? `: ${x.decision.note}` : ''}
            </div>
          )}
          {x?.done && (
            <div className="small">
              Disposed {dateLabel(x.done.on)} to {x.done.party} for {rm(x.done.proceeds)} ({x.done.proofRef})
              {d.gainLoss != null ? ` · ${d.gainLoss >= 0 ? 'gain' : 'loss'} ${rm(Math.abs(d.gainLoss))}` : ''}
              {x.sqlRef ? ` · SQL ${x.sqlRef}` : ''}
            </div>
          )}
        </div>
        <Chip tone={STATE[d.state][0]}>{STATE[d.state][1]}</Chip>
      </div>
      {team && (d.state === 'no_request' || d.state === 'rejected') && (
        <div className="row">
          <input className="input" aria-label="Reason" placeholder="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          <select className="input" aria-label="Method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as typeof f.method })}>
            {Object.entries(METHOD).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
          <input
            className="input"
            aria-label="Expected proceeds"
            placeholder="Expected proceeds (RM)"
            inputMode="decimal"
            value={f.estProceeds}
            onChange={(e) => setF({ ...f, estProceeds: e.target.value })}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => run('ask', { reason: f.reason, method: f.method, estProceeds: Number(f.estProceeds) }, 'Disposal requested.')}
          >
            Ask to dispose
          </button>
        </div>
      )}
      {d.canDecide && (
        <div className="row">
          <input
            className="input"
            aria-label="Note"
            placeholder="Note (needed to reject)"
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => run('approve', { note: f.note }, 'Approved.')}>
            Approve
          </button>
          <button className="btn btn-sm" disabled={act.busy} onClick={() => run('reject', { note: f.note }, 'Rejected.')}>
            Reject
          </button>
        </div>
      )}
      {team && d.state === 'to_dispose' && (
        <div className="fin-grid">
          <label className="small">
            Disposed on
            <input className="input" type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
          </label>
          <input
            className="input"
            aria-label="Proceeds"
            placeholder="Proceeds received (RM)"
            inputMode="decimal"
            value={f.proceeds}
            onChange={(e) => setF({ ...f, proceeds: e.target.value })}
          />
          <input
            className="input"
            aria-label="Taken by"
            placeholder="Buyer, scrap dealer or charity"
            value={f.party}
            onChange={(e) => setF({ ...f, party: e.target.value })}
          />
          <input
            className="input"
            aria-label="Receipt number"
            placeholder="Receipt or scrap note number"
            value={f.proofRef}
            onChange={(e) => setF({ ...f, proofRef: e.target.value })}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => run('done', { on: f.on, proceeds: Number(f.proceeds || 0), party: f.party, proofRef: f.proofRef }, 'Disposal recorded.')}
          >
            Record disposal
          </button>
        </div>
      )}
      {data.can.post && d.state === 'to_post' && (
        <div className="row">
          <input
            className="input"
            aria-label="SQL journal"
            placeholder="SQL journal no."
            value={f.sqlRef}
            onChange={(e) => setF({ ...f, sqlRef: e.target.value })}
          />
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => run('post', { sqlRef: f.sqlRef }, 'Posting recorded.')}>
            Posted
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
