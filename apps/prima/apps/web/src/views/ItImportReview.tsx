import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ImportReviewSession } from './it-import-review-state';

/** Pure review surface: default application adapter cannot write or approve. */
export function ItImportReview({ session, onBack }: { session: ImportReviewSession; onBack: () => void }) {
  const s = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [resumeId, setResumeId] = useState('');
  const [resumeOpen, setResumeOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { if (s.pendingReviewId) setResumeId(s.pendingReviewId); }, [s.pendingReviewId]);
  useEffect(() => { const timer = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(timer); }, []);
  const locked = session.locked();
  const selected = s.rows.filter(r => !r.errors.length && !s.skipRows.includes(r.row)).length;
  return <section className="panel" style={{ maxWidth: '100%', overflowWrap: 'anywhere' }} aria-label="Arisha import review" data-no-translate>
    <h2>Review with Arisha</h2>
    <p role="status">{session.ready() ? 'Review service ready — approval is still a separate CEO action.' : s.capability?.reason ?? 'Checking review readiness. Approval is disabled.'}</p>
    <p>Give data → review each proposal → approve one batch. AI proposals are not verified facts. Up to 20 AI proposals; the separate manual import supports up to 200 rows.</p>
    <p className="small">Required policy: review expiry after 24 hours and review-data purge after 30 days. This is not deletion of imported work records or guaranteed erasure from backups. Server enforcement is pending verification.</p>
    {s.message && <p role="status">{s.message}</p>}
    {s.snapshot && <p>Review ID: <code>{s.snapshot.id}</code> · Version {s.snapshot.version} · Expires {s.snapshot.expiresAt}</p>}
    {s.extraction && <p className="small" style={{ overflowWrap: 'anywhere' }}>Source: {s.extraction.source.label} · Fingerprint {s.extraction.source.sha256}. Supporting text is preserved; edits do not become source evidence.</p>}
    {!!s.rows.length && <p role="status">{s.rows.length} proposals shown · {selected} without listed row errors and not left out. Only server validation can confirm which records will be created.</p>}
    {s.rows.map(row => <fieldset key={row.row} style={{ minWidth: 0, marginBottom: 16 }}><legend>Proposal {row.row}</legend>
      {row.errors.length > 0 && <p role="alert">Needs correction: {row.errors.join(', ')}</p>}
      {Object.entries(row.fields).map(([field, item]) => <div key={field} style={{ marginBottom: 12 }}>
        {['doer', 'itPerson'].includes(field) ? <label>{field} — choose exact staff identity
          <select className="select" style={{ width: '100%', maxWidth: '100%' }} value={s.directory.some(p => p.id === item.value) ? item.value : ''} disabled={locked} onChange={e => session.selectStaff(row.row, field, e.target.value)}>
            <option value="">Choose a staff member; no name is matched automatically</option>
            {s.directory.map(p => <option key={p.id} value={p.id}>{p.name} — {p.itRole} ({p.id})</option>)}
          </select>
          <p className="small">Current proposal: {item.value || '(none)'}. Directory labels are shown exactly as returned by your authorized app account. Eligibility must be rechecked by the server.</p>
        </label> : <label style={{ display: 'block' }}>{field}<textarea className="input" style={{ width: '100%' }} rows={field === 'detail' ? 3 : 1} value={item.value} disabled={locked} onChange={e => session.edit(row.row, field, e.target.value)} /></label>}
        <p className="small">{item.edited ? 'Human-edited; not revalidated against the source.' : item.support === 'source-supported' ? 'Server records source-supported text; original source offsets are unavailable here.' : item.evidence.raw === null ? 'Unverified — no supporting source.' : 'Source-supported text; not proof of correctness.'}</p>
        {item.evidence.raw !== null && <p className="small">Original source [{item.evidence.start}–{item.evidence.end}]: <q>{item.evidence.raw}</q></p>}
      </div>)}
      {!!row.warnings.length && <p>{row.warnings.join(', ')}</p>}
      {s.phase === 'review' && <label><input type="checkbox" checked={s.skipRows.includes(row.row)} onChange={e => session.skip(row.row, e.target.checked)} /> Leave this proposal out of this batch</label>}
    </fieldset>)}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <button className="btn" disabled={locked || !s.rows.length || !session.ready()} onClick={() => void session.preview()}>Validate exact batch</button>
      {s.phase === 'review' && !!s.snapshot?.errors.length && <button className="btn" onClick={() => void session.refresh()}>Refresh saved preview</button>}
      <button className="btn btn-primary" disabled={!session.canApprove()} onClick={() => void session.approve()}>Approve this batch once (CEO)</button>
      <button className="btn" disabled={['previewing', 'approving', 'uncertain', 'done', 'closed'].includes(s.phase)} onClick={() => { if (session.cancel()) onBack(); }}>Back / clear local review</button>
    </div>
    {s.phase === 'uncertain' && <p role="alert">Do not re-extract or approve another copy. Resolve the saved review's outcome first. Closing this screen cannot undo a request.</p>}
    <button className="btn" aria-expanded={resumeOpen || s.phase === 'uncertain'} onClick={() => setResumeOpen(open => !open)}>Resume a saved review</button>{(resumeOpen || s.phase === 'uncertain') && <div aria-label="Saved review recovery"><label>Review ID<input aria-label="Review ID" className="input" style={{ width: '100%', maxWidth: '100%' }} value={resumeId} onChange={e => setResumeId(e.target.value)} /></label><button className="btn" disabled={!session.ready() || ['loading', 'previewing', 'approving'].includes(s.phase) || !resumeId.trim()} onClick={() => void session.resume(resumeId.trim())}>Check saved review / receipt</button><p>Disabled until secure backend resumption is verified. Never re-create an uncertain batch.</p></div>}
    {((s.phase === 'done' && s.receipt) || s.phase === 'closed') && <button className="btn" onClick={() => { void session.startAnother().then(started => { if (started) onBack(); }); }}>Start another review</button>}
    {s.receipt && <section aria-label="Import receipt"><h3>{s.receipt.already ? 'Existing batch receipt' : 'Batch receipt'}</h3><p>Created {s.receipt.created.length}; skipped {s.receipt.skipped.length}.</p>{s.receipt.skipped.map(r => <p key={r.row}>Proposal {r.row}: {r.why}</p>)}</section>}
  </section>;
}
