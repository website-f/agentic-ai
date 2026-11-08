import { Select } from '../SearchSelect';
import { useState, type ReactNode } from 'react';
import { TENDER_BID_PART_LABEL, type ProofInput, type TenderBidPart } from '@prima/core';
import { api, type ItBoard } from '../api';
import { useApp } from '../App';
import { ProofPicker } from './Proof';
import { openProofItem } from '../save';
import { Chip, notify, ErrorNotice, dateLabel, dateTimeLabel, useAction } from '../ui';

/**
 * The pilot additions to the IT screen (Fauzan, 28 Oct 2026): buying with three quotes, one online comparison and COO then CEO
 * approval in Prima (trusted Teams integration remains pending) before the fulfilment workflow; eP tenders run by the IT Manager with the paired
 * IT Executive, every stage against a target in minutes; help requests logged for staff not on the system yet; and the
 * COO standing in while the IT Manager is away.
 *
 * Laid out with the same card, step and stat surfaces as the rest of Prima (the kit's classes, written out here so this
 * file keeps its small set of imports).
 */

type PurchaseRow = NonNullable<ItBoard['purchases']>[number];
type TenderRow = NonNullable<ItBoard['tenders']>[number];
type ClockRow = TenderRow['clock']['rows'][number];
type StepState = 'done' | 'now' | 'todo' | 'stopped';

const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const minutes = (m: number | null | undefined) => {
  if (m == null) return 'dated';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h >= 24 && !r && h % 24 === 0) return `${h / 24} day${h === 24 ? '' : 's'}`;
  return r ? `${h} h ${r} min` : `${h} h`;
};
const OWNER = { manager: 'IT Manager', exec: 'IT tender executive', lead: 'IT Lead', leader: 'COO or CEO' } as const;
const viaText = (a: { via?: string; teamsRef?: string; recordedBy?: string } | null | undefined) =>
  a?.via === 'teams' ? `in Teams (${a.teamsRef}), recorded by ${a.recordedBy}` : 'in Prima';

/** A titled card (the kit's Card markup). */
function Box({ title, sub, actions, flush, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; flush?: boolean; children: ReactNode }) {
  return (
    <section className="k-card">
      <div className="k-card-head">
        <div className="k-card-title">
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {actions && <div className="k-card-actions">{actions}</div>}
      </div>
      <div className={flush ? 'k-card-body k-flush' : 'k-card-body iw-stack'}>{children}</div>
    </section>
  );
}

/** Where something is in its process (the kit's Steps markup). */
function Route({ label, steps }: { label: string; steps: { label: string; state: StepState; note?: string | null }[] }) {
  return (
    <ol className="k-steps iw-route" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.label} className="k-step" data-state={s.state}>
          <span className="k-step-dot" aria-hidden="true">
            {s.state === 'done' ? '✓' : i + 1}
          </span>
          <span className="k-step-text">
            <span className="k-step-label">{s.label}</span>
            {s.note && <span className="k-step-note">{s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The pilot buying steps on one purchase (rule IT-BUY). */
export function BuyFlow({ row, data }: { row: PurchaseRow; data: ItBoard }) {
  const {go}=useApp();
  const act = useAction();
  const p = row.purchase;
  const [who, setWho] = useState('');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [kind, setKind] = useState<'quote' | 'online'>('quote');
  const [pick, setPick] = useState('0');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [teamsRef, setTeamsRef] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const r = data.buyRule ?? { quotesNeeded: 3, onlineChecksNeeded: 1, onlineTolerancePct: 5 };
  if (!['quoting', 'coo', 'ceo', 'finance', 'paid', 'partially_received', 'received', 'rejected'].includes(p.status) || !p.quotes) return null;
  const step = (s: string, body: Record<string, unknown>, ok: string) =>
    act.run(() => api.itAct('buy', { id: p.id, step: s, ...body }), ok).then((x) => {
      if (x) {
        setWho('');
        setAmount('');
        setRef('');
        setProof([]);
        setNote('');
        setTeamsRef('');
      }
    });
  const quotes = p.quotes ?? [];
  const online = p.online ?? [];
  // The approval route as steps: where the purchase is now, or where it was stopped.
  const at = p.status === 'quoting' ? 0 : p.status === 'coo' ? 1 : p.status === 'ceo' ? 2 : 3;
  const stoppedAt = p.ceoStep?.decision === 'reject' ? 2 : p.cooStep?.decision === 'reject' ? 1 : p.ceoStep ? 3 : p.cooStep ? 2 : 1;
  const state = (i: number): StepState =>
    p.status === 'rejected' ? (i < stoppedAt ? 'done' : i === stoppedAt ? 'stopped' : 'todo') : p.status === 'received' || i < at ? 'done' : i === at ? 'now' : 'todo';
  return (
    <div className="iw-buy">
      <Route
        label="Approval route"
        steps={[
          { label: 'Quotes and online price', state: state(0) },
          { label: 'COO approval', state: state(1), note: p.cooStep?.by ?? null },
          { label: 'CEO approval', state: state(2), note: p.ceoStep?.by ?? null },
          { label: 'Purchase fulfilment', state: state(3) },
        ]}
      />
      <div className="iw-buy-title">
        Quotes ({quotes.length} of {r.quotesNeeded}) and distinct online comparisons ({Math.max(0, r.onlineChecksNeeded - row.buy.onlineMissing)} of {r.onlineChecksNeeded} required)
      </div>
      {(quotes.length > 0 || online.length > 0) && (
        <ul className="iw-quotes">
          {quotes.map((q, k) => (
            <li key={q.supplier} className="iw-quote" data-chosen={p.chosen?.index === k ? 'yes' : undefined}>
              <span className="iw-quote-main">
                {p.chosen?.index === k ? '✓ ' : ''}
                {q.supplier} · {rm(q.amount)}
                {q.ref ? ` · ${q.ref}` : ''} · {q.proof.map((f) => f.name).join(', ')}
              </span>
              {row.buy.lowestQuote === q.amount && <Chip tone="ok">Lowest</Chip>}
            </li>
          ))}
          {online.map((o) => (
            <li key={o.source + o.at} className="iw-quote" data-online="yes">
              <span className="iw-quote-main">
                Online: {o.source} · {rm(o.amount)} · {o.ref} · recorded {dateTimeLabel(o.at)} · {o.proof.map((f) => f.name).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {p.chosen && (
        <p className="iw-buy-note">
          Chosen: {quotes[p.chosen.index]?.supplier}
          {p.chosen.reason ? ` (${p.chosen.reason})` : ''}
          {row.buy.overOnline ? ` · more than ${r.onlineTolerancePct}% above the online price` : ''}
        </p>
      )}
      <p className="iw-buy-note">
        {p.cooStep ? `COO ${p.cooStep.decision === 'reject' ? 'rejected' : 'approved'}: ${p.cooStep.by}, ${dateTimeLabel(p.cooStep.at)} ${viaText(p.cooStep)}` : 'COO: not yet'}
        {' · '}
        {p.ceoStep ? `CEO ${p.ceoStep.decision === 'reject' ? 'rejected' : 'approved'}: ${p.ceoStep.by}, ${dateTimeLabel(p.ceoStep.at)} ${viaText(p.ceoStep)}` : 'CEO: not yet'}
        {p.finance ? ` · to Finance ${dateTimeLabel(p.finance.sentAt)} (${p.finance.ref})` : ''}
        {p.finance?.paidRef ? ` · paid ${p.finance.paidRef} on ${dateLabel(p.finance.paidOn!)}` : ''}
        {p.delivery ? ` · received on ${p.delivery.ref}` : ''}
      </p>
      <ErrorNotice error={act.error} />

      {row.canBuy && p.status === 'quoting' && (
        <div className="iw-form iw-buy-form">
          <label className="field">
            <span className="label">Add</span>
            <select className="select" aria-label="Add" value={kind} onChange={(e) => setKind(e.target.value as 'quote' | 'online')}>
              <option value="quote">Supplier quote</option>
              <option value="online">Online or marketplace price</option>
            </select>
          </label>
          <label className="field">
            <span className="label">{kind === 'quote' ? 'Supplier' : 'Website'}</span>
            <input className="input" aria-label={kind === 'quote' ? 'Supplier' : 'Website'} placeholder={kind === 'quote' ? 'Supplier' : 'Website or marketplace'} value={who} onChange={(e) => setWho(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Total RM</span>
            <input className="input" inputMode="decimal" aria-label="Total RM" placeholder="Total, RM" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Reference</span>
            <input className="input" aria-label="Reference" placeholder={kind === 'quote' ? 'Quotation number' : 'Link to the listing'} value={ref} onChange={(e) => setRef(e.target.value)} />
          </label>
          <div className="iw-span">
            <ProofPicker site={null} refText={p.ref} items={proof} onChange={setProof} documentsOnly required />
          </div>
          <div className="iw-span iw-actions">
            <button
              className="btn btn-sm"
              disabled={act.busy || !who.trim() || !amount || !proof.length || (kind === 'online' && !ref.trim())}
              onClick={() => void step(kind, kind === 'quote' ? { supplier: who, amount: Number(amount), ref, proof } : { source: who, amount: Number(amount), ref, proof }, 'Added.')}
            >
              Add {kind === 'quote' ? 'quote' : 'online price'}
            </button>
          </div>
          {row.buy.quotesMissing === 0 && row.buy.onlineMissing === 0 && (
            <>
              <label className="field">
                <span className="label">Choose supplier</span>
                <Select className="select" aria-label="Choose supplier" value={pick} onChange={(e) => setPick(e.target.value)}>
                  {quotes.map((q, k) => (
                    <option key={q.supplier} value={k}>
                      {q.supplier} · {rm(q.amount)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span className="label">Why this one</span>
                <input className="input" aria-label="Why this one" placeholder="Why, if not the lowest" value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="iw-span iw-actions">
                <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void step('submit', { index: Number(pick), reason }, 'Sent for COO approval.')}>
                  Send for COO then CEO approval
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {(p.status === 'coo' || p.status === 'ceo') && (row.canDecide || row.canBuy) && (
        <div className="iw-decide">
          <input className="input" aria-label="Note" placeholder={row.canDecide ? 'Comment (needed to approve or reject)' : 'Note (needed to reject)'} value={note} onChange={(e) => setNote(e.target.value)} />
          {row.canDecide ? (
            <div className="iw-actions">
              <button className="btn btn-sm btn-primary" disabled={act.busy || !note.trim()} onClick={() => void step('decide', { decision: 'approve', note }, 'Approved.')}>
                Approve
              </button>
              <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => void step('decide', { decision: 'reject', note }, 'Rejected.')}>
                Reject
              </button>
            </div>
          ) : (
            <>
              <p className="iw-buy-note">
                Manual external approval evidence: this form records a title and screenshot under existing authority. It does not verify a Teams approval or establish a trusted Teams connection.
              </p>
              <input className="input" aria-label="Teams approval" placeholder="Teams approval title or link" value={teamsRef} onChange={(e) => setTeamsRef(e.target.value)} />
              <ProofPicker site={null} refText={p.ref} items={proof} onChange={setProof} documentsOnly required />
              <div className="iw-actions">
                <button className="btn btn-sm" disabled={act.busy || !teamsRef.trim() || !proof.length} onClick={() => void step('teams', { decision: 'approve', note, teamsRef, proof }, 'Teams approval recorded.')}>
                  Record approval
                </button>
                <button
                  className="btn btn-sm"
                  disabled={act.busy || !teamsRef.trim() || !proof.length || !note.trim()}
                  onClick={() => void step('teams', { decision: 'reject', note, teamsRef, proof }, 'Teams rejection recorded.')}
                >
                  Record rejection
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {['finance','paid','partially_received','received'].includes(p.status)&&<div className="notice iw-buy-next" data-tone="info"><p>Use IT purchase fulfilment for the approved PO, actual goods receipts, invoice matching and payment references. Normal payment follows receipt and match; advances require a separate COO then CEO exception. Historical payment or receipt records remain read-only and are not automatically treated as verified.</p><button className="btn btn-sm" onClick={()=>go({view:'it-procurement'})}>Open authorized IT purchase fulfilment</button></div>}
    </div>
  );
}

/** Pilot: IT logs a request for a person who is not on the system yet. */
export function LogTicket({ onDone }: { onDone: () => void }) {
  const act = useAction();
  const [raisedFor, setFor] = useState('');
  const [channel, setChannel] = useState('teams');
  const [category, setCategory] = useState('M365');
  const [priority, setPriority] = useState('P3');
  const [title, setTitle] = useState('');
  return (
    <div className="iw-form iw-panel-form">
      <label className="field">
        <span className="label">Who asked</span>
        <input className="input" aria-label="Who asked" placeholder="Who asked (name and company)" value={raisedFor} onChange={(e) => setFor(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">How they asked</span>
        <select className="select" aria-label="How they asked" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="teams">Teams</option>
          <option value="email">Email</option>
          <option value="phone">Phone</option>
          <option value="in_person">In person</option>
        </select>
      </label>
      <label className="field">
        <span className="label">About</span>
        <select className="select" aria-label="About" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="M365">Microsoft 365</option>
          <option value="ACCOUNT">Account or password</option>
          <option value="DEVICE">Device</option>
          <option value="NETWORK">Internet or network</option>
          <option value="PRIMA">Prima</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <label className="field">
        <span className="label">Urgency</span>
        <select className="select" aria-label="Urgency" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="P1">P1: work stopped</option>
          <option value="P2">P2: work slowed</option>
          <option value="P3">P3: can wait</option>
        </select>
      </label>
      <label className="field iw-span">
        <span className="label">What is wrong</span>
        <input className="input" aria-label="What is wrong" placeholder="What is wrong" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="iw-span iw-form-foot">
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || raisedFor.trim().length < 2 || !title.trim()}
          onClick={() => void act.run(() => api.itAct('logTicket', { raisedFor, channel, category, priority, title, detail: '' }), 'Logged.').then((x) => x && onDone())}
        >
          Log it
        </button>
      </div>
    </div>
  );
}

/** Pilot: IT records the person's answer, by someone other than the one who fixed it. */
export function RecordConfirm({ id }: { id: string }) {
  const act = useAction();
  const [via, setVia] = useState('');
  const [note, setNote] = useState('');
  return (
    <div className="iw-form iw-confirm">
      <label className="field">
        <span className="label">How they answered</span>
        <input className="input" aria-label="How they answered" placeholder="How they answered (e.g. Teams chat, 10:40)" value={via} onChange={(e) => setVia(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">What is still wrong</span>
        <input className="input" aria-label="What is still wrong" placeholder="If not fixed: what is still wrong" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="iw-span iw-actions">
        <button className="btn btn-sm" disabled={act.busy || via.trim().length < 3} onClick={() => void act.run(() => api.itAct('recordConfirm', { id, fixed: true, via }), 'Recorded as fixed.')}>
          They say it is fixed
        </button>
        <button className="btn btn-sm" disabled={act.busy || via.trim().length < 3 || !note.trim()} onClick={() => void act.run(() => api.itAct('recordConfirm', { id, fixed: false, via, note }), 'Reopened.')}>
          Not fixed: reopen
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** The IT Manager or the COO records when the IT Manager is away; the COO then accepts finished work. */
export function AwayPanel({ data }: { data: ItBoard }) {
  const act = useAction();
  const [from, setFrom] = useState(data.settings?.managerAwayFrom ?? '');
  const [until, setUntil] = useState(data.settings?.managerAwayUntil ?? '');
  if (data.role !== 'manager' && data.role !== 'coo') return null;
  const s = data.settings;
  return (
    <Box title="When the IT Manager is away" actions={data.away && <Chip tone="warn">Away now: the COO accepts</Chip>}>
      <p className="iw-muted">
        While the IT Manager is away the COO accepts finished work, so nothing waits. The COO may also accept or return any job at any time; whoever was in charge of checking it is told.
        {s?.managerAwayFrom ? ` Set: ${dateLabel(s.managerAwayFrom)} to ${dateLabel(s.managerAwayUntil!)} by ${s.setBy}.` : ''}
      </p>
      <div className="iw-away">
        <label className="field">
          <span className="label">First day away</span>
          <input className="input" type="date" aria-label="First day away" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Last day away</span>
          <input className="input" type="date" aria-label="Last day away" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <div className="iw-actions">
          <button className="btn btn-sm" disabled={act.busy || !from || !until} onClick={() => void act.run(() => api.itAct('setAway', { from, until }), 'Saved.')}>
            Save
          </button>
          {s?.managerAwayFrom && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.itAct('setAway', { from: '', until: '' }), 'Cleared.').then(() => (setFrom(''), setUntil('')))}>
              The IT Manager is back
            </button>
          )}
        </div>
      </div>
      <ErrorNotice error={act.error} />
    </Box>
  );
}

/** The timeline steps whose clock is running and that are mine. */
export function TenderStepsMine({ data, openTab }: { data: ItBoard; openTab: () => void }) {
  const steps = data.myWork?.tenderSteps ?? [];
  if (!steps.length) return null;
  return (
    <Box
      title="Tender steps running now"
      flush
      actions={
        <button className="btn btn-sm" onClick={openTab}>
          Open tenders
        </button>
      }
    >
      <ul className="iw-rows">
        {steps.map((s) => (
          <li key={s.tenderId + s.step.key} className="iw-row">
            <div className="iw-row-main">
              <span className="iw-row-title">{s.step.label}</span>
              <span className="iw-row-meta">
                {s.title} · target {minutes(s.step.minutes)}
                {s.dueAt ? ` · due ${dateTimeLabel(s.dueAt)}` : ''}
              </span>
            </div>
            <div className="iw-row-side">
              <Chip tone={s.late ? 'crit' : 'info'}>{s.late ? `Late ${minutes(s.lateMin || null)}` : 'Running'}</Chip>
            </div>
          </li>
        ))}
      </ul>
    </Box>
  );
}

/**
 * IT tenders from eP or other government channels (Fauzan, 28 Oct 2026). The IT Manager finds them and deals with the
 * company holding the IT codes; the paired IT Executive does every IT tender; the IT Lead checks the technical part.
 */
export function ItTenders({ data }: { data: ItBoard }) {
  const act = useAction();
  const [form, setForm] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const manager = data.role === 'manager';
  const execs = (data.team ?? []).filter((t) => t.itRole === 'executive');
  const rows = (data.tenders ?? []).filter((t) => t.task.steps && (showClosed || !['won', 'lost', 'dropped'].includes(t.task.stage ?? '')));
  const old = (data.tenders ?? []).filter((t) => !t.task.steps);
  return (
    <>
      <Box
        title="IT tenders (eP and government)"
        sub={`${rows.length} ${showClosed ? 'shown' : 'running'}`}
        actions={
          (manager || data.lead || data.canAddTender) && (
            <button className="btn btn-sm btn-primary" aria-expanded={form} onClick={() => setForm(!form)} disabled={!data.tenderExec} title={data.tenderExec ? undefined : 'The IT Manager names the tender executive first'}>
              Add a tender found
            </button>
          )
        }
      >
        <p className="iw-muted">
          Every stage has a target in minutes and its clock starts when the stage before it is done: the earlier the bid is in eP, the better its chances. The
          closing date is only the last line; the bid goes in at least a day before.
        </p>
        <div className="iw-exec">
          <span>
            Tender executive (paired with the IT Manager): <strong>{data.tenderExec?.name ?? 'not named yet'}</strong>
          </span>
          {manager && (
            <Select
              className="select iw-assign"
              aria-label="Tender executive"
              value={data.tenderExec?.id ?? ''}
              disabled={act.busy}
              onChange={(e) => e.target.value && void act.run(() => api.itAct('setTenderExec', { toId: e.target.value }), 'Tender executive named.')}
            >
              <option value="">Choose…</option>
              {execs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <ErrorNotice error={act.error} />
        {form && <AddTender data={data} onDone={() => setForm(false)} />}
      </Box>
      <CodeHolders data={data} />
      {rows.map((t) => (
        <TenderCard key={t.task.id} t={t} data={data} />
      ))}
      {!rows.length && (
        <div className="k-card">
          <div className="k-empty">
            <span className="k-empty-mark" aria-hidden="true" />
            <strong>No IT tenders running.</strong>
          </div>
        </div>
      )}
      <div className="iw-tender-foot">
        <button className="btn btn-sm btn-ghost" aria-pressed={showClosed} onClick={() => setShowClosed(!showClosed)}>
          {showClosed ? 'Hide won, lost and dropped' : 'Show won, lost and dropped'}
        </button>
        {old.length > 0 && <p className="iw-muted">{old.length} older tender parts without a timeline are kept in the record.</p>}
      </div>
    </>
  );
}

function CodeHolders({ data }: { data: ItBoard }) {
  const act = useAction();
  const [form, setForm] = useState(false);
  const rows = data.codeHolders ?? [];
  const check = data.codeCheck;
  const manager = data.role === 'manager';
  const left = check ? check.companies.filter((c) => !rows.some((h) => h.holder.companyId === c.id)) : [];
  return (
    <Box
      title="Which companies hold IT codes"
      sub={check ? `${check.checked} of ${check.companies.length} companies checked` : undefined}
      flush
      actions={
        manager && (
          <button className="btn btn-sm" aria-expanded={form} onClick={() => setForm(!form)}>
            Record a company
          </button>
        )
      }
    >
      <p className="iw-rule iw-rule-top">
        Checked by the IT Manager during the pilot, from each company&apos;s MOF certificate. An IT tender is bid only in the name of a company holding the codes asked, with
        the certificate in force. PWVSB is the group company and holds no codes.{check ? ` ${check.checked} of ${check.companies.length} companies checked.` : ''}
      </p>
      {form && check && (
        <div className="iw-inset">
          <CodeHolderForm companies={check.companies} onDone={() => setForm(false)} />
        </div>
      )}
      <ErrorNotice error={act.error} />
      <ul className="iw-rows">
        {rows.map((h) => (
          <li key={h.holder.id} className="iw-row">
            <div className="iw-row-main">
              <span className="iw-row-title">{h.companyName}</span>
              <span className="iw-row-meta">
                {h.holder.codes.length ? h.holder.codes.map((c) => `${c.code} ${c.label}`).join(' · ') : `no IT code${h.holder.note ? ` (${h.holder.note})` : ''}`}
                {h.holder.certNo ? ` · ${h.holder.certNo}` : ''}
                {h.holder.checkedBy ? ` · checked by ${h.holder.checkedBy}${h.holder.checkedAt ? `, ${dateLabel(h.holder.checkedAt.slice(0, 10))}` : ''}` : ''}
              </span>
            </div>
            <div className="iw-row-side">
              {(h.holder.proof ?? []).map((f) => (
                <button key={f.sha256} className="btn btn-sm" disabled={act.busy} onClick={() => void openProof(act, h.holder.id, f)}>
                  Certificate
                </button>
              ))}
              {h.holder.codes.length ? (
                <Chip tone={h.expired ? 'crit' : 'ok'}>{h.holder.expiresOn ? `MOF ${h.expired ? 'ended' : 'to'} ${dateLabel(h.holder.expiresOn)}` : 'MOF date unknown'}</Chip>
              ) : (
                <Chip tone="unknown">No IT code</Chip>
              )}
            </div>
          </li>
        ))}
        {left.length > 0 && <li className="iw-row iw-row-note">Still to check: {left.map((c) => c.name).join(', ')}</li>}
      </ul>
    </Box>
  );
}

function CodeHolderForm({ companies, onDone }: { companies: { id: string; name: string }[]; onDone: () => void }) {
  const act = useAction();
  const [companyId, setCompany] = useState(companies[0]?.id ?? '');
  const [codes, setCodes] = useState('');
  const [expiresOn, setExpires] = useState('');
  const [certNo, setCertNo] = useState('');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  // One code per line: the 6-digit code, then its name as on the certificate.
  const list = codes
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ code: l.split(/\s+/)[0], label: l.split(/\s+/).slice(1).join(' ') }));
  return (
    <div className="iw-form">
      <label className="field iw-span">
        <span className="label">Company</span>
        <Select className="select" aria-label="Company" value={companyId} onChange={(e) => setCompany(e.target.value)}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="field iw-span">
        <span className="label">IT codes</span>
        <textarea
          className="input"
          aria-label="IT codes"
          rows={3}
          placeholder={'IT codes, one per line, as on the certificate (e.g. 210101 Perkakasan ICT). Leave empty if it holds none.'}
          value={codes}
          onChange={(e) => setCodes(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="label">Certificate number</span>
        <input className="input" aria-label="Certificate number" placeholder="MOF certificate number" value={certNo} onChange={(e) => setCertNo(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Certificate expiry</span>
        <input className="input" type="date" aria-label="Certificate expiry" value={expiresOn} onChange={(e) => setExpires(e.target.value)} />
      </label>
      <label className="field iw-span">
        <span className="label">Note</span>
        <input className="input" aria-label="Note" placeholder="Note (needed when it holds no IT code)" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="iw-span">
        <ProofPicker site={null} refText="MOF certificate" items={proof} onChange={setProof} documentsOnly required />
      </div>
      <div className="iw-span iw-form-foot">
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !proof.length}
          onClick={() => void act.run(() => api.itAct('codeHolder', { companyId, codes: list, expiresOn, certNo, note, proof }), 'Recorded.').then((x) => x && onDone())}
        >
          {list.length ? 'Save the codes' : 'Checked: holds no IT code'}
        </button>
      </div>
    </div>
  );
}

function AddTender({ data, onDone }: { data: ItBoard; onDone: () => void }) {
  const act = useAction();
  const holders = (data.codeHolders ?? []).filter((h) => h.holder.codes.length && !h.expired);
  const [kind, setKind] = useState<'tender' | 'quotation'>('tender');
  const [title, setTitle] = useState('');
  const [buyer, setBuyer] = useState('');
  const [closesOn, setCloses] = useState('');
  const [companyId, setCompany] = useState(holders[0]?.holder.companyId ?? '');
  const [codes, setCodes] = useState<string[]>([]);
  const [briefingOn, setBriefing] = useState('');
  const holder = holders.find((h) => h.holder.companyId === companyId);
  return (
    <div className="iw-form iw-panel-form">
      <label className="field">
        <span className="label">Kind</span>
        <select className="select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as 'tender' | 'quotation')}>
          <option value="tender">Open tender</option>
          <option value="quotation">Quotation (sebut harga)</option>
        </select>
      </label>
      <label className="field">
        <span className="label">Closes on</span>
        <input className="input" type="date" aria-label="Closes on" value={closesOn} onChange={(e) => setCloses(e.target.value)} />
      </label>
      <label className="field iw-span">
        <span className="label">Title</span>
        <input className="input" aria-label="Title" placeholder="Title as on eP" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Buyer</span>
        <input className="input" aria-label="Buyer" placeholder="Ministry, agency or council" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Bid in the name of</span>
        <Select className="select" aria-label="Bid in the name of" value={companyId} onChange={(e) => (setCompany(e.target.value), setCodes([]))}>
          {holders.map((h) => (
            <option key={h.holder.id} value={h.holder.companyId}>
              {h.companyName}
            </option>
          ))}
        </Select>
      </label>
      {(holder?.holder.codes.length ?? 0) > 0 && (
        <fieldset className="iw-span iw-codes">
          <legend className="label">IT codes asked</legend>
          {holder?.holder.codes.map((c) => (
            <label key={c.code} className="row small iw-check">
              <input type="checkbox" checked={codes.includes(c.code)} onChange={(e) => setCodes(e.target.checked ? [...codes, c.code] : codes.filter((x) => x !== c.code))} />
              {c.code} {c.label}
            </label>
          ))}
        </fieldset>
      )}
      {kind === 'tender' && (
        <label className="field">
          <span className="label">Compulsory briefing or site visit (if any)</span>
          <input className="input" type="date" aria-label="Briefing on" value={briefingOn} onChange={(e) => setBriefing(e.target.value)} />
        </label>
      )}
      <div className="iw-span iw-form-foot">
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !title.trim() || !closesOn || !codes.length}
          onClick={() =>
            void act
              .run(() => api.itAct('addTender', { kind, title, buyer, source: 'eP (ePerolehan)', closesOn, companyId, codes, items: [], docs: [], briefingOn }), 'Tender added; the clock has started.')
              .then((x) => x && onDone())
          }
        >
          Add and start the clock
        </button>
      </div>
    </div>
  );
}

const STAGE: Record<string, [Parameters<typeof Chip>[0]['tone'], string]> = {
  preparing: ['info', 'Preparing'],
  handed_over: ['warn', 'With the company for eP'],
  submitted: ['ok', 'Submitted in eP'],
  won: ['ok', 'Won'],
  lost: ['unknown', 'Lost'],
  dropped: ['unknown', 'Not bid'],
};

function TenderCard({ t, data }: { t: TenderRow; data: ItBoard }) {
  const { me } = useApp();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const task = t.task;
  const c = t.clock;
  const [tone, label] = STAGE[task.stage ?? 'preparing'];
  const mine = new Set(t.mine);
  const live = !['won', 'lost', 'dropped', 'submitted', 'handed_over'].includes(task.stage ?? '');
  const running = c.rows.filter((r) => r.ready);
  const done = c.rows.filter((r) => r.step.doneAt).length;
  return (
    <section className="k-card iw-tender" data-late={c.late > 0 ? 'yes' : undefined}>
      <div className="k-card-head">
        <div className="k-card-title iw-tender-title">
          <h2>{task.title}</h2>
          <p>
            {task.kind === 'quotation' ? 'Quotation' : 'Open tender'} · {task.buyer} · {task.source} · in the name of {t.companyName} · codes {(task.codes ?? []).join(', ')} · closes{' '}
            {dateLabel(task.closesOn)} ({t.daysLeft} days)
          </p>
        </div>
        <div className="k-card-actions">
          {c.late > 0 && <Chip tone="crit">{c.late} late</Chip>}
          <Chip tone={tone}>{label}</Chip>
        </div>
      </div>
      <div className="k-card-body iw-stack">
        <div className="iw-progress">
          <div className="iw-progress-top">
            <span className="iw-progress-count">
              {done} of {c.rows.length} steps done
            </span>
            <span className="iw-muted">
              Target {minutes(c.targetMin)} of work from found to submitted
              {c.totalMin != null ? ` · took ${minutes(c.totalMin)}` : ''}
            </span>
          </div>
          <span className="iw-bar-track" aria-hidden="true">
            <span className="iw-bar-fill" style={{ width: `${c.rows.length ? Math.round((done / c.rows.length) * 100) : 0}%` }} />
          </span>
          {running.length > 0 && <span className="iw-muted">now: {running.map((r) => r.step.label.split(/[;:(]/)[0].trim()).join('; ')}</span>}
        </div>
        <ErrorNotice error={act.error} />
        {open && (
          <>
            <div className="iw-sub">
              <h3>Timeline</h3>
              <ol className="iw-timeline">
                {c.rows.map((r) => (
                  <StepLine key={r.step.key} r={r} tenderId={task.id} mine={mine.has(r.step.key)} />
                ))}
              </ol>
            </div>
            <div className="iw-sub">
              <h3>IT parts</h3>
              <ul className="iw-parts">
                {task.items.map((i, k) => (
                  <PartLine
                    key={i.label}
                    tenderId={task.id}
                    k={k}
                    label={i.label}
                    who={t.itemNames[k]}
                    doneAt={i.doneAt}
                    by={i.by}
                    files={i.proof ?? []}
                    fileName={i.fileName ?? null}
                    part={i.part ?? null}
                    checked={i.noNameCheck ?? null}
                    canName={live && t.canRun && !i.doneAt}
                    canDo={live && i.assigneeId === me.user.id && !i.doneAt}
                    canReopen={live && t.canRun && !!i.doneAt}
                  />
                ))}
              </ul>
            </div>
            <div className="iw-sub">
              <h3>Papers from the company</h3>
              <ul className="iw-parts">
                {(task.companyDocs ?? []).map((d, k) => (
                  <DocLine key={d.label} tenderId={task.id} k={k} d={d} canRun={live && data.role === 'manager'} />
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
      <div className="k-card-foot iw-tender-actions">
        <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide timeline' : 'Timeline, parts and papers'}
        </button>
      </div>
    </section>
  );
}

function StepLine({ r, tenderId, mine }: { r: ClockRow; tenderId: string; mine: boolean }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const s = r.step;
  const run = (extra: Record<string, unknown>, ok: string) =>
    act.run(() => api.itAct('tender', { id: tenderId, step: 'step', key: s.key, note, ...extra }), ok).then((x) => x && (setNote(''), setProof([])));
  const state = s.doneAt
    ? `done ${dateTimeLabel(s.doneAt)} by ${s.by}${r.tookMin != null ? ` in ${minutes(r.tookMin)}` : ''}${s.note ? ` · ${s.note}` : ''}`
    : r.ready
      ? `running${r.dueAt ? `, due ${dateTimeLabel(r.dueAt)}` : ''}`
      : 'waiting for the step before';
  const needsNote = s.key === 'handover' || s.key === 'briefing';
  const dot = s.doneAt ? 'done' : r.late ? 'late' : r.ready ? 'now' : 'todo';
  return (
    <li className="iw-tl" data-state={dot} data-mine={mine ? 'yes' : undefined}>
      <span className="iw-tl-dot" aria-hidden="true" />
      <div className="iw-tl-body">
        <div className="iw-tl-head">
          <div className="iw-row-main">
            <span className="iw-tl-label">{s.label}</span>
            <span className="iw-row-meta">
              {OWNER[s.owner]} · target {minutes(s.minutes)} · {state}
            </span>
          </div>
          <Chip tone={s.doneAt ? (r.late ? 'warn' : 'ok') : r.late ? 'crit' : r.ready ? 'info' : 'unknown'}>
            {s.doneAt ? (r.late ? 'Done late' : 'Done') : r.late ? `Late ${r.lateMin ? minutes(r.lateMin) : ''}`.trim() : r.ready ? 'Running' : 'Waiting'}
          </Chip>
        </div>
        {mine && (
          <div className="iw-tl-act">
            <input
              className="input"
              aria-label="Note"
              placeholder={s.key === 'handover' ? 'Who in the company received the bid pack' : s.key === 'briefing' ? 'Who attended, or why not needed' : s.key === 'go' ? 'Note (needed for no-go)' : 'Note'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {s.key === 'submit' && <ProofPicker site={null} refText={s.label} items={proof} onChange={setProof} documentsOnly required />}
            <div className="iw-actions">
              {s.key === 'result' ? (
                <>
                  <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void run({ outcome: 'won' }, 'Recorded: won.')}>
                    Won
                  </button>
                  <button className="btn btn-sm" disabled={act.busy} onClick={() => void run({ outcome: 'lost' }, 'Recorded: lost.')}>
                    Lost
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || (needsNote && note.trim().length < 3) || (s.key === 'submit' && !proof.length)}
                  onClick={() => void run(s.key === 'submit' ? { proof } : s.key === 'go' ? { go: true } : {}, 'Done.')}
                >
                  {s.key === 'go' ? 'Go: we bid' : s.key === 'submit' ? 'Submitted: save the slip' : 'Done'}
                </button>
              )}
              {s.key === 'go' && (
                <button className="btn btn-sm" disabled={act.busy || note.trim().length < 5} onClick={() => void run({ go: false }, 'Recorded: not bidding.')}>
                  No-go
                </button>
              )}
            </div>
            <ErrorNotice error={act.error} />
          </div>
        )}
      </div>
    </li>
  );
}

/** Fetch one proof file (the board carries none) and hand it to the viewer. */
async function openProof(act: ReturnType<typeof useAction>, id: string, f: { name: string; sha256: string }) {
  const got = (await act.run(() => api.itAct('jobProof', { id, sha256: f.sha256 }))) as { data: string; link?: string } | undefined;
  if (got) {
    const m = await openProofItem(f.name, got);
    if (m) notify(m);
  }
}

function PartLine(p: {
  tenderId: string;
  k: number;
  label: string;
  who: string | null;
  doneAt: string | null;
  by: string | null;
  files: { name: string; sha256: string }[];
  fileName: string | null;
  part: TenderBidPart | null;
  checked: { by: string; at: string } | null;
  canName: boolean;
  canDo: boolean;
  canReopen: boolean;
}) {
  const act = useAction();
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [note, setNote] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(p.fileName ?? '');
  const [part, setPart] = useState<TenderBidPart>(p.part ?? 'TEKNIKAL');
  const [ok, setOk] = useState(false);
  const technical = (p.part ?? 'TEKNIKAL') === 'TEKNIKAL';
  return (
    <li className="iw-part">
      <div className="iw-part-head">
        <span className="iw-part-main">
          <span className="iw-part-label">{p.label}</span>
          <span className="iw-row-meta">
            {p.who ?? 'not given'}
            {p.doneAt ? ` · done by ${p.by}, ${dateTimeLabel(p.doneAt)}` : ''}
          </span>
        </span>
        <Chip tone={p.doneAt ? 'ok' : 'warn'}>{p.doneAt ? 'Done' : 'To do'}</Chip>
      </div>
      <div className="iw-part-file small">
        {p.fileName ? (
          <span>
            File name: <strong data-no-translate>{p.fileName}</strong> · {TENDER_BID_PART_LABEL[p.part ?? 'TEKNIKAL']}
            {p.checked ? ` · checked by ${p.checked.by}: no company name` : ''}
          </span>
        ) : (
          <span className="muted">No file name yet. The IT Manager writes the name the tender asks for.</span>
        )}
        {p.canName && !naming && (
          <button className="link-button" onClick={() => setNaming(true)}>
            {p.fileName ? 'Change' : 'Write the file name'}
          </button>
        )}
      </div>
      {naming && (
        <div className="iw-naming">
          <Select className="select" aria-label="Part of the bid" value={part} onChange={(e) => setPart(e.target.value as TenderBidPart)}>
            {(Object.keys(TENDER_BID_PART_LABEL) as TenderBidPart[]).map((x) => (
              <option key={x} value={x}>
                {TENDER_BID_PART_LABEL[x]}
              </option>
            ))}
          </Select>
          <input
            className="input"
            aria-label="File name the tender asks for"
            placeholder="File name the tender asks for"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="iw-actions">
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || name.trim().length < 3}
              onClick={async () => {
                const r = await act.run(() => api.itAct('tender', { id: p.tenderId, step: 'fileName', index: p.k, fileName: name, part }), 'File name saved.');
                if (r) setNaming(false);
              }}
            >
              Save
            </button>
            <button className="btn btn-sm" onClick={() => setNaming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {p.files.length > 0 && (
        <div className="iw-actions">
          {p.files.map((f) => (
            <button key={f.sha256} className="btn btn-sm" disabled={act.busy} onClick={() => void openProof(act, p.tenderId, f)}>
              Open {f.name}
            </button>
          ))}
        </div>
      )}
      {p.canDo && (
        <div className="iw-tl-act">
          {p.fileName && (
            <p className="small">
              Name the file <strong data-no-translate>{p.fileName}</strong>, as the tender asks, never by the company name.
              {technical ? ' This is the technical part: no company name anywhere, including letterhead, logo, stamp, header, footer and the file properties.' : ''}
            </p>
          )}
          <ProofPicker site={null} refText={p.label} items={proof} onChange={(x) => setProof(x.slice(-1))} documentsOnly required noLinks />
          {technical && (
            <label className="row small iw-check">
              <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I checked every page: no company name
            </label>
          )}
          <div className="iw-actions">
            <button
              className="btn btn-sm"
              disabled={act.busy || !proof.length || !p.fileName || (technical && !ok)}
              onClick={() => void act.run(() => api.itAct('tender', { id: p.tenderId, step: 'done', index: p.k, proof, checked: ok }), 'Part done.')}
            >
              Done, with the document
            </button>
          </div>
        </div>
      )}
      {p.canReopen && (
        <div className="iw-naming">
          <input className="input" aria-label="What to fix" placeholder="What to fix" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="iw-actions">
            <button className="btn btn-sm" disabled={act.busy || note.trim().length < 5} onClick={() => void act.run(() => api.itAct('tender', { id: p.tenderId, step: 'reopen', index: p.k, note }), 'Sent back.')}>
              Send back
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </li>
  );
}

function DocLine({ tenderId, k, d, canRun }: { tenderId: string; k: number; d: NonNullable<TenderRow['task']['companyDocs']>[number]; canRun: boolean }) {
  const act = useAction();
  const [proof, setProof] = useState<ProofInput[]>([]);
  return (
    <li className="iw-part">
      <div className="iw-part-head">
        <span className="iw-part-main">
          <span className="iw-part-label">{d.label}</span>
          <span className="iw-row-meta">
            {d.askedAt ? `asked ${dateTimeLabel(d.askedAt)}` : ''}
            {d.askedAt && d.receivedAt ? ' · ' : ''}
            {d.receivedAt ? `received ${dateTimeLabel(d.receivedAt)}` : ''}
          </span>
        </span>
        <Chip tone={d.receivedAt ? 'ok' : d.askedAt ? 'warn' : 'unknown'}>{d.receivedAt ? 'Received' : d.askedAt ? 'Asked' : 'Not asked'}</Chip>
      </div>
      {canRun && !d.receivedAt && (
        <div className="iw-tl-act">
          {!d.askedAt && (
            <div className="iw-actions">
              <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.itAct('tender', { id: tenderId, step: 'askDoc', index: k }), 'Asked.')}>
                Asked the company
              </button>
            </div>
          )}
          <ProofPicker site={null} refText={d.label} items={proof} onChange={setProof} documentsOnly required />
          <div className="iw-actions">
            <button className="btn btn-sm" disabled={act.busy || !proof.length} onClick={() => void act.run(() => api.itAct('tender', { id: tenderId, step: 'gotDoc', index: k, proof }), 'Received.')}>
              Received, with the paper
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </li>
  );
}

/** A number tile (the kit's Stat markup). */
function Tile({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: 'ok' | 'warn' | 'crit' }) {
  return (
    <div className="k-stat" data-tone={tone}>
      <span className="k-stat-top">
        <span className="k-stat-label">{label}</span>
      </span>
      <span className="k-stat-value">{value}</span>
      {note && <span className="k-stat-note">{note}</span>}
    </div>
  );
}

/** What ACT checks in the IT pilot: the controls that must hold, the exceptions found, and every IT action. */
export function ItAudit({ data }: { data: ItBoard }) {
  const [area, setArea] = useState('all');
  const [who, setWho] = useState('');
  const a = data.audit;
  if (!a) return null;
  const areas = [...new Set(a.exceptions.map((e) => e.area))];
  const rows = a.exceptions.filter((e) => area === 'all' || e.area === area);
  const trail = a.trail.filter((e) => !who || e.actor.toLowerCase().includes(who.toLowerCase()) || e.summary.toLowerCase().includes(who.toLowerCase()));
  const broken = a.controls.filter((c) => c.breaks).length;
  const actNow = a.exceptions.filter((e) => e.tone === 'crit').length;
  return (
    <>
      <div className="k-stats">
        <Tile label="Controls held" value={a.controls.length - broken} note={`${a.controls.length} controls`} tone={broken ? undefined : 'ok'} />
        <Tile label="Controls broken" value={broken} tone={broken ? 'crit' : undefined} />
        <Tile label="Exceptions to check" value={a.exceptions.length} note={actNow ? `${actNow} act now` : undefined} tone={actNow ? 'crit' : a.exceptions.length ? 'warn' : undefined} />
        <Tile label="IT actions recorded" value={a.trail.length} />
      </div>
      <Box title="Controls" sub="Rules that must always hold. Each counts how many times it was broken, so 0 means it held." flush>
        <ul className="iw-rows">
          {a.controls.map((c) => (
            <li key={c.what} className="iw-row">
              <div className="iw-row-main">
                <span>{c.what}</span>
              </div>
              <div className="iw-row-side">
                <Chip tone={c.breaks ? 'crit' : 'ok'}>{c.breaks ? `${c.breaks} broken` : 'Held'}</Chip>
              </div>
            </li>
          ))}
        </ul>
      </Box>
      <Box
        title={`Exceptions to check (${rows.length})`}
        sub="Found in the records: late or returned work, choices that needed a reason, approvals recorded from Teams, and settings to fix. Open the record's proof from its own tab."
        flush
        actions={
          <Select className="select iw-assign" aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="all">All areas</option>
            {areas.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        }
      >
        {!rows.length && <div className="empty">Nothing found.</div>}
        <ul className="iw-rows">
          {rows.map((e, k) => (
            <li key={k} className="iw-row">
              <div className="iw-row-main">
                <span className="iw-row-title">
                  {e.area} · {e.ref}
                </span>
                <span className="iw-row-meta">
                  {e.what}
                  {e.who ? ` · ${e.who}` : ''}
                  {e.at ? ` · ${dateTimeLabel(e.at)}` : ''}
                </span>
              </div>
              <div className="iw-row-side">
                <Chip tone={e.tone === 'crit' ? 'crit' : e.tone === 'warn' ? 'warn' : 'info'}>{e.tone === 'crit' ? 'Act now' : e.tone === 'warn' ? 'Check' : 'Note'}</Chip>
              </div>
            </li>
          ))}
        </ul>
      </Box>
      <Box
        title="Every IT action"
        sub="From the audit trail, newest first. Entries cannot be edited or removed."
        flush
        actions={<input className="input iw-assign" type="search" aria-label="Find" placeholder="Person or reference" value={who} onChange={(e) => setWho(e.target.value)} />}
      >
        {!trail.length && <div className="empty">No IT actions yet in this test.</div>}
        <ul className="iw-rows iw-trail">
          {trail.slice(0, 200).map((e, k) => (
            <li key={k} className="iw-row">
              <span className="iw-trail-when">{dateTimeLabel(e.at)}</span>
              <div className="iw-row-main">
                <span>
                  <strong>{e.actor}</strong> · {e.summary}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Box>
    </>
  );
}
