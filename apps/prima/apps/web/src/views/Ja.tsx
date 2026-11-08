import { useState } from 'react';
import { ArrowsClockwiseIcon, IdentificationCardIcon, MoneyIcon, SirenIcon, UsersThreeIcon, WarningIcon } from '@phosphor-icons/react';
import { api, type JaBoard } from '../api';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { Chip, ErrorNotice, Loading, Sev, dateLabel, dateTimeLabel, useLoad, type Tone } from '../ui';
import '../styles/biz.css';


/**
 * JA Group app data (Fauzan, 26 Oct 2026). Guards and officers stay on the JA Group app, which runs their payroll,
 * foreign worker papers and incidents. It sends that data here by API; Prima shows it read-only, and a company whose
 * feed is late shows as unknown, never as fine.
 */

type Tab = 'feed' | 'payroll' | 'worker' | 'incident' | 'guard';

const DATASET: Record<JaBoard['datasets'][number], string> = { payroll: 'Payroll', worker: 'Foreign workers', incident: 'Incidents', guard: 'Guards', paySummary: 'Guard pay' };
const PAY: Record<JaBoard['payroll'][number]['status'], [Tone, string]> = {
  draft: ['neutral', 'Draft'],
  approved: ['warn', 'Approved, not paid'],
  paid: ['ok', 'Paid'],
};
const PAPER: Record<JaBoard['papers'][number]['paper'], string> = {
  PLKS: 'PLKS permit',
  PASSPORT: 'Passport',
  FOMEMA: 'FOMEMA',
  FWIG: 'FW insurance',
  SPIKPA: 'SPIKPA',
  KDN_LETTER: 'KDN letter',
};
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function JaView() {
  const { data, error } = useLoad(() => api.jaBoard(), []);
  const [tab, setTab] = useState<Tab | null>(null);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="JA Group app data" />
      </div>
    );
  const tabs: Tab[] = [...(data.syncs.length || data.datasets.length > 1 ? (['feed'] as Tab[]) : []), ...data.datasets.filter((d): d is Exclude<typeof d, 'paySummary'> => d !== 'paySummary')];
  const current = tab && tabs.includes(tab) ? tab : tabs[0];
  const stale = data.feeds.flatMap((f) => f.companies.filter((c) => c.state !== 'ok'));
  const openBig = data.incidents.filter((i) => i.status === 'open' && (i.severity === 'P1' || i.severity === 'P2')).length;
  const go = (t: Tab) => (tabs.length > 1 && tabs.includes(t) ? () => setTab(t) : undefined);
  return (
    <div className="page bz-ja-page">
      <PageHead
        title="JA Group app"
        sub={`Guards and officers use the JA Group app. Their payroll, foreign worker papers and incidents come here from its feed, read-only. A company with no data for over ${data.rule.staleHours} hours shows as unknown. Nothing is added or changed here: correct a record in the JA Group app and it arrives with the next feed.`}
      >
        <p className="notice" data-tone="info">
          Preview with test data: the JA feed is not live yet, so Prima&apos;s own foreign worker, incident, pay and hostel screens stay on until it is.
        </p>
      </PageHead>
      <Stats>
        <Stat
          label="Feeds late or missing"
          value={stale.length}
          tone={stale.length ? 'unknown' : 'ok'}
          note="Company and dataset"
          icon={<ArrowsClockwiseIcon size={16} />}
          onClick={go('feed')}
        />
        {data.datasets.includes('payroll') && (
          <Stat
            label="Payroll not paid by the 7th"
            value={data.payroll.filter((p) => p.late).length + data.payrollMissing.length}
            tone={data.payroll.some((p) => p.late) || data.payrollMissing.length ? 'crit' : 'ok'}
            note="Last month"
            icon={<MoneyIcon size={16} />}
            onClick={go('payroll')}
          />
        )}
        {data.datasets.includes('worker') && (
          <Stat
            label="Papers due"
            value={data.papers.length}
            tone={data.papers.length ? 'warn' : 'ok'}
            note={`Within ${data.rule.papersWarnDays} days, no renewal`}
            icon={<IdentificationCardIcon size={16} />}
            onClick={go('worker')}
          />
        )}
        {data.datasets.includes('incident') && (
          <Stat label="Open P1 or P2" value={openBig} tone={openBig ? 'crit' : 'ok'} note="Serious incidents still open" icon={<SirenIcon size={16} />} onClick={go('incident')} />
        )}
        {data.datasets.includes('guard') && (
          <Stat
            label="Active guards"
            value={data.guards.reduce((n, g) => n + g.active, 0)}
            tone={data.guards.some((g) => g.stale) ? 'unknown' : 'ok'}
            note="From JA"
            icon={<UsersThreeIcon size={16} />}
            onClick={go('guard')}
          />
        )}
        {data.datasets.includes('guard') && data.belowMinimumWage.length > 0 && (
          <Stat label="Below minimum wage" value={data.belowMinimumWage.length} tone="crit" note="Basic pay in JA" icon={<WarningIcon size={16} />} onClick={go('guard')} />
        )}
      </Stats>
      {tabs.length > 1 && (
        <div className="tabbar" role="tablist" aria-label="JA data">
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={current === t} onClick={() => setTab(t)}>
              {t === 'feed' ? 'Feed' : DATASET[t]}
            </button>
          ))}
        </div>
      )}
      {current === 'feed' && <FeedPanel data={data} />}
      {current === 'payroll' && <PayrollPanel data={data} />}
      {current === 'worker' && <PapersPanel data={data} />}
      {current === 'incident' && <IncidentsPanel data={data} />}
      {current === 'guard' && <GuardsPanel data={data} />}
    </div>
  );
}

/** One health card per dataset (current, or which companies are late), then each delivery the JA app made. */
function FeedPanel({ data }: { data: JaBoard }) {
  return (
    <>
      <div className="bz-ja-feeds">
        {data.feeds.map((f) => {
          const bad = f.companies.filter((c) => c.state !== 'ok');
          return (
            <section key={f.dataset} className="k-card bz-ja-feed" data-state={bad.length ? 'unknown' : 'ok'}>
              <div className="bz-ja-feed-head">
                <span className="bz-ja-dot" aria-hidden="true" />
                <h2>{DATASET[f.dataset]}</h2>
                <Chip tone={bad.length ? 'unknown' : 'ok'}>{bad.length ? `${bad.length} unknown` : 'All companies current'}</Chip>
              </div>
              {bad.length > 0 && (
                <ul className="bz-ja-late">
                  {bad.slice(0, 12).map((c) => (
                    <li key={c.companyId}>
                      <span>{c.companyName}</span>
                      <span className="bz-sub">{c.lastAt ? `last ${dateTimeLabel(c.lastAt)}` : 'nothing received'}</span>
                    </li>
                  ))}
                  {bad.length > 12 && <li className="bz-sub">and {bad.length - 12} more</li>}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {data.syncs.length > 0 && (
        <Card title="Deliveries" sub="Each batch the JA app sent, and what Prima kept" flush>
          <ul className="bz-rows">
            {data.syncs.map((s) => (
              <li key={s.id} className="bz-row" data-tone={s.rejected.length ? 'warn' : undefined}>
                <span className="bz-row-main">
                  <span className="bz-row-title">{DATASET[s.dataset]}</span>
                  <span className="bz-row-meta">{dateTimeLabel(s.at)}</span>
                  {s.rejected.slice(0, 3).map((r) => (
                    <span key={r.externalId} className="bz-row-meta">
                      Refused {r.externalId}: {r.reason}
                    </span>
                  ))}
                </span>
                <span className="bz-row-side">
                  <Chip tone={s.rejected.length ? 'warn' : 'ok'}>
                    {s.accepted} of {s.received} kept
                  </Chip>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function PayrollPanel({ data }: { data: JaBoard }) {
  const periods = [...new Set(data.payroll.map((p) => p.period))];
  return (
    <>
      {data.payrollMissing.length > 0 && (
        <div className="notice" data-tone="crit">
          Not received for {data.payrollMissing[0].period}: {data.payrollMissing.map((m) => m.companyName).join(', ')}.
        </div>
      )}
      {periods.map((period) => {
        const rows = data.payroll.filter((p) => p.period === period);
        return (
          <Card
            key={period}
            title={period}
            sub={`${rows.reduce((n, r) => n + r.headcount, 0).toLocaleString()} paid · gross ${rm(rows.reduce((n, r) => n + r.gross, 0))}`}
            flush
          >
            <ul className="bz-rows">
              {rows.map((p) => (
                <li key={p.id} className="bz-row" data-tone={p.late ? 'crit' : undefined}>
                  <span className="bz-row-main">
                    <span className="bz-row-title">{p.companyName}</span>
                    <span className="bz-row-meta">
                      {p.headcount} people · net {rm(p.net)} · employer EPF {rm(p.employerEpf)}
                      {p.approvedBy ? ` · approved by ${p.approvedBy}` : ''}
                      {p.paidOn ? ` · paid ${dateLabel(p.paidOn)}` : ''}
                    </span>
                  </span>
                  <span className="bz-row-side">
                    <span className="bz-amt">{rm(p.gross)}</span>
                    <span className="bz-sub">gross</span>
                    <Chip tone={p.late ? 'crit' : PAY[p.status][0]}>{p.late ? `Not paid by the ${data.rule.payrollByDay}th` : PAY[p.status][1]}</Chip>
                  </span>
                </li>
              ))}
            </ul>
            <div className="bz-ja-contrib">
              <h3>SOCSO, LINDUNG and EIS</h3>
              <Contributions rows={rows} />
            </div>
          </Card>
        );
      })}
    </>
  );
}

function PapersPanel({ data }: { data: JaBoard }) {
  return (
    <Card
      title={`Papers due within ${data.rule.papersWarnDays} days, no renewal submitted`}
      sub={`${data.workers} workers on the feed`}
      actions={<span className="bz-count">{data.papers.length}</span>}
      flush
    >
      {data.papers.length === 0 ? (
        <Empty title="Nothing due." />
      ) : (
        <ul className="bz-rows">
          {data.papers.slice(0, 80).map((p) => (
            <li key={`${p.recordId}-${p.paper}`} className="bz-row" data-tone={!p.stale && (p.daysLeft == null || p.daysLeft <= 7) ? 'crit' : undefined}>
              <span className="bz-row-main">
                <span className="bz-row-title">
                  {p.name} <span className="muted small mono">{p.staffNo}</span>
                </span>
                <span className="bz-row-meta">
                  {p.companyName} · {PAPER[p.paper]} {p.expiresOn ? `expires ${dateLabel(p.expiresOn)}` : 'no expiry date on record'}
                  {p.status !== 'active' ? ` · ${p.status.replace('_', ' ')}` : ''}
                </span>
              </span>
              <span className="bz-row-side">
                {p.stale ? (
                  <Chip tone="unknown">Unknown, feed late</Chip>
                ) : (
                  <Chip tone={p.daysLeft == null || p.daysLeft <= 7 ? 'crit' : 'warn'}>
                    {p.daysLeft == null ? 'No date' : p.daysLeft < 0 ? `${-p.daysLeft} days expired` : `${p.daysLeft} days left`}
                  </Chip>
                )}
              </span>
            </li>
          ))}
          {data.papers.length > 80 && <li className="bz-ja-more">and {data.papers.length - 80} more</li>}
        </ul>
      )}
    </Card>
  );
}

function IncidentsPanel({ data }: { data: JaBoard }) {
  return (
    <Card title="Incidents from the JA app" sub="Reported, escalated and closed in the JA app" actions={<span className="bz-count">{data.incidents.length}</span>} flush>
      {data.incidents.length === 0 ? (
        <Empty title="No incidents received." />
      ) : (
        <ul className="bz-rows">
          {data.incidents.map((i) => (
            <li key={i.id} className="bz-row bz-ja-inc" data-tone={i.status === 'open' && (i.severity === 'P1' || i.severity === 'P2') ? 'crit' : undefined}>
              <span className="bz-ja-sev">
                <Sev s={i.severity} />
              </span>
              <span className="bz-row-main">
                <span className="bz-row-title">
                  {i.category} · {i.companyName}
                  {i.siteCode ? ` · ${i.siteCode}` : ''}
                </span>
                <span className="bz-row-meta">{i.summary}</span>
                <span className="bz-row-meta">{dateTimeLabel(i.occurredAt)}</span>
              </span>
              <span className="bz-row-side">
                <Chip tone={i.status === 'open' ? 'warn' : 'ok'}>{i.status === 'open' ? 'Open' : 'Closed'}</Chip>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Normal SOCSO and LINDUNG 24 Jam in separate columns, each with its own total (Fauzan, 27 Oct 2026). A figure the
 * JA app has not sent shows as not sent, never as zero.
 */
function Contributions({ rows }: { rows: JaBoard['payroll'] }) {
  const cell = (v: number | undefined) => (v == null ? <span className="muted">Not sent</span> : rm(v));
  const total = (k: 'employerSocso' | 'employeeSocso' | 'employeeLindung' | 'employerEis' | 'employeeEis') =>
    rows.some((r) => r[k] == null) ? <span className="muted">Incomplete</span> : rm(rows.reduce((n, r) => n + (r[k] ?? 0), 0));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th className="num">SOCSO employer</th>
            <th className="num">SOCSO employee</th>
            <th className="num">LINDUNG 24 Jam</th>
            <th className="num">EIS employer</th>
            <th className="num">EIS employee</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{p.companyName}</td>
              <td className="num">{cell(p.employerSocso)}</td>
              <td className="num">{cell(p.employeeSocso)}</td>
              <td className="num">{cell(p.employeeLindung)}</td>
              <td className="num">{cell(p.employerEis)}</td>
              <td className="num">{cell(p.employeeEis)}</td>
            </tr>
          ))}
          <tr className="bz-ja-total">
            <td>Total</td>
            <td className="num">{total('employerSocso')}</td>
            <td className="num">{total('employeeSocso')}</td>
            <td className="num">{total('employeeLindung')}</td>
            <td className="num">{total('employerEis')}</td>
            <td className="num">{total('employeeEis')}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Guards from JA (slice 3G, Fauzan 2 Nov 2026): each guard is keyed once in JA and filed here as the person record HR,
 * the company and Operations read. Full IC and salary account stay behind the HR wall.
 */
function GuardsPanel({ data }: { data: JaBoard }) {
  return (
    <>
      {data.belowMinimumWage.length > 0 && (
        <Card title="Basic pay below the minimum wage" actions={<Chip tone="crit">{data.belowMinimumWage.length}</Chip>} flush>
          <ul className="bz-rows">
            {data.belowMinimumWage.map((g) => (
              <li key={`${g.companyId}-${g.staffNo}`} className="bz-row" data-tone="crit">
                <span className="bz-row-main">
                  <span className="bz-row-title">{g.name}</span>
                  <span className="bz-row-meta">
                    {g.staffNo} · {g.companyName}
                  </span>
                </span>
                <span className="bz-row-side">
                  <span className="bz-amt">{rm(g.basicPay)}</span>
                  <span className="bz-sub">against {rm(g.minimum)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Guards by company" flush>
        {data.guards.length === 0 ? (
          <Empty title="No guard records received yet." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th className="num">Active</th>
                  <th className="num">Suspended</th>
                  <th className="num">Left</th>
                  <th className="num">Foreign</th>
                  <th>Feed</th>
                </tr>
              </thead>
              <tbody>
                {data.guards.map((g) => (
                  <tr key={g.companyId}>
                    <td>{g.companyName}</td>
                    <td className="num">{g.active}</td>
                    <td className="num">{g.suspended}</td>
                    <td className="num">{g.left}</td>
                    <td className="num">{g.foreign}</td>
                    <td>{g.stale ? <Chip tone="unknown">feed late</Chip> : <Chip tone="ok">Current</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
