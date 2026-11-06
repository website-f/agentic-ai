import { useState } from 'react';
import { BuildingsIcon, CaretRightIcon, SirenIcon, UserCheckIcon, WarningIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { useApp } from '../App';
import { Card, Empty, Facts, PageHead, Search, Stat, Stats, Toolbar } from '../kit';
import { SiteVisitsSection } from './Visits';
import { RecordButton } from './RecordForm';
import { Chip, Drawer, ErrorNotice, Loading, Sev, hhmm, useAction, useLoad } from '../ui';
import { SHIFT_STATE } from './shared';
import '../styles/ops.css';

type Show = 'all' | 'problems' | 'armed';

export function Sites({ openSiteId }: { openSiteId?: string }) {
  const { companyId } = useApp();
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('all');
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
    (r) =>
      (show === 'all' || (show === 'problems' ? r.problems > 0 : r.site.armed)) &&
      (!ql || r.site.name.toLowerCase().includes(ql) || r.site.code.toLowerCase().includes(ql) || r.site.address.toLowerCase().includes(ql)),
  );
  const sum = (k: 'posts' | 'onDuty' | 'shiftsToday' | 'problems' | 'openCases') => data.reduce((n, r) => n + r[k], 0);
  const problemSites = data.filter((r) => r.problems > 0).length;
  const armed = data.filter((r) => r.site.armed).length;
  const filtered = !!ql || show !== 'all';

  return (
    <div className="page">
      <PageHead
        title="Sites"
        sub={`${data.length} sites. Problems counts no-shows, late guards and unfilled shifts today.`}
        actions={<RecordButton kind="site" companyId={companyId} label="Add site" primary />}
      />
      <Stats>
        <Stat label="Sites" value={data.length} note={`${sum('posts')} posts${armed ? `, ${armed} armed sites` : ''}`} icon={<BuildingsIcon size={16} />} tone="info" />
        <Stat label="On duty now" value={`${sum('onDuty')} / ${sum('shiftsToday')}`} note="Guards on duty of shifts today" icon={<UserCheckIcon size={16} />} />
        <Stat
          label="Problems today"
          value={sum('problems')}
          note={problemSites ? `At ${problemSites} site${problemSites === 1 ? '' : 's'}${show === 'problems' ? ', showing only these' : ''}` : 'No-shows, late, unfilled'}
          tone={sum('problems') ? 'crit' : 'ok'}
          icon={<WarningIcon size={16} />}
          onClick={() => setShow(show === 'problems' ? 'all' : 'problems')}
        />
        <Stat label="Open cases" value={sum('openCases')} note="At these sites" tone={sum('openCases') ? 'warn' : undefined} icon={<SirenIcon size={16} />} />
      </Stats>

      <Toolbar
        end={
          <div className="seg" role="group" aria-label="Show">
            <button aria-pressed={show === 'all'} onClick={() => setShow('all')}>
              All
            </button>
            <button aria-pressed={show === 'problems'} onClick={() => setShow('problems')}>
              Needs attention
            </button>
            <button aria-pressed={show === 'armed'} onClick={() => setShow('armed')}>
              Armed
            </button>
          </div>
        }
      >
        <Search value={q} onChange={setQ} placeholder="Search name, code or town" label="Search sites" />
      </Toolbar>

      <Card title="Site list" sub={filtered ? `${rows.length} of ${data.length}` : `${data.length} sites`} flush>
        <div className="st-head" aria-hidden="true">
          <span>Site</span>
          <span className="st-col-branch">Branch</span>
          <span className="num">Posts</span>
          <span className="num">On duty</span>
          <span className="num">Problems</span>
          <span className="num">Cases</span>
          <span />
        </div>
        <ul className="op-list">
          {rows.map((r) => (
            <li key={r.site.id}>
              <button className="st-row" data-problem={r.problems > 0} onClick={() => setOpen(r.site.id)}>
                <span className="st-main">
                  <span className="st-name">
                    {r.site.name}
                    <Chip tone={r.site.risk === 'high' ? 'crit' : r.site.risk === 'medium' ? 'warn' : 'neutral'}>{r.site.risk}</Chip>
                    {r.site.armed && <Chip tone="crit">Armed</Chip>}
                  </span>
                  <span className="st-sub">
                    <span className="mono">{r.site.code}</span> · {r.site.address}
                  </span>
                </span>
                <span className="st-branch">{r.branchName}</span>
                <span className="st-fig num">
                  <small>Posts</small>
                  {r.posts}
                </span>
                <span className="st-fig num">
                  <small>On duty</small>
                  {r.onDuty} / {r.shiftsToday}
                </span>
                <span className="st-fig num" data-tone={r.problems ? 'crit' : 'zero'}>
                  <small>Problems</small>
                  {r.problems}
                </span>
                <span className="st-fig num" data-tone={r.openCases ? undefined : 'zero'}>
                  <small>Cases</small>
                  {r.openCases}
                </span>
                <CaretRightIcon className="st-go" size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {rows.length === 0 &&
          (q ? (
            <Empty title={`No site matches “${q}”.`}>Clear the search or show all sites.</Empty>
          ) : (
            <Empty title="No site to show." action={<RecordButton kind="site" companyId={companyId} label="Add site" primary />}>
              Add the site, then its posts and patrol checkpoints. Its roster opens from here.
            </Empty>
          ))}
      </Card>
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
          <div className="st-actions">
            <button className="btn btn-primary" onClick={() => go({ view: 'roster', siteId })}>
              Open roster
            </button>
            <RecordButton kind="site" id={siteId} label="Edit site" />
          </div>
          <div className="op-facts">
            <Facts
              items={[
                ['Client', data.site.client],
                ['Branch', data.branch?.name ?? '-'],
                ['Clock-in allowed within', `${data.site.geofenceM} m`],
                ['Posts', data.posts.length],
                ['Shifts today', data.shifts.length],
                ['Open cases', data.cases.length],
              ]}
            />
          </div>

          <section className="op-sec">
            <div className="op-sec-head">
              <h3>On duty and today</h3>
            </div>
            <div className="op-box">
              {data.shifts.length === 0 && <Empty title="No shifts today." />}
              {data.shifts.map((s) => {
                const st = SHIFT_STATE[s.state];
                return (
                  <div key={s.id} className="op-item">
                    <div className="op-line">
                      <div className="op-main">
                        <span className="op-title">{s.personName ?? 'Nobody assigned'}</span>
                        <span className="op-meta">
                          {s.postName} · {hhmm(s.start)}–{hhmm(s.end)}
                          {s.attendance?.clockIn && ` · in ${hhmm(s.attendance.clockIn)}`}
                          {s.attendance?.flags.length ? ` · ${s.attendance.flags.join(', ').toLowerCase().replace(/_/g, ' ')}` : ''}
                        </span>
                      </div>
                      <Chip tone={st.tone}>{st.label}</Chip>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="op-sec">
            <div className="op-sec-head">
              <h3>Cases</h3>
            </div>
            <div className="op-box">
              {data.cases.length === 0 && <Empty title="No open cases at this site." />}
              {data.cases.map((c) => (
                <button key={c.id} className="op-item" onClick={() => go({ view: 'cases', caseId: c.id })}>
                  <div className="op-line">
                    <div className="op-chips">
                      <Sev s={c.severity} />
                      <span className="op-title">{c.title}</span>
                    </div>
                    <Chip tone="neutral">{c.status}</Chip>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="op-sec">
            <div className="op-sec-head">
              <h3>Posts</h3>
              <RecordButton kind="post" companyId={data.site.companyId} label="Add post" />
            </div>
            <div className="op-box">
              {data.posts.length === 0 && <Empty title="No posts yet." />}
              {data.posts.map((p) => (
                <div key={p.id} className="op-item">
                  <div className="op-line">
                    <div className="op-main">
                      <span className="op-title">{p.name}</span>
                      <span className="op-meta">
                        Pattern {p.shiftStructure} · {p.guardsPerShift} per shift
                      </span>
                    </div>
                    <RecordButton kind="post" id={p.id} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <PatrolTime siteId={siteId} patrol={data.patrol} />

          <section className="op-sec">
            <div className="op-sec-head">
              <h3>Patrol checkpoints today</h3>
              <RecordButton kind="checkpoint" companyId={data.site.companyId} label="Add checkpoint" />
            </div>
            <div className="op-box">
              {data.checkpoints.map((c) => (
                <div key={c.checkpoint.id} className="op-item">
                  <div className="op-line">
                    <div className="op-main">
                      <span className="op-title">{c.checkpoint.name}</span>
                      <span className="op-meta mono">{c.checkpoint.tagCode}</span>
                    </div>
                    <div className="op-chips">
                      {c.scansToday ? (
                        <span className="small num">
                          {c.scansToday} scans, last {hhmm(c.lastScan)}
                        </span>
                      ) : (
                        <Chip tone="warn">Not scanned</Chip>
                      )}
                      <RecordButton kind="checkpoint" id={c.checkpoint.id} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <SiteVisitsSection siteId={siteId} />
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
    <section className="op-sec">
      <div className="op-sec-head">
        <h3>Patrol time</h3>
      </div>
      <div className="op-box">
        <div className="op-item">
          <div className="st-patrol">
            <div className="op-main">
              <span className="op-title">Patrol every {every(patrol.intervalMin)}</span>
              <span className="op-meta">{patrol.clientSet ? `Client request: ${patrol.note}` : 'Group default'}</span>
            </div>
            {patrol.canSet && !editing && (
              <button className="btn btn-sm" onClick={() => setEditing(true)}>
                Change
              </button>
            )}
          </div>
          {editing && (
            <div className="op-form">
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
              <div className="op-form-actions">
                <button className="btn" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={busy} onClick={save}>
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
