import { useState } from 'react';
import { FinGuide } from './FinGuide';
import { readAsDataUrl, shrinkImage } from './Proof';
import { api, type FinControls, type FinDesk } from '../api';
import { Chip, ErrorNotice, dateLabel, useAction, useLoad, type Tone } from '../ui';

/**
 * Daily cash pay (Fauzan, 2 Nov 2026): Finance lists the people paid each day for the week or month; only the Finance
 * Director approves. Fauzan, 6 Nov 2026 ("Buffer also the same" as guard pay): each person is paid to a bank account or
 * e-wallet; cash only when the Director Office lists them and the COO or CEO gives it, and only that cash is prepared
 * and handed to the COO or CEO; a relative's or friend's account needs a consent letter stamped by a Commissioner for
 * Oaths and approved by the COO.
 */

type Co = FinDesk['companies'][number];
type DC = FinControls['dailyCash'];
type List = DC['lists'][number];
type Mine = Awaited<ReturnType<typeof api.finDailyCashMine>>['lists'][number];
const rm = (n: number | null | undefined) => (n == null ? '–' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const STATUS: Record<List['status'], [Tone, string]> = {
  draft: ['neutral', 'Being listed'],
  to_approve: ['warn', 'With the FD'],
  approved: ['info', 'Approved: pay out'],
  with_collector: ['info', 'With the COO / CEO'],
  returned: ['warn', 'To settle'],
  settled: ['ok', 'Settled'],
  cancelled: ['neutral', 'Cancelled'],
};

function useGo(companyId: string) {
  const act = useAction();
  const go = (action: string, input: Record<string, unknown>, msg: string) => act.run(() => api.finControlAction(companyId, 'dailycash', action, input), msg);
  return { act, go };
}

type Acc = {
  bank: string;
  last4: string;
  holder: 'own' | 'joint' | 'relative' | 'friend';
  holderName: string;
  relationship: string;
  consentRef: string;
  signedOn: string;
  commissioner: string;
  stampRef: string;
  stampedOn: string;
};
type Person = { name: string; idLast4: string; work: string; dailyRate: number; days: string[]; pay: '' | 'bank' | 'ewallet' | 'cash'; account: Acc };
const NO_ACC: Acc = { bank: '', last4: '', holder: 'own', holderName: '', relationship: '', consentRef: '', signedOn: '', commissioner: '', stampRef: '', stampedOn: '' };
const PAY_LABEL: Record<string, string> = { bank: 'Bank', ewallet: 'E-wallet', cash: 'Cash (Director Office lists, COO or CEO gives)' };

const datesBetween = (from: string, to: string) => {
  const out: string[] = [];
  if (!from || !to || from > to) return out;
  for (let d = new Date(`${from}T00:00:00Z`); out.length < 31; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > to) break;
    out.push(iso);
  }
  return out;
};

/** "Name; last 4 of IC; work; daily rate" per line, each listed for every day until days are picked. */
function parsePeople(t: string, days: string[]): Person[] {
  return t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, idLast4, work, rate] = l.split(/[;|\t]/).map((x) => x.trim());
      return { name: name ?? '', idLast4: idLast4 ?? '', work: work ?? '', dailyRate: Number(rate) || 0, days, pay: '' as const, account: NO_ACC };
    });
}

/**
 * The people on a list and the days each one works (Arisha main's review, 2 Nov 2026: day entry was missing). Paste
 * people in, then tick each person's days; the total follows.
 */
function PeopleEditor({ from, to, people, onChange }: { from: string; to: string; people: Person[]; onChange: (p: Person[]) => void }) {
  const all = datesBetween(from, to);
  const [paste, setPaste] = useState('');
  const set = (i: number, patch: Partial<Person>) => onChange(people.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const total = people.reduce((n, p) => n + p.dailyRate * p.days.filter((d) => all.includes(d)).length, 0);
  return (
    <div className="stack fin-gap">
      {people.map((p, i) => (
        <div key={i} className="list-item fin-block">
          <div className="row">
            <input className="input" aria-label={`Person ${i + 1} name`} placeholder="Name" value={p.name} onChange={(e) => set(i, { name: e.target.value })} />
            <input
              className="input fin-w-sm"
              aria-label={`Person ${i + 1} last 4 of IC or passport`}
              placeholder="Last 4 of IC / passport"
              maxLength={4}
              value={p.idLast4}
              onChange={(e) => set(i, { idLast4: e.target.value })}
            />
            <input
              className="input"
              aria-label={`Person ${i + 1} work or site`}
              placeholder="Work or site"
              value={p.work}
              onChange={(e) => set(i, { work: e.target.value })}
            />
            <input
              className="input fin-w-sm"
              type="number"
              step="0.01"
              aria-label={`Person ${i + 1} daily rate RM`}
              placeholder="Daily rate RM"
              value={p.dailyRate || ''}
              onChange={(e) => set(i, { dailyRate: Number(e.target.value) || 0 })}
            />
            <button className="btn btn-sm" aria-label={`Remove person ${i + 1}`} onClick={() => onChange(people.filter((_, k) => k !== i))}>
              Remove
            </button>
          </div>
          <div className="row fin-mt" role="group" aria-label={`Days for person ${i + 1}`}>
            <span className="muted small">Days ({p.days.filter((d) => all.includes(d)).length}):</span>
            {all.map((d) => {
              const on = p.days.includes(d);
              return (
                <button
                  key={d}
                  className="btn btn-sm"
                  aria-pressed={on}
                  aria-label={`${p.name || `Person ${i + 1}`} works ${d}`}
                  style={on ? undefined : { opacity: 0.55 }}
                  onClick={() => set(i, { days: on ? p.days.filter((x) => x !== d) : [...p.days, d].sort() })}
                >
                  {d.slice(8)}
                </button>
              );
            })}
            <button className="btn btn-sm" onClick={() => set(i, { days: all })}>
              Every day
            </button>
            <button className="btn btn-sm" onClick={() => set(i, { days: [] })}>
              None
            </button>
          </div>
          <PayEditor i={i} p={p} set={(patch) => set(i, patch)} />
        </div>
      ))}
      <textarea
        className="input fin-full"
        rows={2}
        aria-label="Add people"
        placeholder={'Add people, one per line: name; last 4 of IC or passport; work or site; daily rate\nAli bin Abu; 1234; Orchard harvest; 120'}
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
      />
      <div className="row fin-center">
        <button
          className="btn btn-sm"
          disabled={!paste.trim() || !all.length}
          onClick={() => {
            onChange([...people, ...parsePeople(paste, all)]);
            setPaste('');
          }}
        >
          Add to the list
        </button>
        <button
          className="btn btn-sm"
          disabled={!all.length}
          onClick={() => onChange([...people, { name: '', idLast4: '', work: '', dailyRate: 0, days: all, pay: '', account: NO_ACC }])}
        >
          Add one person
        </button>
        <span className="muted small">
          {all.length ? `New people start on every day; untick the days they do not work. Total ${rm(total)}.` : 'Choose the first and last day first.'}
        </span>
      </div>
    </div>
  );
}

/**
 * How one person is paid (Fauzan, 6 Nov 2026): bank or e-wallet (the name and the last 4 digits only), or cash, which
 * the Director Office then lists and the COO or CEO gives. A relative's or friend's account needs the stamped letter.
 */
function PayEditor({ i, p, set }: { i: number; p: Person; set: (patch: Partial<Person>) => void }) {
  const a = p.account;
  const setA = (patch: Partial<Acc>) => set({ account: { ...a, ...patch } });
  const n = p.name || `Person ${i + 1}`;
  return (
    <div className="stack" style={{ gap: 4, marginTop: 4 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="select" aria-label={`${n}: paid by`} value={p.pay} onChange={(e) => set({ pay: e.target.value as Person['pay'] })}>
          <option value="">Paid by…</option>
          <option value="bank">Bank account</option>
          <option value="ewallet">E-wallet</option>
          <option value="cash">Cash (needs the Director Office and the COO or CEO)</option>
        </select>
        {(p.pay === 'bank' || p.pay === 'ewallet') && (
          <>
            <input
              className="input"
              aria-label={`${n}: ${p.pay === 'ewallet' ? 'e-wallet' : 'bank'}`}
              placeholder={p.pay === 'ewallet' ? "E-wallet (e.g. Touch 'n Go)" : 'Bank (e.g. Maybank)'}
              value={a.bank}
              onChange={(e) => setA({ bank: e.target.value })}
            />
            <input
              className="input"
              aria-label={`${n}: last 4 digits of the account`}
              placeholder="Last 4 digits only"
              maxLength={4}
              inputMode="numeric"
              style={{ width: 120 }}
              value={a.last4}
              onChange={(e) => setA({ last4: e.target.value.replace(/\D/g, '') })}
            />
            <select className="select" aria-label={`${n}: whose account`} value={a.holder} onChange={(e) => setA({ holder: e.target.value as Acc['holder'] })}>
              <option value="own">Their own</option>
              <option value="joint">Joint</option>
              <option value="relative">A relative's (consent letter)</option>
              <option value="friend">A friend's (consent letter)</option>
            </select>
          </>
        )}
        {p.pay === 'cash' && <span className="muted small">The Director Office lists them with the reason, then the COO or CEO decides.</span>}
      </div>
      {(p.pay === 'bank' || p.pay === 'ewallet') && (a.holder === 'relative' || a.holder === 'friend') && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" aria-label={`${n}: account holder's name`} placeholder="Account holder's name" value={a.holderName} onChange={(e) => setA({ holderName: e.target.value })} />
          <input className="input" aria-label={`${n}: relationship`} placeholder="Relationship (e.g. father)" value={a.relationship} onChange={(e) => setA({ relationship: e.target.value })} />
          <input className="input" aria-label={`${n}: consent letter reference`} placeholder="Consent letter ref." value={a.consentRef} onChange={(e) => setA({ consentRef: e.target.value })} />
          <label className="small">
            Signed <input className="input" type="date" aria-label={`${n}: date signed`} value={a.signedOn} onChange={(e) => setA({ signedOn: e.target.value })} />
          </label>
          <input
            className="input"
            aria-label={`${n}: Commissioner for Oaths`}
            placeholder="Pesuruhjaya Sumpah (name)"
            value={a.commissioner}
            onChange={(e) => setA({ commissioner: e.target.value })}
          />
          <input className="input" aria-label={`${n}: stamp number`} placeholder="Stamp no." style={{ width: 120 }} value={a.stampRef} onChange={(e) => setA({ stampRef: e.target.value })} />
          <label className="small">
            Stamped <input className="input" type="date" aria-label={`${n}: date stamped`} value={a.stampedOn} onChange={(e) => setA({ stampedOn: e.target.value })} />
          </label>
          <span className="muted small">The COO approves the letter before the FD can approve the list.</span>
        </div>
      )}
    </div>
  );
}

const toInput = (people: Person[], from: string, to: string) => {
  const all = datesBetween(from, to);
  return people.map((p) => ({ ...p, days: p.days.filter((d) => all.includes(d)), pay: p.pay || undefined, account: p.pay === 'bank' || p.pay === 'ewallet' ? p.account : undefined }));
};

/** A saved person back into the editor (the account's last 4 digits and the consent letter, if any). */
const fromSaved = (p: List['people'][number]): Person => ({
  name: p.name,
  idLast4: p.idLast4,
  work: p.work,
  dailyRate: p.dailyRate,
  days: p.days,
  pay: p.pay ?? '',
  account: p.account
    ? {
        bank: p.account.bank,
        last4: p.account.accountMasked.slice(-4),
        holder: p.account.holder,
        holderName: p.account.holderName ?? '',
        relationship: p.account.relationship ?? '',
        consentRef: p.account.consent?.docRef ?? '',
        signedOn: p.account.consent?.signedOn ?? '',
        commissioner: p.account.consent?.oaths.commissioner ?? '',
        stampRef: p.account.consent?.oaths.stampRef ?? '',
        stampedOn: p.account.consent?.oaths.stampedOn ?? '',
      }
    : NO_ACC,
});

export function DailyCash({ v, co }: { v: FinControls; co: Co }) {
  const d = v.dailyCash;
  const { act, go } = useGo(co.companyId);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ period: 'week', from: '', to: '', bankId: v.statements[0]?.bank.id ?? '', purpose: '' });
  const [people, setPeople] = useState<Person[]>([]);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Daily cash pay</h3>
          <div className="muted small">
            People paid each day. Finance lists them for the week or month; only the Finance Director approves. Each person is paid to a bank account or
            e-wallet, and Finance records each day's transfer. Cash only when the Director Office lists the person and the COO or CEO gives it; only that cash
            is prepared and handed to the COO or CEO, who pays and gives back what was not paid. A relative's or friend's account needs a consent letter
            stamped by a Pesuruhjaya Sumpah and approved by the COO. Cash daily rate up to {rm(d.rules.maxDailyRate)}; settle within {d.rules.settleDays}{' '}
            days of the list ending.
          </div>
        </div>
        {!adding && (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            New list
          </button>
        )}
      </div>
      <FinGuide id="fin.dailycash.list" />
      {adding && (
        <div className="stack fin-gap fin-mb">
          <div className="row">
            <select className="select" aria-label="Week or month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
            <input className="input" type="date" aria-label="First day" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
            <input className="input" type="date" aria-label="Last day" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
            <select className="select" aria-label="Bank account" value={f.bankId} onChange={(e) => setF({ ...f, bankId: e.target.value })}>
              {v.statements.map(({ bank: b }) => (
                <option key={b.id} value={b.id}>
                  {b.bank} {b.accountMasked}
                </option>
              ))}
            </select>
          </div>
          <input
            className="input"
            aria-label="Why they are paid in cash"
            placeholder="Why these people are paid in cash"
            value={f.purpose}
            onChange={(e) => setF({ ...f, purpose: e.target.value })}
          />
          <PeopleEditor from={f.from} to={f.to} people={people} onChange={setPeople} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !f.from || !f.to || !f.purpose.trim() || !people.length}
              onClick={() =>
                go('add', { ...f, bankId: f.bankId || v.statements[0]?.bank.id, people: toInput(people, f.from, f.to) }, 'Listed. Send it to the FD when ready.').then((x) => {
                  if (!x) return;
                  setAdding(false);
                  setPeople([]);
                })
              }
            >
              Save list
            </button>
            <button className="btn btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
      <div className="list">
        {d.lists.length === 0 && <div className="empty">No daily cash lists.</div>}
        {d.lists.map((l) => (
          <ListLine key={l.id} l={l} co={co} v={v} />
        ))}
      </div>
    </section>
  );
}

function ListLine({ l, co, v }: { l: List; co: Co; v: FinControls }) {
  const { act, go } = useGo(co.companyId);
  const [mode, setMode] = useState<string | null>(null);
  const [f, setF] = useState({ comment: '', on: '', amount: 0, ref: '', toId: v.dailyCash.collectors[0]?.id ?? '', counted: 0, depositRef: '', line: '' });
  const [people, setPeople] = useState<Person[]>(() => l.people.map(fromSaved));
  const [tx, setTx] = useState({ personId: '', day: '', ref: '' });
  const transferOnly = l.cashTotal < 0.005 && l.withdrawals.length === 0;
  const live = ['approved', 'with_collector', 'returned'].includes(l.status);
  const [tone, label] = STATUS[l.status];
  const step = (action: string, extra: Record<string, unknown>, msg: string) => go(action, { listId: l.id, ...extra }, msg).then((x) => x && setMode(null));
  const btn = (k: string, text: string) => (
    <button key={k} className="btn btn-sm" aria-pressed={mode === k} onClick={() => setMode(mode === k ? null : k)}>
      {text}
    </button>
  );
  const unmatchedOut = v.statements
    .filter((s) => s.bank.id === l.bankId && s.statement)
    .flatMap((s) =>
      s.lines
        .filter((x) => !x.match && x.amount < 0)
        .map((x) => ({ key: `${s.statement!.id}|${x.id}`, label: `${x.date} ${x.description} ${rm(-x.amount)}`, amount: -x.amount })),
    );
  return (
    <div className="list-item fin-block">
      <div className="row fin-between">
        <div>
          <strong>
            {dateLabel(l.from)} to {dateLabel(l.to)}
          </strong>{' '}
          · {l.people.length} people · {rm(l.total)}
          <div className="muted small">
            {l.purpose}. Listed by {l.prepared.by}
            {l.approved ? `; approved by ${l.approved.by}: ${l.approved.comment}` : ''}
            {l.returnedForChange && l.status === 'draft' ? `; returned by the FD: ${l.returnedForChange.comment}` : ''}
          </div>
          <div className="muted small">
            Paid by transfer {rm(l.transferred)} · cash approved {rm(l.cashTotal)} · withdrawn {rm(l.withdrawn)} · handed over {rm(l.handed)} · paid in cash{' '}
            {rm(l.paid)}
            {l.giveBack ? ` · given back ${rm(l.giveBack.amount)}` : ''}
            {l.settled
              ? ` · counted ${rm(l.settled.counted)}, banked ${l.settled.depositRef}${l.settled.difference ? `, difference ${rm(l.settled.difference)}` : ''}`
              : ''}
          </div>
        </div>
        <div className="row">
          <Chip tone={tone}>{label}</Chip>
          {l.state.lateSettle && <Chip tone="crit">Not settled by {dateLabel(l.state.settleBy)}</Chip>}
          {l.withdrawals.some((w) => !w.statement) && <Chip tone="warn">Withdrawal not yet on the statement</Chip>}
          {l.state.differenceOpen && <Chip tone="crit">Difference for the FD</Chip>}
          {l.state.blocked > 0 && <Chip tone="warn">{l.state.blocked} not ready to approve</Chip>}
          {l.state.transfersDue > 0 && <Chip tone="warn">{l.state.transfersDue} day(s) to pay by transfer</Chip>}
          {l.state.noReceipt > 0 && <Chip tone="warn">{l.state.noReceipt} signed receipt(s) not uploaded</Chip>}
        </div>
      </div>
      {l.log.length > 0 && (
        <details className="small">
          <summary>History ({l.log.length})</summary>
          <ul>
            {l.log.map((x, i) => (
              <li key={i}>
                {x.at.slice(0, 16).replace('T', ' ')} {x.by}: {x.text}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="small" open={l.state.blocked > 0}>
        <summary>People and payments</summary>
        <ul>
          {l.people.map((p) => {
            const paid = l.payouts.filter((x) => x.personId === p.id);
            const check = l.checks[p.id];
            return (
              <li key={p.id}>
                {p.name} (…{p.idLast4}), {p.work}: {rm(p.dailyRate)} a day × {p.days.length} ({p.days.map((d) => d.slice(8)).join(', ')}) = {rm(p.amount)}; paid{' '}
                {paid.length} day(s), {rm(paid.reduce((n, x) => n + x.amount, 0))}
                {paid.some((x) => x.method === 'cash' || !x.method) ? ` (signed receipts ${paid.filter((x) => x.receipt).length} of ${paid.filter((x) => x.method === 'cash' || !x.method).length})` : ''}.{' '}
                {p.pay === 'cash'
                  ? 'Cash'
                  : p.account
                    ? `${p.pay === 'ewallet' ? 'E-wallet' : 'Bank'} ${p.account.bank} ${p.account.accountMasked}${p.account.holder !== 'own' ? ` (${p.account.holder}${p.account.holderName ? `: ${p.account.holderName}` : ''})` : ''}`
                    : ''}
                {check?.problem && (
                  <>
                    {' '}
                    <Chip tone="warn">{check.problem}</Chip>
                  </>
                )}
                {check?.flags.map((f, k) => (
                  <div key={k} className="muted">
                    {f}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </details>
      <div className="row">
        {l.status === 'draft' && btn('edit', l.returnedForChange ? 'Edit (returned by the FD)' : 'Edit')}
        {l.status === 'draft' && btn('submit', 'Send to the FD')}
        {l.status === 'to_approve' && btn('approve', 'Approve (FD)')}
        {l.status === 'to_approve' && btn('return', 'Return (FD)')}
        {live && l.state.transfersDue > 0 && btn('transfer', 'Paid by transfer')}
        {(l.status === 'approved' || l.status === 'with_collector') && l.withdrawn < l.cashTotal && btn('withdraw', 'Cash withdrawn')}
        {(l.status === 'approved' || l.status === 'with_collector') && l.handed < l.withdrawn && btn('handover', 'Hand to COO / CEO')}
        {l.withdrawals.some((w) => !w.statement) && unmatchedOut.length > 0 && btn('bank', 'Found on the statement')}
        {l.status === 'returned' && !l.settled && btn('settle', 'Count and bank')}
        {l.state.toClose && btn('settle', 'Close list')}
        {l.state.differenceOpen && btn('acceptDifference', 'Accept difference (FD)')}
        {['draft', 'to_approve', 'approved'].includes(l.status) && l.withdrawals.length === 0 && l.payouts.length === 0 && btn('cancel', 'Cancel list')}
      </div>
      {mode === 'edit' && (
        <div className="stack fin-gap fin-mt">
          <PeopleEditor from={l.from} to={l.to} people={people} onChange={setPeople} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !people.length}
              onClick={() => step('edit', { people: toInput(people, l.from, l.to) }, 'Changed. Send it to the FD again when ready.')}
            >
              Save changes
            </button>
            <button className="btn btn-sm" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {mode === 'transfer' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <select className="select" aria-label="Person paid" value={tx.personId} onChange={(e) => setTx({ ...tx, personId: e.target.value, day: '' })}>
            <option value="">Person…</option>
            {l.people
              .filter((p) => p.pay === 'bank' || p.pay === 'ewallet')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.account?.bank} {p.account?.accountMasked} · {rm(p.dailyRate)} a day
                </option>
              ))}
          </select>
          <select className="select" aria-label="Day paid for" value={tx.day} onChange={(e) => setTx({ ...tx, day: e.target.value })}>
            <option value="">Day…</option>
            {(l.people.find((p) => p.id === tx.personId)?.days ?? [])
              .filter((d) => !l.payouts.some((x) => x.personId === tx.personId && x.day === d))
              .map((d) => (
                <option key={d} value={d}>
                  {dateLabel(d)}
                </option>
              ))}
          </select>
          <input className="input" aria-label="Transfer reference" placeholder="Transfer reference (IBG, DuitNow…)" value={tx.ref} onChange={(e) => setTx({ ...tx, ref: e.target.value })} />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !tx.personId || !tx.day || !tx.ref.trim()}
            onClick={() => go('transfer', { listId: l.id, ...tx }, 'Transfer recorded.').then((x) => x && setTx({ ...tx, day: '', ref: '' }))}
          >
            Save
          </button>
        </div>
      )}
      {mode && mode !== 'edit' && mode !== 'transfer' && (
        <div className="row fin-mt">
          {(mode === 'withdraw' || mode === 'handover') && (
            <input
              className="input"
              type="number"
              step="0.01"
              aria-label="Amount RM"
              placeholder={`Amount RM (up to ${rm(mode === 'withdraw' ? l.cashTotal - l.withdrawn : l.withdrawn - l.handed)})`}
              value={f.amount || ''}
              onChange={(e) => setF({ ...f, amount: Number(e.target.value) || 0 })}
            />
          )}
          {mode === 'withdraw' && (
            <>
              <input className="input" type="date" aria-label="Date withdrawn" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
              <input
                className="input"
                aria-label="Cheque or reference"
                placeholder="Cheque or reference"
                value={f.ref}
                onChange={(e) => setF({ ...f, ref: e.target.value })}
              />
            </>
          )}
          {mode === 'handover' && (
            <select className="select" aria-label="Handed to" value={f.toId} onChange={(e) => setF({ ...f, toId: e.target.value })}>
              {v.dailyCash.collectors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {mode === 'bank' && (
            <select className="select" aria-label="Bank line" value={f.line} onChange={(e) => setF({ ...f, line: e.target.value })}>
              <option value="">Choose the bank line…</option>
              {unmatchedOut.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
          )}
          {mode === 'settle' && !transferOnly && (
            <>
              <input
                className="input"
                type="number"
                step="0.01"
                aria-label="Cash counted RM"
                placeholder={`Cash counted RM (given back ${rm(l.giveBack?.amount)})`}
                value={f.counted || ''}
                onChange={(e) => setF({ ...f, counted: Number(e.target.value) || 0 })}
              />
              <input
                className="input"
                aria-label="Deposit reference"
                placeholder="Bank deposit reference"
                value={f.depositRef}
                onChange={(e) => setF({ ...f, depositRef: e.target.value })}
              />
            </>
          )}
          {['approve', 'return', 'cancel', 'settle', 'acceptDifference', 'handover'].includes(mode) && (
            <input
              className="input"
              aria-label={mode === 'settle' ? 'Reason for any difference' : 'Comment'}
              placeholder={
                mode === 'settle' && transferOnly
                  ? `Reason if not all of ${rm(l.total)} was transferred`
                  : mode === 'settle'
                  ? `Reason if it is not ${rm(Math.round((l.withdrawn - l.paid) * 100) / 100)} (withdrawn less paid)`
                  : mode === 'return' || mode === 'cancel'
                    ? 'Reason'
                    : 'Comment'
              }
              value={f.comment}
              onChange={(e) => setF({ ...f, comment: e.target.value })}
            />
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={() => {
              if (mode === 'submit') return step('submit', {}, 'Sent to the Finance Director.');
              if (mode === 'approve') return step('approve', { comment: f.comment }, 'Approved. Finance prepares the cash.');
              if (mode === 'return') return step('return', { comment: f.comment }, 'Returned to Finance.');
              if (mode === 'cancel') return step('cancel', { comment: f.comment }, 'Cancelled.');
              if (mode === 'withdraw') return step('withdraw', { on: f.on, amount: f.amount, ref: f.ref }, 'Cash recorded.');
              if (mode === 'handover') return step('handover', { toId: f.toId, amount: f.amount, comment: f.comment }, 'Handed over; they count and confirm.');
              if (mode === 'bank') {
                const [statementId, lineId] = f.line.split('|');
                const w = l.withdrawals.find((x) => !x.statement && Math.abs(x.amount - (unmatchedOut.find((u) => u.key === f.line)?.amount ?? -1)) < 0.005);
                return step('bank', { withdrawalId: w?.id, statementId, lineId }, 'Found on the statement.');
              }
              if (mode === 'settle' && transferOnly) return step('settle', { comment: f.comment }, 'Closed.');
              if (mode === 'settle') return step('settle', { counted: f.counted, depositRef: f.depositRef, comment: f.comment }, 'Settled.');
              if (mode === 'acceptDifference') return step('acceptDifference', { comment: f.comment }, 'Difference accepted.');
            }}
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** The COO's or CEO's own daily cash: count what Finance handed over, pay each listed person, give back the rest. */
export function MyDailyCash() {
  const { data, error, reload } = useLoad(() => api.finDailyCashMine(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data || (data.lists.length === 0 && data.decisions.length === 0 && data.receipts.length === 0)) return null;
  return (
    <>
      {data.decisions.length > 0 && <DailyPayDecisions decisions={data.decisions} reload={reload} />}
      {data.receipts.length > 0 && <ReceiptUploads receipts={data.receipts} reload={reload} />}
      {data.lists.length > 0 && <HeldCash lists={data.lists} />}
    </>
  );
}

type Decision = Awaited<ReturnType<typeof api.finDailyCashMine>>['decisions'][number];
type ReceiptDue = Awaited<ReturnType<typeof api.finDailyCashMine>>['receipts'][number];

/**
 * The Director Office uploads the signed receipt for each cash payment (Fauzan, 6 Nov 2026: "Signed paper of the
 * receive collected and upload as proof. Upload done by director office.").
 */
function ReceiptUploads({ receipts, reload }: { receipts: ReceiptDue[]; reload: () => void }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Signed cash receipts to upload</h3>
          <div className="muted small">
            The COO or CEO paid these people in cash. Collect each signed receipt and upload a scan or photo (PDF, JPEG or PNG). Finance cannot settle the list
            until every receipt is in.
          </div>
        </div>
        <span className="muted small">{receipts.length}</span>
      </div>
      <div className="list">
        {receipts.map((r) => (
          <ReceiptLine key={`${r.listId}-${r.payoutId}`} r={r} reload={reload} />
        ))}
      </div>
    </section>
  );
}

function ReceiptLine({ r, reload }: { r: ReceiptDue; reload: () => void }) {
  const { act, go } = useGo(r.companyId);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (f: File | undefined) => {
    setErr(null);
    if (!f) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)) return setErr('Attach a PDF, JPEG or PNG file.');
    let data = await readAsDataUrl(f);
    if (f.type !== 'application/pdf') data = await shrinkImage(data);
    const x = await go('receipt', { listId: r.listId, payoutId: r.payoutId, name: f.name, data }, 'Signed receipt uploaded.');
    if (x) reload();
  };
  return (
    <div className="list-item" style={{ display: 'block' }}>
      <div>
        <strong>{r.name}</strong> (…{r.idLast4}) · {r.site} · {dateLabel(r.day)} · {rm(r.amount)}
        <div className="muted small">
          {r.companyId} · paid in cash by {r.paidBy}
        </div>
      </div>
      <label className="btn btn-sm" style={{ marginTop: 6 }}>
        Upload signed receipt
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          aria-label={`Signed receipt for ${r.name} ${r.day}`}
          style={{ display: 'none' }}
          disabled={act.busy}
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </label>
      {err && <p className="notice" data-tone="crit">{err}</p>}
      <ErrorNotice error={act.error} />
    </div>
  );
}

/**
 * Daily pay waiting for you (Fauzan, 6 Nov 2026): the Director Office lists people for cash with the reason; the COO
 * or CEO gives or refuses it; the COO approves a consent letter stamped by a Commissioner for Oaths.
 */
function DailyPayDecisions({ decisions, reload }: { decisions: Decision[]; reload: () => void }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Daily pay waiting for you</h3>
          <div className="muted small">
            Daily workers are paid to a bank account or e-wallet. Cash only when the Director Office lists the person with the reason and the COO or CEO gives
            it. A relative's or friend's account needs the consent letter stamped by a Pesuruhjaya Sumpah, approved by the COO.
          </div>
        </div>
      </div>
      <div className="list">
        {decisions.flatMap((l) => l.people.map((p) => <DecisionLine key={`${l.id}-${p.id}`} l={l} p={p} reload={reload} />))}
      </div>
    </section>
  );
}

function DecisionLine({ l, p, reload }: { l: Decision; p: Decision['people'][number]; reload: () => void }) {
  const { act, go } = useGo(l.companyId);
  const [note, setNote] = useState('');
  const [site, setSite] = useState(p.work);
  const [amount, setAmount] = useState(p.amount);
  const run = (action: string, extra: Record<string, unknown>, msg: string) =>
    go(action, { listId: l.id, personId: p.id, ...extra }, msg).then((x) => {
      if (x) {
        setNote('');
        reload();
      }
    });
  const c = p.account?.consent;
  return (
    <div className="list-item" style={{ display: 'block' }}>
      <div>
        <strong>{p.name}</strong> (…{p.idLast4}), {p.work}: {rm(p.dailyRate)} a day × {p.days} = {rm(p.amount)}
        <div className="muted small">
          {l.companyId} · {dateLabel(l.from)} to {dateLabel(l.to)} · {l.purpose}
        </div>
        {p.need === 'list' && p.cash?.decision && (
          <div className="muted small">
            Refused by {p.cash.decision.by}: {p.cash.decision.comment}
          </div>
        )}
        {p.cash && (p.need === 'decide' || p.listedByMe) && (
          <div className="muted small">
            Listed for cash by {p.cash.listed.by}
            {p.cash.site ? ` at ${p.cash.site}` : ''}
            {p.cash.amount != null ? `, ${rm(p.cash.amount)}` : ''}: {p.cash.reason}
          </div>
        )}
        {p.need === 'consent' && c && p.account && (
          <div className="muted small">
            To {p.account.bank} {p.account.accountMasked}, held by {p.account.holderName} ({p.account.relationship}). Consent letter {c.docRef} signed{' '}
            {dateLabel(c.signedOn)}, stamped by Pesuruhjaya Sumpah {c.oaths.commissioner} (stamp {c.oaths.stampRef}, {dateLabel(c.oaths.stampedOn)}); recorded by{' '}
            {c.recorded.by}. Check the stamp on the letter before approving.
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {p.need && (
          <input
            className="input"
            aria-label={p.need === 'list' ? 'Why cash is needed' : 'Comment'}
            placeholder={p.need === 'list' ? 'Why this person needs cash' : 'Comment (needed)'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
        {p.need === 'list' && (
          <>
            <input className="input" aria-label="Site" placeholder="Site" value={site} onChange={(e) => setSite(e.target.value)} />
            <input
              className="input"
              type="number"
              step="0.01"
              aria-label="Cash amount RM"
              placeholder={`Cash RM (up to ${rm(p.amount)})`}
              style={{ width: 150 }}
              value={amount || ''}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
            />
          </>
        )}
        {p.need === 'list' && (
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || note.trim().length < 5 || site.trim().length < 2 || !amount}
            onClick={() => run('listCash', { reason: note, site, amount }, 'Listed for cash.')}
          >
            List for cash
          </button>
        )}
        {p.need === 'decide' && (
          <>
            <button className="btn btn-primary btn-sm" disabled={act.busy || !note.trim()} onClick={() => run('decideCash', { give: true, comment: note }, 'Cash given.')}>
              Give cash
            </button>
            <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => run('decideCash', { give: false, comment: note }, 'Refused: Finance gives a bank account or e-wallet.')}>
              Refuse
            </button>
          </>
        )}
        {p.need === 'consent' && (
          <button className="btn btn-primary btn-sm" disabled={act.busy || !note.trim()} onClick={() => run('approveConsent', { comment: note }, 'Consent letter approved.')}>
            Approve letter
          </button>
        )}
        {p.listedByMe && (
          <button className="btn btn-sm" disabled={act.busy} onClick={() => run('unlistCash', {}, 'Taken off the cash list.')}>
            Take off the cash list
          </button>
        )}
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function HeldCash({ lists }: { lists: Mine[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Daily cash you hold</h3>
          <div className="muted small">
            Count the cash Finance gives you, pay each listed person for each listed day after checking the last 4 characters of their IC or passport, have
            them sign the receipt and pass it to the Director Office, who uploads it, and give back what was not paid when the list ends.
          </div>
        </div>
      </div>
      <FinGuide id="fin.dailycash.collector" />
      <div className="list">
        {lists.map((l) => (
          <MineLine key={l.id} l={l} />
        ))}
      </div>
    </section>
  );
}

function MineLine({ l }: { l: Mine }) {
  const { act, go } = useGo(l.companyId);
  const [counted, setCounted] = useState<Record<string, number>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [pay, setPay] = useState<{ personId: string; day: string; idLast4: string; proof: string }>({
    personId: l.people.find((p) => p.pay === 'cash' && p.cash?.decision?.give)?.id ?? '',
    day: '',
    idLast4: '',
    proof: '',
  });
  const [back, setBack] = useState({ amount: 0, comment: '' });
  const person = l.people.find((p) => p.id === pay.personId);
  const unpaidDays = person ? person.days.filter((d) => !l.payouts.some((x) => x.personId === person.id && x.day === d)) : [];
  return (
    <div className="list-item fin-block">
      <div>
        <strong>
          {dateLabel(l.from)} to {dateLabel(l.to)}
        </strong>{' '}
        · {l.people.length} people · approved {rm(l.total)} · you hold {rm(l.held)} · paid {rm(l.paid)}
      </div>
      {l.handovers
        .filter((h) => l.toConfirm.includes(h.id))
        .map((h) => (
          <div key={h.id} className="row fin-mt">
            <span>
              Finance handed you {rm(h.amount)} on {dateLabel(h.on)}. Count it:
            </span>
            <input
              className="input"
              type="number"
              step="0.01"
              aria-label="Cash counted RM"
              value={counted[h.id] ?? ''}
              onChange={(e) => setCounted({ ...counted, [h.id]: Number(e.target.value) || 0 })}
            />
            {counted[h.id] != null && Math.abs((counted[h.id] ?? 0) - h.amount) >= 0.005 && (
              <input
                className="input"
                aria-label="Why the count differs"
                placeholder={`Why you counted ${rm(counted[h.id])}, not ${rm(h.amount)}`}
                value={why[h.id] ?? ''}
                onChange={(e) => setWhy({ ...why, [h.id]: e.target.value })}
              />
            )}
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || counted[h.id] == null || (Math.abs((counted[h.id] ?? 0) - h.amount) >= 0.005 && (why[h.id] ?? '').trim().length < 5)}
              onClick={() => go('received', { listId: l.id, handoverId: h.id, counted: counted[h.id] ?? 0, comment: why[h.id] }, 'Confirmed.')}
            >
              Confirm count
            </button>
          </div>
        ))}
      {l.status === 'with_collector' && (
        <div className="row fin-mt">
          <select className="select" aria-label="Person" value={pay.personId} onChange={(e) => setPay({ ...pay, personId: e.target.value, day: '' })}>
            {l.people.filter((p) => p.pay === 'cash' && p.cash?.decision?.give).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {rm(p.dailyRate)} a day{l.dueToday.includes(p.id) ? ' · due today' : ''}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Day" value={pay.day} onChange={(e) => setPay({ ...pay, day: e.target.value })}>
            <option value="">Day…</option>
            {unpaidDays.map((d) => (
              <option key={d} value={d}>
                {dateLabel(d)}
              </option>
            ))}
          </select>
          <input
            className="input"
            aria-label="Last 4 of IC or passport"
            placeholder="Last 4 of IC / passport"
            value={pay.idLast4}
            onChange={(e) => setPay({ ...pay, idLast4: e.target.value })}
          />
          <input
            className="input"
            aria-label="Pay sheet"
            placeholder="Pay sheet no. (optional; the Director Office uploads the signed receipt)"
            value={pay.proof}
            onChange={(e) => setPay({ ...pay, proof: e.target.value })}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !pay.day || !pay.idLast4.trim()}
            onClick={() =>
              go('pay', { listId: l.id, ...pay }, `Paid ${person?.name ?? ''}.`).then((x) => x && setPay({ ...pay, day: '', idLast4: '', proof: '' }))
            }
          >
            Paid {person ? rm(person.dailyRate) : ''}
          </button>
        </div>
      )}
      {l.status === 'with_collector' && l.gaveBack && (
        <p className="muted small">You have given back your cash on this list; Finance settles it once the other holder gives back theirs.</p>
      )}
      {l.status === 'with_collector' && !l.gaveBack && (
        <div className="row fin-mt">
          <span className="muted small">
            {l.giveBackDue ? 'The list has ended: give back the unpaid cash.' : 'Give back unpaid cash (at the end, or earlier):'}
          </span>
          <input
            className="input"
            type="number"
            step="0.01"
            aria-label="Cash given back RM"
            placeholder={`Unpaid ${rm(l.held)}`}
            value={back.amount || ''}
            onChange={(e) => setBack({ ...back, amount: Number(e.target.value) || 0 })}
          />
          {Math.abs(back.amount - l.held) >= 0.005 && (
            <input
              className="input"
              aria-label="Why it differs"
              placeholder="Why it differs from the unpaid amount"
              value={back.comment}
              onChange={(e) => setBack({ ...back, comment: e.target.value })}
            />
          )}
          <button className="btn btn-sm" disabled={act.busy} onClick={() => go('giveBack', { listId: l.id, ...back }, 'Given back to Finance.')}>
            Give back
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
