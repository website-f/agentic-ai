import { useState } from 'react';
import { api, type FinControls } from '../api';
import { Chip, ErrorNotice, dateLabel, dateTimeLabel, useAction } from '../ui';

/**
 * Credit limits per private client (Fauzan, 2 Nov 2026: suggestion 4). Finance sets a limit and keeps each client's
 * balance from SQL Account. Prima warns Operations before a new post for a client over its limit or with an invoice
 * unpaid over 90 days; a post added anyway carries Operations' reason, and a Finance reviewer says what Finance does.
 */

const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Row = FinControls['credit']['clients'][number];
type Go = (action: string, input: Record<string, unknown>, msg: string) => Promise<unknown>;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ClientCredit({ v }: { v: FinControls }) {
  const act = useAction();
  const cr = v.credit;
  const go: Go = (action, input, msg) => act.run(() => api.finControlAction(v.companyId, 'credit', action, input), msg);
  const [note, setNote] = useState<Record<string, string>>({});
  const open = cr.overrides.filter((o) => !o.seen);
  if (!cr.clients.length && !cr.overrides.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Client credit limits</h3>
      </div>
      <p className="muted small" style={{ padding: '0 12px' }}>
        For private clients. Operations is warned before adding a post for a client over its limit or with an invoice unpaid over {cr.overdueDays} days; they
        may still add it with a reason, which shows here.
      </p>
      <ErrorNotice error={act.error} />
      {open.map((o) => (
        <div key={o.id} className="notice" data-tone="warn" style={{ margin: '0 12px 8px' }}>
          <div>
            {dateTimeLabel(o.at)}: {o.by} added post {o.post} for {o.client} ({o.warning}). Reason: {o.reason}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            <input
              className="input"
              placeholder="What Finance does (chase payment, agreed with the client)"
              value={note[o.id] ?? ''}
              onChange={(e) => setNote((x) => ({ ...x, [o.id]: e.target.value }))}
            />
            <button className="btn btn-sm" disabled={act.busy} onClick={() => go('seen', { overrideId: o.id, comment: note[o.id] }, 'Recorded.')}>
              Seen
            </button>
          </div>
        </div>
      ))}
      <div className="list">
        {cr.clients.map((c) => (
          <ClientLine key={c.id} c={c} go={go} busy={act.busy} />
        ))}
      </div>
    </section>
  );
}

function ClientLine({ c, go, busy }: { c: Row; go: Go; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="list-item" style={{ display: 'block' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <span>
          {c.name}
          <span className="muted">
            {' '}
            · {c.limit != null ? `limit ${rm(c.limit)}` : 'no limit set'}
            {c.owed != null ? ` · owes ${rm(c.owed)} (${c.asOf ? dateLabel(c.asOf) : ''})` : ''}
            {c.oldestUnpaidOn ? ` · oldest unpaid ${dateLabel(c.oldestUnpaidOn)}` : ''}
          </span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          <Chip tone={c.warn ? 'crit' : c.stale ? 'warn' : c.limit != null ? 'ok' : 'neutral'}>
            {c.warn ? 'Warns Operations' : c.stale ? 'Balance to refresh' : c.limit != null ? 'Within limit' : 'No limit'}
          </Chip>
          <button className="btn btn-sm" onClick={() => setOpen(!open)}>
            {open ? 'Close' : 'Open'}
          </button>
        </span>
      </div>
      {open && (
        <div style={{ paddingTop: 8 }}>
          {c.reasons.length > 0 && <p className="small">Prima warns because the client {c.reasons.join(' and ')}.</p>}
          {c.limit != null && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="Owed now (RM), from SQL Account">
                <input className="input" inputMode="decimal" value={f.owed ?? ''} onChange={set('owed')} />
              </Field>
              <Field label="Oldest unpaid invoice date">
                <input className="input" type="date" value={f.oldestUnpaidOn ?? ''} onChange={set('oldestUnpaidOn')} />
              </Field>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => go('balance', { clientAccountId: c.id, owed: Number(f.owed), oldestUnpaidOn: f.oldestUnpaidOn || undefined }, 'Balance saved.')}
              >
                Save balance
              </button>
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
            <Field label="Credit limit (RM) (Finance Director or CEO)">
              <input className="input" inputMode="decimal" value={f.limit ?? ''} onChange={set('limit')} />
            </Field>
            <Field label="Why this limit">
              <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
            </Field>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => go('limit', { clientAccountId: c.id, limit: Number(f.limit), comment: f.comment }, 'Limit saved.')}
            >
              Save limit
            </button>
            {c.limit != null && (
              <button
                className="btn btn-sm"
                disabled={busy || !f.comment}
                onClick={() => go('remove', { clientAccountId: c.id, comment: f.comment }, 'Limit removed.')}
              >
                Remove limit
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Sup = FinControls['supplierStatements']['rows'][number];

/**
 * Supplier statements (Fauzan, 2 Nov 2026: suggestion 11). Prima lists last quarter's biggest suppliers by money paid;
 * Finance types the supplier's statement balance and SQL Account's, any difference is explained, someone else reviews.
 */
export function SupplierStatements({ v }: { v: FinControls }) {
  const act = useAction();
  const s = v.supplierStatements;
  const go: Go = (action, input, msg) => act.run(() => api.finControlAction(v.companyId, 'supstatements', action, input), msg);
  if (!s.rows.length) return null;
  const done = s.rows.filter((r) => r.check?.reviewed).length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>
          Supplier statements, {s.quarter} (ended {dateLabel(s.endOn)})
        </h3>
        <Chip tone={done === s.rows.length ? 'ok' : s.late ? 'crit' : 'warn'}>{`${done} of ${s.rows.length} agreed`}</Chip>
      </div>
      <p className="muted small" style={{ padding: '0 12px' }}>
        The {s.rows.length} biggest suppliers by money paid in the last 12 months. Compare each supplier&apos;s statement with its balance in SQL Account by{' '}
        {dateLabel(s.dueOn)}; after that the close stays open.
      </p>
      <ErrorNotice error={act.error} />
      <div className="list">
        {s.rows.map((r) => (
          <SupLine key={r.payeeId} r={r} go={go} busy={act.busy} />
        ))}
      </div>
    </section>
  );
}

function SupLine({ r, go, busy }: { r: Sup; go: Go; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const c = r.check;
  const diff = f.statementBalance && f.ledgerBalance ? Math.round((Number(f.statementBalance) - Number(f.ledgerBalance)) * 100) / 100 : null;
  return (
    <div className="list-item" style={{ display: 'block' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <span>
          {r.supplier}
          <span className="muted">
            {' '}
            · paid {rm(r.paid12m)} in 12 months
            {c
              ? ` · statement ${rm(c.statementBalance)}, SQL Account ${rm(c.ledgerBalance)}${c.diff ? `, difference ${rm(c.diff)}: ${c.explanation}` : ''}`
              : ''}
          </span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          <Chip tone={c?.reviewed ? 'ok' : c ? 'warn' : 'neutral'}>{c?.reviewed ? 'Agreed and reviewed' : c ? 'To review' : 'To check'}</Chip>
          {!c?.reviewed && (
            <button className="btn btn-sm" onClick={() => setOpen(!open)}>
              {open ? 'Close' : 'Act'}
            </button>
          )}
        </span>
      </div>
      {open && !c && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', paddingTop: 8 }}>
          <Field label="Supplier's statement says we owe (RM)">
            <input className="input" inputMode="decimal" value={f.statementBalance ?? ''} onChange={set('statementBalance')} />
          </Field>
          <Field label="SQL Account creditor balance (RM)">
            <input className="input" inputMode="decimal" value={f.ledgerBalance ?? ''} onChange={set('ledgerBalance')} />
          </Field>
          <Field label="Statement (file name)">
            <input className="input" value={f.doc ?? ''} onChange={set('doc')} />
          </Field>
          {diff != null && diff !== 0 && (
            <Field label={`Why RM${diff.toFixed(2)} differs`}>
              <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
            </Field>
          )}
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() =>
              go(
                'record',
                {
                  payeeId: r.payeeId,
                  statementBalance: Number(f.statementBalance),
                  ledgerBalance: Number(f.ledgerBalance),
                  doc: f.doc,
                  comment: f.comment || undefined,
                },
                'Saved. Someone else reviews it next.',
              )
            }
          >
            Save
          </button>
        </div>
      )}
      {open && c && !c.reviewed && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', paddingTop: 8 }}>
          <Field label="What you looked at">
            <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
          </Field>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => go('review', { checkId: c.id, comment: f.comment }, 'Reviewed.')}>
            Reviewed
          </button>
        </div>
      )}
    </div>
  );
}
