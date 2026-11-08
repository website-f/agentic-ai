import { useState } from 'react';
import { api, type GovOpsMonitor } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useLoad } from '../ui';

type Tab = 'pnl' | 'pay' | 'leave' | 'clients';
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
        <select className="select" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }}>
          {months(today).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
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
      {tab === 'pnl' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Site</th>
                <th className="num">Income</th>
                <th className="num hide-sm">Guard pay</th>
                <th className="num">Salary cost – cash payment</th>
                <th className="num hide-sm">EPF, SOCSO, EIS, levy</th>
                <th className="num hide-sm">Hostel</th>
                <th className="num hide-sm">Goodwill items</th>
                <th className="num hide-sm">Management fee</th>
                <th className="num">Margin</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {d.sites.map((x) => (
                <tr key={x.siteId}>
                  <td>
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
                  </td>
                  <td className="num">
                    {rm(x.revenue)}
                    {x.revenueBasis ? <div className="muted small">{x.revenueBasis === 'invoice' ? 'invoiced' : 'contract value'}</div> : null}
                  </td>
                  <td className="num hide-sm">{rm(x.guardCost)}</td>
                  <td className="num">{rm(x.cashPayroll)}{x.cashPayrollPending > 0 && <div className="muted small">{rm(x.cashPayrollPending)} awaiting accounting</div>}<div className="muted small">{x.cashPayrollTrace.map(r => `${r.id}: ${r.journalRef}`).join("; ")}</div></td>
                  <td className="num hide-sm">{rm(x.statutory)}</td>
                  <td className="num hide-sm">{rm(x.hostel)}</td>
                  <td className="num hide-sm">{rm(x.itemCharges)}</td>
                  <td className="num hide-sm">{rm(x.managementFee)}</td>
                  <td className="num">
                    {rm(x.margin)}
                    {x.marginPct != null ? <div className="muted small">{x.marginPct}%</div> : null}
                  </td>
                  <td>
                    {x.tone === 'crit' ? (
                      <Chip tone="crit">Loss</Chip>
                    ) : x.tone === 'unknown' ? (
                      <Chip tone="neutral">Unknown</Chip>
                    ) : (
                      <Chip tone="ok">Profit</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'pay' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Guard</th>
                <th className="num">Days</th>
                <th className="num hide-sm">Hours / OT</th>
                <th className="num">Expected pay</th>
                <th className="num hide-sm">JA pay</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {d.pay.map((p) => (
                <tr key={p.personId}>
                  <td>
                    <button style={LINK} onClick={() => openPerson(p.companyId, p.personId)}>
                      {p.name}
                    </button>
                    <div className="muted small">
                      {p.staffNo} · {p.companyName} · {p.siteName}
                    </div>
                  </td>
                  <td className="num">{p.days}</td>
                  <td className="num hide-sm">
                    {p.normalHours} / {p.overtimeHours}
                    {p.otherSitesHours > 0 ? <div className="muted small">{p.hoursHere} h at these sites</div> : null}
                  </td>
                  <td className="num">
                    {rm(p.expectedGross)}
                    {p.overtimePay != null ? <div className="muted small">incl. OT {rm(p.overtimePay)}</div> : null}
                  </td>
                  <td className="num hide-sm">
                    {p.jaGross == null ? <span className="muted">Not sent yet</span> : rm(p.jaGross)}
                    {p.jaOtHours != null ? <div className="muted small">OT {p.jaOtHours} h</div> : null}
                  </td>
                  <td>
                    {p.flags.length ? (
                      p.flags.map((f) => (
                        <div key={f} className="small">
                          <Chip tone={p.tone === 'unknown' ? 'neutral' : 'warn'}>{f}</Chip>
                        </div>
                      ))
                    ) : (
                      <Chip tone="ok">No issue in the hours</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'leave' && (
        <div className="list">
          {d.leave.length === 0 && <p className="muted small">Nobody on leave this month.</p>}
          {d.leave.map((l) => (
            <div key={l.id} className="list-item" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <button style={LINK} onClick={() => openPerson(l.companyId, l.personId)}>
                  {l.name}
                </button>
                <div className="muted small">
                  {l.staffNo} · {l.companyName} · {LEAVE_KIND[l.kind] ?? l.kind} · {dateLabel(l.from)} to {dateLabel(l.to)} ({l.days} days)
                </div>
              </div>
              {l.onLeaveToday ? (
                <Chip tone="info">On leave today</Chip>
              ) : l.status === 'pending' ? (
                <Chip tone="warn">Waiting for a decision</Chip>
              ) : (
                <Chip tone="neutral">Approved</Chip>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'clients' && (
        <div className="list">
          {d.clients.length === 0 && <p className="muted small">No clients recorded for these sites.</p>}
          {d.clients.map((c) => (
            <div key={c.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div className="muted small">
                    {c.companyName} · {c.sites.join(', ')}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <span className="small">
                    {c.score != null ? `${c.score} of 5` : 'Not rated'}
                    {c.previous != null && c.score != null && c.previous !== c.score ? ` (was ${c.previous})` : ''}
                  </span>
                  <Chip tone={c.tone === 'crit' ? 'crit' : c.tone === 'warn' ? 'warn' : c.tone === 'unknown' ? 'neutral' : 'ok'}>
                    {c.tone === 'crit' ? 'Needs attention' : c.tone === 'warn' ? 'Follow up' : c.tone === 'unknown' ? 'Unknown' : 'In order'}
                  </Chip>
                </div>
              </div>
              {c.ratedOn && (
                <div className="muted small">
                  Last rated {dateLabel(c.ratedOn)}
                  {c.ratedFrom ? ` by ${c.ratedFrom}` : ' (who at the client not recorded)'}
                </div>
              )}
              {c.issues.length > 0 && <div className="small">{c.issues.map((i) => i.what).join(' · ')}</div>}
            </div>
          ))}
          <p className="muted small">Ratings and complaints are recorded on the Clients screen by the Operations Managers, the Operations Director and officers.</p>
        </div>
      )}
      {d.notes.map((n) => (
        <p key={n} className="muted small">
          {n}
        </p>
      ))}
    </>
  );
}
