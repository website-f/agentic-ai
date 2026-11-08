import { useEffect, useMemo, useState } from 'react';
import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon, PencilSimpleLineIcon, PlusIcon, ProhibitIcon, UserCircleDashedIcon } from '@phosphor-icons/react';
import { addDays, dateOf, isBlocked } from '@prima/core';
import { api, type Roster } from '../api';
import { useApp } from '../App';
import { Card, Empty, PageHead, Person, Search, Stat, Stats, Toolbar } from '../kit';
import { RecordButton } from './RecordForm';
import { Chip, Drawer, ErrorNotice, Findings, Loading, dayLabel, hhmm, useAction, useLoad } from '../ui';
import '../styles/attendance.css';
import '../styles/loading.css';

type RosterShift = Roster['shifts'][number];

export function RosterView({ siteId: initialSite }: { siteId?: string }) {
  const { companyId, me } = useApp();
  const today = dateOf(me.now);
  const [from, setFrom] = useState(today);
  const [siteId, setSiteId] = useState<string | undefined>(initialSite);
  const [editing, setEditing] = useState<RosterShift | null>(null);
  const [adding, setAdding] = useState(false);
  // P90 (Roster "loading nonstop"): the site list is tagged with its company, so a company switch never keeps showing
  // the last company's site and roster, and a company with no sites shows its empty state instead of a spinner that
  // never stops. The site shown is the one picked, else the first; there is no effect that sets state after render.
  const sites = useLoad(() => api.sites(companyId).then((list) => ({ companyId, list })), [companyId]);
  const siteList = sites.data?.companyId === companyId ? sites.data.list : null;
  const site = siteList ? (siteList.find((s) => s.site.id === siteId) ?? siteList[0]) : undefined;
  const activeSite = site?.site.id;

  const roster = useLoad(() => (activeSite ? api.roster(activeSite, from, 7) : Promise.resolve(null)), [activeSite, from]);
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
        <button className="btn" onClick={sites.reload}>
          Try again
        </button>
      </div>
    );
  // Only the roster of the site and week on screen: while another week or site loads, the grid shows its skeleton.
  const r = roster.data && roster.data.site.id === activeSite && roster.data.from === from ? roster.data : null;
  const noSites = siteList !== null && siteList.length === 0;
  const drafts = r?.shifts.filter((s) => s.status === 'draft') ?? [];
  const blocked = r?.shifts.filter((s) => s.personId && isBlocked(s.findings) && s.end > me.now) ?? [];
  const unfilled = r?.shifts.filter((s) => !s.personId) ?? [];

  return (
    <div className="page ros">
      <PageHead
        title="Roster"
        sub="Pick a shift to assign or change a guard. The app checks papers, age, hours and rest before it allows a change."
        actions={
          <>
            {!noSites && <select id="roster-site" className="select ros-site" aria-label="Site" value={activeSite ?? ''} disabled={!siteList?.length} onChange={(e) => setSiteId(e.target.value)}>
              {siteList?.map((s) => (
                <option key={s.site.id} value={s.site.id}>
                  {s.site.code} · {s.site.name}
                </option>
              ))}
            </select>}
            {r?.canEdit && (
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                <PlusIcon size={16} weight="bold" aria-hidden="true" />
                Add shifts
              </button>
            )}
          </>
        }
      />
      {noSites && (
        <Card>
          <Empty title="No sites yet." action={<RecordButton kind="site" companyId={companyId} label="Add site" primary />}>
            A roster belongs to a site. Add the site and its posts first, then add the shifts here.
          </Empty>
        </Card>
      )}

      {!noSites && (
        <>
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
        {!r && roster.error && (
          <div className="att-pad">
            <p className="help">The roster could not load. Check your connection, then try again.</p>
            <ErrorNotice error={roster.error} />
            <button className="btn" onClick={roster.reload}>
              Try again
            </button>
          </div>
        )}
        {!r && !roster.error && <RosterSkeleton />}
        {r && rows.length === 0 && (
          <Empty
            title={r.posts.length ? 'No shifts this week.' : 'This site has no posts yet.'}
            action={
              r.posts.length ? (
                r.canEdit && (
                  <button className="btn btn-primary" onClick={() => setAdding(true)}>
                    <PlusIcon size={16} weight="bold" aria-hidden="true" />
                    Add shifts
                  </button>
                )
              ) : (
                <RecordButton kind="post" companyId={r.site.companyId} label="Add post" primary />
              )
            }
          >
            {r.posts.length
              ? 'Add the shifts for each post, then assign guards and publish the week.'
              : 'Add a post (a guard position with its shift pattern), then add its shifts here.'}
          </Empty>
        )}
        {r && rows.length > 0 && (
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
        </>
      )}
      {editing && <AssignDrawer shift={editing} onClose={() => setEditing(null)} />}
      {adding && r && <AddShiftsDrawer roster={r} from={from < today ? today : from} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** P90: the shape of the week grid while it loads, so the page never looks stuck. */
function RosterSkeleton() {
  return (
    <div className="ros-skel" role="status" aria-live="polite" aria-busy="true">
      <span className="skel-sr">Loading roster…</span>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="ros-skel-row" aria-hidden="true">
          {Array.from({ length: 8 }, (_, j) => (
            <span key={j} className="ros-skel-cell" />
          ))}
        </div>
      ))}
    </div>
  );
}

const PATTERN_LABEL: Record<string, string> = {
  A: '2 shifts of 12 hours (07:00 and 19:00)',
  B: '3 shifts of 8 hours (07:00, 15:00 and 23:00)',
  C: 'Day only (07:00 to 19:00)',
  D: 'Night only (19:00 to 07:00)',
  E: 'Office hours (08:00 to 17:00, not Sundays)',
};

/** P78: add unfilled draft shifts for a post; guards are assigned and the week published as usual. */
function AddShiftsDrawer({ roster: r, from: initialFrom, onClose }: { roster: Roster; from: string; onClose: () => void }) {
  const act = useAction();
  const [postId, setPostId] = useState(r.posts[0]?.id ?? '');
  const post = r.posts.find((p) => p.id === postId);
  const [from, setFrom] = useState(initialFrom);
  const [days, setDays] = useState('7');
  const [own, setOwn] = useState(false);
  const [start, setStart] = useState('07:00');
  const [end, setEnd] = useState('19:00');
  const [guards, setGuards] = useState('');
  const nDays = Number(days);
  const nGuards = guards.trim() ? Number(guards) : null;
  const problem = !postId
    ? 'Choose the post.'
    : !from
      ? 'Give the first day.'
      : !(Number.isInteger(nDays) && nDays >= 1 && nDays <= 31)
        ? 'Add between 1 and 31 days at a time.'
        : nGuards != null && !(Number.isInteger(nGuards) && nGuards >= 1 && nGuards <= 20)
          ? 'Guards per shift: a whole number from 1 to 20.'
          : own && (!start || !end || start === end)
            ? 'Give a start and an end time that differ.'
            : null;
  const save = async () => {
    const ok = await act.run(
      () => api.addShifts(r.site.id, { postId, from, days: nDays, start: own ? start : null, end: own ? end : null, guards: nGuards }),
      (x) => `Added ${x.added} shift${x.added === 1 ? '' : 's'}. Assign guards, then publish the week.`,
    );
    if (ok) onClose();
  };
  return (
    <Drawer title="Add shifts" sub={`${r.site.code} · ${r.site.name}. New shifts start unfilled, as a draft.`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field">
          <span className="label">Post</span>
          <select className="select" value={postId} onChange={(e) => setPostId(e.target.value)}>
            {r.posts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {post && (
            <span className="help">
              Pattern: {PATTERN_LABEL[post.shiftStructure] ?? post.shiftStructure}, {post.guardsPerShift} guard{post.guardsPerShift === 1 ? '' : 's'} a shift.
            </span>
          )}
        </label>
        <label className="field">
          <span className="label">First day</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">How many days</span>
          <input className="input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          <span className="help">Up to 31 days at a time. Shifts already on the roster are not added twice.</span>
        </label>
        <label className="row small" style={{ gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
          <span>Use other times instead of the post's pattern</span>
        </label>
        {own && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <label className="field">
              <span className="label">Starts</span>
              <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Ends</span>
              <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              <span className="help">An end before the start runs past midnight.</span>
            </label>
          </div>
        )}
        <label className="field">
          <span className="label">Guards per shift (optional)</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder={post ? String(post.guardsPerShift) : ''}
            value={guards}
            onChange={(e) => setGuards(e.target.value)}
          />
          <span className="help">Leave empty to use the post's number.</span>
        </label>
        {problem && <p className="help">{problem}</p>}
        <ErrorNotice error={act.error} />
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary" disabled={!!problem || act.busy} onClick={save}>
            {act.busy ? 'Adding…' : 'Add shifts'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Drawer>
  );
}

function AssignDrawer({ shift, onClose }: { shift: RosterShift; onClose: () => void }) {
  const [q, setQ] = useState('');
  // P90: the guard list is asked for once typing pauses, not on every key.
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error } = useLoad(() => api.candidates(shift.id, query), [shift.id, query]);
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
