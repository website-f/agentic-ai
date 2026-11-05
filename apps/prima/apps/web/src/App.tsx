import {ItMetrics} from './views/ItMetrics';
import {CleanupReceiptRecovery} from './views/ItCleanup';
import {ItProcurement} from './views/ItProcurement';
import { HrItIntake } from './views/HrItIntake';
import { ItExtractionWorkspace } from './views/ItExtractionWorkspace';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Company, User } from '@prima/core';
import { RULES, hasOwnStaffRecord, isActHead, isGroupLeader, jaOwns, seesArmsDetail } from '@prima/core';
import { ApiError, api, type Me } from './api';
import { SESSION_ENDED } from './api/http';
import { Chip, Icon, Loading, RefreshContext, ToastHost, hhmm } from './ui';
import { Arisha } from './Arisha';
import { ArishaReviewQueue } from './ArishaReviewQueue';
import { ConfidentialityGate } from './Confidential';
import { LANGS, LangCtx, saveLang, savedLang, startTranslator, useLang, type Lang } from './i18n';
import { Overview } from './views/Overview';
import { CompanyView } from './views/Company';
import { Sites } from './views/Sites';
import { RosterView } from './views/Roster';
import { People } from './views/People';
import { AttendanceView } from './views/Attendance';
import { Cases } from './views/Cases';
import { ComplianceView } from './views/Compliance';
import { CommercialView } from './views/Commercial';
import { HrView } from './views/Hr';
import { InsuranceView } from './views/Insurance';
import { CmsView } from './views/Cms';
import { OpsView } from './views/Ops';
import { HomeView } from './views/Home';
import { ArmsView } from './views/Arms';
import { AuditView } from './views/Audit';
import { Device } from './views/Device';
import { MyDuty } from './views/MyDuty';
import { MyClockView, StaffClockBoardView, StaffTracker } from './views/StaffClock';
import { BranchWorkView, WorkView } from './views/Work';
import { SocsoView } from './views/Socso';
import { HostelsView } from './views/Hostels';
import { ClaimsView } from './views/Claims';
import { MemosView } from './views/Memos';
import { PdpaView } from './views/Pdpa';
import { FleetView } from './views/Fleet';
import { ClientsView } from './views/Clients';
import { RequestsView } from './views/Requests';
import { JaView } from './views/Ja';
import { AssetsView } from './views/Assets';
import { StaffPayView } from './views/StaffPay';
import { FinanceView } from './views/Finance';
import { ContractsView } from './views/Contracts';
import { BranchesView } from './views/Branches';
import { ItView } from './views/It';
import { CorporateView } from './views/Corporate';
import { CreditView } from './views/Credit';
import { PurchasingView } from './views/Purchasing';
import { GovernanceView } from './views/Governance';
import { GrcView } from './views/Grc';
import { ActView } from './views/Act';
import { ContinuityView } from './views/Continuity';
import { WebsitesView } from './views/Websites';
import { ConnectionsView } from './views/Connections';
import { FwmView } from './views/Fwm';
import { DirectorOfficeView } from './views/DirectorOffice';
import { ReportsView } from './views/Reports';
import { MeetingsView } from './views/Meetings';

export type ViewName =
  | 'home'
  | 'overview'
  | 'company'
  | 'sites'
  | 'roster'
  | 'people'
  | 'attendance'
  | 'cases'
  | 'compliance'
  | 'commercial'
  | 'ops'
  | 'hr'
  | 'insurance'
  | 'arms'
  | 'cms'
  | 'audit'
  | 'device'
  | 'mine'
  | 'clock'
  | 'staffclock'
  | 'work'
  | 'branchwork'
  | 'socso'
  | 'fwm'
  | 'doa'
  | 'reports'
  | 'meetings'
  | 'hostels'
  | 'claims'
  | 'memos'
  | 'pdpa'
  | 'fleet'
  | 'clients'
  | 'requests'
  | 'ja'
  | 'assets'
  | 'staffpay'
  | 'finance'
  | 'contracts'
  | 'branches'
  | 'it'
  | 'it-metrics'
  | 'it-procurement'
  | 'hr-it-intake'
  | 'websites'
  | 'corporate'
  | 'credit'
  | 'purchasing'
  | 'governance'
  | 'grc'
  | 'act'
  | 'continuity'
  | 'connections'
  | 'it-extraction';

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
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);

/** depts is informational now: which central departments a screen serves; LINE in Shell decides who sees it. */
/**
 * P68 (Agentic Office): the menu in sections, so a long menu reads at a glance. Each screen keeps its own rank inside
 * its section; a short menu (8 or fewer) stays one plain list.
 */
const NAV_GROUPS: { title: string; views: ViewName[] }[] = [
  { title: 'Today', views: ['home', 'overview', 'company', 'work', 'mine', 'clock', 'staffclock', 'doa', 'reports', 'meetings'] },
  { title: 'Operations', views: ['sites', 'roster', 'people', 'attendance', 'cases', 'ops', 'device', 'branchwork', 'fleet', 'arms', 'cms'] },
  { title: 'People and HR', views: ['hr', 'claims', 'staffpay', 'fwm', 'socso', 'hostels', 'requests', 'memos', 'pdpa'] },
  { title: 'Business and finance', views: ['commercial', 'clients', 'contracts', 'finance', 'credit', 'purchasing', 'branches', 'assets', 'insurance', 'ja'] },
  { title: 'Compliance and governance', views: ['compliance', 'audit', 'grc', 'act', 'governance', 'corporate', 'continuity'] },
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
  { view: 'sites', label: 'Sites', icon: 'sites', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'roster', label: 'Roster', icon: 'roster', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'people', label: 'Guards', icon: 'people', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'attendance', label: 'Attendance', icon: 'attendance', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'cases', label: 'Cases', icon: 'cases', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'] },
  { view: 'compliance', label: 'Licences', icon: 'compliance', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
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
  { view: 'audit', label: 'Audit trail', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager'] },
  { view: 'device', label: 'Site device', icon: 'device', roles: ['site_device'] },
  { view: 'doa', label: 'Director Office', icon: 'tender', roles: ['director', 'pwvsb_officer'] },
  { view: 'reports', label: 'Reports', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
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
  { view: 'fleet', label: 'Vehicles', icon: 'sites', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // JA Group app (Fauzan, 26 Oct 2026): guard and officer payroll, foreign workers and incidents, read-only from its feed.
  {
    view: 'ja',
    label: 'JA app data',
    icon: 'group',
    roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec', 'supervisor'],
    depts: ['operations', 'hr', 'fwm', 'cms'],
  },
  // Asset Management (Fauzan, 26 Oct 2026): its team, group leadership and the finance staff who oversee it; no group company.
  { view: 'assets', label: 'Asset Management', icon: 'company', roles: ['director', 'pwvsb_officer'], depts: ['asset', 'finance'] },
  // Staff payroll (Fauzan, 27 Oct 2026): HR prepares, the Chief of Staff approves, the Vice Chairman consents, Finance pays;
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
  // Governance (V7, V8, V12): the mandates PWVSB acts under; legal and the Chief of Staff register, the company board confirms.
  { view: 'governance', label: 'Mandates', icon: 'compliance', roles: ['director', 'pwvsb_officer', 'company_manager'] },
  // Company secretary (V9): the company records its filings and board; PWVSB (Chief of Staff, Deputy) approves corporate changes.
  { view: 'corporate', label: 'Company secretary', icon: 'compliance', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // Purchasing and store (V5): the company buys and runs its uniform store; approvals by delegation limits; Finance matches and posts.
  { view: 'purchasing', label: 'Procurement', icon: 'cart', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // Continuity: IT keeps three copies of every system in Malaysia and tests restores; group leadership watches.
  { view: 'it-extraction', label: 'AI data preview', icon: 'device', roles: ['director', 'pwvsb_officer'] },
  { view: 'connections', label: 'Connections', icon: 'device', roles: ['director', 'pwvsb_officer'] },
  { view: 'continuity', label: 'Continuity', icon: 'device', roles: ['director', 'pwvsb_officer'] },
  { view: 'it', label: 'IT', icon: 'device', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  // This route exposes only server-scoped coordination/own details, not the IT board or identity grants.
  { view: 'it-procurement', label: 'IT purchase fulfilment', icon: 'device', roles: ['director','pwvsb_officer'] },
  { view: 'it-metrics', label: 'Workflow time & quality', icon: 'device', roles: ['director','pwvsb_officer','company_manager','admin_exec','supervisor','guard'] },
  { view: 'hr-it-intake', label: 'HR / IT coordination', icon: 'device', roles: ['director','pwvsb_officer','company_manager','admin_exec','supervisor','guard'] },
  // Group websites (Fauzan, 27 Oct 2026): IT runs the register and reviews; each company answers for its own websites.
  { view: 'websites', label: 'Websites', icon: 'device', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'staffpay', label: 'Staff payroll', icon: 'audit', roles: ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
  { view: 'memos', label: 'Memos', icon: 'compliance', roles: ['guard', 'supervisor', 'director', 'pwvsb_officer', 'company_manager', 'admin_exec'] },
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
  'pwvsb_officer:audit': ['act', 'grc', 'audit', 'clock'],
  'pwvsb_officer:procurement': ['purchasing', 'clock'],
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
  'home',
  'overview',
  'company',
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
  'claims',
  'memos',
  'pdpa',
  'fleet',
  'clients',
  'requests',
  'ja',
  'assets',
  'staffpay',
  'finance',
  'contracts',
  'branches',
  'it',
  'it-metrics',
  'it-procurement',
  'hr-it-intake',
  'websites',
  'corporate',
  'credit',
  'purchasing',
  'governance',
  'grc',
  'act',
  'continuity',
  'connections',
  'it-extraction',
];

function SignIn({ onSignedIn, notice }: { onSignedIn: (me: Me) => void; notice?: string | null }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(notice ?? null);
  // Office staff sign in with their Microsoft 365 account; the person picker is only for the test link and development.
  const [ways, setWays] = useState<{ microsoft: boolean; devLogin: boolean; office?: boolean } | null>(api.signInOptions ? null : { microsoft: false, devLogin: true });
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
            <p className="muted">Prima opens with your Agentic Office sign-in. Sign in to the office, then open Prisma again.</p>
            <a className="btn btn-primary" href="/login?next=%2Fprisma" target="_top">
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
        setBooting(false);
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

  if (booting) return <Loading what="Prima Secure App" />;
  return (
    <ToastHost>
      <RefreshContext.Provider value={{ version, bump }}>
        {me ? (
          <Shell
            me={me}
            onSignOut={() => {
              // Signing out clocks staff out (Fauzan, 27 Oct 2026).
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
  const first = (leader ? ROLE_FIRST.leader : ROLE_FIRST[dept ? `${role}:${dept}` : role]) ?? ROLE_FIRST[role] ?? [];
  // Staff clock in daily, so My clock sits right after the first screen (Fauzan, 26 Oct 2026).
  const rank = (v: ViewName) =>
    v === 'clock' ? 0.5 : v === 'work' ? 0.6 : me.user.branchId && v === 'branchwork' ? 0.7 : first.includes(v) ? first.indexOf(v) : first.length;
  // Group data is for group leadership only: CEO, COO, Finance Director, Chief of Staff, Deputy Chief of Staff,
  // Chairman and Vice Chairman. Other PWVSB staff see only their own line of work (Fauzan, 26 Oct 2026).
  const LINE: Partial<Record<NonNullable<User['department']>, ViewName[]>> = {
    operations: [
      'ops',
      'purchasing',
      'clients',
      'contracts',
      'requests',
      'ja',
      'pdpa',
      'hostels',
      'sites',
      'roster',
      'people',
      'attendance',
      'cases',
      'fwm',
      'socso',
      'reports',
      'meetings',
      'clock',
    ],
    hr: ['hr', 'ja', 'people', 'socso', 'staffclock', 'hostels', 'claims', 'staffpay', 'reports', 'meetings', 'clock'],
    // Arms Control sees arms matters only (Fauzan, 25 Oct 2026).
    arms_control: ['arms', 'cms', 'cases', 'audit', 'reports', 'meetings', 'clock'],
    cms: ['cms', 'ja', 'arms', 'fleet', 'clock'],
    director_office: ['doa', 'commercial', 'reports', 'meetings', 'clock'],
    chief_of_staff: ['requests', 'claims', 'staffpay', 'insurance', 'reports', 'meetings', 'clock'],
    // FWM: foreign workers, their movements and hostels only, no tenders or other modules (Fauzan, 26 Oct 2026).
    fwm: ['fwm', 'ja', 'hostels', 'people', 'reports', 'meetings', 'clock'],
    pdpa: ['pdpa', 'fleet', 'reports', 'meetings', 'clock'],
    transport: ['fleet', 'reports', 'meetings', 'clock'],
    asset: ['assets', 'reports', 'meetings', 'clock'],
    finance: ['finance', 'staffpay', 'assets', 'credit', 'purchasing', 'websites', 'reports', 'meetings', 'clock'],
    it: ['it', 'websites', 'connections', 'continuity', 'reports', 'meetings', 'clock'],
    legal: ['credit', 'governance', 'corporate', 'reports', 'meetings', 'clock'],
    audit: ['act', 'grc', 'audit', 'websites', 'reports', 'meetings', 'clock'],
    // Procurement and Inventory: 1 executive and 2 storekeepers under the OGM (Fauzan, 27 Oct 2026).
    procurement: ['purchasing', 'reports', 'meetings', 'clock'],
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
        n.view === 'fleet' ||
        n.view === 'it' ||
        n.view === 'it-metrics' ||
        n.view === 'hr-it-intake' ||
        n.view === 'it-procurement' ||
        n.view === 'grc' ||
        n.view === 'act' ||
        // The IT Manager sees the IT team's clock, view only (Fauzan, 28 Oct 2026).
        (n.view === 'staffclock' && dept === 'it' && me.user.itRole === 'manager') ||
        n.view === 'work' ||
        (n.view === 'branchwork' && (dept === 'audit' || dept === 'cms' || ['om', 'regional', 'ogm', 'ops_director', 'coo'].includes(me.user.opsTier ?? ''))) ||
        (LINE[dept!] ?? ['clock']).includes(n.view)) &&
      // Far branches: the branch manager, the company manager, OM and above, ACT and CMS; not other admin executives.
      (n.view !== 'it-procurement' || (!me.user.integration && (leader || ['it','finance','audit'].includes(dept??'')))) &&
      (n.view !== 'it-metrics' || !me.user.integration) &&
      (n.view !== 'hr-it-intake' || !me.user.integration) &&
      (n.view !== 'it-extraction' || (!me.user.integration && me.user.id === 'u-fauzan' && me.user.opsTier === 'ceo')) &&
      (n.view !== 'connections' || (!me.user.integration && (leader || isActHead(me.user) || dept === 'it'))) &&
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
      // Company secretary: group leadership (the Chief of Staff and Deputy approve changes), the company manager and admin executives.
      (n.view !== 'corporate' || role !== 'pwvsb_officer' || leader || dept === 'legal') &&
      (n.view !== 'credit' || role !== 'pwvsb_officer' || leader || !!me.user.creditOfficer || dept === 'legal') &&
      (n.view !== 'contracts' || dept !== 'operations' || leader || ['om', 'regional', 'ogm', 'ops_director'].includes(me.user.opsTier ?? '')) &&
      // Finance: the Finance Director, the CEO, the Chairman and Vice Chairman, and Finance team members only.
      (n.view !== 'finance' ||
        ['finance_director', 'chairman', 'vice_chairman'].includes(me.user.leadership ?? '') ||
        isActHead(me.user) ||
        me.user.opsTier === 'ceo' ||
        (dept === 'finance' && me.user.financeTeam != null)) &&
      // Hostel bills in operations: the Operations Director and OGM approve; other operations staff do not see them.
      // Vehicles: not for guards and officers (they do not request vehicles here).
      (n.view !== 'fleet' || me.user.opsTier !== 'patrol') &&
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
      (n.view !== 'clock' || hasOwnStaffRecord(me.user)) &&
      // Arms detail: CMS, Arms Control, COO or higher, the company manager and the supervisor for their own people (Fauzan, 26 Oct 2026).
      (n.view !== 'arms' || !isGroup || seesArmsDetail(me.user)) &&
      // Operations sees foreign workers only as OM or Regional OM; the FWM despatch sees tasks.
      (n.view !== 'fwm' || dept !== 'operations' || leader || ['om', 'regional'].includes(me.user.opsTier ?? '')) &&
      (dept !== 'fwm' || me.user.fwmRole !== 'despatch' || n.view === 'fwm' || n.view === 'clock' || n.view === 'hr-it-intake') &&
      // The JA Group app owns foreign worker management (rule SYS-JA-OWNS); Prima's own screen is switched off, not deleted.
      (n.view !== 'fwm' || !jaOwns('fwm')) &&
      (n.view !== 'hostels' || !jaOwns('hostels')) &&
      // JA data: operations sees it as OM or above; the FWM despatch does not.
      (n.view !== 'ja' || dept !== 'operations' || leader || ['om', 'regional', 'ogm', 'ops_director'].includes(me.user.opsTier ?? '')) &&
      (n.view !== 'ja' || dept !== 'fwm' || me.user.fwmRole !== 'despatch') &&
      (n.view !== 'ja' || role !== 'supervisor' || !!me.user.opsTier),
  )
    // Pilot phase: the pilot users run the whole system with their own menus, so every module keeps running (Fauzan, 28 Oct 2026).
    .map((n) => (n.view === 'mine' && role !== 'guard' && role !== 'supervisor' ? { ...n, label: 'My details' } : n))
    .map((n) => (n.view === 'people' && (dept === 'hr' || leader) ? { ...n, label: 'People' } : n))
    .sort((a, b) => rank(a.view) - rank(b.view));
  const initialView = (): ViewName => {
    const h = location.hash.slice(1) as ViewName;
    return VIEW_TOKENS.includes(h) && nav.some((x) => x.view === h) ? h : nav[0].view;
  };
  const [route, setRoute] = useState<Route>({ view: initialView() });
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

  const ctx = useMemo<AppCtx>(() => ({ me, companyId, company, setCompanyId, go, isGroup }), [me, companyId, company, go, isGroup]);

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
      case 'requests':
        return <RequestsView />;
      case 'ja':
        return <JaView />;
      case 'assets':
        return <AssetsView />;
      case 'staffpay':
        return <StaffPayView />;
      case 'finance':
        return <FinanceView />;
      case 'contracts':
        return <ContractsView />;
      case 'branches':
        return <BranchesView />;
      case 'it-metrics':
        return <ItMetrics />;
      case 'it-procurement':
        return <ItProcurement />;
      case 'hr-it-intake':
        return <HrItIntake />;
      case 'it':
        return <ItView />;
      case 'websites':
        return <WebsitesView />;
      case 'corporate':
        return <CorporateView />;
      case 'credit':
        return <CreditView />;
      case 'purchasing':
        return <PurchasingView />;
      case 'governance':
        return <GovernanceView />;
      case 'grc':
        return <GrcView />;
      case 'act':
        return <ActView />;
      case 'continuity':
        return <ContinuityView />;
      case 'it-extraction':
        return <ItExtractionWorkspace key={me.user.id} actor={me.user} />;
      case 'connections':
        return <ConnectionsView key={me.user.id} userId={me.user.id} />;
      case 'fwm':
        return <FwmView />;
      case 'doa':
        return <DirectorOfficeView />;
      case 'reports':
        return <ReportsView />;
      case 'meetings':
        return <MeetingsView />;
    }
  })();

  const companyScoped = ![
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
    'assets',
    'staffpay',
    'finance',
    'contracts',
    'branches',
    'it',
    'websites',
    'corporate',
    'credit',
    'purchasing',
    'governance',
    'grc',
    'act',
    'continuity',
    'connections',
  'it-extraction',
  ].includes(route.view);

  return (
    <Ctx.Provider value={ctx}>
      {nav.some((n) => n.view === 'clock') && <StaffTracker />}
      {/* Each person accepts the confidentiality rule before using Prima (Fauzan, 28 Oct 2026). */}
      <ConfidentialityGate userId={me.user.id} />
      {/* Arisha, the AI assistant: teaches and guides, never decides (Fauzan, 28 Oct 2026). */}
      {((me.user.id === 'u-fauzan' && me.user.opsTier === 'ceo') ||
        (me.user.id === 'u-fd' && me.user.leadership === 'finance_director') ||
        (me.user.id === 'u-coo' && me.user.opsTier === 'coo') ||
        (me.user.id === 'u-audit' && me.user.actRole === 'lead')) && !me.user.integration && (
        <Arisha key={me.user.id} user={me.user} view={route.view} viewLabel={nav.find((n) => n.view === route.view)?.label ?? route.view} menu={nav.map((n) => n.label)} />
      )}
      <div className="shell">
        <aside className="rail">
          <div className="brand">
            <div className="brand-mark">P</div>
            <div>
              <div className="brand-name">Prima Secure</div>
              <div className="brand-sub">PWVSB Security Group</div>
            </div>
          </div>
          <nav className="nav" aria-label="Main">
            {navSections(nav).map((sec) => (
              <div className="nav-section" key={sec.title ?? 'all'}>
                {sec.title && <div className="nav-heading">{sec.title}</div>}
                {sec.items.map((n) => (
                  <button key={n.view} aria-current={route.view === n.view ? 'page' : undefined} onClick={() => go({ view: n.view })}>
                    <Icon name={n.icon} />
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
          {!me.user.integration && <ArishaReviewQueue key={me.user.id} user={me.user} companies={me.companies} />}
          {api.mode === 'demo' && (
            <div className="demo-band">
              <strong>Test version.</strong>
              <span>All people, sites and clients are made up. Changes stay in this browser only.</span>
            </div>
          )}
          <header className="topbar">
            {companyScoped && isGroup ? (
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
              <strong>{companyScoped || route.view === 'device' ? company?.name : 'PWVSB Security Group'}</strong>
            )}
            <span className="grow" />
            <span className="muted small hide-sm">{dept === 'it' ? 'Merdeka Network' : ROLE_LABEL[role]}</span>
            <span className="mono num muted small" title="Malaysia time">
              {hhmm(clock)} MYT
            </span>
            <button className="btn btn-sm hide-sm" onClick={onSignOut}>
              {api.mode === 'demo' ? 'Switch person' : 'Sign out'}
            </button>
          </header>
          {view}
        </div>
        <nav className="tabs" aria-label="Main">
          {tabNav.map((n) => (
            <button key={n.view} aria-current={route.view === n.view ? 'page' : undefined} onClick={() => go({ view: n.view })}>
              <Icon name={n.icon} />
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
                      <Icon name={n.icon} />
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

