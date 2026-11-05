import { useState } from 'react';
import { FinGuide } from './FinGuide';
import { api, type FinControls, type FinDesk } from '../api';
import { Chip, ErrorNotice, dateLabel, useAction, useLoad, type Tone } from '../ui';

/**
 * Daily cash pay (Fauzan, 2 Nov 2026): Finance lists the people paid in cash for the week or month; only the Finance
 * Director approves; Finance then prepares the cash and hands it to the COO or CEO, who pays each listed person and
 * gives back what was not paid; Finance counts and banks it.
 */

type Co = FinDesk['companies'][number];
type DC = FinControls['dailyCash'];
type List = DC['lists'][number];
type Mine = Awaited<ReturnType<typeof api.finDailyCashMine>>['lists'][number];
const rm = (n: number | null | undefined) => (n == null ? '–' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const STATUS: Record<List['status'], [Tone, string]> = {
  draft: ['neutral', 'Being listed'],
  to_approve: ['warn', 'With the FD'],
  approved: ['info', 'Approved: prepare the cash'],
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

type Person = { name: string; idLast4: string; work: string; dailyRate: number; days: string[] };

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
      return { name: name ?? '', idLast4: idLast4 ?? '', work: work ?? '', dailyRate: Number(rate) || 0, days };
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
          onClick={() => onChange([...people, { name: '', idLast4: '', work: '', dailyRate: 0, days: all }])}
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

const toInput = (people: Person[], from: string, to: string) => {
  const all = datesBetween(from, to);
  return people.map((p) => ({ ...p, days: p.days.filter((d) => all.includes(d)) }));
};

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
            People who are paid in cash each day. Finance lists them for the week or month; only the Finance Director approves; then Finance prepares the cash
            (up to the approved total) and hands it to the COO or CEO, who pays each person and gives back what was not paid. Daily rate up to{' '}
            {rm(d.rules.maxDailyRate)}; settle within {d.rules.settleDays} days of the list ending.
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
  const [people, setPeople] = useState<Person[]>(() =>
    l.people.map((p) => ({ name: p.name, idLast4: p.idLast4, work: p.work, dailyRate: p.dailyRate, days: p.days })),
  );
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
            Withdrawn {rm(l.withdrawn)} · handed over {rm(l.handed)} · paid {rm(l.paid)}
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
      <details className="small">
        <summary>People and payments</summary>
        <ul>
          {l.people.map((p) => {
            const paid = l.payouts.filter((x) => x.personId === p.id);
            return (
              <li key={p.id}>
                {p.name} (…{p.idLast4}), {p.work}: {rm(p.dailyRate)} a day × {p.days.length} ({p.days.map((d) => d.slice(8)).join(', ')}) = {rm(p.amount)}; paid{' '}
                {paid.length} day(s), {rm(paid.reduce((n, x) => n + x.amount, 0))}
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
        {(l.status === 'approved' || l.status === 'with_collector') && l.withdrawn < l.total && btn('withdraw', 'Cash withdrawn')}
        {(l.status === 'approved' || l.status === 'with_collector') && l.handed < l.withdrawn && btn('handover', 'Hand to COO / CEO')}
        {l.withdrawals.some((w) => !w.statement) && unmatchedOut.length > 0 && btn('bank', 'Found on the statement')}
        {l.status === 'returned' && !l.settled && btn('settle', 'Count and bank')}
        {l.state.differenceOpen && btn('acceptDifference', 'Accept difference (FD)')}
        {['draft', 'to_approve', 'approved'].includes(l.status) && l.withdrawals.length === 0 && btn('cancel', 'Cancel list')}
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
      {mode && mode !== 'edit' && (
        <div className="row fin-mt">
          {(mode === 'withdraw' || mode === 'handover') && (
            <input
              className="input"
              type="number"
              step="0.01"
              aria-label="Amount RM"
              placeholder={`Amount RM (up to ${rm(mode === 'withdraw' ? l.total - l.withdrawn : l.withdrawn - l.handed)})`}
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
          {mode === 'settle' && (
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
                mode === 'settle'
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
  const { data, error } = useLoad(() => api.finDailyCashMine(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data || data.lists.length === 0) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Daily cash you hold</h3>
          <div className="muted small">
            Count the cash Finance gives you, pay each listed person for each listed day after checking the last 4 characters of their IC or passport, keep the
            signed or thumb-printed pay sheet, and give back what was not paid when the list ends.
          </div>
        </div>
      </div>
      <FinGuide id="fin.dailycash.collector" />
      <div className="list">
        {data.lists.map((l) => (
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
    personId: l.people[0]?.id ?? '',
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
            {l.people.map((p) => (
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
            placeholder="Pay sheet no. or photo name"
            value={pay.proof}
            onChange={(e) => setPay({ ...pay, proof: e.target.value })}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !pay.day || !pay.idLast4.trim() || !pay.proof.trim()}
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
