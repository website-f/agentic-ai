import { useState } from 'react';
import type { FinCloseAction, FinPackItem, FinPackKind, FinPackStatus, FinPaymentAction, FinPlanLine, FinSubject } from '@prima/core';
import { LINE_LABEL } from './FinanceChecks';
import { api, type FinDesk } from '../api';
import { FinGuide } from './FinGuide';
import {
  ArrowUUpLeftIcon,
  BankIcon,
  CheckCircleIcon,
  HourglassMediumIcon,
  ListChecksIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  SealCheckIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { Chip, Drawer, ErrorNotice, dateLabel, dateTimeLabel, useAction, type Tone } from '../ui';
import { Card, Empty, Stat, Stats, Steps, type StepState } from '../kit';
import '../styles/finance.css';

/**
 * Finance Phase 2 (31 Oct 2026). Payments, the month-end close and the bank and payment packs. SQL Account keeps the
 * books and the bank portal moves the money: Prima holds the approvals, the evidence and who did what. Nobody reviews,
 * approves or releases what they prepared, nobody releases a payment they approved, and every approval has a comment.
 */

type Co = FinDesk['companies'][number];
type Pay = Co['payments'][number];

const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAY: Record<Pay['status'], [Tone, string]> = {
  prepared: ['warn', 'To review'],
  reviewed: ['warn', 'To approve'],
  approved: ['info', 'To release'],
  released: ['ok', 'Released'],
  returned: ['crit', 'Returned'],
  cancelled: ['neutral', 'Cancelled'],
};
const NEEDS: Record<Pay['needs'], string> = {
  leader: 'Finance Director or the CEO',
  director: 'Finance Director or the CEO',
  ceo: 'Finance Director or the CEO',
  coo: 'COO or the CEO',
};
/** What a payment is for decides who approves it (Fauzan, 1 Nov 2026: by subject matter). */
export const SUBJECT: Record<FinSubject, string> = {
  finance: 'Finance (FD or CEO approves)',
  operations: 'Operations (COO or CEO approves)',
  it: 'IT (COO or CEO approves)',
  fwm: 'Foreign Worker Management (COO or CEO approves)',
  inventory: 'Procurement & Inventory (COO or CEO approves)',
  transport: 'Transport (COO or CEO approves)',
  goodwill: 'Goodwill Empire (COO or CEO approves)',
};
const ACT: Record<FinPaymentAction, [string, string]> = {
  review: ['Review', 'Comment (needed to review; a short one is fine)'],
  approve: ['Approve', 'Comment (needed to approve; a short one is fine)'],
  return: ['Return', 'What to fix (at least 10 characters)'],
  resubmit: ['Resubmit', 'What you changed (optional)'],
  release: ['Record release', 'Note (optional)'],
  cancel: ['Cancel', 'Why (at least 10 characters)'],
  link: ['Link approval', 'Teams or SharePoint approval'],
};
const CLOSE: Record<string, [Tone, string]> = {
  open: ['warn', 'Open'],
  prepared: ['warn', 'To review'],
  reviewed: ['info', 'Waiting for approval'],
  approved: ['ok', 'Approved financials'],
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

// ---------- Payments ----------

export function PaymentsTab({ desk }: { desk: FinDesk }) {
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const openPay = (id: string, edit = false) => {
    setOpen(id);
    setEditing(edit);
  };
  const all = desk.companies.flatMap((c) => c.payments.map((p) => ({ c, p })));
  const mine = all.filter(({ p }) => p.may.some((m) => m !== 'cancel'));
  const others = all.filter((x) => !mine.includes(x)).sort((a, b) => (a.p.status === 'released' ? 1 : 0) - (b.p.status === 'released' ? 1 : 0));
  const sel = all.find((x) => x.p.id === open) ?? null;
  const canAdd = desk.companies.some((c) => c.canAct);
  const returned = all.filter(({ p }) => p.status === 'returned').length;
  const toRelease = all.filter(({ p }) => p.status === 'approved').length;
  const short = desk.companies.reduce((n, c) => n + c.cash.filter((x) => (x.short7 ?? 0) > 0).length, 0);
  return (
    <>
      <Stats>
        <Stat label="Waiting for you" value={mine.length} tone={mine.length ? 'warn' : 'ok'} icon={<HourglassMediumIcon size={18} />} />
        <Stat label="Returned" value={returned} tone={returned ? 'crit' : 'ok'} note="Back with the preparer" icon={<ArrowUUpLeftIcon size={18} />} />
        <Stat label="To release" value={toRelease} tone={toRelease ? 'info' : 'ok'} note="Approved, not yet paid in the bank portal" icon={<PaperPlaneTiltIcon size={18} />} />
        <Stat label="Bank accounts short this week" value={short} tone={short ? 'crit' : 'ok'} note="For approved payments" icon={<BankIcon size={18} />} />
      </Stats>
      <Card
        title="Waiting for you"
        sub={`${mine.length} payment${mine.length === 1 ? '' : 's'}`}
        actions={
          canAdd ? (
            <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
              <PlusIcon size={14} aria-hidden="true" />
              New payment
            </button>
          ) : undefined
        }
        flush
      >
        {mine.length === 0 ? (
          <Empty title="Nothing waiting for you." />
        ) : (
          <div className="fin-pays">
            {mine.map(({ c, p }) => (
              <PayLine key={p.id} c={c} p={p} onOpen={openPay} />
            ))}
          </div>
        )}
      </Card>
      <CashPanel desk={desk} />
      <Card title="Other payments" sub="Open, and closed in the last 60 days" flush>
        {others.length === 0 ? (
          <Empty title="None." />
        ) : (
          <div className="fin-pays">
            {others.map(({ c, p }) => (
              <PayLine key={p.id} c={c} p={p} onOpen={openPay} />
            ))}
          </div>
        )}
      </Card>
      <p className="notice" data-tone="info">
        Prima approves; the bank portal pays. One person never approves and releases the same payment. Approval is by subject (Fauzan, 1 Nov 2026: only the FD,
        the CEO and the COO approve anything): Finance payments by the Finance Director or the CEO; payments for the departments the COO monitors by the COO or
        the CEO. Team leaders and deputies review; Finance releases. The CEO is also reminded of payments of {rm(desk.rule.ceoNoticeFrom)} or more.
      </p>
      {sel && <PaymentDrawer key={`${sel.p.id}-${editing}`} c={sel.c} p={sel.p} startEdit={editing} onClose={() => setOpen(null)} />}
      {adding && <NewPayment desk={desk} onClose={() => setAdding(false)} />}
    </>
  );
}

/** Cash needed (automation, 1 Nov 2026): approved payments due in 7 and 30 days against each bank's last known balance. */
function CashPanel({ desk }: { desk: FinDesk }) {
  const rows = desk.companies.flatMap((c) => c.cash.filter((x) => x.due30 > 0 || (x.short7 ?? 0) > 0).map((x) => ({ c, x })));
  if (rows.length === 0) return null;
  return (
    <Card title="Cash needed for approved payments" sub="balance = last statement's closing less payments released since" flush>
      <table className="fin-table">
        <thead>
          <tr>
            <th>Company and bank</th>
            <th className="fin-num">Balance</th>
            <th className="fin-num">Due in 7 days</th>
            <th className="fin-num">Due in 30 days</th>
            <th>Cover</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c, x }) => (
            <tr key={`${c.companyId}-${x.bankId}`}>
              <td>
                <span className="fin-strong">{c.companyName}</span>
                <span className="muted small fin-block">{x.bank}</span>
              </td>
              <td className="fin-num">
                {x.balance == null ? (
                  <span className="muted">No statement loaded, balance unknown</span>
                ) : (
                  <>
                    {rm(x.balance)}
                    <span className="muted small fin-block">at {dateLabel(x.balanceAsOf!)}</span>
                  </>
                )}
              </td>
              <td className="fin-num">{rm(x.due7)}</td>
              <td className="fin-num">{rm(x.due30)}</td>
              <td>
                {x.balance == null ? (
                  <Chip tone="warn">Unknown</Chip>
                ) : x.short7 ? (
                  <Chip tone="crit">Short {rm(x.short7)} this week</Chip>
                ) : x.short30 ? (
                  <Chip tone="warn">Short {rm(x.short30)} in 30 days</Chip>
                ) : (
                  <Chip tone="ok">Enough</Chip>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function PayLine({ c, p, onOpen }: { c: Co; p: Pay; onOpen: (id: string, edit?: boolean) => void }) {
  return (
    <div className="fin-pay" data-tone={p.status === 'returned' ? 'crit' : undefined}>
      <button type="button" className="fin-pay-main" onClick={() => onOpen(p.id)}>
        <span className="fin-pay-text">
          <span className="fin-pay-payee">{p.payee}</span>
          <span className="muted small">
            {c.companyName} · Team {c.team} · {p.sqlRef} · due {dateLabel(p.dueOn)} · needs the {NEEDS[p.needs]}
          </span>
        </span>
        <span className="fin-pay-amount">{rm(p.amount)}</span>
        <span className="fin-chips fin-pay-tags">
          {p.budget && p.budget.over > 0 && <Chip tone="warn">Over budget {rm(p.budget.over)}</Chip>}
          {p.watch.length > 0 && <Chip tone="info">{p.watch[0]}</Chip>}
          <Chip tone={PAY[p.status][0]}>{p.status === 'reviewed' && p.approvalMethod === 'teams' ? 'Waiting for approval in Teams' : PAY[p.status][1]}</Chip>
        </span>
      </button>
      {p.may.includes('resubmit') && (
        <button className="btn btn-sm btn-primary fin-pay-edit" aria-label={`Edit returned payment to ${p.payee}`} onClick={() => onOpen(p.id, true)}>
          Edit
        </button>
      )}
    </div>
  );
}

function PaymentDrawer({ c, p, startEdit = false, onClose }: { c: Co; p: Pay; startEdit?: boolean; onClose: () => void }) {
  const act = useAction();
  const [editing, setEditing] = useState(startEdit && p.may.includes('resubmit'));
  const [comment, setComment] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [last4, setLast4] = useState('');
  const [acctName, setAcctName] = useState('');
  const [coId, setCoId] = useState('');
  const run = (a: FinPaymentAction) =>
    act.run(
      () =>
        api.finPaymentStep(
          c.companyId,
          p.id,
          a,
          a === 'release' ? { comment, bankRef, accountLast4: last4, accountName: acctName, coApproverId: coId || undefined } : { comment },
        ),
      `${ACT[a][0]}: done.`,
    );
  const needsText = (a: FinPaymentAction) =>
    a === 'review' || a === 'approve'
      ? !comment.trim()
      : a === 'return' || a === 'cancel'
        ? comment.trim().length < 10
        : a === 'release'
          ? bankRef.trim().length < 4 || (!!p.payeeId && (!/^\d{4}$/.test(last4) || acctName.trim().length < 2))
          : false;
  const ext = p.external ?? null;
  return (
    <Drawer title={`${p.payee} · ${rm(p.amount)}`} sub={`${c.companyName} · ${p.id}`} onClose={onClose}>
      {editing && <EditReturned c={c} p={p} onDone={onClose} onCancel={() => setEditing(false)} />}
      <section className="panel">
        <div className="list fin-dl">
          <div className="list-item">
            <span>Status</span>
            <Chip tone={PAY[p.status][0]}>{p.status === 'reviewed' && p.approvalMethod === 'teams' ? 'Waiting for approval in Teams' : PAY[p.status][1]}</Chip>
          </div>
          <div className="list-item">
            <span>Purpose</span>
            <span>{p.purpose}</span>
          </div>
          <div className="list-item">
            <span>Pay from</span>
            <span>{p.bank ? `${p.bank.bank} ${p.bank.accountMasked}` : p.bankId}</span>
          </div>
          <div className="list-item">
            <span>SQL Account document</span>
            <span>{p.sqlRef}</span>
          </div>
          {p.invoiceNo && (
            <div className="list-item">
              <span>Supplier's invoice number</span>
              <span>{p.invoiceNo}</span>
            </div>
          )}
          {p.notDuplicate && (
            <div className="list-item">
              <span>Similar payment found</span>
              <span>
                <Chip tone="warn">Check</Chip> <span className="small">{p.notDuplicate}</span>
              </span>
            </div>
          )}
          <div className="list-item">
            <span>e-Invoice</span>
            <span>{p.eInvoiceRef ?? (p.payeeKind === 'supplier' ? 'No e-Invoice UUID' : '–')}</span>
          </div>
          {p.teams && (
            <div className="list-item">
              <span>Teams approval read by Prima</span>
              <span>
                <Chip tone={p.teams.verdict === 'approved' ? 'ok' : p.teams.verdict === 'rejected' ? 'crit' : 'warn'}>{p.teams.verdict.replace('_', ' ')}</Chip>
                {p.teams.failures.length > 0 && <span className="muted small"> {p.teams.failures.join('; ')}</span>}
              </span>
            </div>
          )}
          {p.expiresOn && (
            <div className="list-item">
              <span>Approval valid until</span>
              <span>{dateLabel(p.expiresOn)} (then it goes back for approval)</span>
            </div>
          )}
          <div className="list-item">
            <span>Subject</span>
            <span>{SUBJECT[p.subject ?? 'finance']}</span>
          </div>
          <div className="list-item">
            <span>Budget line</span>
            <span>
              {p.budget
                ? `${LINE_LABEL[p.budget.line]} · ${p.budget.year} budget ${rm(p.budget.budget)}, spent and committed ${rm(p.budget.committed)}`
                : p.budgetLine
                  ? `${LINE_LABEL[p.budgetLine]} · no approved budget for the year`
                  : 'Not given'}
            </span>
          </div>
          {p.budget && p.budget.over > 0 && (
            <p className="notice" data-tone="warn">
              This payment takes {LINE_LABEL[p.budget.line]} over its approved {p.budget.year} budget by {rm(p.budget.over)}. Say why in your comment if you
              review or approve it. Prima only warns; it never blocks or approves.
            </p>
          )}
          <div className="list-item">
            <span>Final approval by</span>
            <span>{NEEDS[p.needs]}</span>
          </div>
          {p.payeeBank && (
            <div className="list-item">
              <span>Pay to (verified, at approval)</span>
              <span>
                {p.payeeBank.bank} ending {p.payeeBank.accountLast4} · {p.payeeBank.accountName}
              </span>
            </div>
          )}
          {p.releaseCheck && (
            <div className="list-item">
              <span>Bank portal showed at release</span>
              <span>
                ending {p.releaseCheck.accountLast4} · {p.releaseCheck.accountName}
              </span>
            </div>
          )}
          {p.cleared && (
            <div className="list-item">
              <span>On the bank statement</span>
              <span>{dateLabel(p.cleared.date)}</span>
            </div>
          )}
          {p.bankRef && (
            <div className="list-item">
              <span>Bank reference</span>
              <span>
                {p.bankRef} · {dateLabel(p.releasedOn)}
              </span>
            </div>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Supporting documents</h3>
        </div>
        <div className="list">
          {p.evidence.map((e) => (
            <div key={e} className="list-item">
              {e}
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Teams or SharePoint approval</h3>
        </div>
        {ext ? (
          <div className="list">
            <div className="list-item">
              <div className="fin-min0">
                <a href={ext.url} target="_blank" rel="noreferrer">
                  {ext.system === 'teams' ? 'Teams' : 'SharePoint'}: {ext.requestRef}
                </a>
                <div className="muted small">
                  Linked by {ext.recordedBy}, {dateTimeLabel(ext.recordedAt)}
                </div>
              </div>
            </div>
            {ext.decisions.length === 0 && <div className="empty">No decisions recorded yet.</div>}
            {ext.decisions.map((d, i) => (
              <div key={i} className="list-item">
                <div className="fin-min0">
                  <div>
                    {d.approver} · {dateLabel(d.decidedOn)}
                  </div>
                  <div className="muted small">"{d.comment}"</div>
                </div>
                <Chip tone={d.decision === 'approved' ? 'ok' : 'crit'}>{d.decision === 'approved' ? 'Approved' : 'Rejected'}</Chip>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            Not linked. If the request went through SharePoint and Teams, link it here so the approvers' decisions and comments sit with the payment.
          </div>
        )}
        {p.may.includes('link') && <LinkApproval c={c} p={p} />}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Who did what</h3>
        </div>
        <div className="list">
          {p.steps.map((s, i) => (
            <div key={i} className="list-item">
              <div>
                <div>
                  {s.step} by {s.by}
                </div>
                {s.comment && <div className="muted small">{s.comment}</div>}
              </div>
              <span className="muted small">{dateTimeLabel(s.at)}</span>
            </div>
          ))}
        </div>
      </section>
      {p.may.some((a) => a !== 'link') && (
        <section className="panel fin-pad">
          <FinGuide id={p.may.includes('release') ? 'fin.payment.release' : p.may.includes('approve') ? 'fin.payment.approve' : 'fin.payment.review'} />
          <ErrorNotice error={act.error} />
          {p.may.includes('release') && (
            <>
              {p.payeeId && (
                <>
                  <p className="notice" data-tone="warn">
                    Before you release: read the account the bank portal will pay. Type its last 4 digits and the account name it shows. Prima stops the release
                    if they differ from {p.payee}'s verified details.
                  </p>
                  <Field label="Last 4 digits the bank portal shows">
                    <input className="input" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} />
                  </Field>
                  <Field label="Account name the bank portal shows">
                    <input className="input" value={acctName} onChange={(e) => setAcctName(e.target.value)} />
                  </Field>
                </>
              )}
              <Field label="The bank's reference for this payment (from the bank portal)">
                <input className="input" value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
              </Field>
              {p.mandate && (
                <Field
                  label={`Second approver in the bank (mandate ${p.mandate.rule === 'any_two' ? 'needs two' : p.mandate.twoAbove != null ? `needs two above ${rm(p.mandate.twoAbove)}` : 'one is enough unless above a personal limit'})`}
                >
                  <select className="select" value={coId} onChange={(e) => setCoId(e.target.value)}>
                    <option value="">None needed</option>
                    {p.mandate.approvers.map((x) => (
                      <option key={x.userId} value={x.userId}>
                        {x.name}
                        {x.limit != null ? ` (limit ${rm(x.limit)})` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
          <Field label={ACT[p.may.find((a) => a !== 'link') ?? 'review'][1]}>
            <textarea className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div className="row">
            {p.may
              .filter((a) => a !== 'resubmit' && a !== 'link')
              .map((a) => (
                <button
                  key={a}
                  className={`btn btn-sm${a === 'approve' || a === 'review' || a === 'release' ? ' btn-primary' : ''}`}
                  disabled={act.busy || needsText(a)}
                  onClick={() => run(a)}
                >
                  {ACT[a][0]}
                </button>
              ))}
            {p.may.includes('resubmit') && !editing && (
              <button className="btn btn-sm btn-primary" onClick={() => setEditing(true)}>
                Edit and resubmit
              </button>
            )}
            {p.may.includes('resubmit') && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => run('resubmit')}>
                Resubmit as it is
              </button>
            )}
          </div>
        </section>
      )}
    </Drawer>
  );
}

/**
 * Correct a returned payment (Arisha main's review, 2 Nov 2026: returned items had no Edit). The documents already
 * attached stay; new ones are added. Prima writes what changed into the history, next to the earlier steps.
 */
function EditReturned({ c, p, onDone, onCancel }: { c: Co; p: Pay; onDone: () => void; onCancel: () => void }) {
  const act = useAction();
  const lastReturn = [...p.steps].reverse().find((s) => s.step === 'returned');
  const [f, setF] = useState({
    purpose: p.purpose,
    amount: String(p.amount),
    dueOn: p.dueOn,
    bankId: p.bankId,
    sqlRef: p.sqlRef,
    invoiceNo: p.invoiceNo ?? '',
    docs: '',
    comment: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    const r = await act.run(
      () =>
        api.finPaymentStep(c.companyId, p.id, 'resubmit', {
          purpose: f.purpose,
          amount: Number(f.amount),
          dueOn: f.dueOn,
          bankId: f.bankId,
          sqlRef: f.sqlRef,
          invoiceNo: f.invoiceNo || undefined,
          evidence: [
            ...p.evidence,
            ...f.docs
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean),
          ],
          comment: f.comment,
        }),
      'Corrected and sent for review again.',
    );
    if (r) onDone();
  };
  return (
    <section className="panel fin-pad">
      <div className="panel-head">
        <h3>Correct and resubmit</h3>
      </div>
      <FinGuide id="fin.payment.prepare" />
      {lastReturn && (
        <p className="notice" data-tone="warn">
          Returned by {lastReturn.by}: {lastReturn.comment}
        </p>
      )}
      <ErrorNotice error={act.error} />
      <Field label="Purpose">
        <input className="input" value={f.purpose} onChange={set('purpose')} />
      </Field>
      <Field label="Amount (RM)">
        <input className="input" inputMode="decimal" value={f.amount} onChange={set('amount')} />
      </Field>
      <Field label="Due">
        <input className="input" type="date" value={f.dueOn} onChange={set('dueOn')} />
      </Field>
      <Field label="Pay from">
        <select className="select" value={f.bankId} onChange={set('bankId')}>
          {c.banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.bank} {b.accountMasked}
            </option>
          ))}
        </select>
      </Field>
      <Field label="SQL Account document number">
        <input className="input" value={f.sqlRef} onChange={set('sqlRef')} />
      </Field>
      <Field label="Supplier's invoice number">
        <input className="input" value={f.invoiceNo} onChange={set('invoiceNo')} />
      </Field>
      <div className="muted small">Documents attached (kept): {p.evidence.join(', ')}</div>
      <Field label="Add documents (one per line)">
        <textarea className="textarea" rows={2} value={f.docs} onChange={set('docs')} />
      </Field>
      <Field label="What you changed">
        <textarea className="textarea" rows={2} value={f.comment} onChange={set('comment')} />
      </Field>
      <div className="row">
        <button className="btn btn-sm btn-primary" disabled={act.busy || !(Number(f.amount) > 0)} onClick={() => void save()}>
          Save and resubmit
        </button>
        <button className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function NewPayment({ desk, onClose }: { desk: FinDesk; onClose: () => void }) {
  const act = useAction();
  const cos = desk.companies.filter((c) => c.canAct);
  const [f, setF] = useState({
    companyId: cos[0]?.companyId ?? '',
    payeeId: '',
    purpose: '',
    amount: '',
    dueOn: '',
    bankId: cos[0]?.banks.length === 1 ? cos[0].banks[0].id : '',
    sqlRef: '',
    evidence: '',
    eInvoiceRef: '',
    subject: 'finance',
    budgetLine: '',
    requestId: '',
    purchaseId: '',
    invoiceNo: '',
    notDuplicate: '',
    approvalMethod: '',
  });
  const co = cos.find((c) => c.companyId === f.companyId);
  // Staff-eye review (Fauzan, 2 Nov 2026): Prima fills what it already knows. A company with one account pays from it;
  // choosing a payee fills the purpose, subject, budget line and account from the last payment to them (all editable).
  const oneBank = (id: string) => {
    const banks = cos.find((c) => c.companyId === id)?.banks ?? [];
    return banks.length === 1 ? banks[0].id : '';
  };
  const set = (k: keyof typeof f) => (v: string) =>
    setF((x) => {
      if (k === 'companyId') return { ...x, companyId: v, bankId: oneBank(v), payeeId: '' };
      if (k === 'payeeId' && v) {
        const last = [...(co?.payments ?? [])].reverse().find((p) => p.payeeId === v);
        if (last)
          return {
            ...x,
            payeeId: v,
            purpose: x.purpose || last.purpose,
            subject: last.subject ?? x.subject,
            budgetLine: x.budgetLine || (last.budgetLine ?? ''),
            bankId: x.bankId || last.bankId,
          };
      }
      return { ...x, [k]: v };
    });
  const submit = async () => {
    const r = await act.run(
      () =>
        api.finCreatePayment(f.companyId, {
          payeeId: f.payeeId,
          purpose: f.purpose,
          amount: Number(f.amount),
          dueOn: f.dueOn,
          bankId: f.bankId,
          sqlRef: f.sqlRef,
          eInvoiceRef: f.eInvoiceRef,
          invoiceNo: f.invoiceNo || undefined,
          notDuplicate: f.notDuplicate || undefined,
          subject: f.subject,
          budgetLine: f.budgetLine,
          requestId: f.requestId || undefined,
          purchaseId: f.purchaseId || undefined,
          approvalMethod: f.approvalMethod || undefined,
          evidence: f.evidence
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean),
        }),
      'Payment prepared. Someone else in the team reviews it next.',
    );
    if (r) onClose();
  };
  return (
    <Drawer title="New payment" sub="Prepare it here; someone else reviews and approves it" onClose={onClose}>
      <FinGuide id="fin.payment.prepare" />
      <ErrorNotice error={act.error} />
      <Field label="Company">
        <select className="select" value={f.companyId} onChange={(e) => set('companyId')(e.target.value)}>
          {cos.map((c) => (
            <option key={c.companyId} value={c.companyId}>
              {c.companyName} (Team {c.team})
            </option>
          ))}
        </select>
      </Field>
      {(co?.requests.length ?? 0) > 0 && (
        <Field label="For an approved payment request (its final approval is this payment's approval)">
          <select
            className="select"
            value={f.requestId}
            onChange={(e) => {
              const r = co?.requests.find((x) => x.id === e.target.value);
              setF((x) => ({
                ...x,
                requestId: e.target.value,
                ...(r ? { amount: String(r.amount), purpose: r.title, dueOn: r.dueOn, subject: r.subject } : {}),
              }));
            }}
          >
            <option value="">Not from a request</option>
            {co?.requests.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} · {rm(r.amount)} · {r.payee}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(co?.purchases.length ?? 0) > 0 && !f.requestId && (
        <Field label="For a Procurement purchase (three-way match passed, posted in SQL Account)">
          <select
            className="select"
            value={f.purchaseId}
            onChange={(e) => {
              const r = co?.purchases.find((x) => x.id === e.target.value);
              setF((x) => ({
                ...x,
                purchaseId: e.target.value,
                ...(r
                  ? {
                      amount: String(r.amount),
                      purpose: `${r.ref} ${r.title}`,
                      invoiceNo: r.invoiceNo,
                      sqlRef: r.sqlRef,
                      subject: 'inventory',
                      payeeId: r.payeeId ?? x.payeeId,
                    }
                  : {}),
              }));
            }}
          >
            <option value="">Not from a purchase</option>
            {co?.purchases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.ref} · {r.supplier} · {rm(r.amount)} · invoice {r.invoiceNo}
                {r.payeeId ? '' : ` · add the supplier's account ending ${r.accountLast4} as a payee first`}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Pay to (from the company's payee list; only verified payees can be approved)">
        <select className="select" value={f.payeeId} onChange={(e) => set('payeeId')(e.target.value)}>
          <option value="">Choose a payee</option>
          {co?.payees
            .filter((x) => x.status !== 'blocked')
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.kind}) · {x.bank} ending {x.accountLast4}
                {x.status === 'pending' ? ' · NOT VERIFIED' : ''}
              </option>
            ))}
        </select>
      </Field>
      <p className="muted small">
        A new payee, or a change of bank account, is added under Checks and verified by a call-back before any payment to it is approved.
      </p>
      <Field label="What it is for (decides who approves)">
        <select className="select" value={f.subject} onChange={(e) => set('subject')(e.target.value)}>
          {(Object.keys(SUBJECT) as FinSubject[]).map((k) => (
            <option key={k} value={k}>
              {SUBJECT[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Budget line it is spent from (the reviewer and approver are warned if it goes over)">
        <select className="select" value={f.budgetLine} onChange={(e) => set('budgetLine')(e.target.value)}>
          <option value="">Not given</option>
          {(Object.keys(LINE_LABEL) as FinPlanLine[])
            .filter((k) => k !== 'revenue')
            .map((k) => (
              <option key={k} value={k}>
                {LINE_LABEL[k]}
              </option>
            ))}
        </select>
      </Field>
      {desk.teamsReady && (
        <Field label="Approved in (one only, never both)">
          <select className="select" value={f.approvalMethod || desk.settings.approvalMethod} onChange={(e) => set('approvalMethod')(e.target.value)}>
            <option value="prima">Prima</option>
            <option value="teams">Teams</option>
          </select>
        </Field>
      )}
      <Field label="Purpose">
        <input className="input" value={f.purpose} onChange={(e) => set('purpose')(e.target.value)} />
      </Field>
      <Field label="Amount (RM)">
        <input className="input" inputMode="decimal" value={f.amount} onChange={(e) => set('amount')(e.target.value)} />
      </Field>
      <Field label="Due date">
        <input className="input" type="date" value={f.dueOn} onChange={(e) => set('dueOn')(e.target.value)} />
      </Field>
      <Field label="Pay from">
        <select className="select" value={f.bankId} onChange={(e) => set('bankId')(e.target.value)}>
          <option value="">Choose a bank account</option>
          {co?.banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.bank} {b.accountMasked} ({b.purpose})
            </option>
          ))}
        </select>
      </Field>
      <Field label="SQL Account document number (purchase invoice or payment voucher)">
        <input className="input" value={f.sqlRef} onChange={(e) => set('sqlRef')(e.target.value)} />
      </Field>
      <Field label="Supplier's own invoice number (Prima refuses the same invoice paid twice, in any company)">
        <input className="input" value={f.invoiceNo} onChange={(e) => set('invoiceNo')(e.target.value)} />
      </Field>
      {(f.notDuplicate || /looks like a duplicate/i.test(act.error?.message ?? '')) && (
        <Field label="Prima found a similar payment. If this is really a separate payment, say why (the reviewer and approver see it)">
          <input className="input" value={f.notDuplicate} onChange={(e) => set('notDuplicate')(e.target.value)} />
        </Field>
      )}
      <Field label="Supplier's e-Invoice UUID (from the validated e-Invoice or SQL Account; leave blank if none)">
        <input className="input" value={f.eInvoiceRef} onChange={(e) => set('eInvoiceRef')(e.target.value)} />
      </Field>
      <Field label="Supporting documents, one per line (file name or SharePoint link; never bank passwords or account numbers)">
        <textarea className="textarea" rows={3} value={f.evidence} onChange={(e) => set('evidence')(e.target.value)} />
      </Field>
      <button className="btn btn-primary" disabled={act.busy} onClick={submit}>
        Prepare payment
      </button>
    </Drawer>
  );
}

type Decision = { approver: string; decision: 'approved' | 'rejected'; comment: string; decidedOn: string };

/** Link the SharePoint request and the Teams approval. Every approver's decision is copied with its comment; none may be blank. */
function LinkApproval({ c, p }: { c: Co; p: Pay }) {
  const act = useAction();
  const [system, setSystem] = useState<'teams' | 'sharepoint'>(p.external?.system ?? 'teams');
  const [url, setUrl] = useState(p.external?.url ?? '');
  const [requestRef, setRequestRef] = useState(p.external?.requestRef ?? '');
  const [ds, setDs] = useState<Decision[]>(p.external?.decisions ?? []);
  const setD = (i: number, k: keyof Decision, v: string) => setDs((x) => x.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const blank = ds.some((d) => !d.comment.trim() || d.approver.trim().length < 2 || !d.decidedOn);
  return (
    <div className="fin-pad">
      <ErrorNotice error={act.error} />
      <Field label="Where the approval is">
        <select className="select" value={system} onChange={(e) => setSystem(e.target.value as 'teams' | 'sharepoint')}>
          <option value="teams">Microsoft Teams (Approvals)</option>
          <option value="sharepoint">SharePoint request</option>
        </select>
      </Field>
      <Field label="Link (copied from Teams or SharePoint, https)">
        <input
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://….sharepoint.com/… or https://teams.microsoft.com/…"
        />
      </Field>
      <Field label="Request number or title">
        <input className="input" value={requestRef} onChange={(e) => setRequestRef(e.target.value)} />
      </Field>
      {ds.map((d, i) => (
        <div key={i} className="fin-subcard">
          <div className="row">
            <input className="input" placeholder="Approver's name" value={d.approver} onChange={(e) => setD(i, 'approver', e.target.value)} />
            <select className="select" value={d.decision} onChange={(e) => setD(i, 'decision', e.target.value)}>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <input className="input" type="date" value={d.decidedOn} onChange={(e) => setD(i, 'decidedOn', e.target.value)} />
            <button className="btn btn-sm" onClick={() => setDs((x) => x.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
          <input
            className="input"
            placeholder="Their comment in Teams (needed, approve or reject)"
            value={d.comment}
            onChange={(e) => setD(i, 'comment', e.target.value)}
          />
        </div>
      ))}
      <div className="row">
        <button className="btn btn-sm" onClick={() => setDs((x) => [...x, { approver: '', decision: 'approved', comment: '', decidedOn: '' }])}>
          Add an approver's decision
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || url.trim().length < 10 || requestRef.trim().length < 2 || blank}
          onClick={() => act.run(() => api.finPaymentStep(c.companyId, p.id, 'link', { system, url, requestRef, decisions: ds }), 'Approval linked.')}
        >
          {p.external ? 'Update link' : 'Link approval'}
        </button>
      </div>
      <p className="muted small">
        A rejection in Teams stops the approval in Prima. An approver with no comment is refused: ask them to add one in Teams first.
      </p>
    </div>
  );
}

// ---------- Month-end close ----------

/** The close's three hands, drawn from its status: the team prepares, the deputy or leader reviews, the FD or CEO approves. */
function closeSteps(status: string) {
  const at = ({ open: 0, prepared: 1, reviewed: 2, approved: 3 } as Record<string, number>)[status] ?? 0;
  const labels = ['Team prepares', 'Deputy or leader reviews', 'FD or CEO approves'];
  return labels.map((label, i) => ({ label, state: (at > i ? 'done' : at === i ? 'now' : 'todo') as StepState }));
}

export function CloseTab({ desk }: { desk: FinDesk }) {
  const [open, setOpen] = useState<string | null>(null);
  const sel = desk.companies.find((c) => c.companyId === open) ?? null;
  const order = { reviewed: 0, prepared: 1, open: 2, approved: 3 } as Record<string, number>;
  const rows = [...desk.companies].sort(
    (a, b) => order[a.close.status] - order[b.close.status] || a.team - b.team || a.companyName.localeCompare(b.companyName),
  );
  const by = (s: string) => desk.companies.filter((c) => c.close.status === s).length;
  return (
    <>
      <Stats>
        <Stat label="Open" value={by('open')} tone={by('open') ? 'warn' : 'ok'} note="Team to prepare" icon={<ListChecksIcon size={18} />} />
        <Stat label="To review" value={by('prepared')} tone={by('prepared') ? 'warn' : 'ok'} note="Deputy or leader" icon={<HourglassMediumIcon size={18} />} />
        <Stat label="Waiting for approval" value={by('reviewed')} tone={by('reviewed') ? 'info' : 'ok'} note="Finance Director or the CEO" icon={<SealCheckIcon size={18} />} />
        <Stat label="Approved financials" value={by('approved')} tone="ok" note={`of ${desk.companies.length}`} icon={<CheckCircleIcon size={18} />} />
      </Stats>
      <p className="notice" data-tone="info">
        Closing {desk.period}: SQL Account closed, every bank account reconciled with its report attached, FS-01, FS-02 and FS-06 at RM0.00 and every other
        exception explained. The team prepares, the deputy or leader reviews, and the Finance Director or the CEO approves the financials.
      </p>
      <Card title={`Close ${desk.period}`} sub="Press a company for its checklist" flush>
        <div className="fin-closes">
          {rows.map((c) => (
            <button key={c.companyId} type="button" className="fin-close" onClick={() => setOpen(c.companyId)}>
              <span className="fin-close-name">
                <span className="fin-strong">{c.companyName}</span>
                <span className="muted small">
                  Team {c.team} · {c.close.check.blockers.length} to fix · {c.close.check.exceptions.filter((e) => !e.explained).length} to explain
                </span>
              </span>
              <span className="fin-close-steps">
                <Steps steps={closeSteps(c.close.status)} />
              </span>
              <Chip tone={CLOSE[c.close.status][0]}>{CLOSE[c.close.status][1]}</Chip>
            </button>
          ))}
        </div>
      </Card>
      {sel && <CloseDrawer c={sel} period={desk.period} onClose={() => setOpen(null)} />}
    </>
  );
}

function CloseDrawer({ c, period, onClose }: { c: Co; period: string; onClose: () => void }) {
  const act = useAction();
  const [comment, setComment] = useState('');
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const ck = c.close.check;
  const may = c.close.may;
  const run = (a: FinCloseAction, input: Record<string, unknown>, msg: string) => act.run(() => api.finCloseStep(c.companyId, a, input), msg);
  const attached = (bankId: string) => c.close.record?.bankRecRefs.find((r) => r.bankId === bankId) ?? null;
  return (
    <Drawer title={`${c.companyName}: close ${period}`} sub={CLOSE[c.close.status][1]} onClose={onClose}>
      <div className="fin-drawer-steps">
        <Steps steps={closeSteps(c.close.status)} />
      </div>
      <ErrorNotice error={act.error} />
      <Card title="Checklist" sub={`${ck.done.length} done · ${ck.blockers.length + (ck.bankPackOpen > 0 ? 1 : 0)} to fix`} flush>
        <ul className="fin-check">
          {ck.done.map((d) => (
            <li key={d} data-state="done">
              <CheckCircleIcon size={18} weight="fill" aria-hidden="true" />
              <span>
                {d} <span className="muted small">· done (checked by Prima)</span>
              </span>
            </li>
          ))}
          {ck.blockers.map((b) => (
            <li key={b} data-state="todo">
              <WarningCircleIcon size={18} aria-hidden="true" />
              <span>{b}</span>
            </li>
          ))}
          {ck.bankPackOpen > 0 && (
            <li data-state="todo">
              <WarningCircleIcon size={18} aria-hidden="true" />
              <span>{ck.bankPackOpen} bank pack item(s) to review before approval.</span>
            </li>
          )}
          {ck.blockers.length === 0 && (
            <li data-state="done">
              <CheckCircleIcon size={18} weight="fill" aria-hidden="true" />
              <span>Nothing blocks the close.</span>
            </li>
          )}
        </ul>
      </Card>
      <Card title="Bank reconciliation reports" flush>
        <div className="fin-rows">
          {c.banks.map((b) => {
            const a = attached(b.id);
            return (
              <div key={b.id} className="fin-kv fin-kv-wrap">
                <span className="fin-kv-label">
                  <span>
                    {b.bank} {b.accountMasked}
                  </span>
                  <span className="muted small">{a ? `${a.ref} · ${a.by}` : 'Not attached'}</span>
                </span>
                {may.includes('evidence') ? (
                  <span className="fin-inline-form">
                    <input
                      className="input"
                      aria-label={`Reconciliation report for ${b.bank} ${b.accountMasked}`}
                      placeholder="Report file name or SharePoint link"
                      value={refs[b.id] ?? ''}
                      onChange={(e) => setRefs((x) => ({ ...x, [b.id]: e.target.value }))}
                    />
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || (refs[b.id] ?? '').trim().length < 3}
                      onClick={() => run('evidence', { bankId: b.id, ref: refs[b.id] }, 'Report attached.')}
                    >
                      Attach
                    </button>
                  </span>
                ) : (
                  <Chip tone={a ? 'ok' : 'warn'}>{a ? 'Attached' : 'Not attached'}</Chip>
                )}
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Exceptions to explain" flush>
        {ck.exceptions.length === 0 ? (
          <Empty title="No exceptions." />
        ) : (
          <div className="fin-rows">
            {ck.exceptions.map((e) => (
              <div key={e.key} className="fin-kv fin-kv-wrap">
                <span className="fin-kv-label">
                  <span>{e.text}</span>
                  <span className="muted small">{e.explained ?? 'Not explained yet'}</span>
                </span>
                {may.includes('explain') && (
                  <span className="fin-inline-form">
                    <input
                      className="input"
                      aria-label="Why it is acceptable"
                      placeholder="Why it is acceptable (at least 10 characters)"
                      value={why[e.key] ?? ''}
                      onChange={(ev) => setWhy((x) => ({ ...x, [e.key]: ev.target.value }))}
                    />
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || (why[e.key] ?? '').trim().length < 10}
                      onClick={() => run('explain', { key: e.key, text: why[e.key] }, 'Explained.')}
                    >
                      Save
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      {c.close.record && c.close.record.steps.length > 0 && (
        <Card title="Who did what" flush>
          <ol className="fin-trail">
            {c.close.record.steps.map((s, i) => (
              <li key={i}>
                <span>
                  <span className="fin-strong">{s.step}</span> by {s.by}
                  {s.comment && <span className="muted small fin-block">{s.comment}</span>}
                </span>
                <span className="muted small fin-nowrap">{dateTimeLabel(s.at)}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {may.some((a) => ['prepare', 'review', 'approve', 'return', 'reopen'].includes(a)) && (
        <section className="fin-actions">
          <Field label={may.includes('approve') || may.includes('review') ? 'Comment (needed; a short one is fine)' : 'Comment or reason'}>
            <textarea className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div className="row">
            {may.includes('prepare') && (
              <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => run('prepare', { comment }, 'Sent for review.')}>
                Send for review
              </button>
            )}
            {may.includes('review') && (
              <button className="btn btn-sm btn-primary" disabled={act.busy || !comment.trim()} onClick={() => run('review', { comment }, 'Reviewed.')}>
                Mark reviewed
              </button>
            )}
            {may.includes('approve') && (
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !comment.trim()}
                onClick={() => run('approve', { comment }, 'Financials approved.')}
              >
                Approve financials
              </button>
            )}
            {may.includes('return') && (
              <button
                className="btn btn-sm"
                disabled={act.busy || comment.trim().length < 10}
                onClick={() => run('return', { comment }, 'Returned to the team.')}
              >
                Return
              </button>
            )}
            {may.includes('reopen') && (
              <button className="btn btn-sm" disabled={act.busy || comment.trim().length < 10} onClick={() => run('reopen', { comment }, 'Close reopened.')}>
                Reopen
              </button>
            )}
          </div>
        </section>
      )}
    </Drawer>
  );
}

// ---------- Packs with comments ----------

const PACK: Record<FinPackStatus, [Tone, string]> = {
  todo: ['neutral', 'Not started'],
  prepared: ['warn', 'Prepared'],
  reviewed: ['info', 'Reviewed'],
  sent: ['ok', 'Sent'],
};
const NEXT: Partial<Record<FinPackStatus, [FinPackStatus, string]>> = {
  todo: ['prepared', 'Mark prepared'],
  prepared: ['reviewed', 'Mark reviewed'],
  reviewed: ['sent', 'Mark sent'],
};

/** One pack's papers. Reviewing and sending need a comment; the preparer neither reviews nor sends (the server checks). */
export function FinPackPanel({
  title,
  companyId,
  pack,
  items,
  canSet,
  may,
  meId,
}: {
  title: string;
  companyId: string;
  pack: FinPackKind;
  items: FinPackItem[];
  canSet: boolean;
  may: FinPackStatus[];
  meId: string | null;
}) {
  const act = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const sent = items.filter((i) => i.status === 'sent').length;
  return (
    <Card title={title} sub={items.length ? `${sent} of ${items.length} sent` : undefined} flush>
      <ErrorNotice error={act.error} />
      {items.length === 0 ? (
        <Empty title="Nothing in this pack yet." />
      ) : (
        <div className="fin-rows">
          {items.map((i) => {
            const next = NEXT[i.status];
            const needsNote = next && next[0] !== 'prepared';
            const own = !!next && needsNote && !!meId && i.preparedById === meId;
            return (
              <div key={i.id} className="fin-kv fin-kv-wrap fin-paper">
                <span className="fin-kv-label">
                  <span>{i.label}</span>
                  <span className="muted small">
                    Due {dateLabel(i.dueOn)}
                    {i.by ? ` · ${i.by}, ${dateTimeLabel(i.at!)}` : ''}
                    {i.comment ? ` · "${i.comment}"` : ''}
                  </span>
                  {i.autoChanged && <span className="small fin-warn">Changed since it was reviewed: review it again.</span>}
                  {i.auto && i.auto.length > 0 && (
                    <ul className="muted small fin-ul">
                      {i.auto.map((x, k) => (
                        <li key={k}>{x}</li>
                      ))}
                    </ul>
                  )}
                </span>
                <span className="fin-inline-form">
                  <Chip tone={PACK[i.status][0]}>{PACK[i.status][1]}</Chip>
                  {canSet && next && may.includes(next[0]) && !own && (
                    <>
                      {needsNote && (
                        <input
                          className="input fin-maxw"
                          aria-label={`Comment for ${i.label}`}
                          placeholder="Comment (needed)"
                          value={notes[i.id] ?? ''}
                          onChange={(e) => setNotes((x) => ({ ...x, [i.id]: e.target.value }))}
                        />
                      )}
                      <button
                        className="btn btn-sm"
                        disabled={act.busy || (needsNote && !(notes[i.id] ?? '').trim())}
                        onClick={() => act.run(() => api.setFinPack(companyId, pack, i.id, next[0], notes[i.id]), `${next[1].replace('Mark ', '')}.`)}
                      >
                        {next[1]}
                      </button>
                    </>
                  )}
                  {own && <span className="muted small">You prepared it; someone else reviews</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
