import { Select } from '../SearchSelect';
import { useState } from 'react';
import { BuildingsIcon, SirenIcon, UserCheckIcon, WarningIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { useApp } from '../App';
import { Card, Empty, Facts, PageHead, Stat, Stats } from '../kit';
import { DataTable, useTableState, type DtColumn, type DtFilter } from '../DataTable';
import { SiteVisitsSection } from './Visits';
import { SiteDutyLogView } from './DutyDevice';
import { SiteTasksView } from './SiteTasks';
import { RecordButton, RecordDrawer, useRecordKinds } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import { Chip, Drawer, ErrorNotice, Loading, Sev, hhmm, useAction, useLoad } from '../ui';
import { SHIFT_STATE } from './shared';
import '../styles/ops.css';

type SiteRow = Awaited<ReturnType<typeof api.sites>>[number];
const RISK: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/** P107: the site list's columns: the old row (name with risk and armed chips, code and address, branch, figures). */
const SITE_COLUMNS: DtColumn<SiteRow>[] = [
  {
    id: 'name',
    label: 'Site',
    value: (r) => r.site.name,
    phone: 'title',
    render: (r) => (
      <span className="st-main">
        <span className="st-name">
          {r.site.name}
          <Chip tone={r.site.risk === 'high' ? 'crit' : r.site.risk === 'medium' ? 'warn' : 'neutral'}>{r.site.risk}</Chip>
          {r.site.armed && <Chip tone="crit">Armed</Chip>}
        </span>
      </span>
    ),
  },
  {
    id: 'code',
    label: 'Code and address',
    value: (r) => `${r.site.code} · ${r.site.address}`,
    phone: 'sub',
    hideBelow: 1100,
    render: (r) => (
      <span className="st-sub">
        <span className="mono">{r.site.code}</span> · {r.site.address}
      </span>
    ),
  },
  { id: 'branch', label: 'Branch', value: (r) => r.branchName, hideBelow: 900 },
  { id: 'posts', label: 'Posts', value: (r) => r.posts, sort: 'number' },
  { id: 'onDuty', label: 'On duty', value: (r) => r.onDuty, sort: 'number', render: (r) => `${r.onDuty} / ${r.shiftsToday}` },
  {
    id: 'problems',
    label: 'Problems',
    value: (r) => r.problems,
    sort: 'number',
    render: (r) => (
      <span className="op-num" data-tone={r.problems ? 'crit' : undefined}>
        {r.problems}
      </span>
    ),
  },
  { id: 'cases', label: 'Cases', value: (r) => r.openCases, sort: 'number' },
];
const SITE_FILTERS: DtFilter<SiteRow>[] = [
  {
    id: 'show',
    label: 'Show',
    value: (r) => [...(r.problems > 0 ? ['problems'] : []), ...(r.site.armed ? ['armed'] : [])],
    options: [
      { value: 'problems', label: 'Needs attention' },
      { value: 'armed', label: 'Armed' },
    ],
  },
  { id: 'risk', label: 'Risk', value: (r) => r.site.risk, optionLabel: (v) => RISK[v] ?? v },
  { id: 'branch', label: 'Branch', value: (r) => r.branchName },
];

export function Sites({ openSiteId }: { openSiteId?: string }) {
  const { companyId } = useApp();
  const table = useTableState('sites.list');
  const [open, setOpen] = useState<string | undefined>(openSiteId);
  // P107b: Add site and Edit site open the existing site form, for the people who keep site records (as before).
  const mayKeep = useRecordKinds().has('site');
  const [record, setRecord] = useState<{ id: string | null } | null>(null);
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
  const show = table.state.f.show ?? '';
  const setShow = (v: '' | 'problems') => table.set({ f: { show: v } });
  const sum = (k: 'posts' | 'onDuty' | 'shiftsToday' | 'problems' | 'openCases') => data.reduce((n, r) => n + r[k], 0);
  const problemSites = data.filter((r) => r.problems > 0).length;
  const armed = data.filter((r) => r.site.armed).length;

  return (
    <div className="page">
      <PageHead
        title="Sites"
        sub={`${data.length} sites. Problems counts no-shows, late guards and unfilled shifts today.`}
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
          onClick={() => setShow(show === 'problems' ? '' : 'problems')}
        />
        <Stat label="Open cases" value={sum('openCases')} note="At these sites" tone={sum('openCases') ? 'warn' : undefined} icon={<SirenIcon size={16} />} />
      </Stats>

      {/* P107: the site list as a data table; the old search and All / Needs attention / Armed buttons are its search
          and Show filter (the Problems tile still picks Needs attention). P107b: View (the site drawer), Edit site, ticks
          and Export; Add site and Import from file moved from the page head into the table's toolbar. No Delete: Prima
          has no close or remove action for a site (sites are kept; the API has none). */}
      <Card title="Site list" sub={`${data.length} sites`} flush>
        <DataTable
          label="Site list"
          control={table}
          rows={data}
          rowKey={(r) => r.site.id}
          onView={(r) => setOpen(r.site.id)}
          onEdit={mayKeep ? (r) => setRecord({ id: r.site.id }) : undefined}
          editLabel="Edit site"
          onAdd={mayKeep ? () => setRecord({ id: null }) : undefined}
          addLabel="Add site"
          importKind="site"
          importCompanyId={companyId}
          selectable
          exportName="sites"
          rowTone={(r) => (r.problems > 0 ? 'crit' : undefined)}
          searchPlaceholder="Search name, code or town"
          columns={SITE_COLUMNS}
          filters={SITE_FILTERS}
          empty={
            <Empty title="No site to show.">
              Add the site, then its posts and patrol checkpoints. Its roster opens from here.
            </Empty>
          }
        />
      </Card>
      {open && <SiteDrawer siteId={open} onClose={() => setOpen(undefined)} />}
      {record && <RecordDrawer kind="site" id={record.id} companyId={record.id ? null : companyId} onClose={() => setRecord(null)} />}
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

          <SiteVisitsSection siteId={siteId} />

          {/* What the client needs and the tasks the OM sets from it (Fauzan, 6 Nov 2026). */}
          <details className="op-sec">
            <summary className="op-sec-head" style={{ cursor: 'pointer' }}>
              <h3>Client needs and site tasks</h3>
            </summary>
            <SiteTasksView siteId={siteId} />
          </details>

          {/* Post log and gate log from the site's shared device (Fauzan, 6 Nov 2026). */}
          <details className="op-sec">
            <summary className="op-sec-head" style={{ cursor: 'pointer' }}>
              <h3>Duty log: post log and gate</h3>
            </summary>
            <SiteDutyLogView siteId={siteId} layout="cards" />
          </details>

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
              <span className="row" style={{ gap: 6 }}>
                <ImportButton kind="post" companyId={data.site.companyId} />
                <RecordButton kind="post" companyId={data.site.companyId} label="Add post" />
              </span>
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
              <span className="row" style={{ gap: 6 }}>
                <ImportButton kind="checkpoint" companyId={data.site.companyId} />
                <RecordButton kind="checkpoint" companyId={data.site.companyId} label="Add checkpoint" />
              </span>
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
                <Select id="pt-m" className="select" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
                  <option value="default">Group default (every {every(patrol.defaultMin)})</option>
                  {PATROL_CHOICES.map((m) => (
                    <option key={m} value={m}>
                      Every {every(m)}
                    </option>
                  ))}
                </Select>
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
