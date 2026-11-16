import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type GovOpsMonitor } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useLoad } from '../ui';
import { DataTable } from '../DataTable';

type Tab = 'pnl' | 'pay' | 'leave' | 'clients';
const PNL_STATUS: Record<string, string> = { crit: 'Loss', unknown: 'Unknown', ok: 'Profit' };
const CLIENT_TONE: Record<string, string> = { crit: 'Needs attention', warn: 'Follow up', unknown: 'Unknown', ok: 'In order' };
const rm = (n: number | null) => (n == null ? 'Unknown' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const LEAVE_KIND: Record<string, string> = {
  ANNUAL: 'Annual',
  SICK: 'Sick (MC)',
  HOSPITAL: 'Hospital',
  EMERGENCY: 'Emergency',
  UNPAID: 'Unpaid',
  ABSENCE_REASON: 'Absence reason',
};
const LINK = {
  background: 'none',
  border: 0,
  padding: 0,
  color: 'var(--accent, inherit)',
  textDecoration: 'underline',
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left',
} as const;

/** The last six months, newest first, for the month picker. */
function months(today: string): string[] {
  const out: string[] = [];
  let [y, m] = today.slice(0, 7).split('-').map(Number);
  for (let i = 0; i < 6; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/**
 * Operations monitor (Fauzan, 2 Nov 2026): each site's profit and loss, a check of every guard's pay from the hours
 * they worked, and guards on leave. Government sites for Goodwill Empire, private sites for Sasa Team. Unknown is never
 * shown as fine.
 */
export function GovOpsMonitorPanel({ sector = 'government' }: { sector?: 'government' | 'private' }) {
  const { setCompanyId, go } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [tab, setTab] = useState<Tab>('pnl');
  const { data, error } = useLoad(() => (sector === 'private' ? api.privateOpsMonitor(month) : api.govOpsMonitor(month)), [month, sector]);
  const label = sector === 'private' ? 'Private' : 'Government';
  return (
    <section className="panel">
      <div className="panel-head" style={{ flexWrap: 'wrap', gap: 6 }}>
        <h3>{label} sites: profit, pay and leave</h3>
        <Select className="select" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }}>
          {months(today).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </div>
      {error ? (
        <ErrorNotice error={error} />
      ) : !data ? (
        <Loading what={`the ${label.toLowerCase()} sites`} />
      ) : (
        <Body
          d={data}
          label={label}
          tab={tab}
          setTab={setTab}
          openPerson={(companyId, personId) => {
            setCompanyId(companyId);
            go({ view: 'people', personId });
          }}
          openSite={(companyId, siteId) => {
            setCompanyId(companyId);
            go({ view: 'sites', siteId });
          }}
        />
      )}
    </section>
  );
}

function Body({
  d,
  label,
  tab,
  setTab,
  openSite,
  openPerson,
}: {
  d: GovOpsMonitor;
  label: string;
  tab: Tab;
  setTab: (t: Tab) => void;
  openSite: (companyId: string, siteId: string) => void;
  openPerson: (companyId: string, personId: string) => void;
}) {
  const t = d.totals;
  if (!t) return <p className="muted small">No {label.toLowerCase()} sites in your area yet.</p>;
  return (
    <>
      <div className="kpis">
        <Kpi
          label={`${label} sites`}
          value={t.sites}
          note={t.unknownSites ? `${t.unknownSites} with margin Unknown` : undefined}
          tone={t.unknownSites ? 'warn' : 'ok'}
        />
        <Kpi label="Sites at a loss" value={t.lossSites} tone={t.lossSites ? 'crit' : 'ok'} note={`Margin ${rm(t.margin)} on complete sites`} />
        <Kpi label="Pay to check" value={t.payFlags} tone={t.payFlags ? 'warn' : 'ok'} note={`${t.guards} guards${t.noAttendance ? `, ${t.noAttendance} with no clock-in` : ''}, expected here ${rm(t.expectedPay)}`} />
        <Kpi
          label="Unhappy clients"
          value={t.unhappyClients}
          tone={t.unhappyClients ? 'crit' : t.notRated || t.openComplaints ? 'warn' : 'ok'}
          note={`${t.avgScore != null ? `Average ${t.avgScore} of 5 · ` : ''}${t.openComplaints} open complaint${t.openComplaints === 1 ? '' : 's'} · ${t.notRated} not rated in 90 days`}
        />
        <Kpi
          label="On leave today"
          value={t.onLeaveToday}
          note={t.leavePending ? `${t.leavePending} waiting for a decision` : undefined}
          tone={t.leavePending ? 'warn' : 'ok'}
        />
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }} role="tablist">
        {(
          [
            ['pnl', 'Site profit and loss'],
            ['pay', 'Salary check'],
            ['leave', 'Guards on leave'],
            ['clients', 'Client satisfaction'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn btn-sm${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {/* P107: each tab is a data table: search, filters, sort by any figure, pages. Cells keep their old notes. */}
      {tab === 'pnl' && (
        <DataTable
          details
          label="Site profit and loss"
          stateKey={`govops.${label}.pnl`}
          rows={d.sites}
          rowKey={(x) => x.siteId}
          searchPlaceholder="Find a site or company"
          columns={[
            {
              id: 'site',
              label: 'Site',
              value: (x) => x.siteName,
              phone: 'title',
              render: (x) => (
                <>
                  <button style={LINK} onClick={() => openSite(x.companyId, x.siteId)}>
                    {x.siteName}
                  </button>
                  <div className="muted small">
                    {x.companyName} · {x.guards} guards · {x.clockedHours} of {x.contractedHours} contract hours clocked
                  </div>
                  {x.notes.map((n) => (
                    <div key={n} className="muted small">
                      {n}
                    </div>
                  ))}
                </>
              ),
            },
            {
              id: 'revenue',
              label: 'Income',
              value: (x) => x.revenue,
              sort: 'money',
              render: (x) => (
                <>
                  {rm(x.revenue)}
                  {x.revenueBasis ? <div className="muted small">{x.revenueBasis === 'invoice' ? 'invoiced' : 'contract value'}</div> : null}
                </>
              ),
            },
            { id: 'guardCost', label: 'Guard pay', value: (x) => x.guardCost, sort: 'money', render: (x) => rm(x.guardCost), hideBelow: 1280, phone: 'hidden' },
            {
              id: 'cash',
              label: 'Salary cost – cash payment',
              value: (x) => x.cashPayroll,
              sort: 'money',
              hideBelow: 1100,
              phone: 'hidden',
              render: (x) => (
                <>
                  {rm(x.cashPayroll)}
                  {x.cashPayrollPending > 0 && <div className="muted small">{rm(x.cashPayrollPending)} awaiting accounting</div>}
                  <div className="muted small">{x.cashPayrollTrace.map((r) => `${r.id}: ${r.journalRef}`).join('; ')}</div>
                </>
              ),
            },
            { id: 'statutory', label: 'EPF, SOCSO, EIS, levy', value: (x) => x.statutory, sort: 'money', render: (x) => rm(x.statutory), hideBelow: 1366, phone: 'hidden' },
            { id: 'hostel', label: 'Hostel', value: (x) => x.hostel, sort: 'money', render: (x) => rm(x.hostel), hideBelow: 1366, phone: 'hidden' },
            { id: 'items', label: 'Goodwill items', value: (x) => x.itemCharges, sort: 'money', render: (x) => rm(x.itemCharges), hideBelow: 1366, phone: 'hidden' },
            { id: 'fee', label: 'Management fee', value: (x) => x.managementFee, sort: 'money', render: (x) => rm(x.managementFee), hideBelow: 1366, phone: 'hidden' },
            {
              id: 'margin',
              label: 'Margin',
              value: (x) => x.margin,
              sort: 'money',
              render: (x) => (
                <>
                  {rm(x.margin)}
                  {x.marginPct != null ? <div className="muted small">{x.marginPct}%</div> : null}
                </>
              ),
            },
            {
              id: 'status',
              label: 'Status',
              value: (x) => PNL_STATUS[x.tone === 'crit' ? 'crit' : x.tone === 'unknown' ? 'unknown' : 'ok'],
              translate: true,
              render: (x) =>
                x.tone === 'crit' ? <Chip tone="crit">Loss</Chip> : x.tone === 'unknown' ? <Chip tone="neutral">Unknown</Chip> : <Chip tone="ok">Profit</Chip>,
            },
          ]}
          filters={[
            { id: 'company', label: 'Company', value: (x) => x.companyName },
            { id: 'status', label: 'Status', value: (x) => (x.tone === 'crit' ? 'crit' : x.tone === 'unknown' ? 'unknown' : 'ok'), optionLabel: (v) => PNL_STATUS[v] ?? v },
          ]}
        />
      )}
      {tab === 'pay' && (
        <DataTable
          details
          label="Salary check"
          stateKey={`govops.${label}.pay`}
          rows={d.pay}
          rowKey={(p) => p.personId}
          searchPlaceholder="Find a guard, staff no. or site"
          searchText={(p) => p.staffNo ?? ''}
          columns={[
            {
              id: 'name',
              label: 'Guard',
              value: (p) => p.name,
              phone: 'title',
              render: (p) => (
                <>
                  <button style={LINK} onClick={() => openPerson(p.companyId, p.personId)}>
                    {p.name}
                  </button>
                  <div className="muted small">
                    {p.staffNo} · {p.companyName} · {p.siteName}
                  </div>
                </>
              ),
            },
            { id: 'days', label: 'Days', value: (p) => p.days, sort: 'number' },
            {
              id: 'hours',
              label: 'Hours / OT',
              value: (p) => p.normalHours,
              sort: 'number',
              hideBelow: 1100,
              phone: 'hidden',
              render: (p) => (
                <>
                  {p.normalHours} / {p.overtimeHours}
                  {p.otherSitesHours > 0 ? <div className="muted small">{p.hoursHere} h at these sites</div> : null}
                </>
              ),
            },
            {
              id: 'expected',
              label: 'Expected pay',
              value: (p) => p.expectedGross,
              sort: 'money',
              render: (p) => (
                <>
                  {rm(p.expectedGross)}
                  {p.overtimePay != null ? <div className="muted small">incl. OT {rm(p.overtimePay)}</div> : null}
                </>
              ),
            },
            {
              id: 'ja',
              label: 'JA pay',
              value: (p) => p.jaGross,
              sort: 'money',
              hideBelow: 1100,
              render: (p) => (
                <>
                  {p.jaGross == null ? <span className="muted">Not sent yet</span> : rm(p.jaGross)}
                  {p.jaOtHours != null ? <div className="muted small">OT {p.jaOtHours} h</div> : null}
                </>
              ),
            },
            {
              id: 'check',
              label: 'Check',
              value: (p) => (p.flags.length ? p.flags.join(' · ') : 'No issue in the hours'),
              translate: true,
              render: (p) =>
                p.flags.length ? (
                  p.flags.map((f) => (
                    <div key={f} className="small">
                      <Chip tone={p.tone === 'unknown' ? 'neutral' : 'warn'}>{f}</Chip>
                    </div>
                  ))
                ) : (
                  <Chip tone="ok">No issue in the hours</Chip>
                ),
            },
          ]}
          filters={[
            { id: 'company', label: 'Company', value: (p) => p.companyName },
            { id: 'site', label: 'Site', value: (p) => p.siteName },
            { id: 'flag', label: 'Check', value: (p) => (p.flags.length ? p.flags : ['No issue in the hours']) },
          ]}
        />
      )}
      {tab === 'leave' && (
        <DataTable
          details
          label="Guards on leave"
          stateKey={`govops.${label}.leave`}
          rows={d.leave}
          rowKey={(l) => l.id}
          searchPlaceholder="Find a guard or staff no."
          searchText={(l) => l.staffNo ?? ''}
          empty={<p className="muted small">Nobody on leave this month.</p>}
          columns={[
            {
              id: 'name',
              label: 'Guard',
              value: (l) => l.name,
              phone: 'title',
              render: (l) => (
                <>
                  <button style={LINK} onClick={() => openPerson(l.companyId, l.personId)}>
                    {l.name}
                  </button>
                  <div className="muted small">{l.staffNo}</div>
                </>
              ),
            },
            { id: 'company', label: 'Company', value: (l) => l.companyName, hideBelow: 1100 },
            { id: 'kind', label: 'Kind', value: (l) => LEAVE_KIND[l.kind] ?? l.kind, translate: true },
            { id: 'from', label: 'From', value: (l) => l.from, sort: 'date' },
            { id: 'to', label: 'To', value: (l) => l.to, sort: 'date', phone: 'hidden' },
            { id: 'days', label: 'Days', value: (l) => l.days, sort: 'number' },
            {
              id: 'status',
              label: 'Status',
              value: (l) => (l.onLeaveToday ? 'On leave today' : l.status === 'pending' ? 'Waiting for a decision' : 'Approved'),
              translate: true,
              render: (l) =>
                l.onLeaveToday ? <Chip tone="info">On leave today</Chip> : l.status === 'pending' ? <Chip tone="warn">Waiting for a decision</Chip> : <Chip tone="neutral">Approved</Chip>,
            },
          ]}
          filters={[
            { id: 'kind', label: 'Kind', value: (l) => l.kind, optionLabel: (v) => LEAVE_KIND[v] ?? v },
            { id: 'status', label: 'Status', value: (l) => (l.onLeaveToday ? 'On leave today' : l.status === 'pending' ? 'Waiting for a decision' : 'Approved') },
            { id: 'company', label: 'Company', value: (l) => l.companyName },
          ]}
        />
      )}
      {tab === 'clients' && (
        <>
          <DataTable
            details
            label="Client satisfaction"
            stateKey={`govops.${label}.clients`}
            rows={d.clients}
            rowKey={(c) => c.id}
            searchPlaceholder="Find a client or site"
            searchText={(c) => c.sites.join(' ')}
            empty={<p className="muted small">No clients recorded for these sites.</p>}
            rowTone={(c) => (c.tone === 'crit' ? 'crit' : c.tone === 'warn' ? 'warn' : undefined)}
            columns={[
              {
                id: 'name',
                label: 'Client',
                value: (c) => c.name,
                phone: 'title',
                render: (c) => (
                  <>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div className="muted small">{c.sites.join(', ')}</div>
                  </>
                ),
              },
              { id: 'company', label: 'Company', value: (c) => c.companyName, hideBelow: 1100 },
              {
                id: 'score',
                label: 'Score',
                value: (c) => c.score,
                sort: 'number',
                render: (c) => (
                  <span className="small">
                    {c.score != null ? `${c.score} of 5` : 'Not rated'}
                    {c.previous != null && c.score != null && c.previous !== c.score ? ` (was ${c.previous})` : ''}
                  </span>
                ),
              },
              {
                id: 'rated',
                label: 'Last rated',
                value: (c) => c.ratedOn,
                sort: 'date',
                render: (c) =>
                  c.ratedOn ? (
                    <span className="muted small">
                      {dateLabel(c.ratedOn)}
                      {c.ratedFrom ? ` by ${c.ratedFrom}` : ' (who at the client not recorded)'}
                    </span>
                  ) : (
                    '–'
                  ),
              },
              { id: 'issues', label: 'Issues', value: (c) => c.issues.map((i) => i.what).join(' · '), sort: false, hideBelow: 1280 },
              {
                id: 'tone',
                label: 'Status',
                value: (c) => CLIENT_TONE[c.tone] ?? 'In order',
                translate: true,
                render: (c) => (
                  <Chip tone={c.tone === 'crit' ? 'crit' : c.tone === 'warn' ? 'warn' : c.tone === 'unknown' ? 'neutral' : 'ok'}>{CLIENT_TONE[c.tone] ?? 'In order'}</Chip>
                ),
              },
            ]}
            filters={[
              { id: 'company', label: 'Company', value: (c) => c.companyName },
              { id: 'tone', label: 'Status', value: (c) => c.tone, optionLabel: (v) => CLIENT_TONE[v] ?? 'In order' },
            ]}
          />
          <p className="muted small">Ratings and complaints are recorded on the Clients screen by the Operations Managers, the Operations Director and officers.</p>
        </>
      )}
      {d.notes.map((n) => (
        <p key={n} className="muted small">
          {n}
        </p>
      ))}
    </>
  );
}
