import { useEffect, useMemo, useState } from 'react';
import { addDays, dateOf, isBlocked } from '@prima/core';
import { api, type Roster } from '../api';
import { useApp } from '../App';
import { Chip, Drawer, ErrorNotice, Findings, Loading, dayLabel, hhmm, useAction, useLoad } from '../ui';

type RosterShift = Roster['shifts'][number];

export function RosterView({ siteId: initialSite }: { siteId?: string }) {
  const { companyId, me } = useApp();
  const today = dateOf(me.now);
  const [from, setFrom] = useState(today);
  const [siteId, setSiteId] = useState<string | undefined>(initialSite);
  const [editing, setEditing] = useState<RosterShift | null>(null);
  const sites = useLoad(() => api.sites(companyId), [companyId]);

  useEffect(() => {
    if (!sites.data?.length) return;
    if (!siteId || !sites.data.some((s) => s.site.id === siteId)) setSiteId(sites.data[0].site.id);
  }, [sites.data, siteId]);

  const roster = useLoad(() => (siteId ? api.roster(siteId, from, 7) : Promise.resolve(null)), [siteId, from]);
  const publish = useAction();

  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const rows = useMemo(() => {
    const r = roster.data;
    if (!r) return [];
    // One row per post and start time; a second guard on the same slot gets its own row.
    const map = new Map<string, { post: string; time: string; cells: Map<string, RosterShift> }>();
    for (const s of r.shifts) {
      const post = r.posts.find((p) => p.id === s.postId);
      let k = 0;
      let key = `${s.postId}|${hhmm(s.start)}|${k}`;
      while (map.get(key)?.cells.has(s.date)) key = `${s.postId}|${hhmm(s.start)}|${++k}`;
      if (!map.has(key)) map.set(key, { post: post?.name ?? '', time: `${hhmm(s.start)}–${hhmm(s.end)}`, cells: new Map() });
      map.get(key)!.cells.set(s.date, s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [roster.data]);

  if (sites.error)
    return (
      <div className="page">
        <ErrorNotice error={sites.error} />
      </div>
    );
  const r = roster.data;
  const drafts = r?.shifts.filter((s) => s.status === 'draft') ?? [];
  const blocked = r?.shifts.filter((s) => s.personId && isBlocked(s.findings) && s.end > me.now) ?? [];
  const unfilled = r?.shifts.filter((s) => !s.personId) ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Roster</h1>
          <p>Pick a shift to assign or change a guard. The app checks papers, age, hours and rest before it allows a change.</p>
        </div>
        <div className="row">
          <select id="roster-site" className="select" value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value)} style={{ maxWidth: 320 }}>
            {sites.data?.map((s) => (
              <option key={s.site.id} value={s.site.id}>
                {s.site.code} · {s.site.name}
              </option>
            ))}
          </select>
          <div className="seg">
            <button onClick={() => setFrom(addDays(from, -7))} aria-label="Previous week">
              ‹
            </button>
            <button aria-pressed={from === today} onClick={() => setFrom(today)}>
              This week
            </button>
            <button onClick={() => setFrom(addDays(from, 7))} aria-label="Next week">
              ›
            </button>
          </div>
        </div>
      </div>

      {r && (
        <div className="row">
          {r.site.armed && <Chip tone="crit">Armed site: firearm permit needed</Chip>}
          <Chip tone={unfilled.length ? 'crit' : 'ok'}>{unfilled.length} unfilled</Chip>
          <Chip tone={blocked.length ? 'crit' : 'ok'}>{blocked.length} guards not allowed to work</Chip>
          <Chip tone={drafts.length ? 'warn' : 'ok'}>{drafts.length} not yet published</Chip>
          <span className="grow" style={{ flex: 1 }} />
          {r.canPublish && (
            <button
              className="btn btn-primary"
              disabled={!drafts.length || publish.busy}
              onClick={() =>
                publish.run(
                  () => api.publish(r.site.id, from, addDays(from, 6)),
                  (x) => `Published ${x.published} shifts${x.unfilled ? `, ${x.unfilled} still unfilled` : ''}.`,
                )
              }
            >
              Publish this week
            </button>
          )}
        </div>
      )}
      <ErrorNotice error={publish.error} />

      <section className="panel">
        {!r && <Loading what="roster" />}
        {r && (
          <div className="table-wrap">
            <table className="roster">
              <thead>
                <tr>
                  <th>Post and time</th>
                  {days.map((d) => (
                    <th key={d} className={d === today ? 'today' : undefined}>
                      {dayLabel(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.post}</div>
                      <div className="mono small muted">{row.time}</div>
                    </td>
                    {days.map((d) => {
                      const s = row.cells.get(d);
                      if (!s)
                        return (
                          <td key={d} className="muted small" style={{ textAlign: 'center' }}>
                            –
                          </td>
                        );
                      const past = s.end <= me.now;
                      const state = past ? 'past' : !s.personId ? 'unfilled' : isBlocked(s.findings) ? 'blocked' : s.status === 'draft' ? 'draft' : 'ok';
                      return (
                        <td key={d}>
                          <button
                            className="cell"
                            data-state={state}
                            disabled={past || !r.canEdit}
                            onClick={() => setEditing(s)}
                            title={s.findings.map((f) => f.message).join(' ')}
                          >
                            {s.personId ? (
                              <>
                                <span className="who">{s.personName}</span>
                                <span className="mono muted">{s.staffNo}</span>
                              </>
                            ) : (
                              <span className="who">Unfilled</span>
                            )}
                            {s.status === 'draft' && !past && <span className="muted">Draft</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && <AssignDrawer shift={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AssignDrawer({ shift, onClose }: { shift: RosterShift; onClose: () => void }) {
  const [q, setQ] = useState('');
  const { data, error } = useLoad(() => api.candidates(shift.id, q), [shift.id, q]);
  const act = useAction();
  const [warnings, setWarnings] = useState<string[]>([]);

  const assign = async (personId: string | null) => {
    const res = await act.run(() => api.assign(shift.id, personId), personId ? 'Guard assigned. Publish the week when ready.' : 'Shift left unfilled.');
    if (res) {
      if (res.warnings.length) setWarnings(res.warnings.map((w) => w.message));
      else onClose();
    }
  };

  return (
    <Drawer title={`${dayLabel(shift.date)}, ${hhmm(shift.start)}–${hhmm(shift.end)}`} sub={`${shift.siteName} · ${shift.postName}`} onClose={onClose}>
      <div>
        <div className="label">Now</div>
        <div style={{ fontWeight: 600 }}>{shift.personName ?? 'Nobody assigned'}</div>
        <Findings items={shift.findings} />
        {shift.personId && (
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => assign(null)} disabled={act.busy}>
            Remove guard from this shift
          </button>
        )}
      </div>
      {warnings.length > 0 && (
        <div className="notice" data-tone="warn">
          Assigned. Please check: {warnings.join(' ')}
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-sm" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
      <input id="candidate-search" className="input" placeholder="Search guard name or staff number" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorNotice error={error} />
      {!data && !error && <Loading what="guards" />}
      <div className="list">
        {data?.candidates.map((c) => (
          <div key={c.person.id} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>
                {c.person.name} <span className="mono muted small">{c.person.staffNo}</span>
              </div>
              <div className="muted small">
                {c.person.nationality === 'NP' ? 'Nepal' : 'Malaysia'} · {c.shiftsThisWeek} shifts around this date{c.sameBranch ? ' · same branch' : ''}
              </div>
              <Findings items={c.findings} />
            </div>
            <button className="btn btn-sm btn-primary" disabled={c.blocked || act.busy || c.person.id === shift.personId} onClick={() => assign(c.person.id)}>
              {c.person.id === shift.personId ? 'Assigned' : 'Assign'}
            </button>
          </div>
        ))}
      </div>
    </Drawer>
  );
}
