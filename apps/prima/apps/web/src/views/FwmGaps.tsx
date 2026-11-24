import { useState } from 'react';
import type { FwBulkCheck, FwGapsService, ProofInput } from '@prima/core';
import { api } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';
import { parseCsv } from './JaSwitch';

/**
 * FWM department check gaps (Fauzan, 23 Nov 2026: "Do the gap"): loading the paper dates FWM keeps in Excel, the levy on
 * each work permit renewal, an exit file for every leaver, absconding cases raised by the OM (never automatic), a light
 * quota tracker, the hostel certificate reminders and which FWM Executive owns each company's workers.
 */
type Board = Awaited<ReturnType<FwGapsService['board']>>;
const load = () => api.fwGapsAct('board', {}) as Promise<Board>;

function today(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function NotInstalled({ data }: { data: Board }) {
  if (data.installed) return null;
  return (
    <div className="panel" style={{ padding: 12 }}>
      <Chip tone="unknown">Not installed yet</Chip>{' '}
      <span className="muted">Exit files, missing-worker cases, quotas and the caseload need database module fw-gaps-v1, which runs after the merge.</span>
    </div>
  );
}

/** FWM staff have no home page: their reminders from the check gaps sit on top of the Foreign workers screen. */
export function FwTodoPanel() {
  const { data } = useLoad(load, []);
  if (!data?.todo.length) return null;
  return (
    <div className="panel">
      <h3>Do today</h3>
      {data.todo.map((t) => (
        <div className="item" key={`${t.tag}-${t.title}`}>
          <Chip tone={t.tone === 'crit' ? 'crit' : t.tone === 'warn' ? 'warn' : 'info'}>{t.tag}</Chip> <strong>{t.title}</strong>
          <div className="muted small">{t.detail}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- B1 load dates ----------

const TEMPLATE = 'company,staff no,paper,number,issued on,expires on\nSASA,NP-0001,PLKS,PL123456,01/04/2026,31/03/2027\nSASA,NP-0001,Passport,PA1234567,15/06/2022,14/06/2032\n';

/** Rows from a CSV file or from cells pasted out of Excel (tab separated), matched by header words. */
export function fwListRows(text: string): { company: string; staffNo: string; paper: string; number: string; issuedOn: string; expiresOn: string }[] {
  const clean = text.replace(/^﻿/, '');
  const first = clean.split(/\r?\n/, 1)[0] ?? '';
  const rows: Record<string, string>[] = first.includes('\t')
    ? (() => {
        const lines = clean.split(/\r?\n/).filter((l) => l.trim());
        const head = (lines.shift() ?? '').split('\t').map((h) => h.trim());
        return lines.map((l) => {
          const cells = l.split('\t');
          return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()]));
        });
      })()
    : parseCsv(clean);
  const pick = (r: Record<string, string>, ...words: RegExp[]) => {
    const k = Object.keys(r).find((h) => words.some((w) => w.test(h.toLowerCase())));
    return k ? r[k] : '';
  };
  return rows.map((r) => ({
    company: pick(r, /compan/, /syarikat/),
    staffNo: pick(r, /staff/, /pekerja/, /^no\.?$/, /worker/),
    paper: pick(r, /paper/, /dokumen/, /type/, /jenis/),
    number: pick(r, /number/, /^no\.? (paper|dokumen)/, /nombor/),
    issuedOn: pick(r, /issue/, /keluar/, /mula/),
    expiresOn: pick(r, /expir/, /tamat/, /luput/),
  }));
}

export function FwBulkLoadPanel() {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<{ rows: FwBulkCheck[]; counts: { load: number; skip: number; error: number } } | null>(null);
  const act = useAction();
  const rows = text.trim() ? fwListRows(text) : [];
  const tone: Record<FwBulkCheck['status'], Tone> = { load: 'ok', skip: 'info', error: 'crit' };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Load paper dates from FWM&apos;s list</h2>
      </div>
      <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p className="muted small">
          Choose a CSV file (in Excel: File, Save As, CSV), or copy the cells in Excel and paste them below with the header row. Columns: company (code or name), staff no, paper (PLKS,
          passport, FOMEMA, insurance, SPIKPA, KDN letter), number, issued on, expires on. Dates as 31/03/2027 or 2027-03-31. Nothing is saved until you check the preview and press Load.
        </p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <label className="btn btn-sm">
            Choose CSV file
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              style={{ display: 'none' }}
              aria-label="CSV file of paper dates"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setName(f.name);
                setText(await f.text());
                setPreview(null);
              }}
            />
          </label>
          <a className="btn btn-sm" download="fwm-paper-dates-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}>
            Download the template
          </a>
          {name && <span className="muted small">{name}</span>}
        </div>
        <textarea
          className="input"
          rows={5}
          aria-label="Paste the rows from Excel"
          placeholder="Or paste the cells from Excel here, with the header row"
          value={text}
          onChange={(e) => (setText(e.target.value), setPreview(null))}
        />
        <div className="muted small">{rows.length} row{rows.length === 1 ? '' : 's'} read.</div>
        <ErrorNotice error={act.error} />
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" disabled={act.busy || !rows.length} onClick={async () => setPreview((await act.run(() => api.fwGapsAct('bulkPreview', { rows }) as Promise<NonNullable<typeof preview>>)) ?? null)}>
            Check the list
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || !preview || preview.counts.load === 0}
            onClick={async () => {
              const r = await act.run(
                () => api.fwGapsAct('bulkSave', { rows }) as Promise<{ ref: string; loaded: number }>,
                (x) => `${x.loaded} dates loaded (${x.ref}). They show as "From the list, copy not seen" until the copy is recorded.`,
              );
              if (r) (setText(''), setName(''), setPreview(null));
            }}
          >
            Load {preview?.counts.load ?? 0} dates
          </button>
        </div>
        {preview && (
          <>
            <div className="kpis">
              <Kpi label="To load" value={preview.counts.load} tone="ok" />
              <Kpi label="Already on record" value={preview.counts.skip} />
              <Kpi label="Need fixing" value={preview.counts.error} tone={preview.counts.error ? 'crit' : 'ok'} />
            </div>
            <div className="list">
              {preview.rows.map((r) => (
                <div key={r.line} className="list-item" style={{ justifyContent: 'space-between', gap: 6 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      Row {r.line}: {r.staffNo || '(no staff no.)'} {r.name ? `· ${r.name}` : ''}
                    </div>
                    <div className="muted small">
                      {r.companyName ?? ''} {r.paper ? `· ${r.paper}` : ''} {r.expiresOn ? `· expires ${dateLabel(r.expiresOn)}` : ''} · {r.why}
                    </div>
                  </div>
                  <Chip tone={tone[r.status]}>{r.status === 'load' ? 'Load' : r.status === 'skip' ? 'Skip' : 'Fix'}</Chip>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ---------- B3 levy ----------

export function LevyForm({ renewalId, changing, onDone }: { renewalId: string; changing: boolean; onDone: () => void }) {
  const [amount, setAmount] = useState('1850.00');
  const [paidOn, setPaidOn] = useState(today());
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="grid-2">
        <label className="field">
          <span className="label">Levy paid (RM)</span>
          <input className="input" inputMode="decimal" aria-label="Levy amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Paid on</span>
          <input className="input" type="date" aria-label="Levy paid on" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Receipt or FWCMS reference</span>
          <input className="input" aria-label="Levy receipt reference" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
        {changing && (
          <label className="field">
            <span className="label">Why it changes</span>
            <input className="input" aria-label="Why the levy changes" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        )}
      </div>
      <ProofPicker site={null} refText="FWM levy" items={proof} onChange={setProof} documentsOnly required />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !proof.length || ref.trim().length < 3}
          onClick={async () => {
            const ok = await act.run(() => api.fwGapsAct('recordLevy', { renewalId, amount: Number(amount), paidOn, ref, reason, proof }), 'Levy recorded on the renewal.');
            if (ok) onDone();
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- B4 exits and D2 missing workers ----------

function PaperStepForm({ label, onSave, onDone, withProof = true }: { label: string; onSave: (x: { ref: string; on: string; proof: ProofInput[] }) => Promise<unknown>; onDone: () => void; withProof?: boolean }) {
  const [ref, setRef] = useState('');
  const [on, setOn] = useState(today());
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="grid-2">
        <label className="field">
          <span className="label">{label}: reference</span>
          <input className="input" aria-label={`${label} reference`} value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Date</span>
          <input className="input" type="date" aria-label={`${label} date`} value={on} onChange={(e) => setOn(e.target.value)} />
        </label>
      </div>
      {withProof && <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly required />}
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || ref.trim().length < 3 || (withProof && !proof.length)}
          onClick={async () => {
            const ok = await act.run(() => onSave({ ref, on, proof }), `${label} recorded.`);
            if (ok) onDone();
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ExitRow({ x, canWork }: { x: Board['exits'][number]; canWork: boolean }) {
  const [step, setStep] = useState<'memo' | 'flight' | 'labour' | 'immigration' | null>(null);
  const act = useAction();
  const save = (st: string) => (v: { ref: string; on: string; proof: ProofInput[] }) => api.fwGapsAct('exitStep', { id: x.id, step: st, ...v });
  const line = (label: string, v: { ref: string; on: string } | null, need = true) =>
    need && (
      <div className="small">
        {label}: {v ? `${v.ref}, ${dateLabel(v.on)}` : <Chip tone="warn">Not yet</Chip>}
      </div>
    );
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {x.name} · {x.reasonLabel}
          </div>
          <div className="muted small">
            {x.staffNo} · {x.companyName} · last day {dateLabel(x.lastDay)} · report due {dateLabel(x.reportDue)}
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {x.reportLate && <Chip tone="crit">Report late</Chip>}
          {x.staffRecordActive && <Chip tone="warn">Staff record still active</Chip>}
          <Chip tone={x.status === 'closed' ? 'ok' : 'info'}>{x.status === 'closed' ? 'Closed' : 'Open'}</Chip>
        </div>
      </div>
      {line('Check-out memo', x.memo, x.needsMemo)}
      {x.needsFlight && <div className="small">Flight: {x.flight ? `${x.flight.ref}, ${dateLabel(x.flight.on)}` : <Chip tone="warn">Not yet</Chip>}</div>}
      {line('Report to the Labour Department', x.labour)}
      {line('Report to Immigration', x.immigration)}
      {x.history.slice(-2).map((h) => (
        <div key={h.at} className="muted small">
          {dateTimeLabel(h.at)} · {h.by}: {h.note}
        </div>
      ))}
      {canWork && x.status === 'open' && !step && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {x.needsMemo && (
            <button className="btn btn-sm" onClick={() => setStep('memo')}>
              Check-out memo
            </button>
          )}
          {x.needsFlight && (
            <button className="btn btn-sm" onClick={() => setStep('flight')}>
              Flight
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setStep('labour')}>
            Labour report
          </button>
          <button className="btn btn-sm" onClick={() => setStep('immigration')}>
            Immigration report
          </button>
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.fwGapsAct('exitStep', { id: x.id, step: 'close' }), 'Exit file closed.')}>
            Close the file
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
      {step === 'memo' && <PaperStepForm label="Check-out memo" onSave={save('memo')} onDone={() => setStep(null)} />}
      {step === 'flight' && <PaperStepForm label="Flight" withProof={false} onSave={save('flight')} onDone={() => setStep(null)} />}
      {step === 'labour' && <PaperStepForm label="Report to the Labour Department" onSave={save('labour')} onDone={() => setStep(null)} />}
      {step === 'immigration' && <PaperStepForm label="Report to Immigration" onSave={save('immigration')} onDone={() => setStep(null)} />}
    </div>
  );
}

function AbscondRow({ x }: { x: Board['absconds'][number] }) {
  const [mode, setMode] = useState<'found' | 'report' | null>(null);
  const [foundOn, setFoundOn] = useState(today());
  const [note, setNote] = useState('');
  const [p, setP] = useState({ policeRef: '', policeOn: today(), immigrationRef: '', immigrationOn: today() });
  const [pp, setPp] = useState<ProofInput[]>([]);
  const [ip, setIp] = useState<ProofInput[]>([]);
  const act = useAction();
  const label = { raised: 'Raised, FWM to act', reported: 'Reported to police and Immigration', found: 'Found' }[x.status];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{x.name}</div>
          <div className="muted small">
            {x.staffNo} · {x.companyName} · last seen {dateLabel(x.lastSeenOn)} ({x.daysMissing} days) · raised by {x.raisedBy}
          </div>
          <div className="small">Tried: {x.contactTried}</div>
          {x.police && <div className="small">Police report {x.police.ref}, {dateLabel(x.police.on)} · Immigration {x.immigration?.ref}, {dateLabel(x.immigration?.on)}</div>}
        </div>
        <Chip tone={x.status === 'raised' ? 'crit' : x.status === 'found' ? 'ok' : 'warn'}>{label}</Chip>
      </div>
      {!mode && x.status === 'raised' && (
        <div className="row" style={{ gap: 6 }}>
          {x.canReport && (
            <button className="btn btn-sm btn-primary" onClick={() => setMode('report')}>
              Record police and Immigration reports
            </button>
          )}
          {x.canFound && (
            <button className="btn btn-sm" onClick={() => setMode('found')}>
              Worker found
            </button>
          )}
        </div>
      )}
      <ErrorNotice error={act.error} />
      {mode === 'found' && (
        <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input className="input" type="date" aria-label="Found on" value={foundOn} onChange={(e) => setFoundOn(e.target.value)} />
          <input className="input" aria-label="Where found" placeholder="Where the worker was found" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={async () => (await act.run(() => api.fwGapsAct('abscondStep', { id: x.id, step: 'found', foundOn, note }), 'Case closed: found.')) && setMode(null)}>
              Save
            </button>
            <button className="btn btn-sm" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {mode === 'report' && (
        <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="grid-2">
            <input className="input" aria-label="Police report number" placeholder="Police report number" value={p.policeRef} onChange={(e) => setP({ ...p, policeRef: e.target.value })} />
            <input className="input" type="date" aria-label="Police report date" value={p.policeOn} onChange={(e) => setP({ ...p, policeOn: e.target.value })} />
          </div>
          <ProofPicker site={null} refText="Police report" items={pp} onChange={setPp} documentsOnly required />
          <div className="grid-2">
            <input className="input" aria-label="Immigration notice reference" placeholder="Immigration notice reference" value={p.immigrationRef} onChange={(e) => setP({ ...p, immigrationRef: e.target.value })} />
            <input className="input" type="date" aria-label="Immigration notice date" value={p.immigrationOn} onChange={(e) => setP({ ...p, immigrationOn: e.target.value })} />
          </div>
          <ProofPicker site={null} refText="Immigration notice" items={ip} onChange={setIp} documentsOnly required />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || !pp.length || !ip.length}
              onClick={async () => (await act.run(() => api.fwGapsAct('abscondStep', { id: x.id, step: 'report', ...p, policeProof: pp, immigrationProof: ip }), 'Reported. An exit file is open for the Labour report.')) && setMode(null)}
            >
              Save
            </button>
            <button className="btn btn-sm" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FwExitsPanel() {
  const { data, error } = useLoad(load, []);
  const [open, setOpen] = useState<'exit' | 'missing' | null>(null);
  const [f, setF] = useState({ personId: '', reason: 'END', lastDay: today(), note: '', lastSeenOn: '', contactTried: '' });
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="leavers and missing workers" />;
  const board = data.role === 'staff' || data.role === 'escalation';
  const workerPick = (
    <select className="select" aria-label="Worker" value={f.personId} onChange={(e) => setF({ ...f, personId: e.target.value })}>
      <option value="">Choose the worker</option>
      {data.workers.map((w) => (
        <option key={w.id} value={w.id}>
          {w.staffNo} · {w.name} · {w.companyName}
        </option>
      ))}
    </select>
  );
  return (
    <>
      <NotInstalled data={data} />
      <section className="panel">
        <div className="panel-head">
          <h2>Missing workers</h2>
          {data.canRaise && data.installed && (
            <button className="btn btn-sm" onClick={() => setOpen(open === 'missing' ? null : 'missing')}>
              Report a missing worker
            </button>
          )}
        </div>
        <p className="muted small" style={{ padding: '0 12px' }}>
          {data.rules.abscond.source}
        </p>
        {open === 'missing' && (
          <div className="panel" style={{ margin: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {workerPick}
            <label className="field">
              <span className="label">Last seen on</span>
              <input className="input" type="date" aria-label="Last seen on" value={f.lastSeenOn} onChange={(e) => setF({ ...f, lastSeenOn: e.target.value })} />
            </label>
            <input className="input" aria-label="How you tried to reach the worker" placeholder="How you tried to reach the worker (phone, hostel, friends)" value={f.contactTried} onChange={(e) => setF({ ...f, contactTried: e.target.value })} />
            <ErrorNotice error={act.error} />
            <div className="row" style={{ gap: 6 }}>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !f.personId || !f.lastSeenOn}
                onClick={async () => (await act.run(() => api.fwGapsAct('raiseAbscond', { personId: f.personId, lastSeenOn: f.lastSeenOn, contactTried: f.contactTried }), 'Raised to FWM.')) && setOpen(null)}
              >
                Raise to FWM
              </button>
              <button className="btn btn-sm" onClick={() => setOpen(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="list">
          {data.absconds.length === 0 && <div className="empty">No missing worker raised.</div>}
          {data.absconds.map((x) => (
            <AbscondRow key={x.id} x={x} />
          ))}
        </div>
      </section>
      {board && (
        <section className="panel">
          <div className="panel-head">
            <h2>Leavers: exit files</h2>
            {data.canWork && data.installed && (
              <button className="btn btn-sm" onClick={() => setOpen(open === 'exit' ? null : 'exit')}>
                Open an exit file
              </button>
            )}
          </div>
          <p className="muted small" style={{ padding: '0 12px' }}>
            {data.rules.exit.source}
          </p>
          {open === 'exit' && (
            <div className="panel" style={{ margin: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {workerPick}
              <div className="grid-2">
                <select className="select" aria-label="Why leaving" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
                  {data.reasons
                    .filter((r) => r.value !== 'ABSCONDED')
                    .map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                </select>
                <input className="input" type="date" aria-label="Last day" value={f.lastDay} onChange={(e) => setF({ ...f, lastDay: e.target.value })} />
              </div>
              <input className="input" aria-label="Exit note" placeholder="Note (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
              <ErrorNotice error={act.error} />
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || !f.personId}
                  onClick={async () => (await act.run(() => api.fwGapsAct('openExit', { personId: f.personId, reason: f.reason, lastDay: f.lastDay, note: f.note }), 'Exit file opened.')) && setOpen(null)}
                >
                  Open
                </button>
                <button className="btn btn-sm" onClick={() => setOpen(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="list">
            {data.exits.length === 0 && <div className="empty">No exit file.</div>}
            {data.exits.map((x) => (
              <ExitRow key={x.id} x={x} canWork={data.canWork} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ---------- D3 quotas ----------

function QuotaRow({ q, canWork }: { q: Board['quotas'][number]; canWork: boolean }) {
  const [mode, setMode] = useState<'approve' | 'reject' | 'used' | null>(null);
  const [v, setV] = useState({ approvedOn: today(), places: String(q.placesAsked), validTo: '', note: '', used: String(q.used) });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const go = async (step: string, body: Record<string, unknown>) => (await act.run(() => api.fwGapsAct('quotaStep', { id: q.id, step, ...body }), 'Saved.')) && setMode(null);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {q.ref} · {q.companyName}
          </div>
          <div className="muted small">
            Applied {dateLabel(q.appliedOn)} for {q.placesAsked}
            {q.status === 'approved' ? ` · approved ${dateLabel(q.approvedOn)}: ${q.places} places, ${q.used} used, valid to ${dateLabel(q.validTo)}` : ''}
          </div>
        </div>
        <Chip tone={q.status === 'rejected' || q.expired ? 'crit' : q.remind ? 'warn' : q.status === 'approved' ? 'ok' : 'info'}>
          {q.status === 'applied' ? 'Waiting' : q.status === 'rejected' ? 'Rejected' : q.expired ? 'Expired' : q.remind ? `${q.daysLeft} d left, places unused` : 'Approved'}
        </Chip>
      </div>
      {canWork && !mode && (
        <div className="row" style={{ gap: 6 }}>
          {q.status === 'applied' && (
            <>
              <button className="btn btn-sm" onClick={() => setMode('approve')}>
                Approved
              </button>
              <button className="btn btn-sm" onClick={() => setMode('reject')}>
                Rejected
              </button>
            </>
          )}
          {q.status === 'approved' && (
            <button className="btn btn-sm" onClick={() => setMode('used')}>
              Places used
            </button>
          )}
        </div>
      )}
      <ErrorNotice error={act.error} />
      {mode === 'approve' && (
        <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="grid-2">
            <input className="input" type="date" aria-label="Approved on" value={v.approvedOn} onChange={(e) => setV({ ...v, approvedOn: e.target.value })} />
            <input className="input" inputMode="numeric" aria-label="Places approved" value={v.places} onChange={(e) => setV({ ...v, places: e.target.value })} />
            <input className="input" type="date" aria-label="Valid to (blank for 12 months)" title="Leave blank for 12 months from approval" value={v.validTo} onChange={(e) => setV({ ...v, validTo: e.target.value })} />
          </div>
          <ProofPicker site={null} refText="Quota letter" items={proof} onChange={setProof} documentsOnly required />
          <button className="btn btn-sm btn-primary" disabled={act.busy || !proof.length} onClick={() => go('approve', { approvedOn: v.approvedOn, places: Number(v.places), validTo: v.validTo || undefined, proof })}>
            Save
          </button>
        </div>
      )}
      {mode === 'reject' && (
        <div className="row" style={{ gap: 6 }}>
          <input className="input" aria-label="Answer received" placeholder="What the answer said" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => go('reject', { note: v.note })}>
            Save
          </button>
        </div>
      )}
      {mode === 'used' && (
        <div className="row" style={{ gap: 6 }}>
          <input className="input" inputMode="numeric" aria-label="Places used" value={v.used} onChange={(e) => setV({ ...v, used: e.target.value })} />
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => go('used', { used: Number(v.used) })}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}

export function FwQuotaPanel() {
  const { data, error } = useLoad(load, []);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ companyId: '', ref: '', appliedOn: today(), placesAsked: '' });
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="quotas" />;
  return (
    <>
      <NotInstalled data={data} />
      <section className="panel">
        <div className="panel-head">
          <h2>Foreign worker quotas</h2>
          {data.canWork && data.installed && (
            <button className="btn btn-sm" onClick={() => setAdding(!adding)}>
              + Quota application
            </button>
          )}
        </div>
        <p className="muted small" style={{ padding: '0 12px' }}>
          {data.rules.quota.source}
        </p>
        {adding && (
          <div className="panel" style={{ margin: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <select className="select" aria-label="Company" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
              <option value="">Choose the company</option>
              {data.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="grid-2">
              <input className="input" aria-label="Application reference" placeholder="KESUMA or FWCMS reference" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
              <input className="input" type="date" aria-label="Applied on" value={f.appliedOn} onChange={(e) => setF({ ...f, appliedOn: e.target.value })} />
              <input className="input" inputMode="numeric" aria-label="Places applied for" placeholder="Places applied for" value={f.placesAsked} onChange={(e) => setF({ ...f, placesAsked: e.target.value })} />
            </div>
            <ErrorNotice error={act.error} />
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || !f.companyId}
              onClick={async () => (await act.run(() => api.fwGapsAct('addQuota', { ...f, placesAsked: Number(f.placesAsked) }), 'Quota application recorded.')) && setAdding(false)}
            >
              Save
            </button>
          </div>
        )}
        <div className="list">
          {data.quotas.length === 0 && <div className="empty">No quota on record.</div>}
          {data.quotas.map((q) => (
            <QuotaRow key={q.id} q={q} canWork={data.canWork} />
          ))}
        </div>
      </section>
    </>
  );
}

// ---------- B2 hostel certificates ----------

export function FwHostelCertsPanel() {
  const { data, error } = useLoad(load, []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="hostel certificates" />;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Hostel certificates due</h2>
      </div>
      <p className="muted small" style={{ padding: '0 12px' }}>
        {data.rules.cert.source} Record the new certificate on the hostel: Hostels screen, then Record certificate.
      </p>
      <div className="list">
        {data.certs.length === 0 && <div className="empty">No hostel certificate expires within 90 days.</div>}
        {data.certs.map((c) => (
          <div key={c.hostelId} className="list-item" style={{ justifyContent: 'space-between', gap: 6 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div className="muted small">
                {c.companyName} · {c.certNo} · expires {dateLabel(c.expiresOn)}
              </div>
            </div>
            <Chip tone={c.daysLeft < 0 ? 'crit' : c.daysLeft <= 30 ? 'warn' : 'info'}>{c.daysLeft < 0 ? 'Expired' : `${c.daysLeft} d`}</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- B5 caseload ----------

export function FwCaseloadPanel() {
  const { data, error } = useLoad(load, []);
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the FWM caseload" />;
  const perExec = new Map<string, number>();
  for (const c of data.caseload) if (c.execName) perExec.set(c.execName, (perExec.get(c.execName) ?? 0) + c.workers);
  const unowned = data.caseload.filter((c) => !c.execId && c.workers > 0);
  return (
    <>
      <NotInstalled data={data} />
      <section className="panel">
        <div className="panel-head">
          <h2>Who owns which company</h2>
        </div>
        <p className="muted small" style={{ padding: '0 12px' }}>
          {data.rules.caseload.source}
        </p>
        <div className="kpis">
          {[...perExec.entries()].map(([n, w]) => (
            <Kpi key={n} label={n} value={w} note="workers" />
          ))}
          <Kpi label="No owner yet" value={unowned.reduce((t, c) => t + c.workers, 0)} tone={unowned.length ? 'warn' : 'ok'} note={`${unowned.length} companies`} />
        </div>
        <ErrorNotice error={act.error} />
        <div className="list">
          {data.caseload.length === 0 && <div className="empty">No company with foreign workers.</div>}
          {data.caseload.map((c) => (
            <div key={c.companyId} className="list-item" style={{ justifyContent: 'space-between', gap: 6 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{c.companyName}</div>
                <div className="muted small">{c.workers} foreign workers</div>
              </div>
              {data.canSetCaseload && data.installed ? (
                <select
                  className="select"
                  aria-label={`Owner for ${c.companyName}`}
                  value={c.execId ?? ''}
                  disabled={act.busy}
                  onChange={(e) => e.target.value && act.run(() => api.fwGapsAct('setCaseload', { companyId: c.companyId, execId: e.target.value }), 'Owner set.')}
                >
                  <option value="">No owner</option>
                  {data.team.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.fwmRole ? ` (${u.fwmRole})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <Chip tone={c.execName ? 'info' : 'warn'}>{c.execName ?? 'No owner'}</Chip>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
