import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api } from '../api';
import { ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import { Card } from '../kit';

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
  const [from, setFrom] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="settings" />;
  const keys = Object.keys(data.limits) as (keyof typeof data.limits)[];
  const save = async () => {
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) if (v.trim() !== '') values[k] = k === 'selfBilledBy' || k === 'approvalMethod' ? v.trim() : Number(v);
    const r = await act.run(() => api.finSetSettings(values, comment, from || undefined), from ? `Settings saved, in force from ${from}.` : 'Settings saved.');
    if (r) {
      setDraft({});
      setComment('');
      setFrom('');
      setN((x) => x + 1);
    }
  };
  return (
    <>
      <p className="notice" data-tone="info">
        The Finance Director (or the CEO) sets these for every company. Each change needs a comment and is kept.
        {data.set ? ` Last changed by ${data.set.by} on ${dateTimeLabel(data.set.at)}: ${data.set.comment}` : ' Nothing changed yet: the proposed defaults apply.'}
      </p>
      {data.upcoming && (
        <p className="notice" data-tone="warn">
          A change by {data.upcoming.set.by} takes effect on {data.upcoming.set.effectiveFrom}: {data.upcoming.set.comment}. Until then the values below stay in force.
        </p>
      )}
      <ErrorNotice error={act.error} />
      <Card
        title="Limits and rules in force"
        sub={data.canSet ? 'Type a new value only where it changes; the current value shows in grey' : 'Set by the Finance Director or the CEO'}
        flush
        footer={
          data.canSet ? (
            <div className="fin-foot-form fin-foot-wide">
              <label className="field">
                <span>Why (needed)</span>
                <textarea className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              <label className="field">
                <span>In force from (leave empty for today)</span>
                <input className="input" type="date" style={{ width: 180 }} value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <button className="btn btn-primary" disabled={act.busy || !Object.values(draft).some((v) => v.trim())} onClick={save}>
                Save settings
              </button>
            </div>
          ) : undefined
        }
      >
        <div className="fin-rows">
          {keys.map((k) => (
            <div key={k} className="fin-kv fin-setting">
              <span className="fin-kv-label">
                <span>{data.limits[k][2]}</span>
                {data.values[k] !== data.defaults[k] && <span className="muted small">proposed {data.defaults[k]}</span>}
                {data.upcoming && data.upcoming.values[k] !== data.values[k] && (
                  <span className="muted small">
                    from {data.upcoming.set.effectiveFrom}: {data.upcoming.values[k]}
                  </span>
                )}
              </span>
              {data.canSet ? (
                <input
                  className="input fin-w-md"
                  inputMode="decimal"
                  aria-label={data.limits[k][2]}
                  placeholder={String(data.values[k])}
                  value={draft[k] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                />
              ) : (
                <strong className="fin-num">{data.values[k]}</strong>
              )}
            </div>
          ))}
          <div className="fin-kv fin-setting">
            <span className="fin-kv-label">
              <span>Who issues self-billed e-Invoices (foreign suppliers and agents)</span>
            </span>
            {data.canSet ? (
              <input
                className="input fin-w-lg"
                aria-label="Who issues self-billed e-Invoices"
                placeholder={data.values.selfBilledBy}
                value={draft.selfBilledBy ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, selfBilledBy: e.target.value }))}
              />
            ) : (
              <strong>{data.values.selfBilledBy}</strong>
            )}
          </div>
          <div className="fin-kv fin-setting">
            <span className="fin-kv-label">
              <span>Where payments are approved (one place only, never both)</span>
              {!data.teamsReady && <span className="muted small">Teams is not connected yet, so payments are approved in Prima</span>}
            </span>
            {data.canSet ? (
              <select
                className="input fin-w-md"
                aria-label="Where payments are approved"
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
      </Card>
      {data.canSet && data.noBooks.length > 0 && <StartBooks rows={data.noBooks} onSaved={() => setN((x) => x + 1)} />}
      {data.canSet && data.teams.length > 0 && <TeamPanel rows={data.teams} onSaved={() => setN((x) => x + 1)} />}
      {data.canSet && data.teams.length > 0 && <YearEndPanel rows={data.teams} onSaved={() => setN((x) => x + 1)} />}
      {data.history.length > 0 && (
        <Card title="Earlier settings" flush>
          <div className="fin-rows">
            {[...data.history].reverse().map((h, i) => (
              <div key={i} className="fin-kv">
                <span>
                  <span className="fin-strong">{h.set.by}</span>: {h.set.comment}
                </span>
                <span className="muted small fin-nowrap">
                  {dateTimeLabel(h.set.at)}
                  {h.set.effectiveFrom ? `, in force from ${h.set.effectiveFrom}` : ''}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

/**
 * P78: a company added after go-live has no Finance books in Prima, so none of its payments, checks or close can be kept.
 * The Finance Director or the CEO starts them: the team that keeps them and the financial year end.
 */
function StartBooks({ rows, onSaved }: { rows: { companyId: string; name: string }[]; onSaved: () => void }) {
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [team, setTeam] = useState('1');
  const [fyEnd, setFyEnd] = useState('12-31');
  const fyOk = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(fyEnd.trim());
  return (
    <Card
      title="Companies with no Finance books"
      sub="Start a company's books so its payments, monthly checks and month-end close are kept here. Its figures stay unknown until SQL Account sends them."
      flush
    >
      <ErrorNotice error={act.error} />
      <div className="fin-rows">
        {rows.map((r) => (
          <div key={r.companyId} className="fin-kv fin-kv-wrap">
            <span className="fin-min0 fin-strong">{r.name}</span>
            {open === r.companyId ? (
              <span className="fin-inline-form">
                <label className="field">
                  <span className="label">Team</span>
                  <Select className="select fin-w-sm" value={team} onChange={(e) => setTeam(e.target.value)}>
                    {[1, 2, 3, 4, 5, 6, 7].map((t) => (
                      <option key={t} value={t}>
                        Team {t}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="field">
                  <span className="label">Year ends (month-day)</span>
                  <input className="input fin-w-sm" value={fyEnd} onChange={(e) => setFyEnd(e.target.value)} aria-invalid={!fyOk} placeholder="12-31" />
                  {!fyOk && <span className="help fin-warn">Month and day, such as 12-31 or 06-30.</span>}
                </label>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || !fyOk}
                  onClick={async () => {
                    if (await act.run(() => api.finStartBooks(r.companyId, { team: Number(team), fyEnd: fyEnd.trim() }), `Books started for ${r.name}.`)) {
                      setOpen(null);
                      onSaved();
                    }
                  }}
                >
                  {act.busy ? 'Saving…' : 'Start books'}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => setOpen(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="btn btn-sm" onClick={() => setOpen(r.companyId)}>
                Start books
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Which Finance team handles each company (Fauzan, 2 Nov 2026: the FD decides; it changes every year). */
function TeamPanel({ rows, onSaved }: { rows: { companyId: string; name: string; team: number }[]; onSaved: () => void }) {
  const act = useAction();
  const [moves, setMoves] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const changed = Object.entries(moves).filter(([id, t]) => rows.find((r) => r.companyId === id)?.team !== t);
  return (
    <Card
      title="Teams and their companies"
      sub="Each team sees and works only on its own companies. Move a company to another team here; the work moves with it."
      flush
      footer={
        changed.length > 0 ? (
          <div className="fin-foot-form fin-foot-wide">
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
        ) : undefined
      }
    >
      <ErrorNotice error={act.error} />
      <div className="fin-rows fin-rows-2">
        {rows.map((r) => (
          <div key={r.companyId} className="fin-kv">
            <span className="fin-min0">{r.name}</span>
            <Select
              className="select fin-w-sm"
              aria-label={`Team for ${r.name}`}
              value={moves[r.companyId] ?? r.team}
              onChange={(e) => setMoves((m) => ({ ...m, [r.companyId]: Number(e.target.value) }))}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((t) => (
                <option key={t} value={t}>
                  Team {t}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Financial year ends (Finance 27 M2, Fauzan 2 Nov 2026): every company's year ends 31 December; the Finance Director
 * or the CEO changes one company's year end with a reason, and the change is kept.
 */
function YearEndPanel({ rows, onSaved }: { rows: { companyId: string; name: string; fyEnd: string; fyEndHistory: { from: string; to: string; by: string; at: string; comment: string }[] }[]; onSaved: () => void }) {
  const act = useAction();
  const [ends, setEnds] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const changed = Object.entries(ends).filter(([id, e]) => e.trim() && rows.find((r) => r.companyId === id)?.fyEnd !== e.trim());
  const odd = rows.filter((r) => r.fyEnd !== '12-31' || r.fyEndHistory.length);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Financial year ends</h3>
      </div>
      <p className="muted small" style={{ padding: '0 12px' }}>
        Every company's financial year ends on 31 December. Change one only when its year end really differs (MM-DD, for example 06-30); the reason and the old date are kept.
      </p>
      <ErrorNotice error={act.error} />
      <div className="list">
        {rows.map((r) => (
          <div key={r.companyId} className="list-item" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              {r.name}
              {r.fyEndHistory.length > 0 && (
                <span className="muted small">
                  {' '}
                  · was {r.fyEndHistory[r.fyEndHistory.length - 1].from}, changed by {r.fyEndHistory[r.fyEndHistory.length - 1].by}: {r.fyEndHistory[r.fyEndHistory.length - 1].comment}
                </span>
              )}
            </span>
            <input
              className="input"
              aria-label={`Year end for ${r.name}`}
              value={ends[r.companyId] ?? r.fyEnd}
              onChange={(e) => setEnds((m) => ({ ...m, [r.companyId]: e.target.value }))}
              style={{ width: 90 }}
            />
          </div>
        ))}
      </div>
      {odd.length === 0 && changed.length === 0 && <p className="muted small" style={{ padding: '0 12px' }}>All companies end their year on 31 December.</p>}
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
              if (await act.run(() => api.finSetSettings({ yearEnds: Object.fromEntries(changed.map(([id, e]) => [id, e.trim()])) }, comment), `${changed.length} year end(s) changed.`)) {
                setEnds({});
                setComment('');
                onSaved();
              }
            }}
          >
            Save {changed.length} year end(s)
          </button>
        </div>
      )}
    </section>
  );
}
