import { Select } from '../SearchSelect';
import { useState } from 'react';
import { IT_TICKET_PRIORITIES, type ItTicket, type ProofInput } from '@prima/core';
import { api } from '../api';
import { ErrorNotice, useAction } from '../ui';
import { ProofPicker } from './Proof';

/**
 * Merdeka Network IT policies (Part Q, 13-14 Nov 2026): the ticket policy IT-POL-004 and its circular. Tools IT uses on
 * a help request (acknowledge, priority with a reason, vendor referral and answer, lost or stolen register update), the
 * facts shown on it, recording a confirmation given outside Prima with proof, and the monthly service report.
 */

export function TicketPolicyFacts({ ticket: t }: { ticket: ItTicket }) {
  const bits: string[] = [];
  if (t.contactPhone) bits.push(`Tel: ${t.contactPhone}`);
  if (t.photos?.length) bits.push(`${t.photos.length} gambar`);
  if (t.vendorReferral) bits.push(`Dirujuk kepada ${t.vendorReferral.vendor}${t.vendorReferral.caseNo ? ` (kes ${t.vendorReferral.caseNo})` : ''} ${t.vendorReferral.on}${t.vendorReferral.answer ? ` · jawapan: ${t.vendorReferral.answer}` : ''}`);
  if (t.deviceReport) bits.push(`Laporan peranti: ${({ lost: 'hilang', stolen: 'dicuri', damaged: 'rosak', not_working: 'tidak berfungsi' } as const)[t.deviceReport.kind]}${t.deviceReport.policeReportNo ? ` · laporan polis ${t.deviceReport.policeReportNo}` : ''}`);
  if (t.priorityChanges?.length) bits.push(t.priorityChanges.map((c) => `${c.from} ke ${c.to}: ${c.reason}`).join('; '));
  if (t.purchaseRequestId) bits.push('Dijadikan permohonan pembelian');
  if (!bits.length && !t.notes?.length) return null;
  return (
    <div className="muted small">
      {bits.join(' · ')}
      {(t.notes ?? []).slice(-3).map((n) => (
        <div key={n.at + n.text}>
          {n.by}: {n.text}
        </div>
      ))}
    </div>
  );
}

export function TicketPolicyTools({ ticket: t, lead }: { ticket: ItTicket; lead: boolean }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [vendor, setVendor] = useState('');
  const [caseNo, setCaseNo] = useState('');
  const [priority, setPriority] = useState(t.priority);
  const step = (s: string, extra: Record<string, unknown> = {}, done = 'Saved.') => void act.run(() => api.itAct('ticketStep', { id: t.id, step: s, note: text, ...extra }), done).then((r) => r && setText(''));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button className="btn btn-sm" onClick={() => setOpen(!open)}>
        {open ? 'Hide IT tools' : 'More: respond, priority, vendor'}
      </button>
      {open && (
        <>
          <input className="input" aria-label="Note" placeholder="Note or reason" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {!t.firstResponseAt && (
              <button className="btn btn-sm" disabled={act.busy || text.trim().length < 2} onClick={() => step('acknowledge', {}, 'Response recorded.')}>
                Record first response
              </button>
            )}
            {lead && (
              <>
                <Select className="select" aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as ItTicket['priority'])}>
                  {IT_TICKET_PRIORITIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
                <button className="btn btn-sm" disabled={act.busy || priority === t.priority || text.trim().length < 3} onClick={() => step('priority', { priority }, 'Priority changed.')}>
                  Change priority
                </button>
              </>
            )}
            {t.deviceReport && (t.deviceReport.kind === 'lost' || t.deviceReport.kind === 'stolen' || t.deviceReport.kind === 'damaged') && (
              <button className="btn btn-sm" disabled={act.busy || text.trim().length < 3} onClick={() => void act.run(() => api.itAct('deviceReportApply', { id: t.id, note: text }), 'Register updated.')}>
                Update the asset register
              </button>
            )}
            {t.category === 'PROCUREMENT' && !t.purchaseRequestId && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.itAct('policyAct', { op: 'requestFromTicket', ticketId: t.id }), 'Purchase request opened.')}>
                Jadikan permohonan pembelian
              </button>
            )}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {!t.vendorReferral ? (
              <>
                <input className="input" aria-label="Vendor" placeholder="Vendor name" value={vendor} onChange={(e) => setVendor(e.target.value)} />
                <input className="input" aria-label="Vendor case number" placeholder="Vendor case number" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} />
                <button className="btn btn-sm" disabled={act.busy || vendor.trim().length < 2} onClick={() => step('refer', { vendor, caseNo }, 'Referred to the vendor.')}>
                  Dirujuk kepada pembekal
                </button>
              </>
            ) : (
              <button className="btn btn-sm" disabled={act.busy || text.trim().length < 2} onClick={() => step('vendorAnswer', {}, 'Vendor answer saved.')}>
                Save the vendor's answer
              </button>
            )}
          </div>
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** IT records a confirmation the person gave by phone, Teams or email, with proof, after the first reminder (Q-X2). */
export function RecordPrimaConfirm({ id }: { id: string }) {
  const act = useAction();
  const [via, setVia] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input className="input" aria-label="How they answered" placeholder="How the person answered (Teams chat, email, phone, with the time)" value={via} onChange={(e) => setVia(e.target.value)} />
      <ProofPicker site={null} refText="Screenshot of the person's answer" items={proof} onChange={setProof} documentsOnly />
      <button className="btn btn-sm" disabled={act.busy || via.trim().length < 3 || !proof.length} onClick={() => void act.run(() => api.itAct('recordConfirm', { id, fixed: true, via, proof }), 'Recorded as confirmed.')}>
        Record the person's confirmation
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

type Report = { month: string; opened: number; resolved: number; byCategory: Record<string, number>; byPriority: Record<string, number>; respondedInTimePct: number | null; confirmedPct: number | null; reopened: number; openPastLimit: number; waitingConfirmation: number; holidaysSet: boolean; csv: string };

/** The monthly IT service report (Q5): IT Manager, COO and CEO; numbers only, no staff ranking; CSV download. */
export function ServiceReport({ role }: { role: string | null }) {
  const act = useAction();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [r, setR] = useState<Report | null>(null);
  if (role !== 'manager' && role !== 'coo' && role !== 'view') return null;
  const download = () => {
    if (!r) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' }));
    a.download = `it-service-report-${r.month}.csv`;
    a.click();
  };
  return (
    <div className="panel" style={{ marginBottom: 8 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <strong>Laporan perkhidmatan IT</strong>
        <input className="input" type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.itAct('serviceReport', { month })).then((x) => x && setR(x as Report))}>
          Show
        </button>
        {r && (
          <button className="btn btn-sm" onClick={download}>
            Download CSV
          </button>
        )}
      </div>
      {r && (
        <div className="muted small">
          Opened {r.opened} · resolved {r.resolved} · responded in time {r.respondedInTimePct ?? '-'}% · confirmed by the person {r.confirmedPct ?? '-'}% · reopened {r.reopened} · open past the response target {r.openPastLimit} · waiting for confirmation {r.waitingConfirmation}
          <div>By category: {Object.entries(r.byCategory).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}</div>
          <div>By priority: {Object.entries(r.byPriority).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}</div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
