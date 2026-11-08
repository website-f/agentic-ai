import { ArrivalCashView } from './views/ArrivalCash';
import { ItMetrics } from './views/ItMetrics';
import { WorkKpiView } from './views/WorkKpi';
import { CleanupReceiptRecovery } from './views/ItCleanup';
import { ItProcurement } from './views/ItProcurement';
import { HrItIntake } from './views/HrItIntake';
import { StaffDirectory } from './views/StaffDirectory';
import { ItExtractionWorkspace } from './views/ItExtractionWorkspace';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { type Company, type User, RULES, hasOwnStaffRecord, isActHead, isGroupLeader, isOwnerAdmin, jaOwns, seesArmsDetail, workKpiScope, finRequestInMenu, canSeeJaSwitch } from '@prima/core';
import { ApiError, api, type Me } from './api';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { publishPage, rulesFor } from './prima-page';
import { ViewIcon } from './icons';
import { SESSION_ENDED } from './api/http';
import { Chip, Icon, Loading, RefreshContext, ToastHost, hhmm } from './ui';
import { AlertBell } from './AlertBell';
import { ArishaReviewQueue } from './ArishaReviewQueue';
import { ConfidentialityGate } from './Confidential';
import { Launcher } from './Launcher';
import { LANGS, LangCtx, saveLang, savedLang, startTranslator, useLang, type Lang } from './i18n';
import { Overview } from './views/Overview';
import { CompanyView } from './views/Company';
import { Sites } from './views/Sites';
import { RosterView } from './views/Roster';
import { CleaningView } from './views/Cleaning';
import { DutyView, SiteStockView } from './views/SitePlans';
import { People } from './views/People';
import { AttendanceView } from './views/Attendance';
import { Cases } from './views/Cases';
import { ComplianceView } from './views/Compliance';
import { CommercialView } from './views/Commercial';
import { HrView } from './views/Hr';
import { InsuranceView } from './views/Insurance';
import { CmsView } from './views/Cms';
import { CmsReadinessView } from './views/CmsReadiness';
import { OpsView } from './views/Ops';
import { HomeView } from './views/Home';
import { ArmsView } from './views/Arms';
import { AuditView } from './views/Audit';
import { Device } from './views/Device';
import { MyDuty } from './views/MyDuty';
import { GuardPhoneApp } from './views/GuardPhone';
import { MyClockView, StaffClockBoardView, StaffTracker } from './views/StaffClock';
import { BranchWorkView, WorkView } from './views/Work';
import { SocsoView } from './views/Socso';
import { HostelsView } from './views/Hostels';
import { FwCostView } from './views/FwCost';
import { FwStatView } from './views/FwStat';
import { ClaimsView } from './views/Claims';
import { MemosView } from './views/Memos';
import { PdpaView } from './views/Pdpa';
import { FleetView } from './views/Fleet';
import { ClientsView } from './views/Clients';
import { OfficeView } from './views/Office';
import { RequestsView } from './views/Requests';
import { JaView } from './views/Ja';
import { JaSwitchView } from './views/JaSwitch';
import { AssetsView } from './views/Assets';
import { StaffPayView } from './views/StaffPay';
import { GuardAdvancesView, GuardLoansView, GuardPayView, StatutoryView } from './views/GuardPay';
import { FinanceView } from './views/Finance';
import { ContractsView } from './views/Contracts';
import { BranchesView } from './views/Branches';
import { ItView } from './views/It';
import { RenewalsView } from './views/Renewals';
import { CorporateView } from './views/Corporate';
import { CreditView } from './views/Credit';
import { PurchasingView } from './views/Purchasing';
import { ItemsView } from './views/Items';
import { GovernanceView } from './views/Governance';
import { GrcView } from './views/Grc';
import { RegistersView } from './views/Registers';
import { ActView } from './views/Act';
import { PayFormulasView } from './views/PayFormulas';
import { SiteHoursView } from './views/SiteHours';
import { SalaryCalcView } from './views/SalaryCalc';
import { ContinuityView } from './views/Continuity';
import { WebsitesView } from './views/Websites';
import { ConnectionsView } from './views/Connections';
import { OfficeConnections } from './views/OfficeConnections';
import { FwmView } from './views/Fwm';
import { DirectorOfficeView } from './views/DirectorOffice';
import { ReportsView } from './views/Reports';
import { MeetingsView } from './views/Meetings';
import { SelfAuditView } from './views/SelfAudit';
import { RbaView } from './views/Rba';
import { SurveysView } from './views/Surveys';
import { forgetOwner, lastOwner, rememberSetup, syncSurveys } from './survey/offline';
import { CooPaymentsView } from './views/CooPayments';
import { PaymentRequestsView } from './views/PaymentRequests';
import { HandoversView } from './views/Handovers';
import { QualityView } from './views/Quality';



































export type ViewName = 'home' | 'overview' | 'company' | 'sites' | 'roster' | 'cleaning' | 'duty' | 'sitestock' | 'people' | 'attendance' | 'cases' | 'compliance' | 'commercial' | 'ops' | 'hr' | 'insurance' | 'arms' | 'cms' | 'cmsready' | 'audit' | 'device' | 'mine' | 'clock' | 'staffclock' | 'work' | 'branchwork' | 'socso' | 'fwm' | 'doa' | 'reports' | 'meetings' | 'hostels' | 'fwcost' | 'fwstat' | 'claims' | 'memos' | 'pdpa' | 'fleet' | 'clients' | 'office' | 'requests' | 'payreq' | 'ja' | 'jaswitch' | 'assets' | 'staffpay' | 'guardpay' | 'advances' | 'statutory' | 'arrivalcash' | 'loans' | 'finance' | 'contracts' | 'branches' | 'it' | 'it-metrics' | 'work-kpi' | 'it-procurement' | 'hr-it-intake' | 'staff-directory' | 'websites' | 'corporate' | 'renewals' | 'credit' | 'purchasing' | 'items' | 'governance' | 'grc' | 'registers' | 'act' | 'payformulas' | 'sitehours' | 'salarycalc' | 'continuity' | 'connections' | 'it-extraction' | 'surveys' | 'handovers' | 'quality' | 'selfaudit' | 'rba';

export interface Route {
  view: ViewName;
  siteId?: string;
  personId?: string;
  caseId?: string;
  tenderId?: string;
}

interface AppCtx {
  me: Me;
  companyId: string;
  company: Company | undefined;
  setCompanyId: (id: string) => void;
  go: (r: Route) => void;
  isGroup: boolean;
  /** Whether this person has the screen in their menu. A link to a screen they do not have is not shown. */
  canOpen?: (view: ViewName) => boolean;
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);

/** depts is informational now: which central departments a screen serves; LINE in Shell decides who sees it. */
/**
 * P68 (Agentic Office): the menu in sections, so a long menu reads at a glance. Each screen keeps its own rank inside
 * its section; a short menu (8 or fewer) stays one plain list.
 */
/** P71: opened inside the Agentic Office (its sign-in, its menu link back). */
const inOffice = (api as { office?: boolean }).office === true;

const NAV_GROUPS: { title: string; views: ViewName[] }[] = [
  { title: 'Today', views: ['home', 'overview', 'company', 'office', 'work', 'mine', 'clock', 'staffclock', 'doa', 'reports', 'meetings'] },
  { title: 'Operations', views: ['sites', 'roster', 'people', 'attendance', 'cases', 'ops', 'device', 'branchwork', 'duty', 'cleaning', 'sitestock', 'surveys', 'fleet', 'arms', 'cms', 'cmsready', 'sitehours', 'items'] },
  { title: 'People and HR', views: ['hr', 'claims', 'staffpay', 'guardpay', 'advances', 'arrivalcash', 'loans', 'payformulas', 'salarycalc', 'statutory', 'work-kpi', 'staff-directory', 'fwm', 'fwcost', 'fwstat', 'socso', 'hostels', 'requests', 'handovers', 'memos', 'pdpa'] },
  { title: 'Business and finance', views: ['commercial', 'clients', 'contracts', 'finance', 'credit', 'purchasing', 'payreq', 'branches', 'assets', 'insurance', 'ja', 'jaswitch'] },
  { title: 'Compliance and governance', views: ['compliance', 'renewals', 'audit', 'selfaudit', 'rba', 'quality', 'grc', 'act', 'registers', 'governance', 'corporate', 'continuity'] },
  { title: 'IT and systems', views: ['it', 'it-procurement', 'it-metrics', 'hr-it-intake', 'websites', 'connections', 'it-extraction'] },
];

function navSections<T extends { view: ViewName }>(items: T[]): { title: string | null; items: T[] }[] {
  if (items.length <= 8) return [{ title: null, items }];
  const seen = new Set<ViewName>();
  const out: { title: string | null; items: T[] }[] = [];
  for (const g of NAV_GROUPS) {
    const mine = items.filter((n) => g.views.includes(n.view));
    mine.forEach((n) => seen.add(n.view));
    if (mine.length) out.push({ title: g.title, items: mine });
  }
  const rest = items.filter((n) => !seen.has(n.view));
  if (rest.length) out.push({ title: 'More', items: rest });
  return out;
}

const NAV: { view: ViewName; label: string; icon: string; roles: User['role'][]; depts?: NonNullable<User['department']>[] }[] = [
  { view: 'home', label: 'Home', icon: 'company', roles: ['director', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'overview', label: 'Group', icon: 'group', roles: ['director', 'pwvsb_officer'] },
  // Company overview: group leadership, the company manager and admin executives only (Fauzan, 26 Oct 2026).
  { view: 'company', label: 'Company today', icon: 'company', roles: ['director', 'company_manager', 'admin_exec'] },
  // Each company's own office: the Company Manager or GM shares the work out to 2 to 8 executives by desk; group leaders monitor (Fauzan, 2 Nov 2026).
  { view: 'office', label: 'Company office', icon: 'company', roles: ['director', 'company_manager', 'admin_exec'] },
  { view: 'sites', label: 'Sites', icon: 'sites', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'roster', label: 'Roster', icon: 'roster', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'duty', label: 'Guard duty plans', icon: 'roster', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'cleaning', label: 'Cleaning plans', icon: 'sites', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'sitestock', label: 'Site stock and fittings', icon: 'cart', roles: ['director', 'pwvsb_officer'] },
  { view: 'people', label: 'Guards', icon: 'people', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'attendance', label: 'Attendance', icon: 'attendance', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'cases', label: 'Cases', icon: 'cases', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'compliance', label: 'Licences', icon: 'compliance', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // Yearly self-audit (Fauzan, 6 Nov 2026): the company does it every year; ACT and group leadership watch.
  { view: 'selfaudit', label: 'Yearly self-audit', icon: 'compliance', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // RBA readiness (Fauzan, 8 Nov 2026): every office sign-in signs the ethics declaration once on entering service here; the rest is by role.
  { view: 'rba', label: 'RBA readiness', icon: 'compliance', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'commercial', label: 'Tenders & quotes', icon: 'tender', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'ops', label: 'Regional ops', icon: 'sites', roles: ['director', 'pwvsb_officer'], depts: ['operations'] },
  { view: 'hr', label: 'HR monitor', icon: 'people', roles: ['director', 'pwvsb_officer'], depts: ['hr'] },
  {
    view: 'insurance',
    label: 'Insurance',
    icon: 'insurance',
    roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'],
    depts: ['chief_of_staff'],
  },
  { view: 'arms', label: 'Arms control', icon: 'arms', roles: ['director', 'pwvsb_officer', 'company_manager', 'supervisor'], depts: ['arms_control'] },
  { view: 'cms', label: 'CMS', icon: 'device', roles: ['director', 'pwvsb_officer'], depts: ['arms_control', 'cms'] },
  // CMS site readiness (audit decision 4, Fauzan 5 Nov 2026): the company records each site's devices (the client's brands)
  // and preparations; Arms Control checks; CMS and operations watch. No device is connected from it.
  {
    view: 'cmsready',
    label: 'CMS site readiness',
    icon: 'sites',
    roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'],
    depts: ['arms_control', 'cms', 'operations'],
  },
  { view: 'audit', label: 'Audit trail', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager'] },
  { view: 'device', label: 'Site device', icon: 'device', roles: ['site_device'] },
  { view: 'doa', label: 'Director Office', icon: 'tender', roles: ['director', 'pwvsb_officer'] },
  { view: 'reports', label: 'Reports', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // Offline site survey (Fauzan, 4 Nov 2026): sales, managers, site officers and operations; works with no signal.
  { view: 'surveys', label: 'Site survey', icon: 'sites', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'meetings', label: 'Meetings', icon: 'roster', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'mine', label: 'Duty', icon: 'people', roles: ['guard', 'supervisor', 'director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'clock', label: 'Clock', icon: 'attendance', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'staffclock', label: 'Staff clock', icon: 'attendance', roles: ['director', 'pwvsb_officer', 'company_manager'] },
  // Remote and branch work plan (Fauzan, 27 Oct 2026): everyone's tasks with what done means; far branches on checklists.
  { view: 'work', label: 'Work', icon: 'roster', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'branchwork', label: 'Far branches', icon: 'sites', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  {
    view: 'fwm',
    label: 'Foreign workers',
    icon: 'people',
    roles: ['director', 'pwvsb_officer', 'company_manager'],
    depts: ['fwm', 'chief_of_staff', 'operations'],
  },
  {
    view: 'socso',
    label: 'SOCSO claims',
    icon: 'cases',
    roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'],
    depts: ['hr', 'operations'],
  },
  // Recruitment cost (Fauzan, 3 Nov 2026): FWM records placements, Finance runs the month, the FD or CEO sets rates
  // and approves; each company manager sees its own bills and paybacks.
  {
    view: 'fwcost',
    label: 'Recruitment cost',
    icon: 'audit',
    roles: ['director', 'pwvsb_officer', 'company_manager'],
    depts: ['fwm', 'finance'],
  },
  // Nepali EPF and SOCSO recharge (Fauzan, 5 Nov 2026): the permit company pays, the company or branch that used the worker
  // repays; a Branch Manager sees and repays only their own branch.
  {
    view: 'fwstat',
    label: 'Nepali EPF/SOCSO',
    icon: 'audit',
    roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'],
    depts: ['fwm', 'finance'],
  },
  // Hostel bills and utility excess (Fauzan, 26 Oct 2026): the owning company, FWM, the approvers, HR and leadership.
  {
    view: 'hostels',
    label: 'Hostels',
    icon: 'sites',
    roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'],
    depts: ['fwm', 'hr', 'operations'],
  },
  // Staff claims: every staff member's own claims; HR decides, the Chief of Staff approves trips and sets the rates.
  { view: 'claims', label: 'Claims', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // Memos: the Chief of Staff to all staff, the COO to all guards and officers; everyone reads theirs (Fauzan, 26 Oct 2026).
  // PDPA: the PDPA officer acts, the Operations Director and group leadership monitor (Fauzan, 26 Oct 2026).
  { view: 'pdpa', label: 'PDPA', icon: 'compliance', roles: ['director', 'pwvsb_officer'], depts: ['pdpa', 'operations'] },
  // Vehicles: the Transport head runs them, CMS monitors devices, the PDPA officer files driver consent, staff request (Fauzan, 26 Oct 2026).
  // Clients: Operations Managers, the Operations Director and officers act; the COO and company managers monitor (Fauzan, 26 Oct 2026).
  {
    view: 'clients',
    label: 'Clients',
    icon: 'company',
    roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'],
  },
  // Operation claims (OM to COO) and office needs (company manager to Chief of Staff to COO) (Fauzan, 26 Oct 2026).
  { view: 'requests', label: 'Requests', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager'] },
  // Payment requests (Fauzan, 1 Nov 2026): company head creates, department head, Finance check, COO or FD, Finance pays.
  { view: 'payreq', label: 'Payment requests', icon: 'insurance', roles: ['director', 'pwvsb_officer', 'company_manager'] },
  { view: 'fleet', label: 'Vehicles', icon: 'sites', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // JA Group app (Fauzan, 26 Oct 2026): guard and officer payroll, foreign workers and incidents, read-only from its feed.
  {
    view: 'ja',
    label: 'JA app data',
    icon: 'group',
    roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'],
    depts: ['operations', 'hr', 'fwm', 'cms'],
  },
  // Switch-over from JA (Fauzan, 5 Nov 2026): side by side, difference reports, area switch and history import.
  { view: 'jaswitch', label: 'Switch from JA', icon: 'group', roles: ['director', 'pwvsb_officer', 'company_manager'] },
  // Asset Management (Fauzan, 26 Oct 2026): its team, group leadership and the finance staff who oversee it; no group company.
  { view: 'assets', label: 'Asset Management', icon: 'company', roles: ['director', 'pwvsb_officer'], depts: ['asset', 'finance'] },
  // Staff payroll (Fauzan, 27 Oct 2026; 1 Nov 2026): HR prepares, the Chief of Staff approves, the COO approves, Finance pays;
  // every staff member sees their own payslips. Guards and officers are paid from the JA Group app.
  // Finance over SQL Account (Fauzan, 27 Oct 2026): the Finance Director and the CEO see every company, each team its own.
  // Contracts and site mobilisation (V6 amendment): the company runs them, Operations helps, group leadership watches.
  { view: 'contracts', label: 'Contracts', icon: 'tender', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'], depts: ['operations'] },
  // Branches (V11, V12): the company manager approves settlements and reviews branch actions; group leadership watches.
  { view: 'branches', label: 'Branches', icon: 'group', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'finance', label: 'Finance', icon: 'insurance', roles: ['director', 'pwvsb_officer'] },
  // IT (Fauzan, 27 Oct 2026): everyone asks IT for help here; IT runs the full asset lifecycle, the COO monitors, the CEO oversees.
  // PWVSB credit (V8, V10): the credit officer, the Finance Director, legal counsel, group leadership and the company manager for its own loans.
  { view: 'credit', label: 'PWVSB credit', icon: 'insurance', roles: ['director', 'pwvsb_officer', 'company_manager'] },
  // Assurance (V15): everyone can speak up and declare gifts; the company proves obligations; internal audit checks.
  { view: 'grc', label: 'Speak up and assurance', icon: 'audit', roles: ['guard', 'supervisor', 'director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // ACT, Audit, Compliance and Transformation (Fauzan, 27 Oct 2026): ACT's workspace; owners see the findings they must fix.
  { view: 'act', label: 'ACT', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager'] },
  // Pay formulas (Fauzan, 5 Nov 2026): ACT sets guard salary and driver overtime formulas; group leadership sees.
  { view: 'payformulas', label: 'Pay formulas', icon: 'audit', roles: ['director', 'pwvsb_officer'] },
  // Site man-hours (Fauzan, 6 Nov 2026): allowed hours per site per month; OD/OGM approve extra; HR, ACT and the company office see.
  { view: 'sitehours', label: 'Site man-hours', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // Salary calculator (Fauzan, 6 Nov 2026): the OM and above see how a guard's month is counted.
  { view: 'salarycalc', label: 'Salary calculator', icon: 'audit', roles: ['director', 'pwvsb_officer'] },
  // Governance (V7, V8, V12): the mandates PWVSB acts under; legal and the Chief of Staff register, the company board confirms.
  { view: 'governance', label: 'Mandates', icon: 'compliance', roles: ['director', 'pwvsb_officer', 'company_manager'] },
  // Company secretary (V9): the company records its filings and board; PWVSB (Chief of Staff, Deputy) approves corporate changes.
  { view: 'corporate', label: 'Company secretary', icon: 'compliance', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // Renewals (Central Admin 5C, Fauzan 2 Nov 2026): each company renews its own; Central Admin monitors; ACT audits.
  { view: 'renewals', label: 'Renewals', icon: 'compliance', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // Purchasing and store (V5): the company buys and runs its uniform store; approvals by delegation limits; Finance matches and posts.
  { view: 'purchasing', label: 'Procurement', icon: 'cart', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // One item register for every kind of thing in every company (Fauzan, 6 Nov 2026). Firearms stay in Arms Control.
  { view: 'items', label: 'Items and equipment', icon: 'cart', roles: ['guard', 'supervisor', 'director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // Continuity: IT keeps three copies of every system in Malaysia and tests restores; group leadership watches.
  { view: 'it-extraction', label: 'AI data preview', icon: 'device', roles: ['director', 'pwvsb_officer'] },
  // Microsoft 365 Connections (2 Nov 2026): every office staff member checks their own Outlook, Teams and SharePoint access.
  { view: 'connections', label: 'Connections', icon: 'device', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'continuity', label: 'Continuity', icon: 'device', roles: ['director', 'pwvsb_officer'] },
  { view: 'it', label: 'IT', icon: 'device', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // This route exposes only server-scoped coordination/own details, not the IT board or identity grants.
  { view: 'it-procurement', label: 'IT purchase fulfilment', icon: 'device', roles: ['director','pwvsb_officer'] },
  // Workflow KPIs across departments (Fauzan, 5 Nov 2026): only the KPI keepers; workKpiScope decides who.
  { view: 'work-kpi', label: 'Work KPIs', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager'] },
  { view: 'it-metrics', label: 'Workflow time & quality', icon: 'device', roles: ['director','pwvsb_officer','company_manager','admin_exec','supervisor'] },
  // Staff directory (Fauzan, 4 Nov 2026): HR, the HR Director, the CEO and IT only; never a sign-in.
  { view: 'staff-directory', label: 'Staff directory', icon: 'audit', roles: ['director', 'pwvsb_officer'] },
  { view: 'hr-it-intake', label: 'HR / IT coordination', icon: 'device', roles: ['director','pwvsb_officer','company_manager','admin_exec','supervisor'] },
  // Group websites (Fauzan, 27 Oct 2026): IT runs the register and reviews; each company answers for its own websites.
  { view: 'websites', label: 'Websites', icon: 'device', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'staffpay', label: 'Staff payroll', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // Guard pay run (Fauzan, 5 Nov 2026): HR prepares, the COO approves, Finance pays.
  { view: 'guardpay', label: 'Guard pay', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager'] },
  // Wage advances (Fauzan, 6 Nov 2026): the OM sets, the OD or OGM approves, Finance pays.
  { view: 'advances', label: 'Wage advances', icon: 'audit', roles: ['director', 'pwvsb_officer'] },
  // Statutory rates (Fauzan, 6 Nov 2026): the CEO sets EPF, SOCSO and the rest by month; HR, Finance and ACT see them.
  { view: 'statutory', label: 'Statutory rates', icon: 'audit', roles: ['director', 'pwvsb_officer'] },
  // Advance and loan scheme (Fauzan, 6 Nov 2026): HR records, the Chief of Staff then the CEO approve, Finance pays out and watches.
  { view: 'arrivalcash', label: 'Arrival cash', icon: 'audit', roles: ['director', 'pwvsb_officer'] },
  { view: 'loans', label: 'Advances and loans', icon: 'audit', roles: ['director', 'pwvsb_officer'] },
  { view: 'memos', label: 'Memos', icon: 'compliance', roles: ['guard', 'supervisor', 'director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
{ view: 'handovers', label: 'Hand-overs', icon: 'group', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
{ view: 'registers', label: 'Governance registers', icon: 'compliance', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
{ view: 'quality', label: 'Quality and compliance', icon: 'compliance', roles: ['director', 'pwvsb_officer', 'company_manager', 'supervisor'] }
];

/** Screens a role sees first (and on the phone tab bar). Admin executives work licences, tenders and quotations. */
const ROLE_FIRST: Record<string, ViewName[]> = {
  director: ['home', 'overview', 'ops', 'cases'],
  company_manager: ['home', 'company', 'roster', 'commercial'],
  admin_exec: ['home', 'compliance', 'commercial', 'people'],
  supervisor: ['home', 'roster', 'sites', 'cases'],
  leader: ['home', 'overview', 'ops', 'cases'],
  'pwvsb_officer:operations': ['ops', 'cases', 'sites', 'roster'],
  'pwvsb_officer:hr': ['hr', 'people', 'socso', 'staffclock'],
  'pwvsb_officer:arms_control': ['arms', 'cms', 'cases', 'audit'],
  'pwvsb_officer:cms': ['cms'],
  'pwvsb_officer:director_office': ['doa', 'meetings', 'reports', 'commercial'],
  'pwvsb_officer:chief_of_staff': ['insurance', 'reports', 'meetings'],
  'pwvsb_officer:fwm': ['fwm', 'ja', 'people', 'reports', 'meetings'],
  'pwvsb_officer:pdpa': ['pdpa'],
  'pwvsb_officer:transport': ['fleet'],
  'pwvsb_officer:asset': ['assets'],
  'pwvsb_officer:finance': ['finance', 'staffpay', 'assets'],
  'pwvsb_officer:it': ['it', 'websites', 'clock'],
  'pwvsb_officer:legal': ['credit', 'governance', 'clock'],
  'pwvsb_officer:audit': ['act', 'payformulas', 'grc', 'audit', 'clock'],
  'pwvsb_officer:procurement': ['purchasing', 'clock', 'sitestock'],
};

const ROLE_LABEL: Record<User['role'], string> = {
  director: 'Group leadership',
  pwvsb_officer: 'PWVSB',
  company_manager: 'Company Manager',
  admin_exec: 'Admin Executive',
  supervisor: 'Supervisor',
  site_device: 'Site device',
  guard: 'Guard (own view)',
};

const VIEW_TOKENS: ViewName[] = [
  'cleaning',
  'duty',
  'sitestock',
  'home',
  'overview',
  'company',
  'office',
  'sites',
  'roster',
  'people',
  'attendance',
  'cases',
  'compliance',
  'commercial',
  'ops',
  'hr',
  'insurance',
  'arms',
  'cms',
  'audit',
  'device',
  'mine',
  'clock',
  'staffclock',
  'work',
  'branchwork',
  'socso',
  'fwm',
  'doa',
  'reports',
  'meetings',
  'hostels',
  'fwcost',
  'fwstat',
  'claims',
  'memos',
  'pdpa',
  'fleet',
  'clients',
  'requests',
  'ja',
  'jaswitch',
  'assets',
  'staffpay',
  'guardpay',
  'advances',
  'statutory',
  'arrivalcash',
  'loans',
  'finance',
  'contracts',
  'branches',
  'it',
  'it-metrics',
  'work-kpi',
  'it-procurement',
  'hr-it-intake',
  'staff-directory',
  'websites',
  'corporate',
  'renewals',
  'credit',
  'purchasing',
  'items',
  'governance',
  'grc',
  'registers',
  'act',
  'payformulas',
  'sitehours',
  'salarycalc',
  'continuity',
  'connections',
  'it-extraction',
  'surveys',
'handovers',
'cmsready',
'quality',
'selfaudit',
'rba'
];

function SignIn({ onSignedIn, notice }: { onSignedIn: (me: Me) => void; notice?: string | null }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(notice ?? null);
  // Office staff sign in with their Microsoft 365 account; the person picker is only for the test link and development.
  const [ways, setWays] = useState<{ microsoft: boolean; devLogin: boolean; guardPhone?: boolean; office?: boolean } | null>(api.signInOptions ? null : { microsoft: false, devLogin: true, guardPhone: true });
  useEffect(() => {
    if (!api.signInOptions) return;
    api.signInOptions().then(setWays, (e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!ways?.devLogin) return;
    api.listUsers().then(setUsers, (e) => setError(e.message));
  }, [ways?.devLogin]);
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <div className="brand-name">Prima Secure App</div>
            <div className="brand-sub">PWVSB Security Group</div>
          </div>
        </div>
        <LangPicker />
        {ways?.office && (
          // P66: inside the Agentic Office, Prima opens with the office's sign-in (no second one).
          <div className="list" style={{ gap: 8 }}>
            <h1>Sign in</h1>
            <p className="muted">Prima opens with your Agentic Office sign-in. Sign in to the office, then open Prima again.</p>
            <a className="btn btn-primary" href="/login?next=%2Fprima" target="_top">
              Sign in to the office
            </a>
            <a className="btn btn-ghost" href="/" target="_top">
              Back to the office
            </a>
          </div>
        )}
        {ways?.microsoft && (
          <div className="list" style={{ gap: 8 }}>
            <h1>Sign in</h1>
            <p className="muted">Use your company Microsoft 365 account. Microsoft may ask for your second sign-in step (MFA).</p>
            <button className="btn btn-primary" onClick={() => api.signInMicrosoft?.().catch((e) => setError(e.message))}>
              Sign in with Microsoft
            </button>
            {notice && (
              // Refused after a Microsoft sign-in (not linked, not in the pilot): let the person leave that account.
              <button className="btn btn-ghost" onClick={() => api.signOut?.().catch((e) => setError(e.message))}>
                Sign out of Microsoft and use another account
              </button>
            )}
          </div>
        )}
        {ways?.devLogin && (
          <div>
            <h1>{ways.microsoft ? 'Or choose who to sign in as (development only)' : 'Choose who to sign in as'}</h1>
            <p className="muted">
              {api.mode === 'demo'
                ? RULES.pilot.value.on
                  ? 'IT department pilot, test version with made-up data. Only the IT team, the COO, the CEO, the ACT head, the HR administrator and the Finance Director sign in during the pilot, and they run the whole system; everyone else reaches them on Teams, email or phone. Pick a person to see what they would see. Real sign-in will use Microsoft 365 accounts.'
                  : 'This is a test version with made-up data shaped like Sasa, Arrow Shield and Inas. Pick a role to see what that person would see. Real sign-in will use Microsoft accounts for office staff. Guards and supervisors clock in by face on the shared site device.'
                : 'Development sign-in. Real sign-in will use Microsoft accounts for office staff. Guards and supervisors clock in by face on the shared site device.'}
            </p>
          </div>
        )}
        {error && (
          <div className="notice" data-tone="crit">
            {error}
          </div>
        )}
        {ways?.devLogin && !users && !error && <Loading what="people" />}
        {ways?.devLogin && (
          <div className="list" style={{ gap: 8 }}>
            {users?.map((u) => (
              <button key={u.id} className="persona" onClick={() => api.signIn(u.id).then(onSignedIn, (e) => setError(e.message))}>
                <span className="persona-name">{u.name}</span>
                <span className="persona-title">{u.title}</span>
                <Chip tone={u.role === 'director' ? 'info' : 'neutral'}>{u.department === 'it' ? 'Merdeka Network' : ROLE_LABEL[u.role]}</Chip>
              </button>
            ))}
          </div>
        )}
        {ways && !ways.microsoft && !ways.devLogin && !ways.office && <div className="notice">Sign-in is not set up on this server yet. Contact IT.</div>}
        {ways?.guardPhone && (
        <a className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} href="#guard-phone">
          Pengawal atau pegawai? Log masuk di telefon sendiri · Guard or officer? Sign in on your own phone
        </a>
        )}
      </div>
    </div>
  );
}

/** Screen language: BM + English mix (default), full Bahasa Melayu or full English (Fauzan, 28 Oct 2026). */
function LangPicker({ compact }: { compact?: boolean }) {
  const { lang, setLang } = useLang();
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }} data-no-translate role="group" aria-label="Language / Bahasa">
      {!compact && <span className="label">Bahasa / Language</span>}
      {LANGS.map((l) => (
        <button key={l.id} type="button" className={`btn btn-sm${lang === l.id ? ' btn-primary' : ' btn-ghost'}`} aria-pressed={lang === l.id} title={l.label} onClick={() => setLang(l.id)}>
          {compact ? l.short : l.label}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const [lang, setLangState] = useState<Lang>(savedLang);
  const setLang = useCallback((l: Lang) => {
    saveLang(l);
    setLangState(l);
  }, []);
  // The translator watches the whole page, so drawers, toasts and pop-ups follow the language too.
  useEffect(() => startTranslator(document.body, lang), [lang]);
  const langValue = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return (
    <LangCtx.Provider value={langValue}>
      <AppBody />
    </LangCtx.Provider>
  );
}

function AppBody() {
  const [me, setMe] = useState<Me | null>(null);
  const [booting, setBooting] = useState(true);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Why the sign-in screen is showing, when it is not simply a first visit.
  const [notice, setNotice] = useState<string | null>(null);
  // No signal when the app opened: the last person signed in here can still fill site surveys (sent later).
  const [offlineOwner, setOfflineOwner] = useState<{ id: string; name: string } | null>(null);
  const signedIn = useRef(false);
  signedIn.current = !!me;

  useEffect(() => {
    api.me().then(
      (m) => {
        setMe(m);
        setBooting(false);
      },
      (e) => {
        // 401 is a first visit or an ended session; anything else (account not linked, not in the pilot, server
        // down) is said on the sign-in screen instead of silently showing it again.
        if (!(e instanceof ApiError) || e.status !== 401) setNotice(e instanceof Error ? e.message : String(e));
        if (!(e instanceof ApiError))
          void lastOwner()
            .then((o) => setOfflineOwner(o))
            .catch(() => undefined)
            .finally(() => setBooting(false));
        else setBooting(false);
      },
    );
  }, []);

  useEffect(() => {
    const ended = () => {
      if (!signedIn.current) return;
      setNotice('Your sign-in has ended. Sign in again to continue.');
      setMe(null);
    };
    window.addEventListener(SESSION_ENDED, ended);
    return () => window.removeEventListener(SESSION_ENDED, ended);
  }, []);

  // A guard's own phone has its own enrolment and face-plus-PIN sign-in (third audit item 2), opened by the office link.
  const [guardMode, setGuardMode] = useState(() => location.hash.startsWith('#guard-phone'));
  useEffect(() => {
    const onHash = () => setGuardMode(location.hash.startsWith('#guard-phone'));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (guardMode)
    return (
      <ToastHost>
        <GuardPhoneApp
          onLeave={() => {
            history.replaceState(null, '', location.pathname);
            setGuardMode(false);
          }}
        />
      </ToastHost>
    );
  if (booting) return <Loading what="Prima Secure App" />;
  if (offlineOwner && !me)
    return (
      <ToastHost>
        <div className="app" style={{ padding: 16, maxWidth: 760, margin: '0 auto' }}>
          <div className="notice" data-tone="warn" style={{ marginBottom: 12 }}>
            No signal, so Prima cannot open fully. {offlineOwner.name}, you can fill in site surveys now; they are sent when you open Prima with a signal.
            <div style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => window.location.reload()}>
                Try again with signal
              </button>
            </div>
          </div>
          <SurveysView ownerId={offlineOwner.id} offline />
        </div>
      </ToastHost>
    );
  return (
    <ToastHost>
      <RefreshContext.Provider value={{ version, bump }}>
        {me ? (
          <Shell
            me={me}
            onSignOut={() => {
              // Signing out clocks staff out (Fauzan, 27 Oct 2026).
              void forgetOwner().catch(() => undefined);
              api
                .staffSessionEnd()
                .catch(() => undefined)
                .then(() => api.signOut?.())
                .catch(() => undefined);
              setMe(null);
            }}
            onReset={async () => {
              await api.reset?.();
              bump();
            }}
          />
        ) : (
          <SignIn
            key={notice ?? ''}
            notice={notice}
            onSignedIn={(m) => {
              setNotice(null);
              setMe(m);
            }}
          />
        )}
      </RefreshContext.Provider>
    </ToastHost>
  );
}

function Shell({ me, onSignOut, onReset }: { me: Me; onSignOut: () => void; onReset: () => void }) {
  const role = me.user.role;
  const isGroup = role === 'director' || role === 'pwvsb_officer';
  const dept = me.user.department;
  const leader = isGroupLeader(me.user);
  const { bump } = useContext(RefreshContext);
  // Opening the system signed in clocks staff in; the clock runs until they sign out, idle or asleep (Fauzan, 27 Oct 2026).
  useEffect(() => {
    api.staffSessionStart().then(bump, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.user.id]);
  // Site surveys made with no signal are sent when the app is open with a signal, whatever screen is showing.
  useEffect(() => {
    if (me.user.integration || me.user.role === 'site_device' || me.user.role === 'guard') return;
    const send = () => void syncSurveys(me.user.id).catch(() => undefined);
    send();
    // Keep this person's company, lead and site names on the phone, so the survey screen opens even with no signal
    // next time, without first visiting it with a signal.
    if (api.mode !== 'demo')
      void api
        .siteSurveySetup()
        .then((s) => (s.user.id === me.user.id && s.companies.length ? rememberSetup(s) : undefined))
        .catch(() => undefined);
    window.addEventListener('online', send);
    // A weak signal may never fire "online": try again every two minutes while the app is open.
    const timer = window.setInterval(send, 120_000);
    return () => {
      window.removeEventListener('online', send);
      window.clearInterval(timer);
    };
  }, [me.user.id, me.user.integration, me.user.role]);
  const first = (leader ? ROLE_FIRST.leader : ROLE_FIRST[dept ? `${role}:${dept}` : role]) ?? ROLE_FIRST[role] ?? [];
  // Staff clock in daily, so My clock sits right after the first screen (Fauzan, 26 Oct 2026).
  const rank = (v: ViewName) =>
    v === 'clock' ? 0.5 : v === 'work' ? 0.6 : me.user.branchId && v === 'branchwork' ? 0.7 : first.includes(v) ? first.indexOf(v) : first.length;
  // Group data is for group leadership only: CEO, COO, Finance Director, Chief of Staff, Deputy Chief of Staff,
  // Chairman and Vice Chairman. Other PWVSB staff see only their own line of work (Fauzan, 26 Oct 2026).
  const LINE: Partial<Record<NonNullable<User['department']>, ViewName[]>> = {
    operations: [
      'ops',
      'cmsready',
      'purchasing',
      'clients',
      'contracts',
      'requests',
      'ja',
      'pdpa',
      'hostels',
      'sites',
      'roster',
      'duty',
      'cleaning',
      'sitestock',
      'people',
      'attendance',
      'sitehours',
      'salarycalc',
      'advances',
  'statutory',
  'arrivalcash',
  'loans',
      'cases',
      'fwm',
      'socso',
      'reports',
      'meetings',
      'clock',
      'surveys', 'quality'
    ],
    hr: ['hr', 'ja', 'people', 'socso', 'staffclock', 'hostels', 'claims', 'staffpay', 'sitehours', 'guardpay', 'advances', 'arrivalcash', 'loans', 'statutory', 'items', 'reports', 'meetings', 'clock', 'quality'],
    // Arms Control sees arms matters only (Fauzan, 25 Oct 2026).
    arms_control: ['arms', 'cms', 'cases', 'audit', 'reports', 'meetings', 'clock', 'cmsready'],
    cms: ['cms', 'ja', 'arms', 'fleet', 'clock', 'cmsready'],
    director_office: ['doa', 'commercial', 'guardpay', 'reports', 'meetings', 'clock'],
    chief_of_staff: ['requests', 'claims', 'staffpay', 'insurance', 'reports', 'meetings', 'clock'],
    // FWM: foreign workers, their movements and hostels only, no tenders or other modules (Fauzan, 26 Oct 2026).
    fwm: ['arrivalcash', 'fwm', 'fwcost', 'fwstat', 'ja', 'hostels', 'people', 'reports', 'meetings', 'clock'],
    pdpa: ['pdpa', 'fleet', 'reports', 'meetings', 'clock'],
    transport: ['fleet', 'reports', 'meetings', 'clock'],
    asset: ['assets', 'reports', 'meetings', 'clock'],
    finance: ['finance', 'staffpay', 'guardpay', 'advances', 'arrivalcash', 'loans', 'statutory', 'assets', 'credit', 'purchasing', 'items', 'websites', 'reports', 'meetings', 'clock', 'fwcost', 'fwstat'],
    it: ['it', 'items', 'websites', 'connections', 'continuity', 'reports', 'meetings', 'clock'],
    legal: ['credit', 'governance', 'corporate', 'reports', 'meetings', 'clock', 'registers'],
    audit: ['act', 'payformulas', 'statutory', 'sitehours', 'salarycalc', 'grc', 'audit', 'selfaudit', 'items', 'websites', 'reports', 'meetings', 'clock', 'renewals', 'cleaning', 'registers', 'quality'],
    // Procurement and Inventory: 1 executive and 2 storekeepers under the OGM (Fauzan, 27 Oct 2026).
    procurement: ['purchasing', 'items', 'reports', 'meetings', 'clock', 'sitestock', 'quality'],
  };
  const nav = NAV.filter(
    (n) =>
      (leader ? n.roles.includes('director') : n.roles.includes(role)) &&
      (role !== 'pwvsb_officer' ||
        leader ||
        n.view === 'mine' ||
        n.view === 'claims' ||
        n.view === 'staffpay' ||
        n.view === 'memos' ||
        // Anyone can be invited to a meeting or own a meeting action, so every office sign-in reaches Meetings (5 Nov 2026).
        n.view === 'meetings' ||
        n.view === 'fleet' ||
        n.view === 'it' ||
        n.view === 'it-metrics' ||
        n.view === 'work-kpi' ||
        n.view === 'hr-it-intake' ||
        n.view === 'staff-directory' ||
        n.view === 'it-procurement' ||
        n.view === 'grc' ||
        n.view === 'act' ||
        n.view === 'rba' ||
        n.view === 'handovers' ||
        n.view === 'connections' ||
        n.view === 'jaswitch' ||
        (n.view === 'payreq' && finRequestInMenu(me.user)) ||
        (n.view === 'corporate' && !!me.user.corpSecretary) ||
        // The IT Manager sees the IT team's clock, view only (Fauzan, 28 Oct 2026).
        (n.view === 'staffclock' && dept === 'it' && me.user.itRole === 'manager') ||
        n.view === 'work' ||
        // Items (P85, paper section 9): stores, OM and patrol in their area, Finance, HR for uniforms, audit, the COO and the owner.
        (n.view === 'items' && (['om', 'regional', 'ogm', 'ops_director', 'coo'].includes(me.user.opsTier ?? '') || isOwnerAdmin(me.user))) ||
        (n.view === 'branchwork' && (dept === 'audit' || dept === 'cms' || ['om', 'regional', 'ogm', 'ops_director', 'coo'].includes(me.user.opsTier ?? ''))) ||
        (LINE[dept!] ?? ['clock']).includes(n.view)) &&
      // Far branches: the branch manager, the company manager, OM and above, ACT and CMS; not other admin executives.
      (n.view !== 'it-procurement' || (!me.user.integration && (leader || ['it','finance','audit'].includes(dept??'')))) &&
      (n.view !== 'it-metrics' || !me.user.integration) &&
      (n.view !== 'work-kpi' || !!workKpiScope(me.user, [], me.now.slice(0, 10))) &&
      // Salary calculator: the OM and above, ACT and group leadership (Fauzan, 6 Nov 2026).
      (n.view !== 'salarycalc' || leader || dept === 'audit' || ['om', 'regional', 'ogm', 'ops_director', 'coo', 'ceo'].includes(me.user.opsTier ?? '')) &&
      (n.view !== 'hr-it-intake' || !me.user.integration) &&
      (n.view !== 'staff-directory' ||
        (!me.user.integration && (dept === 'hr' || dept === 'it' || ['cos', 'deputy_cos'].includes(me.user.leadership ?? '') || me.user.opsTier === 'ceo'))) &&
      (n.view !== 'it-extraction' || (!me.user.integration && me.user.id === 'u-fauzan' && me.user.opsTier === 'ceo')) &&
      // Every office staff member checks their own Microsoft 365 connections; the server checks role and identity again.
      (n.view !== 'connections' || !me.user.integration) &&
      (n.view !== 'branchwork' || role !== 'admin_exec' || !!me.user.branchId) &&
      // Claims: staff with their own record (not guards or officers), HR and the Chief of Staff (Fauzan, 26 Oct 2026).
      (n.view !== 'claims' || (!!me.user.personId && me.user.opsTier !== 'patrol') || dept === 'hr' || dept === 'chief_of_staff') &&
      // Staff payroll: HR, Finance teams, group leadership, the company manager, and staff for their own payslips.
      (n.view !== 'staffpay' ||
        leader ||
        dept === 'hr' ||
        (dept === 'finance' && me.user.financeTeam != null) ||
        role === 'company_manager' ||
        (!!me.user.personId && role !== 'supervisor' && me.user.opsTier !== 'patrol')) &&
      // Guard pay: HR, Finance teams, group leadership (the COO approves) and the company manager for their own company.
      (n.view !== 'guardpay' || leader || dept === 'hr' || dept === 'director_office' || (dept === 'finance' && me.user.financeTeam != null) || role === 'company_manager') &&
      // Advances: the OM, the Operations Director and OGM, HR, Finance teams and group leadership.
      (n.view !== 'arrivalcash' || me.user.opsTier === 'ceo' || dept === 'finance' || (dept === 'fwm' && me.user.fwmRole === 'manager')) &&
      (n.view !== 'loans' || leader || dept === 'hr' || (dept === 'finance' && me.user.financeTeam != null) || ['coo', 'ceo'].includes(me.user.opsTier ?? '')) &&
      (n.view !== 'statutory' || leader || dept === 'hr' || dept === 'audit' || (dept === 'finance' && me.user.financeTeam != null) || ['coo', 'ceo'].includes(me.user.opsTier ?? '')) &&
      (n.view !== 'advances' || leader || dept === 'hr' || (dept === 'finance' && me.user.financeTeam != null) || ['om', 'regional', 'ogm', 'ops_director', 'coo', 'ceo'].includes(me.user.opsTier ?? '')) &&
      // Company secretary: group leadership (the Chief of Staff and Deputy approve changes), the company manager and admin executives.
      (n.view !== 'corporate' || role !== 'pwvsb_officer' || leader || dept === 'legal' || !!me.user.corpSecretary) &&
      (n.view !== 'renewals' || role !== 'pwvsb_officer' || leader || dept === 'audit') &&
      (n.view !== 'credit' || role !== 'pwvsb_officer' || leader || !!me.user.creditOfficer || dept === 'legal') &&
      (n.view !== 'contracts' || dept !== 'operations' || leader || ['om', 'regional', 'ogm', 'ops_director'].includes(me.user.opsTier ?? '')) &&
      // Finance: the Finance Director, the CEO, the Chairman and Vice Chairman, and Finance team members only.
      (n.view !== 'finance' ||
        ['finance_director', 'chairman', 'vice_chairman'].includes(me.user.leadership ?? '') ||
        isActHead(me.user) ||
        me.user.opsTier === 'ceo' ||
        // The COO sees only his payment approvals there (Fauzan, 1 Nov 2026: approval by subject matter).
        me.user.opsTier === 'coo' ||
        (dept === 'finance' && me.user.financeTeam != null)) &&
      // Hostel bills in operations: the Operations Director and OGM approve; other operations staff do not see them.
      // Vehicles: not for guards and officers (they do not request vehicles here).
      (n.view !== 'fleet' || me.user.opsTier !== 'patrol') &&
      // A far-branch manager runs the branch, not the company office.
      (n.view !== 'office' || !me.user.branchId) &&
      (n.view !== 'requests' || dept !== 'operations' || leader || me.user.opsTier === 'om') &&
      (n.view !== 'clients' || dept !== 'operations' || leader || ['om', 'regional', 'ogm', 'ops_director', 'patrol'].includes(me.user.opsTier ?? '')) &&
      // Procurement sits under the OGM, so operations sees it only as OGM or Operations Director.
      (n.view !== 'purchasing' || dept !== 'operations' || leader || ['ogm', 'ops_director'].includes(me.user.opsTier ?? '')) &&
      // CMS: the CMS, Arms Control, and the COO or higher; not the other group leaders (bug found 27 Oct 2026).
      (n.view !== 'cms' || seesArmsDetail(me.user)) &&
      (n.view !== 'pdpa' || dept !== 'operations' || leader || me.user.opsTier === 'ops_director') &&
      (n.view !== 'hostels' || dept !== 'operations' || leader || ['ops_director', 'ogm'].includes(me.user.opsTier ?? '')) &&
      // Everyone has their own details and clock, except the CEO, Chairman and Vice Chairman (Fauzan, 26 Oct 2026).
      (n.view !== 'mine' || !!me.user.personId) &&
      // P90: the owner sees Clock to test check-in and check-out (a test only, never attendance or pay).
      (n.view !== 'clock' || hasOwnStaffRecord(me.user) || isOwnerAdmin(me.user)) &&
      // Arms detail: CMS, Arms Control, COO or higher, the company manager and the supervisor for their own people (Fauzan, 26 Oct 2026).
      (n.view !== 'arms' || !isGroup || seesArmsDetail(me.user)) &&
      // Operations sees foreign workers only as OM or Regional OM; the FWM despatch sees tasks.
      (n.view !== 'fwm' || dept !== 'operations' || leader || ['om', 'regional'].includes(me.user.opsTier ?? '')) &&
      (dept !== 'fwm' || me.user.fwmRole !== 'despatch' || n.view === 'fwm' || n.view === 'clock' || n.view === 'hr-it-intake') &&
      // The JA Group app owns foreign worker management (rule SYS-JA-OWNS); Prima's own screen is switched off, not deleted.
      (n.view !== 'quality' || me.user.procRole !== 'storekeeper') &&
      (n.view !== 'fwm' || !jaOwns('fwm')) &&
      (n.view !== 'hostels' || !jaOwns('hostels')) &&
      // JA data: operations sees it as OM or above; the FWM despatch does not.
      (n.view !== 'ja' || dept !== 'operations' || leader || ['om', 'regional', 'ogm', 'ops_director'].includes(me.user.opsTier ?? '')) &&
      (n.view !== 'ja' || dept !== 'fwm' || me.user.fwmRole !== 'despatch') &&
      (n.view !== 'ja' || role !== 'supervisor' || !!me.user.opsTier) &&
      (n.view !== 'jaswitch' || canSeeJaSwitch(me.user)),
  )
    // Pilot phase: the pilot users run the whole system with their own menus, so every module keeps running (Fauzan, 28 Oct 2026).
    .map((n) => (n.view === 'mine' && role !== 'guard' && role !== 'supervisor' ? { ...n, label: 'My details' } : n))
    // Officers only assess their guards there: a plain name, no standards (staff-usability rule, 5 Nov 2026).
    .map((n) => (n.view === 'quality' && role === 'supervisor' ? { ...n, label: 'Guard skills' } : n))
    .map((n) => (n.view === 'quality' && dept === 'procurement' && !leader ? { ...n, label: 'Supplier ratings' } : n))
    .map((n) => (n.view === 'people' && (dept === 'hr' || leader) ? { ...n, label: 'People' } : n))
    .sort((a, b) => rank(a.view) - rank(b.view));
  const initialView = (): ViewName => {
    const h = location.hash.slice(1) as ViewName;
    return VIEW_TOKENS.includes(h) && nav.some((x) => x.view === h) ? h : nav[0].view;
  };
  const [route, setRoute] = useState<Route>({ view: initialView() });
  // P75: the office's feedback button explains the screen open now (prima-page.ts).
  useEffect(() => {
    const item = nav.find((n) => n.view === route.view);
    publishPage({
      view: route.view,
      title: item?.label ?? route.view,
      role: { label: me.user.title || ROLE_LABEL[me.user.role] },
      rules: rulesFor(route.view),
    });
  }, [route.view, me.user.id, me.user.role, me.user.title, nav]);
  const [moreOpen, setMoreOpen] = useState(false);
  // Phones show four tabs; the rest and Switch person live under More.
  const tabNav = nav.length > 5 ? nav.slice(0, 4) : nav;
  const moreNav = nav.length > 5 ? nav.slice(4) : [];
  const pilots = me.companies.filter((c) => c.isPilot);
  const [companyId, setCompanyId] = useState<string>((pilots[0] ?? me.companies[0])?.id ?? '');
  const company = me.companies.find((c) => c.id === companyId);
  const [clock, setClock] = useState(me.now);
  // Start each sign-in at the top, not where the sign-in list was scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const t = setInterval(
      () =>
        api
          .me()
          .then((m) => setClock(m.now))
          .catch(() => undefined),
      30_000,
    );
    return () => clearInterval(t);
  }, []);

  const go = useCallback((r: Route) => {
    setRoute(r);
    try {
      history.replaceState(null, '', `#${r.view}`);
    } catch {
      /* ignore */
    }
    window.scrollTo(0, 0);
  }, []);

  const navKey = nav.map((n) => n.view).join(',');
  const canOpen = useCallback((v: ViewName) => navKey.split(',').includes(v), [navKey]);
  const ctx = useMemo<AppCtx>(() => ({ me, companyId, company, setCompanyId, go, isGroup, canOpen }), [me, companyId, company, go, isGroup, canOpen]);

  const view = (() => {
    switch (route.view) {
      case 'home':
        return <HomeView />;
      case 'overview':
        return <Overview />;
      case 'company':
        return <CompanyView />;
      case 'sites':
        return <Sites openSiteId={route.siteId} />;
      case 'roster':
        return <RosterView siteId={route.siteId} />;
      case 'cleaning':
        return <CleaningView />;
      case 'duty':
        return <DutyView />;
      case 'sitestock':
        return <SiteStockView />;
      case 'people':
        return <People openPersonId={route.personId} />;
      case 'attendance':
        return <AttendanceView />;
      case 'cases':
        return <Cases openCaseId={route.caseId} />;
      case 'compliance':
        return <ComplianceView />;
      case 'commercial':
        return <CommercialView openTenderId={route.tenderId} />;
      case 'ops':
        return <OpsView />;
      case 'hr':
        return <HrView />;
      case 'insurance':
        return <InsuranceView />;
      case 'arms':
        return <ArmsView />;
      case 'cms':
        return <CmsView />;
      case 'cmsready':
        return <CmsReadinessView />;
      case 'audit':
        return <AuditView />;
      case 'device':
        return <Device />;
      case 'mine':
        return <MyDuty />;
      case 'clock':
        return <MyClockView />;
      case 'staffclock':
        return <StaffClockBoardView />;
      case 'work':
        return <WorkView />;
      case 'branchwork':
        return <BranchWorkView />;
      case 'socso':
        return <SocsoView />;
      case 'hostels':
        return <HostelsView />;
      case 'fwcost':
        return <FwCostView />;
      case 'fwstat':
        return <FwStatView />;
      case 'claims':
        return <ClaimsView />;
      case 'memos':
        return <MemosView />;
      case 'pdpa':
        return <PdpaView />;
      case 'fleet':
        return <FleetView />;
      case 'clients':
        return <ClientsView />;
      case 'office':
        return <OfficeView />;
      case 'requests':
        return <RequestsView />;
      case 'payreq':
        return <PaymentRequestsView />;
      case 'ja':
        return <JaView />;
      case 'jaswitch':
        return <JaSwitchView />;
      case 'assets':
        return <AssetsView />;
      case 'staffpay':
        return <StaffPayView />;
      case 'guardpay':
        return <GuardPayView />;
      case 'advances':
        return <GuardAdvancesView />;
      case 'arrivalcash':
        return <ArrivalCashView />;
      case 'loans':
        return <GuardLoansView />;
      case 'statutory':
        return <StatutoryView />;
      case 'finance':
        return me?.user.opsTier === 'coo' && me.user.role === 'pwvsb_officer' ? <CooPaymentsView /> : <FinanceView />;
      case 'contracts':
        return <ContractsView />;
      case 'branches':
        return <BranchesView />;
      case 'it-metrics':
        return <ItMetrics />;
      case 'work-kpi':
        return <WorkKpiView />;
      case 'it-procurement':
        return <ItProcurement />;
      case 'staff-directory':
        return <StaffDirectory />;
      case 'hr-it-intake':
        return <HrItIntake />;
      case 'it':
        return <ItView />;
      case 'websites':
        return <WebsitesView />;
      case 'corporate':
        return <CorporateView />;
      case 'renewals':
        return <RenewalsView />;
      case 'credit':
        return <CreditView />;
      case 'purchasing':
        return <PurchasingView />;
      case 'items':
        return <ItemsView />;
      case 'governance':
        return <GovernanceView />;
      case 'quality':
        return <QualityView />;
      case 'grc':
        return <GrcView />;
      case 'registers':
        return <RegistersView />;
      case 'act':
        return <ActView />;
      case 'payformulas':
        return <PayFormulasView />;
      case 'sitehours':
        return <SiteHoursView />;
      case 'salarycalc':
        return <SalaryCalcView />;
      case 'continuity':
        return <ContinuityView />;
      case 'it-extraction':
        return <ItExtractionWorkspace key={me.user.id} actor={me.user} />;
      case 'connections':
        // P78: inside the office, Microsoft 365 is the office's own connection (one system, one sign-in).
        return inOffice ? <OfficeConnections key={me.user.id} /> : <ConnectionsView key={me.user.id} userId={me.user.id} />;
      case 'fwm':
        return <FwmView />;
      case 'doa':
        return <DirectorOfficeView />;
      case 'reports':
        return <ReportsView />;
      case 'meetings':
        return <MeetingsView />;
      case 'selfaudit':
        return <SelfAuditView />;
      case 'rba':
        return <RbaView />;
      case 'surveys':
        return <SurveysView ownerId={me.user.id} />;
      case 'handovers':
        return <HandoversView />;
    }
  })();

  const companyScoped = ![
    'rba',
    'handovers', 'quality',
    'cmsready',
    'home',
    'overview',
    'compliance',
    'audit',
    'device',
    'cases',
    'hr',
    'ops',
    'insurance',
    'cms',
    'clock',
    'staffclock',
    'work',
    'branchwork',
    'socso',
    'fwm',
    'mine',
    'memos',
    'pdpa',
    'fleet',
    'clients',
    'requests',
    'ja',
    'jaswitch',
    'assets',
    'staffpay',
    'guardpay',
    'advances',
  'statutory',
  'arrivalcash',
  'loans',
    'finance',
    'contracts',
    'branches',
    'it',
    'websites',
    'corporate',
    'renewals',
    'credit',
    'purchasing',
    'governance',
    'grc',
    'registers',
    'act',
    'payformulas',
    'sitehours',
    'salarycalc',
    'continuity',
    'connections',
  'it-extraction',
  ].includes(route.view);

  return (
    <Ctx.Provider value={ctx}>
      {nav.some((n) => n.view === 'clock') && <StaffTracker />}
      {/* Each person accepts the confidentiality rule before using Prima (Fauzan, 28 Oct 2026). */}
      <ConfidentialityGate userId={me.user.id} />
      {/* P80: one launcher, bottom right: Arisha (everyone who opens Prima; she teaches and guides, never decides) and
          the office's feedback and Rules & guide. Never for integration logins. */}
      {!me.user.integration && (
        <Launcher key={me.user.id} user={me.user} view={route.view} viewLabel={nav.find((n) => n.view === route.view)?.label ?? route.view} menu={nav.map((n) => n.label)} />
      )}
      <div className="shell">
        <aside className="rail">
          <div className="brand">
            <div className="brand-mark">P</div>
            <div>
              <div className="brand-name">Prima</div>
              <div className="brand-sub">{inOffice ? 'Agentic Office' : 'PWVSB Security Group'}</div>
            </div>
          </div>
          {inOffice && (
            // P71: Prima is a module of the Agentic Office; one step back to the rest of it.
            <a className="rail-back" href="/" target="_top">
              <ArrowLeftIcon size={16} aria-hidden="true" />
              Back to the office
            </a>
          )}
          <nav className="nav" aria-label="Main">
            {navSections(nav).map((sec) => (
              <div className="nav-section" key={sec.title ?? 'all'}>
                {sec.title && <div className="nav-heading">{sec.title}</div>}
                {sec.items.map((n) => (
                  <button key={n.view} aria-current={route.view === n.view ? 'page' : undefined} onClick={() => go({ view: n.view })}>
                    <ViewIcon view={n.view} fallback={n.icon} />
                    {n.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="rail-foot">
            <div>
              <div style={{ fontWeight: 600 }}>{me.user.name}</div>
              <div className="muted small">{me.user.title}</div>
            </div>
            <LangPicker compact />
            <div className="row">
              <button className="btn btn-sm" onClick={onSignOut}>
                {api.mode === 'demo' ? 'Switch person' : 'Sign out'}
              </button>
              {api.mode === 'demo' && (
                <button className="btn btn-sm btn-ghost" onClick={onReset} title="Start again from fresh made-up data">
                  Reset data
                </button>
              )}
            </div>
          </div>
        </aside>
        <div className="main">
          {!me.user.integration && <CleanupReceiptRecovery key={`${me.user.id}:${route.view}`} owner={me.user.id}/>}
          {api.mode === 'demo' && (
            <div className="demo-band">
              <strong>Test version.</strong>
              <span>All people, sites and clients are made up. Changes stay in this browser only.</span>
            </div>
          )}
          <header className="topbar">
            {/* P80: no company list to pick from (central staff with no company): the group's name, not an empty box. */}
            {companyScoped && isGroup && me.companies.length > 0 ? (
              <label className="row" style={{ gap: 6 }}>
                <span className="label">Company</span>
                <select id="company-select" className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  <optgroup label="Pilot companies">
                    {pilots.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Other companies (no detailed data yet)">
                    {me.companies
                      .filter((c) => !c.isPilot)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>
            ) : (
              <strong>{(companyScoped || route.view === 'device') && company ? company.name : 'PWVSB Security Group'}</strong>
            )}
            <span className="grow" />
            <span className="muted small hide-sm">{dept === 'it' ? 'Merdeka Network' : ROLE_LABEL[role]}</span>
            {/* Alerts show here as well as in Teams and email (Fauzan, 5 Nov 2026). */}
            {!me.user.integration && role !== 'site_device' && role !== 'guard' && (
              <AlertBell
                key={me.user.id}
                userId={me.user.id}
                canOpen={(v) => nav.some((n) => n.view === v)}
                onOpen={(v) => {
                  const n = nav.find((x) => x.view === v);
                  if (n) go({ view: n.view });
                }}
              />
            )}
            <span className="mono num muted small" title="Malaysia time">
              {hhmm(clock)} MYT
            </span>
            {/* P86: the draft review queue sits in the top bar as a pop-over, not a strip of its own above it. */}
            {!me.user.integration && <ArishaReviewQueue key={me.user.id} user={me.user} companies={me.companies} />}
            <button className="btn btn-sm hide-sm" onClick={onSignOut}>
              {api.mode === 'demo' ? 'Switch person' : 'Sign out'}
            </button>
          </header>
          {view}
        </div>
        <nav className="tabs" aria-label="Main">
          {tabNav.map((n) => (
            <button key={n.view} aria-current={route.view === n.view ? 'page' : undefined} onClick={() => go({ view: n.view })}>
              <ViewIcon view={n.view} fallback={n.icon} />
              {n.label.split(' ')[0]}
            </button>
          ))}
          {/* Always shown: More also holds Switch person and the language. */}
          {(
            <button aria-current={moreNav.some((n) => n.view === route.view) ? 'page' : undefined} aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
              <Icon name="more" />
              More
            </button>
          )}
        </nav>
        {moreOpen && (
          <>
            <div className="scrim" onClick={() => setMoreOpen(false)} />
            <div className="sheet" role="dialog" aria-label="More">
              {navSections(moreNav).map((sec) => (
                <div className="sheet-section" key={sec.title ?? 'all'}>
                  {sec.title && <div className="nav-heading">{sec.title}</div>}
                  {sec.items.map((n) => (
                    <button
                      key={n.view}
                      className="sheet-item"
                      aria-current={route.view === n.view ? 'page' : undefined}
                      onClick={() => {
                        setMoreOpen(false);
                        go({ view: n.view });
                      }}
                    >
                      <ViewIcon view={n.view} fallback={n.icon} />
                      {n.label}
                    </button>
                  ))}
                </div>
              ))}
              <button
                className="sheet-item"
                onClick={() => {
                  setMoreOpen(false);
                  onSignOut();
                }}
              >
                <Icon name="people" />
                {api.mode === 'demo' ? 'Switch person' : 'Sign out'}
              </button>
              <div className="sheet-item">
                <LangPicker compact />
              </div>
              {api.mode === 'demo' && (
                <button
                  className="sheet-item"
                  onClick={() => {
                    setMoreOpen(false);
                    onReset();
                  }}
                >
                  <Icon name="audit" />
                  Reset test data
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Ctx.Provider>
  );
}

