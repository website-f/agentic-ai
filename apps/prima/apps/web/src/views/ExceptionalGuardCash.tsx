import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { ErrorNotice, useAction, useLoad } from '../ui';
import { readAsDataUrl } from './Proof';

type View = Awaited<ReturnType<typeof api.finExceptionalCash>>;
type Row = View['rows'][number];
const rm = (n: number) => `RM${n.toFixed(2)}`;
function download(name: string, content: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
const csv = (v: string) => '"' + (/^(?:\s*[=+@-]|[\t\r\n])/.test(v) ? "'" + v : v).replaceAll('"', '""') + '"';
/** P90: people the server refuses (e.g. the CEO on Director Office) see nothing here, not a red error; `picker` shows only when allowed. */
export function ExceptionalGuardCash({ companyId, picker }: { companyId: string; picker?: ReactNode }) {
  const { data, error, reload } = useLoad(() => api.finExceptionalCash(companyId), [companyId]);
  const act = useAction();
  const [checked, setChecked] = useState(false);
  if (error && /^Not allowed:/.test(error)) return null;
  if (error) return <>{picker}<ErrorNotice error={error} /></>;
  if (!data) return <p>Loading approved guard cash handovers…</p>;
  const submit = async (file?: File) => {
    if (!file) return;
    const ok = await act.run(async () => {
      if (file.size > 10_000_000) throw new Error('Approved handover file is too large.');
      const input = JSON.parse(await file.text());
      return api.finControlAction(companyId, 'exceptionalcash', 'submit', { ...input, evidenceChecked: checked });
    }, 'Approved handover submitted to Finance. No payment recorded.');
    if (ok) reload();
  };
  return <section className="panel" aria-label="Exceptional guard cash">
    <h3>Exceptional guard cash</h3>
    {picker}
    <p>Operations Managers request support manually. CEO approves each named guard, amount and payment occasion manually. Director Office prepares the approved list in the separate controlled Excel workbook and hands it to Finance.</p>
    <p className="notice">{data.accountingGate} Approval is not a payout. Actual hours and ordinary wages remain unchanged.</p>
    {data.canSubmit && <div className="stack">
      <button className="btn" onClick={() => download('guard-master.csv', ['personId,staffNo,name,companyId,siteId,siteName,date,refreshedAt', ...data.master.flatMap(p => (p.assignments.length ? p.assignments : [{siteId:'',siteName:'',date:''}]).map(a => [p.personId,p.staffNo,p.name,p.companyId,a.siteId,a.siteName,a.date,data.refreshedAt].map(csv).join(',')))].join('\r\n'))}>Download read-only guard master</button>
      <button className="btn" onClick={() => download('cash-workbook-master.json', JSON.stringify({version:1,kind:'exceptional-cash-workbook-master',companyId:data.companyId,refreshedAt:data.refreshedAt,master:data.master,submitted:data.rows.map(r => ({id:r.id,personId:r.personId,occasion:r.occasion,approvalId:r.approval.id,batchId:r.batchId,status:r.status}))}, null, 2), 'application/json')}>Download scoped workbook refresh</button>
      <p>Master refreshed {data.refreshedAt}. Use the controlled local Excel template and cash_workbook.py refresh/seal/convert steps before handover. The scoped refresh file contains minimal guard identity including unassigned buffer guards where company-wide access permits, published roster assignments and duplicate references; keep it local and access-controlled. Unassigned guards can be listed, but need an authoritative site assignment before payment handover. Select each authorized company to read its library. No automatic connection or upload is enabled.</p>
      <label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> I checked each manual request and CEO approval against the named guard, amount and occasion.</label>
      <label>Upload approved handover<input type="file" accept="application/json,.json" disabled={!checked || act.busy} onChange={e => void submit(e.target.files?.[0])} /></label>
    </div>}
    <ErrorNotice error={act.error} />
    {!data.rows.length && <p>No approved handovers for this company.</p>}
    {data.rows.map(r => <CashRow key={r.id} row={r} view={data} reload={reload} />)}
  </section>;
}
function CashRow({ row: r, view, reload }: { row: Row; view: View; reload: () => void }) {
  const act = useAction();
  const [ref, setRef] = useState('');
  const [custodian, setCustodian] = useState('');
  const [value, setValue] = useState('');
  const [at, setAt] = useState('');
  const [evidence, setEvidence] = useState<{name: string; data: string} | null>(null);
  const [signed, setSigned] = useState(false);
  const [payrollRef, setPayrollRef] = useState('');
  const [policyRef, setPolicyRef] = useState('');
  const [pendingTreatment, setPendingTreatment] = useState(true);
  const action = view.canSubmit && r.payout && !r.receipt ? 'receipt' : view.canFinance && r.status === 'submitted' ? 'prepare' : view.canFinance && r.status === 'prepared' ? 'pay' : view.canFinance && r.status === 'paid' && r.receipt ? 'reconcile' : view.canFinance && r.status === 'reconciled' ? (r.treatment?.status === 'pending' ? 'reviewTreatment' : r.accounting || !r.payout ? 'complete' : 'post') : null;
  const go = async () => {
    if (!action) return;
    const payload = action === 'prepare' ? { ref, custodianId: custodian } : action === 'pay' ? { ref, amount: Number(value), atPaid: at, evidence } : action === 'receipt' ? { signedByPersonId: r.personId, paymentRef: r.payout!.ref, amount: r.payout!.amount, signedAt: at, transactionSpecific: signed, evidence } : action === 'post' ? { journalRef: ref, payrollRecordRef: payrollRef, additionalPayrollConfirmed: signed, statutoryRecordsConfirmed: !pendingTreatment && signed, ...(pendingTreatment ? {treatmentStatus:'pending'} : {}), evidence } : action === 'reviewTreatment' ? {policyRef,recordRef:payrollRef,statutoryRecordsConfirmed:signed,evidence} : action === 'complete' ? {} : { ref, returned: Number(value), evidence };
    if (await act.run(() => api.finControlAction(r.companyId, 'exceptionalcash', action, { id: r.id, ...payload }), 'Record saved. Ordinary wages remain payable in full.')) reload();
  };
  return <article className="panel" style={{ overflowWrap: 'anywhere' }}>
    <h4>{r.name} · {r.staffNo} · {r.siteName}</h4>
    <p>{r.occasion} · Approved {rm(r.amount)} · {r.status} · {r.id}</p>
    <p>Manual OM request: {r.request.by} at {r.request.at}. Manual approval: {r.approval.by} at {r.approval.at} ({r.approval.id}). Workbook: {r.workbookRef}.</p>
    <p>Actual payment: {r.payout ? `${rm(r.payout.amount)} / ${r.payout.ref}` : 'Not recorded'}. Signed receipt: {r.receipt ? 'Collected' : 'Missing'}. Reconciliation: {r.reconciliation ? 'Recorded' : 'Pending'}. Site P&amp;L: {r.accounting ? `Salary cost – cash payment ${rm(r.accounting.amount)} / ${r.accounting.journalRef}` : "Awaiting payroll accounting"}. Budget: Miscellaneous payroll expenses. Treatment: {r.treatment?.status ?? (r.accounting ? 'Previously confirmed records' : 'Not yet recorded')}.</p>
    <div className="row" style={{ flexWrap: 'wrap' }}>{[
      ['Manual OM request', r.request.evidence], ['Manual CEO approval', r.approval.evidence],
      ['Actual payment evidence', r.payout?.evidence], ['Signed receipt', r.receipt?.evidence],
      ['Reconciliation evidence', r.reconciliation?.evidence], ['Payroll accounting evidence', r.accounting?.evidence], ['Treatment review evidence', r.treatment?.status === 'reviewed' ? r.treatment.evidence : undefined],
    ].filter((entry): entry is [string,string] => !!entry[1]).map(([label,id]) => <button className="btn btn-sm" key={id} disabled={act.busy} onClick={() => void act.run(async () => {
      const doc = await api.finExceptionalCashEvidence(r.companyId, id);
      const a = document.createElement('a'); a.href = doc.data; a.download = doc.name; a.click(); return true;
    })}>{label}</button>)}</div>
    {action && <div className="stack">
      {action !== 'receipt' && action !== 'reviewTreatment' && action !== 'complete' && <label>Reference<input className="input" value={ref} onChange={e => setRef(e.target.value)} /></label>}
      {action === 'post' && <><label>Payroll accounting / pending-treatment register reference<input className="input" value={payrollRef} onChange={e => setPayrollRef(e.target.value)} /></label><label><input type="checkbox" checked={pendingTreatment} onChange={e => setPendingTreatment(e.target.checked)} /> Statutory treatment pending Finance/adviser review. Record the actual external journal once; completion remains blocked.</label><label><input type="checkbox" checked={signed} onChange={e => setSigned(e.target.checked)} /> I verified the manual journal for this site and additional expense; ordinary wages remain payable in full.{!pendingTreatment && ' All required payroll, payslip, tax and contribution records are complete.'}</label></>}
      {action === 'reviewTreatment' && <><label>Finance/adviser treatment decision reference<input className="input" value={policyRef} onChange={e => setPolicyRef(e.target.value)} /></label><label>Completed payroll/statutory records reference<input className="input" value={payrollRef} onChange={e => setPayrollRef(e.target.value)} /></label><label><input type="checkbox" checked={signed} onChange={e => setSigned(e.target.checked)} /> Finance/adviser review is recorded and all required payroll, payslip, tax and contribution records are complete. No exemption is assumed.</label></>}
      {action === 'prepare' && <label>Finance custodian account ID<input className="input" value={custodian} onChange={e => setCustodian(e.target.value)} /></label>}
      {(action === 'pay' || action === 'reconcile') && <label>{action === 'pay' ? 'Actual amount paid' : 'Cash returned and counted'}<input className="input" type="number" min="0" step="0.01" value={value} onChange={e => setValue(e.target.value)} /></label>}
      {(action === 'pay' || action === 'receipt') && <label>{action === 'pay' ? 'Actual payment timestamp' : 'Receipt signing timestamp'} (include timezone)<input className="input" placeholder="2026-11-08T10:00:00+08:00" value={at} onChange={e => setAt(e.target.value)} /></label>}
      {action === 'receipt' && <label><input type="checkbox" checked={signed} onChange={e => setSigned(e.target.checked)} /> This scan, photo or electronic acknowledgement was genuinely supplied by this guard for this payment, date, amount and reference. Any stored signature was compared for identity only, never pasted as a receipt.</label>}
      {action !== 'prepare' && action !== 'complete' && <label>{action === 'receipt' ? 'Transaction-specific acknowledgement (scan, photo or electronic PDF)' : 'Payment or reconciliation evidence'}<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={e => { const f = e.target.files?.[0]; if (f) void act.run(async () => { setEvidence({name: f.name, data: await readAsDataUrl(f)}); return true; }); }} /></label>}
      {view.canFinance && r.status === 'prepared' && <button className="btn" disabled={act.busy} onClick={() => void act.run(async () => {
        const result = await api.finControlAction(r.companyId, 'exceptionalcash', 'returnUnpaid', { id: r.id, returned: Number(value), ref, evidence }); reload(); return result;
      }, 'Unpaid cash returned; no payroll expense recorded.')}>Record full unpaid return (independent Finance count)</button>}
      <button className="btn" disabled={act.busy || ((action === 'receipt' || action === 'post' || action === 'reviewTreatment') && !signed)} onClick={() => void go()}>{({prepare:'Record cash preparation and custody',pay:'Record actual payment',receipt:'Upload signed acknowledgement',reconcile:'Record cash return and reconciliation',post:'Record payroll accounting',reviewTreatment:'Record Finance/adviser treatment review',complete:'Mark complete'})[action]}</button>
    </div>}
    <p className="muted small">Prepared or posted records cannot be edited, cancelled or reversed here. A full unpaid return preserves the original approval and requires a different Finance officer. Other corrections need an agreed authorization and payroll/accounting reversal procedure; keep the original evidence and do not submit a substitute payout.</p>
    <ErrorNotice error={act.error} />
  </article>;
}
