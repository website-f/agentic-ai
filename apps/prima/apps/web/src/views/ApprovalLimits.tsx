import { useState } from 'react';
import { api } from '../api';
import { Chip, ErrorNotice, Loading, useAction, useLoad } from '../ui';
import '../styles/gov.css';

// Approval value limits (Fauzan, 3 Nov 2026: "will set later in the app. create setting button in the app for ceo to
// decide"). Empty means no limit: the COO approves every staff claim, and the COO and the CEO approve every purchase.

const rm = (n: number | null) => (n == null ? 'No limit' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const parse = (s: string): number | null => (s.trim() === '' ? null : Number(s));

export function ApprovalLimitsPanel() {
  const { data, error, reload } = useLoad(() => api.approvalLimits(), []);
  const [open, setOpen] = useState(false);
  const [claims, setClaims] = useState('');
  const [purchases, setPurchases] = useState('');
  const [comment, setComment] = useState('');
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="approval limits" />;
  const start = () => {
    setClaims(data.claimsMax == null ? '' : String(data.claimsMax));
    setPurchases(data.purchasesMax == null ? '' : String(data.purchasesMax));
    setComment('');
    setOpen(true);
  };
  const save = () =>
    act.run(
      () => api.setApprovalLimits({ claimsMax: parse(claims), purchasesMax: parse(purchases), comment }),
      'Approval limits saved.',
    ).then((r) => {
      if (r === undefined) return;
      setOpen(false);
      reload();
    });
  return (
    <section className="k-card" aria-labelledby="limits-title">
      <div className="k-card-head">
        <div className="k-card-title">
          <h2 id="limits-title">Approval limits</h2>
        </div>
        <div className="k-card-actions">
          <Chip tone={data.claimsMax == null && data.purchasesMax == null ? 'info' : 'ok'}>{data.set ? `Set by ${data.set.by}` : 'Not set'}</Chip>
          {data.canSet && !open && (
            <button className="btn btn-sm" onClick={start}>
              Change limits
            </button>
          )}
        </div>
      </div>
      <div className="k-card-body gv-stack-sm">
        <p className="gv-intro">
          Small amounts you choose skip a leader's step. Empty means no limit: the COO approves every staff claim, and the COO and the CEO approve
          every purchase. HR's check, the company head's verification and Procurement's three quotes always stay.
        </p>
        <div className="gv-limits">
          <div className="gv-limit">
            <span className="gv-limit-label">Staff claims final without the COO, up to</span>
            <span className="gv-limit-value">{rm(data.claimsMax)}</span>
            <span className="muted small">After HR checks and the company head verifies</span>
          </div>
          <div className="gv-limit">
            <span className="gv-limit-label">Purchases approved by the COO alone, up to</span>
            <span className="gv-limit-value">{rm(data.purchasesMax)}</span>
            <span className="muted small">Above this, the CEO approves too</span>
          </div>
        </div>
        {data.set && (
          <p className="muted small">
            Last change: {data.set.by}, {data.set.at.slice(0, 16).replace('T', ' ')}: {data.set.comment}
          </p>
        )}
        {data.canSet && open && (
          <div className="gv-box">
            <div className="gv-form">
              <label className="field">
                <span className="label">Staff claims without the COO, up to RM (empty = no limit)</span>
                <input className="input" inputMode="decimal" aria-label="Staff claims limit" value={claims} onChange={(e) => setClaims(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">Purchases without the CEO, up to RM (empty = no limit)</span>
                <input className="input" inputMode="decimal" aria-label="Purchases limit" value={purchases} onChange={(e) => setPurchases(e.target.value)} />
              </label>
              <label className="field gv-span">
                <span className="label">Why</span>
                <input className="input" aria-label="Why" placeholder="Why (needed)" value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
            </div>
            <ErrorNotice error={act.error} />
            <div className="gv-form-foot">
              <button className="btn btn-primary btn-sm" disabled={act.busy || comment.trim().length < 3} onClick={save}>
                Save
              </button>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
