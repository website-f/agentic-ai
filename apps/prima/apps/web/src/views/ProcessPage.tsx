import { useState } from 'react';
import { api } from '../api';
import { ErrorNotice, Loading, useLoad } from '../ui';

/**
 * "Proses" (Part V V13, Fauzan 14 Nov 2026): every workflow rule Prima holds, with its owner, who approves, the time
 * targets and the records kept, plus the policy papers on file. Read only; nothing is entered here.
 */
export function ProcessPanel() {
  const { data, error } = useLoad(() => api.org.processes(), []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="processes" />;
  const term = q.trim().toLowerCase();
  const rows = data.rows.filter((r) => !term || `${r.owner} ${r.ruleId} ${r.source}`.toLowerCase().includes(term));
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
          <input className="input" aria-label="Cari proses" placeholder="Cari: jabatan, kod atau perkataan" value={q} onChange={(e) => setQ(e.target.value)} />
          <table className="table small">
            <thead>
              <tr>
                <th>Pemilik</th>
                <th>Kod</th>
                <th>Pelulus</th>
                <th>Sasaran masa</th>
                <th>Rekod disimpan</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((r) => (
                <tr key={r.key} title={r.source}>
                  <td>{r.owner}</td>
                  <td>
                    {r.ruleId} <span className="muted">({r.label})</span>
                  </td>
                  <td>{r.approvers.join(', ') || '-'}</td>
                  <td>{r.targets.map((t) => `${t.name} ${t.value}`).join('; ') || '-'}</td>
                  <td>{r.keepYears.join('; ') || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
