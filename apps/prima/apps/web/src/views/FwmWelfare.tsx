import { useState } from 'react';
import { FW_CHECK_LABEL, FW_CONCERN_LABEL, type FwCheckKind, type FwConcern, type ProofInput } from '@prima/core';
import { api, type FwmWelfare } from '../api';
import { ChatsCircleIcon, ClockCountdownIcon, FlagIcon, HandCoinsIcon, IdentificationCardIcon, QuestionIcon } from '@phosphor-icons/react';
import { Avatar, Empty, Search, Stat, Stats, Toolbar } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import { DocList, ProofPicker } from './Proof';
import '../styles/hrx.css';

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
  // The whole list, searchable and paged (main review, 3 Nov 2026: no worker may fall off the end).
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
    <div className="hx-stack">
      <div className="fw-stats">
      <Stats>
        <Stat
          label="Fee not asked yet"
          value={data.counts.feeNotChecked}
          tone={data.counts.feeNotChecked ? 'unknown' : 'ok'}
          note="Unknown, not green"
          icon={<QuestionIcon size={16} />}
        />
        {data.counts.feesFound !== null && (
          <Stat
            label="Fees found"
            value={data.counts.feesFound}
            tone={data.counts.feesFound ? 'crit' : 'ok'}
            note="Workers who paid to get the job"
            icon={<HandCoinsIcon size={16} />}
          />
        )}
        <Stat
          label="Passport with company"
          value={data.counts.passportWithCompany}
          tone={data.counts.passportNoConsent ? 'crit' : data.counts.passportWithCompany ? 'warn' : 'ok'}
          note={`${data.counts.passportNoConsent} without signed consent`}
          icon={<IdentificationCardIcon size={16} />}
        />
        <Stat
          label="Passport check due"
          value={data.counts.passportDue}
          tone={data.counts.passportDue ? 'warn' : 'ok'}
          note={`Every ${data.rules.passport.value} days`}
          icon={<ClockCountdownIcon size={16} />}
        />
        <Stat
          label="Welfare talk due"
          value={data.counts.welfareDue}
          tone={data.counts.welfareDue ? 'warn' : 'ok'}
          note={`Every ${data.rules.welfare.value} days`}
          icon={<ChatsCircleIcon size={16} />}
        />
        <Stat label="Open follow-ups" value={data.counts.open} tone={data.counts.open ? 'crit' : 'ok'} icon={<FlagIcon size={16} />} />
      </Stats>
      </div>
      {!data.confidential && (
        <p className="notice" data-tone="info">
          You see when each check was done and any passport follow-up your company must act on. Fees and what workers raise stay with FWM and the group
          leaders, so nobody can tell who spoke up.
        </p>
      )}
      <section className="k-card">
        <div className="k-card-head">
          <div className="k-card-title">
            <h2>Recruitment and welfare</h2>
          </div>
          <div className="tabbar hx-tabs" role="tablist" aria-label="Welfare sections">
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
        {tab === 'workers' && (
          <>
            <div className="fw-filter">
              <Toolbar>
                <Search
                  value={q}
                  onChange={(v) => {
                    setQ(v);
                    setPage(0);
                  }}
                  placeholder="Search name, staff no or company"
                  label="Search workers"
                />
                <select
                  className="select hx-filter"
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
              </Toolbar>
            </div>
            {matched.length === 0 && <Empty title={data.workers.length ? 'No worker matches.' : 'No foreign worker on record.'} />}
            {shown.length > 0 && (
              <ul className="hx-rows">
                {shown.map((w) => (
                  <WorkerRow key={w.person.id} w={w} canRecord={data.canRecord} confidential={data.confidential} />
                ))}
              </ul>
            )}
            {matched.length > 0 && (
              <div className="k-card-foot fw-pager">
                <span className="muted small" aria-live="polite">
                  {at * PAGE + 1}–{at * PAGE + shown.length} of {matched.length}
                  {matched.length !== data.workers.length ? ` (${data.workers.length} in all)` : ''}
                </span>
                <span className="hx-row-actions">
                  <button className="btn btn-sm" disabled={at === 0} onClick={() => setPage(at - 1)}>
                    Previous
                  </button>
                  <button className="btn btn-sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
                    Next
                  </button>
                </span>
              </div>
            )}
          </>
        )}
        {tab === 'open' &&
          (data.open.length === 0 ? (
            <Empty title="Nothing open." />
          ) : (
            <ul className="hx-rows">
              {data.open.map((o) => (
                <OpenRow key={o.check.id} o={o} confidential={data.confidential} />
              ))}
            </ul>
          ))}
        {tab === 'closed' &&
          (data.closed.length === 0 ? (
            <Empty title="Nothing closed yet." />
          ) : (
            <ul className="hx-rows">
              {data.closed.map((x) => (
                <ClosedRow key={x.check.id} x={x} />
              ))}
            </ul>
          ))}
        {tab === 'agencies' &&
          (data.agencies.length === 0 ? (
            <Empty title="No arrival fee check yet." />
          ) : (
            <ul className="hx-rows">
              {data.agencies.map((a) => (
                <li key={a.agency} className="hx-row" data-tone={a.open ? 'crit' : a.feesFound ? 'warn' : undefined}>
                  <div className="hx-row-main">
                    <span className="hx-row-title">{a.agency}</span>
                    <span className="hx-row-meta">
                      {a.checked} workers asked · {a.feesFound} paid a fee · RM{a.paid.toLocaleString()} paid, RM{a.repaid.toLocaleString()} paid back
                    </span>
                  </div>
                  <div className="hx-row-side">
                    <Chip tone={a.open ? 'crit' : a.feesFound ? 'warn' : 'ok'}>{a.open ? `${a.open} open` : a.feesFound ? 'Fees found' : 'No fees'}</Chip>
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </section>
      <p className="hx-source">
        {data.rules.zeroFee.source} {data.rules.passport.source}
      </p>
    </div>
  );
}

function WorkerRow({ w, canRecord, confidential }: { w: Worker; canRecord: boolean; confidential: boolean }) {
  const [mode, setMode] = useState<FwCheckKind | null>(null);
  const [history, setHistory] = useState(false);
  const feeText = w.feeDue ? 'not asked yet' : !w.fee ? 'asked' : w.fee.paidAnything ? 'paid a fee' : 'paid nothing';
  const passportText = w.passportHolder
    ? `${w.passportHolder === 'company' ? (w.passportConsented ? 'with the company, consent signed' : 'with the company, no consent') : 'with the worker'}, checked ${since(w.passportDaysSince)}`
    : 'never checked';
  return (
    <li className="hx-row fw-row" data-tone={w.open > 0 ? 'crit' : w.passportDue || w.welfareDue ? 'warn' : w.feeDue ? 'unknown' : undefined}>
      <Avatar name={w.person.name} size={36} />
      <div className="hx-row-main">
        <span className="hx-row-title">{w.person.name}</span>
        <span className="hx-row-meta">
          {w.person.staffNo} · {w.person.companyName} · hired {dateLabel(w.person.hiredOn)}
        </span>
      </div>
      <div className="hx-row-side">
        {w.open > 0 && <Chip tone="crit">{w.open} open</Chip>}
        {w.feeDue && <Chip tone="unknown">Fee not asked</Chip>}
        {w.passportDue && <Chip tone="warn">Passport check due</Chip>}
        {w.welfareDue && <Chip tone="warn">Talk due</Chip>}
      </div>
      <div className="hx-row-body">
        <dl className="fw-checks">
          <div data-due={w.feeDue || undefined}>
            <dt>Fee</dt>
            <dd>{feeText}</dd>
          </div>
          <div data-due={w.passportDue || undefined}>
            <dt>Passport</dt>
            <dd>{passportText}</dd>
          </div>
          <div data-due={w.welfareDue || undefined}>
            <dt>Welfare talk</dt>
            <dd>{since(w.welfareDaysSince)}</dd>
          </div>
        </dl>
        {((confidential && w.history.length > 0) || (canRecord && !mode)) && (
          <div className="hx-row-actions">
            {canRecord && !mode && (
              <>
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
              </>
            )}
            {confidential && w.history.length > 0 && (
              <button className="btn btn-ghost btn-sm" aria-expanded={history} onClick={() => setHistory(!history)}>
                {history ? 'Hide history' : `History (${w.history.length})`}
              </button>
            )}
          </div>
        )}
        {history && (
          <ul className="fw-history">
            {w.history.map((c) => (
              <HistoryItem key={c.id} c={c} />
            ))}
          </ul>
        )}
        {mode && <CheckForm personId={w.person.id} kind={mode} onDone={() => setMode(null)} />}
      </div>
    </li>
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
    <div className="hx-form">
      <h3 className="hx-form-title">{FW_CHECK_LABEL[kind]}</h3>
      <p className="notice" data-tone="info">
        {kind === 'ARRIVAL_FEE'
          ? 'Ask in private, in Nepali, with nobody from the agency or the site present: did you pay anyone to get this job?'
          : kind === 'PASSPORT'
            ? "The worker keeps their passport. Company safekeeping only with the worker's signed consent, attached here."
            : 'A private talk: pay, hours, hostel, how they are treated. Write down what they raise in their words.'}
      </p>
      <div className="hx-form-grid">
        <label className="field">
          <span className="label">Date of the check</span>
          <input className="input" type="date" aria-label="Date of the check" value={checkedOn} onChange={(e) => setCheckedOn(e.target.value)} />
        </label>
        {kind === 'ARRIVAL_FEE' && (
          <>
            <label className="field">
              <span className="label">Agency</span>
              <input className="input" aria-label="Agency" placeholder="Recruiting agency" value={agency} onChange={(e) => setAgency(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Paid anything</span>
              <select className="select" aria-label="Paid anything" value={paid} onChange={(e) => setPaid(e.target.value as 'no' | 'yes' | '')}>
                <option value="">Did the worker pay anyone?</option>
                <option value="no">No, nothing</option>
                <option value="yes">Yes, they paid</option>
              </select>
            </label>
            {paid === 'yes' && (
              <>
                <label className="field">
                  <span className="label">Amount paid (RM)</span>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    aria-label="Amount paid (RM)"
                    placeholder="Amount (RM)"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="label">Paid to</span>
                  <input className="input" aria-label="Paid to" placeholder="Paid to, such as the agent in Nepal" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} />
                </label>
              </>
            )}
          </>
        )}
        {kind === 'PASSPORT' && (
          <label className="field">
            <span className="label">Held by</span>
            <select className="select" aria-label="Held by" value={heldBy} onChange={(e) => setHeldBy(e.target.value as 'worker' | 'company')}>
              <option value="worker">The worker has it</option>
              <option value="company">The company keeps it</option>
            </select>
          </label>
        )}
      </div>
      {kind === 'WELFARE' && (
        <fieldset className="fw-concerns">
          <legend className="label">What the worker raised</legend>
          {CONCERNS.map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                checked={concerns.includes(c)}
                onChange={(e) => setConcerns(e.target.checked ? [...concerns, c] : concerns.filter((x) => x !== c))}
              />
              {FW_CONCERN_LABEL[c]}
            </label>
          ))}
        </fieldset>
      )}
      <label className="field">
        <span className="label">Note</span>
        <input
          className="input"
          aria-label="Check note"
          placeholder={kind === 'WELFARE' && concerns.length ? 'What the worker raised (needed)' : 'Note'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {(kind === 'PASSPORT' ? heldBy === 'company' : true) && <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly />}
      <ErrorNotice error={act.error} />
      <div className="hx-form-actions">
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
    <li className="hx-row fw-row" data-tone={o.daysOpen > 30 ? 'crit' : 'warn'}>
      <Avatar name={o.person?.name ?? o.label} size={36} />
      <div className="hx-row-main">
        <span className="hx-row-title">
          {o.label} · {o.person?.name ?? ''}
        </span>
        <span className="hx-row-meta">
          {o.person?.staffNo} · {o.person?.companyName} · {dateLabel(c.checkedOn)} by {c.by}
        </span>
      </div>
      <div className="hx-row-side">
        <Chip tone={o.daysOpen > 30 ? 'crit' : 'warn'}>{o.daysOpen} days open</Chip>
      </div>
      <div className="hx-row-body">
        <p className="hx-row-text">
          <strong>{what}</strong>
        </p>
        {confidential && c.note && <p className="hx-row-text muted">{c.note}</p>}
        {confidential && docs.data && docs.data.length > 0 && <DocList docs={docs.data} />}
        {o.canClose && !closing && (
          <div className="hx-row-actions">
            <button className="btn btn-primary btn-sm" onClick={() => setClosing(true)}>
              Close the follow-up
            </button>
          </div>
        )}
        {closing && (
          <div className="hx-form">
            <h3 className="hx-form-title">Close the follow-up</h3>
            <div className="hx-form-grid">
              {c.kind === 'ARRIVAL_FEE' && (
                <label className="field">
                  <span className="label">Paid back (RM)</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    aria-label="Paid back (RM)"
                    placeholder={`Paid back to the worker (RM, up to ${c.amount ?? 0})`}
                    value={repaid}
                    onChange={(e) => setRepaid(e.target.value)}
                  />
                </label>
              )}
              {c.kind === 'PASSPORT' && (
                <label className="field hx-form-wide">
                  <span className="label">How custody ended</span>
                  <select className="select" aria-label="How custody ended" value={custody} onChange={(e) => setCustody(e.target.value as '' | 'worker' | 'company')}>
                    <option value="">How did it end?</option>
                    <option value="worker">Passport given back to the worker (attach their signed receipt)</option>
                    <option value="company">Worker signed consent for safekeeping (attach the consent)</option>
                  </select>
                </label>
              )}
              <label className="field hx-form-wide">
                <span className="label">How it was dealt with</span>
                <input className="input" aria-label="How it was dealt with" placeholder="How it was dealt with" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
            <ProofPicker
              site={null}
              refText="FWM"
              items={proof}
              onChange={setProof}
              documentsOnly
              required={c.kind === 'PASSPORT' || (c.kind === 'ARRIVAL_FEE' && Number(repaid) > 0)}
            />
            <ErrorNotice error={act.error} />
            <div className="hx-form-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || note.trim().length < 5 || (c.kind === 'PASSPORT' && !custody)}
                onClick={async () => {
                  const ok = await act.run(
                    () =>
                      api.closeFwCheck(
                        c.id,
                        { note, repaid: c.kind === 'ARRIVAL_FEE' ? Number(repaid || 0) : null, custody: c.kind === 'PASSPORT' ? custody || null : null },
                        proof,
                      ),
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
          </div>
        )}
      </div>
    </li>
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
    <li className="fw-hist">
      <div className="fw-hist-head">
        <span>
          <strong>{c.label}</strong>
          <span className="muted"> · {dateLabel(c.checkedOn)} by {c.by}</span>
        </span>
        <Chip tone={c.status === 'open' ? 'crit' : c.status === 'closed' ? 'ok' : 'neutral'}>
          {c.status === 'open' ? 'Open' : c.status === 'closed' ? 'Closed' : 'Clear'}
        </Chip>
      </div>
      <div className="small">{checkDetail(c)}</div>
      {c.note && <div className="muted small">{c.note}</div>}
      {c.status === 'closed' && <div className="muted small">{closing(c)}</div>}
      {c.docIds.length + (c.closeDocIds?.length ?? 0) > 0 && (
        <div>
          <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide papers' : 'Papers'}
          </button>
        </div>
      )}
      {open && docs.data && <DocList docs={docs.data} />}
    </li>
  );
}

function ClosedRow({ x }: { x: Closed }) {
  return (
    <li className="hx-row fw-row">
      <Avatar name={x.person?.name ?? x.label} size={36} />
      <div className="hx-row-main">
        <span className="hx-row-title">
          {x.label} · {x.person?.name ?? ''}
        </span>
        <span className="hx-row-meta">
          {x.person?.staffNo} · {x.person?.companyName}
        </span>
      </div>
      <div className="hx-row-body">
        <ul className="fw-history">
          <HistoryItem c={{ ...x.check, label: x.label }} />
        </ul>
      </div>
    </li>
  );
}
