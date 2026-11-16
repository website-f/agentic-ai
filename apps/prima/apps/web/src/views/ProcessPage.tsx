import { useState } from 'react';
import { api } from '../api';
import { ErrorNotice, Loading, useLoad } from '../ui';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';

type ProcessRow = Awaited<ReturnType<typeof api.org.processes>>['rows'][number];

/** P107: the processes as a data table (search, owner filter, sort, pages; cards on a phone). Headings stay in Malay, as before. */
const PROCESS_COLUMNS: DtColumn<ProcessRow>[] = [
  { id: 'owner', label: 'Pemilik', value: (r) => r.owner, phone: 'sub' },
  {
    id: 'rule',
    label: 'Kod',
    value: (r) => r.ruleId,
    phone: 'title',
    render: (r) => (
      <span title={r.source}>
        {r.ruleId} <span className="muted">({r.label})</span>
      </span>
    ),
  },
  { id: 'approvers', label: 'Pelulus', value: (r) => r.approvers.join(', ') || '-' },
  { id: 'targets', label: 'Sasaran masa', value: (r) => r.targets.map((t) => `${t.name} ${t.value}`).join('; ') || '-', sort: false },
  { id: 'keep', label: 'Rekod disimpan', value: (r) => r.keepYears.join('; ') || '-', sort: false, hideBelow: 1100 },
];
const PROCESS_FILTERS: DtFilter<ProcessRow>[] = [{ id: 'owner', label: 'Pemilik', value: (r) => r.owner }];

/**
 * "Proses" (Part V V13, Fauzan 14 Nov 2026): every workflow rule Prima holds, with its owner, who approves, the time
 * targets and the records kept, plus the policy papers on file. Read only; nothing is entered here.
 */
export function ProcessPanel() {
  const { data, error } = useLoad(() => api.org.processes(), []);
  const [open, setOpen] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="processes" />;
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <h3>Proses / processes</h3>
        <button className="btn btn-sm" onClick={() => setOpen(!open)}>
          {open ? 'Tutup' : `Lihat ${data.rows.length} proses`}
        </button>
      </div>
      <p className="muted small">Pemilik, pelulus, sasaran masa dan tempoh simpanan rekod bagi setiap proses, daripada peraturan dalam Prima. Baca sahaja.</p>
      {open && (
        <>
          <DataTable
            details
            label="Proses / processes"
            stateKey="clock.processes"
            rows={data.rows}
            rowKey={(r) => r.key}
            columns={PROCESS_COLUMNS}
            filters={PROCESS_FILTERS}
            searchPlaceholder="Cari: jabatan, kod atau perkataan"
            searchText={(r) => `${r.label} ${r.source}`}
          />
          <h4>Kertas polisi dalam Prima</h4>
          <ul className="small">
            {data.papers.map((p) => (
              <li key={p.code}>
                {p.owner}: {p.code} {p.title}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
