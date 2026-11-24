import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import { Chip, useLoad } from '../ui';

/**
 * Operations standards duties (Fauzan, 23 Nov 2026: "We have done the iso rba pikmsirim. So make sure operation
 * department do what needed"). One list of what operations keeps doing for ISO 9001, PIKM/SIRIM and RBA at the sites
 * the person covers, read from Prima records, each line linking to where the work is done.
 */
export function StandardsDutiesPanel() {
  const { go } = useApp();
  const [open, setOpen] = useState(false);
  const { data } = useLoad(() => api.opsStandardsDuties().catch(() => null), []);
  if (!data) return null;
  const due = data.duties.filter((d) => d.tone === 'crit' || d.tone === 'warn');
  const shown = open ? data.duties : due;
  return (
    <section className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head">
        <h3>Standards duties: ISO, PIKM and RBA ({due.length} to do)</h3>
        <button className="btn btn-sm" onClick={() => setOpen(!open)}>
          {open ? 'Only what is due' : 'Show all duties'}
        </button>
      </div>
      <p className="muted small" style={{ margin: '0 12px' }}>
        {data.sites} sites in {data.companies} compan{data.companies === 1 ? 'y' : 'ies'}. {data.basis}
      </p>
      <div className="list">
        {!shown.length && <div className="empty">Nothing due in the records for your sites.</div>}
        {shown.map((d) => (
          <div key={d.key} className="list-item" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div>
                <Chip tone={d.tone === 'unknown' ? 'neutral' : d.tone}>{d.count === null ? 'Not known' : d.count}</Chip> <strong>{d.title}</strong>{' '}
                <span className="muted small">{d.refs}</span>
              </div>
              <div className="muted small">{d.how}</div>
              {d.examples.length > 0 && <div className="small">{d.examples.join('; ')}</div>}
            </div>
            <button className="btn btn-sm" onClick={() => go(d.go as Parameters<typeof go>[0])}>
              Open
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
