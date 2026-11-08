// Rebuild the database with fresh mock data dated to today. Development only: refuses to
// run unless the target is a local database.
import { CENTRAL_EMPLOYER_IDS, generateDataset, dateOf, type Dataset, type DataWall, type TableName } from '@prima/core';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nowMyt } from './db';
import { guardPayModuleSql, migrationSql, payFormulasModuleSql, companyOfficeModuleSql, companyRunLinksModuleSql } from './schema';

const COMPANY_TABLES: TableName[] = [
  'branches',
  'sites',
  'posts',
  'people',
  'credentials',
  'licences',
  'shifts',
  'attendance',
  'cases',
  'checkpoints',
  'scans',
  'tenders',
  'quotations',
  'vaults',
  'firearms',
  'armsMovements',
  'armedJobs',
  'dealerLicences',
  'vaultWatches',
  'vaultEvents',
  'ammoStocks',
  'armsAgreements',
  'armsRequests',
  'insurancePolicies',
  'insuranceClaims',
  'insuranceGuarantees',
  'phoneExtensions',
  'phoneCalls',
  'siteSystems',
  'siteAlarms',
  'siteDispatches',
  'postLogs',
  'siteVehicles',
  'gateEntries',
  'siteNeedsReviews',
  'siteTasks',
  'siteTaskLogs',
  'evidenceVideos',
  'attendanceFollowUps',
  'evidencePhotos',
  'evidenceDocs',
  'leaveRequests',
  'socsoClaims',
  'fwRenewals',
  'fwmTasks',
  'fwWelfareChecks',
  'fwRecruitFiles',
  'hostels',
  'hostelStays',
  'hostelBills',
  'utilityCharges',
  'staffClaims',
  'tripApprovals',
  'staffPayRuns',
  'finStatus',
  'contracts',
  'branchSettlements',
  'branchActions',
  'corpProfiles',
  'creditLoans',
  'creditDefaults',
  'purSuppliers',
  'purRequests',
  'stockItems',
  'stockIssues',
  'govMandates',
  'grcObligations',
  'oshAssessments',
  'corpAudits',
  'salesLeads',
  'legalMatters',
  'corpFilings',
  'corpChanges',
  'siteVisits',
  'companyDesks',
  'grants',
  'fwPlacements',
  'fwPlacementHosts',
  'fwCostRates',
  'fwCostCharges',
  'fwStatCharges',
];
const TABLE_NAME: Partial<Record<TableName, string>> = {
armsMovements: 'arms_movements',
armedJobs: 'armed_jobs',
dealerLicences: 'dealer_licences',
vaultWatches: 'vault_watches',
vaultEvents: 'vault_events',
ammoStocks: 'ammo_stocks',
armsAgreements: 'arms_agreements',
armsRequests: 'arms_requests',
insurancePolicies: 'insurance_policies',
insuranceClaims: 'insurance_claims',
insuranceGuarantees: 'insurance_guarantees',
phoneExtensions: 'phone_extensions',
phoneCalls: 'phone_calls',
siteSystems: 'site_systems',
siteAlarms: 'site_alarms',
siteDispatches: 'site_dispatches',
postLogs: 'post_logs',
siteVehicles: 'site_vehicles',
gateEntries: 'gate_entries',
siteNeedsReviews: 'site_needs_reviews',
siteTasks: 'site_tasks',
siteTaskLogs: 'site_task_logs',
evidenceVideos: 'evidence_videos',
attendanceFollowUps: 'attendance_followups',
evidencePhotos: 'evidence_photos',
evidenceDocs: 'evidence_docs',
leaveRequests: 'leave_requests',
payChanges: 'pay_changes',
socsoClaims: 'socso_claims',
fwRenewals: 'fw_renewals',
fwmTasks: 'fwm_tasks',
hostelStays: 'hostel_stays',
hostelBills: 'hostel_bills',
utilityCharges: 'utility_charges',
staffClaims: 'staff_claims',
tripApprovals: 'trip_approvals',
staffPayRuns: 'staff_pay_runs',
finStatus: 'fin_status',
arishaDrafts: 'arisha_drafts',
contracts: 'contracts',
branchSettlements: 'branch_settlements',
branchActions: 'branch_actions',
corpProfiles: 'corp_profiles',
creditLoans: 'credit_loans',
creditDefaults: 'credit_defaults',
purSuppliers: 'pur_suppliers',
purRequests: 'pur_requests',
stockItems: 'stock_items',
stockIssues: 'stock_issues',
govMandates: 'gov_mandates',
grcObligations: 'grc_obligations',
oshAssessments: 'osh_assessments',
corpAudits: 'corp_audits',
salesLeads: 'sales_leads',
legalMatters: 'legal_matters',
corpFilings: 'corp_filings',
corpChanges: 'corp_changes',
siteVisits: 'site_visits',
jaRecords: 'ja_records',
companyDesks: 'company_desks',
fwWelfareChecks: 'fw_welfare_checks',
fwPlacements: 'fw_placements',
fwPlacementHosts: 'fw_placement_hosts',
fwCostRates: 'fw_cost_rates',
fwCostCharges: 'fw_cost_charges',
fwStatCharges: 'fw_stat_charges',
fwRecruitFiles: 'fw_recruit_files'
};

export async function resetDb(url: string, now = nowMyt()): Promise<Dataset> {
  // Never on Azure: the container image runs with NODE_ENV=production, and no setting there can unlock a reset.
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a database from a production build.');
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && process.env.ALLOW_REMOTE_RESET !== 'true') {
    throw new Error('Refusing to reset a non-local database.');
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS prima CASCADE');
    await client.query(migrationSql());
    // Development and tests only: the optional pay formulas module, so local databases match the code under review.
    await client.query(payFormulasModuleSql());
    await client.query(guardPayModuleSql());
    await client.query(companyOfficeModuleSql());
    await client.query(companyRunLinksModuleSql());
    const ds = generateDataset({ today: dateOf(now), now });
    await insertDataset(client, ds);
    return ds;
  } finally {
    await client.end();
  }
}

export { migrationSha, migrationSql } from './schema';

/** Every department wall, opened only inside the load transaction below. */
const LOAD_WALLS: DataWall[] = ['asset_read', 'asset_write', 'act', 'pdpa', 'bcm', 'arms', 'cms'];

/** Writes a whole dataset into an empty schema in one transaction. */
export async function insertDataset(client: Pick<Client, 'query'>, ds: Dataset): Promise<void> {
  await client.query('BEGIN');
  try {
    await fill(client, ds);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function fill(client: Pick<Client, 'query'>, ds: Dataset): Promise<void> {
  // The tables keep their company wall even for their owner (FORCE ROW LEVEL SECURITY). A superuser passes anyway;
  // an Azure administrator is not one, so the load opens the wall to the companies it writes, for this transaction only.
  // The department walls (access.ts DataWall) are opened the same way, so the CMS roster and arms rows can be loaded.
  await client.query(
    `SELECT set_config('app.company_ids', $1, true), set_config('app.group_user', 'on', true), set_config('app.walls', $2, true)`,
    // P81: and the central employers, which have no company record but do employ staff (a real-data load writes them).
    [[...ds.companies.map((c) => c.id), ...CENTRAL_EMPLOYER_IDS].join(','), LOAD_WALLS.join(',')],
  );
  const bulk = async (table: string, rows: unknown[], cols: (r: any) => unknown[], colNames: string) => {
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      const params: unknown[] = [];
      const width = colNames.split(',').length;
      const values = chunk.map((r, j) => {
        params.push(...cols(r));
        return `(${Array.from({ length: width }, (_, k) => `$${j * width + k + 1}`).join(',')})`;
      });
      await client.query(`INSERT INTO prima.${table} (${colNames}) VALUES ${values.join(',')}`, params);
    }
  };
  await bulk('arisha_drafts', ds.arishaDrafts, (r) => [r.id, r], 'id,data');
  await bulk('companies', ds.companies, (r) => [r.id, r], 'id,data');
  await bulk('company_run_links', ds.companyRunLinks ?? [], (r) => [r.id, r], 'id,data');
  await bulk('users', ds.users, (r) => [r.id, r], 'id,data');
  await bulk('cms_shifts', ds.cmsShifts, (r) => [r.id, r], 'id,data');
  await bulk('cms_staff', ds.cmsStaff, (r) => [r.id, r], 'id,data');
  await bulk('cms_settings', ds.cmsSettings, (r) => [r.id, r], 'id,data');
  await bulk('tender_protocols', ds.tenderProtocols, (r) => [r.id, r], 'id,data');
  await bulk('report_defs', ds.reportDefs, (r) => [r.id, r], 'id,data');
  await bulk('report_submissions', ds.reportSubmissions, (r) => [r.id, r], 'id,data');
  await bulk('tender_groups', ds.tenderGroups, (r) => [r.id, r], 'id,data');
  await bulk('claim_rates', ds.claimRates, (r) => [r.id, r], 'id,data');
  await bulk('memos', ds.memos, (r) => [r.id, r], 'id,data');
  await bulk('pdpa_cases', ds.pdpaCases, (r) => [r.id, r], 'id,data');
  await bulk('pdpa_dpos', ds.pdpaDpos, (r) => [r.id, r], 'id,data');
  await bulk('pdpa_requests', ds.pdpaRequests, (r) => [r.id, r], 'id,data');
  // Proposed module (db/modules/pdpa-register-v1.sql): only filled when a development database has it installed.
  if ((await client.query("SELECT to_regclass('prima.pdpa_register') IS NOT NULL AS ok")).rows[0]?.ok) {
    await bulk('pdpa_register', ds.pdpaRegister, (r) => [r.id, r], 'id,data');
    await bulk('pdpa_consents', ds.pdpaConsents, (r) => [r.id, r], 'id,data');
    await bulk('pdpa_settings', ds.pdpaSettings, (r) => [r.id, r], 'id,data');
  }
  await bulk('bcm_systems', ds.bcmSystems, (r) => [r.id, r], 'id,data');
  await bulk('bcm_drills', ds.bcmDrills, (r) => [r.id, r], 'id,data');
  await bulk('am_depn_postings', ds.amDepnPostings, (r) => [r.id, r], 'id,data');
  await bulk('staff_ids', ds.staffIds, (r) => [r.id, r], 'id,data');
  await bulk('staff_accounts', ds.staffAccounts, (r) => [r.id, r], 'id,data');
  await bulk('staff_faces', ds.staffFaces, (r) => [r.id, r], 'id,data');
  await bulk('public_holidays', ds.publicHolidays, (r) => [r.id, r], 'id,data');
  await bulk('allowance_types', ds.allowanceTypes, (r) => [r.id, r], 'id,data');
  await bulk('flex_requests', ds.flexRequests, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('vacancies', ds.vacancies, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('staff_movements', ds.staffMovements, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  // P81: check-in places and rules are set in the app; the seed carries none, but a dataset that has them keeps them.
  await bulk('checkin_places', ds.checkinPlaces ?? [], (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('checkin_rules', ds.checkinRules ?? [], (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('checkin_settings', ds.checkinSettings ?? [], (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('checkin_events', ds.checkinEvents ?? [], (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('login_handovers', ds.loginHandovers, (r) => [r.id, r], 'id,data');
  await bulk('person_links', ds.personLinks, (r) => [r.id, r], 'id,data');
  await bulk('group_people', ds.groupPeople, (r) => [r.id, r], 'id,data');
  await bulk('group_person_notes', ds.groupPersonNotes, (r) => [r.id, r], 'id,data');
  await bulk('hire_checks', ds.hireChecks, (r) => [r.id, r], 'id,data');
  await bulk('hr_filings', ds.hrFilings, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('hr_cases', ds.hrCases, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('hr_screenings', ds.hrScreenings, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('applicants', ds.applicants, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('office_osh', ds.officeOsh, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('staff_training', ds.staffTraining, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('staff_appraisals', ds.staffAppraisals, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('hr_policies', ds.hrPolicies, (r) => [r.id, r], 'id,data');
  await bulk('staff_overtime', ds.staffOvertime, (r) => [r.id, r], 'id,data');
  await bulk('hr_legal_checks', ds.hrLegalChecks, (r) => [r.id, r], 'id,data');
  await bulk('policy_acks', ds.policyAcks, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('door_events', ds.doorEvents, (r) => [r.id, r], 'id,data');
  await bulk('act_findings', ds.actFindings, (r) => [r.id, r], 'id,data');
  await bulk('act_audits', ds.actAudits, (r) => [r.id, r], 'id,data');
  await bulk('act_improvements', ds.actImprovements, (r) => [r.id, r], 'id,data');
  await bulk('vehicles', ds.vehicles, (r) => [r.id, r], 'id,data');
  await bulk('products', ds.products, (r) => [r.id, r], 'id,data');
  await bulk('client_accounts', ds.clientAccounts, (r) => [r.id, r], 'id,data');
  await bulk('expense_requests', ds.expenseRequests, (r) => [r.id, r], 'id,data');
  await bulk('vehicle_requests', ds.vehicleRequests, (r) => [r.id, r], 'id,data');
  await bulk('ja_syncs', ds.jaSyncs, (r) => [r.id, r], 'id,data');
  await bulk('am_units', ds.amUnits, (r) => [r.id, r], 'id,data');
  await bulk('am_work_orders', ds.amWorkOrders, (r) => [r.id, r], 'id,data');
  await bulk('am_assets', ds.amAssets, (r) => [r.id, r], 'id,data');
  await bulk('am_properties', ds.amProperties, (r) => [r.id, r], 'id,data');
  await bulk('it_assets', ds.itAssets, (r) => [r.id, r], 'id,data');
  await bulk('it_domains', ds.itDomains, (r) => [r.id, r], 'id,data');
  await bulk('it_tickets', ds.itTickets, (r) => [r.id, r], 'id,data');
  await bulk('it_onboarding', ds.itOnboarding, (r) => [r.id, r], 'id,data');
  await bulk('it_tender_tasks', ds.itTenderTasks, (r) => [r.id, r], 'id,data');
  await bulk('it_purchases', ds.itPurchases, (r) => [r.id, r], 'id,data');
  await bulk('it_jobs', ds.itJobs, (r) => [r.id, r], 'id,data');
  await bulk('it_rental_bills', ds.itRentalBills, (r) => [r.id, r], 'id,data');
  await bulk('confidentiality_acks', ds.confidentialityAcks, (r) => [r.id, r], 'id,data');
  await bulk('it_accounts', ds.itAccounts, (r) => [r.id, r], 'id,data');
  await bulk('it_access_requests', ds.itAccessRequests, (r) => [r.id, r], 'id,data');
  await bulk('it_code_holders', ds.itCodeHolders, (r) => [r.id, r], 'id,data');
  await bulk('it_settings', ds.itSettings, (r) => [r.id, r], 'id,data');
  await bulk('pay_formulas', ds.payFormulas, (r) => [r.id, r], 'id,data');
  await bulk('pay_formula_uses', ds.payFormulaUses, (r) => [r.id, r], 'id,data');
  await bulk('pay_law_versions', ds.payLawVersions, (r) => [r.id, r], 'id,data');
  await bulk('public_holiday_lists', ds.publicHolidayLists, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('site_hours_approvals', ds.siteHoursApprovals, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('guard_pay_runs', ds.guardPayRuns, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('guard_pay_advances', ds.guardPayAdvances, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('guard_loans', ds.guardLoans, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('statutory_versions', ds.statutoryVersions, (r) => [r.id, r], 'id,data');
  await bulk('web_companies', ds.webCompanies, (r) => [r.id, r], 'id,data');
  await bulk('web_domains', ds.webDomains, (r) => [r.id, r], 'id,data');
  await bulk('web_sites', ds.webSites, (r) => [r.id, r], 'id,data');
  await bulk('web_reviews', ds.webReviews, (r) => [r.id, r], 'id,data');
  await bulk('web_checks', ds.webChecks, (r) => [r.id, r], 'id,data');
  await bulk('web_issues', ds.webIssues, (r) => [r.id, r], 'id,data');
  await bulk('web_dns_changes', ds.webDnsChanges, (r) => [r.id, r], 'id,data');
  await bulk('web_notices', ds.webNotices, (r) => [r.id, r], 'id,data');
  await bulk('web_settings', ds.webSettings, (r) => [r.id, r], 'id,data');
  await bulk('whistle_reports', ds.whistleReports, (r) => [r.id, r], 'id,data');
  await bulk('gift_entries', ds.giftEntries, (r) => [r.id, r], 'id,data');
  await bulk('meetings', ds.meetings, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('staff_clocks', ds.staffClocks, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('location_pings', ds.locationPings, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('guard_phones', ds.guardPhones, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('guard_phone_sessions', ds.guardPhoneSessions, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('guard_pings', ds.guardPings, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('remote_arrangements', ds.remoteArrangements, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('remote_days', ds.remoteDays, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('time_slips', ds.timeSlips, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('time_slip_settings', ds.timeSlipSettings, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('work_tasks', ds.workTasks, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('work_check_ins', ds.workCheckIns, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('help_requests', ds.helpRequests, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('one_on_ones', ds.oneOnOnes, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('playbook_signoffs', ds.playbookSignoffs, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('branch_checks', ds.branchChecks, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('branch_visits', ds.branchVisits, (r) => [r.id, r.companyId, r], 'id,company_id,data');
  await bulk('arms_suppliers', ds.armsSuppliers, (r) => [r.id, r], 'id,data');
  await bulk('supplier_items', ds.supplierItems, (r) => [r.id, r], 'id,data');
  for (const t of COMPANY_TABLES) {
    await bulk(TABLE_NAME[t] ?? t, ds[t] as unknown[], (r) => [r.id, r.companyId, r], 'id,company_id,data');
  }
  await bulk('audit', ds.audit, (r) => [r.seq, r.companyId, r], 'seq,company_id,data');
}

if (require.main === module) {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/prima';
  resetDb(url)
    .then((ds) => console.log(`Database reset: ${ds.companies.length} companies, ${ds.people.length} people, ${ds.shifts.length} shifts.`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}

if (require.main === module) {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/prima';
  resetDb(url)
    .then((ds) => console.log(`Database reset: ${ds.companies.length} companies, ${ds.people.length} people, ${ds.shifts.length} shifts.`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}

