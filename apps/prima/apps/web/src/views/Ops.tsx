import { Select } from '../SearchSelect';
import { useState } from 'react';
import { ClockCountdownIcon, FootprintsIcon, SirenIcon, UserCheckIcon, UserMinusIcon } from '@phosphor-icons/react';
import { api, type RegionalOps } from '../api';
import { useApp } from '../App';
import { SopHelp } from '../sop/SopHelp';
import { LeavePanel } from './Leave';
import { GovOpsMonitorPanel } from './GovOps';
import { ManagementFeeBillsPanel } from './ManagementFees';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { RecordButton } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import { Chip, ErrorNotice, Loading, dayLabel, hhmm, money, useLoad } from '../ui';
import '../styles/ops.css';
import { VacanciesPanel } from './HrJoinLeave';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';

type Item = RegionalOps['attention'][number];
type CompanyRow = RegionalOps['rows'][number];
type Officer = RegionalOps['patrolOfficers'][number];

const KIND_LABEL: Record<Item['kind'], string> = { no_show: 'No-show', unfilled: 'No guard', patrol: 'Patrol', case: 'Case' };

/**
 * Regional operations board (Fauzan, 24 Oct 2026). A Regional Operations Manager covers every
 * company with sites in the region and follows up; each company still decides its own rosters.
 */
export function OpsView() {
  const { me, setCompanyId, go } = useApp();
  const [region, setRegion] = useState<string | undefined>(undefined);
  const { data, error } = useLoad(() => api.regionalOps(region), [region]);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="regional operations" />
      </div>
    );
  const t = data.totals;
  const openSite = (companyId: string, siteId: string | null) => {
    setCompanyId(companyId);
    go(siteId ? { view: 'sites', siteId } : { view: 'sites' });
  };
  const openItem = (a: Item) => {
    if (a.caseId) {
      setCompanyId(a.companyId);
      go({ view: 'cases', caseId: a.caseId });
    } else openSite(a.companyId, a.siteId);
  };
  const crit = data.attention.filter((a) => a.tone === 'crit').length;
  const detailed = data.rows.filter((r) => r.hasDetail);
  return (
    <div className="page">
      {data.reminders.map((r) => (
        <p key={r.title} className="notice" data-tone={r.tone === 'crit' ? 'crit' : 'warn'}>
          <strong>{r.title}.</strong> {r.detail}{' '}
          <button className="btn btn-sm" onClick={() => go({ view: 'sitehours' })}>
            Open
          </button>
        </p>
      ))}
      <PageHead
        title={
          <>
            Operations, {data.region.id === 'all' ? 'nationwide' : me.user.opsTier === 'om' ? data.region.name : `${data.region.name} region`}
            {data.sector ? `, ${data.sector === 'government' ? 'government' : 'private'}-sector sites` : ''}
          </>
        }
        sub={
          <>
            {data.region.id === 'all' ? 'Every company, every region' : `Every company with sites in ${data.region.states.join(', ')}`}
            {data.sector ? `, ${data.sector} sector only` : ''}. You see and follow up; each company decides its own rosters.{' '}
            {data.regions.length > 1 ? 'Pick a region to narrow the board.' : ''}
          </>
        }
        actions={
          <>
            {data.regions.length > 1 && (
              <Select className="select op-filter" aria-label="Region" value={data.region.id} onChange={(e) => setRegion(e.target.value)}>
                {data.regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            )}
            {/* P91: sites are added here too, for those who may add them (the form and the server check it). */}
            <SopHelp id="ops" />
            <ImportButton kind="site" label="Import sites" />
            <RecordButton kind="site" label="Add site" primary />
          </>
        }
      />

      <Stats>
        <Stat label="On duty now" value={t.onDuty} note={`${t.shiftsToday} shifts today, ${t.sites} sites`} icon={<UserCheckIcon size={16} />} tone="info" />
        <Stat label="No-shows" value={t.noShow} tone={t.noShow ? 'crit' : 'ok'} note={t.late ? `${t.late} came late` : undefined} icon={<UserMinusIcon size={16} />} />
        <Stat
          label="Shifts with no guard"
          value={t.unfilledToday}
          tone={t.unfilledToday ? 'warn' : 'ok'}
          note={`${t.unfilledNext7} in next 7 days`}
          icon={<ClockCountdownIcon size={16} />}
        />
        <Stat
          label="Sites with patrol gaps"
          value={t.patrolMissedSites}
          tone={t.patrolMissedSites ? 'warn' : 'ok'}
          note={`No NFC tap for ${data.patrolGapMin / 60}+ hours`}
          icon={<FootprintsIcon size={16} />}
        />
        <Stat
          label="Open cases"
          value={t.openCases}
          tone={t.p1Open ? 'crit' : t.openCases ? 'warn' : 'ok'}
          note={t.p1Open ? `${t.p1Open} P1` : undefined}
          icon={<SirenIcon size={16} />}
        />
      </Stats>

      <Card
        title="Needs follow-up now"
        sub="Most urgent first. Open one to go to the site or the case."
        actions={<Chip tone={crit ? 'crit' : data.attention.length ? 'warn' : 'ok'}>{data.attention.length}</Chip>}
        flush
      >
        {/* P107: the follow-up list as a data table: every item (no first-30 cap), most urgent first, by kind, company or urgency. */}
        <DataTable
          label="Needs follow-up now"
          stateKey="ops.attention"
          rows={data.attention}
          rowKey={(a) => `${a.kind}:${a.caseId ?? ''}:${a.siteId ?? ''}:${a.at}:${a.title}`}
          columns={ATTENTION_COLUMNS}
          filters={ATTENTION_FILTERS}
          rowTone={(a) => (a.tone === 'crit' ? 'crit' : a.tone === 'warn' ? 'warn' : undefined)}
          onView={openItem}
          searchPlaceholder="Find a site, company or item"
          empty={<Empty title="Nothing needs follow-up in this region right now." />}
        />
      </Card>

      <Card
        title="Companies in the region"
        sub="Open a company to see its sites"
        actions={t.unknownCompanies > 0 && <Chip tone="neutral">{t.unknownCompanies} without data yet</Chip>}
        flush
      >
        {/* P107: the companies as a data table: sort by any figure, find a company, pages when the region grows. */}
        <DataTable
          label="Companies in the region"
          stateKey="ops.companies"
          rows={detailed}
          rowKey={(r) => r.company.id}
          columns={COMPANY_COLUMNS}
          onView={(r) => openSite(r.company.id, null)}
          searchPlaceholder="Find a company"
        />
        {/* P80: the companies with no data by name, not by code (C04, C05), below the table so a phone does not
            scroll sideways to read them; the list opens on request. */}
        {t.unknownCompanies > 0 && (
          <details className="op-unknown muted small">
            <summary>
              {t.unknownCompanies} {t.unknownCompanies === 1 ? 'company has' : 'companies have'} no site data in Prima yet, so their numbers are unknown
            </summary>
            <p>
              {data.rows
                .filter((r) => !r.hasDetail)
                .map((r) => r.company.name)
                .join(', ')}
            </p>
          </details>
        )}
      </Card>

      <div className="op-stack">
        <Card title="Shifts with no guard, next 7 days" sub="The company fills them; you chase" flush>
          <div className="table-wrap">
            <table className="ro-heat op-sticky-first">
              <thead>
                <tr>
                  <th>Company</th>
                  {data.days.map((d) => (
                    <th key={d} className="num">
                      {dayLabel(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detailed.map((r) => (
                  <tr key={r.company.id}>
                    <td className="op-heat-co" title={r.company.name}>
                      {r.company.name}
                    </td>
                    {r.unfilledByDay.map((v, i) => (
                      <Num key={i} v={v} tone="warn" />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Patrolling officers" sub={`At most ${data.patrolSpanMax} guards each; the company changes the patrol areas`} flush>
          {/* P107: the officers as a data table: find one, see who is over the limit, by employer. */}
          <DataTable
            details
            label="Patrolling officers"
            stateKey="ops.officers"
            rows={data.patrolOfficers}
            rowKey={(p) => p.userId}
            columns={OFFICER_COLUMNS}
            filters={OFFICER_FILTERS}
            rowTone={(p) => (p.over ? 'warn' : undefined)}
            searchPlaceholder="Find an officer"
            empty={<Empty title="No patrolling officers set up for this region." />}
          />
        </Card>
      </div>

      <LeavePanel title="Leave and absence requests from guards and officers" />
      {(me.user.opsTier === 'om' || me.user.opsTier === 'regional') && <VacanciesPanel />}

      {data.sector !== 'private' && <GovOpsMonitorPanel sector="government" />}
      {data.sector !== 'government' && <GovOpsMonitorPanel sector="private" />}
      {(me.user.opsTier === 'ogm' || me.user.opsTier === 'ops_director' || me.user.opsTier === 'coo') && <ManagementFeeBillsPanel />}
    </div>
  );
}

const TONE_LABEL: Record<string, string> = { crit: 'Urgent', warn: 'Follow up', ok: 'Fine', info: 'For information', neutral: 'For information' };

/** P107: the follow-up items' columns (the old row: kind chip, title, site and detail, company, time). */
const ATTENTION_COLUMNS: DtColumn<Item>[] = [
  { id: 'kind', label: 'Kind', value: (a) => KIND_LABEL[a.kind], translate: true, render: (a) => <Chip tone={a.tone}>{KIND_LABEL[a.kind]}</Chip>, phone: 'hidden', width: '7rem' },
  { id: 'title', label: 'What', value: (a) => a.title, phone: 'title', render: (a) => <span className="op-title">{a.title}</span> },
  { id: 'detail', label: 'Site and detail', value: (a) => `${a.siteName ? `${a.siteName} · ` : ''}${a.detail}`, phone: 'sub' },
  { id: 'company', label: 'Company', value: (a) => a.companyName, hideBelow: 1100 },
  { id: 'at', label: 'Time', value: (a) => (a.kind !== 'patrol' ? a.at : ''), sort: 'date', render: (a) => (a.kind !== 'patrol' ? hhmm(a.at) : '–'), width: '6rem' },
];
const ATTENTION_FILTERS: DtFilter<Item>[] = [
  { id: 'kind', label: 'Kind', value: (a) => a.kind, options: Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })) },
  { id: 'company', label: 'Company', value: (a) => a.companyName },
  { id: 'tone', label: 'Urgency', value: (a) => a.tone, optionLabel: (v) => TONE_LABEL[v] ?? v },
];

type Fig = (r: CompanyRow) => number;
type Detailed = Extract<CompanyRow, { hasDetail: true }>;
const n = (get: (r: Detailed) => number): Fig => (r) => (r.hasDetail ? get(r) : 0);
/** A figure cell coloured when it is not zero (the old <Num>). */
const fig = (id: string, label: string, get: Fig, tone: (r: CompanyRow) => 'crit' | 'warn', hideBelow?: number): DtColumn<CompanyRow> => ({
  id,
  label,
  value: get,
  sort: 'number',
  hideBelow,
  render: (r) => (
    <span className="op-num" data-tone={get(r) ? tone(r) : undefined}>
      {get(r)}
    </span>
  ),
});
/** P107: the companies' columns: the old eight; the less urgent ones leave narrower screens first. */
const COMPANY_COLUMNS: DtColumn<CompanyRow>[] = [
  {
    id: 'company',
    label: 'Company',
    value: (r) => r.company.name,
    phone: 'title',
    render: (r) => (
      <div className="op-company">
        {r.company.name}
        <span>{n((x) => x.sites)(r)} sites in region</span>
      </div>
    ),
  },
  { id: 'sites', label: 'Sites', value: n((r) => r.sites), sort: 'number', hideBelow: 900, phone: 'hidden' },
  { id: 'onDuty', label: 'On duty', value: n((r) => r.onDuty), sort: 'number' },
  fig('noShow', 'No-show', n((r) => r.noShow), () => 'crit'),
  fig('unfilled', 'No guard', n((r) => r.unfilledToday), () => 'warn'),
  fig('patrol', 'Patrol gaps', n((r) => r.patrolMissedSites), () => 'warn', 900),
  fig('cases', 'Open cases', n((r) => r.openCases), (r) => (r.hasDetail && r.p1Open ? 'crit' : 'warn'), 900),
  fig('blocked', 'Not allowed to work (7 days)', n((r) => r.blockedNext7), () => 'crit', 900),
];

/** P107: the patrolling officers' columns (the old row: name, employer and sites, salary shares, guards chip). */
const OFFICER_COLUMNS: DtColumn<Officer>[] = [
  { id: 'name', label: 'Name', value: (p) => p.name, phone: 'title', render: (p) => <span className="op-title">{p.name}</span> },
  { id: 'employer', label: 'Employer', value: (p) => `${p.employer}${p.alsoFor.length ? `, also works for ${p.alsoFor.join(', ')}` : ''}`, phone: 'sub' },
  { id: 'sites', label: 'Sites', value: (p) => p.sites, sort: 'number' },
  {
    id: 'guards',
    label: 'Guards',
    value: (p) => p.guards,
    sort: 'number',
    align: 'left',
    render: (p) => (
      <Chip tone={p.over ? 'warn' : 'ok'}>
        {p.guards} / {p.max} guards{p.over ? ', over limit' : ''}
      </Chip>
    ),
  },
  {
    id: 'shares',
    label: 'Salary shared by guards',
    value: (p) => p.shares.map((x) => `${x.company.split(' ')[0]} ${x.pct}%${x.amount != null ? ` (${money(x.amount)})` : ''}`).join(', '),
    sort: false,
    hideBelow: 1100,
  },
];
const OFFICER_FILTERS: DtFilter<Officer>[] = [
  { id: 'over', label: 'Limit', value: (p) => (p.over ? 'over' : 'within'), options: [{ value: 'over', label: 'Over the limit' }, { value: 'within', label: 'Within the limit' }] },
  { id: 'employer', label: 'Employer', value: (p) => p.employer },
];

function Num({ v, tone, hide }: { v: number; tone: 'crit' | 'warn'; hide?: boolean }) {
  return (
    <td className={`num op-num${hide ? ' hide-sm' : ''}`} data-tone={v ? tone : undefined}>
      {v}
    </td>
  );
}
