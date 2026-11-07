// Reports (P85; paper section 10). Built from what you may see only, with other companies' staff not named. Every report
// says when its data is from and its scope; a CSV download is written to the audit trail.
import { useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { ITEM_REPORT_KINDS, ITEM_REPORT_TITLE, type ItemReportKind } from '@prima/core';
import { api, type ItemBoard } from '../../api';
import { Card, Empty, Toolbar } from '../../kit';
import { ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../../ui';
import { downloadText } from './shared';

export function Reports({ data }: { data: ItemBoard }) {
  const [kind, setKind] = useState<ItemReportKind>('balance');
  const [partyId, setPartyId] = useState('');
  const { data: r, error } = useLoad(() => api.itemReport(kind, partyId || null, 'json'), [kind, partyId]);
  const a = useAction();
  const [page, setPage] = useState(0);
  const size = 50;
  return (
    <Card title="Reports" sub="Every report shows when its data is from and whose data it covers." flush>
      <div className="it-pad">
        <Toolbar
          end={
            <button
              className="btn"
              type="button"
              disabled={a.busy || !r}
              onClick={() => a.run(async () => {
                const x = await api.itemReport(kind, partyId || null, 'csv');
                downloadText(`prima-items-${kind}-${x.asOf.slice(0, 10)}.csv`, (x as { csv?: string }).csv ?? '');
              }, 'Downloaded. The download is recorded in the audit trail.')}
            >
              <DownloadSimpleIcon size={16} aria-hidden="true" /> CSV
            </button>
          }
        >
          <select className="input" aria-label="Report" value={kind} onChange={(e) => (setKind(e.target.value as ItemReportKind), setPage(0))}>
            {ITEM_REPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {ITEM_REPORT_TITLE[k]}
              </option>
            ))}
          </select>
          <select className="input" aria-label="Company" value={partyId} onChange={(e) => (setPartyId(e.target.value), setPage(0))}>
            <option value="">All companies you may see</option>
            {data.roles.map((x) => (
              <option key={x.partyId} value={x.partyId}>
                {data.parties.find((p) => p.id === x.partyId)?.name ?? x.partyId}
              </option>
            ))}
          </select>
        </Toolbar>
        <ErrorNotice error={error ?? a.error} />
      </div>
      {!r ? (
        !error && <Loading what="report" />
      ) : !r.rows.length ? (
        <Empty title="Nothing in this report." />
      ) : (
        <div className="table-wrap it-table">
          <table>
            <thead>
              <tr>
                {r.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.rows.slice(page * size, page * size + size).map((row, k) => (
                <tr key={k}>
                  {row.map((cell, j) => (
                    <td key={j}>{String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r && (
        <div className="it-pad it-foot">
          <span className="muted small">
            Data as of {dateTimeLabel(r.asOf)} · last event {r.lastEventAt ? dateTimeLabel(r.lastEventAt) : 'none'} · scope: {r.scope} · {r.rows.length} row(s)
          </span>
          {r.rows.length > size && (
            <span className="seg">
              <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Back
              </button>
              <button type="button" disabled={(page + 1) * size >= r.rows.length} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
