import { Select } from './SearchSelect';
import { useEffect, useRef, useState } from 'react';
import { arishaMayPrepareFinance, arishaPilotAllowed, RECORD_KINDS, type Company, type User } from '@prima/core';
import { api, type Api } from './api';

type Review = Awaited<ReturnType<Api['arishaDrafts']>>[number];
type Paper = Awaited<ReturnType<Api['arishaFinancePapers']>>[number];

/** Human review is separate from AI access. The server filters this queue and rechecks each action. */
export function ArishaReviewQueue({ user, companies }: { user: User; companies: Company[] }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Review[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [paperKey, setPaperKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const generation = useRef(0);
  const inFlight = useRef(false);
  // P80: the leaders who prepare drafts always see the queue; anyone else only when a draft waits for their review.
  const leader = arishaPilotAllowed(user);
  const [visible, setVisible] = useState(leader);
  useEffect(() => {
    if (leader) return;
    let live = true;
    api.arishaDrafts().then((r) => { if (live && r.length) setVisible(true); }, () => undefined);
    return () => { live = false; };
  }, [leader]);
  const refresh = async () => {
    if (inFlight.current) return;
    const current = generation.current;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const next = await api.arishaDrafts();
      if (current === generation.current) setRows(next);
    } catch { if (current === generation.current) setError('Could not load draft reviews. Please refresh.'); }
    finally { inFlight.current = false; if (current === generation.current) setBusy(false); }
  };
  const close = () => { generation.current++; setOpen(false); setRows([]); setPapers([]); setCompanyId(''); setPaperKey(''); setError(''); setNote(''); setBusy(false); };
  const act = async (row: Review, action: 'commit' | 'return' | 'resubmit') => {
    if (inFlight.current) return;
    if (action === 'commit' && !window.confirm('Save exactly the proposed change shown below using your own authority? This is not an approval or payment.')) return;
    if (action === 'resubmit' && !window.confirm('Resubmit this unchanged proposal for human review? Source data and your authority will be checked again. No operational record is saved.')) return;
    const current = generation.current;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (action === 'commit') await api.arishaCommit(row.id, row.version);
      else if (action === 'resubmit') await api.arishaResubmit(row.id, row.version);
      else await api.arishaReturn(row.id, row.version);
      const next = await api.arishaDrafts();
      if (current === generation.current) { setRows(next); setNote(action === 'commit' ? 'Reviewed change saved. Existing approval steps are unchanged.' : action === 'resubmit' ? 'Proposal resubmitted for review. No operational record saved.' : 'Draft returned. The author can resubmit the unchanged proposal after checking it, or prepare a new proposal.'); }
    } catch { if (current === generation.current) setError('Action was not confirmed. Refresh before retrying: authority or source data may have changed.'); }
    finally { inFlight.current = false; if (current === generation.current) setBusy(false); }
  };
  const loadPapers = async (id: string) => {
    if (inFlight.current) return;
    const current = generation.current;
    setCompanyId(id); setPapers([]); setPaperKey(''); setError('');
    if (!id) return;
    inFlight.current = true; setBusy(true);
    try { const next = await api.arishaFinancePapers(id); if (current === generation.current) setPapers(next); }
    catch { if (current === generation.current) setError('Finance papers unavailable for this company.'); }
    finally { inFlight.current = false; if (current === generation.current) setBusy(false); }
  };
  const submitPaper = async () => {
    const paper = papers.find((p) => `${p.pack}:${p.id}` === paperKey);
    if (!paper || inFlight.current) return;
    const current = generation.current;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await api.arishaSubmit({ type: 'finance-paper', pack: paper.pack, itemId: paper.id, status: 'prepared' }, companyId);
      const next = await api.arishaDrafts();
      if (current === generation.current) { setRows(next); setPaperKey(''); setNote('Submitted for an authorized Finance reviewer. The paper has not been marked prepared yet.'); }
    } catch { if (current === generation.current) setError('Submission was not confirmed. Refresh the queue before retrying.'); }
    finally { inFlight.current = false; if (current === generation.current) setBusy(false); }
  };
  if (!visible) return null;
  return <section aria-label="Draft reviews" className="draft-queue" data-open={open}>
    <button className="btn btn-sm" aria-expanded={open} onClick={() => { if (open) close(); else { setOpen(true); void refresh(); } }}><span className="hide-sm">Draft reviews</span><span className="show-sm">Drafts</span> {open ? '−' : '+'}</button>
    {open && <div className="draft-queue-panel">
      <p className="small">Drafts are proposals, not approvals. An authorized person using their existing save rights must check the details and explicitly save. AI access is not granted by this panel.</p>
      <button className="btn btn-sm" disabled={busy} onClick={() => void refresh()}>Refresh</button>{' '}
      <button className="btn btn-sm btn-ghost" onClick={close}>Close</button>
      {error && <p role="alert">{error}</p>}{note && <p role="status">{note}</p>}
      {arishaMayPrepareFinance(user) && <fieldset disabled={busy} style={{ marginTop: 12, minWidth: 0 }}>
        <legend>Draft finance paper preparation</legend>
        <p className="small">Only an existing audit/tax paper can be proposed as prepared. No payment, bank change, review or sending is performed.</p>
        <label>Company <Select style={{ maxWidth: '100%' }} value={companyId} onChange={(e) => void loadPapers(e.target.value)}><option value="">Choose company</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</Select></label>{' '}
        <label>Paper <Select style={{ maxWidth: '100%' }} value={paperKey} onChange={(e) => setPaperKey(e.target.value)}><option value="">Choose paper</option>{papers.filter((p) => p.status === 'todo').map((p) => <option key={`${p.pack}:${p.id}`} value={`${p.pack}:${p.id}`}>{p.pack}: {p.label} [{p.id}] ({p.status})</option>)}</Select></label>{' '}
        <button className="btn btn-sm" disabled={!paperKey} onClick={() => void submitPaper()}>Submit preparation draft</button>
      </fieldset>}
      {!busy && !rows.length && <p className="small">No drafts visible to your current authority.</p>}
      {rows.map((r) => <article key={r.id} style={{ padding: 12, marginTop: 8, border: '1px solid var(--line)', borderRadius: 8 }}>
        <strong>{r.payload.type === 'record' ? RECORD_KINDS[r.payload.kind].label : 'Finance paper preparation'}</strong>
        <p className="small">{r.companyId ?? 'Group'} · {r.status} · Author {r.authorId} · {r.createdAt} · v{r.version}</p>
        {r.payload.type === 'record' ? <><p className="small">New record — no existing record will be overwritten.</p><dl>{Object.entries(r.payload.values).map(([k, v]) => <div key={k}><dt>{k}</dt><dd style={{ overflowWrap: 'anywhere' }}>{String(v ?? 'Not supplied')}</dd></div>)}</dl></> : <p>{r.sourceLabel ?? 'Paper'} ({r.payload.pack} / {r.payload.itemId}): todo → prepared</p>}
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {r.canCommit && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void act(r, 'commit')}>I reviewed — save this change</button>}
          {r.canResubmit && <button className="btn btn-sm" disabled={busy} onClick={() => void act(r, 'resubmit')}>Resubmit for review</button>}
          {r.canReturn && <button className="btn btn-sm" disabled={busy} onClick={() => void act(r, 'return')}>Return without saving</button>}
        </div>
      </article>)}
    </div>}
  </section>;
}
