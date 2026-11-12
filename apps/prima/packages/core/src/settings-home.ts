// J7 (Fauzan, 11 Nov 2026, "Tell Fitri to build"): every setting staff need from 18 Nov exists and has no hard-coded
// rate, and the Settings area is easy to find. One Settings home lists each setting screen, who owns it, and whether it
// is set yet. Read-only: it counts what is already entered and never shows an amount. A person sees the state of the
// settings their role keeps or oversees; for the rest it names the owner only, because the database shows each table to
// its own readers (a count it cannot see would wrongly read "not set").
import { AccessDenied, actJobOf, isGroupLeader, isOwnerAdmin } from './access';
import type { Store } from './store';
import type { IsoDate, User } from './types';

export type SettingState =
  /** Entered in the app. */
  | 'set'
  /** The screen exists and nothing is entered yet. */
  | 'not_set'
  /** Its database part is not installed yet (A3). */
  | 'not_installed'
  /** Fauzan decided to set it later (for example approval limits, B4). */
  | 'later'
  /** A server setting kept by IT, switched off until Fauzan's go-ahead (connections stay off). */
  | 'server_off'
  /** No screen in the app yet. */
  | 'no_screen'
  /** Only its owner and group leadership see whether it is set. */
  | 'owner_only';

export type SettingGroup = 'rates' | 'pay' | 'holidays' | 'people' | 'limits' | 'connections';

export interface SettingRow {
  id: string;
  group: SettingGroup;
  title: string;
  what: string;
  owner: string;
  /** The screen to open (a menu view), or null when there is none yet. */
  view: string | null;
  /** Where on that screen. */
  where: string | null;
  state: SettingState;
  /** Plain words on the state: counts and dates, never amounts or names. */
  detail: string;
  /** A date the setting is due by, when the handover gives one. */
  dueOn: IsoDate | null;
}

export const SETTING_GROUP_LABEL: Record<SettingGroup, string> = {
  rates: 'Rates',
  pay: 'Pay rules',
  holidays: 'Public holidays 2027',
  people: 'Staff, desks and accounts',
  limits: 'Approval limits',
  connections: 'Email and reports',
};

/** Who may open the Settings home: office staff and leadership, never a guard, an officer's own sign-in, a site device or a system feed. */
export function seesSettingsHome(user: User): boolean {
  return !user.integration && (user.role === 'director' || user.role === 'pwvsb_officer' || user.role === 'company_manager' || user.role === 'admin_exec');
}

type Collection = Parameters<Store['list']>[0];

export async function settingsHome(store: Store, user: User, today: IsoDate) {
  if (!seesSettingsHome(user)) throw new AccessDenied('view', '(settings)');
  const ceo = user.opsTier === 'ceo' || isOwnerAdmin(user);
  const leader = ceo || isGroupLeader(user);
  const dept = user.role === 'pwvsb_officer' ? (user.department ?? null) : null;
  const fd = user.leadership === 'finance_director';
  const cos = user.leadership === 'cos' || user.leadership === 'deputy_cos';
  const act = actJobOf(user) !== null;
  const nextYear = Number(today.slice(0, 4)) + 1;

  // A read that fails (a table whose module is not installed) is rolled back on its own and reads as null.
  const safe = async <T>(fn: (tx: Store) => Promise<T>): Promise<T | null> => {
    try {
      return await store.transaction((tx) => fn(tx));
    } catch {
      return null;
    }
  };
  const rows = async (table: string): Promise<Record<string, unknown>[] | null> =>
    safe((tx) => tx.list(table as Collection, {}) as unknown as Promise<Record<string, unknown>[]>);
  const problems = async (fn: (() => Promise<string[]>) | undefined) => (fn ? (await fn().catch(() => ['unknown'])).length > 0 : false);
  const ready = async (fn: (() => Promise<boolean>) | undefined) => (fn ? await fn().catch(() => false) : true);

  const out: SettingRow[] = [];
  const add = (r: Omit<SettingRow, 'state' | 'detail'> & { sees: boolean }, state: () => Promise<[SettingState, string]>) =>
    (async () => {
      const { sees, ...rest } = r;
      const [s, d] = sees ? await state() : (['owner_only', `Only ${r.owner} and group leadership see whether it is set.`] as [SettingState, string]);
      out.push({ ...rest, state: s, detail: d });
    })();
  const counted = (n: number, one: string, many = `${one}s`): [SettingState, string] => (n ? ['set', `${n} ${n === 1 ? one : many} entered`] : ['not_set', 'Nothing entered yet.']);

  // ----- Rates (C5: rates are entered in the app with the date they start; the screens are owned by each rate keeper) -----
  await add(
    { id: 'rates.it', group: 'rates', title: 'IT device rental rates', what: 'Monthly rental per device type, from a date.', owner: 'the IT Manager', view: 'it', where: 'Rental', dueOn: null, sees: leader || dept === 'it' },
    async () => {
      if (await problems(store.itOperationsProblems?.bind(store))) return ['not_installed', 'The IT rental database part is not ready.'];
      const r = await rows('itRentalRates');
      if (r === null) return ['not_installed', 'The IT rental database part is not ready.'];
      const last = r.map((x) => String(x.effectiveOn ?? '')).sort().pop();
      return r.length ? ['set', `${r.length} rate version${r.length === 1 ? '' : 's'}, latest from ${last}`] : ['not_set', 'No rate entered: devices are not billed ("rate not set").'];
    },
  );
  await add(
    { id: 'rates.fwcost', group: 'rates', title: 'Foreign worker recruitment cost rates', what: 'Monthly charge and payback per worker, from a month.', owner: 'the Finance Director or the CEO', view: 'fwcost', where: null, dueOn: null, sees: ceo || fd },
    async () => {
      const r = await rows('fwCostRates');
      return r === null ? ['not_installed', 'The recruitment cost database part is not installed yet.'] : counted(r.length, 'rate');
    },
  );
  await add(
    { id: 'rates.fees', group: 'rates', title: 'Management fees', what: 'The fee each operations company bills, per company.', owner: 'the Finance Director or the CEO', view: 'finance', where: 'Management fees', dueOn: null, sees: ceo || fd || leader },
    async () => {
      const r = await rows('finStatus');
      if (r === null) return ['not_installed', 'Finance records are not readable here.'];
      const n = r.reduce((k, x) => k + Object.values((x.managementFees as Record<string, unknown> | undefined) ?? {}).filter((v) => v != null).length, 0);
      return counted(n, 'fee');
    },
  );
  await add(
    { id: 'rates.claims', group: 'rates', title: 'Mileage rate per km', what: 'The rate per km for each vehicle, published every month.', owner: 'the Chief of Staff', view: 'claims', where: 'Rates', dueOn: null, sees: leader || cos || dept === 'chief_of_staff' || dept === 'hr' },
    async () => {
      const r = await rows('claimRates');
      if (r === null) return ['not_installed', 'Claim rates are not readable here.'];
      const month = today.slice(0, 7);
      const now = r.filter((x) => x.month === month).length;
      return now ? ['set', `${now} vehicle rate${now === 1 ? '' : 's'} published for ${month}`] : ['not_set', `No rate published for ${month} yet.`];
    },
  );
  await add(
    { id: 'rates.vehicles', group: 'rates', title: 'Vehicle rent', what: 'Monthly rent of each vehicle rented from a group company, from a date.', owner: 'the Finance Director or the CEO', view: 'fleet', where: 'Rented vehicles', dueOn: null, sees: ceo || fd },
    async () => {
      const v = await rows('vehicles');
      if (v === null) return ['not_installed', 'Vehicles are not readable here.'];
      const rented = v.filter((x) => x.rental);
      const priced = rented.filter((x) => ((x.rental as { rates?: unknown[] }).rates ?? []).length > 0).length;
      if (!rented.length) return ['not_set', 'No rented vehicle recorded yet.'];
      return priced === rented.length ? ['set', `Rent set for all ${rented.length} rented vehicle${rented.length === 1 ? '' : 's'}`] : ['not_set', `${rented.length - priced} of ${rented.length} rented vehicles show "rate not set"`];
    },
  );
  out.push({
    id: 'rates.quotation',
    group: 'rates',
    title: 'Quotation cost lines',
    what: 'Hostel and transport (foreign guards), uniform and equipment costs used by the quotation cost check.',
    owner: 'the Finance Director or the CEO',
    view: null,
    where: null,
    state: 'no_screen',
    detail: 'Being built with the quotation cost checks (C10); never a preset number.',
    dueOn: null,
  });

  // ----- Pay rules -----
  const formulasOn = await ready(store.payFormulasReady?.bind(store));
  const paySees = ceo || leader || act;
  await add(
    { id: 'pay.formulas', group: 'pay', title: 'Guard pay formulas', what: 'Basic, hours, overtime and allowances for each formula, and where each is used.', owner: 'the ACT Director', view: 'payformulas', where: null, dueOn: null, sees: paySees },
    async () => {
      if (!formulasOn) return ['not_installed', 'The pay formulas database part is not installed yet.'];
      const r = await rows('payFormulas');
      if (r === null) return ['not_installed', 'The pay formulas database part is not installed yet.'];
      const live = r.filter((x) => x.status === 'live').length;
      return live ? ['set', `${live} formula version${live === 1 ? '' : 's'} live`] : ['not_set', r.length ? `${r.length} draft${r.length === 1 ? '' : 's'}, none live yet` : 'No formula entered yet.'];
    },
  );
  await add(
    { id: 'pay.law', group: 'pay', title: 'Pay law settings', what: 'Minimum wage, the day divisor and overtime rates, from a month.', owner: 'the CEO', view: 'payformulas', where: 'Pay law settings', dueOn: null, sees: paySees },
    async () => {
      if (!formulasOn) return ['not_installed', 'The pay formulas database part is not installed yet.'];
      const r = await rows('payLawVersions');
      return r === null ? ['not_installed', 'The pay formulas database part is not installed yet.'] : counted(r.length, 'version');
    },
  );
  await add(
    { id: 'pay.statutory', group: 'pay', title: 'EPF, SOCSO, EIS and HRD rates', what: 'Statutory rates from a month.', owner: 'the CEO', view: 'statutory', where: null, dueOn: null, sees: paySees || dept === 'hr' || dept === 'finance' },
    async () => {
      const on = await ready(store.guardPayReady?.bind(store));
      const r = on ? await rows('statutoryVersions') : null;
      return r === null ? ['not_installed', 'The guard pay database part is not installed yet.'] : counted(r.length, 'version');
    },
  );
  await add(
    { id: 'pay.allowances', group: 'pay', title: 'Allowance list', what: 'Each allowance with its EPF, SOCSO, PCB and HRD ticks.', owner: 'HR', view: 'hr', where: 'Allowances', dueOn: null, sees: leader || dept === 'hr' || cos },
    async () => {
      const r = await rows('allowanceTypes');
      return r === null ? ['not_installed', 'The allowance list is not readable here.'] : counted(r.length, 'allowance');
    },
  );

  // ----- Public holidays 2027 (B3: HR for staff; the Operations Director or OGM for guards, due 10 Dec) -----
  await add(
    { id: 'holidays.staff', group: 'holidays', title: `Staff public holidays ${nextYear}`, what: 'The national and state holidays for office staff.', owner: 'HR', view: 'hr', where: 'Holidays', dueOn: null, sees: leader || dept === 'hr' || cos },
    async () => {
      const r = await rows('publicHolidays');
      if (r === null) return ['not_installed', 'Holidays are not readable here.'];
      const n = r.filter((x) => String(x.date ?? '').startsWith(`${nextYear}-`)).length;
      return n ? ['set', `${n} holiday${n === 1 ? '' : 's'} entered for ${nextYear}`] : ['not_set', `No ${nextYear} holiday entered yet.`];
    },
  );
  await add(
    {
      id: 'holidays.guards',
      group: 'holidays',
      title: `Guard public holiday lists ${nextYear}`,
      what: 'Each company’s holiday list for guard pay, per state.',
      owner: 'the Operations Director or the OGM',
      view: 'sitehours',
      where: 'Public holidays',
      dueOn: `${nextYear - 1}-12-10`,
      sees: leader || dept === 'hr' || act || ['ops_director', 'ogm', 'coo'].includes(user.opsTier ?? ''),
    },
    async () => {
      if (!formulasOn) return ['not_installed', 'The pay formulas database part (holiday lists) is not installed yet.'];
      const [r, companies] = [await rows('publicHolidayLists'), await rows('companies')];
      if (r === null) return ['not_installed', 'The holiday lists are not readable here.'];
      const done = new Set(r.filter((x) => Number(x.year) === nextYear).map((x) => String(x.companyId)));
      const total = companies?.length ?? 0;
      return done.size ? ['set', `${done.size} of ${total} compan${total === 1 ? 'y' : 'ies'} have a ${nextYear} list`] : ['not_set', `No ${nextYear} list yet (${total} compan${total === 1 ? 'y' : 'ies'}).`];
    },
  );

  // ----- Staff, desks and accounts -----
  await add(
    { id: 'people.directory', group: 'people', title: 'Staff directory', what: 'Office staff, their posts and Microsoft 365 mailboxes, loaded in bulk with HR’s approval.', owner: 'HR (approved by the HR Director or the CEO)', view: 'staff-directory', where: null, dueOn: '2026-11-18', sees: ceo || dept === 'hr' || dept === 'it' || cos },
    async () => {
      if (await problems(store.staffDirectoryProblems?.bind(store))) return ['not_installed', 'The staff directory database part is not installed yet.'];
      const r = await rows('staffDirectory');
      return r === null ? ['not_installed', 'The staff directory database part is not installed yet.'] : counted(r.length, 'person', 'people');
    },
  );
  await add(
    { id: 'people.desks', group: 'people', title: 'Company office desks', what: 'Who holds each desk in a company office, and the backup.', owner: 'each company head', view: 'office', where: 'Desks', dueOn: null, sees: leader || user.role === 'company_manager' },
    async () => {
      if (!(await ready(store.companyOfficeReady?.bind(store)))) return ['not_installed', 'The company office database part is not installed yet.'];
      const r = await rows('companyDesks');
      if (r === null) return ['not_installed', 'The company office database part is not installed yet.'];
      const companies = new Set(r.map((x) => String(x.companyId ?? '')).filter(Boolean));
      return companies.size ? ['set', `Desks set for ${companies.size} compan${companies.size === 1 ? 'y' : 'ies'}`] : ['not_set', 'No company has set its desks yet.'];
    },
  );
  out.push({
    id: 'people.cms',
    group: 'people',
    title: 'CMS control room accounts',
    what: 'Who works the CMS seats and rosters.',
    owner: 'IT with the CMS head',
    view: 'cms',
    where: null,
    state: 'no_screen',
    detail: 'No add or change screen: CMS staff records are added by IT on the server today, and CMS operators move to Microsoft sign-in (E7).',
    dueOn: null,
  });
  await add(
    { id: 'people.timeslip', group: 'people', title: 'Time slip approvers', what: 'Who approves staff time slips.', owner: 'HR', view: 'staffclock', where: 'Time slips', dueOn: null, sees: leader || dept === 'hr' },
    async () => {
      const r = await rows('timeSlipSettings');
      return r === null ? ['not_installed', 'The time slip database part is not installed yet.'] : r.length ? ['set', 'Approver set'] : ['not_set', 'The default approver is used (the person’s manager).'];
    },
  );

  // ----- Approval limits (B4: no limits now; the CEO sets them later, once there is real data) -----
  await add(
    { id: 'limits.approval', group: 'limits', title: 'Approval value limits', what: 'Claims and purchases a single approver may approve up to.', owner: 'the CEO', view: 'home', where: 'Approval limits', dueOn: null, sees: leader || dept === 'hr' || dept === 'procurement' },
    async () => {
      const r = await rows('finStatus');
      const lim = (r ?? []).map((x) => x.approvalLimits as { claimsMax?: number | null; purchasesMax?: number | null } | undefined).find((x) => x && (x.claimsMax != null || x.purchasesMax != null));
      return lim ? ['set', 'Limits set by the CEO'] : ['later', 'No limits: the COO approves every claim, the COO and CEO every purchase (Fauzan, 11 Nov 2026: set later, with real data).'];
    },
  );

  // ----- Email and reports: server settings, switched off until Fauzan's go-ahead -----
  out.push(
    {
      id: 'connections.mail',
      group: 'connections',
      title: 'Staff email Send rules',
      what: 'Who may send from Prima and which outside domains they may write to.',
      owner: 'IT, with Fauzan’s go-ahead',
      view: 'connections',
      where: null,
      state: 'server_off',
      detail: 'A server setting (staff list and approved domains), never "everyone". Staff email stays switched off until Fauzan says.',
      dueOn: null,
    },
    {
      id: 'connections.powerbi',
      group: 'connections',
      title: 'Power BI report list',
      what: 'Which Power BI reports go to which heads.',
      owner: 'IT, with Fauzan’s go-ahead',
      view: 'connections',
      where: null,
      state: 'server_off',
      detail: 'A server setting (each report with the people allowed to open it). Power BI stays switched off until Fauzan says.',
      dueOn: null,
    },
  );

  const order: SettingGroup[] = ['rates', 'pay', 'holidays', 'people', 'limits', 'connections'];
  const sorted = order.flatMap((g) => out.filter((r) => r.group === g));
  const count = (s: SettingState) => sorted.filter((r) => r.state === s).length;
  return {
    rows: sorted,
    groups: order.map((id) => ({ id, label: SETTING_GROUP_LABEL[id] })),
    counts: { set: count('set'), notSet: count('not_set'), notInstalled: count('not_installed'), later: count('later'), serverOff: count('server_off'), noScreen: count('no_screen'), ownerOnly: count('owner_only') },
    today,
  };
}
