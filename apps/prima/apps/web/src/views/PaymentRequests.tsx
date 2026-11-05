import { useState } from 'react';
import { CheckCircleIcon, HourglassIcon, PlusIcon, TrayIcon, ArrowUUpLeftIcon } from '@phosphor-icons/react';
import { FinGuide } from './FinGuide';
import type { FinRequestAction } from '@prima/core';
import { api, type FinRequestList } from '../api';
import { Card, Empty, Facts, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import '../styles/biz.css';

/**
 * Payment requests (Fauzan, 1 Nov 2026): the company head creates the request and says what it is for; the head of that
 * department approves; Finance checks the calculation; the COO (or the Finance Director for Finance) approves; then
 * Finance prepares and pays it. The request's final approval is the payment's approval, never given twice.
 */

type Req = FinRequestList['requests'][number];
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS: Record<Req['status'], [Tone, string]> = {
  head_review: ['warn', 'With the department head'],
  finance_verify: ['warn', 'Finance checking the calculation'],
  final_approval: ['warn', 'Waiting for final approval'],
  approved: ['ok', 'Approved'],
  returned: ['crit', 'Returned to the company head'],
  cancelled: ['neutral', 'Cancelled'],
};
const ACT: Record<FinRequestAction, string> = {
  head: 'Approve as department head',
  verify: 'Calculation is correct',
  approve: 'Approve',
  return: 'Return',
  resubmit: 'Resubmit',
  cancel: 'Cancel',
};
const IN_PROGRESS: Req['status'][] = ['head_review', 'finance_verify', 'final_approval'];

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <label className={span ? 'field bz-span' : 'field'}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

/** Where a request is in its chain: created, department head (when there is one), Finance check, final approval, Finance pays. */
function chainSteps(r: Req): { label: string; state: StepState; note?: string }[] {
  const keys: ('created' | 'head' | 'verify' | 'final' | 'pay')[] = ['created', ...(r.headName ? (['head'] as const) : []), 'verify', 'final', 'pay'];
  const label = {
    created: 'Created by the company head',
    head: `Approved by the ${r.headName}`,
    verify: 'Calculation checked by Finance',
    final: `Approved by the ${r.finalName}`,
    pay: 'Finance pays',
  };
  const at: Record<Req['status'], number> = {
    head_review: keys.indexOf('head'),
    finance_verify: keys.indexOf('verify'),
    final_approval: keys.indexOf('final'),
    approved: keys.indexOf('pay'),
    returned: 0,
    cancelled: 0,
  };
  const now = at[r.status];
  const stopped = r.status === 'returned' || r.status === 'cancelled';
  return keys.map((k, i) => ({
    label: label[k],
    state: stopped ? (i === 0 ? 'stopped' : 'todo') : i < now ? 'done' : i === now ? 'now' : 'todo',
    note:
      k === 'created'
        ? stopped
          ? STATUS[r.status][1]
          : r.created.by
        : k === 'pay' && r.paymentId
          ? `Payment ${r.paymentId}`
          : undefined,
  }));
}

/** A compact progress strip for a row: one segment per step of the chain. */
function Track({ r }: { r: Req }) {
  const steps = chainSteps(r);
  const done = steps.filter((s) => s.state === 'done').length;
  return (
    <span className="bz-pr-track" aria-label={`Step ${Math.min(done + 1, steps.length)} of ${steps.length}`}>
      {steps.map((s, i) => (
        <span key={i} data-state={s.state} />
      ))}
    </span>
  );
}

export function PaymentRequestsView() {
  const [tick, setTick] = useState(0);
  const { data, error } = useLoad(() => api.finRequests(), [tick]);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="payment requests" />
      </div>
    );
  const mine = data.requests.filter((r) => r.may.some((m) => m !== 'cancel'));
  const others = data.requests.filter((r) => !mine.includes(r));
  const sel = data.requests.find((r) => r.id === open) ?? null;
  const done = () => {
    setOpen(null);
    setAdding(false);
    setTick((t) => t + 1);
  };
  const sum = (list: Req[]) => rm(list.reduce((a, r) => a + r.amount, 0));
  const moving = data.requests.filter((r) => IN_PROGRESS.includes(r.status));
  const returned = data.requests.filter((r) => r.status === 'returned');
  const approved = data.requests.filter((r) => r.status === 'approved');
  return (
    <div className="page bz-pr-page">
      <PageHead
        title="Payment requests"
        sub="The company head creates the request and chooses what it is for. The head of that department approves, Finance checks the calculation, and the COO (or the Finance Director, for Finance) approves. Finance then pays it; that final approval is the payment's approval. Nobody acts twice on a request, and a return sends it back to the company head for the whole chain again."
        actions={
          data.canCreate.length > 0 && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <PlusIcon size={16} weight="bold" aria-hidden="true" />
              New payment request
            </button>
          )
        }
      />
      <Stats>
        <Stat label="Waiting for you" value={mine.length} note={mine.length ? sum(mine) : 'Nothing to act on'} tone={mine.length ? 'warn' : undefined} icon={<TrayIcon size={16} />} />
        <Stat label="In the chain" value={moving.length} note={moving.length ? sum(moving) : 'None moving'} tone="info" icon={<HourglassIcon size={16} />} />
        <Stat label="Returned" value={returned.length} note="Back with the company head" tone={returned.length ? 'crit' : undefined} icon={<ArrowUUpLeftIcon size={16} />} />
        <Stat label="Approved" value={approved.length} note={approved.length ? sum(approved) : 'Finance pays approved requests'} tone={approved.length ? 'ok' : undefined} icon={<CheckCircleIcon size={16} />} />
      </Stats>
      {(
        [
          ['Waiting for you', mine, 'Your step in the chain. Open one to approve, check or return it.'],
          ['Other requests', others, 'Requests you can see that are with someone else, or finished.'],
        ] as [string, Req[], string][]
      ).map(([title, list, sub]) => (
        <Card key={title} title={title} sub={sub} actions={<span className="bz-count">{list.length}</span>} flush>
          {list.length === 0 ? (
            <Empty title="None." />
          ) : (
            <ul className="bz-rows">
              {list.map((r) => (
                <li key={r.id} className="bz-pr-item">
                  <button className="bz-row bz-pr-row" data-tone={r.status === 'returned' ? 'crit' : title === 'Waiting for you' ? 'warn' : undefined} onClick={() => setOpen(r.id)}>
                    <span className="bz-row-main">
                      <span className="bz-row-title">{r.title}</span>
                      <span className="bz-row-meta">
                        {r.companyName} · {r.subjectLabel}
                        {r.sector ? ` (${r.sector})` : ''} · needed by {dateLabel(r.dueOn)}
                        {r.paymentId ? ` · payment ${r.paymentId}` : ''}
                      </span>
                      <span className="bz-pr-progress">
                        <Track r={r} />
                        <Chip tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Chip>
                      </span>
                    </span>
                    <span className="bz-row-side">
                      <span className="bz-amt bz-pr-amt">{rm(r.amount)}</span>
                    </span>
                  </button>
                  {r.may.includes('resubmit') && (
                    <button className="btn btn-sm btn-primary bz-pr-edit" aria-label={`Edit returned request ${r.title}`} onClick={() => setOpen(r.id)}>
                      Edit
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      {sel && <RequestDrawer r={sel} onClose={() => setOpen(null)} onDone={done} />}
      {adding && <NewRequest data={data} onClose={() => setAdding(false)} onDone={done} />}
    </div>
  );
}

function RequestDrawer({ r, onClose, onDone }: { r: Req; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [comment, setComment] = useState('');
  const [e, setE] = useState({ title: r.title, purpose: r.purpose, amount: String(r.amount), payee: r.payee, dueOn: r.dueOn, calc: r.calc, docs: '' });
  const setF = (k: keyof typeof e) => (x: { target: { value: string } }) => setE((v) => ({ ...v, [k]: x.target.value }));
  const lastReturn = [...r.steps].reverse().find((s) => s.step === 'returned');
  const resubmit = async () => {
    const ok = await act.run(
      () =>
        api.finRequestStep(r.companyId, r.id, 'resubmit', {
          subject: r.subject,
          sector: r.sector,
          title: e.title,
          purpose: e.purpose,
          amount: Number(e.amount),
          payee: e.payee,
          dueOn: e.dueOn,
          calc: e.calc,
          evidence: [
            ...r.evidence,
            ...e.docs
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean),
          ],
          comment,
        }),
      'Corrected and sent along the chain again.',
    );
    if (ok) onDone();
  };
  const run = async (a: FinRequestAction) => {
    const ok = await act.run(() => api.finRequestStep(r.companyId, r.id, a, { comment }), `${ACT[a]}: done.`);
    if (ok) onDone();
  };
  return (
    <Drawer title={r.title} sub={`${r.companyName} · ${r.id}`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <div className="bz-pr-total">
        <strong className="bz-amt">{rm(r.amount)}</strong>
        <Chip tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Chip>
      </div>
      <section className="bz-sec">
        <h3>The chain</h3>
        <Steps steps={chainSteps(r)} />
      </section>
      <div className="bz-facts">
        <Facts
          items={[
            ['For', `${r.subjectLabel}${r.sector ? ` (${r.sector} sites)` : ''}`],
            ['Pay to', r.payee],
            ['Needed by', dateLabel(r.dueOn)],
            ['Payment', r.paymentId ?? 'Not prepared yet'],
          ]}
        />
      </div>
      <section className="bz-sec">
        <h3>Why</h3>
        <p className="bz-pr-text">{r.purpose}</p>
      </section>
      <section className="bz-sec">
        <h3>How the amount was worked out</h3>
        <p className="bz-pr-text">{r.calc}</p>
      </section>
      <section className="bz-sec">
        <h3>Documents</h3>
        {r.evidence.length === 0 ? (
          <p className="muted small">None listed.</p>
        ) : (
          <ul className="bz-pr-docs">
            {r.evidence.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="bz-sec">
        <h3>History</h3>
        <ol className="bz-pr-history">
          <li>
            <span>Created by {r.created.by}</span>
            <time>{dateTimeLabel(r.created.at)}</time>
          </li>
          {r.steps.map((s, i) => (
            <li key={i}>
              <span>
                {s.step.replace('_', ' ')} by {s.by}
                {s.comment ? `: ${s.comment}` : ''}
              </span>
              <time>{dateTimeLabel(s.at)}</time>
            </li>
          ))}
        </ol>
      </section>
      {r.may.includes('resubmit') && (
        <section className="bz-act">
          <h3 className="bz-pr-act-title">Correct and resubmit</h3>
          <FinGuide id="fin.request.create" />
          {lastReturn && (
            <p className="notice" data-tone="warn">
              Returned by {lastReturn.by}: {lastReturn.comment}
            </p>
          )}
          <div className="bz-form">
            <Field label="What the payment is" span>
              <input className="input" value={e.title} onChange={setF('title')} />
            </Field>
            <Field label="Why it is needed" span>
              <textarea className="textarea" rows={2} value={e.purpose} onChange={setF('purpose')} />
            </Field>
            <Field label="Amount (RM)">
              <input className="input" inputMode="decimal" value={e.amount} onChange={setF('amount')} />
            </Field>
            <Field label="Needed by">
              <input className="input" type="date" value={e.dueOn} onChange={setF('dueOn')} />
            </Field>
            <Field label="How the amount was worked out" span>
              <textarea className="textarea" rows={2} value={e.calc} onChange={setF('calc')} />
            </Field>
            <Field label="Who is paid" span>
              <input className="input" value={e.payee} onChange={setF('payee')} />
            </Field>
            <div className="bz-span bz-note">Documents attached (kept): {r.evidence.join(', ')}</div>
            <Field label="Add documents (one per line)" span>
              <textarea className="textarea" rows={2} value={e.docs} onChange={setF('docs')} />
            </Field>
            <Field label="What you changed" span>
              <textarea className="textarea" rows={2} value={comment} onChange={(x) => setComment(x.target.value)} />
            </Field>
          </div>
          <div className="bz-actions">
            <button className="btn btn-primary" disabled={act.busy || !(Number(e.amount) > 0)} onClick={() => void resubmit()}>
              Save and resubmit
            </button>
          </div>
        </section>
      )}
      {r.may.some((a) => a !== 'resubmit') && (
        <section className="bz-act">
          <h3 className="bz-pr-act-title">Your step</h3>
          <FinGuide id="fin.request.check" />
          <Field label="Comment (every step needs one; a return needs the reason)">
            <textarea className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div className="bz-actions">
            {r.may
              .filter((a) => a !== 'resubmit')
              .map((a) => (
                <button
                  key={a}
                  className={`btn ${a === 'return' || a === 'cancel' ? '' : 'btn-primary'}`}
                  disabled={act.busy || !comment.trim()}
                  onClick={() => void run(a)}
                >
                  {ACT[a]}
                </button>
              ))}
          </div>
        </section>
      )}
    </Drawer>
  );
}

function NewRequest({ data, onClose, onDone }: { data: FinRequestList; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    companyId: data.canCreate[0] ?? '',
    subject: 'operations',
    sector: 'government',
    title: '',
    purpose: '',
    amount: '',
    payee: '',
    dueOn: '',
    calc: '',
    evidence: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const subj = data.subjects.find((s) => s.id === f.subject);
  const submit = async () => {
    const ok = await act.run(
      () =>
        api.finCreateRequest(f.companyId, {
          ...f,
          sector: f.subject === 'operations' ? f.sector : null,
          amount: Number(f.amount),
          evidence: f.evidence
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean),
        }),
      'Request created. It goes to the next person in the chain.',
    );
    if (ok) onDone();
  };
  return (
    <Drawer title="New payment request" sub="Choose what it is for; that decides who approves" onClose={onClose}>
      <FinGuide id="fin.request.create" />
      <ErrorNotice error={act.error} />
      <div className="bz-form">
        {data.canCreate.length > 1 && (
          <Field label="Company" span>
            <select className="select" value={f.companyId} onChange={set('companyId')}>
              {data.canCreate.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="What it is for" span={f.subject !== 'operations'}>
          <select className="select" value={f.subject} onChange={set('subject')}>
            {data.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        {f.subject === 'operations' && (
          <Field label="Sites">
            <select className="select" value={f.sector} onChange={set('sector')}>
              <option value="government">Government (the Operations General Manager approves)</option>
              <option value="private">Private (the Operations Director approves)</option>
            </select>
          </Field>
        )}
        <p className="bz-span bz-pr-chain">
          Chain:{' '}
          {subj?.id === 'operations' ? (f.sector === 'government' ? 'Operations General Manager' : 'Operations Director') : (subj?.head ?? 'no department head')}{' '}
          → Finance checks the calculation → {subj?.final} → Finance pays.
        </p>
        <Field label="What the payment is" span>
          <input className="input" value={f.title} onChange={set('title')} />
        </Field>
        <Field label="Why it is needed" span>
          <textarea className="textarea" rows={2} value={f.purpose} onChange={set('purpose')} />
        </Field>
        <Field label="Amount (RM)">
          <input className="input" inputMode="decimal" value={f.amount} onChange={set('amount')} />
        </Field>
        <Field label="Needed by">
          <input className="input" type="date" value={f.dueOn} onChange={set('dueOn')} />
        </Field>
        <Field label="How the amount was worked out (Finance checks it)" span>
          <textarea className="textarea" rows={2} value={f.calc} onChange={set('calc')} />
        </Field>
        <Field label="Who is paid" span>
          <input className="input" value={f.payee} onChange={set('payee')} />
        </Field>
        <Field label="Supporting documents, one per line (never bank passwords or account numbers)" span>
          <textarea className="textarea" rows={2} value={f.evidence} onChange={set('evidence')} />
        </Field>
      </div>
      <div className="bz-form-foot">
        <button className="btn btn-primary" disabled={act.busy} onClick={() => void submit()}>
          Create request
        </button>
      </div>
    </Drawer>
  );
}
