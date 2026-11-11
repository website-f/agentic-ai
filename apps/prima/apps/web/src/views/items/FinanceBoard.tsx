// Finance and SQL Account (P85; paper sections 5 to 7). EXPORT ONLY: nothing is posted to SQL Account. Finance records
// the company's SQL book (verified by a second Finance person), approves item codes, builds export files from ready
// documents, imports them by hand, and records the document number SQL Account gave, with the evidence. A document is
// reconciled only when its number is found in an SQL document listing Finance loads here.
import { Select } from '../../SearchSelect';
import { useState } from 'react';
import { ArrowsClockwiseIcon, DownloadSimpleIcon, FileArrowUpIcon, ScalesIcon } from '@phosphor-icons/react';
import { SYNC_STATUS_LABEL, type SyncStatus } from '@prima/core';
import { api, type ItemBoard, type ItemFinance } from '../../api';
import { useApp } from '../../App';
import { Card, Empty, Facts, Stat, Stats } from '../../kit';
import { Chip, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../../ui';
import { TabIntro, act, downloadText, readFile, skuName } from './shared';

type Job = ItemFinance['jobs'][number];
const LANES: SyncStatus[] = ['not_ready', 'ready', 'queued', 'sent', 'acknowledged', 'reconciled', 'rejected', 'outcome_unknown', 'manual_review'];
const LANE_TONE: Record<SyncStatus, 'ok' | 'warn' | 'crit' | 'info' | 'neutral'> = {
  not_ready: 'neutral',
  ready: 'info',
  queued: 'info',
  sent: 'info',
  acknowledged: 'ok',
  reconciled: 'ok',
  rejected: 'crit',
  retryable_error: 'warn',
  outcome_unknown: 'crit',
  manual_review: 'warn',
};

export function FinanceBoard({ data }: { data: ItemBoard }) {
  const [partyId, setPartyId] = useState<string | null>(null);
  const { data: f, error, reload } = useLoad(() => api.itemFinance(partyId), [partyId]);
  const intro = (
    <TabIntro title="Finance and SQL" sub="Export only: each company's SQL book, its item codes, the documents ready to export, the export files you import into SQL Account by hand, and the check against SQL's own listing. Nothing is posted to SQL Account from here." />
  );
  if (error)
    return (
      <div className="it-stack">
        {intro}
        <ErrorNotice error={error} />
      </div>
    );
  if (!f)
    return (
      <div className="it-stack">
        {intro}
        <Loading what="Finance outbox" />
      </div>
    );
  return (
    <div className="it-stack">
      {intro}
      <p className="notice" data-tone="warn">
        {f.note}
      </p>
      <Card title="Company" sub="Each company has its own SQL book, item codes and outbox.">
        <Select className="input it-big" aria-label="Company" value={f.partyId} onChange={(e) => setPartyId(e.target.value)} searchable>
          {f.parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Card>
      <Book f={f} onDone={reload} />
      <Pipeline f={f} data={data} onDone={reload} />
      <Mappings f={f} onDone={reload} />
      <Recon f={f} onDone={reload} />
    </div>
  );
}

function Book({ f, onDone }: { f: ItemFinance; onDone: () => void }) {
  const a = useAction();
  const { me } = useApp();
  const b = f.book;
  const [edit, setEdit] = useState(false);
  const [legalName, setLegalName] = useState(b?.legalName ?? '');
  const [regNo, setRegNo] = useState(b?.regNo ?? '');
  const [sqlBookId, setSqlBookId] = useState(b?.sqlBookId ?? '');
  const [cps, setCps] = useState(b?.counterparties.map((c) => ({ ...c })) ?? []);
  const [lock, setLock] = useState(b?.periodLockedThrough ?? '');
  const run = (x: Parameters<typeof act>[0], msg: string) => a.run(() => act(x), msg).then((r) => r && (setEdit(false), onDone()));
  return (
    <Card
      title="SQL book (decision D01)"
      sub="Recorded by one Finance person and verified by another with evidence. Until then every document of this company stays not ready."
      actions={
        f.canAct && !edit ? (
          <button className="btn" type="button" onClick={() => setEdit(true)}>
            {b ? 'Change' : 'Record the book'}
          </button>
        ) : undefined
      }
    >
      {b ? (
        <Facts
          items={[
            ['Legal name', b.legalName],
            ['Registration', b.regNo],
            ['SQL book', <span className="mono">{b.sqlBookId}</span>],
            ['Channel', 'Export file only (no API posting)'],
            ['Customer and supplier codes', b.counterparties.map((c) => `${f.parties.find((p) => p.id === c.partyId)?.name ?? c.partyId} (${c.role}): ${c.sqlCode}`).join('; ') || 'None yet'],
            ['Closed period up to', b.periodLockedThrough ?? 'Not set'],
            ['Verified', b.verified ? `By ${b.verified.by}, ${dateTimeLabel(b.verified.at)}` : 'Not yet'],
          ]}
        />
      ) : (
        <Empty title="No SQL book recorded for this company." />
      )}
      {b && !b.verified && f.canAct && b.setById !== me.user.id && (
        <label className="btn it-file">
          <FileArrowUpIcon size={16} aria-hidden="true" /> Verify with evidence (PDF or photo)
          <input type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) await run({ kind: 'book.verify', partyId: f.partyId, evidence: { name: file.name, data: await readFile(file) } }, 'Book verified.');
          }} />
        </label>
      )}
      {edit && (
        <div className="it-form">
          <input className="input" placeholder="Legal name as registered" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          <input className="input" placeholder="Registration number" value={regNo} onChange={(e) => setRegNo(e.target.value)} />
          <input className="input mono" placeholder="SQL book id (as named in SQL Account)" value={sqlBookId} onChange={(e) => setSqlBookId(e.target.value)} />
          <label className="isc-field">
            Closed period up to (optional)
            <input className="input" type="date" value={lock} onChange={(e) => setLock(e.target.value)} />
          </label>
          {cps.map((c, k) => (
            <div key={k} className="it-pick-row">
              <Select className="input" value={c.partyId} onChange={(e) => setCps(cps.map((x, j) => (j === k ? { ...x, partyId: e.target.value } : x)))}>
                {f.parties.filter((p) => p.id !== f.partyId).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <select className="input" value={c.role} onChange={(e) => setCps(cps.map((x, j) => (j === k ? { ...x, role: e.target.value as 'customer' } : x)))}>
                <option value="customer">customer</option>
                <option value="supplier">supplier</option>
              </select>
              <input className="input mono" placeholder="SQL code" value={c.sqlCode} onChange={(e) => setCps(cps.map((x, j) => (j === k ? { ...x, sqlCode: e.target.value } : x)))} />
            </div>
          ))}
          <button className="btn" type="button" onClick={() => setCps([...cps, { partyId: f.parties.find((p) => p.id !== f.partyId)?.id ?? '', role: 'customer', sqlCode: '' }])}>
            Add a customer or supplier code
          </button>
          <div className="isc-actions">
            <button className="btn" type="button" onClick={() => setEdit(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="button" disabled={a.busy} onClick={() => run({ kind: 'book.set', partyId: f.partyId, legalName, regNo, sqlBookId, counterparties: cps, periodLockedThrough: lock || null }, 'Book recorded. A second Finance person verifies it.')}>
              Save
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={a.error} />
    </Card>
  );
}

function Pipeline({ f, data, onDone }: { f: ItemFinance; data: ItemBoard; onDone: () => void }) {
  const a = useAction();
  const [lane, setLane] = useState<SyncStatus | 'all'>('all');
  const [pick, setPick] = useState<Set<string>>(new Set());
  const jobs = f.jobs.filter((j) => lane === 'all' || j.status === lane);
  const run = (x: Parameters<typeof act>[0], msg: string) => a.run(() => act(x), msg).then((r) => (r && onDone(), r));
  return (
    <>
      <Stats>
        {LANES.map((s) => {
          const n = f.jobs.filter((j) => j.status === s).length;
          return <Stat key={s} label={SYNC_STATUS_LABEL[s]} value={n} tone={n ? LANE_TONE[s] : undefined} onClick={() => setLane(lane === s ? 'all' : s)} />;
        })}
      </Stats>
      <Card
        title={lane === 'all' ? 'SQL documents (outbox)' : SYNC_STATUS_LABEL[lane]}
        sub="Each physical change wrote its document here in the same step. Nothing is sent: ready documents go into an export file."
        actions={
          f.canAct ? (
            <button className="btn" type="button" disabled={a.busy} onClick={() => run({ kind: 'sync.refresh', partyId: f.partyId }, 'Checked again.')}>
              <ArrowsClockwiseIcon size={16} aria-hidden="true" /> Check again
            </button>
          ) : undefined
        }
        flush
      >
        {!jobs.length ? (
          <Empty title="No documents here." />
        ) : (
          <ul className="it-rows">
            {jobs.map((j) => (
              <JobRow key={j.id} j={j} data={data} canAct={f.canAct} picked={pick.has(j.id)} onPick={(v) => setPick((s) => { const n = new Set(s); if (v) n.add(j.id); else n.delete(j.id); return n; })} onDone={onDone} />
            ))}
          </ul>
        )}
        {f.canAct && pick.size > 0 && (
          <div className="it-pad">
            <button className="btn btn-primary it-big" type="button" disabled={a.busy} onClick={() => run({ kind: 'sync.batch', partyId: f.partyId, jobIds: [...pick] }, 'Export file built. Download it and import it into SQL Account by hand.').then((r) => r && setPick(new Set()))}>
              Build export file ({pick.size})
            </button>
          </div>
        )}
        <ErrorNotice error={a.error} />
      </Card>
      <Batches f={f} onDone={onDone} />
    </>
  );
}

function JobRow({ j, data, canAct, picked, onPick, onDone }: { j: Job; data: ItemBoard; canAct: boolean; picked: boolean; onPick: (v: boolean) => void; onDone: () => void }) {
  const a = useAction();
  const [step, setStep] = useState<'' | 'ack' | 'reject' | 'unknown' | 'lookup' | 'review'>('');
  const [docNo, setDocNo] = useState('');
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState<'hold' | 'requeue' | 'new_revision' | 'reverse'>('requeue');
  const [file, setFile] = useState<File | null>(null);
  const run = (x: Parameters<typeof act>[0], msg: string) => a.run(() => act(x), msg).then((r) => r && (setStep(''), onDone()));
  const ev = async () => (file ? { name: file.name, data: await readFile(file) } : { name: '', data: '' });
  return (
    <li className="it-row it-row-col" data-tone={j.status === 'rejected' || j.status === 'outcome_unknown' ? 'crit' : undefined}>
      <span className="it-row-line">
        <span className="it-row-main">
          <strong>
            {j.docType.replace(/_/g, ' ')} · {j.payload.commercialRef ?? 'no shared reference'} · rev {j.revision}
            {j.revisionAction && j.revisionAction !== 'insert' ? ` (${j.revisionAction})` : ''}
          </strong>
          <span className="muted">
            {j.payload.lines.map((l) => `${l.qty} x ${l.itemCode ?? skuName(data, l.skuId)}`).join(', ')} · {dateTimeLabel(j.at)}
            {j.dest ? ` · SQL ${j.dest.docNo}` : ''}
          </span>
        </span>
        <span className="it-row-side">
          {canAct && j.status === 'ready' && (
            <label className="isc-choice">
              <input type="checkbox" checked={picked} onChange={(e) => onPick(e.target.checked)} /> Export
            </label>
          )}
          <Chip tone={LANE_TONE[j.status]}>{j.statusLabel}</Chip>
        </span>
      </span>
      {j.blockerLabels.length > 0 && (
        <span className="it-chips">
          {j.blockerLabels.map((b) => (
            <Chip key={b} tone="warn">
              {b}
            </Chip>
          ))}
        </span>
      )}
      {canAct && (
        <span className="it-mark">
          {j.status === 'sent' && (
            <>
              <button className="btn btn-sm" type="button" onClick={() => setStep('ack')}>Record SQL number</button>
              <button className="btn btn-sm" type="button" onClick={() => setStep('reject')}>Rejected</button>
              <button className="btn btn-sm" type="button" onClick={() => setStep('unknown')}>Outcome unknown</button>
            </>
          )}
          {j.status === 'outcome_unknown' && <button className="btn btn-sm" type="button" onClick={() => setStep('lookup')}>Look it up</button>}
          {['rejected', 'manual_review', 'acknowledged', 'reconciled', 'not_ready', 'ready', 'queued'].includes(j.status) && (
            <button className="btn btn-sm" type="button" onClick={() => (setDecision(j.status === 'acknowledged' || j.status === 'reconciled' ? 'reverse' : j.status === 'rejected' || j.status === 'manual_review' ? 'requeue' : 'hold'), setStep('review'))}>
              Review
            </button>
          )}
        </span>
      )}
      {step && (
        <div className="it-form">
          {(step === 'ack' || step === 'lookup') && <input className="input mono" placeholder={step === 'lookup' ? 'SQL document number if found (empty: confirmed not in SQL)' : 'SQL document number, exactly as SQL Account shows it'} value={docNo} onChange={(e) => setDocNo(e.target.value)} />}
          {step === 'review' && (
            <select className="input" value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
              <option value="hold">Hold for review</option>
              <option value="requeue">Put back as ready (unchanged)</option>
              <option value="new_revision">New revision (updates the earlier one)</option>
              <option value="reverse">Reverse (a linked reversal; the original is never edited)</option>
            </select>
          )}
          {step !== 'ack' && <input className="input" placeholder={step === 'reject' ? 'What SQL Account rejected' : step === 'lookup' ? 'Where you looked' : 'Reason'} value={note} onChange={(e) => setNote(e.target.value)} />}
          {(step === 'ack' || step === 'lookup') && (
            <label className="isc-field">
              Evidence: the SQL screen or document (PDF or photo)
              <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
          <div className="isc-actions">
            <button className="btn" type="button" onClick={() => setStep('')}>Cancel</button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={a.busy}
              onClick={async () => {
                if (step === 'ack') await run({ kind: 'sync.ack', jobId: j.id, docNo, evidence: await ev() }, 'SQL number recorded.');
                if (step === 'reject') await run({ kind: 'sync.reject', jobId: j.id, reason: note }, 'Marked rejected.');
                if (step === 'unknown') await run({ kind: 'sync.unknown', jobId: j.id, note }, 'Marked outcome unknown: look it up before anything is sent again.');
                if (step === 'lookup') await run({ kind: 'sync.lookup', jobId: j.id, docNo: docNo.trim() || null, note, evidence: await ev() }, 'Lookup recorded.');
                if (step === 'review') await run({ kind: 'sync.review', jobId: j.id, decision, reason: note }, 'Decision recorded.');
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={a.error} />
    </li>
  );
}

function Batches({ f, onDone }: { f: ItemFinance; onDone: () => void }) {
  const a = useAction();
  if (!f.batches.length) return null;
  return (
    <Card title="Export files" sub="Download, import into SQL Account by hand, then mark it imported. The unit ID list stays with Prima; SQL's import does not carry serials." flush>
      <ul className="it-rows">
        {f.batches.map((b) => (
          <li key={b.id} className="it-row it-row-col">
            <span className="it-row-line">
              <strong className="mono">{b.ref}</strong>
              <Chip tone={b.status === 'sent' ? 'ok' : 'info'}>{b.status === 'sent' ? 'Imported by hand' : 'Generated'}</Chip>
            </span>
            <span className="muted">
              {b.jobIds.length} document(s) · {dateTimeLabel(b.at)} by {b.createdBy}
            </span>
            <span className="it-mark">
              {b.files.map((x) => (
                <button key={x.name} className="btn btn-sm" type="button" disabled={a.busy || !f.canAct} onClick={() => a.run(async () => { const file = await api.itemExportFile(b.id, x.name); downloadText(file.name, file.content); })} title={`SHA-256 ${x.sha256}`}>
                  <DownloadSimpleIcon size={14} aria-hidden="true" /> {x.name.endsWith('unit-ids.csv') ? 'Unit IDs' : 'Documents'} ({x.rows})
                </button>
              ))}
              {f.canAct && b.status === 'generated' && (
                <button className="btn btn-sm btn-primary" type="button" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'sync.sent', batchId: b.id }), 'Marked imported. Record each SQL number next.').then((r) => r && onDone())}>
                  Mark imported
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <ErrorNotice error={a.error} />
    </Card>
  );
}

function Mappings({ f, onDone }: { f: ItemFinance; onDone: () => void }) {
  const a = useAction();
  const { me } = useApp();
  const [edit, setEdit] = useState<{ skuId: string; itemCode: string; uom: string; factor: string } | null>(null);
  const missing = f.mappings.filter((m) => !m.map).length;
  const unapproved = f.mappings.filter((m) => m.map && !m.map.approvedById).length;
  return (
    <Card title="SQL item codes" sub={`Per item type in this company's book. ${missing} without a code, ${unapproved} waiting for a second Finance person. Never matched to the nearest code.`} flush>
      <ul className="it-rows">
        {f.mappings.map((m) => (
          <li key={m.skuId} className="it-row it-row-col">
            <span className="it-row-line">
              <span className="it-row-main">
                <strong>{m.code}</strong>
                <span className="muted">{m.name}</span>
              </span>
              <span className="it-row-side">
                {m.map ? <span className="mono">{m.map.itemCode} / {m.map.uom}{(m.map.factor ?? 1) > 1 ? ` x${m.map.factor}` : ''}</span> : <Chip tone="warn">No code</Chip>}
                {m.map && <Chip tone={m.map.approvedById ? 'ok' : 'warn'}>{m.map.approvedById ? 'Approved' : 'To approve'}</Chip>}
              </span>
            </span>
            {f.canAct && (
              <span className="it-mark">
                <button className="btn btn-sm" type="button" onClick={() => setEdit({ skuId: m.skuId, itemCode: m.map?.itemCode ?? '', uom: m.map?.uom ?? m.uom, factor: String(m.map?.factor ?? 1) })}>
                  {m.map ? 'Change code' : 'Add code'}
                </button>
                {m.map && !m.map.approvedById && m.map.byId !== me.user.id && (
                  <button className="btn btn-sm" type="button" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'sku.mapApprove', skuId: m.skuId, partyId: f.partyId }), 'Code approved.').then((r) => r && onDone())}>
                    Approve
                  </button>
                )}
              </span>
            )}
            {edit?.skuId === m.skuId && (
              <div className="it-pick-row">
                <input className="input mono" placeholder="ItemCode (kept as text)" value={edit.itemCode} onChange={(e) => setEdit({ ...edit, itemCode: e.target.value })} />
                <Select className="input" value={edit.uom} onChange={(e) => setEdit({ ...edit, uom: e.target.value })}>
                  {['PCS', 'PAIR', 'SET', 'BOX', 'BOTTLE', 'LITRE', 'ROLL'].map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </Select>
                <input className="input it-qty-in" aria-label="Base units per SQL unit" inputMode="numeric" value={edit.factor} onChange={(e) => setEdit({ ...edit, factor: e.target.value })} />
                <button className="btn btn-primary" type="button" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'sku.map', skuId: m.skuId, partyId: f.partyId, itemCode: edit.itemCode, uom: edit.uom as 'PCS', factor: Number(edit.factor) }), 'Code saved. A second Finance person approves it.').then((r) => r && (setEdit(null), onDone()))}>
                  Save
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ErrorNotice error={a.error} />
    </Card>
  );
}

function Recon({ f, onDone }: { f: ItemFinance; onDone: () => void }) {
  const a = useAction();
  const [kind, setKind] = useState<'doc_listing' | 'stock_balance'>('doc_listing');
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const r = f.recon;
  const defects = r.rollForward.filter((x) => x.difference !== 0);
  return (
    <Card
      title="Reconciliation"
      sub="Prima's movements against both books and SQL's own exports. Every unexplained difference opens a case for this book's Finance."
      actions={
        f.canAct ? (
          <button className="btn btn-primary" type="button" disabled={a.busy} onClick={() => a.run(() => act({ kind: 'sync.reconcile', partyId: f.partyId }), (x) => { const o = (x as { result: { reconciled: number; differences: number } }).result; return `${o.reconciled} matched, ${o.differences} difference(s).`; }).then((x) => x && onDone())}>
            <ScalesIcon size={16} aria-hidden="true" /> Reconcile now
          </button>
        ) : undefined
      }
    >
      <Stats>
        <Stat label="One-sided documents" value={r.oneSided.length} tone={r.oneSided.length ? 'crit' : 'ok'} />
        <Stat label="Received, no document" value={r.receivedNoDoc.length} tone={r.receivedNoDoc.length ? 'warn' : 'ok'} />
        <Stat label="Roll-forward defects" value={defects.length} tone={defects.length ? 'crit' : 'ok'} />
        <Stat label="Not in SQL listing" value={r.docCompare.missing.length} tone={r.docCompare.missing.length ? 'warn' : 'ok'} note={r.docCompare.asOf ? `Listing of ${r.docCompare.asOf}` : 'No listing loaded'} />
      </Stats>
      {r.pairs.length > 0 && (
        <div className="table-wrap it-table it-rtable">
          <table>
            <thead>
              <tr>
                <th>Shared ref</th>
                <th>Movement</th>
                <th>Sent</th>
                <th>Received</th>
                <th>Transit or missing</th>
                <th>This book</th>
                <th>Other book</th>
              </tr>
            </thead>
            <tbody>
              {r.pairs.map((p) => (
                <tr key={p.commercialRef} className={p.oneSided ? 'it-bad' : undefined}>
                  <td className="mono" data-label="Shared ref">{p.commercialRef}</td>
                  <td data-label="Movement">{p.movementRef}</td>
                  <td data-label="Sent">{p.sent}</td>
                  <td data-label="Received">{p.received}</td>
                  <td data-label="Transit or missing">{p.inTransit}</td>
                  <td data-label="This book">{p.mine.map((m) => SYNC_STATUS_LABEL[m.status]).join(', ') || 'none'}</td>
                  <td data-label="Other book">{p.other.map((m) => SYNC_STATUS_LABEL[m.status]).join(', ') || 'not visible or none'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.stockCompare && (
        <div className="table-wrap it-table it-rtable">
          <table>
            <thead>
              <tr>
                <th>ItemCode</th>
                <th>Prima</th>
                <th>SQL ({r.stockCompare.asOf})</th>
                <th>Difference</th>
                <th>Explained by</th>
              </tr>
            </thead>
            <tbody>
              {r.stockCompare.rows.map((x) => (
                <tr key={x.itemCode} className={x.difference && !x.explained.length ? 'it-bad' : undefined}>
                  <td className="mono" data-label="ItemCode">{x.itemCode}</td>
                  <td data-label="Prima">{x.prima}</td>
                  <td data-label="SQL">{x.sql ?? '-'}</td>
                  <td data-label="Difference">{x.difference}</td>
                  <td data-label="Explained by">{x.explained.join(', ').replace(/_/g, ' ') || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {f.canAct && (
        <div className="it-form">
          <strong>Load an SQL export</strong>
          <div className="it-pick-row">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="doc_listing">Document listing (DocNo, Net, Tax, Gross)</option>
              <option value="stock_balance">Stock balance (ItemCode, UOM, Qty)</option>
            </select>
            <input className="input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          <label className="btn it-file">
            <FileArrowUpIcon size={16} aria-hidden="true" /> Choose the CSV
            <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const csv = await file.text();
              await a.run(() => act({ kind: 'sync.snapshot', partyId: f.partyId, snapshot: kind, asOf, csv }), (x) => `${(x as { result: { rows: number } }).result.rows} rows read.`).then((x) => x && onDone());
            }} />
          </label>
          {f.snapshots.length > 0 && <span className="muted small">Loaded: {f.snapshots.map((s) => `${s.kind.replace('_', ' ')} of ${s.asOf} (${s.rows} rows)`).join('; ')}</span>}
        </div>
      )}
      <ErrorNotice error={a.error} />
    </Card>
  );
}
