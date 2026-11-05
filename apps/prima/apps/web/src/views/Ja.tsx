import { useState } from 'react';
import { api, type JaBoard } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, Sev, dateLabel, dateTimeLabel, useLoad, type Tone } from '../ui';

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
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="JA Group app data" />;
  const tabs: Tab[] = [...(data.syncs.length || data.datasets.length > 1 ? (['feed'] as Tab[]) : []), ...data.datasets.filter((d): d is Exclude<typeof d, 'paySummary'> => d !== 'paySummary')];
  const current = tab && tabs.includes(tab) ? tab : tabs[0];
  const stale = data.feeds.flatMap((f) => f.companies.filter((c) => c.state !== 'ok'));
  const openBig = data.incidents.filter((i) => i.status === 'open' && (i.severity === 'P1' || i.severity === 'P2')).length;
  return (
    <div className="page">
      <div className="page-head">
        <h1>JA Group app</h1>
        <p className="muted">
          Guards and officers use the JA Group app. Their payroll, foreign worker papers and incidents come here from its feed, read-only. A company with no
          data for over {data.rule.staleHours} hours shows as unknown.
        </p>
        <p className="notice" data-tone="info">
          Preview with test data: the JA feed is not live yet, so Prima's own foreign worker, incident, pay and hostel screens stay on until it is.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Feeds late or missing" value={stale.length} tone={stale.length ? 'unknown' : 'ok'} note="Company and dataset" />
        {data.datasets.includes('payroll') && (
          <Kpi
            label="Payroll not paid by the 7th"
            value={data.payroll.filter((p) => p.late).length + data.payrollMissing.length}
            tone={data.payroll.some((p) => p.late) || data.payrollMissing.length ? 'crit' : 'ok'}
            note="Last month"
          />
        )}
        {data.datasets.includes('worker') && (
          <Kpi
            label="Papers due"
            value={data.papers.length}
            tone={data.papers.length ? 'warn' : 'ok'}
            note={`Within ${data.rule.papersWarnDays} days, no renewal`}
          />
        )}
        {data.datasets.includes('incident') && <Kpi label="Open P1 or P2" value={openBig} tone={openBig ? 'crit' : 'ok'} />}
        {data.datasets.includes('guard') && (
          <Kpi label="Active guards" value={data.guards.reduce((n, g) => n + g.active, 0)} tone={data.guards.some((g) => g.stale) ? 'unknown' : 'ok'} note="From JA" />
        )}
        {data.datasets.includes('guard') && data.belowMinimumWage.length > 0 && (
          <Kpi label="Below minimum wage" value={data.belowMinimumWage.length} tone="crit" note="Basic pay in JA" />
        )}
      </div>
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

function FeedPanel({ data }: { data: JaBoard }) {
  return (
    <>
      {data.feeds.map((f) => {
        const bad = f.companies.filter((c) => c.state !== 'ok');
        return (
          <section key={f.dataset} className="panel">
            <div className="panel-head">
              <h3>{DATASET[f.dataset]}</h3>
              <Chip tone={bad.length ? 'unknown' : 'ok'}>{bad.length ? `${bad.length} unknown` : 'All companies current'}</Chip>
            </div>
            <div className="list">
              {bad.slice(0, 12).map((c) => (
                <div key={c.companyId} className="list-item">
                  <div>{c.companyName}</div>
                  <span className="muted small">{c.lastAt ? `last ${dateTimeLabel(c.lastAt)}` : 'nothing received'}</span>
                </div>
              ))}
              {bad.length > 12 && <div className="muted small">and {bad.length - 12} more</div>}
            </div>
          </section>
        );
      })}
      {data.syncs.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Deliveries</h3>
          </div>
          <div className="list">
            {data.syncs.map((s) => (
              <div key={s.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    {DATASET[s.dataset]} · {dateTimeLabel(s.at)}
                  </span>
                  <Chip tone={s.rejected.length ? 'warn' : 'ok'}>
                    {s.accepted} of {s.received} kept
                  </Chip>
                </div>
                {s.rejected.slice(0, 3).map((r) => (
                  <div key={r.externalId} className="muted small">
                    Refused {r.externalId}: {r.reason}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
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
          <section key={period} className="panel">
            <div className="panel-head">
              <h3>{period}</h3>
              <span className="muted small">
                {rows.reduce((n, r) => n + r.headcount, 0).toLocaleString()} paid · gross {rm(rows.reduce((n, r) => n + r.gross, 0))}
              </span>
            </div>
            <Contributions rows={rows} />
            <div className="list">
              {rows.map((p) => (
                <div key={p.id} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{p.companyName}</div>
                    <div className="muted small">
                      {p.headcount} people · gross {rm(p.gross)} · net {rm(p.net)} · employer EPF {rm(p.employerEpf)}
                      {p.approvedBy ? ` · approved by ${p.approvedBy}` : ''}
                      {p.paidOn ? ` · paid ${dateLabel(p.paidOn)}` : ''}
                    </div>
                  </div>
                  <Chip tone={p.late ? 'crit' : PAY[p.status][0]}>{p.late ? `Not paid by the ${data.rule.payrollByDay}th` : PAY[p.status][1]}</Chip>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function PapersPanel({ data }: { data: JaBoard }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Papers due within {data.rule.papersWarnDays} days, no renewal submitted</h3>
        <span className="muted small">{data.workers} workers on the feed</span>
      </div>
      <div className="list">
        {data.papers.length === 0 && <div className="empty">Nothing due.</div>}
        {data.papers.slice(0, 80).map((p) => (
          <div key={`${p.recordId}-${p.paper}`} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {p.name} · {p.staffNo}
              </div>
              <div className="muted small">
                {p.companyName} · {PAPER[p.paper]} {p.expiresOn ? `expires ${dateLabel(p.expiresOn)}` : 'no expiry date on record'}
                {p.status !== 'active' ? ` · ${p.status.replace('_', ' ')}` : ''}
              </div>
            </div>
            {p.stale ? (
              <Chip tone="unknown">Unknown, feed late</Chip>
            ) : (
              <Chip tone={p.daysLeft == null || p.daysLeft <= 7 ? 'crit' : 'warn'}>
                {p.daysLeft == null ? 'No date' : p.daysLeft < 0 ? `${-p.daysLeft} days expired` : `${p.daysLeft} days left`}
              </Chip>
            )}
          </div>
        ))}
        {data.papers.length > 80 && <div className="muted small">and {data.papers.length - 80} more</div>}
      </div>
    </section>
  );
}

function IncidentsPanel({ data }: { data: JaBoard }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Incidents from the JA app</h3>
        <span className="muted small">Reported, escalated and closed in the JA app</span>
      </div>
      <div className="list">
        {data.incidents.length === 0 && <div className="empty">No incidents received.</div>}
        {data.incidents.map((i) => (
          <div key={i.id} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {i.category} · {i.companyName}
                {i.siteCode ? ` · ${i.siteCode}` : ''}
              </div>
              <div className="muted small">
                {dateTimeLabel(i.occurredAt)} · {i.summary}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Sev s={i.severity} />
              <Chip tone={i.status === 'open' ? 'warn' : 'ok'}>{i.status === 'open' ? 'Open' : 'Closed'}</Chip>
            </div>
          </div>
        ))}
      </div>
    </section>
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
    <div className="table-wrap" style={{ marginBottom: 8 }}>
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
          <tr style={{ fontWeight: 700 }}>
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
      <section className="panel">
        <div className="panel-head">
          <h3>Guards by company</h3>
        </div>
        <div className="list">
          {data.guards.length === 0 && <div className="empty">No guard records received yet.</div>}
          {data.guards.map((g) => (
            <div key={g.companyId} className="list-item">
              <div>{g.companyName}</div>
              <span className="small">
                {g.active} active · {g.suspended} suspended · {g.left} left · {g.foreign} foreign {g.stale && <Chip tone="unknown">feed late</Chip>}
              </span>
            </div>
          ))}
        </div>
      </section>
      {data.belowMinimumWage.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Basic pay below the minimum wage</h3>
            <Chip tone="crit">{data.belowMinimumWage.length}</Chip>
          </div>
          <div className="list">
            {data.belowMinimumWage.map((g) => (
              <div key={`${g.companyId}-${g.staffNo}`} className="list-item">
                <div>
                  {g.name} <span className="muted small">{g.staffNo} · {g.companyName}</span>
                </div>
                <span className="small">
                  {rm(g.basicPay)} against {rm(g.minimum)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
