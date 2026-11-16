import { Select } from '../SearchSelect';
import { useState } from 'react';
import type { LegalHoldTable } from '@prima/core';
import { api } from '../api';
import { Chip, Drawer, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';

/**
 * Legal hold (masterplan §125, 3 Nov 2026). PWVSB legal or the Deputy Chief of Staff keeps a record for an open legal
 * matter. While the hold stands the database keeps every earlier version of the record and refuses to delete it. Staff
 * work is not stopped and staff are not told; only the legal team and the group leaders see this list.
 */
type HoldRow = NonNullable<Awaited<ReturnType<typeof api.legalHoldBoard>>>['rows'][number];
const HOLD_COLUMNS: DtColumn<HoldRow>[] = [
  { id: 'label', label: 'Record', value: (r) => r.label, render: (r) => <strong>{r.label}</strong>, phone: 'title' },
  { id: 'matter', label: 'Matter', value: (r) => r.matter, phone: 'sub' },
  { id: 'by', label: 'Placed by', value: (r) => r.hold.by, hideBelow: 1100 },
  { id: 'at', label: 'Placed', value: (r) => r.hold.at, sort: 'date', render: (r) => dateTimeLabel(r.hold.at) },
  { id: 'versions', label: 'Earlier versions kept', value: (r) => r.versions, sort: 'number', hideBelow: 1200 },
  { id: 'released', label: 'Released', value: (r) => r.hold.released?.at, sort: 'date', render: (r) => (r.hold.released ? `${r.hold.released.by} ${dateTimeLabel(r.hold.released.at)}` : '–'), hideBelow: 1200 },
  {
    id: 'status',
    label: 'Status',
    value: (r) => (r.hold.released ? 'Released' : 'On hold'),
    translate: true,
    render: (r) => <Chip tone={r.hold.released ? 'neutral' : 'warn'}>{r.hold.released ? 'Released' : 'On hold'}</Chip>,
  },
];
const HOLD_FILTERS: DtFilter<HoldRow>[] = [
  { id: 'status', label: 'Status', value: (r) => (r.hold.released ? 'released' : 'held'), options: [{ value: 'held', label: 'On hold' }, { value: 'released', label: 'Released' }] },
  { id: 'matter', label: 'Matter', value: (r) => r.matter },
];

export function LegalHoldsPanel() {
  const { data, error, reload } = useLoad(() => api.legalHoldBoard(), []);
  const act = useAction();
  const [f, setF] = useState({ matterId: '', tbl: 'evidence_docs' as LegalHoldTable, refId: '', reason: '' });
  const [why, setWhy] = useState<Record<string, string>>({});
  const [releasing, setReleasing] = useState<string | null>(null);
  // Not for this person: nothing is shown (no legal notice outside the directors' and legal team's view).
  if (error) return null;
  if (!data) return <Loading what="legal holds" />;
  const matterId = f.matterId || data.matters[0]?.id || '';
  const records = (data.candidates[matterId]?.[f.tbl] ?? []) as { id: string; label: string }[];
  const rel = data.rows.find((r) => r.hold.id === releasing && r.canRelease);
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
          <Select className="select" aria-label="Legal matter" value={matterId} onChange={(e) => setF({ ...f, matterId: e.target.value, refId: '' })}>
            {data.matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.ref} {m.title}
              </option>
            ))}
          </Select>
          <Select className="select" aria-label="Kind of record" value={f.tbl} onChange={(e) => setF({ ...f, tbl: e.target.value as LegalHoldTable, refId: '' })}>
            {data.kinds.map((k) => (
              <option key={k.tbl} value={k.tbl}>
                {k.label}
              </option>
            ))}
          </Select>
          <Select className="select" aria-label="Record to hold" value={f.refId} onChange={(e) => setF({ ...f, refId: e.target.value })}>
            <option value="">Choose the record</option>
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
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
      <DataTable
        details
        label="Legal holds"
        stateKey="board.corporate.holds"
        rows={data.rows}
        rowKey={(r) => r.hold.id}
        columns={HOLD_COLUMNS}
        filters={HOLD_FILTERS}
        actions={(r) => [{ label: 'Release hold', hidden: !r.canRelease, onClick: () => setReleasing(r.hold.id) }]}
        empty={<div className="empty">No legal holds.</div>}
      />
      {rel && (
        <Drawer title={rel.label} sub={`${rel.matter} · placed by ${rel.hold.by} ${dateTimeLabel(rel.hold.at)}`} onClose={() => setReleasing(null)}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input
              className="input"
              aria-label={`Why release ${rel.label}`}
              placeholder="Why it is released"
              value={why[rel.hold.id] ?? ''}
              onChange={(e) => setWhy({ ...why, [rel.hold.id]: e.target.value })}
            />
            <button
              className="btn btn-sm btn-ghost"
              disabled={act.busy || (why[rel.hold.id] ?? '').trim().length < 5}
              onClick={() =>
                act.run(() => api.releaseLegalHold(rel.hold.id, why[rel.hold.id]).then(reload), 'Hold released.').then((x) => x !== undefined && setReleasing(null))
              }
            >
              Release hold
            </button>
          </div>
          {act.error && <p className="error small">{act.error.message}</p>}
        </Drawer>
      )}
    </section>
  );
}
