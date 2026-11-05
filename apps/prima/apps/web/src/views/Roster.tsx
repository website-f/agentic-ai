import { useEffect, useMemo, useState } from 'react';
import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon, PencilSimpleLineIcon, ProhibitIcon, UserCircleDashedIcon } from '@phosphor-icons/react';
import { addDays, dateOf, isBlocked } from '@prima/core';
import { api, type Roster } from '../api';
import { useApp } from '../App';
import { Card, PageHead, Person, Search, Stat, Stats, Toolbar } from '../kit';
import { Chip, Drawer, ErrorNotice, Findings, Loading, dayLabel, hhmm, useAction, useLoad } from '../ui';
import '../styles/attendance.css';

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
    <div className="page ros">
      <PageHead
        title="Roster"
        sub="Pick a shift to assign or change a guard. The app checks papers, age, hours and rest before it allows a change."
        actions={
          <select id="roster-site" className="select ros-site" aria-label="Site" value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value)}>
            {sites.data?.map((s) => (
              <option key={s.site.id} value={s.site.id}>
                {s.site.code} · {s.site.name}
              </option>
            ))}
          </select>
        }
      />

      {r && (
        <Stats>
          <Stat label="Unfilled" value={unfilled.length} tone={unfilled.length ? 'crit' : 'ok'} icon={<UserCircleDashedIcon size={16} />} note="This week" />
          <Stat
            label="Guards not allowed to work"
            value={blocked.length}
            tone={blocked.length ? 'crit' : 'ok'}
            icon={<ProhibitIcon size={16} />}
          />
          <Stat
            label="Not yet published"
            value={drafts.length}
            tone={drafts.length ? 'warn' : 'ok'}
            icon={<PencilSimpleLineIcon size={16} />}
          />
        </Stats>
      )}

      <Toolbar
        end={
          r?.canPublish && (
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
          )
        }
      >
        <div className="seg" role="group" aria-label="Week">
          <button onClick={() => setFrom(addDays(from, -7))} aria-label="Previous week">
            <CaretLeftIcon size={16} />
          </button>
          <button aria-pressed={from === today} onClick={() => setFrom(today)}>
            This week
          </button>
          <button onClick={() => setFrom(addDays(from, 7))} aria-label="Next week">
            <CaretRightIcon size={16} />
          </button>
        </div>
        <span className="ros-range">
          <CalendarBlankIcon size={16} aria-hidden="true" />
          {dayLabel(days[0])} – {dayLabel(days[6])}
        </span>
        {r?.site.armed && <Chip tone="crit">Armed site: firearm permit needed</Chip>}
      </Toolbar>
      <ErrorNotice error={publish.error} />

      <Card
        title={r ? `${r.site.code} · ${r.site.name}` : 'Shifts'}
        sub="One row per post and start time; a second guard on the same slot gets its own row."
        flush
        footer={
          <div className="ros-legend" aria-label="Key">
            <span className="ros-key" data-state="ok">Published</span>
            <span className="ros-key" data-state="draft">Draft</span>
            <span className="ros-key" data-state="unfilled">Unfilled</span>
            <span className="ros-key" data-state="blocked">Not allowed to work</span>
            <span className="ros-key" data-state="past">Past</span>
          </div>
        }
      >
        {!r && (
          <div className="att-pad">
            <Loading what="roster" />
          </div>
        )}
        {r && (
          <div className="table-wrap ros-wrap">
            <table className="roster ros-grid">
              <thead>
                <tr>
                  <th scope="col">Post and time</th>
                  {days.map((d) => {
                    const [wd, ...rest] = dayLabel(d).split(' ');
                    return (
                      <th key={d} scope="col" className={d === today ? 'today' : undefined} aria-current={d === today ? 'date' : undefined}>
                        <span className="ros-wd">{wd}</span>
                        <span className="ros-date">{rest.join(' ')}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <th scope="row">
                      <span className="ros-post">{row.post}</span>
                      <span className="mono small muted">{row.time}</span>
                    </th>
                    {days.map((d) => {
                      const s = row.cells.get(d);
                      const tc = d === today ? 'today' : '';
                      if (!s)
                        return (
                          <td key={d} className={`ros-none ${tc}`}>
                            <span title="No shift">–</span>
                          </td>
                        );
                      const past = s.end <= me.now;
                      const state = past ? 'past' : !s.personId ? 'unfilled' : isBlocked(s.findings) ? 'blocked' : s.status === 'draft' ? 'draft' : 'ok';
                      return (
                        <td key={d} className={tc || undefined}>
                          <button
                            className="cell"
                            data-state={state}
                            disabled={past || !r.canEdit}
                            onClick={() => setEditing(s)}
                            title={s.findings.map((f) => f.message).join(' ')}
                          >
                            {s.personId ? (
                              <>
                                <span className="who">
                                  {state === 'blocked' && <ProhibitIcon size={14} aria-label="Not allowed to work" />}
                                  <span className="who-name">{s.personName}</span>
                                </span>
                                <span className="mono muted">{s.staffNo}</span>
                              </>
                            ) : (
                              <span className="who">
                                <UserCircleDashedIcon size={14} aria-hidden="true" />
                                <span className="who-name">Unfilled</span>
                              </span>
                            )}
                            {s.status === 'draft' && !past && <span className="ros-draft">Draft</span>}
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
      </Card>
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
      <div className="ros-now">
        <div className="label">Now</div>
        {shift.personName ? <Person name={shift.personName} sub={shift.staffNo ?? undefined} /> : <div className="ros-now-name">Nobody assigned</div>}
        <Findings items={shift.findings} />
        {shift.personId && (
          <div>
            <button className="btn btn-sm" onClick={() => assign(null)} disabled={act.busy}>
              Remove guard from this shift
            </button>
          </div>
        )}
      </div>
      {warnings.length > 0 && (
        <div className="notice ros-warn" data-tone="warn">
          Assigned. Please check: {warnings.join(' ')}
          <div>
            <button className="btn btn-sm" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
      <div className="ros-search">
        <Search value={q} onChange={setQ} placeholder="Search guard name or staff number" label="Search guard name or staff number" />
      </div>
      <ErrorNotice error={error} />
      {!data && !error && <Loading what="guards" />}
      <div className="list">
        {data?.candidates.map((c) => (
          <div key={c.person.id} className="list-item ros-cand">
            <div className="ros-cand-main">
              <Person
                name={c.person.name}
                size={32}
                sub={
                  <>
                    <span className="mono">{c.person.staffNo}</span> · {c.person.nationality === 'NP' ? 'Nepal' : 'Malaysia'} · {c.shiftsThisWeek} shifts around this date
                    {c.sameBranch ? ' · same branch' : ''}
                  </>
                }
              />
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
