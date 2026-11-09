import { Select } from '../SearchSelect';
import { WebTicketReview, LegacyWebsiteActions } from './WebTicketReview';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type WebBoardOk } from '../api';
import { saveFile } from '../save';
import { useApp } from '../App';
import { loadWebsiteVisit, websiteNoticeIsMonth, type WebsiteVisit } from './website-schedule-state';
import { Chip, Drawer, ErrorNotice, Loading, dataNotice, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { Card, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { ImportButton } from './ImportDrawer';
import { RecordButton } from './RecordForm';
import { ArrowsClockwiseIcon, BuildingsIcon, CalendarCheckIcon, CheckSquareIcon, GlobeIcon, SealCheckIcon, WarningIcon } from '@phosphor-icons/react';
import { printPage } from '../native';


/**
 * Group websites (Fauzan, 27 Oct 2026). One register of every company's domains and websites, run by IT: who owns
 * what, quarterly content reviews with the company, monthly checks, urgent issues, DNS changes and renewals. No outside
 * publication is performed here. Manual records and optional read-only connector observations remain distinct.
 */

type B = WebBoardOk;
type Tab = 'overview' | 'companies' | 'sites' | 'domains' | 'social' | 'email' | 'reviews' | 'checks' | 'issues' | 'dns' | 'reports' | 'settings';
type Open = { kind: 'company' | 'site' | 'domain' | 'social' | 'review' | 'check' | 'issue' | 'dns'; id: string } | null;
type Act = ReturnType<typeof useAction>;

const SITE_STATUS: Record<string, [Tone, string]> = {
  live: ['ok', 'Live'],
  development: ['info', 'Being built'],
  offline: ['crit', 'Offline'],
  retired: ['unknown', 'Retired'],
  none: ['warn', 'No website'],
  not_required: ['neutral', 'Not required'],
};
const DOMAIN_STATUS: Record<string, [Tone, string]> = {
  active: ['ok', 'Active'],
  expiring: ['warn', 'Expiring'],
  expired: ['crit', 'Expired'],
  unknown: ['unknown', 'Unknown'],
  none: ['warn', 'No domain'],
};
const Q_STATUS: Record<string, [Tone, string]> = {
  not_started: ['neutral', 'Not started'],
  in_progress: ['info', 'In progress'],
  awaiting_approval: ['warn', 'Awaiting approval'],
  completed: ['ok', 'Completed'],
  overdue: ['crit', 'Overdue'],
  not_applicable: ['unknown', 'Not applicable'],
};
const CHECK_STATUS: Record<string, [Tone, string]> = {
  not_started: ['neutral', 'Not started'],
  in_progress: ['info', 'In progress'],
  completed: ['ok', 'Completed'],
  completed_issues: ['warn', 'Completed with issues'],
  overdue: ['crit', 'Overdue'],
  na: ['unknown', 'Not applicable'],
};
const SEV: Record<string, Tone> = { critical: 'crit', high: 'warn', normal: 'info', low: 'neutral' };
const CATEGORY: Record<string, string> = {
  DOWN: 'Website down',
  SECURITY: 'Security warning',
  WRONG_INFO: 'Wrong information',
  CLAIM: 'Licence or certification claim',
  FORM: 'Contact form not delivering',
  UNAUTHORISED: 'Unauthorised content',
  DOMAIN: 'Domain expired or at risk',
  EMAIL: 'Microsoft 365 email interrupted',
  TEST_FAIL: 'Failed test',
  OTHER: 'Other',
};
const RESULT: Record<string, [Tone, string]> = { pass: ['ok', 'Pass'], fail: ['crit', 'Fail'], na: ['unknown', 'N/A'] };
const DEPLOY: Record<string, string> = { github: 'GitHub-linked', direct_upload: 'Direct upload', other: 'Other', unknown: 'Unknown' };

const yn = (v: boolean | null | undefined) => (v == null ? 'Unknown' : v ? 'Yes' : 'No');

/** Phase 2: opening the module runs the schedule once per visit; the server runs it at most once an hour. */
let scheduleTried = false;

async function loadBoard() {
  const b = await api.websiteBoard();
  if (!b.allowed || !b.schedule.runs || !b.schedule.auto || scheduleTried) return b;
  scheduleTried = true;
  try {
    const res = (await api.websiteAction('runSchedule', {})) as { ran: boolean; reviews: number; checks: number; sent: number };
    return res.ran && (res.reviews || res.checks || res.sent) ? api.websiteBoard() : b;
  } catch {
    return b;
  }
}

export function WebsitesView() {
  const { me } = useApp();
  const visit = useRef<WebsiteVisit>({ active: true, attempted: false, generation: 0 });
  useEffect(() => { visit.current.active = true; return () => { visit.current.active = false; visit.current.generation++; }; }, []);
  const { data, error, reload } = useLoad(() => loadWebsiteVisit(api, visit.current), []);
  const [tab, setTab] = useState<Tab>('overview');
  const [open, setOpen] = useState<Open>(null);
  const [filter, setFilter] = useState<{ label: string; ids: string[] } | null>(null);
  if (error) return <div className="ws-retry"><ErrorNotice error={error} /><button className="btn" onClick={reload}>Retry Websites</button></div>;
  if (!data) return <Loading what="websites" />;
  if (!data.allowed)
    return (
      <div className="page ws-page">
        <PageHead title="Websites" />
        <div className="empty">No company websites are assigned to you. IT, group management and each company's Head of Company, content owner and approver work here.</div>
      </div>
    );
  const r = data.role;
  const tabs: [Tab, string][] = [
    ['overview', 'Overview'],
    ['companies', 'Companies'],
    ['sites', 'Websites'],
    ['domains', 'Domains'],
    ['social', 'Social media'],
    ...(r.it || r.group || r.admin ? ([['email', 'Email']] as [Tab, string][]) : []),
    ['reviews', `Quarterly reviews`],
    ...(r.it || r.group || r.cos ? ([['checks', 'Monthly checks']] as [Tab, string][]) : []),
    ['issues', 'Issues'],
    ...(r.it || r.group ? ([['dns', 'DNS changes']] as [Tab, string][]) : []),
    ['reports', 'Reports'],
    ...(r.admin ? ([['settings', 'Settings']] as [Tab, string][]) : []),
  ];
  const go = (kind: NonNullable<Open>['kind'], id: string) => setOpen({ kind, id });
  const drill = (label: string, ids: string[]) => {
    setFilter({ label, ids });
    setTab('companies');
  };
  return (
    <div className="page ws-page">
      <PageHead
        title="Websites"
        actions={
          <>
            <ImportButton kind="itDomain" />
            <RecordButton kind="itDomain" label="Add domain" primary />
          </>
        }
        sub={
          r.itHead || r.group
            ? `Domains, websites, quarterly content reviews, monthly checks and issues for every company in the group. ${data.quarter.key} runs ${dateLabel(data.quarter.start)} to ${dateLabel(data.quarter.end)}.`
            : r.head || r.company
              ? 'Your companies’ websites: answer the quarterly review, approve changes and follow open issues.'
              : 'The websites and domains assigned to you.'
        }
      >
        <p className="notice" data-tone="info">
          {dataNotice(me.dataMode)} Publications and renewals are recorded by hand. Optional connector readings are labelled with their source and time; notices show inside Prima only.
        </p>
      </PageHead>
      <div className="tabbar ws-tabs" role="tablist" aria-label="Website sections">
        {tabs.map(([t, l]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              if (t !== 'companies') setFilter(null);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview data={data} go={go} drill={drill} setTab={setTab} />}
      {tab === 'companies' && <Companies data={data} go={go} filter={filter} clearFilter={() => setFilter(null)} />}
      {tab === 'sites' && <Sites data={data} go={go} />}
      {tab === 'domains' && <Domains data={data} go={go} />}
      {tab === 'reviews' && <Reviews data={data} go={go} />}
      {tab === 'checks' && <Checks data={data} go={go} />}
      {tab === 'social' && <Social data={data} go={go} />}
      {tab === 'email' && <Email data={data} go={go} />}
      {tab === 'issues' && <Issues data={data} go={go} />}
      {tab === 'dns' && <DnsList data={data} go={go} />}
      {tab === 'reports' && <Reports data={data} />}
      {tab === 'settings' && <Settings data={data} />}
      {open?.kind === 'company' && <CompanyDrawer data={data} id={open.id} go={go} onClose={() => setOpen(null)} />}
      {open?.kind === 'site' && <SiteDrawer data={data} id={open.id} go={go} onClose={() => setOpen(null)} />}
      {open?.kind === 'domain' && <DomainDrawer data={data} id={open.id} go={go} onClose={() => setOpen(null)} />}
      {open?.kind === 'review' && <ReviewDrawer data={data} id={open.id} go={go} onClose={() => setOpen(null)} />}
      {open?.kind === 'check' && <CheckDrawer data={data} id={open.id} go={go} onClose={() => setOpen(null)} />}
      {open?.kind === 'social' && <SocialDrawer data={data} id={open.id} onClose={() => setOpen(null)} />}
      {open?.kind === 'issue' && <IssueDrawer data={data} id={open.id} go={go} onClose={() => setOpen(null)} />}
      {open?.kind === 'dns' && <DnsDrawer data={data} id={open.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---------- Small parts ----------

function Line({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="ws-line">
      <span className="ws-line-k">{k}</span>
      <span className="ws-line-v">{children}</span>
    </div>
  );
}

function Pill({ map, k }: { map: Record<string, [Tone, string]>; k: string }) {
  const [tone, label] = map[k] ?? ['unknown', k];
  return <Chip tone={tone}>{label}</Chip>;
}

/** Days to a domain's expiry at a glance: expired or within 30 days red, within 60 amber. Nothing when no date is recorded. */
function ExpiryChip({ days }: { days: number | null | undefined }) {
  if (days == null) return null;
  if (days < 0) return <Chip tone="crit">{days === -1 ? '1 day ago' : `${-days} days ago`}</Chip>;
  return <Chip tone={days <= 30 ? 'crit' : days <= 60 ? 'warn' : 'ok'}>{days === 1 ? '1 day left' : `${days} days left`}</Chip>;
}

function Manual() {
  return (
    <Chip tone="neutral" title="No integration is connected; a person recorded this">
      Manual
    </Chip>
  );
}

function PersonPick({ data, value, onChange, label, it = false }: { data: B; value: string; onChange: (v: string) => void; label: string; it?: boolean }) {
  const list = it ? data.itTeam.map((p) => ({ id: p.id, name: p.name, title: p.itRole ?? '' })) : data.people;
  return (
    <label className="field">
      <span>{label}</span>
      <Select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not assigned</option>
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.title ? ` (${p.title})` : ''}
          </option>
        ))}
      </Select>
    </label>
  );
}

function Text({ label, value, onChange, area = false, placeholder }: { label: string; value: string; onChange: (v: string) => void; area?: boolean; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {area ? (
        <textarea className="textarea" rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

/** A titled card; lists inside it run edge to edge. */
function Panel({ title, note, actions, children }: { title: string; note?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="ws-card">
      <Card title={title} sub={note} actions={actions}>
        {children}
      </Card>
    </div>
  );
}

function RowButton({ onClick, title, sub, right }: { onClick: () => void; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <button className="ws-row" onClick={onClick}>
      <span className="ws-row-main">
        <span className="ws-row-title">{title}</span>
        {sub && <span className="ws-row-sub">{sub}</span>}
      </span>
      {right && <span className="ws-row-right">{right}</span>}
    </button>
  );
}

/**
 * Pilot (Fauzan, 28 Oct 2026): the companies and ACT are not on the system yet, so the IT Manager records their answers,
 * checks and approvals for them. The name and how it was given travel with each of those steps.
 */
const onBehalf = { name: '', via: '' };
const PROXY_STEPS = ['respond', 'verify', 'approve', 'complianceDecide'];
const call = (act: Act, action: string, input: Record<string, unknown>, ok: string) =>
  act.run(() => api.websiteAction(action, PROXY_STEPS.includes(action) && onBehalf.name ? { ...input, onBehalfOf: onBehalf.name, via: onBehalf.via } : input), ok);

function OnBehalf() {
  const [name, setName] = useState(onBehalf.name);
  const [via, setVia] = useState(onBehalf.via);
  return (
    <Panel title="Recording for the company" note="Pilot: the companies and ACT are not on Prima yet">
      <p className="muted small">Write who in the company (or ACT) gave this answer, check or approval, and how they gave it. Both are kept on the record.</p>
      <div className="ws-form">
        <Text
          label="Given by (name and role)"
          value={name}
          onChange={(x) => {
            setName(x);
            onBehalf.name = x;
          }}
        />
        <Text
          label="How (for example, Teams message 28 Oct 10:14)"
          value={via}
          onChange={(x) => {
            setVia(x);
            onBehalf.via = x;
          }}
        />
      </div>
    </Panel>
  );
}

// ---------- Overview (dashboards by role) ----------

function Overview({ data, go, drill, setTab }: { data: B; go: (k: NonNullable<Open>['kind'], id: string) => void; drill: (label: string, ids: string[]) => void; setTab: (t: Tab) => void }) {
  const k = data.kpis;
  const c = data.coverage;
  const r = data.role;
  const act = useAction();
  const tile = (label: string, ids: string[], tone: Tone) => (
    <button className="ws-tile" data-tone={ids.length ? tone : 'ok'} onClick={() => drill(label, ids)} key={label}>
      <span className="ws-tile-n">{ids.length}</span>
      <span className="ws-tile-l">{label}</span>
    </button>
  );
  const goTodo = (t: { go: { tab: string; id: string } }) => {
    const kind = ({ reviews: 'review', checks: 'check', domains: 'domain', issues: 'issue', dns: 'dns', sites: 'site' } as const)[t.go.tab as 'reviews'];
    if (t.go.id && kind) go(kind, t.go.id);
    else setTab(t.go.tab as Tab);
  };
  return (
    <>
      <Stats>
        <Stat label="Companies" value={k.companies} note="From the company list" icon={<BuildingsIcon size={16} />} onClick={() => setTab('companies')} />
        <Stat label="Live websites" value={k.liveSites} tone="ok" note={k.offlineOrCritical ? `${k.offlineOrCritical} offline or critical` : undefined} icon={<GlobeIcon size={16} />} onClick={() => setTab('sites')} />
        <Stat
          label={`${data.quarter.key} reviews done`}
          value={k.reviewsDone}
          note={`${k.reviewsOpen} in progress · ${k.reviewsOverdue} overdue`}
          tone={k.reviewsOverdue ? 'crit' : 'ok'}
          icon={<CalendarCheckIcon size={16} />}
          onClick={() => setTab('reviews')}
        />
        <Stat label="Domains expiring" value={k.expiring30} note={`within 30 days · ${k.expiring60} within 60 · ${k.expired} expired`} tone={k.expired ? 'crit' : k.expiring30 ? 'warn' : 'ok'} icon={<ArrowsClockwiseIcon size={16} />} onClick={() => setTab('domains')} />
        <Stat label="Critical issues" value={k.critical} tone={k.critical ? 'crit' : 'ok'} icon={<WarningIcon size={16} />} onClick={() => setTab('issues')} />
        <Stat label="Waiting for approval" value={k.awaitingApproval} tone={k.awaitingApproval ? 'warn' : 'ok'} icon={<SealCheckIcon size={16} />} onClick={() => setTab('reviews')} />
        {(r.it || r.group) && <Stat label="Monthly checks" value={k.checksDue} note={`due · ${k.checksOverdue} overdue`} tone={k.checksOverdue ? 'crit' : 'ok'} icon={<CheckSquareIcon size={16} />} onClick={() => setTab('checks')} />}
      </Stats>
      <ErrorNotice error={act.error} />
      <div className={c ? 'ws-grid' : 'ws-stack'}>
        <Panel title={r.itHead || r.group || r.cos ? 'Needs action' : 'Your to-do'} note={`${data.todo.length} item${data.todo.length === 1 ? '' : 's'}`}>
          <div className="list">
            {data.todo.slice(0, 25).map((t, i) => (
              <RowButton key={i} onClick={() => goTodo(t)} title={t.text} right={<Chip tone={t.tone}>{t.tone === 'crit' ? 'Urgent' : t.tone === 'warn' ? 'Due' : 'To do'}</Chip>} />
            ))}
            {data.todo.length > 25 && <div className="muted small ws-more">and {data.todo.length - 25} more</div>}
            {!data.todo.length && <div className="empty">Nothing waiting on you.</div>}
          </div>
        </Panel>
        {c && (
          <Panel title="Company coverage" note={`${c.total} companies in the company list`}>
            <div className="ws-tiles">
              {tile('With a live website', c.live, 'ok')}
              {tile('Domain but no live website', c.domainNoSite, 'warn')}
              {tile('No domain', c.noDomain, 'warn')}
              {tile('No website', c.noSite, 'warn')}
              {tile('Neither domain nor website', c.neither, 'warn')}
              {tile('Missing owner or administrator', c.missingOwners, 'crit')}
              {tile('Quarterly review overdue', c.overdue, 'crit')}
              {tile('Website not required (with reason)', c.notRequired, 'neutral')}
              {tile('Incomplete or unknown records', c.incomplete, 'warn')}
            </div>
          </Panel>
        )}
      </div>
      {r.cos && (
        <Panel title="Administration exceptions" note="Monitor and chase; approvals stay with the company and IT">
          <div className="list">
            <Line k="Companies with missing information">{data.companies.filter((x) => x.missing.length).length}</Line>
            <Line k="Company answers outstanding">{k.awaitingCompany}</Line>
            <Line k="Domain renewals within 60 days">{k.expiring60}</Line>
            <Line k="Overdue actions on Heads of Company">{data.reviews.filter((x) => x.overdue && x.review.stage === 'request').length}</Line>
          </div>
        </Panel>
      )}
      {r.itHead && (
        <>
          <Panel title="IT work" note="Websites per administrator">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Websites</th>
                    <th>Backup for</th>
                    <th>Checks open</th>
                    <th>Reviews open</th>
                    <th>Issues open</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workload.map((w) => (
                    <tr key={w.id}>
                      <td>{w.name}</td>
                      <td>{w.sites}</td>
                      <td>{w.backupFor}</td>
                      <td>{w.checksOpen}</td>
                      <td>{w.reviewsOpen}</td>
                      <td>{w.issuesOpen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="list ws-gap-top">
              <Line k="Company answers pending">{k.awaitingCompany}</Line>
              <Line k="Waiting to be published">{k.awaitingPublish}</Line>
              <Line k="Failed tests">{k.failedTests}</Line>
              <Line k="Websites missing an owner or backup">{k.missingOwners}</Line>
              <Line k="DNS changes coming up">{k.dnsUpcoming}</Line>
            </div>
          </Panel>
          <Panel title="Start the cycle" note="Run again safely: nothing is opened twice">
            <div className="ws-actions">
              <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'openReviews', { quarter: data.quarter.key }, `${data.quarter.key} reviews opened.`)}>
                Open {data.quarter.key} reviews
              </button>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => call(act, 'openChecks', { month: data.month }, `Monthly checks for ${data.month} opened.`)}>
                Open {data.month} monthly checks
              </button>
            </div>
            {data.schedule.canForce && (
              <div className="ws-actions ws-gap-top">
                <button
                  className="btn btn-sm"
                  disabled={act.busy}
                  onClick={() =>
                    act.run(
                      () => api.websiteAction('runSchedule', { force: true }) as Promise<{ reviews: number; checks: number; sent: number }>,
                      (x) => `Schedule run: ${x.reviews} reviews and ${x.checks} checks opened, ${x.sent} reminders sent.`,
                    )
                  }
                >
                  Run reminders now
                </button>
              </div>
            )}
            <p className="muted small">
              {data.schedule.auto
                ? `Automatic: reviews open when the quarter starts, checks when the month starts, and reminders and escalations go out once each when IT or management opens Websites (at most hourly). Last run: ${data.schedule.lastRun ? dateTimeLabel(data.schedule.lastRun) : 'not yet'}.`
                : 'Automatic schedule is switched off in Settings: open each cycle with these buttons.'}{' '}
              Reminders show inside Prima only.
            </p>
          </Panel>
        </>
      )}
      <Connectors data={data} />
      {data.spInbox.length > 0 && <SpInbox data={data} />}
      {data.notices.length > 0 && (
        <Panel title="Your notices" note="Shown here only; email and Teams not connected">
          <div className="list">
            {data.notices.slice(0, 10).map((n) => (
              <RowButton
                key={n.id}
                onClick={() => websiteNoticeIsMonth(n.link) ? setTab('checks') : go(n.link.kind === 'check' ? 'check' : (n.link.kind as 'review'), n.link.id)}
                title={n.title}
                sub={`${dateTimeLabel(n.at)} · email: not connected · Teams: not connected`}
              />
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

// ---------- Companies ----------

function Companies({ data, go, filter, clearFilter }: { data: B; go: (k: NonNullable<Open>['kind'], id: string) => void; filter: { label: string; ids: string[] } | null; clearFilter: () => void }) {
  const [q, setQ] = useState('');
  const rows = data.companies.filter(
    (c) => (!filter || filter.ids.includes(c.company.id)) && (!q.trim() || `${c.company.name} ${c.head} ${c.itAdmin ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  return (
    <Panel title="Company register" note={`${rows.length} of ${data.companies.length}`}>
      {filter && (
        <div className="notice" data-tone="info">
          Showing: {filter.label}.{' '}
          <button className="btn btn-sm" onClick={clearFilter}>
            Show all
          </button>
        </div>
      )}
      <div className="ws-toolbar">
        <input className="input ws-search" type="search" aria-label="Search" placeholder="Company, Head of Company or IT administrator" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="list">
        {rows.map((c) => (
          <RowButton
            key={c.company.id}
            onClick={() => go('company', c.company.id)}
            title={c.company.name}
            sub={
              <>
                Head: {c.head} · IT: {c.itAdmin ?? 'not assigned'} · {c.domainCount} domain{c.domainCount === 1 ? '' : 's'}, {c.siteCount} website{c.siteCount === 1 ? '' : 's'}
                {c.lastReview ? ` · last review ${c.lastReview.quarter}` : ''}
                {c.missing.length ? ` · missing: ${c.missing.join(', ')}` : ''}
                {c.mainIssue ? ` · ${c.mainIssue}` : ''}
              </>
            }
            right={
              <>
                <Pill map={SITE_STATUS} k={c.websiteStatus} />
                <Pill map={DOMAIN_STATUS} k={c.domainStatus} />
                <Pill map={Q_STATUS} k={c.quarterStatus} />
              </>
            }
          />
        ))}
        {!rows.length && <div className="empty">No company matches.</div>}
      </div>
    </Panel>
  );
}

function CompanyDrawer({ data, id, go, onClose }: { data: B; id: string; go: (k: NonNullable<Open>['kind'], id: string) => void; onClose: () => void }) {
  const c = data.companies.find((x) => x.company.id === id);
  const act = useAction();
  const p = c?.profile;
  const [required, setRequired] = useState<string>(c?.websiteRequired ?? 'under_review');
  const [reason, setReason] = useState('');
  const [itAdmin, setItAdmin] = useState(p?.itAdminId ?? '');
  const [backup, setBackup] = useState(p?.backupId ?? '');
  const [owner, setOwner] = useState(p?.contentOwnerId ?? '');
  const [approver, setApprover] = useState(p?.approverId ?? '');
  if (!c) return null;
  const sites = data.sites.filter((s) => s.site.companyId === id);
  const domains = data.domains.filter((d) => d.domain.companyIds.includes(id));
  return (
    <Drawer title={c.company.name} sub={`Head of Company: ${c.head}`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <Panel title="Status">
        <div className="list">
          <Line k="Company status">Active (company list)</Line>
          <Line k="Website needed">{c.websiteRequired === 'yes' ? 'Yes' : c.websiteRequired === 'no' ? 'No' : 'Under review'}</Line>
          {c.notRequired && (
            <Line k="Not required because">
              {c.notRequired.reason} ({c.notRequired.by}, {dateLabel(c.notRequired.at.slice(0, 10))})
            </Line>
          )}
          <Line k="Website">
            <Pill map={SITE_STATUS} k={c.websiteStatus} />
          </Line>
          <Line k="Domain">
            <Pill map={DOMAIN_STATUS} k={c.domainStatus} />
          </Line>
          <Line k={`${data.quarter.key} review`}>
            <Pill map={Q_STATUS} k={c.quarterStatus} />
          </Line>
          <Line k="Last review">{c.lastReview ? `${c.lastReview.quarter}${c.lastReview.outstanding ? `, ${c.lastReview.outstanding} outstanding` : ''}` : 'None recorded'}</Line>
          <Line k="IT administrator">{c.itAdmin ?? 'Not assigned'}</Line>
          <Line k="Backup">{c.backup ?? 'Not assigned'}</Line>
          <Line k="Content owner">{c.contentOwner ?? 'Not assigned'}</Line>
          <Line k="Content approver">{c.approver ?? 'Not assigned'}</Line>
          {c.missing.length > 0 && <Line k="Missing">{c.missing.join(', ')}</Line>}
        </div>
      </Panel>
      <Panel title="Websites" note={`${sites.length}`}>
        <div className="list">
          {sites.map((s) => (
            <RowButton key={s.site.id} onClick={() => go('site', s.site.id)} title={s.site.name} sub={s.site.url} right={<Pill map={SITE_STATUS} k={s.site.status} />} />
          ))}
          {!sites.length && <div className="empty">No website. No quarterly review is made for a company without one.</div>}
        </div>
      </Panel>
      <Panel title="Domains" note={`${domains.length}`}>
        <div className="list">
          {domains.map((d) => (
            <RowButton
              key={d.domain.id}
              onClick={() => go('domain', d.domain.id)}
              title={d.domain.name}
              sub={d.domain.expiresOn ? `Expires ${dateLabel(d.domain.expiresOn)}` : 'Expiry not recorded'}
              right={
                <>
                  <ExpiryChip days={d.days} />
                  <Pill map={DOMAIN_STATUS} k={d.status} />
                </>
              }
            />
          ))}
          {!domains.length && <div className="empty">No domain recorded.</div>}
        </div>
      </Panel>
      {(data.role.itHead || data.role.group) && (
        <Panel title="Set up" note="IT Head or group management">
          <div className="ws-form">
            <label className="field">
              <span>Website needed?</span>
              <select className="select" value={required} onChange={(e) => setRequired(e.target.value)}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="under_review">Under review</option>
              </select>
            </label>
            {required === 'no' && <Text label="Why not (you are recorded as approving this)" value={reason} onChange={setReason} />}
            <PersonPick data={data} value={itAdmin} onChange={setItAdmin} label="IT administrator" it />
            <PersonPick data={data} value={backup} onChange={setBackup} label="Backup administrator" it />
            <PersonPick data={data} value={owner} onChange={setOwner} label="Content owner" />
            <PersonPick data={data} value={approver} onChange={setApprover} label="Content approver" />
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy}
              onClick={() =>
                call(
                  act,
                  'saveCompany',
                  { companyId: id, websiteRequired: required, notRequiredReason: reason, itAdminId: itAdmin, backupId: backup, contentOwnerId: owner, approverId: approver },
                  'Saved.',
                )
              }
            >
              Save
            </button>
          </div>
        </Panel>
      )}
    </Drawer>
  );
}

// ---------- Websites ----------

function Sites({ data, go }: { data: B; go: (k: NonNullable<Open>['kind'], id: string) => void }) {
  const [status, setStatus] = useState('ALL');
  const [adding, setAdding] = useState(false);
  const rows = data.sites.filter((s) => status === 'ALL' || s.site.status === status);
  return (
    <>
      <Panel
        title="Website register"
        note={`${rows.length} shown`}
        actions={
          (data.role.itHead || data.role.admin) && (
            <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
              Add website
            </button>
          )
        }
      >
        <div className="ws-toolbar">
          <Select className="select ws-filter" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ALL">Every status</option>
            {['live', 'development', 'offline', 'retired'].map((s) => (
              <option key={s} value={s}>
                {SITE_STATUS[s][1]}
              </option>
            ))}
          </Select>
        </div>
        <div className="list">
          {rows.map((s) => (
            <RowButton
              key={s.site.id}
              onClick={() => go('site', s.site.id)}
              title={`${s.companyName} · ${s.site.name}`}
              sub={
                <>
                  {s.site.url} · {s.site.hosting.provider || 'host unknown'}
                  {s.site.hosting.free ? ' (free plan)' : ''} · IT {s.owners.itAdmin ?? 'not assigned'}
                  {s.lastCheckOn ? ` · checked ${dateLabel(s.lastCheckOn)}` : ''}
                  {s.missing.length ? ` · missing ${s.missing.join(', ')}` : ''}
                </>
              }
              right={
                <>
                  <Pill map={SITE_STATUS} k={s.site.status} />
                  {s.currentReview && <Pill map={Q_STATUS} k={s.currentReview.label} />}
                  {s.critical && <Chip tone="crit">Critical issue</Chip>}
                </>
              }
            />
          ))}
          {!rows.length && <div className="empty">No website matches.</div>}
        </div>
      </Panel>
      {adding && (
        <Drawer title="Add website" onClose={() => setAdding(false)}>
          <SiteForm data={data} onDone={() => setAdding(false)} />
        </Drawer>
      )}
    </>
  );
}

function SiteDrawer({ data, id, go, onClose }: { data: B; id: string; go: (k: NonNullable<Open>['kind'], id: string) => void; onClose: () => void }) {
  const s = data.sites.find((x) => x.site.id === id);
  const [editing, setEditing] = useState(false);
  if (!s) return null;
  const w = s.site;
  const reviews = data.reviews.filter((r) => r.review.siteId === id);
  const issues = data.issues.filter((i) => i.issue.siteId === id);
  return (
    <Drawer title={w.name} sub={`${s.companyName} · ${w.url}`} onClose={onClose}>
      {editing ? (
        <SiteForm data={data} site={w} onDone={() => setEditing(false)} />
      ) : (
        <>
          <Panel title="Website">
            <div className="list">
              <Line k="Status">
                <Pill map={SITE_STATUS} k={w.status} />
              </Line>
              <Line k="Purpose">{w.purpose || '–'}</Line>
              <Line k="Domains">{s.domains.join(', ') || 'None linked'}</Line>
              <Line k="Hosting">
                {w.hosting.provider || 'Unknown'} {w.hosting.project && `· ${w.hosting.project}`} {w.hosting.plan && `· ${w.hosting.plan} plan`}
              </Line>
              <Line k="Cloudflare free plan">{yn(w.hosting.free)}</Line>
              <Line k="Custom domain connected">{yn(w.hosting.customDomain)}</Line>
              <Line k="Deployment">{DEPLOY[w.deploy]}</Line>
              <Line k="Repository">{w.repoRef || '–'}</Line>
              <Line k="Source files">{w.sourceRef || '–'}</Line>
              <Line k="Phone / email / WhatsApp">
                {w.contact.phone || '–'} / {w.contact.email || '–'} / {w.contact.whatsapp || '–'}
              </Line>
              <Line k="Contact form">{w.form.present == null ? 'Unknown' : w.form.present ? `${w.form.provider} → ${w.form.recipient}` : 'None'}</Line>
              <Line k="HTTPS">
                {yn(w.https.ok)}
                {w.https.checkedOn ? ` (checked ${dateLabel(w.https.checkedOn)})` : ''}
              </Line>
              <Line k="Claims to verify">{w.claims || '–'}</Line>
              <Line k="Costs">
                Hosting RM{w.cost.hosting ?? '?'}
                {w.cost.extras ? ` · ${w.cost.extras}` : ''}
              </Line>
              <Line k="Last good version">{w.recovery.lastGoodVersion || '–'}</Line>
              <Line k="Recovery instructions">{w.recovery.instructionsRef || '–'}</Line>
              {w.vault && (
                <Line k="Sign-in kept in">
                  {w.vault.manager}, entry “{w.vault.entry}”, opened by {w.vault.access}
                </Line>
              )}
              {w.reviewException && <Line k="Excused from review">{w.reviewException.reason}</Line>}
            </div>
            {w.hosting.free && (
              <p className="muted small">
                The Cloudflare free plan covers hosting only. Domain renewal, company email and the contact form service are separate, and the free plan has limits.
              </p>
            )}
            {s.canEdit && (
              <button className="btn btn-sm" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
          </Panel>
          <Panel title="Owners">
            <div className="list">
              <Line k="IT administrator">{s.owners.itAdmin ?? 'Not assigned'}</Line>
              <Line k="Backup">{s.owners.backup ?? 'Not assigned'}</Line>
              <Line k="Content owner">{s.owners.contentOwner ?? 'Not assigned'}</Line>
              <Line k="Content approver">{s.owners.approver ?? 'Not assigned'}</Line>
            </div>
          </Panel>
          <Panel title="Reviews">
            <div className="list">
              {reviews.map((r) => (
                <RowButton key={r.review.id} onClick={() => go('review', r.review.id)} title={r.review.quarter} sub={r.stageLabel} right={<Pill map={Q_STATUS} k={r.label} />} />
              ))}
              {s.lastReview && <Line k="Last completed">{s.lastReview.quarter}</Line>}
              {!reviews.length && !s.lastReview && <div className="empty">No review yet.</div>}
            </div>
          </Panel>
          <Panel title="Issues">
            <div className="list">
              {issues.map((i) => (
                <RowButton key={i.issue.id} onClick={() => go('issue', i.issue.id)} title={`${i.issue.ref} ${i.issue.description}`} sub={i.issue.status} right={<Chip tone={SEV[i.issue.severity]}>{i.issue.severity}</Chip>} />
              ))}
              {!issues.length && <div className="empty">No issues.</div>}
            </div>
          </Panel>
        </>
      )}
    </Drawer>
  );
}

function SiteForm({ data, site, onDone }: { data: B; site?: B['sites'][number]['site']; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    name: site?.name ?? '',
    companyId: site?.companyId ?? data.companies[0]?.company.id ?? '',
    url: site?.url ?? 'https://',
    status: site?.status ?? 'development',
    purpose: site?.purpose ?? '',
    provider: site?.hosting.provider ?? 'Cloudflare Pages',
    project: site?.hosting.project ?? '',
    plan: site?.hosting.plan ?? 'Free',
    free: site?.hosting.free == null ? '' : String(site.hosting.free),
    deploy: site?.deploy ?? 'unknown',
    repoRef: site?.repoRef ?? '',
    sourceRef: site?.sourceRef ?? '',
    phone: site?.contact.phone ?? '',
    email: site?.contact.email ?? '',
    whatsapp: site?.contact.whatsapp ?? '',
    formPresent: site?.form.present == null ? '' : String(site.form.present),
    formProvider: site?.form.provider ?? '',
    formRecipient: site?.form.recipient ?? '',
    claims: site?.claims ?? '',
    lastGood: site?.recovery.lastGoodVersion ?? '',
    recovery: site?.recovery.instructionsRef ?? '',
    vaultManager: site?.vault?.manager ?? '',
    vaultEntry: site?.vault?.entry ?? '',
    vaultAccess: site?.vault?.access ?? '',
    itAdminId: site?.itAdminId ?? '',
    backupId: site?.backupId ?? '',
    contentOwnerId: site?.contentOwnerId ?? '',
    approverId: site?.approverId ?? '',
  });
  const [domainIds, setDomainIds] = useState<string[]>(site?.domainIds ?? []);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const tri = (v: string) => (v === '' ? null : v === 'true');
  const companyDomains = data.domains.filter((d) => d.domain.companyIds.includes(f.companyId));
  return (
    <div className="ws-form">
      <ErrorNotice error={act.error} />
      <Text label="Website name" value={f.name} onChange={set('name')} />
      {!site && (
        <label className="field">
          <span>Company</span>
          <Select className="select" value={f.companyId} onChange={(e) => set('companyId')(e.target.value)}>
            {data.companies.map((c) => (
              <option key={c.company.id} value={c.company.id}>
                {c.company.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      <Text label="Address (https://…)" value={f.url} onChange={set('url')} />
      <label className="field">
        <span>Status</span>
        <Select className="select" value={f.status} onChange={(e) => set('status')(e.target.value)}>
          {['live', 'development', 'offline', 'retired'].map((s) => (
            <option key={s} value={s}>
              {SITE_STATUS[s][1]}
            </option>
          ))}
        </Select>
      </label>
      <Text label="Purpose" value={f.purpose} onChange={set('purpose')} />
      <fieldset className="field">
        <span>Linked domains</span>
        {companyDomains.map((d) => (
          <label key={d.domain.id} className="ws-check">
            <input
              type="checkbox"
              checked={domainIds.includes(d.domain.id)}
              onChange={(e) => setDomainIds((x) => (e.target.checked ? [...x, d.domain.id] : x.filter((y) => y !== d.domain.id)))}
            />
            {d.domain.name}
          </label>
        ))}
        {!companyDomains.length && <span className="muted small">No domain for this company yet.</span>}
      </fieldset>
      <Text label="Hosting provider" value={f.provider} onChange={set('provider')} />
      <Text label="Cloudflare project name" value={f.project} onChange={set('project')} />
      <Text label="Plan" value={f.plan} onChange={set('plan')} />
      <label className="field">
        <span>Cloudflare free plan?</span>
        <select className="select" value={f.free} onChange={(e) => set('free')(e.target.value)}>
          <option value="">Unknown</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      <label className="field">
        <span>Deployment</span>
        <Select className="select" value={f.deploy} onChange={(e) => set('deploy')(e.target.value)}>
          {Object.entries(DEPLOY).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </label>
      <Text label="Repository (address or reference)" value={f.repoRef} onChange={set('repoRef')} />
      <Text label="Source files (SharePoint, OneDrive or repository)" value={f.sourceRef} onChange={set('sourceRef')} />
      <Text label="Published phone" value={f.phone} onChange={set('phone')} />
      <Text label="Published email" value={f.email} onChange={set('email')} />
      <Text label="Published WhatsApp" value={f.whatsapp} onChange={set('whatsapp')} />
      <label className="field">
        <span>Contact form?</span>
        <select className="select" value={f.formPresent} onChange={(e) => set('formPresent')(e.target.value)}>
          <option value="">Unknown</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      {f.formPresent === 'true' && (
        <>
          <Text label="Form provider" value={f.formProvider} onChange={set('formProvider')} />
          <Text label="Form recipient" value={f.formRecipient} onChange={set('formRecipient')} />
        </>
      )}
      <Text label="Licences and certifications claimed" value={f.claims} onChange={set('claims')} area />
      <Text label="Last known working version" value={f.lastGood} onChange={set('lastGood')} />
      <Text label="Recovery instructions (where)" value={f.recovery} onChange={set('recovery')} />
      <p className="muted small">Never type a password here. Record only where it is kept.</p>
      <Text label="Password manager" value={f.vaultManager} onChange={set('vaultManager')} />
      <Text label="Vault entry name" value={f.vaultEntry} onChange={set('vaultEntry')} />
      <Text label="Who may open it" value={f.vaultAccess} onChange={set('vaultAccess')} />
      <PersonPick data={data} value={f.itAdminId} onChange={set('itAdminId')} label="IT administrator (blank: company default)" it />
      <PersonPick data={data} value={f.backupId} onChange={set('backupId')} label="Backup administrator" it />
      {data.people.length > 0 && (
        <>
          <PersonPick data={data} value={f.contentOwnerId} onChange={set('contentOwnerId')} label="Content owner (blank: company default)" />
          <PersonPick data={data} value={f.approverId} onChange={set('approverId')} label="Content approver (blank: company default)" />
        </>
      )}
      <div className="ws-actions">
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy}
          onClick={async () => {
            const ok = await call(
              act,
              'saveSite',
              {
                id: site?.id,
                name: f.name,
                companyId: f.companyId,
                url: f.url,
                status: f.status,
                purpose: f.purpose,
                domainIds,
                hosting: { provider: f.provider, project: f.project, plan: f.plan, free: tri(f.free), customDomain: domainIds.length ? true : null },
                deploy: f.deploy,
                repoRef: f.repoRef,
                sourceRef: f.sourceRef,
                contact: { phone: f.phone, email: f.email, whatsapp: f.whatsapp },
                form: { present: tri(f.formPresent), provider: f.formProvider, recipient: f.formRecipient },
                claims: f.claims,
                recovery: { lastGoodVersion: f.lastGood, instructionsRef: f.recovery },
                vault: f.vaultManager || f.vaultEntry ? { manager: f.vaultManager, entry: f.vaultEntry, access: f.vaultAccess } : null,
                itAdminId: f.itAdminId,
                backupId: f.backupId,
                contentOwnerId: site && !data.people.length ? site.contentOwnerId : f.contentOwnerId,
                approverId: site && !data.people.length ? site.approverId : f.approverId,
              },
              'Website saved.',
            );
            if (ok) onDone();
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- Domains ----------

function Domains({ data, go }: { data: B; go: (k: NonNullable<Open>['kind'], id: string) => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Panel
        title="Domain register"
        note={`${data.domains.length} · soonest expiry first`}
        actions={
          (data.role.itHead || data.role.admin) && (
            <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
              Add domain
            </button>
          )
        }
      >
        <div className="list">
          {data.domains.map((d) => (
            <RowButton
              key={d.domain.id}
              onClick={() => go('domain', d.domain.id)}
              title={d.domain.name}
              sub={
                <>
                  {d.companyNames.join(' + ')} · {d.domain.registrar || 'registrar unknown'} ·{' '}
                  {d.days == null ? 'expiry not recorded' : d.days < 0 ? `expired ${-d.days} days ago` : `expires in ${d.days} days (${dateLabel(d.domain.expiresOn)})`}
                  {d.domain.m365Email ? ' · Microsoft 365 email' : ''} · renewal: {d.renewalOwner ?? 'no owner'}
                  {d.dnsDrift ? ' · DNS changed outside an approved change' : ''}
                  {d.expiryMismatch ? ' · registry date differs' : ''}
                </>
              }
              right={
                <>
                  <ExpiryChip days={d.days} />
                  <Pill map={DOMAIN_STATUS} k={d.status} />
                  {d.escalate && <Chip tone="crit">Renewal not confirmed</Chip>}
                </>
              }
            />
          ))}
        </div>
      </Panel>
      {adding && (
        <Drawer title="Add domain" onClose={() => setAdding(false)}>
          <DomainForm data={data} onDone={() => setAdding(false)} />
        </Drawer>
      )}
    </>
  );
}

function DomainDrawer({ data, id, go, onClose }: { data: B; id: string; go: (k: NonNullable<Open>['kind'], id: string) => void; onClose: () => void }) {
  const d = data.domains.find((x) => x.domain.id === id);
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [newExpiry, setNewExpiry] = useState('');
  const [evidence, setEvidence] = useState('');
  const [amount, setAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [dnsOpen, setDnsOpen] = useState(false);
  if (!d) return null;
  const x = d.domain;
  const isRenewalOwner = data.role.finance;
  return (
    <Drawer title={x.name} sub={d.companyNames.join(' + ')} onClose={onClose}>
      <ErrorNotice error={act.error} />
      {editing ? (
        <DomainForm data={data} domain={x} onDone={() => setEditing(false)} />
      ) : (
        <>
          {d.dnsDrift && <AcceptDns data={data} domainId={x.id} />}
          <Panel title="Domain">
            <div className="list">
              <Line k="Status">
                <Pill map={DOMAIN_STATUS} k={d.status} />
              </Line>
              <Line k="Primary">{x.primary ? 'Primary' : 'Secondary'}</Line>
              <Line k="Registrar">{x.registrar || 'Unknown'}</Line>
              <Line k="Registered">{x.registeredOn ? dateLabel(x.registeredOn) : 'Unknown'}</Line>
              <Line k="Expires">{x.expiresOn ? dateLabel(x.expiresOn) : 'Not recorded'}</Line>
              {x.observed?.registrar && (
                <Line k="Registry says">
                  {x.observed.registrar.expiresOn ? dateLabel(x.observed.registrar.expiresOn) : 'No date'} {d.expiryMismatch && <Chip tone="warn">Differs: check and confirm</Chip>}{' '}
                  <span className="muted small">read {dateTimeLabel(x.observed.registrar.at)}</span>
                </Line>
              )}
              {x.observed?.dns && (
                <Line k="DNS (Cloudflare)">
                  {x.observed.dns.count} records {!x.observed.dnsBaseline ? <Chip tone="unknown">No baseline recorded</Chip> : d.dnsDrift ? <Chip tone="warn">Different from recorded baseline</Chip> : <Chip tone="info">Matches recorded baseline</Chip>}{' '}
                  <span className="muted small">read {dateTimeLabel(x.observed.dns.at)}{x.observed.dnsBaseline ? ` · baseline recorded by ${x.observed.dnsBaseline.by} at ${dateTimeLabel(x.observed.dnsBaseline.at)}` : ' · no baseline recorded'}</span>
                </Line>
              )}
              <Line k="Renew by">{x.renewOn ? dateLabel(x.renewOn) : '–'}</Line>
              <Line k="Auto-renewal">{x.autoRenew === 'unknown' ? 'Unknown' : x.autoRenew === 'on' ? 'On' : 'Off'}</Line>
              <Line k="Renewal amount">{x.renewalAmount == null ? 'Unknown' : `${x.currency} ${x.renewalAmount}`}</Line>
              <Line k="Payment owner">{d.renewalOwner ?? 'Not assigned'}</Line>
              <Line k="Payment">{x.payment ? `${x.payment.status}${x.payment.ref ? ` (${x.payment.ref})` : ''}` : 'Not recorded'}</Line>
              <Line k="Registrar account held by">{x.accountOwner || '–'}</Line>
              <Line k="DNS provider">{x.dnsProvider || 'Unknown'}</Line>
              <Line k="Nameservers">{x.nameservers.join(', ') || 'Unknown'}</Line>
              <Line k="Microsoft 365 email">{yn(x.m365Email)}</Line>
              <Line k="IT administrator / backup">
                {d.itAdmin ?? 'Not assigned'} / {d.backup ?? 'Not assigned'}
              </Line>
              <Line k="Last verified">{x.lastVerifiedOn ? dateLabel(x.lastVerifiedOn) : 'Never'}</Line>
              <Line k="Websites">{d.sites.join(', ') || 'None'}</Line>
              {x.vault && (
                <Line k="Sign-in kept in">
                  {x.vault.manager}, entry “{x.vault.entry}”, opened by {x.vault.access}
                </Line>
              )}
              {x.receiptRef && <Line k="Receipt">{x.receiptRef}</Line>}
            </div>
            <div className="ws-actions">
              {d.canEdit && (
                <button className="btn btn-sm" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
              {data.role.it && (
                <button className="btn btn-sm" onClick={() => setDnsOpen(true)}>
                  Raise DNS change
                </button>
              )}
            </div>
          </Panel>
          {x.renewals.length > 0 && (
            <Panel title="Renewals">
              <div className="list">
                {x.renewals.map((rn, i) => (
                  <Line key={i} k={dateTimeLabel(rn.at)}>
                    to {dateLabel(rn.to)} by {rn.by} · {rn.evidence}
                  </Line>
                ))}
              </div>
            </Panel>
          )}
          {d.canConfirmRenewal && (
            <Panel title="Confirm renewal" note="Marked renewed only with the new expiry date and evidence">
              <div className="ws-form">
                <label className="field">
                  <span>New expiry date</span>
                  <input className="input" type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} />
                </label>
                <Text label="Evidence (registrar receipt or invoice number)" value={evidence} onChange={setEvidence} />
                <Text label="Amount paid (optional)" value={amount} onChange={setAmount} />
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy}
                  onClick={() => call(act, 'confirmRenewal', { domainId: id, newExpiry, evidence, amount }, 'Renewal recorded.')}
                >
                  Confirm renewal
                </button>
              </div>
            </Panel>
          )}
          {(isRenewalOwner || data.role.itHead) && d.canConfirmRenewal && (
            <Panel title="Renewal payment">
              <div className="ws-actions">
                <input className="input" placeholder="Payment reference" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                <button className="btn btn-sm" disabled={act.busy} onClick={() => call(act, 'recordPayment', { domainId: id, status: 'paid', ref: payRef }, 'Payment recorded.')}>
                  Paid
                </button>
                <button className="btn btn-sm" disabled={act.busy} onClick={() => call(act, 'recordPayment', { domainId: id, status: 'unpaid', ref: payRef }, 'Marked unpaid.')}>
                  Unpaid
                </button>
              </div>
            </Panel>
          )}
          {data.dns.filter((c) => c.change.domainId === id).length > 0 && (
            <Panel title="DNS changes">
              <div className="list">
                {data.dns
                  .filter((c) => c.change.domainId === id)
                  .map((c) => (
                    <RowButton key={c.change.id} onClick={() => go('dns', c.change.id)} title={c.change.ref} sub={c.change.reason} right={<Chip tone="info">{c.change.status}</Chip>} />
                  ))}
              </div>
            </Panel>
          )}
        </>
      )}
      {dnsOpen && (
        <Drawer title={`DNS change on ${x.name}`} onClose={() => setDnsOpen(false)}>
          <DnsForm data={data} domainId={id} m365={x.m365Email} onDone={() => setDnsOpen(false)} />
        </Drawer>
      )}
    </Drawer>
  );
}

function DomainForm({ data, domain, onDone }: { data: B; domain?: B['domains'][number]['domain']; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    name: domain?.name ?? '',
    registrar: domain?.registrar ?? 'GoDaddy',
    status: domain?.status ?? 'unknown',
    registeredOn: domain?.registeredOn ?? '',
    expiresOn: domain?.expiresOn ?? '',
    renewOn: domain?.renewOn ?? '',
    autoRenew: domain?.autoRenew ?? 'unknown',
    renewalAmount: domain?.renewalAmount == null ? '' : String(domain.renewalAmount),
    accountOwner: domain?.accountOwner ?? '',
    dnsProvider: domain?.dnsProvider ?? '',
    nameservers: domain?.nameservers.join(', ') ?? '',
    m365: domain?.m365Email == null ? '' : String(domain.m365Email),
    renewalOwnerId: domain?.renewalOwnerId ?? '',
    itAdminId: domain?.itAdminId ?? '',
    backupId: domain?.backupId ?? '',
    lastVerifiedOn: domain?.lastVerifiedOn ?? '',
    vaultManager: domain?.vault?.manager ?? '',
    vaultEntry: domain?.vault?.entry ?? '',
    vaultAccess: domain?.vault?.access ?? '',
    receiptRef: domain?.receiptRef ?? '',
    note: domain?.note ?? '',
    primary: domain ? String(domain.primary) : 'true',
  });
  const [companyIds, setCompanyIds] = useState<string[]>(domain?.companyIds ?? []);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="ws-form">
      <ErrorNotice error={act.error} />
      <Text label="Domain name (like company.com.my)" value={f.name} onChange={set('name')} />
      <label className="field">
        <span>Companies (usually one)</span>
        <select
          className="select"
          multiple
          size={5}
          value={companyIds}
          onChange={(e) => setCompanyIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
        >
          {data.companies.map((c) => (
            <option key={c.company.id} value={c.company.id}>
              {c.company.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Primary or secondary</span>
        <select className="select" value={f.primary} onChange={(e) => set('primary')(e.target.value)}>
          <option value="true">Primary</option>
          <option value="false">Secondary</option>
        </select>
      </label>
      <Text label="Registrar" value={f.registrar} onChange={set('registrar')} />
      <label className="field">
        <span>Registration status</span>
        <Select className="select" value={f.status} onChange={(e) => set('status')(e.target.value)}>
          {['active', 'expired', 'pending', 'transferring', 'unknown'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span>Registered on</span>
        <input className="input" type="date" value={f.registeredOn} onChange={(e) => set('registeredOn')(e.target.value)} />
      </label>
      <label className="field">
        <span>Expires on{domain?.expiresOn ? ' (a later date is a renewal: use Confirm renewal)' : ''}</span>
        <input className="input" type="date" value={f.expiresOn} onChange={(e) => set('expiresOn')(e.target.value)} />
      </label>
      <label className="field">
        <span>Renew by</span>
        <input className="input" type="date" value={f.renewOn} onChange={(e) => set('renewOn')(e.target.value)} />
      </label>
      <label className="field">
        <span>Auto-renewal</span>
        <select className="select" value={f.autoRenew} onChange={(e) => set('autoRenew')(e.target.value)}>
          <option value="unknown">Unknown</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>
      <Text label="Renewal amount (RM)" value={f.renewalAmount} onChange={set('renewalAmount')} />
      <PersonPick data={data} value={f.renewalOwnerId} onChange={set('renewalOwnerId')} label="Payment owner" />
      <Text label="Registrar account held by (person or team)" value={f.accountOwner} onChange={set('accountOwner')} />
      <Text label="DNS provider" value={f.dnsProvider} onChange={set('dnsProvider')} />
      <Text label="Nameservers (comma separated)" value={f.nameservers} onChange={set('nameservers')} />
      <label className="field">
        <span>Used for Microsoft 365 email?</span>
        <select className="select" value={f.m365} onChange={(e) => set('m365')(e.target.value)}>
          <option value="">Unknown</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      <PersonPick data={data} value={f.itAdminId} onChange={set('itAdminId')} label="IT administrator" it />
      <PersonPick data={data} value={f.backupId} onChange={set('backupId')} label="Backup administrator" it />
      <label className="field">
        <span>Last verified</span>
        <input className="input" type="date" value={f.lastVerifiedOn} onChange={(e) => set('lastVerifiedOn')(e.target.value)} />
      </label>
      <p className="muted small">Never type a password, authorisation code or recovery code here. Record only where it is kept.</p>
      <Text label="Password manager" value={f.vaultManager} onChange={set('vaultManager')} />
      <Text label="Vault entry name" value={f.vaultEntry} onChange={set('vaultEntry')} />
      <Text label="Who may open it" value={f.vaultAccess} onChange={set('vaultAccess')} />
      <Text label="Receipt or document link" value={f.receiptRef} onChange={set('receiptRef')} />
      <Text label="Notes" value={f.note} onChange={set('note')} area />
      <div className="ws-actions">
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy}
          onClick={async () => {
            const ok = await call(
              act,
              'saveDomain',
              {
                id: domain?.id,
                ...f,
                primary: f.primary === 'true',
                companyIds,
                nameservers: f.nameservers.split(',').map((s) => s.trim()),
                m365Email: f.m365 === '' ? null : f.m365 === 'true',
                vault: f.vaultManager || f.vaultEntry ? { manager: f.vaultManager, entry: f.vaultEntry, access: f.vaultAccess } : null,
              },
              'Domain saved.',
            );
            if (ok) onDone();
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- Quarterly reviews ----------

function Reviews({ data, go }: { data: B; go: (k: NonNullable<Open>['kind'], id: string) => void }) {
  const [state, setState] = useState('ALL');
  const rows = data.reviews.filter((r) => state === 'ALL' || r.label === state || (state === 'mine' && Object.values(r.can).some(Boolean)));
  return (
    <Panel title="Quarterly reviews" note={`${data.quarter.key} and anything still open`}>
      <div className="ws-toolbar">
      <Select className="select ws-filter" aria-label="Filter" value={state} onChange={(e) => setState(e.target.value)}>
        <option value="ALL">All</option>
        <option value="mine">Waiting on me</option>
        {Object.entries(Q_STATUS)
          .filter(([k]) => k !== 'not_applicable')
          .map(([k, [, l]]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
      </Select>
      </div>
      <div className="list">
        {rows.map((r) => (
          <RowButton
            key={r.review.id}
            onClick={() => go('review', r.review.id)}
            title={`${r.companyName} · ${r.siteName}`}
            sub={`${r.review.quarter} · ${r.stageLabel} · company answers by ${dateLabel(r.review.responseDue)}${r.review.needsHelp ? ' · company asked for help' : ''}`}
            right={
              <>
                <Pill map={Q_STATUS} k={r.label} />
                {Object.values(r.can).some(Boolean) && <Chip tone="warn">Your turn</Chip>}
              </>
            }
          />
        ))}
        {!rows.length && <div className="empty">No review matches.</div>}
      </div>
    </Panel>
  );
}

const STAGES = ['request', 'verify', 'compliance', 'prepare', 'approval', 'publish', 'test', 'complete', 'done'] as const;
const STAGE_SHORT: Record<string, string> = {
  request: '1-2 Company',
  verify: '3 Verify',
  compliance: 'Compliance',
  prepare: '4 IT prepares',
  approval: '5 Approval',
  publish: '6 Publish',
  test: '7 Test',
  complete: '8 Complete',
  done: 'Done',
};

function ReviewDrawer({ data, id, go, onClose }: { data: B; id: string; go: (k: NonNullable<Open>['kind'], id: string) => void; onClose: () => void }) {
  const row = data.reviews.find((x) => x.review.id === id);
  const queue = data.complianceQueue.find((q) => q.reviewId === id);
  const act = useAction();
  if (!row) return null;
  const r = row.review;
  const at = STAGES.indexOf(r.stage);
  return (
    <Drawer title={`${row.siteName} · ${r.quarter}`} sub={`${row.companyName} · ${row.stageLabel}`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      {data.role.proxy && ['request', 'verify', 'compliance', 'approval'].includes(r.stage) && <OnBehalf />}
      <div className="ws-steps">
        <Steps
          steps={STAGES.filter((s) => s !== 'compliance' || r.changes.some((c) => c.compliance)).map((s) => ({
            label: STAGE_SHORT[s],
            state: (STAGES.indexOf(s) < at ? 'done' : s === r.stage ? (row.overdue ? 'stopped' : 'now') : 'todo') as StepState,
            note: s === r.stage && row.overdue ? 'Overdue' : undefined,
          }))}
        />
      </div>
      <Panel title="Dates and people">
        <div className="list">
          <Line k="Company answers by">{dateLabel(r.responseDue)}</Line>
          <Line k="Approval by">{dateLabel(r.approvalDue)}</Line>
          <Line k="Complete by">{dateLabel(r.completeDue)}</Line>
          <Line k="Content owner">{row.owners.contentOwner ?? 'Not assigned'}</Line>
          <Line k="Approver">{row.owners.approver ?? 'Not assigned'}</Line>
          <Line k="IT administrator">{row.owners.itAdmin ?? 'Not assigned'}</Line>
          <Line k="Website">{row.url}</Line>
        </div>
        {row.overdue && <div className="notice" data-tone="crit">Overdue. The IT Head and group management see this.</div>}
        {r.needsHelp && <div className="notice" data-tone="warn">The company asked IT for help with this review.</div>}
      </Panel>
      {r.response && (
        <Panel title="Company answer" note={`${r.response.by}, ${dateTimeLabel(r.response.at)}`}>
          <p>
            {r.response.outcome === 'changes' ? 'Changes required' : r.response.outcome === 'no_changes' ? 'Reviewed, no changes required' : 'Help needed'}
            {r.response.reusedFrom ? ' (same answer reused from another website of this company)' : ''}
            {r.response.note ? `: ${r.response.note}` : ''}
          </p>
          {r.changes.map((c, i) => (
            <div key={i} className="list-item ws-block">
              <div className="ws-strong">{c.page}</div>
              <div className="muted small">Now: {c.existing || '–'}</div>
              <div>Change to: {c.proposed}</div>
              <div className="muted small">
                {c.reason && `Why: ${c.reason} · `}
                {c.docRef && `Document: ${c.docRef} · `}
                {c.verifiedBy && `Checked by ${c.verifiedBy}`}
                {c.compliance && (c.complianceDecision ? ` · Compliance: ${c.complianceDecision.ok ? 'confirmed' : `not confirmed (${c.complianceDecision.note})`}` : ' · Compliance check needed')}
              </div>
            </div>
          ))}
          {r.verified && <p className="muted small">Verified by {r.verified.by}, {dateTimeLabel(r.verified.at)}</p>}
        </Panel>
      )}
      {r.preparation && (
        <Panel title="IT preparation" note={`${r.preparation.by}, ${dateTimeLabel(r.preparation.at)}`}>
          <div className="list">
            <Line k="Preview">{r.preparation.previewUrl}</Line>
            <Line k="Previous version kept">{r.preparation.previousVersion}</Line>
            <Line k="Desktop and mobile">Checked</Line>
            <Line k="Summary">{r.preparation.summary}</Line>
          </div>
        </Panel>
      )}
      {r.approvals.length > 0 && (
        <Panel title="Approvals">
          <div className="list">
            {r.approvals.map((a, i) => (
              <Line key={i} k={`${a.by}, ${dateTimeLabel(a.at)}`}>
                {a.decision === 'approve' ? 'Approved' : a.decision === 'amend' ? 'Amendments asked' : 'Rejected'}
                {a.note ? `: ${a.note}` : ''}
              </Line>
            ))}
          </div>
        </Panel>
      )}
      {r.publication && (
        <Panel title="Publication" note={<Manual />}>
          <div className="list">
            <Line k="Published">
              {dateTimeLabel(r.publication.at)} by {r.publication.by}
            </Line>
            <Line k="Version">{r.publication.versionRef}</Line>
            <Line k="Live address">{r.publication.liveUrl}</Line>
            {r.publication.issue && <Line k="Issue">{r.publication.issue}</Line>}
          </div>
        </Panel>
      )}
      {r.tests.some((t) => t.result) && <TestList data={data} row={row} go={go} />}
      {r.completed && (
        <Panel title="Completion" note={`${r.completed.by}, ${dateTimeLabel(r.completed.at)}`}>
          {r.completed.outstanding.length ? (
            <div className="notice" data-tone="warn">
              Outstanding:
              <ul>
                {r.completed.outstanding.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p>Nothing outstanding.</p>
          )}
        </Panel>
      )}
      {row.can.respond && <RespondForm data={data} row={row} act={act} />}
      {row.can.verify && (
        <Panel title="Verify" note="Stage 3: confirm the company's answer is accurate">
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'verify', { reviewId: id }, 'Verified.')}>
            The information is accurate
          </button>
        </Panel>
      )}
      {queue && <ComplianceForm queue={queue} act={act} />}
      {row.can.prepare && <PrepareForm id={id} act={act} />}
      {row.can.approve && <ApproveForm id={id} act={act} noChange={r.response?.outcome === 'no_changes'} />}
      {row.can.publish && <PublishForm id={id} act={act} url={row.url} />}
      {row.can.test && <TestForm row={row} lists={data.lists} act={act} />}
      {row.can.complete && (
        <Panel title="Record completion" note="Stage 8">
          <p className="muted small">Any failed item stays listed as outstanding with its issue, owner and due date.</p>
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'complete', { reviewId: id }, 'Review completed.')}>
            Complete the review
          </button>
        </Panel>
      )}
      <Panel title="History">
        <div className="list">
          {[...r.history].reverse().map((h, i) => (
            <Line key={i} k={`${dateTimeLabel(h.at)} · ${h.by}`}>
              {h.text}
            </Line>
          ))}
        </div>
      </Panel>
    </Drawer>
  );
}

function TestList({ data, row, go }: { data: B; row: B['reviews'][number]; go: (k: NonNullable<Open>['kind'], id: string) => void }) {
  return (
    <Panel title="Tests after publication" note={<Manual />}>
      <div className="list">
        {row.review.tests.map((t) => (
          <div key={t.key} className="list-item ws-wrap">
            <span>{data.lists.tests.find(([k]) => k === t.key)?.[1]}</span>
            <span className="ws-chips">
              {t.result ? <Pill map={RESULT} k={t.result} /> : <Chip tone="neutral">Not entered</Chip>}
              {t.issueId && (
                <button className="btn btn-sm" onClick={() => go('issue', t.issueId!)}>
                  Issue
                </button>
              )}
            </span>
            {(t.note || t.correction) && (
              <div className="muted small ws-full">
                {t.note}
                {t.correction ? ` · corrected: ${t.correction}` : ''}
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RespondForm({ data, row, act }: { data: B; row: B['reviews'][number]; act: Act }) {
  const [outcome, setOutcome] = useState<'changes' | 'no_changes' | 'assist'>('no_changes');
  const [topics, setTopics] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [changes, setChanges] = useState([{ page: '', existing: '', proposed: '', reason: '', docRef: '', verifiedBy: '', compliance: false }]);
  const siblings = data.reviews.filter((x) => x.review.companyId === row.review.companyId && x.review.quarter === row.review.quarter && x.review.id !== row.review.id && x.review.response);
  const setChange = (i: number, k: string, v: string | boolean) => setChanges((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  return (
    <Panel title="Your answer" note="Stage 2: check the website and answer">
      {siblings.length > 0 && (
        <div className="notice" data-tone="info">
          Same content as another website of this company?{' '}
          {siblings.map((s) => (
            <button key={s.review.id} className="btn btn-sm" disabled={act.busy} onClick={() => call(act, 'respond', { reviewId: row.review.id, reuseFrom: s.review.id }, 'Answer reused.')}>
              Reuse the answer for {s.siteName}
            </button>
          ))}
        </div>
      )}
      <div className="ws-form">
        <label className="field">
          <span>Result</span>
          <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
            <option value="no_changes">Reviewed: no changes required</option>
            <option value="changes">Changes required</option>
            <option value="assist">Unable to complete: assistance required</option>
          </select>
        </label>
        {outcome !== 'assist' && (
          <fieldset className="field">
            <span>What I checked</span>
            {data.lists.topics.map(([k, l]) => (
              <label key={k} className="ws-check">
                <input type="checkbox" checked={topics.includes(k)} onChange={(e) => setTopics((t) => (e.target.checked ? [...t, k] : t.filter((x) => x !== k)))} />
                {l}
              </label>
            ))}
            <button className="btn btn-sm" type="button" onClick={() => setTopics(data.lists.topics.map(([k]) => k))}>
              Tick all
            </button>
          </fieldset>
        )}
        {outcome === 'changes' &&
          changes.map((c, i) => (
            <div key={i} className="panel ws-form">
              <Text label="Page or section" value={c.page} onChange={(v) => setChange(i, 'page', v)} />
              <Text label="What it says now" value={c.existing} onChange={(v) => setChange(i, 'existing', v)} area />
              <Text label="What it should say" value={c.proposed} onChange={(v) => setChange(i, 'proposed', v)} area />
              <Text label="Reason" value={c.reason} onChange={(v) => setChange(i, 'reason', v)} />
              <Text label="Supporting document or image (where)" value={c.docRef} onChange={(v) => setChange(i, 'docRef', v)} />
              <Text label="Business owner who checked it" value={c.verifiedBy} onChange={(v) => setChange(i, 'verifiedBy', v)} />
              <label className="ws-check">
                <input type="checkbox" checked={c.compliance} onChange={(e) => setChange(i, 'compliance', e.target.checked)} />
                Licence, certification or other claim: needs a compliance check
              </label>
            </div>
          ))}
        {outcome === 'changes' && (
          <button className="btn btn-sm" type="button" onClick={() => setChanges((cs) => [...cs, { page: '', existing: '', proposed: '', reason: '', docRef: '', verifiedBy: '', compliance: false }])}>
            Add another change
          </button>
        )}
        {outcome === 'no_changes' && (
          <label className="ws-check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I confirm I reviewed the website content and it is correct.
          </label>
        )}
        <Text label={outcome === 'assist' ? 'What help do you need?' : 'Note (optional)'} value={note} onChange={setNote} area />
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy}
          onClick={() => call(act, 'respond', { reviewId: row.review.id, outcome, topics, confirmed, note, changes: outcome === 'changes' ? changes : [] }, 'Answer sent.')}
        >
          Send answer
        </button>
      </div>
    </Panel>
  );
}

function ComplianceForm({ queue, act }: { queue: B['complianceQueue'][number]; act: Act }) {
  const [note, setNote] = useState('');
  return (
    <Panel title="Compliance check" note="ACT verifies licence and certification claims">
      {queue.changes.map((c) => (
        <div key={c.index} className="list-item ws-block">
          <div className="ws-strong">{c.page}</div>
          <div>{c.proposed}</div>
          <Text label="Comment (always needed: what you checked, or why not confirmed)" value={note} onChange={setNote} />
          <div className="ws-actions">
            <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'complianceDecide', { reviewId: queue.reviewId, index: c.index, ok: true, note }, 'Claim confirmed.')}>
              Claim confirmed
            </button>
            <button className="btn btn-sm" disabled={act.busy} onClick={() => call(act, 'complianceDecide', { reviewId: queue.reviewId, index: c.index, ok: false, note }, 'Sent back.')}>
              Not confirmed
            </button>
          </div>
        </div>
      ))}
    </Panel>
  );
}

function PrepareForm({ id, act }: { id: string; act: Act }) {
  const [previewUrl, setPreview] = useState('');
  const [previousVersion, setPrev] = useState('');
  const [summary, setSummary] = useState('');
  const [desktopOk, setDesk] = useState(false);
  const [mobileOk, setMob] = useState(false);
  return (
    <Panel title="Prepare the change" note="Stage 4: in a draft or branch, keep the previous version">
      <div className="ws-form">
        <Text label="Preview link" value={previewUrl} onChange={setPreview} />
        <Text label="Previous version kept (deployment, commit or backup)" value={previousVersion} onChange={setPrev} />
        <label className="ws-check">
          <input type="checkbox" checked={desktopOk} onChange={(e) => setDesk(e.target.checked)} />
          Checked on desktop
        </label>
        <label className="ws-check">
          <input type="checkbox" checked={mobileOk} onChange={(e) => setMob(e.target.checked)} />
          Checked on mobile
        </label>
        <Text label="Change summary for the approver" value={summary} onChange={setSummary} area />
        <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'prepare', { reviewId: id, previewUrl, previousVersion, desktopOk, mobileOk, summary }, 'Sent for approval.')}>
          Send for approval
        </button>
      </div>
    </Panel>
  );
}

function ApproveForm({ id, act, noChange }: { id: string; act: Act; noChange: boolean }) {
  const [note, setNote] = useState('');
  return (
    <Panel title="Approve" note={noChange ? 'Stage 5: approve the no-change confirmation' : 'Stage 5: check the preview first'}>
      <Text label="Comment (always needed: what you checked, or what must change)" value={note} onChange={setNote} area />
      <div className="ws-actions">
        <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'approve', { reviewId: id, decision: 'approve', note }, 'Approved.')}>
          Approve
        </button>
        {!noChange && (
          <button className="btn btn-sm" disabled={act.busy} onClick={() => call(act, 'approve', { reviewId: id, decision: 'amend', note }, 'Amendments asked.')}>
            Ask for amendments
          </button>
        )}
        <button className="btn btn-sm" disabled={act.busy} onClick={() => call(act, 'approve', { reviewId: id, decision: 'reject', note }, 'Rejected.')}>
          Reject
        </button>
      </div>
    </Panel>
  );
}

function PublishForm({ id, act, url }: { id: string; act: Act; url: string }) {
  const [versionRef, setVersion] = useState('');
  const [liveUrl, setLive] = useState(url);
  const [issue, setIssue] = useState('');
  return (
    <Panel title="Record publication" note="Stage 6: publish with the usual method, then record it here (manual)">
      <div className="ws-form">
        <Text label="Deployment or version reference" value={versionRef} onChange={setVersion} />
        <Text label="Live address" value={liveUrl} onChange={setLive} />
        <Text label="Any issue during publication" value={issue} onChange={setIssue} />
        <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'publish', { reviewId: id, versionRef, liveUrl, issue }, 'Publication recorded.')}>
          Record publication
        </button>
      </div>
    </Panel>
  );
}

function TestForm({ row, lists, act }: { row: B['reviews'][number]; lists: B['lists']; act: Act }) {
  const init = Object.fromEntries(row.review.tests.map((t) => [t.key, { result: t.result ?? '', note: t.note, evidence: t.evidence, correction: '' }]));
  const [v, setV] = useState<Record<string, { result: string; note: string; evidence: string; correction: string }>>(init);
  const set = (k: string, f: string, val: string) => setV((x) => ({ ...x, [k]: { ...x[k], [f]: val } }));
  return (
    <Panel title="Record tests" note="Stage 7: a failure opens an issue">
      <div className="ws-form">
        {row.review.tests.map((t) => (
          <div key={t.key} className="ws-test">
            <div className="ws-strong">{lists.tests.find(([k]) => k === t.key)?.[1]}</div>
            <div className="ws-actions">
              {(['pass', 'fail', 'na'] as const).map((res) => (
                <label key={res} className="ws-check">
                  <input type="radio" name={`t-${t.key}`} checked={v[t.key].result === res} onChange={() => set(t.key, 'result', res)} />
                  {RESULT[res][1]}
                </label>
              ))}
            </div>
            <input className="input" placeholder="Notes (needed for N/A)" value={v[t.key].note} onChange={(e) => set(t.key, 'note', e.target.value)} />
            <input className="input" placeholder="Evidence (screenshot location, test enquiry)" value={v[t.key].evidence} onChange={(e) => set(t.key, 'evidence', e.target.value)} />
            {t.result === 'fail' && v[t.key].result !== 'fail' && (
              <input className="input" placeholder="What was corrected before testing again" value={v[t.key].correction} onChange={(e) => set(t.key, 'correction', e.target.value)} />
            )}
          </div>
        ))}
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy}
          onClick={() =>
            call(
              act,
              'test',
              {
                reviewId: row.review.id,
                results: Object.entries(v)
                  .filter(([k, x]) => x.result && (x.result !== row.review.tests.find((t) => t.key === k)?.result || x.correction))
                  .map(([key, x]) => ({ key, ...x })),
              },
              'Tests saved.',
            )
          }
        >
          Save tests
        </button>
      </div>
    </Panel>
  );
}

// ---------- Monthly checks ----------

function Checks({ data, go }: { data: B; go: (k: NonNullable<Open>['kind'], id: string) => void }) {
  const act = useAction();
  const [assignTo, setAssignTo] = useState('');
  return (
    <>
      {data.role.itHead && (
        <Panel title="Assign in a batch" note={`${data.month}: one result kept per website`}>
          <ErrorNotice error={act.error} />
          <div className="ws-actions">
            <Select className="select" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
              <option value="">Each website’s own IT administrator</option>
              {data.itTeam.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <button className="btn btn-sm" disabled={act.busy} onClick={() => call(act, 'openChecks', { month: data.month, assignToId: assignTo }, 'Checks assigned.')}>
              Open and assign {data.month}
            </button>
          </div>
        </Panel>
      )}
      <Panel title="Monthly checks" note="Confirmed by a person; automated checks are not connected">
        <div className="list">
          {data.checks.map((c) => (
            <RowButton
              key={c.check.id}
              onClick={() => go('check', c.check.id)}
              title={`${c.companyName} · ${c.siteName}`}
              sub={`${c.kind === 'social' ? 'Social media · ' : c.kind === 'mail' ? 'Email · ' : ''}${c.check.month} · ${c.assignedTo ?? 'no one assigned'}${c.check.doneAt ? ` · done ${dateTimeLabel(c.check.doneAt)}` : ''}`}
              right={
                <>
                  <Pill map={CHECK_STATUS} k={c.status} />
                  <Manual />
                </>
              }
            />
          ))}
          {!data.checks.length && <div className="empty">No checks open for this month.</div>}
        </div>
      </Panel>
    </>
  );
}

function CheckDrawer({ data, id, go, onClose }: { data: B; id: string; go: (k: NonNullable<Open>['kind'], id: string) => void; onClose: () => void }) {
  const row = data.checks.find((x) => x.check.id === id);
  const act = useAction();
  const [v, setV] = useState<Record<string, { result: string; note: string }>>(() =>
    Object.fromEntries((row?.check.items ?? []).map((i) => [i.key, { result: i.result ?? '', note: i.note }])),
  );
  const [na, setNa] = useState('');
  if (!row) return null;
  const c = row.check;
  const results = Object.entries(v)
    .filter(([, x]) => x.result)
    .map(([key, x]) => ({ key, ...x }));
  return (
    <Drawer title={`${row.siteName} · ${c.month}`} sub={`${row.companyName} · ${row.url}`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <Panel title="Checklist" note={<Pill map={CHECK_STATUS} k={row.status} />}>
        <div className="ws-form">
          {c.items.map((it) => (
            <div key={it.key}>
              <div className="ws-spread">
                <span className="ws-strong">{(c.kind === 'social' ? data.lists.social : c.kind === 'mail' ? data.lists.mail : data.lists.monthly).find(([k]) => k === it.key)?.[1]}</span>
                {it.issueId && (
                  <button className="btn btn-sm" onClick={() => go('issue', it.issueId!)}>
                    Issue
                  </button>
                )}
              </div>
              {row.canRecord && !c.doneAt ? (
                <>
                  <div className="ws-actions">
                    {(['pass', 'fail', 'na'] as const).map((res) => (
                      <label key={res} className="ws-check">
                        <input type="radio" name={`c-${it.key}`} checked={v[it.key]?.result === res} onChange={() => setV((x) => ({ ...x, [it.key]: { ...x[it.key], result: res } }))} />
                        {RESULT[res][1]}
                      </label>
                    ))}
                  </div>
                  <input className="input" placeholder="Note" value={v[it.key]?.note ?? ''} onChange={(e) => setV((x) => ({ ...x, [it.key]: { ...x[it.key], note: e.target.value } }))} />
                </>
              ) : (
                <div>
                  {it.result ? <Pill map={RESULT} k={it.result} /> : <Chip tone="neutral">Not entered</Chip>} <span className="muted small">{it.note}</span>
                </div>
              )}
            </div>
          ))}
        </div>
        {c.na && <div className="notice">Not applicable: {c.na.reason}</div>}
      </Panel>
      {row.canRecord && !c.doneAt && (
        <Panel title="Save">
          <div className="ws-actions">
            <button className="btn btn-sm" disabled={act.busy} onClick={() => call(act, 'recordCheck', { checkId: id, results }, 'Saved.')}>
              Save
            </button>
            <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'recordCheck', { checkId: id, results, finish: true }, 'Check completed.')}>
              Complete check
            </button>
          </div>
          <div className="ws-actions ws-gap-top">
            <input className="input" placeholder="Reason it does not apply this month" value={na} onChange={(e) => setNa(e.target.value)} />
            <button className="btn btn-sm" disabled={act.busy} onClick={() => call(act, 'recordCheck', { checkId: id, na }, 'Marked not applicable.')}>
              Not applicable
            </button>
          </div>
        </Panel>
      )}
    </Drawer>
  );
}

// ---------- Issues ----------

function Issues({ data, go }: { data: B; go: (k: NonNullable<Open>['kind'], id: string) => void }) {
  const [raising, setRaising] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const rows = data.issues.filter((i) => showClosed || i.issue.status === 'open' || i.issue.status === 'in_progress');
  return (
    <>
      <Panel
        title="Issues and urgent changes"
        note="Handled at once, not at the quarterly review"
        actions={
          <button className="btn btn-sm btn-primary" onClick={() => setRaising(true)}>
            Report an issue
          </button>
        }
      >
        <div className="ws-toolbar">
          <label className="ws-check">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show resolved and closed
          </label>
        </div>
        <div className="list">
          {rows.map((i) => (
            <RowButton
              key={i.issue.id}
              onClick={() => go('issue', i.issue.id)}
              title={`${i.issue.ref} · ${i.companyName}${i.siteName ? ` · ${i.siteName}` : ''}`}
              sub={`${i.issue.description} · ${i.owner ?? 'no owner'} · due ${dateLabel(i.issue.targetOn)}${i.late ? ' (late)' : ''}`}
              right={
                <>
                  <Chip tone={SEV[i.issue.severity]}>{i.issue.severity}</Chip>
                  <Chip tone="neutral">{i.issue.status.replace('_', ' ')}</Chip>
                </>
              }
            />
          ))}
          {!rows.length && <div className="empty">No open issues.</div>}
        </div>
      </Panel>
      {raising && (
        <Drawer title="Report a website issue" onClose={() => setRaising(false)}>
          <IssueForm data={data} onDone={() => setRaising(false)} />
        </Drawer>
      )}
    </>
  );
}

function IssueForm({ data, onDone }: { data: B; onDone: () => void }) {
  const act = useAction();
  const [companyId, setCompany] = useState(data.companies[0]?.company.id ?? '');
  const [siteId, setSite] = useState('');
  const [category, setCategory] = useState('DOWN');
  const [severity, setSeverity] = useState('high');
  const [description, setDescription] = useState('');
  const [impact, setImpact] = useState('');
  const [immediateAction, setImmediate] = useState('');
  const [ownerId, setOwner] = useState('');
  const sites = data.sites.filter((s) => s.site.companyId === companyId);
  return (
    <div className="ws-form">
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>Company</span>
        <Select className="select" value={companyId} onChange={(e) => (setCompany(e.target.value), setSite(''))}>
          {data.companies.map((c) => (
            <option key={c.company.id} value={c.company.id}>
              {c.company.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span>Website</span>
        <Select className="select" value={siteId} onChange={(e) => setSite(e.target.value)}>
          <option value="">Not about one website</option>
          {sites.map((s) => (
            <option key={s.site.id} value={s.site.id}>
              {s.site.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span>What kind</span>
        <Select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {Object.entries(CATEGORY)
            .filter(([k]) => k !== 'TEST_FAIL')
            .map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
        </Select>
      </label>
      <label className="field">
        <span>How serious</span>
        <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="critical">Critical: tell IT Head now</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </label>
      <Text label="What is wrong" value={description} onChange={setDescription} area />
      <Text label="Business impact" value={impact} onChange={setImpact} />
      <Text label="Immediate action taken" value={immediateAction} onChange={setImmediate} />
      {data.role.canDelegateIssue && <PersonPick data={data} value={ownerId} onChange={setOwner} label="IT Manager delegation (blank: unassigned pending delegation)" it />}
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy}
        onClick={async () => {
          const ok = await call(act, 'raiseIssue', { companyId, siteId, category, severity, description, impact, immediateAction, ownerId }, 'Issue reported.');
          if (ok) onDone();
        }}
      >
        Report
      </button>
    </div>
  );
}

function IssueDrawer({ data, id, go, onClose }: { data: B; id: string; go: (k: NonNullable<Open>['kind'], id: string) => void; onClose: () => void }) {
  const row = data.issues.find((x) => x.issue.id === id);
  const act = useAction();
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState('');
  const [ownerId, setOwner] = useState('');
  const [targetOn, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [changed, setChanged] = useState('');
  const [checks, setChecks] = useState('');
  if (!row) return null;
  const i = row.issue;
  const open = i.status === 'open' || i.status === 'in_progress';
  const step = (s: string, extra: Record<string, unknown>, ok: string) => call(act, 'issueStep', { issueId: id, step: s, ...extra }, ok);
  const isCompanyApprover = data.role.head || data.role.group || data.reviews.some((r) => r.review.companyId === i.companyId && r.can.approve);
  return (
    <Drawer title={`${i.ref} · ${CATEGORY[i.category]}`} sub={`${row.companyName}${row.siteName ? ` · ${row.siteName}` : ''}`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <Panel title="Issue">
        <div className="list">
          <Line k="Severity">
            <Chip tone={SEV[i.severity]}>{i.severity}</Chip>
          </Line>
          <Line k="Status">{i.status.replace('_', ' ')}</Line>
          <Line k="What">{i.description}</Line>
          <Line k="Reported">
            {i.reportedBy}, {dateTimeLabel(i.at)}
          </Line>
          <Line k="Responsible IT">{row.owner ?? 'Not assigned'}</Line>
          <Line k="Business impact">{i.impact || '–'}</Line>
          <Line k="Immediate action">{i.immediateAction || '–'}</Line>
          <Line k="Escalated to">{row.escalateTo ?? '–'}</Line>
          <Line k="Target">
            {dateLabel(i.targetOn)}
            {row.late ? ' (late)' : ''}
          </Line>
          {i.origin.kind !== 'manual' && i.origin.id && (
            <Line k="Came from">
              {i.origin.kind === 'review' ? (
                <button className="btn btn-sm" onClick={() => go('review', i.origin.id!)}>
                  Quarterly review
                </button>
              ) : i.origin.kind === 'check' ? (
                <button className="btn btn-sm" onClick={() => go('check', i.origin.id!)}>
                  Monthly check
                </button>
              ) : (
                i.origin.kind
              )}
            </Line>
          )}
          {i.resolution && (
            <Line k="Resolution">
              {i.resolution.note} · evidence: {i.resolution.evidence} ({i.resolution.by})
            </Line>
          )}
        </div>
      </Panel>
      {i.urgent && (
        <Panel title="Urgent change" note={<Manual />}>
          <div className="list">
            <Line k="Why it could not wait">{i.urgent.reason}</Line>
            <Line k="Approved by">
              {i.urgent.approvedBy}, {dateTimeLabel(i.urgent.at)}
            </Line>
            <Line k="Changed">{i.urgent.changed}</Line>
            <Line k="Published">{i.urgent.publishedAt ? dateTimeLabel(i.urgent.publishedAt) : 'Not yet'}</Line>
            {i.urgent.checks && <Line k="Checks after publishing">{i.urgent.checks}</Line>}
          </div>
        </Panel>
      )}
      {open && !i.urgent && isCompanyApprover && (
        <Panel title="Approve an urgent change" note="Remove or fix unsafe or wrong information now">
          <Text label="Why it cannot wait" value={reason} onChange={setReason} />
          <Text label="What will be changed or removed" value={changed} onChange={setChanged} area />
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'urgentChange', { issueId: id, reason, changed }, 'Urgent change approved.')}>
            Approve urgent change
          </button>
        </Panel>
      )}
      {i.urgent && !i.urgent.publishedAt && (data.role.itHead || row.canWork) && (
        <Panel title="Record the urgent publication">
          <Text label="Checks done after publishing" value={checks} onChange={setChecks} area />
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'urgentChange', { issueId: id, checks }, 'Recorded.')}>
            Published and checked
          </button>
        </Panel>
      )}
      {open && (row.ticketPolicy?.canAssign===true||row.legacyActions?.canAssign===true) && (
        <Panel title="Assign">
          <PersonPick data={data} value={ownerId} onChange={setOwner} label="Responsible IT staff" it />
          <label className="field">
            <span>Due</span>
            <input className="input" type="date" value={targetOn} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <button className="btn btn-sm" disabled={act.busy} onClick={() => step('assign', { ownerId, targetOn }, 'Assigned.')}>
            Assign
          </button>
        </Panel>
      )}
      {row.canWork && (
        <Panel title="Work it">
          <Text label="Note or what was done" value={note} onChange={setNote} area />
          <Text label="Evidence it works (needed to resolve)" value={evidence} onChange={setEvidence} />
          <p className="small muted">Resolution note and evidence are preserved without truncation. Note: 3–680 characters; evidence: 3–300 characters. This records work, not independent confirmation.</p>
          <div className="ws-actions">
            {i.status === 'open' && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => step('start', {}, 'Started.')}>
                Start
              </button>
            )}
            <button className="btn btn-sm" disabled={act.busy} onClick={() => step('note', { note }, 'Note added.')}>
              Add note
            </button>
            {open && (
              <button className="btn btn-sm btn-primary" disabled={act.busy||note.trim().length<3||note.trim().length>680||evidence.trim().length<3||evidence.trim().length>300} onClick={() => {if(note.trim().length<3||note.trim().length>680||evidence.trim().length<3||evidence.trim().length>300)return;void step('resolve', { note:note.trim(), evidence:evidence.trim() }, 'Resolved.')}}>
                Resolve
              </button>
            )}
          </div>
        </Panel>
      )}
      {row.legacyActions&&<LegacyWebsiteActions key={id} capabilities={row.legacyActions} submit={(action,note)=>api.websiteAction('issueStep',{issueId:id,step:action,...(note?{note}:{})})}/>}
      {row.ticketPolicy&&<WebTicketReview key={id} linkedClosed={i.status==='closed'} policy={row.ticketPolicy} submit={(action,note,expectedResolutionVersion)=>api.websiteAction('issueStep',{issueId:id,step:action==='reopen'?'reopen':'close',note,expectedResolutionVersion,...(action==='reopen'?{}:{fixed:action==='confirm'})})}/>}
      <Panel title="History">
        <div className="list">
          {[...i.history].reverse().map((h, k) => (
            <Line key={k} k={`${dateTimeLabel(h.at)} · ${h.by}`}>
              {h.text}
            </Line>
          ))}
        </div>
      </Panel>
    </Drawer>
  );
}

// ---------- DNS change control ----------

function DnsWarning() {
  return (
    <div className="notice" data-tone="warn">
      Changing nameservers at GoDaddy or another registrar moves every DNS record, not only the website. Write down the existing records first, especially the Microsoft
      365 records (MX, autodiscover, SPF, DKIM, DMARC), or company email can stop.
    </div>
  );
}

function DnsList({ data, go }: { data: B; go: (k: NonNullable<Open>['kind'], id: string) => void }) {
  return (
    <Panel title="DNS and nameserver changes" note="Raise one from the domain">
      <DnsWarning />
      <div className="list">
        {data.dns.map((c) => (
          <RowButton
            key={c.change.id}
            onClick={() => go('dns', c.change.id)}
            title={`${c.change.ref} · ${c.domainName}`}
            sub={`${c.change.reason} · window ${dateTimeLabel(c.change.windowFrom)} · ${c.owner ?? ''}${c.m365 ? ' · Microsoft 365 email on this domain' : ''}`}
            right={<Chip tone={c.change.status === 'done' ? 'ok' : c.change.status === 'draft' ? 'warn' : 'info'}>{c.change.status}</Chip>}
          />
        ))}
        {!data.dns.length && <div className="empty">No DNS changes recorded.</div>}
      </div>
    </Panel>
  );
}

function DnsForm({ data, domainId, m365, onDone }: { data: B; domainId: string; m365: boolean | null; onDone: () => void }) {
  const act = useAction();
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [ownerId, setOwner] = useState('');
  return (
    <div className="ws-form">
      <DnsWarning />
      {m365 && <div className="notice" data-tone="crit">This domain carries Microsoft 365 email.</div>}
      <ErrorNotice error={act.error} />
      <Text label="What will change and why" value={reason} onChange={setReason} area />
      <label className="field">
        <span>Window starts</span>
        <input className="input" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="field">
        <span>Window ends</span>
        <input className="input" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <PersonPick data={data} value={ownerId} onChange={setOwner} label="IT owner (blank: you)" it />
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy}
        onClick={async () => {
          const ok = await call(act, 'raiseDns', { domainId, reason, windowFrom: from ? `${from}:00+08:00` : '', windowTo: to ? `${to}:00+08:00` : '', ownerId }, 'DNS change raised.');
          if (ok) onDone();
        }}
      >
        Raise change
      </button>
    </div>
  );
}

function DnsDrawer({ data, id, onClose }: { data: B; id: string; onClose: () => void }) {
  const row = data.dns.find((x) => x.change.id === id);
  const act = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [finalConfig, setFinal] = useState('');
  const [incident, setIncident] = useState('');
  if (!row) return null;
  const c = row.change;
  const step = (s: string, extra: Record<string, unknown>, ok: string) => call(act, 'dnsStep', { changeId: id, step: s, ...extra }, ok);
  return (
    <Drawer title={`${c.ref} · ${row.domainName}`} sub={c.reason} onClose={onClose}>
      <DnsWarning />
      <ErrorNotice error={act.error} />
      <Panel title="Before the change" note={c.approval ? `Approved by ${c.approval.by}` : 'IT Head approves once every item is done'}>
        <div className="list">
          {data.lists.dnsPre.map(([k, label]) => {
            const p = c.pre.find((x) => x.key === k)!;
            return (
              <div key={k} className="list-item ws-wrap">
                <span>{label}</span>
                {p.doneAt ? (
                  <span className="muted small">
                    Done by {p.by}
                    {p.note ? `: ${p.note}` : ''}
                  </span>
                ) : row.canWork && c.status === 'draft' ? (
                  <span className="ws-chips">
                    <input className="input" placeholder="Where it is recorded" value={notes[k] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [k]: e.target.value }))} />
                    <button className="btn btn-sm" disabled={act.busy} onClick={() => step('pre', { key: k, note: notes[k] ?? '' }, 'Done.')}>
                      Done
                    </button>
                  </span>
                ) : (
                  <Chip tone="warn">Not done</Chip>
                )}
              </div>
            );
          })}
        </div>
        {row.canApprove && (
          <>
            <Text label="Approval comment (needed: what you checked)" value={notes.approve ?? ''} onChange={(x) => setNotes((n) => ({ ...n, approve: x }))} />
            <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => step('approve', { note: notes.approve ?? '' }, 'Approved.')}>
              Approve (IT Lead)
            </button>
          </>
        )}
      </Panel>
      {c.status !== 'draft' && (
        <Panel title="After the change">
          <div className="list">
            {data.lists.dnsPost.map(([k, label]) => {
              const p = c.post.find((x) => x.key === k)!;
              return (
                <div key={k} className="list-item ws-wrap">
                  <span>{label}</span>
                  {p.result ? (
                    <Pill map={RESULT} k={p.result} />
                  ) : row.canWork && c.status === 'approved' ? (
                    <span className="ws-chips">
                      {(['pass', 'fail', 'na'] as const).map((res) => (
                        <button key={res} className="btn btn-sm" disabled={act.busy} onClick={() => step('post', { key: k, result: res }, 'Saved.')}>
                          {RESULT[res][1]}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <Chip tone="neutral">Not entered</Chip>
                  )}
                </div>
              );
            })}
          </div>
          {c.status === 'approved' && row.canWork && (
            <div className="ws-form ws-gap-top">
              <Text label="Final DNS set-up" value={finalConfig} onChange={setFinal} area />
              <Text label="Incident and resolution (needed if a test failed)" value={incident} onChange={setIncident} />
              <div className="ws-actions">
                <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => step('finish', { finalConfig, incident }, 'Change closed.')}>
                  Close the change
                </button>
                <button className="btn btn-sm" disabled={act.busy} onClick={() => step('rollback', { incident }, 'Rolled back.')}>
                  Roll back
                </button>
              </div>
            </div>
          )}
          {c.finalConfig && <p className="muted small">Final: {c.finalConfig}</p>}
          {c.incident && <p className="muted small">Incident: {c.incident}</p>}
        </Panel>
      )}
      {c.status === 'draft' && row.canWork && (
        <button className="btn btn-sm" disabled={act.busy} onClick={() => step('cancel', {}, 'Cancelled.')}>
          Cancel change
        </button>
      )}
    </Drawer>
  );
}

// ---------- Reports ----------

/** CSV opens in spreadsheet software: quoted text alone does not prevent formula execution. */
function reportCsvCell(value: string | number): string {
  let text = String(value);
  // Preserve numeric values; neutralise formula-like text even after whitespace/control prefixes.
  if (typeof value === 'string' && /^[\s\u0000-\u001f\u007f-\u009f\u200b-\u200d]*[=+@-]/u.test(value)) text = "'" + value;
  return `"${text.replace(/"/g, '""')}"`;
}

type Report = { key: string; title: string; head: string[]; rows: (string | number)[][] };

function Reports({ data }: { data: B }) {
  const { me } = useApp();
  const [which, setWhich] = useState('register');
  const [company, setCompany] = useState('');
  const [itAdmin, setItAdmin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const co = (id: string) => !company || id === company;
  const reports: Report[] = [
    {
      key: 'register',
      title: 'Group website and domain register',
      head: ['Company', 'Head of Company', 'Website status', 'Domain status', 'Domains', 'Websites', 'IT administrator', 'Backup', 'Content owner', 'Approver'],
      rows: data.companies
        .filter((c) => co(c.company.id) && (!itAdmin || c.itAdmin === itAdmin))
        .map((c) => [c.company.name, c.head, SITE_STATUS[c.websiteStatus][1], DOMAIN_STATUS[c.domainStatus][1], c.domainCount, c.siteCount, c.itAdmin ?? '', c.backup ?? '', c.contentOwner ?? '', c.approver ?? '']),
    },
    {
      key: 'reviews',
      title: 'Quarterly review completion',
      head: ['Quarter', 'Company', 'Website', 'Status', 'Stage', 'Company answers by', 'Outstanding'],
      rows: data.reviews
        .filter((r) => co(r.review.companyId) && (!itAdmin || r.owners.itAdmin === itAdmin))
        .map((r) => [r.review.quarter, r.companyName, r.siteName, Q_STATUS[r.label][1], r.stageLabel, r.review.responseDue, r.review.completed?.outstanding.join('; ') ?? '']),
    },
    {
      key: 'checks',
      title: 'Monthly website checks',
      head: ['Month', 'Company', 'Website', 'Assigned to', 'Status', 'Failed items', 'Source'],
      rows: data.checks
        .filter((c) => co(c.check.companyId) && (!itAdmin || c.assignedTo === itAdmin))
        .map((c) => [c.check.month, c.companyName, c.siteName, c.assignedTo ?? '', CHECK_STATUS[c.status][1], c.check.items.filter((i) => i.result === 'fail').length, 'Manual']),
    },
    {
      key: 'renewals',
      title: 'Domain renewals',
      head: ['Domain', 'Companies', 'Registrar', 'Expires', 'Days left', 'Auto-renewal', 'Payment owner', 'Payment', 'Escalated'],
      rows: data.domains
        .filter((d) => d.domain.companyIds.some(co) && (!itAdmin || d.itAdmin === itAdmin))
        .map((d) => [d.domain.name, d.companyNames.join(' + '), d.domain.registrar, d.domain.expiresOn ?? 'Unknown', d.days ?? '', d.domain.autoRenew, d.renewalOwner ?? '', d.domain.payment?.status ?? '', d.escalate ? 'Yes' : '']),
    },
    {
      key: 'issues',
      title: 'Outstanding issues and incidents',
      head: ['Ref', 'Company', 'Website', 'Category', 'Severity', 'Status', 'Owner', 'Due', 'Late'],
      rows: data.issues
        .filter((i) => co(i.issue.companyId) && (!itAdmin || i.owner === itAdmin) && i.issue.status !== 'closed')
        .map((i) => [i.issue.ref, i.companyName, i.siteName ?? '', CATEGORY[i.issue.category], i.issue.severity, i.issue.status, i.owner ?? '', i.issue.targetOn, i.late ? 'Yes' : '']),
    },
    {
      key: 'coverage',
      title: 'Company coverage and missing information',
      head: ['Company', 'Website needed', 'Website', 'Domain', 'Missing'],
      rows: data.companies.filter((c) => co(c.company.id) && c.incomplete).map((c) => [c.company.name, c.websiteRequired, SITE_STATUS[c.websiteStatus][1], DOMAIN_STATUS[c.domainStatus][1], c.missing.join('; ')]),
    },
    {
      key: 'workload',
      title: 'IT staff workload',
      head: ['Staff', 'Websites', 'Backup for', 'Checks open', 'Reviews open', 'Issues open'],
      rows: data.workload.map((w) => [w.name, w.sites, w.backupFor, w.checksOpen, w.reviewsOpen, w.issuesOpen]),
    },
    {
      key: 'exceptions',
      title: 'Management exceptions',
      head: ['Kind', 'Company', 'Item', 'Detail'],
      rows: [
        ...data.reviews.filter((r) => r.overdue && co(r.review.companyId)).map((r) => ['Overdue review', r.companyName, r.siteName, `${r.review.quarter}: ${r.stageLabel}`]),
        ...data.domains.filter((d) => d.escalate && d.domain.companyIds.some(co)).map((d) => ['Renewal not confirmed', d.companyNames.join(' + '), d.domain.name, d.days == null ? '' : `${d.days} days`]),
        ...data.issues
          .filter((i) => co(i.issue.companyId) && (i.issue.severity === 'critical' || i.late) && (i.issue.status === 'open' || i.issue.status === 'in_progress'))
          .map((i) => [i.issue.severity === 'critical' ? 'Critical issue' : 'Late issue', i.companyName, i.issue.ref, i.issue.description]),
        ...data.companies.filter((c) => co(c.company.id) && c.missing.some((m) => /owner|administrator|approver|Head/.test(m))).map((c) => ['Missing owner', c.company.name, '', c.missing.join('; ')]),
      ],
    },
  ];
  const rep = reports.find((x) => x.key === which)!;
  const csv = () => {
    const esc = reportCsvCell;
    const text = [`${rep.title} (${dataNotice(me.dataMode)}, ${data.today})`, rep.head.map(esc).join(','), ...rep.rows.map((r) => r.map(esc).join(','))].join('\r\n');
    saveFile(`${rep.key}-${data.today}.csv`, new Blob(['﻿' + text], { type: 'text/csv' })).then(setMsg);
  };
  const itNames = [...new Set(data.itTeam.map((t) => t.name))];
  return (
    <Panel title="Reports" note="Opens in Excel; print to save as PDF">
      <div className="ws-toolbar">
        <Select className="select" aria-label="Report" value={which} onChange={(e) => setWhich(e.target.value)}>
          {reports.map((x) => (
            <option key={x.key} value={x.key}>
              {x.title}
            </option>
          ))}
        </Select>
        <Select className="select" aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
          <option value="">Every company</option>
          {data.companies.map((c) => (
            <option key={c.company.id} value={c.company.id}>
              {c.company.name}
            </option>
          ))}
        </Select>
        {itNames.length > 0 && (
          <Select className="select" aria-label="IT administrator" value={itAdmin} onChange={(e) => setItAdmin(e.target.value)}>
            <option value="">Every IT administrator</option>
            {itNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        )}
        <button className="btn btn-sm" onClick={csv}>
          Export (Excel)
        </button>
        <button className="btn btn-sm" onClick={() => void printPage('Websites')}>
          Print or PDF
        </button>
      </div>
      {msg && <div className="notice">{msg}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {rep.head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rep.rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
            {!rep.rows.length && (
              <tr>
                <td colSpan={rep.head.length}>Nothing to report.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------- Settings ----------

function Settings({ data }: { data: B }) {
  const s = data.settings;
  const act = useAction();
  const [f, setF] = useState({
    reminders: s.domainReminderDays.join(', '),
    escalate: String(s.renewalEscalateDays),
    requestDay: String(s.requestDay),
    responseDays: String(s.responseDays),
    approvalDays: String(s.approvalDays),
    reminder: String(s.responseReminderDays),
    monthlyDueDay: String(s.monthlyDueDay),
    blockSelf: s.blockSelfApproval,
    auto: s.autoSchedule,
    checkReminder: String(s.checkReminderDays),
    overdueEscalate: String(s.overdueEscalateDays),
  });
  const [esc, setEsc] = useState(s.escalationIds[0] ?? '');
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Panel title="Settings" note={s.updatedBy ? `Last changed by ${s.updatedBy}` : 'Proposed defaults, for approval'}>
      <ErrorNotice error={act.error} />
      <div className="ws-form">
        <Text label="Domain reminders (days before expiry)" value={f.reminders} onChange={set('reminders')} />
        <Text label="Escalate an unconfirmed renewal this many days before expiry" value={f.escalate} onChange={set('escalate')} />
        <Text label="Review opens (days after the quarter starts)" value={f.requestDay} onChange={set('requestDay')} />
        <Text label="Company answers by (days after the quarter starts)" value={f.responseDays} onChange={set('responseDays')} />
        <Text label="Approval by (days after the quarter starts)" value={f.approvalDays} onChange={set('approvalDays')} />
        <Text label="Remind the company (days before its deadline)" value={f.reminder} onChange={set('reminder')} />
        <Text label="Monthly check due by day of month" value={f.monthlyDueDay} onChange={set('monthlyDueDay')} />
        <Text label="Remind the checker (days before the monthly check is due)" value={f.checkReminder} onChange={set('checkReminder')} />
        <Text label="Tell management this many days after a deadline is missed" value={f.overdueEscalate} onChange={set('overdueEscalate')} />
        <PersonPick data={data} value={esc} onChange={setEsc} label="Management escalation recipient" />
        <label className="ws-check">
          <input type="checkbox" checked={f.auto} onChange={(e) => setF((x) => ({ ...x, auto: e.target.checked }))} />
          Open reviews and checks and send reminders automatically
        </label>
        <label className="ws-check">
          <input type="checkbox" checked={f.blockSelf} onChange={(e) => setF((x) => ({ ...x, blockSelf: e.target.checked }))} />
          Nobody approves content they submitted
        </label>
        <p className="muted small">Reviews complete by the last day of the quarter (Asia/Kuala_Lumpur time).</p>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy}
          onClick={() =>
            call(
              act,
              'saveSettings',
              {
                domainReminderDays: f.reminders.split(',').map((x) => Number(x.trim())),
                renewalEscalateDays: f.escalate,
                requestDay: f.requestDay,
                responseDays: f.responseDays,
                approvalDays: f.approvalDays,
                responseReminderDays: f.reminder,
                monthlyDueDay: f.monthlyDueDay,
                blockSelfApproval: f.blockSelf,
                autoSchedule: f.auto,
                checkReminderDays: f.checkReminder,
                overdueEscalateDays: f.overdueEscalate,
                escalationIds: esc ? [esc] : [],
              },
              'Settings saved.',
            )
          }
        >
          Save settings
        </button>
      </div>
    </Panel>
  );
}

// ---------- Connectors (Fauzan, 31 Oct 2026) ----------

function Connectors({ data }: { data: B }) {
  const act = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const anyOn = data.integrations.some((i) => i.on);
  return (
    <Panel title="Connections" note="Supported readers are off until authorized configuration is complete. Microsoft 365 delivery is unavailable in this pilot; manual work remains available.">
      <ErrorNotice error={act.error} />
      <div className="ws-conns">
        {data.integrations.map((i) => (
          <div key={i.key} className="ws-conn" data-on={i.on ? 'true' : 'false'}>
            <div className="ws-conn-head">
              <span className="ws-strong">{i.name}</span>
              {!i.on ? (
                <Chip tone="unknown">Off</Chip>
              ) : !i.state ? (
                <Chip tone="info">{data.canSync ? 'On, not read yet' : 'Enabled; read status unavailable here'}</Chip>
              ) : i.state.ok ? (
                <Chip tone="ok">Read {i.state.lastSync ? dateTimeLabel(i.state.lastSync) : ''}</Chip>
              ) : (
                <Chip tone="crit">Failed: {i.state.error}</Chip>
              )}
            </div>
            <span className="muted small">{i.key === 'm365' ? 'Unavailable in this pilot: Microsoft 365 delivery is disabled. A legacy enabled flag may only be switched off.' : i.on ? i.reads : i.manual}</span>
            {i.state && i.state.unmatched.length > 0 && <span className="muted small">Not in the register: {i.state.unmatched.slice(0, 8).join(', ')}{i.state.unmatched.length > 8 ? ' …' : ''}</span>}
            {data.canConnect && (
              <div className="ws-inline-form">
                <Text label="Comment (needed)" value={notes[i.key] ?? ''} onChange={(x) => setNotes((n) => ({ ...n, [i.key]: x }))} />
                <button className="btn btn-sm" disabled={act.busy || (i.key === 'm365' && !i.on)} onClick={() => { if (act.busy || (i.key === 'm365' && !i.on)) return; return call(act, 'setConnector', { key: i.key, on: !i.on, note: notes[i.key] ?? '' }, `${i.name} switched ${i.on ? 'off' : 'on'}.`); }}>
                  {i.on ? 'Switch off' : i.key === 'm365' ? 'Unavailable in this pilot' : 'Switch on'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {data.canSync && anyOn && (
        <button
          className="btn btn-sm btn-primary ws-gap-top"
          disabled={act.busy}
          onClick={() =>
            act.run(
              () => api.websiteSync(),
              (r) => (r.ran.length ? `Read attempt finished for ${r.ran.join(', ')}: check each connection status. ${r.issues.length} issues opened; ${r.notices} notices inside Prima. Automatic Mail/Teams delivery is unavailable.` : 'Nothing read: no switched-on connector has its key on the server.'),
            )
          }
        >
          Read connectors now
        </button>
      )}
    </Panel>
  );
}

function SpInbox({ data }: { data: B }) {
  const act = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [company, setCompany] = useState<Record<string, string>>({});
  return (
    <Panel title="Website requests from SharePoint" note="IT Manager: accept (becomes a website issue) or decline, with a comment">
      <ErrorNotice error={act.error} />
      <div className="list">
        {data.spInbox.map((x) => (
          <div key={x.id} className="ws-item">
            <strong>
              {x.kind === 'proposal' ? 'Proposal' : x.kind === 'instruction' ? 'Instruction' : 'Change'}: {x.title}
            </strong>
            <span className="muted small">
              {x.requestedBy} · {x.at ? dateTimeLabel(x.at) : ''} {x.siteUrl ? `· ${x.siteUrl}` : ''}
            </span>
            {x.detail && <span>{x.detail}</span>}
            <label className="small">
              Company{' '}
              <Select value={company[x.id] ?? ''} onChange={(e) => setCompany((c) => ({ ...c, [x.id]: e.target.value }))}>
                <option value="">Match by website address</option>
                {data.companies.map((c) => (
                  <option key={c.company.id} value={c.company.id}>
                    {c.company.name}
                  </option>
                ))}
              </Select>
            </label>
            <Text label="Comment (needed)" value={notes[x.id] ?? ''} onChange={(v) => setNotes((n) => ({ ...n, [x.id]: v }))} />
            <div className="ws-actions">
              <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'spDecide', { id: x.id, accept: true, note: notes[x.id] ?? '', companyId: company[x.id] || undefined }, 'Accepted: website issue opened.')}>
                Accept
              </button>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => call(act, 'spDecide', { id: x.id, accept: false, note: notes[x.id] ?? '' }, 'Declined.')}>
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AcceptDns({ data, domainId }: { data: B; domainId: string }) {
  const act = useAction();
  const [note, setNote] = useState('');
  if (!data.role.tech && !data.role.admin) return <p className="notice" data-tone="warn">DNS records changed outside an approved change. An issue is open; the IT Lead decides.</p>;
  return (
    <Panel title="DNS changed outside an approved change" note="IT Lead: compare with the last export first">
      <ErrorNotice error={act.error} />
      <Text label="Comment (needed: what you compared and why it is right)" value={note} onChange={setNote} area />
      <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'acceptDns', { domainId, note }, 'New DNS records accepted.')}>
        Accept current records as correct
      </button>
    </Panel>
  );
}

// ---------- Social media and email (Fauzan, 31 Oct 2026) ----------

function Flags({ flags }: { flags: string[] }) {
  if (!flags.length) return <Chip tone="ok">In order</Chip>;
  return <Chip tone="warn">{flags.length === 1 ? flags[0] : `${flags.length} to fix`}</Chip>;
}

function Social({ data, go }: { data: B; go: (k: NonNullable<Open>['kind'], id: string) => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Panel
        title="Social media and online listings"
        note="Who holds each account and who can get in matters most; posts are checked every month"
        actions={
          (data.role.it || data.role.admin) && (
            <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
              Add account
            </button>
          )
        }
      >
        <div className="list">
          {data.social.map((a) => (
            <RowButton
              key={a.account.id}
              onClick={() => go('social', a.account.id)}
              title={`${a.platform}: ${a.account.name}`}
              sub={`${a.companyName} · ${a.account.admins.length} admin${a.account.admins.length === 1 ? '' : 's'} · IT: ${a.itAdmin ?? 'none'}${a.account.lastPostOn ? ` · last post ${dateLabel(a.account.lastPostOn)}` : ''}`}
              right={<Flags flags={a.flags} />}
            />
          ))}
          {!data.social.length && <div className="empty">No social media accounts recorded yet.</div>}
        </div>
      </Panel>
      {adding && <SocialForm data={data} onDone={() => setAdding(false)} />}
    </>
  );
}

function SocialForm({ data, account, onDone }: { data: B; account?: B['social'][number]['account']; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    companyId: account?.companyId ?? '',
    platform: account?.platform ?? 'facebook',
    name: account?.name ?? '',
    url: account?.url ?? '',
    status: account?.status ?? 'active',
    statusReason: account?.statusReason ?? '',
    ownership: account?.ownership ?? 'unknown',
    holder: account?.holder ?? '',
    recoveryEmail: account?.recoveryEmail ?? '',
    lastPostOn: account?.lastPostOn ?? '',
    itAdminId: account?.itAdminId ?? '',
    vaultEntry: account?.vault?.entry ?? '',
    note: account?.note ?? '',
  });
  const [admins, setAdmins] = useState(account?.admins ?? [{ name: '', companyEmail: true, twoFactor: null as boolean | null }]);
  const set = (k: keyof typeof f) => (x: string) => setF((y) => ({ ...y, [k]: x }));
  return (
    <Panel title={account ? 'Edit account' : 'Add account'} note="Never a password: only where the sign-in is kept">
      <ErrorNotice error={act.error} />
      <div className="ws-form">
        {!account && (
          <label className="small">
            Company{' '}
            <Select className="select" value={f.companyId} onChange={(e) => set('companyId')(e.target.value)}>
              <option value="">Choose</option>
              {data.companies.map((c) => (
                <option key={c.company.id} value={c.company.id}>
                  {c.company.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="small">
          Platform{' '}
          <Select className="select" value={f.platform} onChange={(e) => set('platform')(e.target.value)}>
            {Object.entries(data.platforms).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </label>
        <Text label="Page or account name" value={f.name} onChange={set('name')} />
        <Text label="Address (link)" value={f.url} onChange={set('url')} />
        <label className="small">
          Status{' '}
          <select className="select" value={f.status} onChange={(e) => set('status')(e.target.value)}>
            <option value="active">Active</option>
            <option value="dormant">Dormant</option>
            <option value="closed">Closed</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        {(f.status==='dormant'||f.status==='closed')&&<Text label="Reason for dormant or closed status (required)" value={f.statusReason} onChange={set('statusReason')} area/>}
        <label className="small">
          Held by{' '}
          <select className="select" value={f.ownership} onChange={(e) => set('ownership')(e.target.value)}>
            <option value="business_portfolio">Company business portfolio (Meta) or business account</option>
            <option value="company_page">Company page or company Google account</option>
            <option value="personal">One person’s own account</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <Text label="Holder (business portfolio or account name)" value={f.holder} onChange={set('holder')} />
        <Text label="Recovery email (a company address)" value={f.recoveryEmail} onChange={set('recoveryEmail')} />
        <p className="small muted">Known valid last-post dates on active accounts drive a 180-day inactivity notice to the company Manager, or IT Manager fallback. Missing or invalid dates remain unknown; the separate 90-day access review is unchanged.</p>
        <Text label="Last post (YYYY-MM-DD)" value={f.lastPostOn} onChange={set('lastPostOn')} />
        <PersonPick data={data} value={f.itAdminId} onChange={set('itAdminId')} label="IT administrator" />
        <Text label="Password manager entry (name only)" value={f.vaultEntry} onChange={set('vaultEntry')} />
        <strong className="small">Admins</strong>
        {admins.map((a, k) => (
          <div key={k} className="ws-actions">
            <input className="input" placeholder="Name and role" value={a.name} onChange={(e) => setAdmins((x) => x.map((y, j) => (j === k ? { ...y, name: e.target.value } : y)))} />
            <label className="ws-check small">
              <input type="checkbox" checked={a.companyEmail} onChange={(e) => setAdmins((x) => x.map((y, j) => (j === k ? { ...y, companyEmail: e.target.checked } : y)))} />
              Company email
            </label>
            <label className="ws-check small">
              <input type="checkbox" checked={a.twoFactor === true} onChange={(e) => setAdmins((x) => x.map((y, j) => (j === k ? { ...y, twoFactor: e.target.checked } : y)))} />
              Two-step sign-in on
            </label>
            <button className="btn btn-sm" onClick={() => setAdmins((x) => x.filter((_, j) => j !== k))}>
              Remove
            </button>
          </div>
        ))}
        <button className="btn btn-sm" onClick={() => setAdmins((x) => [...x, { name: '', companyEmail: true, twoFactor: null }])}>
          Add admin
        </button>
        <Text label="Notes" value={f.note} onChange={set('note')} area />
        <div className="ws-actions">
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || ((f.status==='dormant'||f.status==='closed')&&(f.statusReason.trim().length<3||f.statusReason.trim().length>500))}
            onClick={async () => {
              if((f.status==='dormant'||f.status==='closed')&&(f.statusReason.trim().length<3||f.statusReason.trim().length>500))return;
              const r = await act.run(() => api.websiteAction('saveSocial', { ...f, statusReason:f.statusReason.trim(), id: account?.id, admins: admins.filter((a) => a.name.trim()) }), 'Saved.');
              if (r) onDone();
            }}
          >
            Save
          </button>
          <button className="btn btn-sm" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </Panel>
  );
}

function SocialDrawer({ data, id, onClose }: { data: B; id: string; onClose: () => void }) {
  const row = data.social.find((x) => x.account.id === id);
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [removed, setRemoved] = useState('');
  if (!row) return null;
  const a = row.account;
  return (
    <Drawer title={`${row.platform}: ${a.name}`} sub={row.companyName} onClose={onClose}>
      <ErrorNotice error={act.error} />
      {editing ? (
        <SocialForm data={data} account={a} onDone={() => setEditing(false)} />
      ) : (
        <>
          {row.flags.length > 0 && (
            <Panel title="To fix">
              <ul>
                {row.flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Account">
            <div className="list">
              <Line k="Status">{a.status}</Line>
              <Line k="Address">{a.url || '–'}</Line>
              <Line k="Held by">{a.ownership === 'business_portfolio' ? 'Company business portfolio' : a.ownership === 'company_page' ? 'Company page or account' : a.ownership === 'personal' ? 'One person’s own account' : 'Unknown'}</Line>
              <Line k="Holder">{a.holder || '–'}</Line>
              <Line k="Recovery email">{a.recoveryEmail || '–'}</Line>
              <Line k="Last post">{a.lastPostOn ? dateLabel(a.lastPostOn) : 'Unknown'}</Line>
              <Line k="IT administrator">{row.itAdmin ?? 'None'}</Line>
              <Line k="Sign-in kept in">{a.vault ? `${a.vault.manager}: ${a.vault.entry}` : 'Not recorded'}</Line>
              <Line k="Last access review">{a.accessReview ? `${dateTimeLabel(a.accessReview.at)} by ${a.accessReview.by}: ${a.accessReview.note}` : 'Never'}</Line>
            </div>
          </Panel>
          <Panel title="Admins" note={`${a.admins.length}`}>
            <div className="list">
              {a.admins.map((x) => (
                <Line key={x.name} k={x.name}>
                  {x.companyEmail ? <Chip tone="ok">Company email</Chip> : <Chip tone="warn">Personal email</Chip>}{' '}
                  {x.twoFactor ? <Chip tone="ok">Two-step on</Chip> : <Chip tone="warn">Two-step not confirmed</Chip>}
                </Line>
              ))}
            </div>
          </Panel>
          {row.canEdit && (
            <>
              <Panel title="Access review" note="Every 90 days: who is admin, leavers removed, two-step sign-in">
                <Text label="Comment (needed: who has access now and what you checked)" value={note} onChange={setNote} area />
                <Text label="Removed (names)" value={removed} onChange={setRemoved} />
                <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => call(act, 'reviewSocialAccess', { companyId: a.companyId, id: a.id, note, removed }, 'Access review recorded.')}>
                  Record access review
                </button>
              </Panel>
              <button className="btn btn-sm" onClick={() => setEditing(true)}>
                Edit
              </button>
            </>
          )}
        </>
      )}
    </Drawer>
  );
}

const MAIL_LABEL: Record<string, string> = {
  pass: 'Present',
  missing: 'Missing',
  too_many_lookups: 'Over 10 lookups',
  on: 'On',
  off: 'Off',
  reject: 'Reject (enforced)',
  quarantine: 'Quarantine',
  none: 'Monitoring only',
  m365: 'Microsoft 365',
  other: 'Other provider',
  unknown: 'Not checked',
};

function Email({ data }: { data: B; go: (k: NonNullable<Open>['kind'], id: string) => void }) {
  const act = useAction();
  const [editDomain, setEditDomain] = useState<string | null>(null);
  const [editCo, setEditCo] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [mailboxForm, setMailboxForm] = useState<Record<string, string>>({});
  const setMailbox = (k: string) => (x: string) => setMailboxForm((y) => ({ ...y, [k]: x }));
  const set = (k: string) => (x: string) => setF((y) => ({ ...y, [k]: x }));
  const sel = (k: string, opts: string[]) => (
    <label className="small">
      {k.toUpperCase()}{' '}
      <Select className="select" value={f[k] ?? 'unknown'} onChange={(e) => set(k)(e.target.value)}>
        {opts.map((o) => (
          <option key={o} value={o}>
            {MAIL_LABEL[o] ?? o}
          </option>
        ))}
      </Select>
    </label>
  );
  return (
    <>
      <Panel title="Manual Microsoft email change checklist" note="Guidance only — no Microsoft settings or mailbox actions are executed here">
        <ol><li>Stage DMARC changes: verify legitimate senders and reporting first, then review evidence before moving to quarantine or reject. Record the approved plan and outcome.</li><li>For leavers, record the 90-day mailbox retention review, responsible owner and evidence. Check legal holds and applicable retention requirements; reaching 90 days never automatically deletes a mailbox or overrides a hold.</li><li>Obtain and record IT Manager approval before external forwarding. Microsoft changes still require separate authorized execution; an entry here is not proof they occurred.</li></ol>
      </Panel>
      <Panel title="Email health per domain" note="SPF, DKIM and DMARC keep company email delivered and stop others sending as the company">
        <ErrorNotice error={act.error} />
        <div className="list">
          {data.mail.map((m) => (
            <div key={m.domainId} className="ws-item">
              <Line k={m.name}>
                {m.health ? (
                  <span className="small">
                    SPF {MAIL_LABEL[m.health.spf]} · DKIM {MAIL_LABEL[m.health.dkim]} · DMARC {MAIL_LABEL[m.health.dmarc]} · MX {MAIL_LABEL[m.health.mx]} ·{' '}
                    {m.health.source === 'dns' ? 'read from DNS' : `by ${m.health.checkedBy ?? 'IT'}`} {m.health.checkedAt ? dateTimeLabel(m.health.checkedAt) : ''}
                  </span>
                ) : (
                  <span className="muted small">Not checked</span>
                )}{' '}
                <Flags flags={m.flags} />
              </Line>
              {m.flags.length > 0 && <div className="muted small">{m.flags.join(' · ')}</div>}
              {m.canEdit && editDomain !== m.domainId && (
                <button className="btn btn-sm" disabled={act.busy} onClick={() => (setEditDomain(m.domainId), setF({ spf: m.health?.spf ?? 'unknown', dkim: m.health?.dkim ?? 'unknown', dmarc: m.health?.dmarc ?? 'unknown', mx: m.health?.mx ?? 'unknown', dmarcReports: m.health?.dmarcReports == null ? 'unknown' : m.health.dmarcReports ? 'yes' : 'no' }))}>
                  Record by hand
                </button>
              )}
              {editDomain === m.domainId && (
                <div className="ws-form ws-gap-top">
                  {sel('spf', ['pass', 'missing', 'too_many_lookups', 'unknown'])}
                  {sel('dkim', ['on', 'off', 'unknown'])}
                  {sel('dmarc', ['reject', 'quarantine', 'none', 'missing', 'unknown'])}
                  {sel('mx', ['m365', 'other', 'missing', 'unknown'])}
                  <label className="ws-check small">
                    DMARC reports collected
                    <select className="select" aria-label="DMARC reports collected" value={f.dmarcReports ?? 'unknown'} onChange={(e) => set('dmarcReports')(e.target.value)}>
                      <option value="unknown">Not checked</option><option value="yes">Yes</option><option value="no">No</option>
                    </select>
                  </label>
                  <Text label="Comment (needed: where you checked it)" value={f.note ?? ''} onChange={set('note')} />
                  <div className="ws-actions">
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={act.busy}
                      onClick={async () => {
                        const r = await call(act, 'saveMailHealth', { domainId: m.domainId, ...f, dmarcReports: f.dmarcReports === 'yes' ? true : f.dmarcReports === 'no' ? false : null }, 'Email health recorded.');
                        if (r) setEditDomain(null);
                      }}
                    >
                      Save
                    </button>
                    <button className="btn btn-sm" onClick={() => setEditDomain(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!data.mail.length && <div className="empty">No domains with Microsoft 365 email recorded.</div>}
        </div>
      </Panel>
      <Panel title="Mailbox review per company" note="Every 90 days in the Microsoft 365 admin centre: leavers, forwarding outside, full mailboxes">
        <div className="list">
          {data.mailboxes.map((m) => (
            <div key={m.companyId} className="ws-item">
              <Line k={m.companyName}>
                {m.mailboxes ? (
                  <span className="small">
                    {m.mailboxes.licensed ?? '?'} licensed · {m.mailboxes.shared ?? '?'} shared · reviewed {m.mailboxes.reviewedAt ? dateTimeLabel(m.mailboxes.reviewedAt) : 'never'}
                  </span>
                ) : (
                  <span className="muted small">Not reviewed</span>
                )}{' '}
                <Flags flags={m.flags} />
              </Line>
              {m.flags.length > 0 && <div className="muted small">{m.flags.join(' · ')}</div>}
              {m.canEdit && editCo !== m.companyId && (
                <button className="btn btn-sm" disabled={act.busy} onClick={() => (setEditCo(m.companyId), setMailboxForm({}))}>
                  Record review
                </button>
              )}
              {editCo === m.companyId && (
                <div className="ws-form ws-gap-top">
                  <Text label="Licensed mailboxes" value={mailboxForm.licensed ?? ''} onChange={setMailbox('licensed')} />
                  <Text label="Shared mailboxes" value={mailboxForm.shared ?? ''} onChange={setMailbox('shared')} />
                  <Text label="Leaver mailboxes still open" value={mailboxForm.leaversPending ?? ''} onChange={setMailbox('leaversPending')} />
                  <Text label="Mailboxes close to full" value={mailboxForm.nearFull ?? ''} onChange={setMailbox('nearFull')} />
                  <Text label="Forwarding outside the company" value={mailboxForm.forwardingOutside ?? ''} onChange={setMailbox('forwardingOutside')} />
                  <Text label="Comment (needed: what you checked)" value={mailboxForm.note ?? ''} onChange={setMailbox('note')} />
                  <div className="ws-actions">
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={act.busy}
                      onClick={async () => {
                        const r = await call(act, 'saveMailboxes', { companyId: m.companyId, ...mailboxForm }, 'Mailbox review recorded.');
                        if (r) setEditCo(null);
                      }}
                    >
                      Save
                    </button>
                    <button className="btn btn-sm" onClick={() => setEditCo(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!data.mailboxes.length && <div className="empty">No company with Microsoft 365 email recorded.</div>}
        </div>
      </Panel>
    </>
  );
}
