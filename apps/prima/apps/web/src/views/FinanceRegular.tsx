import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type FinControls, type FinDesk } from '../api';
import { Chip, ErrorNotice, dateLabel, useAction, type Tone } from '../ui';

/**
 * Regular payments, guarantees and hostel bills (Fauzan, 2 Nov 2026). Hire purchase, building loans, bills, rent,
 * insurance, EPF/PERKESO/HRD/PCB/CP204, zakat; IG and BG with their cash collateral; hostel bills the companies pay
 * through FWM. Prima works out each due date, finds direct debits, refunds and hostel payments on the bank statement and
 * warns; people check, pay and approve. The server enforces who may do each step.
 */

type Co = FinDesk['companies'][number];
type Reg = FinControls['regular'][number];
const rm = (n: number | null | undefined) => (n == null ? '–' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const KIND: Record<string, string> = {
  hire_purchase: 'Hire purchase',
  loan: 'Loan (building, term)',
  bill: 'Bill (electricity, water, phone, internet)',
  rent: 'Rent',
  insurance: 'Insurance premium',
  statutory: 'Statutory (EPF, PERKESO, HRD, PCB, CP204)',
  zakat: 'Zakat',
  tax: 'Tax',
  levy: 'Levy (foreign worker)',
  other: 'Other',
};
const STATE: Record<string, [string, Tone]> = {
  upcoming: ['Upcoming', 'info'],
  no_bill: ['Bill not recorded', 'warn'],
  due: ['Due soon', 'warn'],
  prepared: ['Payment prepared', 'info'],
  paid: ['Paid', 'ok'],
  late: ['Late', 'crit'],
  not_seen: ['Not on bank statement', 'crit'],
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function useGo(companyId: string) {
  const act = useAction();
  const go = (area: 'regular' | 'guarantees', action: string, input: Record<string, unknown>, msg: string) => act.run(() => api.finControlAction(companyId, area, action, input), msg);
  return { act, go };
}

export function RegularPayments({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useGo(v.companyId);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ kind: 'bill', method: 'transfer', every: 'monthly', dueDay: '15' });
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const fin = f.kind === 'hire_purchase' || f.kind === 'loan';
  const [prep, setPrep] = useState<{ prepared: unknown[]; skipped: { name: string; reason: string }[] } | null>(null);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Regular payments</h3>
        <div className="row">
          {co.canAct && (
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy}
              onClick={async () => {
                const r = (await act.run(() => api.finControlAction(v.companyId, 'regular', 'prepareDue', {}), 'Done. The payments wait for review.')) as
                  | { prepared: unknown[]; skipped: { name: string; reason: string }[] }
                  | undefined;
                if (r) setPrep(r);
              }}
            >
              Prepare all due
            </button>
          )}
          {co.canAct && (
            <button className="btn btn-sm" onClick={() => go('regular', 'rematch', {}, 'Looked again on the bank statements.')}>
              Look again on statements
            </button>
          )}
          {co.canAct && (
            <button className="btn btn-sm" onClick={() => setAdding((x) => !x)}>
              {adding ? 'Close' : 'Add'}
            </button>
          )}
        </div>
      </div>
      <p className="muted small fin-intro">
        Hire purchase, loans, bills, rent, insurance, EPF, PERKESO, HRD, PCB, CP204 and zakat. A second person checks each entry against the agreement or letter.
        Transfers are paid from here for exactly the amount due; direct debits are found on the bank statement by Prima. Statutory, zakat, tax and levy are approved by the
        Finance Director or the CEO.
      </p>
      <ErrorNotice error={act.error} />
      {prep && (
        <div className="notice" data-tone={prep.skipped.length ? 'warn' : 'ok'}>
          Prima prepared {prep.prepared.length} payment(s) due within 7 days for review.
          {prep.skipped.length > 0 && ` Not prepared: ${prep.skipped.map((x) => `${x.name} (${x.reason})`).join('; ')}.`}
        </div>
      )}
      <BatchApprove co={co} companyId={v.companyId} />
      {adding && (
        <div className="fin-pad">
          <Field label="Type">
            <Select className="select" value={f.kind} onChange={set('kind')}>
              {v.kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND[k] ?? k}
                </option>
              ))}
            </Select>
          </Field>
          {(f.kind === 'statutory' || f.kind === 'zakat') && (
            <Field label={f.kind === 'zakat' ? 'Zakat body' : 'Paid to'}>
              <Select className="select" value={f.body ?? ''} onChange={set('body')}>
                <option value="">Choose</option>
                {(f.kind === 'zakat' ? v.zakatBodies : v.statutoryBodies).map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </Select>
            </Field>
          )}
          {f.kind === 'statutory' && ['EPF', 'PERKESO', 'HRD Corp', 'LHDN PCB'].includes(f.body ?? '') && (
            <Field label="Amount each month">
              <select className="select" value={f.fromPayroll ?? 'yes'} onChange={set('fromPayroll')}>
                <option value="yes">From the approved staff payroll (Prima fills it in)</option>
                <option value="no">From the contribution file (typed in)</option>
              </select>
            </Field>
          )}
          {f.kind === 'zakat' && (
            <Field label="Zakat for">
              <select className="select" value={f.zakatFor ?? ''} onChange={set('zakatFor')}>
                <option value="">Choose</option>
                <option value="staff">Deducted from staff salaries</option>
                <option value="business">The company's business zakat</option>
              </select>
            </Field>
          )}
          <Field label="Name">
            <input className="input" value={f.name ?? ''} onChange={set('name')} />
          </Field>
          <Field label="Payee (from the payee list)">
            <Select className="select" value={f.payeeId ?? ''} onChange={set('payeeId')}>
              <option value="">Choose</option>
              {v.payees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.status})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Agreement, account, policy or employer number">
            <input className="input" value={f.reference ?? ''} onChange={set('reference')} />
          </Field>
          <Field label="Paid by">
            <select className="select" value={f.method} onChange={set('method')}>
              <option value="transfer">Transfer (prepared in Prima)</option>
              <option value="direct_debit">Direct debit (the bank takes it)</option>
            </select>
          </Field>
          <Field label="Bank account">
            <Select className="select" value={f.bankId ?? ''} onChange={set('bankId')}>
              <option value="">Choose</option>
              {v.statements.map((s) => (
                <option key={s.bank.id} value={s.bank.id}>
                  {s.bank.bank} {s.bank.accountMasked}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="How often">
            <select className="select" value={f.every} onChange={set('every')}>
              <option>monthly</option>
              <option>quarterly</option>
              <option>yearly</option>
            </select>
          </Field>
          <Field label="Due day of the month">
            <input className="input" inputMode="numeric" value={f.dueDay ?? ''} onChange={set('dueDay')} />
          </Field>
          <Field label="First due date">
            <input className="input" type="date" value={f.firstDue ?? ''} onChange={set('firstDue')} />
          </Field>
          <Field label="Last due date (hire purchase and loans; blank if none)">
            <input className="input" type="date" value={f.lastDue ?? ''} onChange={set('lastDue')} />
          </Field>
          <Field label="Fixed amount (blank when each bill or contribution file gives it)">
            <input className="input" inputMode="decimal" value={f.amount ?? ''} onChange={set('amount')} />
          </Field>
          {fin && (
            <>
              <Field label="Amount financed">
                <input className="input" inputMode="decimal" value={f.principal ?? ''} onChange={set('principal')} />
              </Field>
              <Field label="Number of instalments">
                <input className="input" inputMode="numeric" value={f.instalments ?? ''} onChange={set('instalments')} />
              </Field>
              <Field label={f.kind === 'loan' ? 'Property or asset it is secured on' : 'Vehicle or asset (registration)'}>
                <input className="input" value={f.security ?? ''} onChange={set('security')} />
              </Field>
            </>
          )}
          {f.kind === 'insurance' && (
            <Field label="Policy end date">
              <input className="input" type="date" value={f.expiresOn ?? ''} onChange={set('expiresOn')} />
            </Field>
          )}
          {!['statutory', 'zakat', 'tax', 'levy'].includes(f.kind) && (
            <Field label="Who approves (subject)">
              <Select className="select" value={f.subject ?? 'finance'} onChange={set('subject')}>
                {['finance', 'operations', 'it', 'fwm', 'inventory', 'transport', 'goodwill'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
          )}
          <button
            className="btn btn-primary"
            disabled={act.busy}
            onClick={async () => {
              const body: Record<string, unknown> = {
                ...f,
                dueDay: Number(f.dueDay),
                amount: f.amount ? Number(f.amount) : null,
                fromPayroll: f.kind === 'statutory' && ['EPF', 'PERKESO', 'HRD Corp', 'LHDN PCB'].includes(f.body ?? '') && (f.fromPayroll ?? 'yes') === 'yes',
              };
              if (fin) Object.assign(body, { principal: Number(f.principal), instalments: Number(f.instalments) });
              if (await go('regular', 'add', body, 'Added. Someone else checks it next.')) setAdding(false);
            }}
          >
            Add
          </button>
        </div>
      )}
      <div className="list">
        {v.regular.length === 0 && <div className="list-item muted">Nothing on the list yet.</div>}
        {v.regular.map((r) => (
          <RegularRow key={r.id} v={v} co={co} r={r} />
        ))}
      </div>
    </section>
  );
}

function RegularRow({ v, co, r }: { v: FinControls; co: Co; r: Reg }) {
  const { act, go } = useGo(v.companyId);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pay = useAction();
  return (
    <div className="list-item fin-block">
      <div className="row fin-between">
        <div className="fin-min0">
          <b>{r.name}</b> · {r.payee} · {KIND[r.kind]?.split(' (')[0] ?? r.kind}
          {r.body ? ` · ${r.body}` : ''}
          <div className="muted small">
            {r.every}, day {r.dueDay} · {r.amount == null ? 'amount from each bill' : rm(r.amount)} · {r.method === 'direct_debit' ? 'direct debit' : 'transfer'} · approved by{' '}
            {r.subject === 'finance' ? 'FD or CEO' : 'COO or CEO'}
            {r.remaining != null && ` · ${r.remaining} instalment(s) left`}
            {r.expiresOn && ` · policy ends ${dateLabel(r.expiresOn)}`}
          </div>
        </div>
        <div className="row">
          <Chip tone={r.status === 'active' ? 'ok' : r.status === 'pending' ? 'warn' : 'info'}>{r.status === 'pending' ? 'To check' : r.status}</Chip>
          <button className="btn btn-sm" onClick={() => setOpen((x) => !x)}>
            {open ? 'Close' : 'Open'}
          </button>
        </div>
      </div>
      {open && (
        <div className="fin-pt">
          <ErrorNotice error={act.error ?? pay.error} />
          <div className="list">
            {r.next.map((d) => {
              const st = d.state ? STATE[d.state] : null;
              return (
                <div key={d.period} className="list-item">
                  <span>
                    {dateLabel(d.dueOn)} · {rm(d.expected)}
                    {d.bill?.unusual && <span className="muted small"> · unusual: {d.bill.unusual}</span>}
                  </span>
                  <span className="row">
                    {st && <Chip tone={st[1]}>{st[0]}</Chip>}
                    {co.canAct && r.status === 'active' && r.method === 'transfer' && d.expected != null && !d.paymentId && (d.state === 'due' || d.state === 'late' || d.state === 'upcoming') && (
                      <button
                        className="btn btn-sm"
                        disabled={pay.busy}
                        onClick={() =>
                          pay.run(
                            () =>
                              api.finCreatePayment(v.companyId, {
                                regularId: r.id,
                                regularPeriod: d.period,
                                purpose: `${r.name} ${d.period}`,
                                amount: d.expected,
                                dueOn: d.dueOn,
                                bankId: r.bankId,
                                sqlRef: f[`sql-${d.period}`] ?? '',
                                evidence: [d.bill?.doc ?? `${r.reference} schedule`],
                              }),
                            'Payment prepared. It goes for review and approval as usual.',
                          )
                        }
                      >
                        Prepare payment
                      </button>
                    )}
                  </span>
                  {co.canAct && r.status === 'active' && r.method === 'transfer' && d.expected != null && !d.paymentId && (
                    <input className="input" placeholder="SQL Account payment voucher no." value={f[`sql-${d.period}`] ?? ''} onChange={set(`sql-${d.period}`)} />
                  )}
                  {co.canAct && r.status === 'active' && r.amount == null && !d.paymentId && !d.debited && (
                    <span className="row">
                      <input className="input" placeholder="Billed amount" inputMode="decimal" value={f[`amt-${d.period}`] ?? ''} onChange={set(`amt-${d.period}`)} />
                      {(() => {
                        // A14 (Fauzan, 2 Nov 2026): copy last month's amount, then change it if the bill differs.
                        const last = [...r.dues].filter((x) => x.bill && x.period < d.period).sort((x, y) => y.period.localeCompare(x.period))[0];
                        return last?.bill ? (
                          <button className="btn btn-sm btn-ghost" onClick={() => set(`amt-${d.period}`)({ target: { value: String(last.bill!.amount) } })}>
                            Same as {last.period} ({rm(last.bill.amount)})
                          </button>
                        ) : null;
                      })()}
                      <input className="input" placeholder="Bill or contribution file name" value={f[`doc-${d.period}`] ?? ''} onChange={set(`doc-${d.period}`)} />
                      <input className="input" placeholder="If unusual, why" value={f[`why-${d.period}`] ?? ''} onChange={set(`why-${d.period}`)} />
                      <button
                        className="btn btn-sm"
                        onClick={() => go('regular', 'bill', { regularId: r.id, period: d.period, amount: Number(f[`amt-${d.period}`]), doc: f[`doc-${d.period}`], unusual: f[`why-${d.period}`] }, 'Bill recorded.')}
                      >
                        Record bill
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {co.canAct && (
            <div className="row fin-pt">
              <input className="input" placeholder="Comment" value={f.comment ?? ''} onChange={set('comment')} />
              {r.status === 'pending' && (
                <button className="btn btn-sm" onClick={() => go('regular', 'check', { regularId: r.id, comment: f.comment }, 'Checked.')}>
                  Check against agreement
                </button>
              )}
              {r.status !== 'ended' && (
                <button className="btn btn-sm" onClick={() => go('regular', 'end', { regularId: r.id, comment: f.comment }, 'Ended.')}>
                  End (settled or closed)
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Guarantees({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useGo(v.companyId);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ kind: 'IG' });
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const tone = (s: string): Tone => (s === 'refunded' || s === 'ended' ? 'ok' : s === 'called' ? 'crit' : s === 'pending' ? 'warn' : 'info');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>IG and BG: guarantees and cash collateral ({rm(v.collateralHeld)} held)</h3>
        {co.canAct && (
          <button className="btn btn-sm" onClick={() => setAdding((x) => !x)}>
            {adding ? 'Close' : 'Add'}
          </button>
        )}
      </div>
      <p className="muted small fin-intro">
        When the client releases a guarantee or it expires, claim the cash collateral back from the insurer or bank. Prima finds the refund on the bank statement.
      </p>
      <ErrorNotice error={act.error} />
      {adding && (
        <div className="fin-pad">
          <Field label="Type">
            <select className="select" value={f.kind} onChange={set('kind')}>
              <option value="IG">IG (insurance guarantee)</option>
              <option value="BG">BG (bank guarantee)</option>
            </select>
          </Field>
          <Field label="Contract it secures (fills the client; its release opens when the contract ends)">
            <Select
              className="select"
              value={f.contractId ?? ''}
              onChange={(e) => {
                const c = v.contractEnd.contracts.find((x) => x.id === e.target.value);
                setF((x) => ({ ...x, contractId: e.target.value, ...(c ? { beneficiary: c.client, purpose: x.purpose || `Contract ${c.ref}` } : {}) }));
              }}
            >
              <option value="">Not linked (tender, other)</option>
              {v.contractEnd.contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.client} · {c.ref}
                </option>
              ))}
            </Select>
          </Field>
          {(
            [
              ['issuer', f.kind === 'IG' ? 'Insurer' : 'Bank'],
              ['number', 'Guarantee number'],
              ['beneficiary', 'Client it is given to'],
              ['purpose', 'Contract or tender it secures'],
              ['amount', 'Guarantee amount'],
              ['collateral', 'Cash collateral placed (0 if none)'],
              ['doc', 'Guarantee letter (file name)'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <input className="input" value={f[k] ?? ''} onChange={set(k)} />
            </Field>
          ))}
          <Field label="Collateral paid back into">
            <Select className="select" value={f.bankId ?? ''} onChange={set('bankId')}>
              <option value="">Choose</option>
              {v.statements.map((s) => (
                <option key={s.bank.id} value={s.bank.id}>
                  {s.bank.bank} {s.bank.accountMasked}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Issued">
            <input className="input" type="date" value={f.issuedOn ?? ''} onChange={set('issuedOn')} />
          </Field>
          <Field label="Expires">
            <input className="input" type="date" value={f.expiresOn ?? ''} onChange={set('expiresOn')} />
          </Field>
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (await go('guarantees', 'add', { ...f, amount: Number(f.amount), collateral: Number(f.collateral || 0) }, 'Added. Someone else checks it next.')) setAdding(false);
            }}
          >
            Add
          </button>
        </div>
      )}
      <div className="list">
        {v.guarantees.length === 0 && <div className="list-item muted">No guarantees on the list.</div>}
        {v.guarantees.map((g) => (
          <div key={g.id} className="list-item fin-block">
            <div className="row fin-between">
              <div>
                <b>
                  {g.kind} {g.number}
                </b>{' '}
                · {g.beneficiary} · {g.purpose}
                <div className="muted small">
                  {g.issuer} · {rm(g.amount)} · collateral {rm(g.collateral)} · expires {dateLabel(g.expiresOn)}
                  {g.daysToExpiry >= 0 && g.daysToExpiry <= 60 && ` (${g.daysToExpiry} days)`}
                  {g.refund && ` · refund seen ${dateLabel(g.refund.date)}`}
                </div>
              </div>
              <span className="row">
                {g.claimNow && <Chip tone="crit">Claim collateral</Chip>}
                <Chip tone={tone(g.status)}>{g.status === 'pending' ? 'To check' : g.status}</Chip>
              </span>
            </div>
            {co.canAct && !['ended', 'refunded', 'called'].includes(g.status) && (
              <div className="row fin-pt">
                <input className="input" placeholder="Comment, document or claim reference" value={f[`x-${g.id}`] ?? ''} onChange={set(`x-${g.id}`)} />
                {g.status === 'pending' && (
                  <button className="btn btn-sm" onClick={() => go('guarantees', 'check', { guaranteeId: g.id, comment: f[`x-${g.id}`] }, 'Checked.')}>
                    Check
                  </button>
                )}
                {g.status === 'active' && (
                  <button className="btn btn-sm" onClick={() => go('guarantees', 'release', { guaranteeId: g.id, doc: f[`x-${g.id}`] }, "Client's release recorded.")}>
                    Client released it (letter)
                  </button>
                )}
                {g.claimNow && (
                  <button className="btn btn-sm" onClick={() => go('guarantees', 'claim', { guaranteeId: g.id, ref: f[`x-${g.id}`], docs: [g.release?.doc ?? 'Expiry', f[`x-${g.id}`]] }, 'Claim recorded. Prima looks for the refund.')}>
                    Claim sent
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function HostelWatch({ v }: { v: FinControls }) {
  if (!v.hostel.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Hostel bills</h3>
      </div>
      <p className="muted small fin-intro">
        Once FWM and the COO approve, record the payment here: the account, the day and the bank reference. FWM and the company see it as paid straight
        away, with the record, and Prima looks for it on the bank statement. No slip is needed.
      </p>
      <div className="list">
        {v.hostel.map((b) => (
          <HostelLine key={b.id} b={b} v={v} />
        ))}
      </div>
    </section>
  );
}

function HostelLine({ b, v }: { b: FinControls['hostel'][number]; v: FinControls }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const banks = v.statements.map((s) => s.bank);
  const [bankId, setBankId] = useState(banks.length === 1 ? banks[0].id : '');
  const [on, setOn] = useState(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10));
  const [ref, setRef] = useState('');
  return (
    <div className="list-item fin-stack">
      <div className="row fin-between">
        <span>
          {b.hostel}: {b.kind.toLowerCase()} {b.period} · {rm(b.amount)} · due {dateLabel(b.dueOn)}
          {b.paidOn && ` · paid ${dateLabel(b.paidOn)}`}
          {b.paidBy && <span className="muted"> · {b.paidBy}</span>}
        </span>
        <span className="row">
          <Chip tone={b.unseen || b.overdue ? 'crit' : b.onStatement ? 'ok' : b.mayRecord ? 'warn' : 'info'}>
            {b.unseen ? 'Not on bank statement' : b.onStatement ? 'Seen in bank' : b.mayRecord ? 'Approved, to pay' : b.overdue ? 'Overdue' : b.status.replace('_', ' ')}
          </Chip>
          {b.mayRecord && (
            <button className="btn btn-sm" onClick={() => setOpen(!open)}>
              {open ? 'Close' : 'Record payment'}
            </button>
          )}
        </span>
      </div>
      {open && b.mayRecord && (
        <div className="row fin-end">
          <Field label="Paid from">
            <Select className="select" value={bankId} onChange={(e) => setBankId(e.target.value)}>
              <option value="">Choose</option>
              {banks.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.bank} {k.accountMasked}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Day paid">
            <input className="input" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          </Field>
          <Field label="Bank reference">
            <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. IBG 2611020034" />
          </Field>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !bankId || ref.trim().length < 3}
            onClick={() => act.run(() => api.finControlAction(v.companyId, 'hostel', 'paid', { billId: b.id, bankId, on, ref }), `Recorded. FWM now sees it paid (${rm(b.amount)}).`)}
          >
            Save, {rm(b.amount)}
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

/**
 * Automation A4 / L1 (Fauzan, 2 Nov 2026): the Finance Director or the CEO approves the reviewed regular payments
 * together, with one comment. The server still checks each one.
 */
function BatchApprove({ co, companyId }: { co: Co; companyId: string }) {
  const act = useAction();
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<{ approved: string[]; refused: { id: string; reason: string }[] } | null>(null);
  const ready = co.payments.filter((p) => p.regularId && p.status === 'reviewed' && p.may.includes('approve'));
  if (!ready.length && !result) return null;
  return (
    <div className="fin-padb">
      <div className="fin-strong">Approve reviewed regular payments together</div>
      <div className="muted small">
        {ready.map((p) => `${p.payee} ${rm(p.amount)} (${p.regularPeriod})`).join(' · ')} · total {rm(ready.reduce((n, p) => n + p.amount, 0))}
      </div>
      {ready.length > 0 && (
        <>
          <Field label="Your comment (one for all)">
            <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Instalments and contributions agreed to the list" />
          </Field>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              const r = await act.run(() => api.finControlAction(companyId, 'regular', 'approveBatch', { paymentIds: ready.map((p) => p.id), comment }), 'Approved.');
              if (r) setResult(r as { approved: string[]; refused: { id: string; reason: string }[] });
            }}
          >
            Approve {ready.length}
          </button>
        </>
      )}
      {result && (
        <div className="muted small">
          {result.approved.length} approved.{result.refused.length > 0 && ` Not approved: ${result.refused.map((x) => `${x.id} (${x.reason})`).join('; ')}.`}
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
