import { useState } from 'react';
import { api, type RegionalOps } from '../api';
import { useApp } from '../App';
import { LeavePanel } from './Leave';
import { Chip, ErrorNotice, Kpi, Loading, dayLabel, hhmm, useLoad } from '../ui';

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
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Operations, {data.region.id === 'all' ? 'nationwide' : me.user.opsTier === 'om' ? data.region.name : `${data.region.name} region`}
            {data.sector ? `, ${data.sector === 'government' ? 'government' : 'private'}-sector sites` : ''}
          </h1>
          <p>
            {data.region.id === 'all' ? 'Every company, every region' : `Every company with sites in ${data.region.states.join(', ')}`}
            {data.sector ? `, ${data.sector} sector only` : ''}. You see and follow up; each company decides its own rosters.{' '}
            {data.regions.length > 1 ? 'Pick a region to narrow the board.' : ''}
          </p>
        </div>
        {data.regions.length > 1 && (
          <select className="select" aria-label="Region" value={data.region.id} onChange={(e) => setRegion(e.target.value)} style={{ width: 'auto' }}>
            {data.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="kpis">
        <Kpi label="On duty now" value={t.onDuty} note={`${t.shiftsToday} shifts today, ${t.sites} sites`} />
        <Kpi label="No-shows" value={t.noShow} tone={t.noShow ? 'crit' : 'ok'} note={t.late ? `${t.late} came late` : undefined} />
        <Kpi label="Shifts with no guard" value={t.unfilledToday} tone={t.unfilledToday ? 'warn' : 'ok'} note={`${t.unfilledNext7} in next 7 days`} />
        <Kpi
          label="Sites with patrol gaps"
          value={t.patrolMissedSites}
          tone={t.patrolMissedSites ? 'warn' : 'ok'}
          note={`No NFC tap for ${data.patrolGapMin / 60}+ hours`}
        />
        <Kpi label="Open cases" value={t.openCases} tone={t.p1Open ? 'crit' : t.openCases ? 'warn' : 'ok'} note={t.p1Open ? `${t.p1Open} P1` : undefined} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Needs follow-up now</h2>
          <Chip tone={crit ? 'crit' : data.attention.length ? 'warn' : 'ok'}>{data.attention.length}</Chip>
        </div>
        <div className="list">
          {data.attention.length === 0 && <div className="empty">Nothing needs follow-up in this region right now.</div>}
          {data.attention.slice(0, 30).map((a, i) => (
            <button key={i} className="list-item" onClick={() => openItem(a)}>
              <div>
                <div style={{ fontWeight: 600 }}>{a.title}</div>
                <div className="muted small">
                  {a.siteName ? `${a.siteName} · ` : ''}
                  {a.detail}
                </div>
                <div className="small">{a.companyName}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <Chip tone={a.tone}>{KIND_LABEL[a.kind]}</Chip>
                {a.kind !== 'patrol' && <span className="mono small muted">{hhmm(a.at)}</span>}
              </div>
            </button>
          ))}
        </div>
      </section>

      <LeavePanel title="Leave and absence requests from guards and officers" />

      <section className="panel">
        <div className="panel-head">
          <h2>Companies in the region</h2>
          {t.unknownCompanies > 0 && <Chip tone="neutral">{t.unknownCompanies} without data yet</Chip>}
        </div>
        <div className="table-wrap">
          <table>
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
              {data.rows.map(
                (r) =>
                  r.hasDetail && (
                    <tr key={r.company.id} className="clickable" onClick={() => openSite(r.company.id, null)}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.company.name}</div>
                        <div className="muted small">{r.sites} sites in region</div>
                      </td>
                      <td className="num hide-sm">{r.sites}</td>
                      <td className="num">{r.onDuty}</td>
                      <Num v={r.noShow} tone="crit" />
                      <Num v={r.unfilledToday} tone="warn" />
                      <Num v={r.patrolMissedSites} tone="warn" hide />
                      <Num v={r.openCases} tone={r.p1Open ? 'crit' : 'warn'} hide />
                      <Num v={r.blockedNext7} tone="crit" hide />
                    </tr>
                  ),
              )}
              {t.unknownCompanies > 0 && (
                <tr>
                  <td colSpan={8} className="muted small">
                    Unknown, site data not loaded yet:{' '}
                    {data.rows
                      .filter((r) => !r.hasDetail)
                      .map((r) => r.company.code)
                      .join(', ')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Patrolling officers</h2>
          <span className="muted small">At most {data.patrolSpanMax} guards each; the company changes the patrol areas</span>
        </div>
        <div className="list">
          {data.patrolOfficers.length === 0 && <div className="empty">No patrolling officers set up for this region.</div>}
          {data.patrolOfficers.map((p) => (
            <div key={p.userId} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div className="muted small">
                  {p.employer}
                  {p.alsoFor.length ? `, also works for ${p.alsoFor.join(', ')}` : ''} · {p.sites} sites
                </div>
                {p.shares.length > 0 && (
                  <div className="small">
                    Salary shared by guards:{' '}
                    {p.shares.map((x) => `${x.company.split(' ')[0]} ${x.pct}%${x.amount != null ? ` (RM${x.amount.toFixed(2)})` : ''}`).join(', ')}
                  </div>
                )}
              </div>
              <Chip tone={p.over ? 'warn' : 'ok'}>
                {p.guards} / {p.max} guards{p.over ? ', over limit' : ''}
              </Chip>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Shifts with no guard, next 7 days</h2>
          <span className="muted small">The company fills them; you chase</span>
        </div>
        <div className="table-wrap">
          <table>
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
              {data.rows.map(
                (r) =>
                  r.hasDetail && (
                    <tr key={r.company.id}>
                      <td>{r.company.code}</td>
                      {r.unfilledByDay.map((v, i) => (
                        <Num key={i} v={v} tone="warn" />
                      ))}
                    </tr>
                  ),
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Num({ v, tone, hide }: { v: number; tone: 'crit' | 'warn'; hide?: boolean }) {
  return (
    <td className={`num${hide ? ' hide-sm' : ''}`} style={v ? { color: `var(--${tone})`, fontWeight: 600 } : undefined}>
      {v}
    </td>
  );
}
