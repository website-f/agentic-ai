import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import { SiteVisitsSection } from './Visits';
import { RecordButton } from './RecordForm';
import { Chip, Drawer, ErrorNotice, Loading, Sev, hhmm, useAction, useLoad } from '../ui';
import { SHIFT_STATE } from './shared';

export function Sites({ openSiteId }: { openSiteId?: string }) {
  const { companyId } = useApp();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | undefined>(openSiteId);
  const { data, error } = useLoad(() => api.sites(companyId), [companyId]);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="sites" />
      </div>
    );
  const ql = q.trim().toLowerCase();
  const rows = data.filter(
    (r) => !ql || r.site.name.toLowerCase().includes(ql) || r.site.code.toLowerCase().includes(ql) || r.site.address.toLowerCase().includes(ql),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Sites</h1>
          <p>{data.length} sites. Problems counts no-shows, late guards and unfilled shifts today.</p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input id="site-search" className="input" placeholder="Search name, code or town" value={q} onChange={(e) => setQ(e.target.value)} />
          <RecordButton kind="site" companyId={companyId} label="Add site" primary />
        </div>
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th className="hide-sm">Branch</th>
                <th>Risk</th>
                <th className="num">Posts</th>
                <th className="num">On duty</th>
                <th className="num">Problems</th>
                <th className="num">Cases</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.site.id} className="clickable" onClick={() => setOpen(r.site.id)}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.site.name}</div>
                    <div className="muted small">
                      <span className="mono">{r.site.code}</span> · {r.site.address}
                    </div>
                  </td>
                  <td className="hide-sm">{r.branchName}</td>
                  <td>
                    <Chip tone={r.site.risk === 'high' ? 'crit' : r.site.risk === 'medium' ? 'warn' : 'neutral'}>{r.site.risk}</Chip>
                    {r.site.armed && (
                      <div>
                        <Chip tone="crit">Armed</Chip>
                      </div>
                    )}
                  </td>
                  <td className="num">{r.posts}</td>
                  <td className="num">
                    {r.onDuty} / {r.shiftsToday}
                  </td>
                  <td className="num">{r.problems ? <Chip tone="crit">{r.problems}</Chip> : '0'}</td>
                  <td className="num">{r.openCases}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">No site matches “{q}”.</div>}
        </div>
      </section>
      {open && <SiteDrawer siteId={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

export function SiteDrawer({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const { go } = useApp();
  const { data, error } = useLoad(() => api.site(siteId), [siteId]);
  return (
    <Drawer title={data?.site.name ?? 'Site'} sub={data ? `${data.site.code} · ${data.site.client}` : undefined} onClose={onClose}>
      <ErrorNotice error={error} />
      {!data && !error && <Loading what="site" />}
      {data && (
        <>
          <div className="row">
            <button className="btn btn-primary" onClick={() => go({ view: 'roster', siteId })}>
              Open roster
            </button>
            <RecordButton kind="site" id={siteId} label="Edit site" />
            <span className="muted small">
              Clock-in allowed within {data.site.geofenceM} m · {data.branch?.name}
            </span>
          </div>
          <section>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
              <h3>Posts</h3>
              <RecordButton kind="post" companyId={data.site.companyId} label="Add post" />
            </div>
            <div className="list">
              {data.posts.length === 0 && <div className="empty">No posts yet.</div>}
              {data.posts.map((p) => (
                <div key={p.id} className="list-item">
                  <div>
                    <div>{p.name}</div>
                    <div className="muted small">
                      Pattern {p.shiftStructure} · {p.guardsPerShift} per shift
                    </div>
                  </div>
                  <RecordButton kind="post" id={p.id} />
                </div>
              ))}
            </div>
          </section>
          <SiteVisitsSection siteId={siteId} />
          <section>
            <h3>On duty and today</h3>
            <div className="list">
              {data.shifts.length === 0 && <div className="empty">No shifts today.</div>}
              {data.shifts.map((s) => {
                const st = SHIFT_STATE[s.state];
                return (
                  <div key={s.id} className="list-item">
                    <div>
                      <div style={{ fontWeight: 600 }}>{s.personName ?? 'Nobody assigned'}</div>
                      <div className="muted small">
                        {s.postName} · {hhmm(s.start)}–{hhmm(s.end)}
                        {s.attendance?.clockIn && ` · in ${hhmm(s.attendance.clockIn)}`}
                        {s.attendance?.flags.length ? ` · ${s.attendance.flags.join(', ').toLowerCase().replace(/_/g, ' ')}` : ''}
                      </div>
                    </div>
                    <Chip tone={st.tone}>{st.label}</Chip>
                  </div>
                );
              })}
            </div>
          </section>
          <PatrolTime siteId={siteId} patrol={data.patrol} />
          <section>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
              <h3>Patrol checkpoints today</h3>
              <RecordButton kind="checkpoint" companyId={data.site.companyId} label="Add checkpoint" />
            </div>
            <div className="list">
              {data.checkpoints.map((c) => (
                <div key={c.checkpoint.id} className="list-item">
                  <div>
                    <div>{c.checkpoint.name}</div>
                    <div className="muted small mono">{c.checkpoint.tagCode}</div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <div className="small num">{c.scansToday ? `${c.scansToday} scans, last ${hhmm(c.lastScan)}` : <Chip tone="warn">Not scanned</Chip>}</div>
                    <RecordButton kind="checkpoint" id={c.checkpoint.id} />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3>Cases</h3>
            <div className="list">
              {data.cases.length === 0 && <div className="empty">No open cases at this site.</div>}
              {data.cases.map((c) => (
                <button key={c.id} className="list-item" onClick={() => go({ view: 'cases', caseId: c.id })}>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <Sev s={c.severity} />
                    <span>{c.title}</span>
                  </div>
                  <Chip tone="neutral">{c.status}</Chip>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </Drawer>
  );
}

const PATROL_CHOICES = [30, 60, 90, 120, 180, 240];

function every(m: number): string {
  return m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} minutes`;
}

/** Patrol rounds follow the group default of 2 hours unless the client asked for another time (Fauzan, 25 Oct 2026). */
function PatrolTime({
  siteId,
  patrol,
}: {
  siteId: string;
  patrol: { intervalMin: number; clientSet: boolean; note: string | null; defaultMin: number; canSet: boolean };
}) {
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState<string>(patrol.clientSet ? String(patrol.intervalMin) : 'default');
  const [note, setNote] = useState(patrol.note ?? '');
  const { run, busy, error } = useAction();
  const save = async () => {
    const m = minutes === 'default' ? null : Number(minutes);
    const r = await run(
      () => api.setPatrolInterval(siteId, { minutes: m, note }),
      (x) => `Patrol every ${every(x.intervalMin)} saved`,
    );
    if (r) setEditing(false);
  };
  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 600 }}>Patrol every {every(patrol.intervalMin)}</div>
          <div className="muted small">{patrol.clientSet ? `Client request: ${patrol.note}` : 'Group default'}</div>
        </div>
        {patrol.canSet && !editing && (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            Change
          </button>
        )}
      </div>
      {editing && (
        <div className="list" style={{ gap: 10, marginTop: 10 }}>
          <ErrorNotice error={error} />
          <div className="field">
            <label htmlFor="pt-m">Patrol time</label>
            <select id="pt-m" className="select" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
              <option value="default">Group default (every {every(patrol.defaultMin)})</option>
              {PATROL_CHOICES.map((m) => (
                <option key={m} value={m}>
                  Every {every(m)}
                </option>
              ))}
            </select>
          </div>
          {minutes !== 'default' && (
            <div className="field">
              <label htmlFor="pt-n">Client request it follows</label>
              <input id="pt-n" className="input" placeholder="e.g. Client email 25 Oct: hourly rounds" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={save}>
              Save
            </button>
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
