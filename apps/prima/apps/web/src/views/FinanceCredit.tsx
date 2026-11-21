import { useState } from 'react';
import { api, type FinControls } from '../api';
import { Chip, ErrorNotice, dateLabel, dateTimeLabel, useAction, type Tone } from '../ui';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';

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
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const open = cr.overrides.filter((o) => !o.seen);
  if (!cr.clients.length && !cr.overrides.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Client credit limits</h3>
      </div>
      <p className="muted small fin-intro">
        For private clients. Operations is warned before adding a post for a client over its limit or with an invoice unpaid over {cr.overdueDays} days; they
        may still add it with a reason, which shows here.
      </p>
      <ErrorNotice error={act.error} />
      {open.map((o) => (
        <div key={o.id} className="notice fin-inset" data-tone="warn">
          <div>
            {dateTimeLabel(o.at)}: {o.by} added post {o.post} for {o.client} ({o.warning}). Reason: {o.reason}
          </div>
          <div className="row fin-mt">
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
      <DataTable
        label="Client credit limits"
        stateKey={`fin.credit.${v.companyId}`}
        rows={cr.clients}
        rowKey={(c) => c.id}
        columns={CLIENT_COLUMNS}
        filters={CLIENT_FILTERS}
        rowEnd={(c) => (
          <button className="btn btn-sm" onClick={() => setOpened((x) => ({ ...x, [c.id]: !x[c.id] }))}>
            {opened[c.id] ? 'Close' : 'Open'}
          </button>
        )}
        rowDetail={(c) =>
          opened[c.id] ? (
            <ClientLine c={c} go={go} busy={act.busy} f={forms[c.id] ?? {}} setF={(fn) => setForms((x) => ({ ...x, [c.id]: fn(x[c.id] ?? {}) }))} />
          ) : null
        }
      />
    </section>
  );
}

type Form = Record<string, string>;
type SetForm = (fn: (f: Form) => Form) => void;
const clientState = (c: Row) => (c.warn ? 'warn' : c.stale ? 'stale' : c.limit != null ? 'within' : 'none');
const CLIENT_STATE: Record<string, [Tone, string]> = {
  warn: ['crit', 'Warns Operations'],
  stale: ['warn', 'Balance to refresh'],
  within: ['ok', 'Within limit'],
  none: ['neutral', 'No limit'],
};
/** P107: the clients as a table; Open shows the balance and limit forms under the row, as before. */
const CLIENT_COLUMNS: DtColumn<Row>[] = [
  { id: 'name', label: 'Client', value: (c) => c.name, phone: 'title' },
  { id: 'limit', label: 'Credit limit', value: (c) => c.limit, sort: 'money', render: (c) => (c.limit != null ? rm(c.limit) : 'no limit set') },
  { id: 'owed', label: 'Owed', value: (c) => c.owed, sort: 'money', render: (c) => (c.owed != null ? <>{rm(c.owed)}{c.asOf && <div className="muted small">{dateLabel(c.asOf)}</div>}</> : '–') },
  { id: 'oldest', label: 'Oldest unpaid', value: (c) => c.oldestUnpaidOn, sort: 'date', render: (c) => (c.oldestUnpaidOn ? dateLabel(c.oldestUnpaidOn) : '–'), hideBelow: 1100 },
  {
    id: 'status',
    label: 'Status',
    value: (c) => CLIENT_STATE[clientState(c)][1],
    translate: true,
    render: (c) => <Chip tone={CLIENT_STATE[clientState(c)][0]}>{CLIENT_STATE[clientState(c)][1]}</Chip>,
  },
];
const CLIENT_FILTERS: DtFilter<Row>[] = [
  { id: 'status', label: 'Status', value: clientState, options: Object.entries(CLIENT_STATE).map(([value, [, label]]) => ({ value, label })) },
];

function ClientLine({ c, go, busy, f, setF }: { c: Row; go: Go; busy: boolean; f: Form; setF: SetForm }) {
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="fin-pt">
      {c.reasons.length > 0 && <p className="small">Prima warns because the client {c.reasons.join(' and ')}.</p>}
      {c.limit != null && (
        <div className="row fin-end">
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
      <div className="row fin-mt fin-end">
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
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [forms, setForms] = useState<Record<string, Form>>({});
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
      <p className="muted small fin-intro">
        The {s.rows.length} biggest suppliers by money paid in the last 12 months. Compare each supplier&apos;s statement with its balance in SQL Account by{' '}
        {dateLabel(s.dueOn)}; after that the close stays open.
      </p>
      <ErrorNotice error={act.error} />
      <DataTable
        label="Supplier statements"
        stateKey={`fin.supstatements.${v.companyId}`}
        rows={s.rows}
        rowKey={(r) => r.payeeId}
        columns={SUP_COLUMNS}
        filters={SUP_FILTERS}
        rowEnd={(r) =>
          !r.check?.reviewed ? (
            <button className="btn btn-sm" onClick={() => setOpened((x) => ({ ...x, [r.payeeId]: !x[r.payeeId] }))}>
              {opened[r.payeeId] ? 'Close' : 'Act'}
            </button>
          ) : null
        }
        rowDetail={(r) =>
          opened[r.payeeId] && !r.check?.reviewed ? (
            <SupLine r={r} go={go} busy={act.busy} f={forms[r.payeeId] ?? {}} setF={(fn) => setForms((x) => ({ ...x, [r.payeeId]: fn(x[r.payeeId] ?? {}) }))} />
          ) : null
        }
      />
    </section>
  );
}

const supState = (r: Sup) => (r.check?.reviewed ? 'reviewed' : r.check ? 'review' : 'check');
const SUP_STATE: Record<string, [Tone, string]> = { check: ['neutral', 'To check'], review: ['warn', 'To review'], reviewed: ['ok', 'Agreed and reviewed'] };
/** P107: the suppliers as a table; Act shows the record or review form under the row, as before. */
const SUP_COLUMNS: DtColumn<Sup>[] = [
  { id: 'supplier', label: 'Supplier', value: (r) => r.supplier, phone: 'title' },
  { id: 'paid12m', label: 'Paid in 12 months', value: (r) => r.paid12m, sort: 'money', render: (r) => rm(r.paid12m) },
  { id: 'statement', label: 'Statement', value: (r) => r.check?.statementBalance, sort: 'money', render: (r) => (r.check ? rm(r.check.statementBalance) : '–') },
  { id: 'ledger', label: 'SQL Account', value: (r) => r.check?.ledgerBalance, sort: 'money', render: (r) => (r.check ? rm(r.check.ledgerBalance) : '–') },
  {
    id: 'diff',
    label: 'Difference',
    value: (r) => (r.check?.diff ? r.check.diff : null),
    sort: 'money',
    render: (r) => (r.check?.diff ? <>{rm(r.check.diff)}<div className="muted small">{r.check.explanation}</div></> : '–'),
  },
  { id: 'status', label: 'Status', value: (r) => SUP_STATE[supState(r)][1], translate: true, render: (r) => <Chip tone={SUP_STATE[supState(r)][0]}>{SUP_STATE[supState(r)][1]}</Chip> },
];
const SUP_FILTERS: DtFilter<Sup>[] = [
  { id: 'status', label: 'Status', value: supState, options: Object.entries(SUP_STATE).map(([value, [, label]]) => ({ value, label })) },
];

function SupLine({ r, go, busy, f, setF }: { r: Sup; go: Go; busy: boolean; f: Form; setF: SetForm }) {
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const c = r.check;
  const diff = f.statementBalance && f.ledgerBalance ? Math.round((Number(f.statementBalance) - Number(f.ledgerBalance)) * 100) / 100 : null;
  return (
    <>
      {!c && (
        <div className="row fin-pt fin-end">
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
      {c && !c.reviewed && (
        <div className="row fin-pt fin-end">
          <Field label="What you looked at">
            <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
          </Field>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => go('review', { checkId: c.id, comment: f.comment }, 'Reviewed.')}>
            Reviewed
          </button>
        </div>
      )}
    </>
  );
}
