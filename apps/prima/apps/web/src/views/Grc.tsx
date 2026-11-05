import { useState } from 'react';
import { FirstAidKitIcon, GiftIcon, MegaphoneIcon, QuestionIcon, ShieldWarningIcon, StampIcon } from '@phosphor-icons/react';
import type { GrcStream } from '@prima/core';
import { api, type GiftInput, type GrcBoard, type WhistleInput } from '../api';
import { useApp } from '../App';
import { Card, Empty, PageHead, Stat, Stats, Steps, Toolbar, type StepState } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import '../styles/gov.css';

/**
 * Speak up and assurance (V15). Everyone can report wrongdoing (anonymously if they wish) and declare gifts. Each
 * company proves its obligations and internal audit checks the proof; no proof is unknown, never green. A report
 * never reaches anyone it names.
 */

type Tab = 'speak' | 'gifts' | 'obligations' | 'osh' | 'reports';
type Obl = GrcBoard['obligations'][number];

const STREAM: Record<GrcStream, string> = {
  OSH: 'Safety and health',
  EMPLOYEE_RELATIONS: 'Employee relations',
  ANTI_BRIBERY: 'Anti-bribery',
  TAX: 'Tax',
  CONTINUITY: 'Continuity',
  PRIVACY: 'Privacy',
  INTERNAL_AUDIT: 'Internal audit',
  SUPPLIER: 'Suppliers',
  WELFARE: 'Worker welfare',
  FRAUD: 'Fraud checks',
};
const STATE: Record<Obl['state'], ['ok' | 'warn' | 'crit' | 'info', string]> = {
  ok: ['ok', 'Proven and checked'],
  due_soon: ['info', 'Due soon'],
  unchecked: ['warn', 'Proof not checked'],
  unknown: ['warn', 'Unknown: no proof'],
  overdue: ['crit', 'Overdue'],
  failed: ['crit', 'Proof rejected'],
};
const CATEGORY: Record<WhistleInput['category'], string> = {
  BRIBERY: 'Bribery or kickbacks',
  FRAUD: 'Fraud or theft',
  SAFETY: 'Safety danger',
  HARASSMENT: 'Harassment',
  MISCONDUCT: 'Other misconduct',
  OTHER: 'Something else',
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toneOf = (t: string) => (t === 'crit' ? 'crit' : t === 'warn' ? 'warn' : undefined);

export function GrcView() {
  const { data, error } = useLoad(() => api.grcBoard(), []);
  const [tab, setTab] = useState<Tab>('speak');
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="speak up and assurance" />
      </div>
    );
  const k = data.kpis;
  const sees = data.roles.length > 0;
  const tabs: [Tab, string][] = [
    ['speak', 'Speak up'],
    ['gifts', 'Gifts'],
  ];
  if (sees) tabs.push(['obligations', 'Obligations'], ['osh', 'Site safety']);
  if (data.handled.length || data.toReview.length) tabs.push(['reports', `Reports to handle (${k.reportsToHandle})`]);
  return (
    <div className="page gv-page">
      <PageHead
        title="Speak up and assurance"
        sub="Report wrongdoing safely, declare gifts, and see what each company must prove. A report never goes to anyone it names, and you can stay anonymous."
      >
        <p className="notice" data-tone="info">
          Test data. The gift limit, acknowledgement time and who handles reports are proposals.
        </p>
      </PageHead>
      {sees && (
        <Stats>
          <Stat
            label="Proof rejected or overdue"
            value={k.failed + k.overdue}
            tone={k.failed + k.overdue ? 'crit' : 'ok'}
            icon={<ShieldWarningIcon size={16} />}
            onClick={() => setTab('obligations')}
          />
          <Stat label="Unknown, no proof" value={k.unknown} tone={k.unknown ? 'warn' : 'ok'} icon={<QuestionIcon size={16} />} onClick={() => setTab('obligations')} />
          <Stat label="Proof not checked" value={k.unchecked} tone={k.unchecked ? 'warn' : 'ok'} icon={<StampIcon size={16} />} onClick={() => setTab('obligations')} />
          <Stat
            label="Sites without a current risk assessment"
            value={k.oshUnknown}
            tone={k.oshUnknown ? 'warn' : 'ok'}
            icon={<FirstAidKitIcon size={16} />}
            onClick={() => setTab('osh')}
          />
          {data.whistleStats && (
            <Stat
              label="Speak-up reports open"
              value={data.whistleStats.open}
              tone={data.whistleStats.ackLate ? 'crit' : 'ok'}
              note={data.whistleStats.ackLate ? `${data.whistleStats.ackLate} not acknowledged in ${data.rule.whistleAckDays} days` : undefined}
              icon={<MegaphoneIcon size={16} />}
            />
          )}
          {k.giftsToDecide > 0 && (
            <Stat label="Gifts to decide" value={k.giftsToDecide} tone="warn" icon={<GiftIcon size={16} />} onClick={() => setTab('gifts')} />
          )}
        </Stats>
      )}
      <div className="tabbar" role="tablist" aria-label="Speak up and assurance">
        {tabs.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'speak' && <SpeakUp data={data} />}
      {tab === 'gifts' && <Gifts data={data} />}
      {tab === 'obligations' && <Obligations data={data} />}
      {tab === 'osh' && <Osh data={data} />}
      {tab === 'reports' && <Reports data={data} />}
    </div>
  );
}

function SpeakUp({ data }: { data: GrcBoard }) {
  const { me } = useApp();
  const act = useAction();
  const companies = me.companies.length ? me.companies : data.companies;
  const [f, setF] = useState<WhistleInput>({
    anonymous: true,
    companyId: null,
    category: 'MISCONDUCT',
    summary: '',
    implicatedUserIds: [],
  });
  const [receipt, setReceipt] = useState<{ code: string; handledBy: string } | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const check = useAction();
  return (
    <div className="gv-two">
      <Card title="Report wrongdoing" sub="Only the people who handle reports see it. You can stay anonymous.">
        {receipt ? (
          <div className="notice" data-tone="info">
            Your report is in. Keep this code to check on it: <strong>{receipt.code}</strong>. It went to {receipt.handledBy}.
            <div className="gv-btns gv-mt">
              <button className="btn btn-sm" onClick={() => setReceipt(null)}>
                Make another report
              </button>
            </div>
          </div>
        ) : (
          <div className="gv-stack-sm">
            <div className="gv-form">
              <label className="field">
                <span className="label">What is it about</span>
                <select
                  className="select"
                  aria-label="What is it about"
                  value={f.category}
                  onChange={(e) => setF({ ...f, category: e.target.value as WhistleInput['category'] })}
                >
                  {Object.entries(CATEGORY).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Which company</span>
                <select className="select" aria-label="Which company" value={f.companyId ?? ''} onChange={(e) => setF({ ...f, companyId: e.target.value || null })}>
                  <option value="">Company (optional)</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field gv-span">
                <span className="label">What happened</span>
                <textarea
                  className="textarea"
                  rows={5}
                  aria-label="What happened"
                  placeholder="What happened, when, where, and who was involved"
                  value={f.summary}
                  onChange={(e) => setF({ ...f, summary: e.target.value })}
                />
              </label>
            </div>
            {data.handlers.length > 0 && (
              <fieldset className="gv-fieldset">
                <legend className="label">Is any of these people involved? Your report will not go to them.</legend>
                <div className="gv-checks">
                  {data.handlers.map((h) => (
                    <label key={h.id} className="gv-check">
                      <input
                        type="checkbox"
                        checked={f.implicatedUserIds.includes(h.id)}
                        onChange={(e) =>
                          setF({
                            ...f,
                            implicatedUserIds: e.target.checked ? [...f.implicatedUserIds, h.id] : f.implicatedUserIds.filter((x) => x !== h.id),
                          })
                        }
                      />
                      <span>
                        {h.name}, {h.title}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <label className="gv-check">
              <input type="checkbox" checked={f.anonymous} onChange={(e) => setF({ ...f, anonymous: e.target.checked })} /> Do not record my name
            </label>
            <ErrorNotice error={act.error} />
            <div className="gv-form-foot">
              <button
                className="btn btn-primary"
                disabled={act.busy || f.summary.trim().length < 20}
                onClick={() =>
                  act
                    .run(() => api.submitWhistle(f))
                    .then((r) => {
                      if (r) {
                        setReceipt(r);
                        setF({ anonymous: true, companyId: null, category: 'MISCONDUCT', summary: '', implicatedUserIds: [] });
                      }
                    })
                }
              >
                Send report
              </button>
              {f.summary.trim().length < 20 && <span className="muted small">Write at least 20 characters.</span>}
            </div>
          </div>
        )}
      </Card>
      <div className="gv-stack">
        <Card title="Check a report" sub="Use the receipt code you were given.">
          <div className="gv-stack-sm">
            <div className="gv-inline">
              <input
                className="input"
                aria-label="Receipt code"
                placeholder="Receipt code, e.g. SU-0001-K7Q"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                className="btn btn-sm"
                disabled={check.busy || !code.trim()}
                onClick={() =>
                  check
                    .run(() => api.whistleStatus(code))
                    .then((r) => r && setStatus(`${r.code}: ${r.status}${r.outcome ? `. Outcome: ${r.outcome}` : ''}`))
                }
              >
                Check
              </button>
            </div>
            {status && (
              <p className="notice" data-tone="info">
                {status}
              </p>
            )}
            <ErrorNotice error={check.error} />
          </div>
        </Card>
        {data.mine.length > 0 && (
          <Card title="Your reports" flush>
            <ul className="gv-list">
              {data.mine.map((m) => (
                <li key={m.code} className="gv-item">
                  <div className="gv-item-head">
                    <div className="gv-item-main">
                      <div className="gv-item-title mono">{m.code}</div>
                      <div className="gv-item-meta">
                        {CATEGORY[m.category]} · sent {dateTimeLabel(m.at)}
                      </div>
                    </div>
                    <div className="gv-item-state">
                      <Chip tone={m.status === 'closed' ? 'ok' : 'info'}>{m.status}</Chip>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function Gifts({ data }: { data: GrcBoard }) {
  const act = useAction();
  const [f, setF] = useState<GiftInput>({
    companyId: null,
    direction: 'received',
    counterparty: '',
    counterpartyKind: 'CLIENT',
    description: '',
    value: 0,
    on: '',
    cash: false,
  });
  const [form, setForm] = useState(false);
  return (
    <Card
      title="Gifts and hospitality"
      flush
      actions={
        <button className="btn btn-sm btn-primary" aria-expanded={form} onClick={() => setForm(!form)}>
          Declare a gift
        </button>
      }
    >
      <div className="gv-card-intro">
        <p>
          Declare every gift or hospitality given or received. Above RM{data.rule.giftDecisionAbove}, anything with a public official, and any cash need a decision
          by the Chief of Staff or Deputy. Cash is never kept.
        </p>
        {form && (
          <div className="gv-box" aria-label="Declare a gift">
            <div className="gv-form">
              <label className="field">
                <span className="label">Given or received</span>
                <select
                  className="select"
                  aria-label="Given or received"
                  value={f.direction}
                  onChange={(e) => setF({ ...f, direction: e.target.value as GiftInput['direction'] })}
                >
                  <option value="received">Received</option>
                  <option value="given">Given</option>
                </select>
              </label>
              <label className="field">
                <span className="label">With whom</span>
                <input
                  className="input"
                  aria-label="With whom"
                  placeholder="With whom (company or person)"
                  value={f.counterparty}
                  onChange={(e) => setF({ ...f, counterparty: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="label">Who they are</span>
                <select
                  className="select"
                  aria-label="Who they are"
                  value={f.counterpartyKind}
                  onChange={(e) => setF({ ...f, counterpartyKind: e.target.value as GiftInput['counterpartyKind'] })}
                >
                  <option value="CLIENT">Client</option>
                  <option value="SUPPLIER">Supplier</option>
                  <option value="PUBLIC_OFFICIAL">Public official</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label className="field gv-span">
                <span className="label">What it was</span>
                <input
                  className="input"
                  aria-label="What it was"
                  placeholder="What it was"
                  value={f.description}
                  onChange={(e) => setF({ ...f, description: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="label">Value RM</span>
                <input
                  className="input"
                  aria-label="Value RM"
                  placeholder="Value RM (estimate)"
                  inputMode="decimal"
                  value={f.value || ''}
                  onChange={(e) => setF({ ...f, value: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span className="label">Date</span>
                <input className="input" type="date" aria-label="Date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
              </label>
            </div>
            <label className="gv-check">
              <input type="checkbox" checked={f.cash} onChange={(e) => setF({ ...f, cash: e.target.checked })} /> It was cash or a cash voucher
            </label>
            <ErrorNotice error={act.error} />
            <div className="gv-form-foot">
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() =>
                  act
                    .run(() => api.declareGift(f), 'Declared.')
                    .then((x) => {
                      if (x) setForm(false);
                    })
                }
              >
                Declare
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setForm(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {!data.gifts.length && <Empty title="No declarations." />}
      <ul className="gv-list">
        {data.gifts.map((g) => (
          <li key={g.gift.id}>
            <GiftLine g={g} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GiftLine({ g: row }: { g: GrcBoard['gifts'][number] }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const g = row.gift;
  const tone = g.decision ? (g.decision.outcome === 'approved' ? 'ok' : 'info') : g.needsDecision ? 'warn' : 'ok';
  const label = g.decision ? `Decided: ${g.decision.outcome}` : g.needsDecision ? 'Decision needed' : 'Recorded';
  return (
    <div className="gv-item" data-tone={tone === 'warn' ? 'warn' : undefined}>
      <div className="gv-item-head">
        <div className="gv-item-main">
          <div className="gv-item-title">
            <span className="gv-co">{g.declarantName}:</span> {g.description}
          </div>
          <div className="gv-item-meta">
            {g.direction === 'received' ? 'Received from' : 'Given to'} {g.counterparty} ({g.counterpartyKind.toLowerCase().replace('_', ' ')}) · RM
            {g.value.toFixed(2)}
            {g.cash ? ' · cash' : ''} · {dateLabel(g.on)} · {row.companyName}
            {g.decision ? ` · ${g.decision.by}${g.decision.note ? `: ${g.decision.note}` : ''}` : ''}
          </div>
        </div>
        <div className="gv-item-state">
          {g.cash && <Chip tone="crit">Cash</Chip>}
          <Chip tone={tone}>{label}</Chip>
        </div>
      </div>
      {row.canDecide && (
        <div className="gv-box">
          <div className="gv-box-title">Decide</div>
          <input className="input" aria-label="Note" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="gv-btns">
            {(['approved', 'return', 'donate', 'refused'] as const)
              .filter((o) => o !== 'approved' || (!g.cash && g.counterpartyKind !== 'PUBLIC_OFFICIAL'))
              .map((o) => (
                <button key={o} className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.decideGift(g.id, o, note), 'Decision recorded.')}>
                  {{ approved: 'May keep', return: 'Return it', donate: 'Donate it', refused: 'Refuse' }[o]}
                </button>
              ))}
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Obligations({ data }: { data: GrcBoard }) {
  const [stream, setStream] = useState<GrcStream | ''>('');
  const [all, setAll] = useState(false);
  const rows = data.obligations.filter((o) => (!stream || o.item.stream === stream) && (all || o.state !== 'ok'));
  return (
    <div className="gv-stack-sm">
      <Toolbar
        end={
          <button className="btn btn-sm" aria-pressed={all} onClick={() => setAll(!all)}>
            {all ? 'Hide proven' : 'Show proven'}
          </button>
        }
      >
        <select className="select gv-filter" aria-label="Workstream" value={stream} onChange={(e) => setStream(e.target.value as GrcStream | '')}>
          <option value="">All workstreams</option>
          {Object.entries(STREAM).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Toolbar>
      <Card title="What each company must prove" sub="The company records the proof; internal audit checks it. Only checked, current proof is green." flush>
        {!rows.length && <Empty title="Nothing open." />}
        <ul className="gv-list">
          {rows.slice(0, 150).map((o) => (
            <li key={o.item.id}>
              <OblLine o={o} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function OblLine({ o: row }: { o: Obl }) {
  const act = useAction();
  const [on, setOn] = useState('');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const o = row.item;
  const [tone, label] = STATE[row.state];
  // Overdue: the proof on file is for an earlier period, so this period's proof is late.
  const late = row.state === 'overdue';
  const proof: StepState = late ? 'stopped' : o.evidence ? 'done' : 'now';
  const checked: StepState = late ? 'todo' : o.checked ? (o.checked.ok ? 'done' : 'stopped') : o.evidence ? 'now' : 'todo';
  return (
    <div className="gv-item" data-tone={toneOf(tone)}>
      <div className={row.dueOn ? 'gv-item-head gv-with-date' : 'gv-item-head'}>
        {row.dueOn && (
          <span className="gv-date" data-tone={toneOf(tone)} aria-label={`Next due ${dateLabel(row.dueOn)}`}>
            <b>{Number(row.dueOn.slice(8, 10))}</b>
            <span>{MON[Number(row.dueOn.slice(5, 7)) - 1]}</span>
          </span>
        )}
        <div className="gv-item-main">
          <div className="gv-item-title">
            <span className="gv-co">{row.companyName}:</span> {o.title}
          </div>
          <div className="gv-item-meta">
            {STREAM[o.stream]} · every {o.everyMonths} month
            {o.everyMonths === 1 ? '' : 's'} · {o.basis}
          </div>
        </div>
        <div className="gv-item-state">
          <Chip tone={tone}>{label}</Chip>
        </div>
      </div>
      <Steps
        steps={[
          { label: 'Proof recorded', state: proof, note: late ? `Due ${dateLabel(row.dueOn)}` : o.evidence ? `${o.evidence.ref}, ${dateLabel(o.evidence.on)}` : 'By the company' },
          { label: 'Checked by internal audit', state: checked, note: !late && o.checked ? `${o.checked.ok ? 'accepted' : 'rejected'} by ${o.checked.by}` : undefined },
        ]}
      />
      <div className="gv-lines">
        <div>
          {o.evidence ? `Proof ${o.evidence.ref}, dated ${dateLabel(o.evidence.on)}, by ${o.evidence.by}` : 'No proof recorded'}
          {row.dueOn ? ` · next due ${dateLabel(row.dueOn)}` : ''}
          {o.checked ? ` · ${o.checked.ok ? 'accepted' : 'rejected'} by ${o.checked.by}${o.checked.note ? `: ${o.checked.note}` : ''}` : ''}
        </div>
      </div>
      {row.role === 'company' && (
        <div className="gv-box">
          <div className="gv-box-title">Record proof</div>
          <div className="gv-form">
            <label className="field">
              <span className="label">Done on</span>
              <input className="input" type="date" aria-label="Done on" value={on} onChange={(e) => setOn(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Document or reference</span>
              <input className="input" aria-label="Proof reference" placeholder="Document or reference" value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
            <button className="btn btn-sm btn-primary" disabled={act.busy || !on || !ref.trim()} onClick={() => act.run(() => api.grcEvidence(o.id, on, ref), 'Proof recorded.')}>
              Record proof
            </button>
          </div>
        </div>
      )}
      {row.role === 'auditor' && o.evidence && !o.checked && (
        <div className="gv-box">
          <div className="gv-box-title">Check the proof</div>
          <input className="input" aria-label="Check note" placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="gv-btns">
            <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.grcCheck(o.id, true, note), 'Proof accepted.')}>
              Accept proof
            </button>
            <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.grcCheck(o.id, false, note), 'Proof rejected.')}>
              Reject
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Osh({ data }: { data: GrcBoard }) {
  const [all, setAll] = useState(false);
  const rows = data.osh.filter((s) => all || s.state !== 'ok');
  return (
    <Card
      title="Site risk assessments (HIRARC)"
      sub={`OSHA 1994 s.18B: every site has a risk assessment, reviewed every ${data.rule.oshReviewMonths} months. A site with none is unknown.`}
      flush
      actions={
        <button className="btn btn-sm" aria-pressed={all} onClick={() => setAll(!all)}>
          {all ? 'Hide current' : 'Show current'}
        </button>
      }
    >
      {!rows.length && <Empty title="Every site has a current assessment." />}
      <ul className="gv-list">
        {rows.slice(0, 100).map((s) => (
          <li key={s.siteId}>
            <OshLine s={s} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OshLine({ s }: { s: GrcBoard['osh'][number] }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ assessedOn: '', hazards: '', highRisks: '', controlsRef: '' });
  const tone = s.state === 'ok' ? 'ok' : s.state === 'due_soon' ? 'info' : s.state === 'overdue' ? 'crit' : 'warn';
  const label = {
    ok: 'Current',
    due_soon: 'Review soon',
    overdue: 'Review overdue',
    unknown: 'Unknown: none on file',
  }[s.state];
  return (
    <div className="gv-item" data-tone={toneOf(tone)}>
      <div className="gv-item-head">
        <div className="gv-item-main">
          <div className="gv-item-title">{s.siteName}</div>
          <div className="gv-item-meta">
            {s.companyName}
            {s.last
              ? ` · assessed ${dateLabel(s.last.assessedOn)}, ${s.last.hazards} hazards, ${s.last.highRisks} high · review by ${dateLabel(s.last.nextReviewOn)}`
              : ''}
          </div>
        </div>
        <div className="gv-item-state">
          <Chip tone={tone}>{label}</Chip>
          {s.canRecord && (
            <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
              Record
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="gv-box">
          <div className="gv-form">
            <label className="field">
              <span className="label">Assessed on</span>
              <input className="input" type="date" aria-label="Assessed on" value={f.assessedOn} onChange={(e) => setF({ ...f, assessedOn: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Hazards found</span>
              <input
                className="input"
                aria-label="Hazards"
                placeholder="Hazards found"
                inputMode="numeric"
                value={f.hazards}
                onChange={(e) => setF({ ...f, hazards: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="label">High risk</span>
              <input
                className="input"
                aria-label="High risks"
                placeholder="High risk"
                inputMode="numeric"
                value={f.highRisks}
                onChange={(e) => setF({ ...f, highRisks: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="label">HIRARC reference</span>
              <input
                className="input"
                aria-label="HIRARC reference"
                placeholder="HIRARC reference"
                value={f.controlsRef}
                onChange={(e) => setF({ ...f, controlsRef: e.target.value })}
              />
            </label>
          </div>
          <div className="gv-form-foot">
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy}
              onClick={() =>
                act.run(
                  () =>
                    api.recordOshAssessment(s.siteId, {
                      assessedOn: f.assessedOn,
                      hazards: Number(f.hazards),
                      highRisks: Number(f.highRisks),
                      controlsRef: f.controlsRef,
                    }),
                  'Risk assessment recorded.',
                )
              }
            >
              Save
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Reports({ data }: { data: GrcBoard }) {
  return (
    <div className="gv-stack">
      <Card
        title="Reports you handle"
        sub={`Acknowledge within ${data.rule.whistleAckDays} days. Keep the reporter's identity confidential; never share the report with anyone it names.`}
        flush
      >
        {!data.handled.length && <Empty title="No reports to handle." />}
        <ul className="gv-list">
          {data.handled.map((h) => (
            <li key={h.report.id}>
              <ReportLine h={h} />
            </li>
          ))}
        </ul>
      </Card>
      {data.toReview.length > 0 && (
        <Card title="Closures for a second handler to agree" flush>
          <ul className="gv-list">
            {data.toReview.map((t) => (
              <li key={t.report.id}>
                <ReviewLine t={t} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** The notes on a report, oldest first, as a small timeline. */
function Notes({ notes }: { notes: { at: string; by: string; text: string }[] }) {
  if (!notes.length) return null;
  return (
    <ul className="gv-notes">
      {notes.map((n, i) => (
        <li key={i}>
          <span className="gv-notes-when">
            {dateTimeLabel(n.at)} · {n.by}
          </span>
          <span>{n.text}</span>
        </li>
      ))}
    </ul>
  );
}

function ReviewLine({ t }: { t: GrcBoard['toReview'][number] }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const r = t.report;
  return (
    <div className="gv-item" data-tone="warn">
      <div className="gv-item-head">
        <div className="gv-item-main">
          <div className="gv-item-title">
            <span className="mono">{r.code}</span>: {CATEGORY[r.category]} · {t.companyName}
          </div>
        </div>
      </div>
      <blockquote className="gv-quote">{r.summary}</blockquote>
      <Notes notes={r.notes} />
      <div className="gv-lines">
        <div>
          <span className="gv-k">Proposed outcome</span>
          {r.proposedOutcome}
        </div>
      </div>
      <div className="gv-box">
        <input className="input" aria-label="Review note" placeholder="Note (needed to send it back)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="gv-btns">
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.whistleReview(r.id, true, note), 'Agreed and closed.')}>
            Agree and close
          </button>
          <button
            className="btn btn-sm"
            disabled={act.busy || note.trim().length < 3}
            onClick={() => act.run(() => api.whistleReview(r.id, false, note), 'Sent back for more investigation.')}
          >
            Send back
          </button>
        </div>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function ReportLine({ h }: { h: GrcBoard['handled'][number] }) {
  const act = useAction();
  const [text, setText] = useState('');
  const r = h.report;
  const order = ['received', 'acknowledged', 'investigating', 'closing', 'closed'] as const;
  const at = order.indexOf(r.status);
  const st = (i: number): StepState => (at > i || r.status === 'closed' ? 'done' : at === i ? 'now' : 'todo');
  return (
    <div className="gv-item" data-tone={h.ackLate ? 'crit' : r.status === 'closed' ? undefined : 'warn'}>
      <div className="gv-item-head">
        <div className="gv-item-main">
          <div className="gv-item-title">
            <span className="mono">{r.code}</span>: {CATEGORY[r.category]}
          </div>
          <div className="gv-item-meta">
            {h.companyName} · received {dateTimeLabel(r.at)} · {r.anonymous ? 'anonymous' : `from ${r.reporterName}`}
          </div>
        </div>
        <div className="gv-item-state">
          <Chip tone={h.ackLate ? 'crit' : r.status === 'closed' ? 'ok' : 'warn'}>{h.ackLate ? 'Acknowledge now' : r.status}</Chip>
        </div>
      </div>
      <Steps
        steps={[
          { label: 'Received', state: 'done', note: dateLabel(r.at) },
          { label: 'Acknowledged', state: h.ackLate ? 'stopped' : st(1), note: h.ackLate ? 'Late' : undefined },
          { label: 'Investigating', state: st(2) },
          { label: 'Second handler agrees', state: st(3) },
          { label: 'Closed', state: r.status === 'closed' ? 'done' : 'todo' },
        ]}
      />
      <blockquote className="gv-quote">{r.summary}</blockquote>
      <Notes notes={r.notes} />
      {r.outcome && (
        <div className="gv-lines">
          <div>
            <span className="gv-k">Outcome</span>
            {r.outcome}
          </div>
        </div>
      )}
      {r.status === 'closing' && (
        <div className="gv-lines">
          <div>Proposed outcome: {r.proposedOutcome}. Waiting for a second handler to agree.</div>
        </div>
      )}
      {r.status !== 'closed' && r.status !== 'closing' && (
        <div className="gv-box">
          <label className="field">
            <span className="label">Note, or the outcome when closing</span>
            <input className="input" aria-label="Note or outcome" placeholder="Note, or the outcome when closing" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="gv-btns">
            {r.status === 'received' && (
              <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.whistleStep(r.id, 'acknowledge', ''), 'Acknowledged.')}>
                Acknowledge
              </button>
            )}
            {r.status !== 'investigating' && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.whistleStep(r.id, 'investigate', ''), 'Investigation opened.')}>
                Investigate
              </button>
            )}
            <button className="btn btn-sm" disabled={act.busy || !text.trim()} onClick={() => act.run(() => api.whistleStep(r.id, 'note', text), 'Note added.')}>
              Add note
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || !text.trim()}
              onClick={() => act.run(() => api.whistleStep(r.id, 'close', text), 'Sent to a second handler to agree.')}
            >
              Propose closing
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
