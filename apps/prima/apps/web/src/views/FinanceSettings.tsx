import { useState } from 'react';
import { api } from '../api';
import { ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * Group Finance settings (Fauzan, 1 Nov 2026: "put it under the FD to approve, review or set"). Every Finance person
 * sees what is in force; only the Finance Director or the CEO changes it, always with a comment, and every change is kept.
 */
export function FinanceSettingsTab() {
  const [n, setN] = useState(0);
  const { data, error } = useLoad(() => api.finSettings(), [n]);
  const act = useAction();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="settings" />;
  const keys = Object.keys(data.limits) as (keyof typeof data.limits)[];
  const save = async () => {
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) if (v.trim() !== '') values[k] = k === 'selfBilledBy' || k === 'approvalMethod' ? v.trim() : Number(v);
    const r = await act.run(() => api.finSetSettings(values, comment), 'Settings saved.');
    if (r) {
      setDraft({});
      setComment('');
      setN((x) => x + 1);
    }
  };
  return (
    <>
      <p className="notice" data-tone="info">
        The Finance Director (or the CEO) sets these for every company. Each change needs a comment and is kept.
        {data.set ? ` Last changed by ${data.set.by} on ${dateTimeLabel(data.set.at)}: ${data.set.comment}` : ' Nothing changed yet: the proposed defaults apply.'}
      </p>
      <ErrorNotice error={act.error} />
      <section className="panel">
        <div className="list">
          {keys.map((k) => (
            <div key={k} className="list-item" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span style={{ minWidth: 0, flex: '1 1 260px' }}>
                {data.limits[k][2]}
                {data.values[k] !== data.defaults[k] && <span className="muted small"> (proposed {data.defaults[k]})</span>}
              </span>
              {data.canSet ? (
                <input
                  className="input"
                  style={{ width: 140 }}
                  inputMode="decimal"
                  placeholder={String(data.values[k])}
                  value={draft[k] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                />
              ) : (
                <strong>{data.values[k]}</strong>
              )}
            </div>
          ))}
          <div className="list-item" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span style={{ minWidth: 0, flex: '1 1 260px' }}>Who issues self-billed e-Invoices (foreign suppliers and agents)</span>
            {data.canSet ? (
              <input
                className="input"
                style={{ flex: '1 1 260px' }}
                placeholder={data.values.selfBilledBy}
                value={draft.selfBilledBy ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, selfBilledBy: e.target.value }))}
              />
            ) : (
              <strong>{data.values.selfBilledBy}</strong>
            )}
          </div>
          <div className="list-item" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span style={{ minWidth: 0, flex: '1 1 260px' }}>
              Where payments are approved (one place only, never both)
              {!data.teamsReady && <span className="muted small"> (Teams is not connected yet, so payments are approved in Prima)</span>}
            </span>
            {data.canSet ? (
              <select
                className="input"
                style={{ width: 180 }}
                value={draft.approvalMethod ?? data.values.approvalMethod}
                onChange={(e) => setDraft((d) => ({ ...d, approvalMethod: e.target.value === data.values.approvalMethod ? '' : e.target.value }))}
              >
                <option value="prima">In Prima</option>
                <option value="teams" disabled={!data.teamsReady}>
                  In Teams
                </option>
              </select>
            ) : (
              <strong>{data.values.approvalMethod === 'teams' ? 'In Teams' : 'In Prima'}</strong>
            )}
          </div>
        </div>
      </section>
      {data.canSet && (
        <section className="panel">
          <label className="field">
            <span>Why (needed)</span>
            <textarea className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={act.busy || !Object.values(draft).some((v) => v.trim())} onClick={save}>
            Save settings
          </button>
        </section>
      )}
      {data.canSet && data.teams.length > 0 && <TeamPanel rows={data.teams} onSaved={() => setN((x) => x + 1)} />}
      {data.history.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Earlier settings</h3>
          </div>
          <div className="list">
            {[...data.history].reverse().map((h, i) => (
              <div key={i} className="list-item" style={{ flexWrap: 'wrap' }}>
                <span>
                  {h.set.by}: {h.set.comment}
                </span>
                <span className="muted small">{dateTimeLabel(h.set.at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** Which Finance team handles each company (Fauzan, 2 Nov 2026: the FD decides; it changes every year). */
function TeamPanel({ rows, onSaved }: { rows: { companyId: string; name: string; team: number }[]; onSaved: () => void }) {
  const act = useAction();
  const [moves, setMoves] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const changed = Object.entries(moves).filter(([id, t]) => rows.find((r) => r.companyId === id)?.team !== t);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Teams and their companies</h3>
      </div>
      <p className="muted small" style={{ padding: '0 12px' }}>
        Each team sees and works only on its own companies. Move a company to another team here; the work moves with it.
      </p>
      <ErrorNotice error={act.error} />
      <div className="list">
        {rows.map((r) => (
          <div key={r.companyId} className="list-item" style={{ gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0 }}>{r.name}</span>
            <select
              className="select"
              aria-label={`Team for ${r.name}`}
              value={moves[r.companyId] ?? r.team}
              onChange={(e) => setMoves((m) => ({ ...m, [r.companyId]: Number(e.target.value) }))}
              style={{ width: 110 }}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((t) => (
                <option key={t} value={t}>
                  Team {t}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {changed.length > 0 && (
        <div style={{ padding: 12 }}>
          <label className="field">
            <span>Why (needed)</span>
            <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              if (await act.run(() => api.finSetSettings({ teams: Object.fromEntries(changed) }, comment), `${changed.length} company(ies) moved.`)) {
                setMoves({});
                setComment('');
                onSaved();
              }
            }}
          >
            Save {changed.length} move(s)
          </button>
        </div>
      )}
    </section>
  );
}
