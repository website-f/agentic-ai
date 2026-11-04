import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type ClientBoard } from '../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';

/**
 * Client board (Fauzan, 26 Oct 2026). Operations Managers, the Operations Director and officers act on clients:
 * onboarding and offboarding, visits, the monthly report, satisfaction. The COO monitors every company and holds a
 * monthly operations meeting with each; the company manager monitors their own clients and records billing.
 */

type Account = ClientBoard['accounts'][number];

const TONE_LABEL: Record<Account['tone'], string> = { crit: 'Needs attention', warn: 'Follow up', unknown: 'Unknown', ok: 'In order' };
const STAGE_LABEL: Record<Account['stage'], string> = { onboarding: 'Onboarding', active: 'Active', offboarding: 'Offboarding', ended: 'Ended' };
const MEETING: Record<ClientBoard['opsMeetings'][number]['state'], [Tone, string]> = {
  held: ['ok', 'Held, minutes filed'],
  scheduled: ['warn', 'Scheduled'],
  none: ['crit', 'Not scheduled'],
};

export function ClientsView() {
  const { data, error } = useLoad(() => api.clientBoard(), []);
  const [filter, setFilter] = useState<'attention' | 'onboarding' | 'offboarding' | 'all'>('attention');
  const [company, setCompany] = useState('');
  const [adding, setAdding] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="clients" />;
  const act = data.role === 'act';
  const rows = data.accounts.filter(
    (a) =>
      (!company || a.companyId === company) &&
      (filter === 'all' ||
        (filter === 'attention' && (a.tone === 'crit' || a.tone === 'warn')) ||
        (filter === 'onboarding' && a.stage === 'onboarding') ||
        (filter === 'offboarding' && a.stage === 'offboarding')),
  );
  const crit = data.accounts.filter((a) => a.tone === 'crit').length;
  const unknown = data.accounts.filter((a) => a.tone === 'unknown').length;
  return (
    <div className="page">
      {adding && <NewClientForm options={data.canAdd} onDone={() => setAdding(false)} />}
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <p className="muted">
            Operations Managers, the Operations Director and officers look after each client. The COO monitors every company; each company manager monitors
            their own. Unknown is never shown as fine.
          </p>
        </div>
        {data.canAdd.length > 0 && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            New client
          </button>
        )}
      </div>
      <div className="kpis">
        <Kpi label="Clients" value={data.accounts.length} />
        <Kpi label="Need attention" value={crit} tone={crit ? 'crit' : 'ok'} />
        <Kpi label="Unknown" value={unknown} tone={unknown ? 'unknown' : 'ok'} note="Never visited, rated or billed on record" />
        <Kpi
          label="Onboarding / offboarding"
          value={`${data.accounts.filter((a) => a.stage === 'onboarding').length} / ${data.accounts.filter((a) => a.stage === 'offboarding').length}`}
        />
      </div>
      {data.opsMeetings.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Monthly operations meetings</h3>
              <div className="muted small">The COO meets each company's operations every month. Schedule and file the minutes in Meetings.</div>
            </div>
          </div>
          <div className="list">
            {data.opsMeetings.map((m) => (
              <div key={m.companyId} className="list-item">
                <div>{m.companyName}</div>
                <Chip tone={MEETING[m.state][0]}>{MEETING[m.state][1]}</Chip>
              </div>
            ))}
          </div>
        </section>
      )}
      {data.byCompany.length > 1 && (
        <section className="panel">
          <div className="panel-head">
            <h3>By company</h3>
          </div>
          <div className="list">
            {data.byCompany.map((c) => (
              <button
                key={c.companyId}
                className="list-item"
                style={{ background: 'none', border: 0, width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer' }}
                onClick={() => setCompany(company === c.companyId ? '' : c.companyId)}
                aria-pressed={company === c.companyId}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{c.companyName}</div>
                  <div className="muted small">
                    {c.clients} clients · satisfaction {c.avgScore ?? 'unknown'} of 5 · {c.onboarding} onboarding · {c.offboarding} offboarding
                  </div>
                </div>
                {c.crit ? <Chip tone="crit">{c.crit} need attention</Chip> : <Chip tone="ok">No urgent issue</Chip>}
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="tabbar" role="tablist" aria-label="Client filter">
        {(
          [
            ['attention', 'Needs attention'],
            ['onboarding', 'Onboarding'],
            ['offboarding', 'Offboarding'],
            ['all', 'All'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="list">
          {rows.length === 0 && <div className="empty">Nothing here.</div>}
          {rows.slice(0, 60).map((a) => (
            <ClientLine key={a.id} a={a} act={act && a.canAct} canBill={a.canBill} />
          ))}
          {rows.length > 60 && <div className="muted small">Showing 60 of {rows.length}. Pick a company above to narrow the list.</div>}
        </div>
      </section>
    </div>
  );
}

function ClientLine({ a, act, canBill }: { a: Account; act: boolean; canBill: boolean }) {
  const [open, setOpen] = useState(false);
  const tone: Tone = a.tone;
  const rating = [...a.ratings].sort((x, y) => x.at.localeCompare(y.at)).at(-1);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{a.name}</div>
          <div className="muted small">
            {a.companyName} · {STAGE_LABEL[a.stage]} · satisfaction {rating ? `${rating.score} of 5` : 'unknown'}
            {a.contractEndsOn ? ` · contract to ${dateLabel(a.contractEndsOn)}` : ''}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Chip tone={tone}>{TONE_LABEL[a.tone]}</Chip>
          <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : act ? 'Act' : 'Details'}
          </button>
        </div>
      </div>
      {a.issues.length > 0 && <div className="small">{a.issues.map((i) => i.what).join(' · ')}</div>}
      {open && <ClientDetail a={a} act={act} canBill={canBill} />}
    </div>
  );
}

function ClientDetail({ a, act, canBill }: { a: Account; act: boolean; canBill: boolean }) {
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [score, setScore] = useState(0);
  const [kind, setKind] = useState<'visit' | 'meeting' | 'call'>('visit');
  const prev = new Date(Date.now() + 8 * 3_600_000);
  prev.setUTCDate(0);
  const [period, setPeriod] = useState(prev.toISOString().slice(0, 7));
  const [bill, setBill] = useState({
    invoicedTo: a.billing?.invoicedTo ?? '',
    overdueAmount: a.billing?.overdueAmount ?? 0,
    overdueDays: a.billing?.overdueDays ?? 0,
  });
  const action = useAction();
  const clear = (r: unknown) => {
    if (r) {
      setNote('');
      setProof([]);
    }
  };
  const phases: ['onboarding' | 'offboarding', Account['onboarding']][] = [['onboarding', a.onboarding]];
  if (a.offboarding) phases.push(['offboarding', a.offboarding]);
  return (
    <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {phases.map(([phase, steps]) => (
        <div key={phase}>
          <div style={{ fontWeight: 600 }}>{phase === 'onboarding' ? 'Onboarding' : `Offboarding${a.offboardReason ? `: ${a.offboardReason}` : ''}`}</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {steps.map((s) => (
              <li key={s.key}>
                {s.label}:{' '}
                {s.doneAt ? (
                  `${s.by}, ${dateTimeLabel(s.doneAt)}`
                ) : act ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={action.busy}
                    onClick={() => action.run(() => api.clientStep(a.id, phase, s.key, note, proof), 'Done.').then(clear)}
                  >
                    Mark done
                  </button>
                ) : (
                  <span className="muted">not done</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div>
        <div style={{ fontWeight: 600 }}>Relationship</div>
        {a.contacts.length === 0 && <div className="muted">No visit or meeting logged.</div>}
        {a.contacts.slice(-3).map((c, i) => (
          <div key={i}>
            {c.kind} · {c.by}, {dateTimeLabel(c.at)} · {c.note}
          </div>
        ))}
        <div>Reports sent: {a.reports.length ? a.reports.map((r) => r.period).join(', ') : 'none on record'}</div>
        <div>
          Billing:{' '}
          {a.billing
            ? `invoiced to ${a.billing.invoicedTo ?? '-'}, RM${a.billing.overdueAmount.toFixed(2)} overdue (${a.billing.overdueDays} days), as of ${dateLabel(a.billing.asOf)}`
            : 'unknown (SQL Account not connected)'}
        </div>
        <div>
          Invoices (by hand and by email{a.invoicePortal ? `, and in ${a.invoicePortal}` : ''}):{' '}
          {(a.invoices ?? []).length
            ? (a.invoices ?? [])
                .map(
                  (v) =>
                    `${v.period} RM${v.amount.toFixed(2)} ${[v.hand ? 'hand ✓' : 'hand ✗', v.email ? 'email ✓' : 'email ✗', ...(a.invoicePortal ? [v.portal ? 'system ✓' : 'system ✗'] : [])].join(' ')}`,
                )
                .join(' · ')
            : 'none on record'}
        </div>
      </div>
      {act && (
        <>
          <ProofPicker site={null} refText={a.name.slice(0, 20)} items={proof} onChange={setProof} documentsOnly />
          <input className="input" aria-label="Note" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <select className="select" aria-label="Contact" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="visit">Visit</option>
              <option value="meeting">Meeting</option>
              <option value="call">Call</option>
            </select>
            <button
              className="btn btn-sm"
              disabled={action.busy || note.trim().length < 3}
              onClick={() => action.run(() => api.clientContact(a.id, kind, note), 'Logged.').then(clear)}
            >
              Log contact
            </button>
            <input className="input" type="month" aria-label="Report month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            <button
              className="btn btn-sm"
              disabled={action.busy || !proof.length}
              onClick={() => action.run(() => api.clientReport(a.id, period, proof), 'Report recorded.').then(clear)}
            >
              Report sent
            </button>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>Satisfaction</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={`btn btn-sm${score === n ? ' btn-primary' : ''}`} aria-pressed={score === n} onClick={() => setScore(n)}>
                {n}
              </button>
            ))}
            <button
              className="btn btn-sm"
              disabled={action.busy || !score}
              onClick={() => action.run(() => api.clientRating(a.id, score, note), 'Rating saved.').then(clear)}
            >
              Save rating
            </button>
          </div>
          {a.stage !== 'offboarding' && a.stage !== 'ended' && (
            <div>
              <button
                className="btn btn-ghost btn-sm"
                disabled={action.busy || note.trim().length < 3}
                title="Write the reason in the note"
                onClick={() => action.run(() => api.startOffboarding(a.id, note), 'Offboarding started.').then(clear)}
              >
                Start offboarding (reason in the note)
              </button>
            </div>
          )}
        </>
      )}
      {canBill && <InvoiceForm a={a} />}
      {canBill && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Billing</span>
          <input
            className="input"
            type="month"
            aria-label="Invoiced to"
            value={bill.invoicedTo}
            onChange={(e) => setBill({ ...bill, invoicedTo: e.target.value })}
          />
          <input
            className="input"
            type="number"
            min={0}
            aria-label="Overdue RM"
            placeholder="Overdue RM"
            value={bill.overdueAmount || ''}
            onChange={(e) => setBill({ ...bill, overdueAmount: Number(e.target.value) || 0 })}
          />
          <input
            className="input"
            type="number"
            min={0}
            aria-label="Overdue days"
            placeholder="Days overdue"
            value={bill.overdueDays || ''}
            onChange={(e) => setBill({ ...bill, overdueDays: Number(e.target.value) || 0 })}
          />
          <button
            className="btn btn-sm"
            disabled={action.busy}
            onClick={() => action.run(() => api.clientBilling(a.id, { ...bill, invoicedTo: bill.invoicedTo || null }), 'Billing updated.')}
          >
            Update billing
          </button>
        </div>
      )}
      <ErrorNotice error={action.error} />
    </div>
  );
}

/** Record each way an invoice was sent, with proof: by hand, by email, and in the client's system when needed. */
function InvoiceForm({ a }: { a: Account }) {
  const prev = new Date(Date.now() + 8 * 3_600_000);
  prev.setUTCDate(0);
  const [period, setPeriod] = useState(prev.toISOString().slice(0, 7));
  const [channel, setChannel] = useState<'hand' | 'email' | 'portal'>('hand');
  const [amount, setAmount] = useState(0);
  const [portal, setPortal] = useState(a.invoicePortal ?? '');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const existing = (a.invoices ?? []).find((v) => v.period === period);
  return (
    <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontWeight: 600 }}>Record an invoice sent</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" type="month" aria-label="Invoice month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <select className="select" aria-label="Sent" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
          <option value="hand">By hand (client's received copy)</option>
          <option value="email">By email</option>
          {a.invoicePortal && <option value="portal">In {a.invoicePortal}</option>}
        </select>
        {!existing && (
          <input
            className="input"
            type="number"
            min={0}
            aria-label="Invoice RM"
            placeholder="Invoice RM"
            value={amount || ''}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
          />
        )}
      </div>
      <ProofPicker site={null} refText="Invoice" items={proof} onChange={setProof} documentsOnly required />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !proof.length || (!existing && !amount)}
          onClick={() => act.run(() => api.clientInvoice(a.id, period, channel, existing ? null : amount, proof), 'Recorded.').then((r) => r && setProof([]))}
        >
          Record
        </button>
        <input
          className="input"
          aria-label="Client system"
          placeholder="Client's invoicing system, if any"
          value={portal}
          onChange={(e) => setPortal(e.target.value)}
        />
        <button className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => act.run(() => api.setInvoicePortal(a.id, portal || null), 'Saved.')}>
          Save system
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** Open a new client: onboarding starts with every step open (company manager or Operations Manager and up). */
function NewClientForm({ options, onDone }: { options: ClientBoard['canAdd']; onDone: () => void }) {
  const act = useAction();
  const [companyId, setCompanyId] = useState(options[0]?.companyId ?? '');
  const co = options.find((o) => o.companyId === companyId) ?? options[0];
  const [name, setName] = useState('');
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [ends, setEnds] = useState('');
  return (
    <Drawer title="New client" sub="Onboarding starts with every step open: contract, survey, award, deployment, billing and PDPA." onClose={onDone}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {options.length > 1 && (
          <select
            className="select"
            aria-label="Company"
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setSiteIds([]);
            }}
          >
            {options.map((o) => (
              <option key={o.companyId} value={o.companyId}>
                {o.companyName}
              </option>
            ))}
          </select>
        )}
        <input className="input" aria-label="Client name" placeholder="Client name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="muted small">Sites for this client (add a new site first under Sites if it is not listed)</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, maxHeight: 160, overflow: 'auto' }}>
          {co?.sites.length === 0 && <span className="muted small">No sites yet.</span>}
          {co?.sites.map((x) => (
            <label key={x.id} className="row small" style={{ gap: 4 }}>
              <input
                type="checkbox"
                checked={siteIds.includes(x.id)}
                onChange={(e) => setSiteIds(e.target.checked ? [...siteIds, x.id] : siteIds.filter((id) => id !== x.id))}
              />
              {x.name}
            </label>
          ))}
        </div>
        <label className="small muted" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          Contract ends (if known)
          <input className="input" type="date" aria-label="Contract ends on" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </label>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || name.trim().length < 3}
          onClick={async () => {
            const ok = await act.run(
              () => api.addClientAccount({ companyId: co!.companyId, name, siteIds, contractEndsOn: ends || null }),
              'Client added. Onboarding has started.',
            );
            if (ok) onDone();
          }}
        >
          Save client
        </button>
        <ErrorNotice error={act.error} />
      </div>
    </Drawer>
  );
}
