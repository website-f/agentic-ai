import { useMemo, useState } from 'react';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';
import { ClockCounterClockwiseIcon, FingerprintIcon, SealCheckIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { api, type AuditLog } from '../api';
import { useApp } from '../App';
import { Empty, Facts, PageHead, Person, Stat, Stats } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateTimeLabel, dayLabel, hhmm, humanize, useLoad } from '../ui';
import '../styles/gov.css';

type Entry = AuditLog['entries'][number];

/** The part of an action before the first dot ("arms.issue" is "arms"): what area of the app the change was in. */
const areaOf = (action: string) => action.split('.')[0] || action;

export function AuditView() {
  const { data, error } = useLoad(() => api.audit(), []);
  const { me } = useApp();
  const [open, setOpen] = useState<Entry | null>(null);

  const companyName = useMemo(() => new Map(me.companies.map((c) => [c.id, c.name])), [me.companies]);
  const actors = useMemo(() => [...new Set((data?.entries ?? []).map((e) => e.actor))].sort((a, b) => a.localeCompare(b)), [data]);
  const company = (e: Entry) => (e.companyId ? (companyName.get(e.companyId) ?? 'Company') : 'Group-wide');
  const columns: DtColumn<Entry>[] = [
    { id: 'at', label: 'When', value: (e) => e.at, sort: 'date', render: (e) => <span className="gv-ev-time">{dayLabel(e.at.slice(0, 10))} {e.at.slice(0, 4)} · {hhmm(e.at)}</span>, phone: 'sub', width: '11rem' },
    { id: 'who', label: 'Who', value: (e) => e.actor, render: (e) => <Person name={e.actor} sub={company(e)} size={32} />, phone: 'fact' },
    {
      id: 'what',
      label: 'What',
      value: (e) => e.summary,
      render: (e) => (
        <span className="gv-ev-what">
          <span className="gv-ev-sum">{e.summary}</span>
          {/* P80: the kind of change in words ("CMS: visit update"); its code stays in the entry. */}
          <span className="gv-ev-act">{humanize(e.action)}</span>
        </span>
      ),
      phone: 'title',
    },
    {
      id: 'record',
      label: 'Record',
      value: (e) => humanize(e.entity),
      render: (e) => (
        <span className="gv-ev-rec">
          {humanize(e.entity)} <span className="mono">{e.entityId.length > 14 ? `${e.entityId.slice(0, 14)}…` : e.entityId}</span>
        </span>
      ),
      hideBelow: 1100,
    },
    { id: 'seal', label: 'Seal', value: (e) => e.seq, sort: 'number', render: (e) => <span className="gv-ev-seal mono" title={e.hash}>#{e.seq} · {e.hash.slice(0, 6)}…</span>, align: 'right' },
  ];
  const filters: DtFilter<Entry>[] = [
    { id: 'who', label: 'Who', value: (e) => e.actor, allLabel: 'Everyone' },
    { id: 'area', label: 'Area', value: (e) => areaOf(e.action), optionLabel: humanize, allLabel: 'All areas' },
    { id: 'company', label: 'Company', value: (e) => e.companyId ?? '-', optionLabel: (v) => (v === '-' ? 'Group-wide' : (companyName.get(v) ?? v)) },
  ];

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

      {/* P107: the log as a table: search, who, area and company filters, sortable, paged (was day groups + "Show more"). */}
      <section className="k-card" aria-label="Audit entries">
        <DataTable
          label="Audit entries"
          stateKey="gov.audit.entries"
          rows={data.entries}
          rowKey={(e) => String(e.seq)}
          columns={columns}
          filters={filters}
          searchText={(e) => `${e.action} ${e.entity} ${e.entityId} ${e.seq} ${e.hash}`}
          searchPlaceholder="Search what, who, record or entry number"
          onRowClick={setOpen}
          empty={<Empty title="Nothing recorded yet." />}
        />
      </section>

      {open && (
        <Drawer title={open.summary} sub={`Entry ${open.seq} · ${dateTimeLabel(open.at)}`} onClose={() => setOpen(null)}>
          <Facts
            items={[
              ['Who', open.actor],
              ['When', dateTimeLabel(open.at)],
              ['What', <>{humanize(open.action)} <span className="mono muted small">({open.action})</span></>],
              ['Record', <>{humanize(open.entity)} <span className="mono">{open.entityId}</span></>],
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
