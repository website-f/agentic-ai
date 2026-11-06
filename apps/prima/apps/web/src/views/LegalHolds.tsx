import { useState } from 'react';
import type { LegalHoldTable } from '@prima/core';
import { api } from '../api';
import { Chip, Loading, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * Legal hold (masterplan §125, 3 Nov 2026). PWVSB legal or the Deputy Chief of Staff keeps a record for an open legal
 * matter. While the hold stands the database keeps every earlier version of the record and refuses to delete it. Staff
 * work is not stopped and staff are not told; only the legal team and the group leaders see this list.
 */
export function LegalHoldsPanel() {
  const { data, error, reload } = useLoad(() => api.legalHoldBoard(), []);
  const act = useAction();
  const [f, setF] = useState({ matterId: '', tbl: 'evidence_docs' as LegalHoldTable, refId: '', reason: '' });
  const [why, setWhy] = useState<Record<string, string>>({});
  // Not for this person: nothing is shown (no legal notice outside the directors' and legal team's view).
  if (error) return null;
  if (!data) return <Loading what="legal holds" />;
  const matterId = f.matterId || data.matters[0]?.id || '';
  const records = (data.candidates[matterId]?.[f.tbl] ?? []) as { id: string; label: string }[];
  return (
    <section className="panel" aria-label="Legal holds">
      <div className="panel-head">
        <h3>Legal holds</h3>
      </div>
      <p className="notice" data-tone="info">
        {data.note}
      </p>
      {!data.installed && (
        <p className="notice" data-tone="warn">
          Legal holds are not set up on this database yet. Ask the release owner to install them.
        </p>
      )}
      {data.canPlace && data.matters.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} aria-label="Place a legal hold">
          <select className="select" aria-label="Legal matter" value={matterId} onChange={(e) => setF({ ...f, matterId: e.target.value, refId: '' })}>
            {data.matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.ref} {m.title}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Kind of record" value={f.tbl} onChange={(e) => setF({ ...f, tbl: e.target.value as LegalHoldTable, refId: '' })}>
            {data.kinds.map((k) => (
              <option key={k.tbl} value={k.tbl}>
                {k.label}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Record to hold" value={f.refId} onChange={(e) => setF({ ...f, refId: e.target.value })}>
            <option value="">Choose the record</option>
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <input className="input" aria-label="Why held" placeholder="Why it is held" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !f.refId || f.reason.trim().length < 5}
            onClick={() =>
              act.run(
                () =>
                  api.placeLegalHold(matterId, { tbl: f.tbl, refId: f.refId, reason: f.reason }).then(() => {
                    setF({ ...f, refId: '', reason: '' });
                    reload();
                  }),
                'Hold placed.',
              )
            }
          >
            Place hold
          </button>
        </div>
      )}
      {data.canPlace && !data.matters.length && <p className="muted small">A hold is placed for an open legal matter. Open the matter first, then hold its records here.</p>}
      {act.error && <p className="error small">{act.error.message}</p>}
      <div className="list">
        {!data.rows.length && <div className="empty">No legal holds.</div>}
        {data.rows.map((r) => (
          <div className="item" key={r.hold.id}>
            <div className="item-main">
              <strong>{r.label}</strong>
              <div className="muted small">
                {r.matter} · placed by {r.hold.by} {dateTimeLabel(r.hold.at)} · {r.versions} earlier version{r.versions === 1 ? '' : 's'} kept
                {r.hold.released ? ` · released by ${r.hold.released.by} ${dateTimeLabel(r.hold.released.at)}` : ''}
              </div>
              {r.canRelease && (
                <div className="row" style={{ gap: 6 }}>
                  <input
                    aria-label={`Why release ${r.label}`}
                    placeholder="Why it is released"
                    value={why[r.hold.id] ?? ''}
                    onChange={(e) => setWhy({ ...why, [r.hold.id]: e.target.value })}
                  />
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={act.busy || (why[r.hold.id] ?? '').trim().length < 5}
                    onClick={() => act.run(() => api.releaseLegalHold(r.hold.id, why[r.hold.id]).then(reload), 'Hold released.')}
                  >
                    Release hold
                  </button>
                </div>
              )}
            </div>
            <Chip tone={r.hold.released ? 'neutral' : 'warn'}>{r.hold.released ? 'Released' : 'On hold'}</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}
