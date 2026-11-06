import { useState } from 'react';
import { BuildingsIcon, PlusIcon, SmileyIcon, UsersThreeIcon, WarningIcon } from '@phosphor-icons/react';
import type { ProofInput } from '@prima/core';
import { api, type ClientBoard, type ClientShareReport } from '../api';
import { Card, Empty, Facts, PageHead, Search, Stat, Stats, Toolbar } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';
import '../styles/biz.css';

/**
 * Client board (Fauzan, 26 Oct 2026). Operations Managers, the Operations Director and officers act on clients:
 * onboarding and offboarding, visits, the monthly report, satisfaction. The COO monitors every company and holds a
 * monthly operations meeting with each; the company manager monitors their own clients and records billing.
 */

type Account = ClientBoard['accounts'][number];

const TONE_LABEL: Record<Account['tone'], string> = { crit: 'Needs attention', warn: 'Follow up', unknown: 'Unknown', ok: 'In order' };
const STAGE_LABEL: Record<Account['stage'], string> = { onboarding: 'Onboarding', active: 'Active', offboarding: 'Offboarding', ended: 'Ended' };
const STAGE_TONE: Record<Account['stage'], Tone> = { onboarding: 'info', active: 'ok', offboarding: 'warn', ended: 'neutral' };
const VIA: Record<'meeting' | 'visit' | 'call' | 'email' | 'form', string> = {
  meeting: 'Meeting',
  visit: 'Visit',
  call: 'Call',
  email: 'Email',
  form: 'Feedback form',
};
const MEETING: Record<ClientBoard['opsMeetings'][number]['state'], [Tone, string]> = {
  held: ['ok', 'Held, minutes filed'],
  scheduled: ['warn', 'Scheduled'],
  none: ['crit', 'Not scheduled'],
};
const FILTERS = [
  ['attention', 'Needs attention'],
  ['onboarding', 'Onboarding'],
  ['offboarding', 'Offboarding'],
  ['all', 'All'],
] as const;
type Filter = (typeof FILTERS)[number][0];

const money = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const latestRating = (a: Account) => [...a.ratings].sort((x, y) => x.at.localeCompare(y.at)).at(-1);

export function ClientsView() {
  const { data, error } = useLoad(() => api.clientBoard(), []);
  const [filter, setFilter] = useState<Filter>('attention');
  const [company, setCompany] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="clients" />
      </div>
    );
  const act = data.role === 'act';
  const needle = q.trim().toLowerCase();
  const rows = data.accounts.filter(
    (a) =>
      (!company || a.companyId === company) &&
      (!needle || a.name.toLowerCase().includes(needle) || a.companyName.toLowerCase().includes(needle)) &&
      (filter === 'all' ||
        (filter === 'attention' && (a.tone === 'crit' || a.tone === 'warn')) ||
        (filter === 'onboarding' && a.stage === 'onboarding') ||
        (filter === 'offboarding' && a.stage === 'offboarding')),
  );
  const crit = data.accounts.filter((a) => a.tone === 'crit').length;
  const unknown = data.accounts.filter((a) => a.tone === 'unknown').length;
  const onboarding = data.accounts.filter((a) => a.stage === 'onboarding').length;
  const offboarding = data.accounts.filter((a) => a.stage === 'offboarding').length;
  const open = data.accounts.find((a) => a.id === openId) ?? null;
  const showMeetings = data.opsMeetings.length > 0;
  const showCompanies = data.byCompany.length > 1;
  const companyName = company ? data.byCompany.find((c) => c.companyId === company)?.companyName : null;
  return (
    <div className="page">
      {adding && <NewClientForm options={data.canAdd} onDone={() => setAdding(false)} />}
      <PageHead
        title="Clients"
        sub="Operations Managers, the Operations Director and officers look after each client. The COO monitors every company; each company manager monitors their own. Unknown is never shown as fine."
        actions={
          data.canAdd.length > 0 && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <PlusIcon size={16} weight="bold" aria-hidden="true" />
              New client
            </button>
          )
        }
      />
      <Stats>
        <Stat label="Clients" value={data.accounts.length} icon={<UsersThreeIcon size={16} />} tone="info" onClick={() => setFilter('all')} />
        <Stat
          label="Need attention"
          value={crit}
          tone={crit ? 'crit' : 'ok'}
          icon={<WarningIcon size={16} />}
          note={filter === 'attention' ? 'Showing clients to follow up' : undefined}
          onClick={() => setFilter('attention')}
        />
        <Stat label="Unknown" value={unknown} tone={unknown ? 'unknown' : 'ok'} icon={<SmileyIcon size={16} />} note="Never visited, rated or billed on record" />
        <Stat label="Onboarding / offboarding" value={`${onboarding} / ${offboarding}`} icon={<BuildingsIcon size={16} />} />
      </Stats>

      {(showMeetings || showCompanies) && (
        <div className={showMeetings && showCompanies ? 'bz-two' : 'bz-stack'}>
          {showMeetings && (
            <Card title="Monthly operations meetings" sub="The COO meets each company's operations every month. Schedule and file the minutes in Meetings." flush>
              <ul className="bz-rows">
                {data.opsMeetings.map((m) => (
                  <li key={m.companyId} className="bz-row">
                    <span className="bz-row-title">{m.companyName}</span>
                    <Chip tone={MEETING[m.state][0]}>{MEETING[m.state][1]}</Chip>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {showCompanies && (
            <Card title="By company" sub="Pick a company to narrow the list" flush>
              <ul className="bz-rows">
                {data.byCompany.map((c) => (
                  <li key={c.companyId}>
                    <button
                      className="bz-row bz-cl-co"
                      data-on={company === c.companyId || undefined}
                      onClick={() => setCompany(company === c.companyId ? '' : c.companyId)}
                      aria-pressed={company === c.companyId}
                    >
                      <span className="bz-row-main">
                        <span className="bz-row-title">{c.companyName}</span>
                        <span className="bz-row-meta">
                          {c.clients} clients · satisfaction {c.avgScore ?? 'unknown'} of 5 · {c.onboarding} onboarding · {c.offboarding} offboarding
                        </span>
                      </span>
                      {c.crit ? <Chip tone="crit">{c.crit} need attention</Chip> : <Chip tone="ok">No urgent issue</Chip>}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <Toolbar
        end={
          <div className="tabbar" role="tablist" aria-label="Client filter">
            {FILTERS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        <Search value={q} onChange={setQ} placeholder="Search client or company" label="Search clients" />
        {companyName && (
          <button className="btn btn-sm" onClick={() => setCompany('')}>
            {companyName} · show every company
          </button>
        )}
      </Toolbar>

      <Card title={FILTERS.find(([k]) => k === filter)?.[1]} sub={`${rows.length} client${rows.length === 1 ? '' : 's'}`} flush>
        {rows.length === 0 ? (
          <Empty
            title="Nothing here."
            action={
              !needle &&
              data.canAdd.length > 0 && (
                <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
                  New client
                </button>
              )
            }
          >
            {needle ? 'No client matches the search.' : 'A new client starts onboarding: contract, survey, award, deployment, billing and PDPA.'}
          </Empty>
        ) : (
          <ul className="bz-rows">
            {rows.slice(0, 60).map((a) => (
              <li key={a.id}>
                <ClientLine a={a} act={act && a.canAct} onOpen={() => setOpenId(a.id)} />
              </li>
            ))}
          </ul>
        )}
        {rows.length > 60 && <p className="bz-note bz-cl-more">Showing 60 of {rows.length}. Pick a company above to narrow the list.</p>}
      </Card>
      {open && <ClientDetail a={open} act={act && open.canAct} canBill={open.canBill} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ClientLine({ a, act, onOpen }: { a: Account; act: boolean; onOpen: () => void }) {
  const rating = latestRating(a);
  return (
    <button className="bz-row bz-cl-row" data-tone={a.tone === 'crit' || a.tone === 'warn' ? a.tone : undefined} onClick={onOpen}>
      <span className="bz-row-main">
        <span className="bz-row-title">{a.name}</span>
        <span className="bz-row-meta">
          {a.companyName} · satisfaction {rating ? `${rating.score} of 5` : 'unknown'}
          {a.contractEndsOn ? ` · contract to ${dateLabel(a.contractEndsOn)}` : ''}
        </span>
        {a.issues.length > 0 && <span className="bz-cl-issues">{a.issues.map((i) => i.what).join(' · ')}</span>}
      </span>
      <span className="bz-row-side">
        <span className="bz-chips">
          <Chip tone={STAGE_TONE[a.stage]}>{STAGE_LABEL[a.stage]}</Chip>
          <Chip tone={a.tone}>{TONE_LABEL[a.tone]}</Chip>
        </span>
        <span className="bz-sub">{act ? 'Act' : 'Details'}</span>
      </span>
    </button>
  );
}

function ClientDetail({ a, act, canBill, onClose }: { a: Account; act: boolean; canBill: boolean; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [score, setScore] = useState(0);
  const [kind, setKind] = useState<'visit' | 'meeting' | 'call'>('visit');
  const [from, setFrom] = useState('');
  const [via, setVia] = useState<keyof typeof VIA>('meeting');
  const ratings = [...a.ratings].sort((x, y) => y.at.localeCompare(x.at));
  const complaints = [...(a.complaints ?? [])].sort((x, y) => Number(!!x.resolvedAt) - Number(!!y.resolvedAt) || y.at.localeCompare(x.at));
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
  const rating = ratings[0];
  const invoices = a.invoices ?? [];
  const yesNo = (v: boolean) => <Chip tone={v ? 'ok' : 'neutral'}>{v ? 'Yes' : 'No'}</Chip>;
  return (
    <Drawer title={a.name} sub={`${a.companyName} · ${STAGE_LABEL[a.stage]}`} onClose={onClose}>
      <div className="bz-chips">
        <Chip tone={a.tone}>{TONE_LABEL[a.tone]}</Chip>
        <Chip tone={STAGE_TONE[a.stage]}>{STAGE_LABEL[a.stage]}</Chip>
      </div>
      <div className="bz-facts">
        <Facts
          items={[
            ['Company', a.companyName],
            ['Satisfaction', rating ? `${rating.score} of 5` : 'Unknown'],
            ['Contract ends', a.contractEndsOn ? dateLabel(a.contractEndsOn) : 'Not recorded'],
            ['Overdue', a.billing ? `${money(a.billing.overdueAmount)} (${a.billing.overdueDays} days)` : 'Unknown'],
          ]}
        />
      </div>
      {a.issues.length > 0 && (
        <div className="notice" data-tone={a.tone === 'crit' ? 'crit' : 'warn'}>
          {a.issues.map((i) => i.what).join(' · ')}
        </div>
      )}

      {phases.map(([phase, steps]) => (
        <section key={phase} className="bz-sec">
          <div className="bz-sec-head">
            <h3>{phase === 'onboarding' ? 'Onboarding' : `Offboarding${a.offboardReason ? `: ${a.offboardReason}` : ''}`}</h3>
            <span className="bz-count">
              {steps.filter((s) => s.doneAt).length} of {steps.length}
            </span>
          </div>
          <ul className="bz-cl-checks">
            {steps.map((s) => (
              <li key={s.key} data-done={s.doneAt ? 'yes' : undefined}>
                <span className="bz-cl-tick" aria-hidden="true">
                  {s.doneAt ? '✓' : ''}
                </span>
                <span className="bz-row-main">
                  <span>{s.label}</span>
                  {s.doneAt && (
                    <span className="bz-row-meta">
                      {s.by}, {dateTimeLabel(s.doneAt)}
                    </span>
                  )}
                </span>
                {!s.doneAt &&
                  (act ? (
                    <button
                      className="btn btn-sm"
                      disabled={action.busy}
                      onClick={() => action.run(() => api.clientStep(a.id, phase, s.key, note, proof), 'Done.').then(clear)}
                    >
                      Mark done
                    </button>
                  ) : (
                    <span className="bz-sub">not done</span>
                  ))}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="bz-sec">
        <h3>Relationship</h3>
        {a.contacts.length === 0 ? (
          <p className="bz-note">No visit or meeting logged.</p>
        ) : (
          <ul className="bz-cl-log">
            {a.contacts.slice(-3).map((c, i) => (
              <li key={i}>
                <span className="bz-cl-log-top">
                  <strong className="bz-cl-kind">{c.kind}</strong>
                  <span className="bz-sub">
                    {c.by}, {dateTimeLabel(c.at)}
                  </span>
                </span>
                <span>{c.note}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="bz-note">Reports sent: {a.reports.length ? a.reports.map((r) => r.period).join(', ') : 'none on record'}</p>
      </section>

      <section className="bz-sec">
        <h3>Satisfaction and complaints</h3>
        {ratings.length === 0 && <p className="bz-note">Never rated.</p>}
        {ratings.length > 0 && (
          <ul className="bz-cl-log">
            {ratings.slice(0, 3).map((r) => (
              <li key={r.at}>
                <span className="bz-cl-log-top">
                  <strong>{r.score} of 5</strong>
                  <span className="bz-sub">
                    {r.by}, {dateLabel(r.at.slice(0, 10))}
                  </span>
                </span>
                <span className="bz-row-meta">
                  {r.from ? `from ${r.from}${r.via ? ` (${VIA[r.via]})` : ''}` : 'who at the client not recorded'}
                  {r.comment ? ` · ${r.comment}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {complaints.length === 0 && <p className="bz-note">No complaints on record.</p>}
        {complaints.length > 0 && (
          <ul className="bz-cl-log">
            {complaints.slice(0, 5).map((c) => (
              <li key={c.id}>
                <span className="bz-cl-log-top">
                  <Chip tone={c.resolvedAt ? 'ok' : 'warn'}>{c.resolvedAt ? 'Closed' : 'Open'}</Chip>
                  <span className="bz-sub">
                    {dateLabel(c.at.slice(0, 10))} · {c.from} ({VIA[c.via]})
                  </span>
                </span>
                <span>{c.what}</span>
                {c.resolvedAt && (
                  <span className="bz-row-meta">
                    done: {c.resolution} ({c.resolvedBy}, {dateLabel(c.resolvedAt.slice(0, 10))})
                  </span>
                )}
                {act && !c.resolvedAt && (
                  <span>
                    <button
                      className="btn btn-sm"
                      disabled={action.busy || note.trim().length < 3}
                      title="Write what was done in the note"
                      onClick={() => action.run(() => api.resolveClientComplaint(a.id, c.id, note, proof), 'Complaint closed.').then(clear)}
                    >
                      Close (what was done in the note)
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {act && (
        <section className="bz-sec">
          <h3>Record an update</h3>
          <div className="bz-act">
            <p className="bz-note">The note and proof go with the action you take here or above: a step marked done, a complaint closed, a contact, a report, a rating or offboarding.</p>
            <label className="field">
              <span className="label">Note</span>
              <input className="input" aria-label="Note" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <ProofPicker site={null} refText={a.name.slice(0, 20)} items={proof} onChange={setProof} documentsOnly />
            <div className="bz-cl-pair">
              <label className="field">
                <span className="label">Contact</span>
                <select className="select" aria-label="Contact" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  <option value="visit">Visit</option>
                  <option value="meeting">Meeting</option>
                  <option value="call">Call</option>
                </select>
              </label>
              <button
                className="btn"
                disabled={action.busy || note.trim().length < 3}
                onClick={() => action.run(() => api.clientContact(a.id, kind, note), 'Logged.').then(clear)}
              >
                Log contact
              </button>
            </div>
            <div className="bz-cl-pair">
              <label className="field">
                <span className="label">Report month</span>
                <input className="input" type="month" aria-label="Report month" value={period} onChange={(e) => setPeriod(e.target.value)} />
              </label>
              <button
                className="btn"
                disabled={action.busy || !proof.length}
                onClick={() => action.run(() => api.clientReport(a.id, period, proof), 'Report recorded.').then(clear)}
              >
                Report sent
              </button>
            </div>
          </div>
          <div className="bz-act">
            <div className="bz-form">
              <label className="field">
                <span className="label">Who at the client</span>
                <input
                  className="input"
                  aria-label="Who at the client"
                  placeholder="Who at the client (name, position)"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="label">How they said it</span>
                <select className="select" aria-label="How they said it" value={via} onChange={(e) => setVia(e.target.value as keyof typeof VIA)}>
                  {(Object.keys(VIA) as (keyof typeof VIA)[]).map((k) => (
                    <option key={k} value={k}>
                      {VIA[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="bz-actions">
              <span className="label">Satisfaction</span>
              <div className="seg" role="group" aria-label="Satisfaction">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} aria-pressed={score === n} onClick={() => setScore(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="bz-actions">
              <button
                className="btn"
                disabled={action.busy || !score || from.trim().length < 2}
                title="Fill in who at the client gave it and how"
                onClick={() => action.run(() => api.clientRating(a.id, score, note, { from, via, proof }), 'Rating saved.').then(clear)}
              >
                Save rating
              </button>
              <button
                className="btn"
                disabled={action.busy || from.trim().length < 2 || note.trim().length < 3}
                title="Write the complaint in the note"
                onClick={() => action.run(() => api.clientComplaint(a.id, { from, via, what: note, proof }), 'Complaint logged.').then(clear)}
              >
                Log complaint (in the note)
              </button>
            </div>
          </div>
          {a.stage !== 'offboarding' && a.stage !== 'ended' && (
            <div className="bz-actions">
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
        </section>
      )}

      <section className="bz-sec">
        <h3>Money</h3>
        <div className="bz-facts bz-cl-billing">
          <span className="label">Billing</span>
          <span>
            {a.billing
              ? `invoiced to ${a.billing.invoicedTo ?? '-'}, RM${a.billing.overdueAmount.toFixed(2)} overdue (${a.billing.overdueDays} days), as of ${dateLabel(a.billing.asOf)}`
              : 'unknown (SQL Account not connected)'}
          </span>
        </div>
        <div className="bz-sec-head">
          <span className="label">Invoices (by hand and by email{a.invoicePortal ? `, and in ${a.invoicePortal}` : ''})</span>
        </div>
        {invoices.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Amount</th>
                  <th>By hand</th>
                  <th>By email</th>
                  {a.invoicePortal && <th>In system</th>}
                </tr>
              </thead>
              <tbody>
                {invoices.map((v) => (
                  <tr key={v.period}>
                    <td>{v.period}</td>
                    <td className="num">RM{v.amount.toFixed(2)}</td>
                    <td>{yesNo(!!v.hand)}</td>
                    <td>{yesNo(!!v.email)}</td>
                    {a.invoicePortal && <td>{yesNo(!!v.portal)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="bz-note">None on record.</p>
        )}
        {canBill && <InvoiceForm a={a} />}
        {canBill && (
          <div className="bz-act">
            <span className="label">Billing</span>
            <div className="bz-cl-bill">
              <label className="field">
                <span className="label">Invoiced to</span>
                <input className="input" type="month" aria-label="Invoiced to" value={bill.invoicedTo} onChange={(e) => setBill({ ...bill, invoicedTo: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">Overdue RM</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  aria-label="Overdue RM"
                  placeholder="Overdue RM"
                  value={bill.overdueAmount || ''}
                  onChange={(e) => setBill({ ...bill, overdueAmount: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="field">
                <span className="label">Days overdue</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  aria-label="Overdue days"
                  placeholder="Days overdue"
                  value={bill.overdueDays || ''}
                  onChange={(e) => setBill({ ...bill, overdueDays: Number(e.target.value) || 0 })}
                />
              </label>
            </div>
            <div className="bz-actions">
              <button
                className="btn btn-sm"
                disabled={action.busy}
                onClick={() => action.run(() => api.clientBilling(a.id, { ...bill, invoicedTo: bill.invoicedTo || null }), 'Billing updated.')}
              >
                Update billing
              </button>
            </div>
          </div>
        )}
      </section>
      {canBill && a.stage !== 'ended' && <ShareLinks a={a} />}
      <ErrorNotice error={action.error} />
    </Drawer>
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
    <div className="bz-act">
      <span className="label">Record an invoice sent</span>
      <div className="bz-cl-bill">
        <label className="field">
          <span className="label">Invoice month</span>
          <input className="input" type="month" aria-label="Invoice month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Sent</span>
          <select className="select" aria-label="Sent" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
            <option value="hand">By hand (client's received copy)</option>
            <option value="email">By email</option>
            {a.invoicePortal && <option value="portal">In {a.invoicePortal}</option>}
          </select>
        </label>
        {!existing && (
          <label className="field">
            <span className="label">Invoice RM</span>
            <input
              className="input"
              type="number"
              min={0}
              aria-label="Invoice RM"
              placeholder="Invoice RM"
              value={amount || ''}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
            />
          </label>
        )}
      </div>
      <ProofPicker site={null} refText="Invoice" items={proof} onChange={setProof} documentsOnly required />
      <div className="bz-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !proof.length || (!existing && !amount)}
          onClick={() => act.run(() => api.clientInvoice(a.id, period, channel, existing ? null : amount, proof), 'Recorded.').then((r) => r && setProof([]))}
        >
          Record
        </button>
      </div>
      <div className="bz-cl-pair">
        <label className="field">
          <span className="label">Client's invoicing system</span>
          <input
            className="input"
            aria-label="Client system"
            placeholder="Client's invoicing system, if any"
            value={portal}
            onChange={(e) => setPortal(e.target.value)}
          />
        </label>
        <button className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => act.run(() => api.setInvoicePortal(a.id, portal || null), 'Saved.')}>
          Save system
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/**
 * Client report links (Fauzan, 3 Nov 2026: "Shared report links first"). The company manager makes a read-only link
 * for one period that expires; the client opens it without a Prima sign-in and sees only its own sites. No staff or
 * guard names, no case descriptions, no money owed. Any link can be revoked with a reason.
 */
function ShareLinks({ a }: { a: Account }) {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  // Default: last calendar month, so its invoice and report are on the page (only whole months inside the period are).
  const lastEnd = new Date(Date.now() + 8 * 3_600_000);
  lastEnd.setUTCDate(0);
  const prevTo = lastEnd.toISOString().slice(0, 10);
  const prevFrom = `${prevTo.slice(0, 7)}-01`;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ recipient: '', from: prevFrom, to: prevTo, days: 7 });
  const [made, setMade] = useState<{ url: string | null } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ClientShareReport | null>(null);
  const act = useAction();
  const view = useLoad(() => (open ? api.clientShareLinks(a.id) : Promise.resolve(null)), [a.id, open]);
  const full = (u: string) => (u.startsWith('/') ? `${window.location.origin}${u}` : u);
  if (!open)
    return (
      <div className="bz-actions">
        <button className="btn" onClick={() => setOpen(true)}>
          Client report links
        </button>
      </div>
    );
  const d = view.data;
  return (
    <section className="bz-sec">
      <h3>Client report links</h3>
      <p className="bz-note">
        Read-only page for this client: its own sites, patrol scans, supervisor visits, incidents, emergency alerts, complaints and invoices sent. No staff names, no case
        details, no amounts owed. Invoices show as sent, never as paid. Invoices and monthly reports appear only for months wholly inside the period.
      </p>
      {view.error && <ErrorNotice error={{ message: view.error, findings: [] }} />}
      {!d && !view.error && <Loading what="links" />}
      {d && !d.linksOn && <div className="notice">Report links are switched off on this server until the link key and public address are set.</div>}
      {d?.canCreate && d.linksOn && (
        <div className="bz-act">
          <div className="bz-form">
            <label className="field bz-span">
              <span className="label">Link for</span>
              <input
                className="input"
                aria-label="Link for"
                placeholder="Who receives it (name or role)"
                value={form.recipient}
                onChange={(e) => setForm({ ...form, recipient: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="label">Report from</span>
              <input className="input" type="date" aria-label="Report from" value={form.from} max={today} onChange={(e) => setForm({ ...form, from: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Report to</span>
              <input className="input" type="date" aria-label="Report to" value={form.to} max={today} onChange={(e) => setForm({ ...form, to: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Link open for</span>
              <select className="select" aria-label="Link open for" value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
                {[1, 3, 7, 14, 30].map((n) => (
                  <option key={n} value={n}>
                    Open {n} day{n > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="bz-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || form.recipient.trim().length < 3}
              onClick={() => act.run(() => api.createClientShareLink(a.id, form), 'Link made.').then((r) => r && setMade({ url: r.url }))}
            >
              Make link
            </button>
          </div>
        </div>
      )}
      {made && (
        <div className="notice" data-tone="ok">
          {made.url ? (
            <div className="bz-stack">
              <span>Send this link to the client by your usual email. It is shown once here; make a new one if it is lost.</span>
              <code className="bz-cl-url">{full(made.url)}</code>
              <span>
                <button className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(full(made.url!))}>
                  Copy link
                </button>
              </span>
            </div>
          ) : (
            <span>Link made. This test build has no server, so the link cannot be opened from outside: use Preview to see the client page.</span>
          )}
        </div>
      )}
      {d && d.links.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>For</th>
                <th>Period</th>
                <th>Open until</th>
                <th>Opened</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...d.links].reverse().map((l) => (
                <tr key={l.id}>
                  <td>{l.recipient}</td>
                  <td>
                    {dateLabel(l.from)} to {dateLabel(l.to)}
                  </td>
                  <td>{dateLabel(l.expiresOn)}</td>
                  <td>{l.views ? `${l.views}x, last ${dateTimeLabel(l.lastViewAt!)}` : 'Not yet'}</td>
                  <td>{l.revokedAt ? <Chip tone="neutral">Revoked</Chip> : l.live ? <Chip tone="ok">Open</Chip> : <Chip tone="neutral">Expired</Chip>}</td>
                  <td className="bz-cl-nowrap">
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={act.busy}
                      onClick={() => act.run(() => api.previewClientShareLink(a.id, l.id)).then((r) => r && setPreview(r))}
                    >
                      Preview
                    </button>
                    {l.live && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setRevoking(l.id);
                          setReason('');
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revoking && (
        <div className="bz-act">
          <label className="field">
            <span className="label">Why revoke</span>
            <input className="input" aria-label="Why revoke" placeholder="Why (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="bz-actions">
            <button
              className="btn btn-sm"
              disabled={act.busy || reason.trim().length < 5}
              onClick={() => act.run(() => api.revokeClientShareLink(a.id, revoking, reason), 'Link revoked.').then((r) => r !== undefined && setRevoking(null))}
            >
              Revoke link
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setRevoking(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
      {preview && <SharePreview r={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

/** What the client sees on the link, shown to staff inside Prima. Opening it here is not counted as a client view. */
function SharePreview({ r, onClose }: { r: ClientShareReport; onClose: () => void }) {
  return (
    <Drawer title={`Client page: ${r.clientName}`} sub={`Period ${dateLabel(r.from)} to ${dateLabel(r.to)}. Open until ${dateLabel(r.expiresOn)}. Preview only.`} onClose={onClose}>
      <section className="bz-sec">
        <h3>Sites</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th className="num">Patrol checkpoints scanned</th>
                <th className="num">Supervisor visits</th>
              </tr>
            </thead>
            <tbody>
              {r.sites.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td className="num">{s.patrolScans}</td>
                  <td className="num">{s.visits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="bz-sec">
        <h3>Incidents at the client's sites</h3>
        {r.incidents.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Date</th>
                  <th>Site</th>
                  <th>Kind</th>
                  <th>Severity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {r.incidents.map((c) => (
                  <tr key={c.ref}>
                    <td className="mono">{c.ref}</td>
                    <td>{dateLabel(c.on)}</td>
                    <td>{c.site}</td>
                    <td>{c.kind}</td>
                    <td>{c.severity}</td>
                    <td>{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="bz-note">None in this period.</p>
        )}
      </section>
      <section className="bz-sec">
        <h3>Invoices sent</h3>
        {r.invoices.length ? (
          <ul className="bz-cl-log">
            {r.invoices.map((x) => (
              <li key={x.period}>
                <span className="bz-cl-log-top">
                  <strong>{x.period}</strong>
                  <span className="bz-amt">RM {x.amount.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span>
                </span>
                <span className="bz-row-meta">{x.sentOn ? `sent ${dateLabel(x.sentOn)}` : 'not yet sent'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="bz-note">None recorded for this period.</p>
        )}
        <p className="bz-note">The client page lists invoices sent. It is not a statement of account and does not show payments.</p>
      </section>
      <section className="bz-sec">
        <h3>Monthly reports</h3>
        <p>{r.reports.length ? r.reports.join(', ') : 'None recorded for this period.'}</p>
      </section>
    </Drawer>
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
      <div className="bz-form">
        {options.length > 1 && (
          <label className="field bz-span">
            <span className="label">Company</span>
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
          </label>
        )}
        <label className="field bz-span">
          <span className="label">Client name</span>
          <input className="input" aria-label="Client name" placeholder="Client name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="bz-span bz-cl-sites">
          <legend className="label">Sites for this client (add a new site first under Sites if it is not listed)</legend>
          {co?.sites.length === 0 && <span className="bz-note">No sites yet.</span>}
          {co?.sites.map((x) => (
            <label key={x.id} className="bz-cl-site">
              <input
                type="checkbox"
                checked={siteIds.includes(x.id)}
                onChange={(e) => setSiteIds(e.target.checked ? [...siteIds, x.id] : siteIds.filter((id) => id !== x.id))}
              />
              {x.name}
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span className="label">Contract ends (if known)</span>
          <input className="input" type="date" aria-label="Contract ends on" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="bz-form-foot">
        <button
          className="btn btn-primary"
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
        <button className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </Drawer>
  );
}
