import { useState } from 'react';
import { FinGuide } from './FinGuide';
import type { FinRequestAction } from '@prima/core';
import { api, type FinRequestList } from '../api';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field" style={{ display: 'block', marginBottom: 8 }}>
      <span className="small muted">{label}</span>
      {children}
    </label>
  );
}

export function PaymentRequestsView() {
  const [tick, setTick] = useState(0);
  const { data, error } = useLoad(() => api.finRequests(), [tick]);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="payment requests" />;
  const mine = data.requests.filter((r) => r.may.some((m) => m !== 'cancel'));
  const others = data.requests.filter((r) => !mine.includes(r));
  const sel = data.requests.find((r) => r.id === open) ?? null;
  const done = () => {
    setOpen(null);
    setAdding(false);
    setTick((t) => t + 1);
  };
  return (
    <div className="page">
      <h2>Payment requests</h2>
      <p className="notice" data-tone="info">
        The company head creates the request and chooses what it is for. The head of that department approves, Finance checks the calculation, and the COO (or
        the Finance Director, for Finance) approves. Finance then pays it; that final approval is the payment&apos;s approval. Nobody acts twice on a request,
        and a return sends it back to the company head for the whole chain again.
      </p>
      {data.canCreate.length > 0 && (
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
            New payment request
          </button>
        </div>
      )}
      {[
        ['Waiting for you', mine],
        ['Other requests', others],
      ].map(([title, list]) => (
        <section className="panel" key={title as string}>
          <div className="panel-head">
            <h3>{title as string}</h3>
            <span className="muted small">{(list as Req[]).length}</span>
          </div>
          <div className="list">
            {(list as Req[]).length === 0 && <div className="empty">None.</div>}
            {(list as Req[]).map((r) => (
              <div key={r.id} className="row" style={{ gap: 6, alignItems: 'stretch' }}>
                <button className="list-item" style={{ flex: 1, textAlign: 'left', flexWrap: 'wrap', gap: 6 }} onClick={() => setOpen(r.id)}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {r.title} · {rm(r.amount)}
                    </div>
                    <div className="muted small">
                      {r.companyName} · {r.subjectLabel}
                      {r.sector ? ` (${r.sector})` : ''} · needed by {dateLabel(r.dueOn)}
                      {r.paymentId ? ` · payment ${r.paymentId}` : ''}
                    </div>
                  </div>
                  <Chip tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Chip>
                </button>
                {r.may.includes('resubmit') && (
                  <button
                    className="btn btn-sm btn-primary"
                    style={{ alignSelf: 'center' }}
                    aria-label={`Edit returned request ${r.title}`}
                    onClick={() => setOpen(r.id)}
                  >
                    Edit
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
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
  const chain = [
    ['Created by the company head', r.created.by],
    ...(r.headName ? [[`Approved by the ${r.headName}`, null]] : []),
    ['Calculation checked by Finance', null],
    [`Approved by the ${r.finalName}`, null],
  ];
  return (
    <Drawer title={`${r.title} · ${rm(r.amount)}`} sub={`${r.companyName} · ${r.id}`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <section className="panel">
        <div className="list">
          <div className="list-item">
            <span>Status</span>
            <Chip tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Chip>
          </div>
          <div className="list-item">
            <span>For</span>
            <span>
              {r.subjectLabel}
              {r.sector ? ` (${r.sector} sites)` : ''}
            </span>
          </div>
          <div className="list-item">
            <span>Pay to</span>
            <span>{r.payee}</span>
          </div>
          <div className="list-item">
            <span>Why</span>
            <span>{r.purpose}</span>
          </div>
          <div className="list-item">
            <span>How the amount was worked out</span>
            <span>{r.calc}</span>
          </div>
          <div className="list-item">
            <span>Documents</span>
            <span>{r.evidence.join(', ')}</span>
          </div>
          <div className="list-item">
            <span>The chain</span>
            <span>{chain.map((c) => c[0]).join(' → ')} → Finance pays</span>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>History</h3>
        </div>
        <div className="list">
          <div className="list-item small">
            Created by {r.created.by}, {dateTimeLabel(r.created.at)}
          </div>
          {r.steps.map((s, i) => (
            <div key={i} className="list-item small">
              {s.step.replace('_', ' ')} by {s.by}, {dateTimeLabel(s.at)}
              {s.comment ? `: ${s.comment}` : ''}
            </div>
          ))}
        </div>
      </section>
      {r.may.includes('resubmit') && (
        <section className="panel" style={{ padding: 12 }}>
          <div className="panel-head">
            <h3>Correct and resubmit</h3>
          </div>
          <FinGuide id="fin.request.create" />
          {lastReturn && (
            <p className="notice" data-tone="warn">
              Returned by {lastReturn.by}: {lastReturn.comment}
            </p>
          )}
          <Field label="What the payment is">
            <input className="input" value={e.title} onChange={setF('title')} />
          </Field>
          <Field label="Why it is needed">
            <textarea className="textarea" rows={2} value={e.purpose} onChange={setF('purpose')} />
          </Field>
          <Field label="Amount (RM)">
            <input className="input" inputMode="decimal" value={e.amount} onChange={setF('amount')} />
          </Field>
          <Field label="How the amount was worked out">
            <textarea className="textarea" rows={2} value={e.calc} onChange={setF('calc')} />
          </Field>
          <Field label="Who is paid">
            <input className="input" value={e.payee} onChange={setF('payee')} />
          </Field>
          <Field label="Needed by">
            <input className="input" type="date" value={e.dueOn} onChange={setF('dueOn')} />
          </Field>
          <div className="muted small">Documents attached (kept): {r.evidence.join(', ')}</div>
          <Field label="Add documents (one per line)">
            <textarea className="textarea" rows={2} value={e.docs} onChange={setF('docs')} />
          </Field>
          <Field label="What you changed">
            <textarea className="textarea" rows={2} value={comment} onChange={(x) => setComment(x.target.value)} />
          </Field>
          <button className="btn btn-sm btn-primary" disabled={act.busy || !(Number(e.amount) > 0)} onClick={() => void resubmit()}>
            Save and resubmit
          </button>
        </section>
      )}
      {r.may.some((a) => a !== 'resubmit') && (
        <section className="panel">
          <FinGuide id="fin.request.check" />
          <Field label="Comment (every step needs one; a return needs the reason)">
            <textarea className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {r.may
              .filter((a) => a !== 'resubmit')
              .map((a) => (
                <button
                  key={a}
                  className={`btn btn-sm ${a === 'return' || a === 'cancel' ? '' : 'btn-primary'}`}
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
      {data.canCreate.length > 1 && (
        <Field label="Company">
          <select className="select" value={f.companyId} onChange={set('companyId')}>
            {data.canCreate.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="What it is for">
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
      <p className="muted small">
        Chain:{' '}
        {subj?.id === 'operations' ? (f.sector === 'government' ? 'Operations General Manager' : 'Operations Director') : (subj?.head ?? 'no department head')}{' '}
        → Finance checks the calculation → {subj?.final} → Finance pays.
      </p>
      <Field label="What the payment is">
        <input className="input" value={f.title} onChange={set('title')} />
      </Field>
      <Field label="Why it is needed">
        <textarea className="textarea" rows={2} value={f.purpose} onChange={set('purpose')} />
      </Field>
      <Field label="Amount (RM)">
        <input className="input" inputMode="decimal" value={f.amount} onChange={set('amount')} />
      </Field>
      <Field label="How the amount was worked out (Finance checks it)">
        <textarea className="textarea" rows={2} value={f.calc} onChange={set('calc')} />
      </Field>
      <Field label="Who is paid">
        <input className="input" value={f.payee} onChange={set('payee')} />
      </Field>
      <Field label="Needed by">
        <input className="input" type="date" value={f.dueOn} onChange={set('dueOn')} />
      </Field>
      <Field label="Supporting documents, one per line (never bank passwords or account numbers)">
        <textarea className="textarea" rows={2} value={f.evidence} onChange={set('evidence')} />
      </Field>
      <button className="btn btn-primary" disabled={act.busy} onClick={() => void submit()}>
        Create request
      </button>
    </Drawer>
  );
}
