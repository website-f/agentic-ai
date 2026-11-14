import { Select } from './SearchSelect';
import { installScrollStrips } from './scroll-strip';
import { CleanupReceiptRecovery } from './views/ItCleanup';
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { type Company, type User, RULES, hasOwnStaffRecord, isActHead, isGroupLeader, isOwnerAdmin, jaOwns, seesArmsDetail, workKpiScope, finRequestInMenu, canSeeJaSwitch, bulkLoadInMenu } from '@prima/core';
import { ApiError, api, type Me } from './api';
import { ArrowLeftIcon, HouseIcon, MagnifyingGlassIcon, SquaresFourIcon } from '@phosphor-icons/react';
import { publishPage, rulesFor } from './prima-page';
import { backClosedSheet, useBackClose } from './back-close';
import { ViewIcon } from './icons';
import { SESSION_ENDED } from './api/http';
import { Chip, Icon, Loading, RefreshContext, ToastHost, hhmm } from './ui';
import { AlertBell } from './AlertBell';
import { ArishaReviewQueue } from './ArishaReviewQueue';
import { ConfidentialityGate } from './Confidential';
import { Launcher } from './Launcher';
import { LANGS, LangCtx, saveLang, savedLang, startTranslator, useLang, type Lang } from './i18n';
import { HomeView } from './views/Home';
import { GuardPhoneApp } from './views/GuardPhone';
import { MyClockView, StaffClockBoardView, StaffTracker } from './views/StaffClock';
import { SurveysView } from './views/Surveys';
import { forgetOwner, lastOwner, rememberSetup, syncSurveys } from './survey/offline';
import { NavMenu } from './NavMenu';
import { AppGrid, AppSwitcher, SpacePhoneBar, SpaceRailHead, SpotSearch } from './Spaces';
import { LaunchpadView, SpaceRoute } from './views/SpaceRoute';
import { appsOf, rememberView, spaceLayout, spaceOf, usesApps, type SpaceId } from './nav-catalog';
import { asTop, myName, officeNarrowed, primaOnly } from './office-access';

/**
 * P103 (speed): each screen's code is its own file, fetched when the screen first opens, so Prima opens with only the
 * home screen's code (it was one 6 MB script). A little after the app opens, the screens in this person's own menu are
 * fetched quietly too (prefetchMenuScreens), so moving between them stays instant and they open with no signal later.
 */
function screenCode<M>(load: () => Promise<M>): Promise<M> {
  return load().catch((e: unknown) => {
    // A new version of Prima replaced this screen's file while the app was open: reload once to get the new files.
    try {
      const last = Number(sessionStorage.getItem('prima-code-reload') || 0);
      if (navigator.onLine && Date.now() - last > 60_000) {
        sessionStorage.setItem('prima-code-reload', String(Date.now()));
        location.reload();
        return new Promise<M>(() => undefined);
      }
    } catch {
      /* storage blocked: show the error as before */
    }
    throw e;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each screen keeps its own props
function lazyView<M extends Record<K, ComponentType<any>>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  return lazy(() => screenCode(load).then((m) => ({ default: m[name] })));
}

const ArrivalCashView = lazyView(() => import('./views/ArrivalCash'), 'ArrivalCashView');
const ItMetrics = lazyView(() => import('./views/ItMetrics'), 'ItMetrics');
const WorkKpiView = lazyView(() => import('./views/WorkKpi'), 'WorkKpiView');
const ItProcurement = lazyView(() => import('./views/ItProcurement'), 'ItProcurement');
const HrItIntake = lazyView(() => import('./views/HrItIntake'), 'HrItIntake');
const StaffDirectory = lazyView(() => import('./views/StaffDirectory'), 'StaffDirectory');
const BulkLoad = lazyView(() => import('./views/BulkLoad'), 'BulkLoad');
const ItExtractionWorkspace = lazyView(() => import('./views/ItExtractionWorkspace'), 'ItExtractionWorkspace');
const Overview = lazyView(() => import('./views/Overview'), 'Overview');
const CompanyView = lazyView(() => import('./views/Company'), 'CompanyView');
const Sites = lazyView(() => import('./views/Sites'), 'Sites');
const RosterView = lazyView(() => import('./views/Roster'), 'RosterView');
const CleaningView = lazyView(() => import('./views/Cleaning'), 'CleaningView');
const DutyView = lazyView(() => import('./views/SitePlans'), 'DutyView');
const SiteStockView = lazyView(() => import('./views/SitePlans'), 'SiteStockView');
const People = lazyView(() => import('./views/People'), 'People');
const AttendanceView = lazyView(() => import('./views/Attendance'), 'AttendanceView');
const Cases = lazyView(() => import('./views/Cases'), 'Cases');
const ComplianceView = lazyView(() => import('./views/Compliance'), 'ComplianceView');
const CommercialView = lazyView(() => import('./views/Commercial'), 'CommercialView');
const HrView = lazyView(() => import('./views/Hr'), 'HrView');
const InsuranceView = lazyView(() => import('./views/Insurance'), 'InsuranceView');
const CmsView = lazyView(() => import('./views/Cms'), 'CmsView');
const CmsReadinessView = lazyView(() => import('./views/CmsReadiness'), 'CmsReadinessView');
const OpsView = lazyView(() => import('./views/Ops'), 'OpsView');
const ArmsView = lazyView(() => import('./views/Arms'), 'ArmsView');
const AuditView = lazyView(() => import('./views/Audit'), 'AuditView');
const Device = lazyView(() => import('./views/Device'), 'Device');
const MyDuty = lazyView(() => import('./views/MyDuty'), 'MyDuty');
const BranchWorkView = lazyView(() => import('./views/Work'), 'BranchWorkView');
const WorkView = lazyView(() => import('./views/Work'), 'WorkView');
const SocsoView = lazyView(() => import('./views/Socso'), 'SocsoView');
const HostelsView = lazyView(() => import('./views/Hostels'), 'HostelsView');
const FwCostView = lazyView(() => import('./views/FwCost'), 'FwCostView');
const RateBookView = lazyView(() => import('./views/RateBook'), 'RateBookView');
const FinanceSitesView = lazyView(() => import('./views/FinanceSites'), 'FinanceSitesView');
const FinanceSummaryView = lazyView(() => import('./views/FinanceSummary'), 'FinanceSummaryView');
const FwStatView = lazyView(() => import('./views/FwStat'), 'FwStatView');
const ClaimsView = lazyView(() => import('./views/Claims'), 'ClaimsView');
const MemosView = lazyView(() => import('./views/Memos'), 'MemosView');
const PdpaView = lazyView(() => import('./views/Pdpa'), 'PdpaView');
const FleetView = lazyView(() => import('./views/Fleet'), 'FleetView');
const ClientsView = lazyView(() => import('./views/Clients'), 'ClientsView');
const OfficeView = lazyView(() => import('./views/Office'), 'OfficeView');
const RequestsView = lazyView(() => import('./views/Requests'), 'RequestsView');
const JaView = lazyView(() => import('./views/Ja'), 'JaView');
const JaSwitchView = lazyView(() => import('./views/JaSwitch'), 'JaSwitchView');
const AssetsView = lazyView(() => import('./views/Assets'), 'AssetsView');
const StaffPayView = lazyView(() => import('./views/StaffPay'), 'StaffPayView');
const GuardAdvancesView = lazyView(() => import('./views/GuardPay'), 'GuardAdvancesView');
const GuardLoansView = lazyView(() => import('./views/GuardPay'), 'GuardLoansView');
const GuardPayView = lazyView(() => import('./views/GuardPay'), 'GuardPayView');
const StatutoryView = lazyView(() => import('./views/GuardPay'), 'StatutoryView');
const FinanceView = lazyView(() => import('./views/Finance'), 'FinanceView');
const ContractsView = lazyView(() => import('./views/Contracts'), 'ContractsView');
const BranchesView = lazyView(() => import('./views/Branches'), 'BranchesView');
const ItView = lazyView(() => import('./views/It'), 'ItView');
const RenewalsView = lazyView(() => import('./views/Renewals'), 'RenewalsView');
const CorporateView = lazyView(() => import('./views/Corporate'), 'CorporateView');
const CreditView = lazyView(() => import('./views/Credit'), 'CreditView');
const PurchasingView = lazyView(() => import('./views/Purchasing'), 'PurchasingView');
const ItemsView = lazyView(() => import('./views/Items'), 'ItemsView');
const GovernanceView = lazyView(() => import('./views/Governance'), 'GovernanceView');
const GrcView = lazyView(() => import('./views/Grc'), 'GrcView');
const RegistersView = lazyView(() => import('./views/Registers'), 'RegistersView');
const ActView = lazyView(() => import('./views/Act'), 'ActView');
const PayFormulasView = lazyView(() => import('./views/PayFormulas'), 'PayFormulasView');
const SiteHoursView = lazyView(() => import('./views/SiteHours'), 'SiteHoursView');
const SalaryCalcView = lazyView(() => import('./views/SalaryCalc'), 'SalaryCalcView');
const ContinuityView = lazyView(() => import('./views/Continuity'), 'ContinuityView');
const WebsitesView = lazyView(() => import('./views/Websites'), 'WebsitesView');
const ConnectionsView = lazyView(() => import('./views/Connections'), 'ConnectionsView');
const OfficeConnections = lazyView(() => import('./views/OfficeConnections'), 'OfficeConnections');
const FwmView = lazyView(() => import('./views/Fwm'), 'FwmView');
const DirectorOfficeView = lazyView(() => import('./views/DirectorOffice'), 'DirectorOfficeView');
const ReportsView = lazyView(() => import('./views/Reports'), 'ReportsView');
const MeetingsView = lazyView(() => import('./views/Meetings'), 'MeetingsView');
const SelfAuditView = lazyView(() => import('./views/SelfAudit'), 'SelfAuditView');
const RbaView = lazyView(() => import('./views/Rba'), 'RbaView');
const SettingsHomeView = lazyView(() => import('./views/SettingsHome'), 'SettingsHomeView');
const CooPaymentsView = lazyView(() => import('./views/CooPayments'), 'CooPaymentsView');
const PaymentRequestsView = lazyView(() => import('./views/PaymentRequests'), 'PaymentRequestsView');
const HandoversView = lazyView(() => import('./views/Handovers'), 'HandoversView');
const QualityView = lazyView(() => import('./views/Quality'), 'QualityView');

/** The code of each menu screen, fetched ahead (see prefetchMenuScreens). */
const SCREEN_CODE: Partial<Record<ViewName, () => Promise<unknown>>> = {
  overview: () => import('./views/Overview'),
  company: () => import('./views/Company'),
  sites: () => import('./views/Sites'),
  roster: () => import('./views/Roster'),
  cleaning: () => import('./views/Cleaning'),
  duty: () => import('./views/SitePlans'),
  sitestock: () => import('./views/SitePlans'),
  people: () => import('./views/People'),
  attendance: () => import('./views/Attendance'),
  cases: () => import('./views/Cases'),
  compliance: () => import('./views/Compliance'),
  commercial: () => import('./views/Commercial'),
  ops: () => import('./views/Ops'),
  hr: () => import('./views/Hr'),
  insurance: () => import('./views/Insurance'),
  arms: () => import('./views/Arms'),
  cms: () => import('./views/Cms'),
  cmsready: () => import('./views/CmsReadiness'),
  audit: () => import('./views/Audit'),
  device: () => import('./views/Device'),
  mine: () => import('./views/MyDuty'),
  work: () => import('./views/Work'),
  branchwork: () => import('./views/Work'),
  socso: () => import('./views/Socso'),
  hostels: () => import('./views/Hostels'),
  fwcost: () => import('./views/FwCost'),
  rates: () => import('./views/RateBook'),
  finsites: () => import('./views/FinanceSites'),
  finsummary: () => import('./views/FinanceSummary'),
  fwstat: () => import('./views/FwStat'),
  claims: () => import('./views/Claims'),
  memos: () => import('./views/Memos'),
  pdpa: () => import('./views/Pdpa'),
  fleet: () => import('./views/Fleet'),
  clients: () => import('./views/Clients'),
  office: () => import('./views/Office'),
  requests: () => import('./views/Requests'),
  payreq: () => import('./views/PaymentRequests'),
  ja: () => import('./views/Ja'),
  jaswitch: () => import('./views/JaSwitch'),
  assets: () => import('./views/Assets'),
  staffpay: () => import('./views/StaffPay'),
  guardpay: () => import('./views/GuardPay'),
  advances: () => import('./views/GuardPay'),
  loans: () => import('./views/GuardPay'),
  statutory: () => import('./views/GuardPay'),
  arrivalcash: () => import('./views/ArrivalCash'),
  finance: () => Promise.all([import('./views/Finance'), import('./views/CooPayments')]),
  contracts: () => import('./views/Contracts'),
  branches: () => import('./views/Branches'),
  'it-metrics': () => import('./views/ItMetrics'),
  'work-kpi': () => import('./views/WorkKpi'),
  'it-procurement': () => import('./views/ItProcurement'),
  'staff-directory': () => import('./views/StaffDirectory'),
  'bulk-load': () => import('./views/BulkLoad'),
  'hr-it-intake': () => import('./views/HrItIntake'),
  it: () => import('./views/It'),
  websites: () => import('./views/Websites'),
  corporate: () => import('./views/Corporate'),
  renewals: () => import('./views/Renewals'),
  credit: () => import('./views/Credit'),
  purchasing: () => import('./views/Purchasing'),
  items: () => import('./views/Items'),
  governance: () => import('./views/Governance'),
  quality: () => import('./views/Quality'),
  grc: () => import('./views/Grc'),
  registers: () => import('./views/Registers'),
  act: () => import('./views/Act'),
  payformulas: () => import('./views/PayFormulas'),
  sitehours: () => import('./views/SiteHours'),
  salarycalc: () => import('./views/SalaryCalc'),
  continuity: () => import('./views/Continuity'),
  'it-extraction': () => import('./views/ItExtractionWorkspace'),
  connections: () => Promise.all([import('./views/Connections'), import('./views/OfficeConnections')]),
  fwm: () => import('./views/Fwm'),
  doa: () => import('./views/DirectorOffice'),
  reports: () => import('./views/Reports'),
  meetings: () => import('./views/Meetings'),
  selfaudit: () => import('./views/SelfAudit'),
  rba: () => import('./views/Rba'),
  settings: () => import('./views/SettingsHome'),
  handovers: () => import('./views/Handovers'),
};

/**
 * After the first screen shows, fetch the code of the other screens in this person's menu, one after another and only
 * when the browser is idle; not on a data saver connection. A failed fetch is simply tried again when the screen opens.
 */
function prefetchMenuScreens(views: ViewName[]): () => void {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return () => undefined;
  const queue = [...new Set(views)].map((v) => SCREEN_CODE[v]).filter((f): f is () => Promise<unknown> => !!f);
  let stopped = false;
  const idle = (fn: () => void) =>
    typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(fn, { timeout: 4000 }) : window.setTimeout(fn, 300);
  const next = () => {
    const load = queue.shift();
    if (stopped || !load) return;
    load().catch(() => undefined).finally(() => idle(next));
  };
  const start = window.setTimeout(() => idle(next), 2500);
  return () => {
    stopped = true;
    window.clearTimeout(start);
  };
}



































export type ViewName = 'home' | 'overview' | 'company' | 'sites' | 'roster' | 'cleaning' | 'duty' | 'sitestock' | 'people' | 'attendance' | 'cases' | 'compliance' | 'commercial' | 'ops' | 'hr' | 'insurance' | 'arms' | 'cms' | 'cmsready' | 'audit' | 'device' | 'mine' | 'clock' | 'staffclock' | 'work' | 'branchwork' | 'socso' | 'fwm' | 'doa' | 'reports' | 'meetings' | 'hostels' | 'fwcost' | 'fwstat' | 'claims' | 'memos' | 'pdpa' | 'fleet' | 'clients' | 'office' | 'requests' | 'payreq' | 'ja' | 'jaswitch' | 'assets' | 'staffpay' | 'guardpay' | 'advances' | 'statutory' | 'arrivalcash' | 'loans' | 'finance' | 'contracts' | 'branches' | 'it' | 'it-metrics' | 'work-kpi' | 'it-procurement' | 'hr-it-intake' | 'staff-directory' | 'websites' | 'corporate' | 'renewals' | 'credit' | 'purchasing' | 'items' | 'governance' | 'grc' | 'registers' | 'act' | 'payformulas' | 'sitehours' | 'salarycalc' | 'continuity' | 'connections' | 'it-extraction' | 'surveys' | 'handovers' | 'quality' | 'selfaudit' | 'rba' | 'bulk-load' | 'rates' | 'finsites' | 'settings' | 'finsummary';

export interface Route {
  view: ViewName;
  siteId?: string;
  personId?: string;
  caseId?: string;
  tenderId?: string;
  /** P91: on the home screen, the app whose own home page is open (`#@hr`). */
  space?: SpaceId;
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
  /** P90: this person's menu (screen, label, icon), for the home screen's "All your screens". */
  menu?: { view: ViewName; label: string; icon: string }[];
  /** P91: whether this person's menu is split into apps, and opening one (null = the home screen). */
  apps?: boolean;
  openSpace?: (id: SpaceId | null) => void;
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

// P90: the sections, their small groups and the search words live in nav-catalog.ts; NavMenu.tsx draws the menu.

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
  // J7 (Fauzan, 11 Nov 2026): one Settings home, each setting with its owner and whether it is set; the server decides the rest.
  { view: 'settings', label: 'Settings', icon: 'compliance', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
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
  // P100 fin, C5 (Fauzan, 11 Nov 2026): the rate book; Finance, the COO and the CEO read it, the FD or the CEO sets it.
  { view: 'rates', label: 'Rate book', icon: 'insurance', roles: ['director', 'pwvsb_officer'] },
  // P100 fin, F1/F2 (Fauzan, 11 Nov 2026): sites billed and their profit; Finance, the FD, the CEO, the COO and the company manager (own company).
  // P100 fin, F3 (Fauzan, 11 Nov 2026): one page each month: the CEO, the FD, the Chairman and Vice Chairman, and Finance teams for their companies.
  { view: 'finsummary', label: 'Monthly finance page', icon: 'insurance', roles: ['director', 'pwvsb_officer'] },
  { view: 'finsites', label: 'Site billing and profit', icon: 'insurance', roles: ['director', 'pwvsb_officer', 'company_manager'] },
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
  // P90: not for site and patrol officers: it times IT jobs and IT requests, and their menu has no IT screen to raise one.
  { view: 'it-metrics', label: 'Workflow time & quality', icon: 'device', roles: ['director','pwvsb_officer','company_manager','admin_exec'] },
  // Staff directory (Fauzan, 4 Nov 2026): HR, the HR Director, the CEO and IT only; never a sign-in.
  { view: 'staff-directory', label: 'Staff directory', icon: 'audit', roles: ['director', 'pwvsb_officer'] },
  // K8 (Fauzan, 11 Nov 2026): bulk loads of data files and many documents, for the people who keep those records.
  { view: 'bulk-load', label: 'Bulk load', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'hr-it-intake', label: 'HR / IT coordination', icon: 'device', roles: ['director','pwvsb_officer','company_manager','admin_exec','supervisor'] },
  // Group websites (Fauzan, 27 Oct 2026): IT runs the register and reviews; each company answers for its own websites.
  { view: 'websites', label: 'Websites', icon: 'device', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'staffpay', label: 'Staff payroll', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // Guard pay run (Fauzan, 5 Nov 2026; P100 B1 11 Nov 2026): each company's named preparer prepares, the COO approves, Finance pays.
  { view: 'guardpay', label: 'Guard pay', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
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
  'bulk-load',
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
'rba',
'settings',
'rates',
'finsites',
'finsummary'
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
  // P90: section tabs and chip strips that run off the side get arrows, wheel and drag scrolling on a computer.
  useEffect(() => installScrollStrips(document.body), []);
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
    finance: ['finance', 'finsummary', 'rates', 'finsites', 'staffpay', 'guardpay', 'advances', 'arrivalcash', 'loans', 'statutory', 'assets', 'credit', 'purchasing', 'items', 'websites', 'reports', 'meetings', 'clock', 'fwcost', 'fwstat'],
    it: ['it', 'items', 'websites', 'connections', 'continuity', 'reports', 'meetings', 'clock'],
    legal: ['credit', 'governance', 'corporate', 'reports', 'meetings', 'clock', 'registers'],
    audit: ['act', 'payformulas', 'statutory', 'sitehours', 'salarycalc', 'grc', 'audit', 'selfaudit', 'items', 'websites', 'reports', 'meetings', 'clock', 'renewals', 'cleaning', 'registers', 'quality'],
    // Procurement and Inventory: 1 executive and 2 storekeepers under the OGM (Fauzan, 27 Oct 2026).
    procurement: ['purchasing', 'items', 'reports', 'meetings', 'clock', 'sitestock', 'quality'],
  };
  const roleNav = NAV.filter(
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
        n.view === 'bulk-load' ||
        n.view === 'it-procurement' ||
        n.view === 'grc' ||
        n.view === 'act' ||
        n.view === 'rba' ||
        n.view === 'settings' ||
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
      // K8: bulk load for the people who keep a record that loads in bulk, and oversight; the server lists what each may write.
      (n.view !== 'bulk-load' || bulkLoadInMenu(me.user)) &&
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
      (n.view !== 'guardpay' || leader || dept === 'hr' || dept === 'director_office' || (dept === 'finance' && me.user.financeTeam != null) || role === 'company_manager' || me.guardPayPreparer === true) &&
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
      // P100 fin, C5: the rate book for the Finance Director, the CEO, the COO and Finance team members (the server checks it too).
      (n.view !== 'finsummary' || ['finance_director', 'chairman', 'vice_chairman'].includes(me.user.leadership ?? '') || me.user.opsTier === 'ceo' || (dept === 'finance' && me.user.financeTeam != null)) &&
      (n.view !== 'finsites' || role === 'company_manager' || me.user.leadership === 'finance_director' || ['ceo', 'coo'].includes(me.user.opsTier ?? '') || (dept === 'finance' && me.user.financeTeam != null)) &&
      (n.view !== 'rates' || me.user.leadership === 'finance_director' || ['ceo', 'coo'].includes(me.user.opsTier ?? '') || (dept === 'finance' && me.user.financeTeam != null)) &&
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
  // P99: the office narrows Prima to the screens it gives this person (office-access.ts); Home if nothing is left.
  const narrowed = officeNarrowed(roleNav, me.office);
  const nav = narrowed.length ? narrowed : [{ view: 'home' as ViewName, label: 'Home', icon: 'company', roles: [] as User['role'][] }];
  const initialView = (): ViewName => {
    const h = location.hash.slice(1) as ViewName;
    return VIEW_TOKENS.includes(h) && nav.some((x) => x.view === h) ? h : nav[0].view;
  };
  // P91: Prima as apps for a long menu; `#@hr` opens an app's own home page.
  const apps = usesApps(nav);
  const initialRoute = (): Route => {
    const h = location.hash.slice(1);
    if (apps && h.startsWith('@')) {
      const id = h.slice(1) as SpaceId;
      if (id !== 'home' && spaceLayout(nav, id)) return { view: 'home', space: id };
    }
    // With apps, Prima opens on the home screen (the app cards), unless the address names a screen of this person.
    if (apps && !(VIEW_TOKENS.includes(h as ViewName) && nav.some((x) => x.view === h))) return { view: 'home' };
    return { view: initialView() };
  };
  const [route, setRoute] = useState<Route>(initialRoute);
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
  // P90: the menu search shortcut on a phone opens More with its search box ready.
  const [moreSearch, setMoreSearch] = useState(false);
  const openMoreSearch = useCallback(() => {
    setMoreSearch(true);
    setMoreOpen(true);
  }, []);
  // P90: the screens opened lately, for "Recently opened" on the home screen (this browser only).
  useEffect(() => {
    rememberView(me.user.id, route.view);
  }, [me.user.id, route.view]);
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

  // P91: the app the open screen sits in (null = the home screen and the everyday screens).
  const spaceOfRoute = useCallback(
    (r: Route): SpaceId | null => {
      if (!apps) return null;
      if (r.view === 'home') return r.space ?? null;
      const s = spaceOf(r.view);
      return s === 'home' ? null : s;
    },
    [apps],
  );
  const space = spaceOfRoute(route);
  const spaceNow = useRef(space);
  spaceNow.current = space;
  const go = useCallback(
    (r: Route) => {
      // Going into an app or back out of one is a step the phone's Back button undoes; moving inside an app is not.
      const step = apps && spaceOfRoute(r) !== spaceNow.current;
      setRoute(r);
      try {
        const hash = r.view === 'home' && r.space ? `#@${r.space}` : `#${r.view}`;
        if (step) history.pushState(null, '', hash);
        else history.replaceState(null, '', hash);
      } catch {
        /* ignore */
      }
      window.scrollTo(0, 0);
    },
    [apps, spaceOfRoute],
  );
  const openSpace = useCallback((id: SpaceId | null) => go(id && id !== 'home' ? { view: 'home', space: id } : { view: 'home' }), [go]);
  // The phone's or browser's Back after going into an app: the screen in the address comes back.
  useEffect(() => {
    if (!apps) return;
    const onPop = (e: PopStateEvent) => {
      // P96: that Back closed a sheet or drawer; the screen stays as it is.
      if (backClosedSheet(e)) return;
      const h = location.hash.slice(1);
      if (h.startsWith('@') && spaceLayout(nav, h.slice(1) as SpaceId)) setRoute({ view: 'home', space: h.slice(1) as SpaceId });
      else if (VIEW_TOKENS.includes(h as ViewName) && nav.some((x) => x.view === h)) setRoute({ view: h as ViewName });
      else if (!h || h === 'home') setRoute({ view: 'home' });
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps]);

  const navKey = nav.map((n) => n.view).join(',');
  const canOpen = useCallback((v: ViewName) => navKey.split(',').includes(v), [navKey]);
  // P103: once the first screen is up, fetch the code of the other screens in this person's menu.
  useEffect(() => prefetchMenuScreens(navKey.split(',') as ViewName[]), [navKey]);
  const menuKey = nav.map((n) => `${n.view}:${n.label}`).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const menu = useMemo(() => {
    const m = nav.map((n) => ({ view: n.view, label: n.label, icon: n.icon }));
    // P91: with apps everyone has a home screen to come back to. Without Home in their menu it is the app cards only
    // (no dashboard numbers), so nobody sees more than before.
    return apps && !m.some((n) => n.view === 'home') ? [{ view: 'home' as ViewName, label: 'Home', icon: 'company' }, ...m] : m;
  }, [menuKey, apps]);
  const ctx = useMemo<AppCtx>(() => ({ me, companyId, company, setCompanyId, go, isGroup, canOpen, menu, apps, openSpace }), [me, companyId, company, go, isGroup, canOpen, menu, apps, openSpace]);
  // P91: the side menu shows the open app's screens only (or, on the home screen, the everyday screens).
  const railItems = useMemo(() => (apps ? (spaceLayout(menu, space ?? 'home')?.groups.flatMap((g) => g.items) ?? []) : menu), [apps, menu, space]);
  const [appsOpen, setAppsOpen] = useState(false);
  // P96: the phone's Back closes the More and Apps sheets.
  useBackClose(moreOpen, () => {
    setMoreOpen(false);
    setMoreSearch(false);
  });
  useBackClose(appsOpen, () => setAppsOpen(false));
  const personal = apps ? (nav.find((n) => n.view === 'clock') ?? nav.find((n) => n.view === 'work') ?? nav.find((n) => n.view === 'mine')) : undefined;

  const view = (() => {
    switch (route.view) {
      case 'home':
        if (route.space) return <SpaceRoute key={route.space} id={route.space} />;
        return nav.some((n) => n.view === 'home') ? <HomeView /> : <LaunchpadView />;
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
      case 'rates':
        return <RateBookView />;
      case 'finsites':
        return <FinanceSitesView />;
      case 'finsummary':
        return <FinanceSummaryView />;
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
      case 'bulk-load':
        return <BulkLoad />;
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
      case 'settings':
        return <SettingsHomeView />;
      case 'surveys':
        return <SurveysView ownerId={me.user.id} />;
      case 'handovers':
        return <HandoversView />;
    }
  })();

  const companyScoped = ![
    'rba',
    'rates',
    'finsites',
    'finsummary',
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
        <Launcher key={me.user.id} user={asTop(me) ? { ...me.user, name: myName(me) } : me.user} view={route.view} viewLabel={nav.find((n) => n.view === route.view)?.label ?? route.view} menu={nav.map((n) => n.label)} />
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
          {inOffice && !primaOnly(me) && (
            // P71: Prima is a module of the Agentic Office; one step back to the rest of it. P99: not for Prima only.
            <a className="rail-back" href="/" target="_top">
              <ArrowLeftIcon size={16} aria-hidden="true" />
              Back to the office
            </a>
          )}
          {apps && space && <SpaceRailHead id={space} menu={menu} onHome={() => openSpace(null)} onSpace={openSpace} />}
          <nav className="nav" aria-label="Main">
            <NavMenu
              key={apps ? `space-${space ?? 'home'}` : 'menu'}
              variant="rail"
              items={railItems}
              searchItems={menu}
              layout={apps ? 'groups' : 'sections'}
              after={apps && !space ? <AppSwitcher menu={menu} onSpace={openSpace} label /> : undefined}
              current={route.view}
              userId={me.user.id}
              onOpen={(v) => go({ view: v })}
              onHotkeyHidden={openMoreSearch}
            />
          </nav>
          <div className="rail-foot">
            <div>
              <div style={{ fontWeight: 600 }} data-no-translate>{myName(me)}</div>
              {asTop(me) ? (
                <div className="muted small">
                  <span>Opens Prima as</span> <span data-no-translate>{me.user.title || me.user.name}</span>
                </div>
              ) : (
                <div className="muted small">{me.user.title}</div>
              )}
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
                <Select id="company-select" className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
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
                </Select>
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
            {!me.user.integration && <ArishaReviewQueue key={`review-${me.user.id}`} user={me.user} companies={me.companies} />}
            <button className="btn btn-sm hide-sm" onClick={onSignOut}>
              {api.mode === 'demo' ? 'Switch person' : 'Sign out'}
            </button>
          </header>
          {/* P90: every screen sits in one page frame (padding, width, rhythm), even one that draws no .page of its own. */}
          {apps && space && <SpacePhoneBar id={space} menu={menu} current={route.view === 'home' ? null : route.view} onHome={() => openSpace(null)} onSpace={openSpace} onView={(v) => go({ view: v })} />}
          <div className="view-host">
            {/* P103: a screen's code arrives the first time it opens (lazyView); this shows meanwhile. */}
            <Suspense fallback={<Loading what="the screen" />}>{view}</Suspense>
          </div>
        </div>
        <nav className="tabs" aria-label="Main">
          {/* P91: with apps, the phone's tabs are Home, Apps, Search, the person's own clock or work, and More. */}
          {apps && (
            <>
              <button aria-current={route.view === 'home' && !route.space ? 'page' : undefined} onClick={() => openSpace(null)}>
                <HouseIcon size={22} aria-hidden="true" />
                Home
              </button>
              <button aria-current={space ? 'page' : undefined} aria-expanded={appsOpen} onClick={() => setAppsOpen(true)}>
                <SquaresFourIcon size={22} aria-hidden="true" />
                Apps
              </button>
              <button aria-expanded={moreOpen && moreSearch} onClick={openMoreSearch}>
                <MagnifyingGlassIcon size={22} aria-hidden="true" />
                Search
              </button>
              {personal && (
                <button aria-current={route.view === personal.view ? 'page' : undefined} onClick={() => go({ view: personal.view })}>
                  <ViewIcon view={personal.view} fallback={personal.icon} />
                  {personal.label.split(' ')[0]}
                </button>
              )}
            </>
          )}
          {!apps && tabNav.map((n) => (
            <button key={n.view} aria-current={route.view === n.view ? 'page' : undefined} onClick={() => go({ view: n.view })}>
              <ViewIcon view={n.view} fallback={n.icon} />
              {n.label.split(' ')[0]}
            </button>
          ))}
          {/* Always shown: More also holds Switch person and the language. */}
          {(
            <button aria-current={!apps && moreNav.some((n) => n.view === route.view) ? 'page' : undefined} aria-expanded={moreOpen && !moreSearch} onClick={() => (setMoreSearch(false), setMoreOpen(true))}>
              <Icon name="more" />
              More
            </button>
          )}
        </nav>
        {moreOpen && (
          <>
            <div
              className="scrim"
              onClick={() => {
                setMoreOpen(false);
                setMoreSearch(false);
              }}
            />
            <div className="sheet" role="dialog" aria-label="More">
              <NavMenu
                variant="sheet"
                layout={apps ? 'groups' : 'sections'}
                items={apps ? (spaceLayout(menu, 'home')?.groups.flatMap((g) => g.items) ?? []) : moreNav.map((n) => ({ view: n.view, label: n.label, icon: n.icon }))}
                searchItems={menu}
                current={route.view}
                userId={me.user.id}
                focusSearch={moreSearch}
                onOpen={(v) => {
                  setMoreOpen(false);
                  setMoreSearch(false);
                  go({ view: v });
                }}
              />
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
        {appsOpen && (
          <>
            <div className="scrim" onClick={() => setAppsOpen(false)} />
            <div className="sheet sp-sheet" role="dialog" aria-label="Apps">
              <div className="sp-sheet-head">
                <strong>Apps</strong>
              </div>
              <SpotSearch
                menu={menu}
                onView={(v) => {
                  setAppsOpen(false);
                  go({ view: v });
                }}
                onSpace={(id) => {
                  setAppsOpen(false);
                  openSpace(id);
                }}
              />
              <AppGrid
                apps={appsOf(menu)}
                compact
                current={space}
                onOpen={(id) => {
                  setAppsOpen(false);
                  openSpace(id);
                }}
              />
            </div>
          </>
        )}
      </div>
    </Ctx.Provider>
  );
}

