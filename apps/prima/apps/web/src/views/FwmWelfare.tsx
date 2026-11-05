import { useState } from 'react';
import { FW_CHECK_LABEL, FW_CONCERN_LABEL, type FwCheckKind, type FwConcern, type ProofInput } from '@prima/core';
import { api, type FwmWelfare } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';
import { DocList, ProofPicker } from './Proof';

/**
 * Responsible recruitment and worker welfare (masterplan §240, Fauzan 3 Nov 2026). FWM asks each new foreign worker
 * privately what they paid to get the job, checks who holds their passport, and has a regular private welfare talk.
 * A fee, a passport held without consent or a concern opens a follow-up that someone else closes.
 */

type Worker = FwmWelfare['workers'][number];
type Open = FwmWelfare['open'][number];
type Check = Worker['history'][number];
type Closed = FwmWelfare['closed'][number];

const PAGE = 50;

const CONCERNS: FwConcern[] = ['PAY', 'HOURS', 'HOUSING', 'TREATMENT', 'FEES', 'DOCUMENTS', 'HEALTH', 'OTHER'];

function today(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function since(days: number | null): string {
  return days === null ? 'never' : days === 0 ? 'today' : `${days} days ago`;
}

export function FwmWelfarePanel() {
  const { data, error } = useLoad(() => api.fwmWelfare(), []);
  const [tab, setTab] = useState<'workers' | 'open' | 'closed' | 'agencies'>('workers');
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'open' | 'due'>('all');
  const [page, setPage] = useState(0);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="welfare checks" />;
  // The whole list, searchable and paged (Arisha main review, 3 Nov 2026: no worker may fall off the end).
  const needle = q.trim().toLowerCase();
  const matched = data.workers.filter(
    (w) =>
      (!needle || `${w.person.name} ${w.person.staffNo} ${w.person.companyName}`.toLowerCase().includes(needle)) &&
      (only === 'all' || (only === 'open' ? w.open > 0 : w.feeDue || w.passportDue || w.welfareDue)),
  );
  const pages = Math.max(1, Math.ceil(matched.length / PAGE));
  const at = Math.min(page, pages - 1);
  const shown = matched.slice(at * PAGE, at * PAGE + PAGE);
  return (
    <>
      <div className="kpis">
        <Kpi label="Fee not asked yet" value={data.counts.feeNotChecked} tone={data.counts.feeNotChecked ? 'unknown' : 'ok'} note="Unknown, not green" />
        {data.counts.feesFound !== null && <Kpi label="Fees found" value={data.counts.feesFound} tone={data.counts.feesFound ? 'crit' : 'ok'} note="Workers who paid to get the job" />}
        <Kpi label="Passport with company" value={data.counts.passportWithCompany} tone={data.counts.passportNoConsent ? 'crit' : data.counts.passportWithCompany ? 'warn' : 'ok'} note={`${data.counts.passportNoConsent} without signed consent`} />
        <Kpi label="Passport check due" value={data.counts.passportDue} tone={data.counts.passportDue ? 'warn' : 'ok'} note={`Every ${data.rules.passport.value} days`} />
        <Kpi label="Welfare talk due" value={data.counts.welfareDue} tone={data.counts.welfareDue ? 'warn' : 'ok'} note={`Every ${data.rules.welfare.value} days`} />
        <Kpi label="Open follow-ups" value={data.counts.open} tone={data.counts.open ? 'crit' : 'ok'} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Recruitment and welfare</h2>
          <div className="tabbar" role="tablist" aria-label="Welfare sections">
            <button role="tab" aria-selected={tab === 'workers'} onClick={() => setTab('workers')}>
              Workers
            </button>
            <button role="tab" aria-selected={tab === 'open'} onClick={() => setTab('open')}>
              Follow-ups
              {data.open.length > 0 && <span className="tab-count">{data.open.length}</span>}
            </button>
            {data.confidential && (
              <button role="tab" aria-selected={tab === 'closed'} onClick={() => setTab('closed')}>
                Closed
              </button>
            )}
            {data.confidential && (
              <button role="tab" aria-selected={tab === 'agencies'} onClick={() => setTab('agencies')}>
                Agencies
              </button>
            )}
          </div>
        </div>
        {!data.confidential && (
          <p className="muted small" style={{ padding: '0 12px' }}>
            You see when each check was done and any passport follow-up your company must act on. Fees and what workers raise stay with FWM and the group leaders, so nobody can tell who spoke up.
          </p>
        )}
        {tab === 'workers' && (
          <div className="list">
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', padding: '0 12px' }}>
              <input
                className="input"
                aria-label="Search workers"
                placeholder="Search name, staff no or company"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
              />
              <select
                className="select"
                aria-label="Show"
                value={only}
                onChange={(e) => {
                  setOnly(e.target.value as 'all' | 'open' | 'due');
                  setPage(0);
                }}
              >
                <option value="all">All workers</option>
                <option value="open">With a follow-up open</option>
                <option value="due">With a check due</option>
              </select>
            </div>
            {matched.length === 0 && <div className="empty">{data.workers.length ? 'No worker matches.' : 'No foreign worker on record.'}</div>}
            {shown.map((w) => (
              <WorkerRow key={w.person.id} w={w} canRecord={data.canRecord} confidential={data.confidential} />
            ))}
            {matched.length > 0 && (
              <div className="row" style={{ gap: 6, justifyContent: 'space-between', padding: '0 12px' }}>
                <span className="muted small" aria-live="polite">
                  {at * PAGE + 1}–{at * PAGE + shown.length} of {matched.length}
                  {matched.length !== data.workers.length ? ` (${data.workers.length} in all)` : ''}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <button className="btn btn-sm" disabled={at === 0} onClick={() => setPage(at - 1)}>
                    Previous
                  </button>
                  <button className="btn btn-sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
                    Next
                  </button>
                </span>
              </div>
            )}
          </div>
        )}
        {tab === 'open' && (
          <div className="list">
            {data.open.length === 0 && <div className="empty">Nothing open.</div>}
            {data.open.map((o) => (
              <OpenRow key={o.check.id} o={o} confidential={data.confidential} />
            ))}
          </div>
        )}
        {tab === 'closed' && (
          <div className="list">
            {data.closed.length === 0 && <div className="empty">Nothing closed yet.</div>}
            {data.closed.map((x) => (
              <ClosedRow key={x.check.id} x={x} />
            ))}
          </div>
        )}
        {tab === 'agencies' && (
          <div className="list">
            {data.agencies.length === 0 && <div className="empty">No arrival fee check yet.</div>}
            {data.agencies.map((a) => (
              <div key={a.agency} className="list-item" style={{ justifyContent: 'space-between', gap: 6 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{a.agency}</div>
                  <div className="muted small">
                    {a.checked} workers asked · {a.feesFound} paid a fee · RM{a.paid.toLocaleString()} paid, RM{a.repaid.toLocaleString()} paid back
                  </div>
                </div>
                <Chip tone={a.open ? 'crit' : a.feesFound ? 'warn' : 'ok'}>{a.open ? `${a.open} open` : a.feesFound ? 'Fees found' : 'No fees'}</Chip>
              </div>
            ))}
          </div>
        )}
        <p className="muted small" style={{ padding: '8px 12px' }}>
          {data.rules.zeroFee.source} {data.rules.passport.source}
        </p>
      </section>
    </>
  );
}

function WorkerRow({ w, canRecord, confidential }: { w: Worker; canRecord: boolean; confidential: boolean }) {
  const [mode, setMode] = useState<FwCheckKind | null>(null);
  const [history, setHistory] = useState(false);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{w.person.name}</div>
          <div className="muted small">
            {w.person.staffNo} · {w.person.companyName} · hired {dateLabel(w.person.hiredOn)}
          </div>
          <div className="small">
            Fee: {w.feeDue ? 'not asked yet' : !w.fee ? 'asked' : w.fee.paidAnything ? 'paid a fee' : 'paid nothing'}
            {' · '}Passport:{' '}
            {w.passportHolder
              ? `${w.passportHolder === 'company' ? (w.passportConsented ? 'with the company, consent signed' : 'with the company, no consent') : 'with the worker'}, checked ${since(w.passportDaysSince)}`
              : 'never checked'}
            {' · '}Welfare talk: {since(w.welfareDaysSince)}
          </div>
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {w.open > 0 && <Chip tone="crit">{w.open} open</Chip>}
          {w.feeDue && <Chip tone="unknown">Fee not asked</Chip>}
          {w.passportDue && <Chip tone="warn">Passport check due</Chip>}
          {w.welfareDue && <Chip tone="warn">Talk due</Chip>}
        </div>
      </div>
      {confidential && w.history.length > 0 && (
        <div>
          <button className="btn btn-sm" aria-expanded={history} onClick={() => setHistory(!history)}>
            {history ? 'Hide history' : `History (${w.history.length})`}
          </button>
        </div>
      )}
      {history && (
        <div className="list" style={{ gap: 4 }}>
          {w.history.map((c) => (
            <HistoryItem key={c.id} c={c} />
          ))}
        </div>
      )}
      {canRecord && !mode && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {w.feeDue && (
            <button className="btn btn-sm" onClick={() => setMode('ARRIVAL_FEE')}>
              Arrival fee check
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setMode('PASSPORT')}>
            Passport check
          </button>
          <button className="btn btn-sm" onClick={() => setMode('WELFARE')}>
            Welfare talk
          </button>
        </div>
      )}
      {mode && <CheckForm personId={w.person.id} kind={mode} onDone={() => setMode(null)} />}
    </div>
  );
}

function CheckForm({ personId, kind, onDone }: { personId: string; kind: FwCheckKind; onDone: () => void }) {
  const [checkedOn, setCheckedOn] = useState(today());
  const [agency, setAgency] = useState('');
  const [paid, setPaid] = useState<'no' | 'yes' | ''>('');
  const [amount, setAmount] = useState('');
  const [paidTo, setPaidTo] = useState('');
  const [heldBy, setHeldBy] = useState<'worker' | 'company'>('worker');
  const [concerns, setConcerns] = useState<FwConcern[]>([]);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const ready =
    kind === 'ARRIVAL_FEE'
      ? agency.trim().length >= 2 && (paid === 'no' || (paid === 'yes' && Number(amount) > 0 && paidTo.trim().length >= 2))
      : kind === 'WELFARE'
        ? !concerns.length || note.trim().length >= 5
        : true;
  return (
    <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="muted small">
        {kind === 'ARRIVAL_FEE'
          ? 'Ask in private, in Nepali, with nobody from the agency or the site present: did you pay anyone to get this job?'
          : kind === 'PASSPORT'
            ? 'The worker keeps their passport. Company safekeeping only with the worker\'s signed consent, attached here.'
            : 'A private talk: pay, hours, hostel, how they are treated. Write down what they raise in their words.'}
      </div>
      <label className="field">
        <span className="label">Date of the check</span>
        <input className="input" type="date" aria-label="Date of the check" value={checkedOn} onChange={(e) => setCheckedOn(e.target.value)} />
      </label>
      {kind === 'ARRIVAL_FEE' && (
        <>
          <input className="input" aria-label="Agency" placeholder="Recruiting agency" value={agency} onChange={(e) => setAgency(e.target.value)} />
          <select className="select" aria-label="Paid anything" value={paid} onChange={(e) => setPaid(e.target.value as 'no' | 'yes' | '')}>
            <option value="">Did the worker pay anyone?</option>
            <option value="no">No, nothing</option>
            <option value="yes">Yes, they paid</option>
          </select>
          {paid === 'yes' && (
            <div className="grid-2">
              <input className="input" type="number" min="1" aria-label="Amount paid (RM)" placeholder="Amount (RM)" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <input className="input" aria-label="Paid to" placeholder="Paid to, such as the agent in Nepal" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} />
            </div>
          )}
        </>
      )}
      {kind === 'PASSPORT' && (
        <select className="select" aria-label="Held by" value={heldBy} onChange={(e) => setHeldBy(e.target.value as 'worker' | 'company')}>
          <option value="worker">The worker has it</option>
          <option value="company">The company keeps it</option>
        </select>
      )}
      {kind === 'WELFARE' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {CONCERNS.map((c) => (
            <label key={c} className="row small" style={{ gap: 4 }}>
              <input
                type="checkbox"
                checked={concerns.includes(c)}
                onChange={(e) => setConcerns(e.target.checked ? [...concerns, c] : concerns.filter((x) => x !== c))}
              />
              {FW_CONCERN_LABEL[c]}
            </label>
          ))}
        </div>
      )}
      <input className="input" aria-label="Check note" placeholder={kind === 'WELFARE' && concerns.length ? 'What the worker raised (needed)' : 'Note'} value={note} onChange={(e) => setNote(e.target.value)} />
      {(kind === 'PASSPORT' ? heldBy === 'company' : true) && <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly />}
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !ready}
          onClick={async () => {
            const ok = await act.run(
              () =>
                api.recordFwCheck(
                  personId,
                  {
                    kind,
                    checkedOn,
                    ...(kind === 'ARRIVAL_FEE' ? { agency, paidAnything: paid === 'yes', amount: paid === 'yes' ? Number(amount) : null, paidTo } : {}),
                    ...(kind === 'PASSPORT' ? { heldBy } : {}),
                    ...(kind === 'WELFARE' ? { concerns } : {}),
                    note,
                  },
                  proof,
                ),
              `${FW_CHECK_LABEL[kind]} recorded.`,
            );
            if (ok) onDone();
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function OpenRow({ o, confidential }: { o: Open; confidential: boolean }) {
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState('');
  const [repaid, setRepaid] = useState('');
  const [custody, setCustody] = useState<'' | 'worker' | 'company'>('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const docs = useLoad(() => (confidential ? api.fwmDocs(o.check.id) : Promise.resolve([])), [o.check.id, confidential]);
  const c = o.check;
  const what =
    c.kind === 'ARRIVAL_FEE'
      ? confidential
        ? `Paid RM${c.amount ?? 0} to ${c.paidTo} (agency ${c.agency})`
        : 'A fee was found'
      : c.kind === 'PASSPORT'
        ? 'Passport kept by the company without signed consent'
        : confidential
          ? (c.concerns ?? []).map((x) => FW_CONCERN_LABEL[x]).join(', ')
          : 'A concern was raised';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {o.label} · {o.person?.name ?? ''}
          </div>
          <div className="muted small">
            {o.person?.staffNo} · {o.person?.companyName} · {dateLabel(c.checkedOn)} by {c.by}
          </div>
          <div className="small">{what}</div>
          {confidential && c.note && <div className="muted small">{c.note}</div>}
        </div>
        <Chip tone={o.daysOpen > 30 ? 'crit' : 'warn'}>{o.daysOpen} days open</Chip>
      </div>
      {confidential && docs.data && docs.data.length > 0 && <DocList docs={docs.data} />}
      {o.canClose && !closing && (
        <div>
          <button className="btn btn-sm" onClick={() => setClosing(true)}>
            Close the follow-up
          </button>
        </div>
      )}
      {closing && (
        <>
          {c.kind === 'ARRIVAL_FEE' && (
            <input
              className="input"
              type="number"
              min="0"
              aria-label="Paid back (RM)"
              placeholder={`Paid back to the worker (RM, up to ${c.amount ?? 0})`}
              value={repaid}
              onChange={(e) => setRepaid(e.target.value)}
            />
          )}
          {c.kind === 'PASSPORT' && (
            <select className="select" aria-label="How custody ended" value={custody} onChange={(e) => setCustody(e.target.value as '' | 'worker' | 'company')}>
              <option value="">How did it end?</option>
              <option value="worker">Passport given back to the worker (attach their signed receipt)</option>
              <option value="company">Worker signed consent for safekeeping (attach the consent)</option>
            </select>
          )}
          <input className="input" aria-label="How it was dealt with" placeholder="How it was dealt with" value={note} onChange={(e) => setNote(e.target.value)} />
          <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly required={c.kind === 'PASSPORT' || (c.kind === 'ARRIVAL_FEE' && Number(repaid) > 0)} />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || note.trim().length < 5 || (c.kind === 'PASSPORT' && !custody)}
              onClick={async () => {
                const ok = await act.run(
                  () => api.closeFwCheck(c.id, { note, repaid: c.kind === 'ARRIVAL_FEE' ? Number(repaid || 0) : null, custody: c.kind === 'PASSPORT' ? custody || null : null }, proof),
                  'Follow-up closed.',
                );
                if (ok) setClosing(false);
              }}
            >
              Close
            </button>
            <button className="btn btn-sm" onClick={() => setClosing(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function checkDetail(c: Check): string {
  if (c.kind === 'ARRIVAL_FEE') return c.paidAnything ? `Paid RM${c.amount ?? 0} to ${c.paidTo} (agency ${c.agency})` : `Paid nothing (agency ${c.agency})`;
  if (c.kind === 'PASSPORT') return c.heldBy === 'company' ? (c.docIds.length ? 'Company keeps it, consent attached' : 'Company keeps it, no consent') : 'Worker holds it';
  return c.concerns?.length ? c.concerns.map((x) => FW_CONCERN_LABEL[x]).join(', ') : 'No concerns';
}

function closing(c: Check): string {
  if (c.status !== 'closed') return '';
  const how =
    c.kind === 'PASSPORT' && c.custodyAfter
      ? c.custodyAfter === 'worker'
        ? 'Passport given back to the worker. '
        : 'Worker signed consent for safekeeping. '
      : c.kind === 'ARRIVAL_FEE'
        ? `RM${c.repaid ?? 0} of RM${c.amount ?? 0} paid back. `
        : '';
  return `${how}${c.closeNote ?? ''} (closed by ${c.closedBy ?? ''}${c.closedAt ? `, ${dateLabel(c.closedAt.slice(0, 10))}` : ''})`;
}

/** One past check with the papers on it: confidential, FWM and the group leaders only. */
function HistoryItem({ c }: { c: Check }) {
  const [open, setOpen] = useState(false);
  const docs = useLoad(() => (open ? api.fwmDocs(c.id) : Promise.resolve([])), [c.id, open]);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div className="small">
          <strong>{c.label}</strong> · {dateLabel(c.checkedOn)} by {c.by}
        </div>
        <Chip tone={c.status === 'open' ? 'crit' : c.status === 'closed' ? 'ok' : 'neutral'}>{c.status === 'open' ? 'Open' : c.status === 'closed' ? 'Closed' : 'Clear'}</Chip>
      </div>
      <div className="small">{checkDetail(c)}</div>
      {c.note && <div className="muted small">{c.note}</div>}
      {c.status === 'closed' && <div className="muted small">{closing(c)}</div>}
      {c.docIds.length + (c.closeDocIds?.length ?? 0) > 0 && (
        <div>
          <button className="btn btn-sm" onClick={() => setOpen(!open)}>
            {open ? 'Hide papers' : 'Papers'}
          </button>
        </div>
      )}
      {open && docs.data && <DocList docs={docs.data} />}
    </div>
  );
}

function ClosedRow({ x }: { x: Closed }) {
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
      <div style={{ fontWeight: 600 }}>
        {x.label} · {x.person?.name ?? ''}
      </div>
      <div className="muted small">
        {x.person?.staffNo} · {x.person?.companyName}
      </div>
      <HistoryItem c={{ ...x.check, label: x.label }} />
    </div>
  );
}
