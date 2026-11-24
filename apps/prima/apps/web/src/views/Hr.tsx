import { useEffect, type ReactNode } from 'react';
import { GlobeIcon, IdentificationCardIcon, ProhibitIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { useApp, useRouteTab } from '../App';
import { SopHelp } from '../sop/SopHelp';
import { Chip, ErrorNotice, Loading, useLoad } from '../ui';
import { Card, PageHead, Stat, Stats } from '../kit';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';
import { CmsHoursPanel } from './CmsHours';
import { LeavePanel } from './Leave';
import { FlexPanel, HolidaysPanel, HrLeaveSettingsPanel } from './HrLeave';
import { JoinLeavePanel, VacanciesPanel } from './HrJoinLeave';
import { StaffMovementPanel } from './HrMovement';
import { GroupHistoryPanel, HistoryLookupPanel } from './StaffHistory';
import { AllowancesPanel } from './HrAllowances';
import { DisciplineAppealsPanel, HrCasesPanel } from './HrCases';
import { ScreeningPanel } from './HrScreening';
import { OfficeOshPanel } from './HrOsh';
import { AppraisalsPanel, HrLegalPanel, OvertimePanel, PoliciesPanel, TrainingPanel } from './HrDevelop';
import { PayChangesPanel } from './PayChanges';
import { CosCoverPanel } from './HrCosCover';
import { HrGuide } from './HrGuide';
import { AttendanceReportsSummary } from './AttendanceReports';
import { hrKeeps, isOwnerAdmin, p91MayImport } from '@prima/core';
import { AddImportMenu, jumpTo } from './AddImportMenu';
import '../styles/people.css';

/** The HR work queues, grouped; each group hides itself (and its jump link) when none of its panels apply to this user. */
const GROUPS: { id: string; title: string; sub: string }[] = [
  { id: 'hr-g-pay', title: 'Pay and allowances', sub: 'Pay and salary account changes, allowances and staff overtime' },
  { id: 'hr-g-move', title: 'Joining, leaving and moving', sub: 'Joiners and leavers, vacancies, staff movement and staff history' },
  { id: 'hr-g-cases', title: 'Cases, safety and legal', sub: 'Staff HR files, discipline appeals, screening, office safety and legal points for the directors' },
  { id: 'hr-g-grow', title: 'Appraisals, training and policies', sub: 'Appraisals, training, the handbook and how to do it' },
  { id: 'hr-g-leave', title: 'Leave and holidays', sub: 'Leave requests, Chief of Staff cover, flexible work, extra leave, public holidays and CMS staff hours' },
  // P81: the monthly attendance reports from the attendance system.
  { id: 'hr-g-att', title: 'Attendance reports', sub: 'Import the monthly attendance PDFs and see each month' },
];

/** Scrolls to a group; the app keeps its own view in the address, so these are buttons, not # links. */
function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** P121: a link can open the page at one group (#hr/move, from the SOP guide); the page stays one long list. */
type HrSection = 'papers' | 'pay' | 'move' | 'cases' | 'grow' | 'leave' | 'att';
const SECTIONS: HrSection[] = ['papers', 'pay', 'move', 'cases', 'grow', 'leave', 'att'];

function Group({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section className="hr-group" id={id} aria-labelledby={`${id}-h`}>
      <div className="hr-group-head">
        <h2 id={`${id}-h`}>{title}</h2>
        <p>{sub}</p>
      </div>
      <div className="hr-group-body">{children}</div>
    </section>
  );
}

type MonitorRow = Awaited<ReturnType<typeof api.hrMonitor>>['rows'][number];
type CountKey = 'staff' | 'nepali' | 'blocked' | 'kdnMissing' | 'kdnPending' | 'csgDue' | 'csgPast' | 'foreignPermits' | 'overAge' | 'faceNotEnrolled';
const count = (r: MonitorRow, k: CountKey): number => (r.hasDetail ? r[k] : 0);
/** A figure column; `tone` colours it when it is not zero. */
const fig = (id: CountKey, label: string, opts: { tone?: 'crit'; hideBelow?: number; phone?: 'hidden' } = {}): DtColumn<MonitorRow> => ({
  id,
  label,
  value: (r) => count(r, id),
  sort: 'number',
  hideBelow: opts.hideBelow,
  phone: opts.phone,
  render: (r) => (
    <span className="hr-num" data-tone={opts.tone && count(r, id) ? opts.tone : undefined}>
      {count(r, id)}
    </span>
  ),
});
/** P107: the workforce papers table: the old eleven columns; the less urgent ones leave narrower screens first. */
const PAPER_COLUMNS: DtColumn<MonitorRow>[] = [
  {
    id: 'company',
    label: 'Company',
    value: (r) => r.company.name,
    phone: 'title',
    render: (r) => (
      <span className="hr-company">
        <span className="hr-company-name">{r.company.name}</span>
        {r.company.isPilot && <span className="muted small">Pilot</span>}
      </span>
    ),
  },
  fig('staff', 'Staff'),
  fig('nepali', 'Nepali', { hideBelow: 1280, phone: 'hidden' }),
  fig('blocked', 'Cannot work', { tone: 'crit' }),
  fig('kdnMissing', 'No KDN', { hideBelow: 1100 }),
  fig('kdnPending', 'KDN vetting pending', { hideBelow: 1280, phone: 'hidden' }),
  fig('csgDue', 'CSG due (year 1)', { hideBelow: 1280, phone: 'hidden' }),
  fig('csgPast', 'CSG overdue', { tone: 'crit' }),
  fig('foreignPermits', 'Foreign papers', { hideBelow: 1100, phone: 'hidden' }),
  fig('overAge', 'Over 60', { hideBelow: 1366, phone: 'hidden' }),
  fig('faceNotEnrolled', 'Face not enrolled', { hideBelow: 1366, phone: 'hidden' }),
];
const PAPER_FILTERS: DtFilter<MonitorRow>[] = [
  {
    id: 'needs',
    label: 'Show',
    value: (r) => (count(r, 'blocked') || count(r, 'csgPast') ? 'act' : 'fine'),
    options: [
      { value: 'act', label: 'Cannot work or CSG overdue' },
      { value: 'fine', label: 'Nothing urgent' },
    ],
  },
];

/** PWVSB central HR monitors every company's workforce papers; each company stays the employer and acts (V7 s.89). */
export function HrView() {
  const { setCompanyId, go, route } = useApp();
  const { data, error } = useLoad(() => api.hrMonitor(), []);
  const [section] = useRouteTab<HrSection>('papers', SECTIONS);
  const loaded = !!data;
  useEffect(() => {
    if (!loaded || !route?.tab || !SECTIONS.includes(route.tab as HrSection)) return;
    // The panels below load on their own, so the group can move as they fill: scroll again once they have settled.
    jump(`hr-g-${section}`);
    const again = window.setTimeout(() => jump(`hr-g-${section}`), 700);
    return () => window.clearTimeout(again);
  }, [loaded, route, section]);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="HR monitor" />
      </div>
    );
  const detail = data.rows.filter((r) => r.hasDetail);
  const unknown = data.rows.filter((r) => !r.hasDetail);
  const sum = (k: 'staff' | 'blocked' | 'kdnMissing' | 'kdnPending' | 'csgPast' | 'foreignPermits') => detail.reduce((n, r) => n + (r.hasDetail ? r[k] : 0), 0);
  const openCompany = (id: string) => {
    setCompanyId(id);
    go({ view: 'people' });
  };
  const [pay, move, cases, grow, leave, att] = GROUPS;
  return (
    <div className="page hr-page">
      <PageHead
        title="HR monitor"
        sub="Workforce papers for every company. PWVSB HR follows up; each company is the employer and makes the change. Companies with no data loaded yet show Unknown, never as fine."
        actions={
          <>
            <SopHelp id="hr" />
            <HrAddMenu />
          </>
        }
      />
      <Stats>
        <Stat label="Staff (companies with data)" value={sum('staff')} icon={<UsersThreeIcon />} tone="info" />
        <Stat label="Cannot work today" value={sum('blocked')} tone={sum('blocked') ? 'crit' : 'ok'} note="A rule blocks them" icon={<ProhibitIcon />} />
        <Stat label="No KDN card or submission" value={sum('kdnMissing')} tone={sum('kdnMissing') ? 'crit' : 'ok'} icon={<IdentificationCardIcon />} />
        <Stat
          label="Foreign worker papers"
          value={sum('foreignPermits')}
          tone={sum('foreignPermits') ? 'warn' : 'ok'}
          note="PLKS, passport, FOMEMA, insurance"
          icon={<GlobeIcon />}
        />
      </Stats>

      <nav className="hr-jump" aria-label="HR work queues">
        <button type="button" onClick={() => jump('hr-g-papers')}>
          Workforce papers
        </button>
        {GROUPS.map((g) => (
          <button key={g.id} type="button" data-for={g.id} onClick={() => jump(g.id)}>
            {g.title}
          </button>
        ))}
      </nav>

      <section className="hr-group" id="hr-g-papers" aria-label="Workforce papers by company">
        <Card flush title="Workforce papers by company" sub="Select a company to see its guards and their papers.">
          {/* P107: the data table: sort by any figure, search a company, pages when the group grows. */}
          <div className="hr-dt">
            <DataTable
              label="Workforce papers by company"
              stateKey="hr.papers"
              rows={detail}
              rowKey={(r) => r.company.id}
              searchPlaceholder="Find a company"
              onRowClick={(r) => openCompany(r.company.id)}
              columns={PAPER_COLUMNS}
              filters={PAPER_FILTERS}
              phoneFacts={4}
            />
          </div>
          {unknown.length > 0 && (
            <div className="hr-unknown">
              <p className="hr-unknown-head">Unknown: staff data not loaded yet</p>
              <ul className="hr-unknown-list">
                {unknown.map((r) => (
                  <li key={r.company.id}>
                    <Chip tone="unknown">{r.company.name}</Chip>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </section>

      <Group {...pay}>
        <PayChangesPanel />
        <AllowancesPanel />
        <OvertimePanel />
      </Group>
      <Group {...move}>
        <JoinLeavePanel />
        <VacanciesPanel />
        <StaffMovementPanel />
        <HistoryLookupPanel />
        <GroupHistoryPanel />
      </Group>
      <Group {...cases}>
        <HrCasesPanel />
        <DisciplineAppealsPanel />
        <ScreeningPanel />
        <OfficeOshPanel />
        <HrLegalPanel />
      </Group>
      <Group {...grow}>
        <AppraisalsPanel />
        <TrainingPanel />
        <PoliciesPanel />
        <HrGuide />
      </Group>
      <Group {...leave}>
        {/* P129 (upstream HR gap D1): who covers the Chief of Staff's own items while on leave, and hand-overs. */}
        <CosCoverPanel />
        <LeavePanel />
        <FlexPanel />
        <div id="hr-leave-settings">
          <HrLeaveSettingsPanel />
        </div>
        <div id="hr-holidays">
          <HolidaysPanel />
        </div>
        <CmsHoursPanel />
      </Group>
      <Group {...att}>
        {/* P121: the Attendance screen opens on its monthly reports from the link itself (#attendance/reports). */}
        <AttendanceReportsSummary onOpen={() => go({ view: 'attendance', tab: 'reports' })} />
      </Group>
    </div>
  );
}

/**
 * P91 (Fitri, 9 Nov 2026): what HR adds on this page, and what loads from old lists, at the top of the page instead of
 * deep in each group. Each entry shows only to those the server lets add it.
 */
function HrAddMenu() {
  const { me, go } = useApp();
  const u = me.user;
  const maker = hrKeeps(u) || isOwnerAdmin(u);
  return (
    <AddImportMenu
      entries={[
        { key: 'training', label: 'Training record', onAdd: maker ? () => jumpTo('hr-training-form') : undefined, importKind: p91MayImport(u, 'staffTraining') ? 'staffTraining' : undefined },
        { key: 'papers', label: 'Guard papers (KDN, CSG, TNG)', onAdd: p91MayImport(u, 'guardPaper') ? () => go({ view: 'people' }) : undefined, importKind: p91MayImport(u, 'guardPaper') ? 'guardPaper' : undefined },
        { key: 'holiday', label: 'Public holidays', onAdd: maker ? () => jumpTo('hr-holidays') : undefined, importKind: maker ? 'publicHoliday' : undefined },
        { key: 'leave', label: 'Leave days above the Act', onAdd: maker ? () => jumpTo('hr-leave-settings') : undefined, importKind: maker ? 'leaveEntitlement' : undefined },
        { key: 'staff', label: 'Office staff', onAdd: maker ? () => go({ view: 'people' }) : undefined },
      ]}
    />
  );
}
