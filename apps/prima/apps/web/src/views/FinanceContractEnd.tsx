import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type FinControls } from '../api';
import { Chip, ErrorNotice, dateLabel, useAction } from '../ui';
import { DataTable } from '../DataTable';

/**
 * Contract ends and money held by clients (Fauzan, 2 Nov 2026: suggestions 3 and 24, automation A11). When a contract
 * ends or is terminated, billing stops and Prima lists the follow-ups: the final invoice, deposits and retention to
 * claim back, IG/BG to release and the stamp duty refund for an agreement cancelled before it started.
 */

const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Dep = FinControls['contractEnd']['deposits'][number];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ContractEnds({ v }: { v: FinControls }) {
  const ce = v.contractEnd;
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpened((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // A contract with steps still to do shows them at once, as the old list did; a finished one opens on "Open".
  const shown = (e: (typeof ce.ends)[number]) => opened.has(e.contract.id) !== e.open > 0;
  if (!ce.ends.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Contracts that ended</h3>
      </div>
      <p className="muted small fin-intro">
        Billing stops on the day a contract ends or is terminated. Prima lists what follows; each line ticks itself when it is done elsewhere (invoice recorded,
        money seen on the bank statement, guarantee closed).
      </p>
      {/* P107: the ended contracts as a table; "Open" shows the follow-up steps under the row. */}
      <DataTable
        label="Contracts that ended"
        stateKey="fin.contract-ends"
        rows={ce.ends}
        rowKey={(e) => e.contract.id}
        searchText={(e) => e.steps.map((s) => s.text).join(' ')}
        columns={[
          { id: 'client', label: 'Client', value: (e) => e.contract.client, phone: 'title', render: (e) => <span className="fin-strong">{e.contract.client}</span> },
          { id: 'contract', label: 'Contract', value: (e) => e.contract.ref, phone: 'sub' },
          {
            id: 'ended',
            label: 'Ended',
            value: (e) => e.contract.endOn,
            sort: 'date',
            render: (e) => (
              <>
                {e.contract.terminated ? 'terminated' : 'ended'} {dateLabel(e.contract.endOn)}
              </>
            ),
          },
          {
            id: 'status',
            label: 'Status',
            value: (e) => endState(e),
            translate: true,
            render: (e) => <Chip tone={e.late ? 'crit' : e.open ? 'warn' : 'ok'}>{e.open ? `${e.open} to do${e.late ? `, ${e.late} late` : ''}` : 'All done'}</Chip>,
          },
        ]}
        filters={[{ id: 'status', label: 'Status', value: (e) => endState(e), options: END_STATES.map((s) => ({ value: s, label: s })) }]}
        rowEnd={(e) => (
          <button className="btn btn-sm" onClick={() => toggle(e.contract.id)}>
            {shown(e) ? 'Close' : 'Open'}
          </button>
        )}
        rowDetail={(e) =>
          shown(e) ? (
            <ul className="small fin-ul">
              {e.steps.map((s, i) => (
                <li key={i}>
                  {s.done ? '✓ ' : ''}
                  {s.text}
                  {!s.done && s.by && <span className="muted"> · by {dateLabel(s.by)}</span>}
                </li>
              ))}
              {!e.steps.length && <li className="muted">Nothing held by the client and no guarantee linked to this contract.</li>}
            </ul>
          ) : null
        }
      />
    </section>
  );
}

const END_STATES = ['Late', 'To do', 'All done'] as const;
const endState = (e: FinControls['contractEnd']['ends'][number]) => (e.late ? 'Late' : e.open ? 'To do' : 'All done');

const STATUS: Record<Dep['status'], [Parameters<typeof Chip>[0]['tone'], string]> = {
  pending: ['warn', 'To check'],
  held: ['info', 'Held by client'],
  claimed: ['warn', 'Claimed back'],
  refunded: ['ok', 'Paid back'],
  written_off: ['neutral', 'Written off'],
};

export function ClientDeposits({ v }: { v: FinControls }) {
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ kind: 'deposit' });
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = (action: string, input: Record<string, unknown>, msg: string) => act.run(() => api.finControlAction(v.companyId, 'deposits', action, input), msg);
  const ce = v.contractEnd;
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Deposits and retention held by clients</h3>
        <button className="btn btn-sm" onClick={() => setAdding(!adding)}>
          {adding ? 'Close' : 'Add'}
        </button>
      </div>
      <p className="muted small fin-intro">
        Money a client keeps until the contract ends. A second person checks each one. Claim it back when the contract ends; Prima finds the payment on the bank
        statement.
      </p>
      <ErrorNotice error={act.error} />
      {adding && (
        <div className="fin-pad">
          <Field label="Type">
            <select className="select" value={f.kind} onChange={set('kind')}>
              <option value="deposit">Deposit</option>
              <option value="retention">Retention</option>
            </select>
          </Field>
          <Field label="Contract (fills the client)">
            <Select className="select" value={f.contractId ?? ''} onChange={set('contractId')}>
              <option value="">Not linked: type the client</option>
              {ce.contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.client} · {c.ref}
                </option>
              ))}
            </Select>
          </Field>
          {!f.contractId && (
            <Field label="Client">
              <input className="input" value={f.client ?? ''} onChange={set('client')} />
            </Field>
          )}
          <Field label="Amount held (RM)">
            <input className="input" inputMode="decimal" value={f.amount ?? ''} onChange={set('amount')} />
          </Field>
          <Field label="Held since">
            <input className="input" type="date" value={f.heldSince ?? ''} onChange={set('heldSince')} />
          </Field>
          <Field label="Due back on (if the contract says; otherwise worked out from its end)">
            <input className="input" type="date" value={f.dueBackOn ?? ''} onChange={set('dueBackOn')} />
          </Field>
          <Field label="Where it is written (contract clause or receipt)">
            <input className="input" value={f.doc ?? ''} onChange={set('doc')} />
          </Field>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              if (await go('add', { ...f, amount: Number(f.amount), dueBackOn: f.dueBackOn || undefined }, 'Added. Someone else checks it next.')) {
                setAdding(false);
                setF({ kind: 'deposit' });
              }
            }}
          >
            Save
          </button>
        </div>
      )}
      {/* P107: the deposits as a table; "Act" opens the same steps under the row. */}
      <DataTable
        label="Deposits and retention held by clients"
        stateKey="fin.client-deposits"
        rows={ce.deposits}
        rowKey={(d) => d.id}
        columns={[
          { id: 'client', label: 'Client', value: (d) => d.client, phone: 'title' },
          { id: 'kind', label: 'Type', value: depKind, translate: true, phone: 'sub' },
          { id: 'contract', label: 'Contract', value: (d) => d.contractRef ?? '' },
          { id: 'amount', label: 'Amount', value: (d) => d.amount, sort: 'money', render: (d) => rm(d.amount) },
          {
            id: 'dueBack',
            label: 'Due back',
            value: (d) => (d.status !== 'refunded' && d.status !== 'written_off' ? d.dueBack : null),
            sort: 'date',
          },
          { id: 'paidBack', label: 'Paid back', value: (d) => d.refund?.date ?? null, sort: 'date', hideBelow: 1100 },
          { id: 'status', label: 'Status', value: (d) => STATUS[d.status][1], translate: true, render: (d) => <Chip tone={STATUS[d.status][0]}>{STATUS[d.status][1]}</Chip> },
        ]}
        filters={[
          { id: 'kind', label: 'Type', value: depKind },
          { id: 'status', label: 'Status', value: (d) => STATUS[d.status][1] },
        ]}
        rowEnd={(d) =>
          ['pending', 'held', 'claimed'].includes(d.status) ? (
            <button className="btn btn-sm" onClick={() => setOpenIds((x) => ({ ...x, [d.id]: !x[d.id] }))}>
              {openIds[d.id] ? 'Close' : 'Act'}
            </button>
          ) : null
        }
        rowDetail={(d) => (openIds[d.id] ? <DepositLine d={d} go={go} busy={act.busy} /> : null)}
        empty={<div className="list-item muted">None recorded.</div>}
      />
    </section>
  );
}

const depKind = (d: Dep) => (d.kind === 'deposit' ? 'Deposit' : 'Retention');

/** The steps for one deposit (check, claim back, write off), under its row once "Act" is pressed. */
function DepositLine({ d, go, busy }: { d: Dep; go: (action: string, input: Record<string, unknown>, msg: string) => Promise<unknown>; busy: boolean }) {
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="fin-block">
      {(
        <div className="fin-pt">
          {d.status === 'pending' && (
            <>
              <Field label="What you checked it against">
                <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
              </Field>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => go('check', { depositId: d.id, comment: f.comment }, 'Checked.')}>
                Checked
              </button>
            </>
          )}
          {d.status === 'held' && (
            <>
              <Field label="Claim letter reference">
                <input className="input" value={f.ref ?? ''} onChange={set('ref')} />
              </Field>
              <Field label="Documents sent (claim letter, client's release), one per line">
                <textarea className="textarea" rows={2} value={f.docs ?? ''} onChange={set('docs')} />
              </Field>
              <Field label="Why now (only if the contract has not ended)">
                <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
              </Field>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => go('claim', { depositId: d.id, ref: f.ref, docs: f.docs, comment: f.comment || undefined }, 'Claim recorded.')}
              >
                Record the claim
              </button>
            </>
          )}
          {(d.status === 'held' || d.status === 'claimed') && (
            <div className="fin-mt">
              <Field label="Write off (Finance Director or CEO): reason">
                <input className="input" value={f.why ?? ''} onChange={set('why')} />
              </Field>
              <button className="btn btn-sm" disabled={busy || !f.why} onClick={() => go('writeOff', { depositId: d.id, comment: f.why }, 'Written off.')}>
                Write off
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
