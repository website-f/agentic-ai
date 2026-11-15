import { useState } from 'react';
import { api } from '../api';
import { ErrorNotice, useAction, useLoad } from '../ui';

/**
 * Part N8: "Lapor masalah / Report a problem" on every screen. What went wrong, the screen (filled in) and an optional
 * picture the person chooses. IT support replies; the person sees the reply here.
 */
export function ReportProblemButton({ screen }: { screen: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* P105: one language at a time (BM: "Lapor masalah"), so the header fits a phone. */}
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Report a problem" title="Report a problem">
        Report a problem
      </button>
      {open && (
        <div className="panel" style={{ position: 'fixed', right: 16, top: 64, zIndex: 50, width: 'min(420px, calc(100vw - 32px))', maxHeight: '75vh', overflow: 'auto' }}>
          <ReportProblem screen={screen} onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

function ReportProblem({ screen, onClose }: { screen: string; onClose: () => void }) {
  const act = useAction();
  const mine = useLoad(() => api.problems(), []);
  const [what, setWhat] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const readPhoto = (f: File | undefined) => {
    if (!f || f.size > 500_000) return setPhoto(null);
    const r = new FileReader();
    r.onload = () => setPhoto(typeof r.result === 'string' ? r.result : null);
    r.readAsDataURL(f);
  };
  return (
    <div style={{ padding: 12, display: 'grid', gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Report a problem</strong>
        <button className="btn btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted small">Screen: {screen}. Write only about the problem; do not copy other people's records.</p>
      <ErrorNotice error={act.error} />
      <label className="field">
        <span className="label">What went wrong?</span>
        <textarea className="input" rows={3} aria-label="What went wrong?" value={what} onChange={(e) => setWhat(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Picture (optional, up to 500 KB)</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => readPhoto(e.target.files?.[0])} />
      </label>
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy || what.trim().length < 5}
        onClick={() => act.run(() => api.reportProblem({ what, screen, photo }), 'Sent. IT support will reply here.').then((r) => r && (setWhat(''), setPhoto(null), mine.reload()))}
      >
        Send
      </button>
      {(mine.data?.reports ?? []).filter((r) => !mine.data?.support || r.reporterId === undefined || !r.mayReply).length > 0 && (
        <div className="list">
          {(mine.data?.reports ?? [])
            .filter((r) => !r.mayReply)
            .slice(0, 5)
            .map((r) => (
              <div key={r.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                <div className="small">
                  {r.screen}: {r.what}
                </div>
                {r.replies.map((x, i) => (
                  <div key={i} className="small">
                    ↳ {x.by}: {x.text}
                  </div>
                ))}
                {!r.replies.length && <div className="muted small">Waiting for IT support.</div>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** IT support's list of problem reports with the reply box. */
export function ProblemReportsSection() {
  const v = useLoad(() => api.problems(), []);
  const act = useAction();
  const [reply, setReply] = useState<Record<string, string>>({});
  if (!v.data?.support) return null;
  const open = v.data.reports.filter((r) => r.mayReply);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Problem reports from staff</h3>
        <span className="muted small">{open.filter((r) => r.status === 'open').length} to answer</span>
      </div>
      <ErrorNotice error={act.error} />
      <div className="list">
        {open.length === 0 && <div className="empty">No problem reports.</div>}
        {open.map((r) => (
          <div key={r.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div style={{ fontWeight: 600 }}>
              {r.reporter} · {r.screen}
            </div>
            <div className="small">{r.what}</div>
            {r.photo && <img src={r.photo} alt="What the person saw" style={{ maxWidth: 240 }} />}
            {r.replies.map((x, i) => (
              <div key={i} className="muted small">
                ↳ {x.by}: {x.text}
              </div>
            ))}
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input className="input" aria-label="Reply" value={reply[r.id] ?? ''} onChange={(e) => setReply((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="Reply to the person" />
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.replyProblem(r.id, reply[r.id] ?? ''), 'Reply sent.').then((x) => x && (setReply((m) => ({ ...m, [r.id]: '' })), v.reload()))}>
                Reply
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
