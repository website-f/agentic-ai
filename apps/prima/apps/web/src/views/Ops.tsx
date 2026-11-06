import { useState } from 'react';
import { ClockCountdownIcon, FootprintsIcon, SirenIcon, UserCheckIcon, UserMinusIcon } from '@phosphor-icons/react';
import { api, type RegionalOps } from '../api';
import { useApp } from '../App';
import { LeavePanel } from './Leave';
import { GovOpsMonitorPanel } from './GovOps';
import { ManagementFeeBillsPanel } from './ManagementFees';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { Chip, ErrorNotice, Loading, dayLabel, hhmm, money, useLoad } from '../ui';
import '../styles/ops.css';

type Item = RegionalOps['attention'][number];

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
          data.regions.length > 1 && (
            <select className="select op-filter" aria-label="Region" value={data.region.id} onChange={(e) => setRegion(e.target.value)}>
              {data.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )
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
        {data.attention.length === 0 && <Empty title="Nothing needs follow-up in this region right now." />}
        <ul className="op-list">
          {data.attention.slice(0, 30).map((a, i) => (
            <li key={i}>
              <button className="op-item ro-row" data-tone={a.tone} onClick={() => openItem(a)}>
                <span className="ro-kind">
                  <Chip tone={a.tone}>{KIND_LABEL[a.kind]}</Chip>
                </span>
                <span className="op-main">
                  <span className="op-title">{a.title}</span>
                  <span className="op-meta">
                    {a.siteName ? `${a.siteName} · ` : ''}
                    {a.detail}
                  </span>
                  <span className="op-co">{a.companyName}</span>
                </span>
                <span className="ro-when op-time">{a.kind !== 'patrol' ? hhmm(a.at) : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Companies in the region"
        sub="Open a company to see its sites"
        actions={t.unknownCompanies > 0 && <Chip tone="neutral">{t.unknownCompanies} without data yet</Chip>}
        flush
      >
        <div className="table-wrap">
          <table className="op-sticky-first">
            <thead>
              <tr>
                <th>Company</th>
                <th className="num hide-sm">Sites</th>
                <th className="num">On duty</th>
                <th className="num">No-show</th>
                <th className="num">No guard</th>
                <th className="num hide-sm">Patrol gaps</th>
                <th className="num hide-sm">Open cases</th>
                <th className="num hide-sm">Not allowed to work (7 days)</th>
              </tr>
            </thead>
            <tbody>
              {detailed.map((r) => (
                <tr key={r.company.id} className="clickable" onClick={() => openSite(r.company.id, null)}>
                  <td>
                    <div className="op-company">
                      {r.company.name}
                      <span>{r.sites} sites in region</span>
                    </div>
                  </td>
                  <td className="num hide-sm">{r.sites}</td>
                  <td className="num">{r.onDuty}</td>
                  <Num v={r.noShow} tone="crit" />
                  <Num v={r.unfilledToday} tone="warn" />
                  <Num v={r.patrolMissedSites} tone="warn" hide />
                  <Num v={r.openCases} tone={r.p1Open ? 'crit' : 'warn'} hide />
                  <Num v={r.blockedNext7} tone="crit" hide />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          {data.patrolOfficers.length === 0 && <Empty title="No patrolling officers set up for this region." />}
          <ul className="op-list">
            {data.patrolOfficers.map((p) => (
              <li key={p.userId} className="op-item">
                <div className="op-line">
                  <div className="op-main">
                    <span className="op-title">{p.name}</span>
                    <span className="op-meta">
                      {p.employer}
                      {p.alsoFor.length ? `, also works for ${p.alsoFor.join(', ')}` : ''} · {p.sites} sites
                    </span>
                    {p.shares.length > 0 && (
                      <span className="op-co">
                        Salary shared by guards:{' '}
                        {p.shares.map((x) => `${x.company.split(' ')[0]} ${x.pct}%${x.amount != null ? ` (${money(x.amount)})` : ''}`).join(', ')}
                      </span>
                    )}
                  </div>
                  <Chip tone={p.over ? 'warn' : 'ok'}>
                    {p.guards} / {p.max} guards{p.over ? ', over limit' : ''}
                  </Chip>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <LeavePanel title="Leave and absence requests from guards and officers" />

      {data.sector !== 'private' && <GovOpsMonitorPanel sector="government" />}
      {data.sector !== 'government' && <GovOpsMonitorPanel sector="private" />}
      {(me.user.opsTier === 'ogm' || me.user.opsTier === 'ops_director' || me.user.opsTier === 'coo') && <ManagementFeeBillsPanel />}
    </div>
  );
}

function Num({ v, tone, hide }: { v: number; tone: 'crit' | 'warn'; hide?: boolean }) {
  return (
    <td className={`num op-num${hide ? ' hide-sm' : ''}`} data-tone={v ? tone : undefined}>
      {v}
    </td>
  );
}
