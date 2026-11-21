import { useState } from 'react';
import { SopHelp } from '../sop/SopHelp';
import { ArrowsClockwiseIcon, IdentificationCardIcon, MoneyIcon, SirenIcon, UsersThreeIcon, WarningIcon } from '@phosphor-icons/react';
import { api, type JaBoard } from '../api';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { Chip, ErrorNotice, Loading, Sev, dateLabel, dateTimeLabel, useLoad, type Tone } from '../ui';
import { DataTable, type DtColumn } from '../DataTable';
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
        actions={<SopHelp id="it-ja-feed" />}
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
        <Card title="Deliveries" sub="Each batch the JA app sent, and what Prima kept">
          <DataTable
            label="Deliveries"
            stateKey="it.ja.deliveries"
            rows={data.syncs}
            rowKey={(s) => s.id}
            columns={SYNC_COLUMNS}
            filters={[
              { id: 'dataset', label: 'Dataset', value: (s) => s.dataset, optionLabel: (k) => DATASET[k as Dataset] ?? k },
              { id: 'refused', label: 'Refused', value: (s) => (s.rejected.length ? 'yes' : 'no'), options: [{ value: 'yes', label: 'Some refused' }, { value: 'no', label: 'All kept' }] },
            ]}
            searchText={(s) => s.rejected.map((r) => `${r.externalId} ${r.reason}`).join(' ')}
            rowTone={(s) => (s.rejected.length ? 'warn' : undefined)}
          />
        </Card>
      )}
    </>
  );
}

type Dataset = JaBoard['datasets'][number];
/** P107: the JA app's deliveries as a table. */
const SYNC_COLUMNS: DtColumn<JaBoard['syncs'][number]>[] = [
  { id: 'dataset', label: 'Dataset', value: (s) => DATASET[s.dataset], translate: true, render: (s) => <strong>{DATASET[s.dataset]}</strong>, phone: 'title' },
  { id: 'at', label: 'Received', value: (s) => s.at, sort: 'date', render: (s) => dateTimeLabel(s.at), phone: 'sub' },
  {
    id: 'kept',
    label: 'Kept',
    value: (s) => s.accepted,
    sort: 'number',
    align: 'left',
    render: (s) => (
      <Chip tone={s.rejected.length ? 'warn' : 'ok'}>
        {s.accepted} of {s.received} kept
      </Chip>
    ),
  },
  {
    id: 'refused',
    label: 'Refused',
    value: (s) => s.rejected.length,
    sort: 'number',
    align: 'left',
    render: (s) =>
      s.rejected.length ? (
        <span className="small">
          {s.rejected.slice(0, 3).map((r) => (
            <span key={r.externalId} style={{ display: 'block' }}>
              Refused {r.externalId}: {r.reason}
            </span>
          ))}
          {s.rejected.length > 3 && <span className="muted">{`and ${s.rejected.length - 3} more`}</span>}
        </span>
      ) : (
        '–'
      ),
  },
];

type PayRow = JaBoard['payroll'][number];
/** P107: every company's payroll month in one table (the SOCSO, LINDUNG and EIS figures stay per month below it). */
const payrollColumns = (byDay: number): DtColumn<PayRow>[] => [
  { id: 'company', label: 'Company', value: (p) => p.companyName, render: (p) => <strong>{p.companyName}</strong>, phone: 'title' },
  { id: 'period', label: 'Month', value: (p) => p.period, sort: 'date', render: (p) => p.period, phone: 'sub' },
  { id: 'headcount', label: 'People', value: (p) => p.headcount, sort: 'number' },
  { id: 'gross', label: 'Gross', value: (p) => p.gross, sort: 'money' },
  { id: 'net', label: 'Net', value: (p) => p.net, sort: 'money', hideBelow: 1100 },
  { id: 'epf', label: 'Employer EPF', value: (p) => p.employerEpf, sort: 'money', hideBelow: 1200 },
  { id: 'approvedBy', label: 'Approved by', value: (p) => p.approvedBy ?? '', hideBelow: 1300 },
  { id: 'paidOn', label: 'Paid', value: (p) => p.paidOn ?? '', sort: 'date', hideBelow: 1100 },
  {
    id: 'status',
    label: 'Status',
    value: (p) => (p.late ? `Not paid by the ${byDay}th` : PAY[p.status][1]),
    translate: true,
    render: (p) => <Chip tone={p.late ? 'crit' : PAY[p.status][0]}>{p.late ? `Not paid by the ${byDay}th` : PAY[p.status][1]}</Chip>,
  },
];

function PayrollPanel({ data }: { data: JaBoard }) {
  const periods = [...new Set(data.payroll.map((p) => p.period))];
  return (
    <>
      {data.payrollMissing.length > 0 && (
        <div className="notice" data-tone="crit">
          Not received for {data.payrollMissing[0].period}: {data.payrollMissing.map((m) => m.companyName).join(', ')}.
        </div>
      )}
      <Card title="Payroll by company" sub="Each company's month as the JA app sent it; the month totals and contributions follow">
        <DataTable
          label="Payroll by company"
          stateKey="it.ja.payroll"
          rows={data.payroll}
          rowKey={(p) => p.id}
          columns={payrollColumns(data.rule.payrollByDay)}
          filters={[
            { id: 'period', label: 'Month', value: (p) => p.period },
            { id: 'company', label: 'Company', value: (p) => p.companyName },
            { id: 'status', label: 'Status', value: (p) => (p.late ? 'late' : p.status), options: [{ value: 'late', label: `Not paid by the ${data.rule.payrollByDay}th` }, ...Object.entries(PAY).map(([k, [, l]]) => ({ value: k, label: l }))] },
          ]}
          rowTone={(p) => (p.late ? 'crit' : undefined)}
        />
      </Card>
      {periods.map((period) => {
        const rows = data.payroll.filter((p) => p.period === period);
        return (
          <Card
            key={period}
            title={period}
            sub={`${rows.reduce((n, r) => n + r.headcount, 0).toLocaleString()} paid · gross ${rm(rows.reduce((n, r) => n + r.gross, 0))}`}
            flush
          >
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
    >
      <DataTable
        label="Papers due"
        stateKey="it.ja.papers"
        rows={data.papers}
        rowKey={(p) => `${p.recordId}-${p.paper}`}
        columns={PAPER_COLUMNS}
        filters={[
          { id: 'paper', label: 'Paper', value: (p) => p.paper, optionLabel: (k) => PAPER[k as PaperRow['paper']] ?? k },
          { id: 'company', label: 'Company', value: (p) => p.companyName },
          { id: 'status', label: 'Status', value: (p) => p.status.replace('_', ' ') },
          { id: 'feed', label: 'Feed', value: (p) => (p.stale ? 'late' : 'current'), options: [{ value: 'late', label: 'Unknown, feed late' }, { value: 'current', label: 'Current' }] },
        ]}
        searchText={(p) => p.staffNo}
        rowTone={(p) => (!p.stale && (p.daysLeft == null || p.daysLeft <= 7) ? 'crit' : undefined)}
        empty={<Empty title="Nothing due." />}
      />
    </Card>
  );
}

type PaperRow = JaBoard['papers'][number];
/** P107: every paper due, no longer cut at 80. */
const PAPER_COLUMNS: DtColumn<PaperRow>[] = [
  {
    id: 'name',
    label: 'Worker',
    value: (p) => p.name,
    render: (p) => (
      <span>
        <strong>{p.name}</strong> <span className="muted small mono">{p.staffNo}</span>
      </span>
    ),
    phone: 'title',
  },
  { id: 'company', label: 'Company', value: (p) => p.companyName, phone: 'sub' },
  { id: 'paper', label: 'Paper', value: (p) => PAPER[p.paper], translate: true },
  { id: 'expires', label: 'Expires', value: (p) => p.expiresOn ?? '', sort: 'date', render: (p) => (p.expiresOn ? dateLabel(p.expiresOn) : <span className="muted small">no expiry date on record</span>) },
  { id: 'status', label: 'Status', value: (p) => p.status.replace('_', ' '), translate: true, hideBelow: 1100 },
  {
    id: 'left',
    label: 'Days left',
    value: (p) => (p.stale ? null : p.daysLeft),
    sort: 'number',
    align: 'left',
    render: (p) =>
      p.stale ? (
        <Chip tone="unknown">Unknown, feed late</Chip>
      ) : (
        <Chip tone={p.daysLeft == null || p.daysLeft <= 7 ? 'crit' : 'warn'}>{p.daysLeft == null ? 'No date' : p.daysLeft < 0 ? `${-p.daysLeft} days expired` : `${p.daysLeft} days left`}</Chip>
      ),
  },
];

function IncidentsPanel({ data }: { data: JaBoard }) {
  return (
    <Card title="Incidents from the JA app" sub="Reported, escalated and closed in the JA app" actions={<span className="bz-count">{data.incidents.length}</span>}>
      <DataTable
        label="Incidents from the JA app"
        stateKey="it.ja.incidents"
        rows={data.incidents}
        rowKey={(i) => i.id}
        columns={INCIDENT_COLUMNS}
        filters={[
          { id: 'severity', label: 'Severity', value: (i) => i.severity },
          { id: 'status', label: 'Status', value: (i) => i.status, options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
          { id: 'company', label: 'Company', value: (i) => i.companyName },
          { id: 'category', label: 'Category', value: (i) => i.category },
        ]}
        rowTone={(i) => (i.status === 'open' && (i.severity === 'P1' || i.severity === 'P2') ? 'crit' : undefined)}
        empty={<Empty title="No incidents received." />}
      />
    </Card>
  );
}

/** P107: incidents from the JA app as a table. */
const INCIDENT_COLUMNS: DtColumn<JaBoard['incidents'][number]>[] = [
  {
    id: 'what',
    label: 'Incident',
    value: (i) => i.category,
    render: (i) => (
      <span>
        <strong>{i.category}</strong>
        <span className="small" style={{ display: 'block' }}>{i.summary}</span>
      </span>
    ),
    phone: 'title',
  },
  { id: 'severity', label: 'Severity', value: (i) => i.severity, render: (i) => <Sev s={i.severity} /> },
  { id: 'company', label: 'Company', value: (i) => `${i.companyName}${i.siteCode ? ` · ${i.siteCode}` : ''}`, phone: 'sub' },
  { id: 'at', label: 'When', value: (i) => i.occurredAt, sort: 'date', render: (i) => dateTimeLabel(i.occurredAt) },
  { id: 'status', label: 'Status', value: (i) => (i.status === 'open' ? 'Open' : 'Closed'), translate: true, render: (i) => <Chip tone={i.status === 'open' ? 'warn' : 'ok'}>{i.status === 'open' ? 'Open' : 'Closed'}</Chip> },
];

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
        <Card title="Basic pay below the minimum wage" actions={<Chip tone="crit">{data.belowMinimumWage.length}</Chip>}>
          <DataTable
            label="Basic pay below the minimum wage"
            stateKey="it.ja.minwage"
            rows={data.belowMinimumWage}
            rowKey={(g) => `${g.companyId}-${g.staffNo}`}
            columns={[
              { id: 'name', label: 'Name', value: (g) => g.name, render: (g) => <strong>{g.name}</strong>, phone: 'title' },
              { id: 'staffNo', label: 'Staff no.', value: (g) => g.staffNo, className: 'mono', phone: 'sub' },
              { id: 'company', label: 'Company', value: (g) => g.companyName },
              { id: 'basic', label: 'Basic pay', value: (g) => g.basicPay, sort: 'money' },
              { id: 'minimum', label: 'Minimum wage', value: (g) => g.minimum, sort: 'money' },
            ]}
            filters={[{ id: 'company', label: 'Company', value: (g) => g.companyName }]}
            rowTone={() => 'crit'}
          />
        </Card>
      )}
      <Card title="Guards by company">
        <DataTable
          label="Guards by company"
          stateKey="it.ja.guards"
          rows={data.guards}
          rowKey={(g) => g.companyId}
          columns={[
            { id: 'company', label: 'Company', value: (g) => g.companyName, render: (g) => <strong>{g.companyName}</strong>, phone: 'title' },
            { id: 'active', label: 'Active', value: (g) => g.active, sort: 'number' },
            { id: 'suspended', label: 'Suspended', value: (g) => g.suspended, sort: 'number' },
            { id: 'left', label: 'Left', value: (g) => g.left, sort: 'number' },
            { id: 'foreign', label: 'Foreign', value: (g) => g.foreign, sort: 'number' },
            { id: 'feed', label: 'Feed', value: (g) => (g.stale ? 'feed late' : 'Current'), translate: true, render: (g) => (g.stale ? <Chip tone="unknown">feed late</Chip> : <Chip tone="ok">Current</Chip>) },
          ]}
          filters={[{ id: 'feed', label: 'Feed', value: (g) => (g.stale ? 'late' : 'current'), options: [{ value: 'late', label: 'feed late' }, { value: 'current', label: 'Current' }] }]}
          empty={<Empty title="No guard records received yet." />}
        />
      </Card>
    </>
  );
}
