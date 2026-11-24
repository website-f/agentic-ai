import { useMemo, useState } from 'react';
import { api, type FinSqlPosting } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';

/**
 * Finance > Checks > SQL Account link (Fauzan, 13 Nov 2026, Build 1). Prima posts approved, finished records into each
 * company's own SQL Account book through the vendor API only. Until posting is switched on everything waits here with
 * its reason, so nothing is lost. The server enforces every role and check.
 */

type Co = Extract<FinSqlPosting, { installed: true }>['companies'][number];
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE: Record<string, 'ok' | 'warn' | 'crit' | 'neutral'> = {
  posted: 'ok',
  checked_ok: 'ok',
  ready: 'neutral',
  not_ready: 'neutral',
  sending: 'neutral',
  retryable_error: 'warn',
  outcome_unknown: 'warn',
  manual_review: 'warn',
  rejected: 'crit',
  check_failed: 'crit',
};

export function SqlAccountLinkPanel({ companyId }: { companyId: string }) {
  const [n, setN] = useState(0);
  const { data, error } = useLoad(() => api.finSqlPosting(), [n]);
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="SQL Account link" />;
  const reload = () => setN((x) => x + 1);
  const run = async (kind: Parameters<typeof api.finSqlPostingAct>[0], input: Record<string, unknown>, msg: string) => {
    const r = await act.run(() => api.finSqlPostingAct(kind, input), msg);
    if (r) reload();
    return r;
  };
  const head = (
    <div className="panel-head">
      <h3>SQL Account link · Pautan SQL Account</h3>
    </div>
  );
  if (!data.installed)
    return (
      <section className="panel">
        {head}
        <p className="muted small" style={{ padding: '0 12px 12px' }}>
          Not installed in this database yet. Prima will post approved payments and receipts into each company's own SQL Account book once the CEO installs it and switches it on. Not connected.
        </p>
      </section>
    );
  const co = data.companies.find((c) => c.companyId === companyId);
  return (
    <section className="panel">
      {head}
      <p className="muted small" style={{ padding: '0 12px' }}>
        {data.enabled && data.posterInstalled
          ? 'Posting is on in Prima. Each company and document type is switched on by the Finance Director or the CEO.'
          : 'Not connected: posting is switched off in Prima. Jobs wait here with their reason and are sent later in order.'}{' '}
        SQL Account stays the books; Prima never writes its tables.
      </p>
      <ErrorNotice error={act.error} />
      {!co && <p className="muted" style={{ padding: 12 }}>This company is not in your Finance team.</p>}
      {co && <Company co={co} lead={!!data.lead} run={run} />}
      {data.lead && (
        <div style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" disabled={act.busy || !data.enabled} onClick={() => void run('send', {}, 'Sent what was ready.')}>
            Send now
          </button>
          <button className="btn" disabled={act.busy} onClick={() => void run('check', {}, 'Daily check done.')}>
            Check now
          </button>
        </div>
      )}
    </section>
  );
}

type Job = Co['jobs'][number];
/** One row of the codes table: a payee, a customer with a code, or a customer still without one. */
interface CodeRow {
  key: string;
  kind: 'payee' | 'customer';
  /** The payee id, or the customer's name. */
  id: string;
  name: string;
  code: string | null;
  state: 'checked' | 'tocheck' | 'none';
  mayCheck: boolean;
}
const codeRows = (co: Co): CodeRow[] => [
  ...co.payeeCodes.map((p): CodeRow => ({
    key: p.payeeId,
    kind: 'payee',
    id: p.payeeId,
    name: p.payee,
    code: p.code?.code ?? null,
    state: p.code ? (p.code.checked ? 'checked' : 'tocheck') : 'none',
    mayCheck: !!p.mayCheck,
  })),
  ...co.customerCodes.map((c): CodeRow => ({ key: `c-${c.customer}`, kind: 'customer', id: c.customer, name: c.customer, code: c.code, state: c.checked ? 'checked' : 'tocheck', mayCheck: !!c.mayCheck })),
  ...co.customersWithoutCode.map((name): CodeRow => ({ key: `n-${name}`, kind: 'customer', id: name, name, code: null, state: 'none', mayCheck: false })),
];
const CODE_STATE: Record<CodeRow['state'], ['ok' | 'warn' | 'neutral', string]> = { checked: ['ok', 'checked'], tocheck: ['warn', 'to check'], none: ['neutral', 'no code'] };
/** P107: the codes table's columns, drawn as the old table drew them. */
const CODE_COLUMNS: DtColumn<CodeRow>[] = [
  {
    id: 'name',
    label: 'Payee',
    value: (r) => r.name,
    render: (r) => <span data-no-translate>{r.kind === 'customer' ? `${r.name} (customer)` : r.name}</span>,
    phone: 'title',
  },
  { id: 'code', label: 'Code', value: (r) => r.code, render: (r) => <span data-no-translate>{r.code ?? '–'}</span> },
  { id: 'state', label: 'Status', value: (r) => CODE_STATE[r.state][1], translate: true, render: (r) => <Chip tone={CODE_STATE[r.state][0]}>{CODE_STATE[r.state][1]}</Chip> },
];
const CODE_FILTERS: DtFilter<CodeRow>[] = [
  { id: 'kind', label: 'Kind', value: (r) => r.kind, options: [{ value: 'payee', label: 'Payee' }, { value: 'customer', label: 'Customer' }] },
  { id: 'state', label: 'Status', value: (r) => r.state, options: Object.entries(CODE_STATE).map(([value, [, label]]) => ({ value, label })) },
];
/** P107: the posting jobs, drawn as the old table drew them; filters by status, document and month made. */
const JOB_COLUMNS: DtColumn<Job>[] = [
  { id: 'createdAt', label: 'Made', value: (j) => j.createdAt, sort: 'date', render: (j) => dateTimeLabel(j.createdAt), phone: 'sub' },
  {
    id: 'doc',
    label: 'Document',
    value: (j) => j.docLabel,
    render: (j) => (
      <>
        {j.docLabel}
        <div className="muted small" data-no-translate>
          {j.payload.ourRef}
        </div>
      </>
    ),
    phone: 'title',
  },
  { id: 'amount', label: 'Amount', value: (j) => j.payload.amount, sort: 'money', render: (j) => rm(j.payload.amount) },
  { id: 'status', label: 'Status', value: (j) => j.statusLabel, translate: true, render: (j) => <Chip tone={TONE[j.status] ?? 'neutral'}>{j.statusLabel}</Chip> },
  {
    id: 'why',
    label: 'Why / SQL number',
    value: (j) => (j.sqlDocNo ? `SQL Account: ${j.sqlDocNo}${j.postedAt ? ` on ${dateTimeLabel(j.postedAt)}` : ''}` : j.reasons.join(' ')),
    sort: false,
    render: (j) => <span className="small">{j.sqlDocNo ? `SQL Account: ${j.sqlDocNo}${j.postedAt ? ` on ${dateTimeLabel(j.postedAt)}` : ''}` : j.reasons.join(' ')}</span>,
  },
];
const JOB_FILTERS: DtFilter<Job>[] = [
  { id: 'status', label: 'Status', value: (j) => j.statusLabel },
  { id: 'doc', label: 'Document', value: (j) => j.docLabel },
  { id: 'month', label: 'Month', value: (j) => j.createdAt.slice(0, 7) },
];

function Company({ co, lead, run }: { co: Co; lead: boolean; run: (kind: 'switch' | 'code' | 'exception' | 'paste', input: Record<string, unknown>, msg: string) => Promise<unknown> }) {
  const [reason, setReason] = useState('');
  const [stage, setStage] = useState<'copy' | 'live'>(co.stage);
  const [types, setTypes] = useState<Record<string, boolean>>(Object.fromEntries(co.docTypes.map((t) => [t.docType, t.on])));
  const [code, setCode] = useState<Record<string, string>>({});
  const [comment, setComment] = useState<Record<string, string>>({});
  const [rev, setRev] = useState<Record<string, string>>({});
  const [csv, setCsv] = useState('');
  const codes = useMemo(() => codeRows(co), [co]);
  return (
    <>
      <div className="kpis">
        <Kpi label="Waiting for codes" value={co.counts.codes} tone={co.counts.codes ? 'warn' : 'ok'} />
        <Kpi label="Waiting to send" value={co.counts.waiting} tone="neutral" />
        <Kpi label="Refused" value={co.counts.refused} tone={co.counts.refused ? 'crit' : 'ok'} />
        <Kpi label="Unknown" value={co.counts.unknown} tone={co.counts.unknown ? 'warn' : 'ok'} />
        <Kpi label="Differences" value={co.counts.differences} tone={co.counts.differences ? 'crit' : 'ok'} />
      </div>
      <p className="small" style={{ padding: '0 12px' }}>
        Book: <b data-no-translate>{co.book ?? 'not confirmed'}</b> ({co.stage === 'live' ? 'real book' : 'copy'}) · Posting for this company: <Chip tone={co.on ? 'ok' : 'neutral'}>{co.on ? 'on' : 'off'}</Chip> · Last post: {co.lastPostedAt ? dateTimeLabel(co.lastPostedAt) : 'none'} · Last daily
        check: {co.lastCheckedAt ? dateTimeLabel(co.lastCheckedAt) : 'not checked yet'}
      </p>
      {lead && (
        <details style={{ padding: '0 12px' }}>
          <summary className="small">Switch posting for this company (Finance Director or CEO, with a reason)</summary>
          {co.docTypes.map((t) => (
            <label key={t.docType} className="small" style={{ display: 'block' }}>
              <input type="checkbox" disabled={!t.built} checked={!!types[t.docType]} onChange={(e) => setTypes({ ...types, [t.docType]: e.target.checked })} /> {t.label}
              {!t.built && <span className="muted"> (waits for SQL support's answer)</span>}
            </label>
          ))}
          {/* D4 (Fauzan, 23 Nov 2026): payment vouchers only, one company first, on the copy of the book first. */}
          <label className="small" style={{ display: 'block', marginTop: 6 }}>
            Post to{' '}
            <select className="select" aria-label="Post to" value={stage} onChange={(e) => setStage(e.target.value === 'live' ? 'live' : 'copy')}>
              <option value="copy">The copy of the book (first)</option>
              <option value="live">The real book (after a checked voucher on the copy)</option>
            </select>
          </label>
          <input className="input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button className="btn" onClick={() => void run('switch', { companyId: co.companyId, on: true, stage, docTypes: types, reason }, 'Posting switched on for the ticked types.')}>
              Switch on
            </button>
            <button className="btn" onClick={() => void run('switch', { companyId: co.companyId, on: false, docTypes: {}, reason }, 'Posting switched off.')}>
              Switch off
            </button>
          </div>
        </details>
      )}

      <h4 style={{ margin: '12px 12px 4px' }}>Exceptions to explain and check</h4>
      {co.exceptions.length === 0 && <p className="muted small" style={{ padding: '0 12px' }}>None.</p>}
      {co.exceptions.map((e) => (
        <div key={e.id} className="card" style={{ margin: '4px 12px', padding: 8 }}>
          <div className="small">
            <Chip tone={e.status === 'checked' ? 'ok' : e.overdue ? 'crit' : 'warn'}>{e.status}</Chip> <b>{e.label}</b>
            {e.origin === 'pasted_export' && <span className="muted"> (from a pasted export)</span>}
          </div>
          <div className="small" data-no-translate>
            {e.text}
          </div>
          {e.explained && (
            <div className="muted small">
              Explained by {e.explained.by}: {e.explained.comment}
              {e.explained.reversingDocNo ? ` (reversed by ${e.explained.reversingDocNo})` : ''}
            </div>
          )}
          {e.checked && <div className="muted small">Checked by {e.checked.by}: {e.checked.comment}</div>}
          {e.may.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {e.kind === 'reverse' && e.may.includes('explain') && <input className="input" style={{ width: 180 }} placeholder="Reversing document no." value={rev[e.id] ?? ''} onChange={(x) => setRev({ ...rev, [e.id]: x.target.value })} />}
              <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder={e.may.includes('explain') ? 'What you found or fixed' : 'How you checked it'} value={comment[e.id] ?? ''} onChange={(x) => setComment({ ...comment, [e.id]: x.target.value })} />
              <button
                className="btn"
                onClick={() =>
                  void run('exception', { id: e.id, action: e.may[0], comment: comment[e.id] ?? '', reversingDocNo: rev[e.id] ?? '' }, e.may[0] === 'explain' ? 'Explained.' : 'Checked.')
                }
              >
                {e.may[0] === 'explain' ? 'Explain' : 'Check'}
              </button>
            </div>
          )}
        </div>
      ))}

      <h4 style={{ margin: '12px 12px 4px' }}>SQL Account codes (entered by one person, checked by another)</h4>
      {/* P107: one table for payee and customer codes (and customers with no code yet): search, kind and state filters, pages. */}
      <DataTable
        label="SQL Account codes"
        stateKey={`fin.sqlcodes.${co.companyId}`}
        rows={codes}
        rowKey={(r) => r.key}
        columns={CODE_COLUMNS}
        filters={CODE_FILTERS}
        rowEnd={(r) =>
          r.kind === 'payee' ? (
            r.mayCheck ? (
              <button className="btn" onClick={() => void run('code', { companyId: co.companyId, action: 'payeeCodeCheck', payeeId: r.id, comment: 'Matches the list in SQL Account' }, 'Code checked.')}>
                Check
              </button>
            ) : (
              <span style={{ whiteSpace: 'nowrap' }}>
                <input className="input" style={{ width: 110 }} placeholder="Code" value={code[r.id] ?? ''} onChange={(x) => setCode({ ...code, [r.id]: x.target.value })} />{' '}
                <button className="btn" onClick={() => void run('code', { companyId: co.companyId, action: 'payeeCode', payeeId: r.id, code: code[r.id] ?? '' }, 'Code saved; someone else checks it.')}>
                  Save
                </button>
              </span>
            )
          ) : r.state !== 'none' ? (
            r.mayCheck && (
              <button className="btn" onClick={() => void run('code', { companyId: co.companyId, action: 'customerCodeCheck', customer: r.id, comment: 'Matches the list in SQL Account' }, 'Code checked.')}>
                Check
              </button>
            )
          ) : (
            <span style={{ whiteSpace: 'nowrap' }}>
              <input className="input" style={{ width: 110 }} placeholder="Code" value={code[`c:${r.id}`] ?? ''} onChange={(x) => setCode({ ...code, [`c:${r.id}`]: x.target.value })} />{' '}
              <button className="btn" onClick={() => void run('code', { companyId: co.companyId, action: 'customerCode', customer: r.id, code: code[`c:${r.id}`] ?? '' }, 'Code saved; someone else checks it.')}>
                Save
              </button>
            </span>
          )
        }
      />

      <h4 style={{ margin: '12px 12px 4px' }}>Documents</h4>
      <DataTable
        label="Documents"
        stateKey={`fin.sqljobs.${co.companyId}`}
        rows={co.jobs}
        rowKey={(j) => j.id}
        columns={JOB_COLUMNS}
        filters={JOB_FILTERS}
        empty={<p className="muted">Nothing yet. A job is made when a payment is released or a receipt is found on the bank statement.</p>}
      />

      <details style={{ padding: 12 }}>
        <summary className="small">Paste SQL Account's daily listing (when SQL Account cannot be read back)</summary>
        <p className="muted small">One line each: document number, date (YYYY-MM-DD), amount, reference. Prima lists documents that look like Prima postings typed by hand as well.</p>
        <textarea className="input" rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} />
        <button className="btn" onClick={() => void run('paste', { companyId: co.companyId, csv }, 'Listing compared.')}>
          Compare
        </button>
      </details>
    </>
  );
}
