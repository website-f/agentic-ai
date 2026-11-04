import { useState } from 'react';
import { TENDER_BID_PART_LABEL, type ProofInput, type TenderBidPart } from '@prima/core';
import { api, type ItBoard } from '../api';
import { useApp } from '../App';
import { ProofPicker } from './Proof';
import { saveFile } from '../save';
import { Chip, notify, ErrorNotice, dateLabel, dateTimeLabel, useAction } from '../ui';

/**
 * The pilot additions to the IT screen (Fauzan, 28 Oct 2026): buying with three quotes, one online comparison and COO then CEO
 * approval in Prima (trusted Teams integration remains pending) before the fulfilment workflow; eP tenders run by the IT Manager with the paired
 * IT Executive, every stage against a target in minutes; help requests logged for staff not on the system yet; and the
 * COO standing in while the IT Manager is away.
 */

type PurchaseRow = NonNullable<ItBoard['purchases']>[number];
type TenderRow = NonNullable<ItBoard['tenders']>[number];
type ClockRow = TenderRow['clock']['rows'][number];

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
  return (
    <div className="panel" style={{ margin: 0, padding: 8 }}>
      <div className="small" style={{ fontWeight: 600 }}>
        Quotes ({quotes.length} of {r.quotesNeeded}) and distinct online comparisons ({Math.max(0, r.onlineChecksNeeded - row.buy.onlineMissing)} of {r.onlineChecksNeeded} required)
      </div>
      <div className="list">
        {quotes.map((q, k) => (
          <div key={q.supplier} className="list-item small">
            <span>
              {p.chosen?.index === k ? '✓ ' : ''}
              {q.supplier} · {rm(q.amount)}
              {q.ref ? ` · ${q.ref}` : ''} · {q.proof.map((f) => f.name).join(', ')}
            </span>
            {row.buy.lowestQuote === q.amount && <Chip tone="ok">Lowest</Chip>}
          </div>
        ))}
        {online.map((o) => (
          <div key={o.source + o.at} className="list-item small">
            <span>
              Online: {o.source} · {rm(o.amount)} · {o.ref} · recorded {dateTimeLabel(o.at)} · {o.proof.map((f) => f.name).join(', ')}
            </span>
          </div>
        ))}
      </div>
      {p.chosen && (
        <div className="muted small">
          Chosen: {quotes[p.chosen.index]?.supplier}
          {p.chosen.reason ? ` (${p.chosen.reason})` : ''}
          {row.buy.overOnline ? ` · more than ${r.onlineTolerancePct}% above the online price` : ''}
        </div>
      )}
      <div className="muted small">
        {p.cooStep ? `COO ${p.cooStep.decision === 'reject' ? 'rejected' : 'approved'}: ${p.cooStep.by}, ${dateTimeLabel(p.cooStep.at)} ${viaText(p.cooStep)}` : 'COO: not yet'}
        {' · '}
        {p.ceoStep ? `CEO ${p.ceoStep.decision === 'reject' ? 'rejected' : 'approved'}: ${p.ceoStep.by}, ${dateTimeLabel(p.ceoStep.at)} ${viaText(p.ceoStep)}` : 'CEO: not yet'}
        {p.finance ? ` · to Finance ${dateTimeLabel(p.finance.sentAt)} (${p.finance.ref})` : ''}
        {p.finance?.paidRef ? ` · paid ${p.finance.paidRef} on ${dateLabel(p.finance.paidOn!)}` : ''}
        {p.delivery ? ` · received on ${p.delivery.ref}` : ''}
      </div>
      <ErrorNotice error={act.error} />

      {row.canBuy && p.status === 'quoting' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          <div className="row" style={{ gap: 6 }}>
            <select className="select" aria-label="Add" value={kind} onChange={(e) => setKind(e.target.value as 'quote' | 'online')}>
              <option value="quote">Supplier quote</option>
              <option value="online">Online or marketplace price</option>
            </select>
            <input className="input" aria-label={kind === 'quote' ? 'Supplier' : 'Website'} placeholder={kind === 'quote' ? 'Supplier' : 'Website or marketplace'} value={who} onChange={(e) => setWho(e.target.value)} />
            <input className="input" inputMode="decimal" aria-label="Total RM" placeholder="Total, RM" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <input className="input" aria-label="Reference" placeholder={kind === 'quote' ? 'Quotation number' : 'Link to the listing'} value={ref} onChange={(e) => setRef(e.target.value)} />
          <ProofPicker site={null} refText={p.ref} items={proof} onChange={setProof} documentsOnly required />
          <button
            className="btn btn-sm"
            disabled={act.busy || !who.trim() || !amount || !proof.length || (kind === 'online' && !ref.trim())}
            onClick={() => void step(kind, kind === 'quote' ? { supplier: who, amount: Number(amount), ref, proof } : { source: who, amount: Number(amount), ref, proof }, 'Added.')}
          >
            Add {kind === 'quote' ? 'quote' : 'online price'}
          </button>
          {row.buy.quotesMissing === 0 && row.buy.onlineMissing === 0 && (
            <>
              <div className="row" style={{ gap: 6 }}>
                <select className="select" aria-label="Choose supplier" value={pick} onChange={(e) => setPick(e.target.value)}>
                  {quotes.map((q, k) => (
                    <option key={q.supplier} value={k}>
                      {q.supplier} · {rm(q.amount)}
                    </option>
                  ))}
                </select>
                <input className="input" aria-label="Why this one" placeholder="Why, if not the lowest" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void step('submit', { index: Number(pick), reason }, 'Sent for COO approval.')}>
                Send for COO then CEO approval
              </button>
            </>
          )}
        </div>
      )}

      {(p.status === 'coo' || p.status === 'ceo') && (row.canDecide || row.canBuy) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          <input className="input" aria-label="Note" placeholder="Note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          {row.canDecide ? (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void step('decide', { decision: 'approve', note }, 'Approved.')}>
                Approve
              </button>
              <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => void step('decide', { decision: 'reject', note }, 'Rejected.')}>
                Reject
              </button>
            </div>
          ) : (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Manual external approval evidence: this form records a title and screenshot under existing authority. It does not verify a Teams approval or establish a trusted Teams connection.
              </p>
              <input className="input" aria-label="Teams approval" placeholder="Teams approval title or link" value={teamsRef} onChange={(e) => setTeamsRef(e.target.value)} />
              <ProofPicker site={null} refText={p.ref} items={proof} onChange={setProof} documentsOnly required />
              <div className="row" style={{ gap: 6 }}>
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

      {['finance','paid','partially_received','received'].includes(p.status)&&<div className="notice" data-tone="info"><p>Use IT purchase fulfilment for the approved PO, actual goods receipts, invoice matching and payment references. Normal payment follows receipt and match; advances require a separate COO then CEO exception. Historical payment or receipt records remain read-only and are not automatically treated as verified.</p><button className="btn" onClick={()=>go({view:'it-procurement'})}>Open authorized IT purchase fulfilment</button></div>}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" aria-label="Who asked" placeholder="Who asked (name and company)" value={raisedFor} onChange={(e) => setFor(e.target.value)} />
        <select className="select" aria-label="How they asked" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="teams">Teams</option>
          <option value="email">Email</option>
          <option value="phone">Phone</option>
          <option value="in_person">In person</option>
        </select>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <select className="select" aria-label="About" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="M365">Microsoft 365</option>
          <option value="ACCOUNT">Account or password</option>
          <option value="DEVICE">Device</option>
          <option value="NETWORK">Internet or network</option>
          <option value="PRIMA">Prima</option>
          <option value="OTHER">Other</option>
        </select>
        <select className="select" aria-label="Urgency" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="P1">P1: work stopped</option>
          <option value="P2">P2: work slowed</option>
          <option value="P3">P3: can wait</option>
        </select>
      </div>
      <input className="input" aria-label="What is wrong" placeholder="What is wrong" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy || raisedFor.trim().length < 2 || !title.trim()}
        onClick={() => void act.run(() => api.itAct('logTicket', { raisedFor, channel, category, priority, title, detail: '' }), 'Logged.').then((x) => x && onDone())}
      >
        Log it
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** Pilot: IT records the person's answer, by someone other than the one who fixed it. */
export function RecordConfirm({ id }: { id: string }) {
  const act = useAction();
  const [via, setVia] = useState('');
  const [note, setNote] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" aria-label="How they answered" placeholder="How they answered (e.g. Teams chat, 10:40)" value={via} onChange={(e) => setVia(e.target.value)} />
        <input className="input" aria-label="What is still wrong" placeholder="If not fixed: what is still wrong" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row" style={{ gap: 6 }}>
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
    <section className="panel">
      <div className="panel-head">
        <h3>When the IT Manager is away</h3>
        {data.away && <Chip tone="warn">Away now: the COO accepts</Chip>}
      </div>
      <p className="muted small">
        While the IT Manager is away the COO accepts finished work, so nothing waits. The COO may also accept or return any job at any time; whoever was in charge of checking it is told.
        {s?.managerAwayFrom ? ` Set: ${dateLabel(s.managerAwayFrom)} to ${dateLabel(s.managerAwayUntil!)} by ${s.setBy}.` : ''}
      </p>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input className="input" type="date" aria-label="First day away" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input" type="date" aria-label="Last day away" value={until} onChange={(e) => setUntil(e.target.value)} />
        <button className="btn btn-sm" disabled={act.busy || !from || !until} onClick={() => void act.run(() => api.itAct('setAway', { from, until }), 'Saved.')}>
          Save
        </button>
        {s?.managerAwayFrom && (
          <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.itAct('setAway', { from: '', until: '' }), 'Cleared.').then(() => (setFrom(''), setUntil('')))}>
            The IT Manager is back
          </button>
        )}
      </div>
      <ErrorNotice error={act.error} />
    </section>
  );
}

/** The timeline steps whose clock is running and that are mine. */
export function TenderStepsMine({ data, openTab }: { data: ItBoard; openTab: () => void }) {
  const steps = data.myWork?.tenderSteps ?? [];
  if (!steps.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Tender steps running now</h3>
        <button className="btn btn-sm" onClick={openTab}>
          Open tenders
        </button>
      </div>
      <div className="list">
        {steps.map((s) => (
          <div key={s.tenderId + s.step.key} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{s.step.label}</div>
              <div className="muted small">
                {s.title} · target {minutes(s.step.minutes)}
                {s.dueAt ? ` · due ${dateTimeLabel(s.dueAt)}` : ''}
              </div>
            </div>
            <Chip tone={s.late ? 'crit' : 'info'}>{s.late ? `Late ${minutes(s.lateMin || null)}` : 'Running'}</Chip>
          </div>
        ))}
      </div>
    </section>
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
      <section className="panel">
        <div className="panel-head">
          <h3>IT tenders (eP and government)</h3>
          {(manager || data.lead) && (
            <button className="btn btn-sm" onClick={() => setForm(!form)} disabled={!data.tenderExec}>
              Add a tender found
            </button>
          )}
        </div>
        <p className="muted small">
          Every stage has a target in minutes and its clock starts when the stage before it is done: the earlier the bid is in eP, the better its chances. The
          closing date is only the last line; the bid goes in at least a day before.
        </p>
        <div className="row small" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span>
            Tender executive (paired with the IT Manager): <strong>{data.tenderExec?.name ?? 'not named yet'}</strong>
          </span>
          {manager && (
            <select
              className="select"
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
            </select>
          )}
        </div>
        <ErrorNotice error={act.error} />
        {form && <AddTender data={data} onDone={() => setForm(false)} />}
      </section>
      <CodeHolders data={data} />
      {rows.map((t) => (
        <TenderCard key={t.task.id} t={t} data={data} />
      ))}
      {!rows.length && <div className="empty">No IT tenders running.</div>}
      <button className="btn btn-sm" onClick={() => setShowClosed(!showClosed)}>
        {showClosed ? 'Hide won, lost and dropped' : 'Show won, lost and dropped'}
      </button>
      {old.length > 0 && <p className="muted small">{old.length} older tender parts without a timeline are kept in the record.</p>}
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
    <section className="panel">
      <div className="panel-head">
        <h3>Which companies hold IT codes</h3>
        {manager && (
          <button className="btn btn-sm" onClick={() => setForm(!form)}>
            Record a company
          </button>
        )}
      </div>
      <p className="muted small">
        Checked by the IT Manager during the pilot, from each company&apos;s MOF certificate. An IT tender is bid only in the name of a company holding the codes asked, with
        the certificate in force. PWVSB is the group company and holds no codes.{check ? ` ${check.checked} of ${check.companies.length} companies checked.` : ''}
      </p>
      {form && check && <CodeHolderForm companies={check.companies} onDone={() => setForm(false)} />}
      <ErrorNotice error={act.error} />
      <div className="list">
        {rows.map((h) => (
          <div key={h.holder.id} className="list-item small" style={{ flexWrap: 'wrap', gap: 6 }}>
            <span style={{ minWidth: 0 }}>
              <strong>{h.companyName}</strong> ·{' '}
              {h.holder.codes.length ? h.holder.codes.map((c) => `${c.code} ${c.label}`).join(' · ') : `no IT code${h.holder.note ? ` (${h.holder.note})` : ''}`}
              {h.holder.certNo ? ` · ${h.holder.certNo}` : ''}
              {h.holder.checkedBy ? ` · checked by ${h.holder.checkedBy}${h.holder.checkedAt ? `, ${dateLabel(h.holder.checkedAt.slice(0, 10))}` : ''}` : ''}
            </span>
            <span className="row" style={{ gap: 6 }}>
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
            </span>
          </div>
        ))}
        {left.length > 0 && <div className="muted small">Still to check: {left.map((c) => c.name).join(', ')}</div>}
      </div>
    </section>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
      <select className="select" aria-label="Company" value={companyId} onChange={(e) => setCompany(e.target.value)}>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <textarea
        className="input"
        aria-label="IT codes"
        rows={3}
        placeholder={'IT codes, one per line, as on the certificate (e.g. 210101 Perkakasan ICT). Leave empty if it holds none.'}
        value={codes}
        onChange={(e) => setCodes(e.target.value)}
      />
      <div className="row" style={{ gap: 6 }}>
        <input className="input" aria-label="Certificate number" placeholder="MOF certificate number" value={certNo} onChange={(e) => setCertNo(e.target.value)} />
        <input className="input" type="date" aria-label="Certificate expiry" value={expiresOn} onChange={(e) => setExpires(e.target.value)} />
      </div>
      <input className="input" aria-label="Note" placeholder="Note (needed when it holds no IT code)" value={note} onChange={(e) => setNote(e.target.value)} />
      <ProofPicker site={null} refText="MOF certificate" items={proof} onChange={setProof} documentsOnly required />
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy || !proof.length}
        onClick={() => void act.run(() => api.itAct('codeHolder', { companyId, codes: list, expiresOn, certNo, note, proof }), 'Recorded.').then((x) => x && onDone())}
      >
        {list.length ? 'Save the codes' : 'Checked: holds no IT code'}
      </button>
      <ErrorNotice error={act.error} />
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <div className="row" style={{ gap: 6 }}>
        <select className="select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as 'tender' | 'quotation')}>
          <option value="tender">Open tender</option>
          <option value="quotation">Quotation (sebut harga)</option>
        </select>
        <input className="input" type="date" aria-label="Closes on" value={closesOn} onChange={(e) => setCloses(e.target.value)} />
      </div>
      <input className="input" aria-label="Title" placeholder="Title as on eP" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="input" aria-label="Buyer" placeholder="Ministry, agency or council" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
      <select className="select" aria-label="Bid in the name of" value={companyId} onChange={(e) => (setCompany(e.target.value), setCodes([]))}>
        {holders.map((h) => (
          <option key={h.holder.id} value={h.holder.companyId}>
            {h.companyName}
          </option>
        ))}
      </select>
      <div className="row small" style={{ gap: 8, flexWrap: 'wrap' }}>
        {holder?.holder.codes.map((c) => (
          <label key={c.code} className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={codes.includes(c.code)} onChange={(e) => setCodes(e.target.checked ? [...codes, c.code] : codes.filter((x) => x !== c.code))} />
            {c.code} {c.label}
          </label>
        ))}
      </div>
      {kind === 'tender' && (
        <label className="small">
          Compulsory briefing or site visit (if any){' '}
          <input className="input" type="date" aria-label="Briefing on" value={briefingOn} onChange={(e) => setBriefing(e.target.value)} />
        </label>
      )}
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
      <ErrorNotice error={act.error} />
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
  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{task.title}</div>
          <div className="muted small">
            {task.kind === 'quotation' ? 'Quotation' : 'Open tender'} · {task.buyer} · {task.source} · in the name of {t.companyName} · codes {(task.codes ?? []).join(', ')} · closes{' '}
            {dateLabel(task.closesOn)} ({t.daysLeft} days)
          </div>
          <div className="muted small">
            Target {minutes(c.targetMin)} of work from found to submitted
            {c.totalMin != null ? ` · took ${minutes(c.totalMin)}` : ''}
            {running.length ? ` · now: ${running.map((r) => r.step.label.split(/[;:(]/)[0].trim()).join('; ')}` : ''}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {c.late > 0 && <Chip tone="crit">{c.late} late</Chip>}
          <Chip tone={tone}>{label}</Chip>
        </div>
      </div>
      <button className="btn btn-sm" onClick={() => setOpen(!open)} style={{ marginTop: 6 }}>
        {open ? 'Hide timeline' : 'Timeline, parts and papers'}
      </button>
      <ErrorNotice error={act.error} />
      {open && (
        <>
          <div className="list" style={{ marginTop: 6 }}>
            {c.rows.map((r) => (
              <StepLine key={r.step.key} r={r} tenderId={task.id} mine={mine.has(r.step.key)} />
            ))}
          </div>
          <h4 style={{ margin: '10px 0 4px' }}>IT parts</h4>
          <div className="list">
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
          </div>
          <h4 style={{ margin: '10px 0 4px' }}>Papers from the company</h4>
          <div className="list">
            {(task.companyDocs ?? []).map((d, k) => (
              <DocLine key={d.label} tenderId={task.id} k={k} d={d} canRun={live && data.role === 'manager'} />
            ))}
          </div>
        </>
      )}
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
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="small" style={{ fontWeight: 600 }}>
            {s.label}
          </div>
          <div className="muted small">
            {OWNER[s.owner]} · target {minutes(s.minutes)} · {state}
          </div>
        </div>
        <Chip tone={s.doneAt ? (r.late ? 'warn' : 'ok') : r.late ? 'crit' : r.ready ? 'info' : 'unknown'}>
          {s.doneAt ? (r.late ? 'Done late' : 'Done') : r.late ? `Late ${r.lateMin ? minutes(r.lateMin) : ''}`.trim() : r.ready ? 'Running' : 'Waiting'}
        </Chip>
      </div>
      {mine && (
        <>
          <input
            className="input"
            aria-label="Note"
            placeholder={s.key === 'handover' ? 'Who in the company received the bid pack' : s.key === 'briefing' ? 'Who attended, or why not needed' : s.key === 'go' ? 'Note (needed for no-go)' : 'Note'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {s.key === 'submit' && <ProofPicker site={null} refText={s.label} items={proof} onChange={setProof} documentsOnly required />}
          <div className="row" style={{ gap: 6 }}>
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
        </>
      )}
    </div>
  );
}

/** Fetch one proof file (the board carries none) and hand it to the viewer. */
async function openProof(act: ReturnType<typeof useAction>, id: string, f: { name: string; sha256: string }) {
  const got = (await act.run(() => api.itAct('jobProof', { id, sha256: f.sha256 }))) as { data: string } | undefined;
  if (got) {
    const m = await saveFile(f.name, got.data);
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
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row small" style={{ justifyContent: 'space-between', gap: 6 }}>
        <span>
          {p.label} · {p.who ?? 'not given'}
          {p.doneAt ? ` · done by ${p.by}, ${dateTimeLabel(p.doneAt)}` : ''}
        </span>
        <Chip tone={p.doneAt ? 'ok' : 'warn'}>{p.doneAt ? 'Done' : 'To do'}</Chip>
      </div>
      <div className="small">
        {p.fileName ? (
          <>
            File name: <strong data-no-translate>{p.fileName}</strong> · {TENDER_BID_PART_LABEL[p.part ?? 'TEKNIKAL']}
            {p.checked ? ` · checked by ${p.checked.by}: no company name` : ''}
          </>
        ) : (
          <span className="muted">No file name yet. The IT Manager writes the name the tender asks for.</span>
        )}
        {p.canName && !naming && (
          <button className="link-button" style={{ marginLeft: 8 }} onClick={() => setNaming(true)}>
            {p.fileName ? 'Change' : 'Write the file name'}
          </button>
        )}
      </div>
      {naming && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="select" aria-label="Part of the bid" value={part} onChange={(e) => setPart(e.target.value as TenderBidPart)}>
            {(Object.keys(TENDER_BID_PART_LABEL) as TenderBidPart[]).map((x) => (
              <option key={x} value={x}>
                {TENDER_BID_PART_LABEL[x]}
              </option>
            ))}
          </select>
          <input
            className="input"
            style={{ flex: 1, minWidth: 160 }}
            aria-label="File name the tender asks for"
            placeholder="File name the tender asks for"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
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
      )}
      {p.files.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {p.files.map((f) => (
            <button key={f.sha256} className="btn btn-sm" disabled={act.busy} onClick={() => void openProof(act, p.tenderId, f)}>
              Open {f.name}
            </button>
          ))}
        </div>
      )}
      {p.canDo && (
        <>
          {p.fileName && (
            <p className="small">
              Name the file <strong data-no-translate>{p.fileName}</strong>, as the tender asks, never by the company name.
              {technical ? ' This is the technical part: no company name anywhere, including letterhead, logo, stamp, header, footer and the file properties.' : ''}
            </p>
          )}
          <ProofPicker site={null} refText={p.label} items={proof} onChange={(x) => setProof(x.slice(-1))} documentsOnly required />
          {technical && (
            <label className="row small" style={{ gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I checked every page: no company name
            </label>
          )}
          <button
            className="btn btn-sm"
            disabled={act.busy || !proof.length || !p.fileName || (technical && !ok)}
            onClick={() => void act.run(() => api.itAct('tender', { id: p.tenderId, step: 'done', index: p.k, proof, checked: ok }), 'Part done.')}
          >
            Done, with the document
          </button>
        </>
      )}
      {p.canReopen && (
        <div className="row" style={{ gap: 6 }}>
          <input className="input" aria-label="What to fix" placeholder="What to fix" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-sm" disabled={act.busy || note.trim().length < 5} onClick={() => void act.run(() => api.itAct('tender', { id: p.tenderId, step: 'reopen', index: p.k, note }), 'Sent back.')}>
            Send back
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function DocLine({ tenderId, k, d, canRun }: { tenderId: string; k: number; d: NonNullable<TenderRow['task']['companyDocs']>[number]; canRun: boolean }) {
  const act = useAction();
  const [proof, setProof] = useState<ProofInput[]>([]);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row small" style={{ justifyContent: 'space-between', gap: 6 }}>
        <span>
          {d.label}
          {d.askedAt ? ` · asked ${dateTimeLabel(d.askedAt)}` : ''}
          {d.receivedAt ? ` · received ${dateTimeLabel(d.receivedAt)}` : ''}
        </span>
        <Chip tone={d.receivedAt ? 'ok' : d.askedAt ? 'warn' : 'unknown'}>{d.receivedAt ? 'Received' : d.askedAt ? 'Asked' : 'Not asked'}</Chip>
      </div>
      {canRun && !d.receivedAt && (
        <>
          {!d.askedAt && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.itAct('tender', { id: tenderId, step: 'askDoc', index: k }), 'Asked.')}>
              Asked the company
            </button>
          )}
          <ProofPicker site={null} refText={d.label} items={proof} onChange={setProof} documentsOnly required />
          <button className="btn btn-sm" disabled={act.busy || !proof.length} onClick={() => void act.run(() => api.itAct('tender', { id: tenderId, step: 'gotDoc', index: k, proof }), 'Received.')}>
            Received, with the paper
          </button>
        </>
      )}
      <ErrorNotice error={act.error} />
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
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Controls</h3>
        </div>
        <p className="muted small">Rules that must always hold. Each counts how many times it was broken, so 0 means it held.</p>
        <div className="list">
          {a.controls.map((c) => (
            <div key={c.what} className="list-item small">
              <span>{c.what}</span>
              <Chip tone={c.breaks ? 'crit' : 'ok'}>{c.breaks ? `${c.breaks} broken` : 'Held'}</Chip>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Exceptions to check ({rows.length})</h3>
          <select className="select" aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="all">All areas</option>
            {areas.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>
        <p className="muted small">Found in the records: late or returned work, choices that needed a reason, approvals recorded from Teams, and settings to fix. Open the record&apos;s proof from its own tab.</p>
        <div className="list">
          {!rows.length && <div className="empty">Nothing found.</div>}
          {rows.map((e, k) => (
            <div key={k} className="list-item small" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span style={{ minWidth: 0 }}>
                <strong>
                  {e.area} · {e.ref}
                </strong>{' '}
                · {e.what}
                {e.who ? ` · ${e.who}` : ''}
                {e.at ? ` · ${dateTimeLabel(e.at)}` : ''}
              </span>
              <Chip tone={e.tone === 'crit' ? 'crit' : e.tone === 'warn' ? 'warn' : 'info'}>{e.tone === 'crit' ? 'Act now' : e.tone === 'warn' ? 'Check' : 'Note'}</Chip>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Every IT action</h3>
          <input className="input" aria-label="Find" placeholder="Person or reference" value={who} onChange={(e) => setWho(e.target.value)} />
        </div>
        <p className="muted small">From the audit trail, newest first. Entries cannot be edited or removed.</p>
        <div className="list">
          {!trail.length && <div className="empty">No IT actions yet in this test.</div>}
          {trail.slice(0, 200).map((e, k) => (
            <div key={k} className="list-item small">
              <span>
                {dateTimeLabel(e.at)} · <strong>{e.actor}</strong> · {e.summary}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
