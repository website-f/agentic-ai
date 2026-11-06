import { useMemo, useState } from 'react';
import { ClockCounterClockwiseIcon, FingerprintIcon, SealCheckIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { api, type AuditLog } from '../api';
import { useApp } from '../App';
import { Empty, Facts, PageHead, Person, Search, Stat, Stats, Toolbar } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateTimeLabel, dayLabel, hhmm, useLoad } from '../ui';
import '../styles/gov.css';

type Entry = AuditLog['entries'][number];

/** The part of an action before the first dot ("arms.issue" is "arms"): what area of the app the change was in. */
const areaOf = (action: string) => action.split('.')[0] || action;
const PAGE = 100;

export function AuditView() {
  const { data, error } = useLoad(() => api.audit(), []);
  const { me } = useApp();
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const [area, setArea] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Entry | null>(null);

  const companyName = useMemo(() => new Map(me.companies.map((c) => [c.id, c.name])), [me.companies]);
  const actors = useMemo(() => [...new Set((data?.entries ?? []).map((e) => e.actor))].sort((a, b) => a.localeCompare(b)), [data]);
  const areas = useMemo(() => [...new Set((data?.entries ?? []).map((e) => areaOf(e.action)))].sort(), [data]);

  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="audit trail" />
      </div>
    );

  const needle = q.trim().toLowerCase();
  const shown = data.entries.filter(
    (e) =>
      (!who || e.actor === who) &&
      (!area || areaOf(e.action) === area) &&
      (!needle || [e.summary, e.actor, e.action, e.entity, e.entityId, String(e.seq)].some((v) => v.toLowerCase().includes(needle))),
  );
  const filtered = !!(needle || who || area);
  const page = shown.slice(0, limit);
  // Group the rows by day, newest first (the log already comes newest first).
  const days: [string, Entry[]][] = [];
  for (const e of page) {
    const d = e.at.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(e);
    else days.push([d, [e]]);
  }
  const seal = data.verified ? (
    data.chainIntact ? (
      <Chip tone="ok">Seal intact across {data.total} entries</Chip>
    ) : (
      <Chip tone="crit">Seal broken at entry {data.brokenAt}</Chip>
    )
  ) : (
    <Chip tone="neutral">Seal checked by PWVSB</Chip>
  );

  return (
    <div className="page gv-page">
      <PageHead
        title="Audit trail"
        sub="Every change is recorded with who, what and when. Prima writes each entry itself, so nobody adds or edits one here. Each entry is sealed with the one before it, so any later edit breaks the seal and shows here."
        actions={seal}
      />
      <Stats>
        <Stat
          label="Entries shown"
          value={data.entries.length}
          note={`Latest ${data.entries.length} of ${data.total} in the log`}
          icon={<ClockCounterClockwiseIcon size={16} />}
          tone="info"
        />
        <Stat
          label="Seal"
          value={data.verified ? (data.chainIntact ? 'Intact' : 'Broken') : 'PWVSB'}
          note={data.verified ? (data.chainIntact ? `Checked across ${data.total} entries` : `Broken at entry ${data.brokenAt}`) : 'Seal checked by PWVSB'}
          tone={data.verified ? (data.chainIntact ? 'ok' : 'crit') : undefined}
          icon={<SealCheckIcon size={16} />}
        />
        <Stat label="People" value={actors.length} note="Who made the changes shown" icon={<UsersThreeIcon size={16} />} />
        <Stat
          label="Latest change"
          value={data.entries[0] ? hhmm(data.entries[0].at) : '–'}
          note={data.entries[0] ? `${dayLabel(data.entries[0].at.slice(0, 10))} by ${data.entries[0].actor}` : 'Nothing recorded yet'}
          icon={<FingerprintIcon size={16} />}
        />
      </Stats>

      <Toolbar end={<span className="muted small">{filtered ? `${shown.length} of ${data.entries.length}` : `${data.entries.length} entries`}</span>}>
        <Search
          value={q}
          onChange={(v) => {
            setQ(v);
            setLimit(PAGE);
          }}
          placeholder="Search what, who, record or entry number"
          label="Search the audit trail"
        />
        <select className="select gv-filter" aria-label="Who" value={who} onChange={(e) => (setWho(e.target.value), setLimit(PAGE))}>
          <option value="">Everyone</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select className="select gv-filter" aria-label="Area" value={area} onChange={(e) => (setArea(e.target.value), setLimit(PAGE))}>
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </Toolbar>

      <section className="k-card" aria-label="Audit entries">
        {shown.length > 0 && (
          <div className="gv-ev-head" aria-hidden="true">
            <span>Time</span>
            <span>Who</span>
            <span>What</span>
            <span>Record</span>
            <span>Seal</span>
          </div>
        )}
        {shown.length > 0 && (
          <ul className="gv-list">
            {days.map(([d, rows]) => (
              <li key={d} className="gv-group-li">
                <div className="gv-group">
                  <span>{dayLabel(d)} {d.slice(0, 4)}</span>
                  <span>
                    {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
                  </span>
                </div>
                <ul className="gv-list">
                  {rows.map((e) => (
                    <li key={e.seq}>
                      <button type="button" className="gv-ev" onClick={() => setOpen(e)} aria-label={`Entry ${e.seq}: ${e.summary}`}>
                        <span className="gv-ev-time">{hhmm(e.at)}</span>
                        <span className="gv-ev-who">
                          <Person name={e.actor} sub={e.companyId ? (companyName.get(e.companyId) ?? 'Company') : 'Group-wide'} size={32} />
                        </span>
                        <span className="gv-ev-what">
                          <span className="gv-ev-sum">{e.summary}</span>
                          <span className="gv-ev-act mono">{e.action}</span>
                        </span>
                        <span className="gv-ev-rec">
                          {e.entity} <span className="mono">{e.entityId.length > 14 ? `${e.entityId.slice(0, 14)}…` : e.entityId}</span>
                        </span>
                        <span className="gv-ev-seal mono" title={e.hash}>
                          #{e.seq} · {e.hash.slice(0, 6)}…
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {shown.length > page.length && (
          <div className="gv-more">
            <button className="btn" onClick={() => setLimit(limit + PAGE)}>
              Show {Math.min(PAGE, shown.length - page.length)} more
            </button>
          </div>
        )}
        {data.entries.length === 0 && <Empty title="Nothing recorded yet." />}
        {data.entries.length > 0 && shown.length === 0 && (
          <Empty
            title="No entries."
            action={
              <button
                className="btn btn-sm"
                onClick={() => {
                  setQ('');
                  setWho('');
                  setArea('');
                }}
              >
                Clear search and filters
              </button>
            }
          >
            Nothing matches the search or filters.
          </Empty>
        )}
      </section>

      {open && (
        <Drawer title={open.summary} sub={`Entry ${open.seq} · ${dateTimeLabel(open.at)}`} onClose={() => setOpen(null)}>
          <Facts
            items={[
              ['Who', open.actor],
              ['When', dateTimeLabel(open.at)],
              ['What', <span className="mono">{open.action}</span>],
              ['Record', <>{open.entity} <span className="mono">{open.entityId}</span></>],
              ['Company', open.companyId ? (companyName.get(open.companyId) ?? open.companyId) : 'Group-wide'],
              ['Entry', `#${open.seq} of ${data.total}`],
            ]}
          />
          <div className="gv-seal-box">
            <div className="row">{seal}</div>
            <div>
              <div className="label">Seal of this entry</div>
              <div className="gv-hash">{open.hash}</div>
            </div>
            <div>
              <div className="label">Seal of the entry before</div>
              <div className="gv-hash">{open.prevHash}</div>
            </div>
            <p className="muted small">
              Each entry is sealed with the one before it, so any later edit breaks the seal and shows here.
            </p>
          </div>
        </Drawer>
      )}
    </div>
  );
}
