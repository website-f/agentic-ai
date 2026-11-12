import {workflowMetricProblems} from './it-workflow-metrics-readiness';
import {cleanupSchemaProblems} from './it-cleanup-readiness';
import type {CleanupKind} from '@prima/core';
import {procurementProblems} from './procurement-readiness';
import {rentalCorrectionProblems} from './rental-correction-readiness';
import { randomUUID } from 'node:crypto';
import { hrItProblems } from './hr-it-readiness';
import { itOperationsProblems } from './it-operations-readiness';
import { itManualProblems } from './it-manual-readiness';
import { amExtrasInstalled } from './am-extras-readiness';
import { cleaningOpsInstalled } from './cleaning-ops-readiness';
import { ITEM_TABLE_NAMES, ITEM_V2_TABLE_NAMES, itemRegisterInstalled, itemRegisterProblems, itemRegisterV2Installed, itemRegisterV2Problems } from './item-register-readiness';
import { GENESIS_HASH, RefusedAfterSave, chainEntry, type AuditBody, type AuditEntry, type Filter, type Id, type Range, type Row, type Store, type TableName, type ItTicket, type GroupHistoryLookupRow, type GroupPersonNotes, type RehireStatus, BadRequest } from '@prima/core';
import type { PoolClient } from 'pg';

/**
 * Tables from a proposed module (db/modules) that a database may not have yet. Reading one that is missing says so in
 * words instead of failing as a server error, and never reads as an empty (all clear) register.
 */
const MODULE_TABLES: Partial<Record<TableName, string>> = {
  // P88 (office): every table of the new upstream modules says so in words until the CEO approves installing it.
  fwStatCharges: 'Foreign worker EPF and SOCSO recharges are not switched on in this database yet (module fw-epf-socso-recharge-v1).',
  fwCostCharges: 'Foreign worker recruitment costs are not switched on in this database yet (module fw-recruitment-cost-v1).',
  fwCostRates: 'Foreign worker recruitment costs are not switched on in this database yet (module fw-recruitment-cost-v1).',
  fwPlacementHosts: 'Foreign worker recruitment costs are not switched on in this database yet (module fw-recruitment-cost-v1).',
  fwPlacements: 'Foreign worker recruitment costs are not switched on in this database yet (module fw-recruitment-cost-v1).',
  siteSurveyPhotos: 'Site surveys are not switched on in this database yet (module site-surveys-v1).',
  siteSurveys: 'Site surveys are not switched on in this database yet (module site-surveys-v1).',
  staffDirectory: 'The staff directory is not switched on in this database yet (module staff-directory-v1).',
  staffDirectoryBatches: 'The staff directory is not switched on in this database yet (module staff-directory-v1).',
  tenderOpportunities: 'Tender opportunities are not switched on in this database yet (module tender-opportunities-v1).',
  tenderSources: 'Tender opportunities are not switched on in this database yet (module tender-opportunities-v1).',
  clientCodes: 'Client requirements and the yearly self-audit are not installed in this database yet (module client-codes-v1).',
  clientCodeChecks: 'Client requirements and the yearly self-audit are not installed in this database yet (module client-codes-v1).',
  clientInspections: 'Client requirements and the yearly self-audit are not installed in this database yet (module client-codes-v1).',
  selfAudits: 'Client requirements and the yearly self-audit are not installed in this database yet (module client-codes-v1).',
  rbaTraceReviews: 'RBA readiness is not installed in this database yet (module rba-readiness-v1).',
  ethicsDeclarations: 'RBA readiness is not installed in this database yet (module rba-readiness-v1).',
  rbaCommittees: 'RBA readiness is not installed in this database yet (module rba-readiness-v1).',
  qmsRequirements: 'Quality and compliance is not installed in this database yet (module quality-compliance-v1).',
  qmsEntries: 'Quality and compliance is not installed in this database yet (module quality-compliance-v1).',
  qmsFoundation: 'Quality and compliance is not installed in this database yet (module quality-compliance-v1).',
  compProfiles: 'Quality and compliance is not installed in this database yet (module quality-compliance-v1).',
  compAssessments: 'Quality and compliance is not installed in this database yet (module quality-compliance-v1).',
  qmsItems: 'Quality and compliance is not installed in this database yet (module quality-compliance-v1).',
  qmsNonconformities: 'Quality and compliance is not installed in this database yet (module quality-compliance-v1).',
  regRelatedParties: 'Governance registers are not installed in this database yet (module governance-registers-v1).',
  regInterests: 'Governance registers are not installed in this database yet (module governance-registers-v1).',
  regCommittees: 'Governance registers are not installed in this database yet (module governance-registers-v1).',
  regRisks: 'Governance registers are not installed in this database yet (module governance-registers-v1).',
  regSettings: 'Governance registers are not installed in this database yet (module governance-registers-v1).',
  pdpaRegister: 'The personal data register is not installed in the database yet (module pdpa-register-v1, run by the CEO).',
  pdpaConsents: 'The consent register is not installed in the database yet (module pdpa-register-v1, run by the CEO).',
  pdpaSettings: 'The PDPA settings are not installed in the database yet (module pdpa-register-v1, run by the CEO).',
  // P90: the owner's test check-in (db/modules/owner-test-checkin-v1.sql, applied by the office prima-setup).
  ownerTestCheckins: 'The owner test check-in is not set up in this database yet (module owner-test-checkin-v1).',
  // P97: the staff check-in and check-out face photos (db/modules/clock-snaps-v1.sql, applied by the office prima-setup).
  clockSnaps: 'Check-in face photos are not set up in this database yet (module clock-snaps-v1).',
  // P100 pay (B1): who prepares each company's guard pay run (db/modules/guard-pay-preparers-v1.sql, office prima-setup).
  guardPayPreparers: 'The guard pay preparer list is not set up in this database yet (module guard-pay-preparers-v1).',
  // P100 pay (B2): the FD's cash stand-ins (db/modules/cash-stand-ins-v1.sql, office prima-setup).
  cashStandIns: 'The cash stand-in is not set up in this database yet (module cash-stand-ins-v1).',
};

// Exported for the per-request read snapshots (read-cache.ts, P83).
export const TABLE: Record<TableName, string> = {
itMetricStreams:'prima.it_metric_streams',
itMetricReceipts:'prima.it_metric_receipts',
itMetricTargets:'prima.it_metric_targets',
itMetricCalendars:'prima.it_metric_calendars',
arishaDrafts: 'prima.arisha_drafts',
itemSkus: 'prima.item_skus',
physicalItems: 'prima.item_units',
itemLots: 'prima.item_lots',
itemEvents: 'prima.item_events',
itemMovements: 'prima.item_movements',
itemCases: 'prima.item_cases',
itemCounts: 'prima.item_counts',
itemSyncJobs: 'prima.item_sync_jobs',
itemRequests: 'prima.item_requests',
itemSettings: 'prima.item_settings',
itemDocs: 'prima.item_docs',
uniformRecords: 'prima.item_uniform_records',
itemLabelPrints: 'prima.item_label_prints',
itemSqlBooks: 'prima.item_sql_books',
itemSyncBatches: 'prima.item_sync_batches',
itemSqlSnapshots: 'prima.item_sql_snapshots',
itemCounters: 'prima.item_counters',
itemScanDenials: 'prima.item_scan_denials',
itImportReviews: 'prima.it_import_reviews',
companies: 'prima.companies',
branches: 'prima.branches',
sites: 'prima.sites',
posts: 'prima.posts',
people: 'prima.people',
credentials: 'prima.credentials',
licences: 'prima.licences',
shifts: 'prima.shifts',
attendance: 'prima.attendance',
cases: 'prima.cases',
checkpoints: 'prima.checkpoints',
scans: 'prima.scans',
tenders: 'prima.tenders',
quotations: 'prima.quotations',
vaults: 'prima.vaults',
firearms: 'prima.firearms',
armsMovements: 'prima.arms_movements',
armedJobs: 'prima.armed_jobs',
cmsShifts: 'prima.cms_shifts',
cmsStaff: 'prima.cms_staff',
cmsSettings: 'prima.cms_settings',
tenderProtocols: 'prima.tender_protocols',
reportDefs: 'prima.report_defs',
reportSubmissions: 'prima.report_submissions',
tenderGroups: 'prima.tender_groups',
meetings: 'prima.meetings',
staffClocks: 'prima.staff_clocks',
locationPings: 'prima.location_pings',
remoteArrangements: 'prima.remote_arrangements',
remoteDays: 'prima.remote_days',
workTasks: 'prima.work_tasks',
workCheckIns: 'prima.work_check_ins',
helpRequests: 'prima.help_requests',
oneOnOnes: 'prima.one_on_ones',
playbookSignoffs: 'prima.playbook_signoffs',
branchChecks: 'prima.branch_checks',
branchVisits: 'prima.branch_visits',
phoneExtensions: 'prima.phone_extensions',
phoneCalls: 'prima.phone_calls',
siteSystems: 'prima.site_systems',
siteAlarms: 'prima.site_alarms',
siteDispatches: 'prima.site_dispatches',
postLogs: 'prima.post_logs',
siteVehicles: 'prima.site_vehicles',
gateEntries: 'prima.gate_entries',
siteNeedsReviews: 'prima.site_needs_reviews',
siteTasks: 'prima.site_tasks',
siteTaskLogs: 'prima.site_task_logs',
clientCodes: 'prima.client_codes',
clientCodeChecks: 'prima.client_code_checks',
clientInspections: 'prima.client_inspections',
selfAudits: 'prima.self_audits',
rbaTraceReviews: 'prima.rba_trace_reviews',
ethicsDeclarations: 'prima.ethics_declarations',
rbaCommittees: 'prima.rba_committees',
evidenceVideos: 'prima.evidence_videos',
attendanceFollowUps: 'prima.attendance_followups',
evidencePhotos: 'prima.evidence_photos',
evidenceDocs: 'prima.evidence_docs',
leaveRequests: 'prima.leave_requests',
socsoClaims: 'prima.socso_claims',
fwRenewals: 'prima.fw_renewals',
fwmTasks: 'prima.fwm_tasks',
hostels: 'prima.hostels',
hostelStays: 'prima.hostel_stays',
hostelBills: 'prima.hostel_bills',
utilityCharges: 'prima.utility_charges',
staffClaims: 'prima.staff_claims',
tripApprovals: 'prima.trip_approvals',
staffPayRuns: 'prima.staff_pay_runs',
finStatus: 'prima.fin_status',
contracts: 'prima.contracts',
branchSettlements: 'prima.branch_settlements',
branchActions: 'prima.branch_actions',
corpProfiles: 'prima.corp_profiles',
creditLoans: 'prima.credit_loans',
creditDefaults: 'prima.credit_defaults',
purSuppliers: 'prima.pur_suppliers',
purRequests: 'prima.pur_requests',
stockItems: 'prima.stock_items',
stockIssues: 'prima.stock_issues',
govMandates: 'prima.gov_mandates',
grcObligations: 'prima.grc_obligations',
whistleReports: 'prima.whistle_reports',
giftEntries: 'prima.gift_entries',
oshAssessments: 'prima.osh_assessments',
corpAudits: 'prima.corp_audits',
salesLeads: 'prima.sales_leads',
legalMatters: 'prima.legal_matters',
corpFilings: 'prima.corp_filings',
corpChanges: 'prima.corp_changes',
itPurchases: 'prima.it_purchases',
webCompanies: 'prima.web_companies',
webDomains: 'prima.web_domains',
webSites: 'prima.web_sites',
webReviews: 'prima.web_reviews',
webChecks: 'prima.web_checks',
webIssues: 'prima.web_issues',
webDnsChanges: 'prima.web_dns_changes',
webNotices: 'prima.web_notices',
webSettings: 'prima.web_settings',
itAssets: 'prima.it_assets',
itDomains: 'prima.it_domains',
payChanges: 'prima.pay_changes',
itTickets: 'prima.it_tickets',
itOnboarding: 'prima.it_onboarding',
itTenderTasks: 'prima.it_tender_tasks',
itJobs: 'prima.it_jobs',
itRentalBills: 'prima.it_rental_bills',
itRentalCorrectionRequests:'prima.it_rental_correction_requests',
itRentalCorrectionReviews:'prima.it_rental_correction_reviews',
itRentalReplacements:'prima.it_rental_replacements',
itRentalReplacementPayments:'prima.it_rental_replacement_payments',
itRentalCorrectionReceipts:'prima.it_rental_correction_receipts',
itRentalRates: 'prima.it_rental_rates',
itAssetInspections: 'prima.it_asset_inspections',
itOperationalReceipts: 'prima.it_operational_receipts',
itPurchaseFinanceAuthorities:'prima.it_purchase_finance_authorities',
itProcurementPackets:'prima.it_procurement_packets',
itProcurementReceipts:'prima.it_procurement_receipts',
itCleanupNominations:'prima.it_cleanup_nominations',
itCleanupArchives:'prima.it_cleanup_archives',
itCleanupReceipts:'prima.it_cleanup_receipts',
itCleanupPlanBindings:'prima.it_cleanup_plan_bindings',
hrItRequests:'prima.hr_it_requests',
hrItApprovals:'prima.hr_it_approvals',
hrItDelegations:'prima.hr_it_delegations',
hrItAuthorityMappings:'prima.hr_it_authority_mappings',
hrItReceipts:'prima.hr_it_receipts',
confidentialityAcks: 'prima.confidentiality_acks',
itAccounts: 'prima.it_accounts',
itAccessRequests: 'prima.it_access_requests',
itCodeHolders: 'prima.it_code_holders',
itSettings: 'prima.it_settings',
payFormulas: 'prima.pay_formulas',
payFormulaUses: 'prima.pay_formula_uses',
siteHoursApprovals: 'prima.site_hours_approvals',
publicHolidayLists: 'prima.public_holiday_lists',
guardPayRuns: 'prima.guard_pay_runs',
guardPayAdvances: 'prima.guard_pay_advances',
guardLoans: 'prima.guard_loans',
statutoryVersions: 'prima.statutory_versions',
payLawVersions: 'prima.pay_law_versions',
itManualReceipts: 'prima.it_manual_receipts',
claimRates: 'prima.claim_rates',
memos: 'prima.memos',
pdpaCases: 'prima.pdpa_cases',
pdpaDpos: 'prima.pdpa_dpos',
pdpaRequests: 'prima.pdpa_requests',
bcmSystems: 'prima.bcm_systems',
bcmDrills: 'prima.bcm_drills',
amDepnPostings: 'prima.am_depn_postings',
staffIds: 'prima.staff_ids',
staffAccounts: 'prima.staff_accounts',
staffFaces: 'prima.staff_faces',
publicHolidays: 'prima.public_holidays',
allowanceTypes: 'prima.allowance_types',
flexRequests: 'prima.flex_requests',
vacancies: 'prima.vacancies',
staffMovements: 'prima.staff_movements',
// P81: staff check-in by place (checkin.ts).
checkinPlaces: 'prima.checkin_places',
checkinRules: 'prima.checkin_rules',
checkinSettings: 'prima.checkin_settings',
checkinEvents: 'prima.checkin_events',
ownerTestCheckins: 'prima.owner_test_checkins',
clockSnaps: 'prima.clock_snaps',
guardPayPreparers: 'prima.guard_pay_preparers',
cashStandIns: 'prima.cash_stand_ins',
loginHandovers: 'prima.login_handovers',
hrFilings: 'prima.hr_filings',
hrCases: 'prima.hr_cases',
applicants: 'prima.applicants',
officeOsh: 'prima.office_osh',
staffTraining: 'prima.staff_training',
staffAppraisals: 'prima.staff_appraisals',
hrPolicies: 'prima.hr_policies',
staffOvertime: 'prima.staff_overtime',
hrLegalChecks: 'prima.hr_legal_checks',
policyAcks: 'prima.policy_acks',
doorEvents: 'prima.door_events',
actFindings: 'prima.act_findings',
actAudits: 'prima.act_audits',
actImprovements: 'prima.act_improvements',
vehicles: 'prima.vehicles',
products: 'prima.products',
clientAccounts: 'prima.client_accounts',
expenseRequests: 'prima.expense_requests',
jaRecords: 'prima.ja_records',
jaSyncs: 'prima.ja_syncs',
amUnits: 'prima.am_units',
amWorkOrders: 'prima.am_work_orders',
amAssets: 'prima.am_assets',
amProperties: 'prima.am_properties',
vehicleRequests: 'prima.vehicle_requests',
siteVisits: 'prima.site_visits',
armsSuppliers: 'prima.arms_suppliers',
supplierItems: 'prima.supplier_items',
dealerLicences: 'prima.dealer_licences',
vaultEvents: 'prima.vault_events',
ammoStocks: 'prima.ammo_stocks',
armsAgreements: 'prima.arms_agreements',
armsRequests: 'prima.arms_requests',
insurancePolicies: 'prima.insurance_policies',
insuranceClaims: 'prima.insurance_claims',
insuranceGuarantees: 'prima.insurance_guarantees',
vaultWatches: 'prima.vault_watches',
users: 'prima.users',
grants: 'prima.grants',
audit: 'prima.audit',
offlineLeases: 'prima.offline_leases',
offlineOps: 'prima.offline_ops',
panelFirms: 'prima.panel_firms',
delegations: 'prima.delegations',
criticalRoles: 'prima.critical_roles',
legalHolds: 'prima.legal_holds',
legalHoldVersions: 'prima.legal_hold_versions',
orgEvents:'prima.org_events',
// P81: past attendance from the InfoTech monthly PDF reports.
attendanceImports: 'prima.attendance_imports',
attendanceDays: 'prima.attendance_days',
attendanceMatches: 'prima.attendance_matches',
orgTasks:'prima.org_tasks',
orgNotices:'prima.org_notices',
orgImports:'prima.org_imports',
companyDesks: 'prima.company_desks',
companyRunLinks: 'prima.company_run_links',
fwWelfareChecks: 'prima.fw_welfare_checks',
fwPlacements: 'prima.fw_placements',
fwPlacementHosts: 'prima.fw_placement_hosts',
fwCostRates: 'prima.fw_cost_rates',
fwCostCharges: 'prima.fw_cost_charges',
timeSlips: 'prima.time_slips',
timeSlipSettings: 'prima.time_slip_settings',
staffDirectory: 'prima.staff_directory',
staffDirectoryBatches: 'prima.staff_directory_batches',
cleaningSites: 'prima.cleaning_sites',
cleaningDays: 'prima.cleaning_days',
cleaningStock: 'prima.cleaning_stock',
siteKits: 'prima.site_kits',
dutyPlans: 'prima.duty_plans',
guardTerms: 'prima.guard_terms',
personLinks: 'prima.person_links',
groupPeople: 'prima.group_people',
groupPersonNotes: 'prima.group_person_notes',
hireChecks: 'prima.hire_checks',
tenderOpportunities: 'prima.tender_opportunities',
tenderSources: 'prima.tender_sources',
regRelatedParties: 'prima.reg_related_parties',
regInterests: 'prima.reg_interests',
regCommittees: 'prima.reg_committees',
regRisks: 'prima.reg_risks',
regSettings: 'prima.reg_settings',
siteSurveys: 'prima.site_surveys',
siteSurveyPhotos: 'prima.site_survey_photos',
pdpaRegister: 'prima.pdpa_register',
pdpaConsents: 'prima.pdpa_consents',
pdpaSettings: 'prima.pdpa_settings',
qmsRequirements: 'prima.qms_requirements',
qmsEntries: 'prima.qms_entries',
qmsFoundation: 'prima.qms_foundation',
compProfiles: 'prima.comp_profiles',
compAssessments: 'prima.comp_assessments',
fwStatCharges: 'prima.fw_stat_charges',
hrScreenings: 'prima.hr_screenings',
amContractors: 'prima.am_contractors',
amLettings: 'prima.am_lettings',
amMeters: 'prima.am_meters',
amBookings: 'prima.am_bookings',
amHarvests: 'prima.am_harvests',
amPmPlans: 'prima.am_pm_plans',
guardPhones: 'prima.guard_phones',
guardPhoneSessions: 'prima.guard_phone_sessions',
guardPings: 'prima.guard_pings',
qmsItems: 'prima.qms_items',
qmsNonconformities: 'prima.qms_nonconformities',
fwRecruitFiles: 'prima.fw_recruit_files'
};

/**
 * Large tenant tables whose company_id column is held equal to data->>'companyId' by a CHECK constraint (001_init.sql,
 * tenant table loop). Their companyId filter uses the btree company index: through the GIN index the same filter cost
 * about 0.14 s per company at group scale (whole-organisation review G2, 3 Nov 2026).
 */
// Under the company wall (row-level security) PostgreSQL may use an index only for conditions it knows cannot leak
// rows: plain column comparisons such as company_id = $1 or id = ANY($1). Conditions on JSON fields (data->>'x',
// data @> ...) are checked only after the wall, row by row (review, 3 Nov 2026). So company and id filters below go to
// the plain columns, and callers add a company filter wherever they know it.
const COMPANY_INDEXED = new Set<TableName>(['branches', 'sites', 'posts', 'people', 'credentials', 'licences', 'shifts', 'attendance', 'cases', 'firearms', 'armsMovements', 'contracts', 'staffClaims', 'finStatus',
  // P81: a month of report attendance is thousands of day rows; a person's month is read by id (primary key).
  'attendanceImports', 'attendanceDays', 'attendanceMatches']);

/** Tables whose rows carry companyId in a company_id column. */
const HAS_COMPANY_COLUMN = new Set<TableName>([
// P81: report attendance and check-in by place.
'attendanceImports',
'attendanceDays',
'attendanceMatches',
'checkinPlaces',
'checkinRules',
'checkinSettings',
'checkinEvents',
'siteHoursApprovals',
'publicHolidayLists',
'guardPayRuns',
'guardPayAdvances',
'guardLoans',
'payChanges',
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
'corpProfiles',
'corpFilings',
'corpChanges',
'branchSettlements',
'branchActions',
'contracts',
'finStatus',
'staffPayRuns',
'jaRecords',
'socsoClaims',
'fwRenewals',
'fwmTasks',
'hostels',
'hostelStays',
'hostelBills',
'utilityCharges',
'staffClaims',
'tripApprovals',
'meetings',
'staffClocks',
'locationPings',
'clockSnaps',
'guardPayPreparers',
'remoteArrangements',
'remoteDays',
'flexRequests',
'vacancies',
'applicants',
'staffMovements',
'hrFilings',
'hrCases',
'officeOsh',
'staffTraining',
'staffAppraisals',
'policyAcks',
'workTasks',
'workCheckIns',
'helpRequests',
'oneOnOnes',
'playbookSignoffs',
'branchChecks',
'branchVisits',
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
'clientCodes',
'clientCodeChecks',
'clientInspections',
'selfAudits',
'rbaTraceReviews',
'ethicsDeclarations',
'rbaCommittees',
'evidenceVideos',
'attendanceFollowUps',
'evidencePhotos',
'evidenceDocs',
'leaveRequests',
'siteVisits',
'grants',
'delegations',
'criticalRoles',
'legalHolds',
'legalHoldVersions',
'companyDesks',
'fwWelfareChecks',
'fwPlacements',
'fwPlacementHosts',
'fwCostRates',
'fwCostCharges',
'timeSlips',
'timeSlipSettings',
'cleaningSites',
'cleaningDays',
'cleaningStock',
'siteKits',
'dutyPlans',
'guardTerms',
'regRelatedParties',
'regInterests',
'regCommittees',
'regRisks',
'regSettings',
'siteSurveys',
'siteSurveyPhotos',
'qmsEntries',
'compAssessments',
'fwStatCharges',
'hrScreenings',
'guardPhones',
'guardPhoneSessions',
'guardPings',
'qmsNonconformities',
'fwRecruitFiles'
]);

/**
 * Store backed by one PostgreSQL client inside an open transaction. The caller has already
 * switched to the prima_app role and set app.company_ids, so row-level security applies
 * to every statement here.
 */
const PAY_FORMULAS_MISSING = 'Pay formulas are not switched on in this database yet (module pay-formulas-v1 not installed).';
const GUARD_PAY_MISSING = 'The guard pay run is not switched on in this database yet (module guard-pay-v1 not installed).';
const missingMessage = (table: TableName) => (table === 'guardPayRuns' || table === 'guardPayAdvances' || table === 'guardLoans' || table === 'statutoryVersions' ? GUARD_PAY_MISSING : PAY_FORMULAS_MISSING);

export class PgStore implements Store {
  constructor(private client: PoolClient) {}

  private amExtrasPresence: Promise<boolean> | null = null;
  /** Whether the optional Asset Management extras module (db/modules/am-extras-v1.sql) is applied. */
  amExtrasReady(): Promise<boolean> {
    return (this.amExtrasPresence ??= amExtrasInstalled(this.client));
  }
  private static readonly AM_EXTRAS = new Set<TableName>(['amContractors', 'amLettings', 'amMeters', 'amBookings', 'amHarvests', 'amPmPlans']);
  private static readonly AM_EXTRAS_MISSING = 'Asset Management contractors, letting, meters, bookings, harvest and planned maintenance are not set up in this database yet.';
  /** Quality and compliance needs the reviewed module db/modules/quality-compliance-v1.sql (CEO-run). Catalog only. */
  async qualityReady(): Promise<boolean> {
    const r = await this.client.query(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'prima' AND c.relname = ANY($1) AND c.relrowsecurity AND c.relforcerowsecurity`,
      [['qms_requirements', 'qms_entries', 'qms_foundation', 'comp_profiles', 'comp_assessments', 'qms_items', 'qms_nonconformities']],
    );
    return r.rows[0]?.n === 7;
  }
  /** Governance registers need the reviewed module db/modules/governance-registers-v1.sql (CEO-run). Catalog only. */
  async registersReady(): Promise<boolean> {
    const r = await this.client.query(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'prima' AND c.relname = ANY($1) AND c.relrowsecurity AND c.relforcerowsecurity`,
      [['reg_related_parties', 'reg_interests', 'reg_committees', 'reg_risks', 'reg_settings']],
    );
    return r.rows[0]?.n === 5;
  }

  private cleaningOps: Promise<boolean> | null = null;
  /** Whether the optional cleaning and duty plan module (db/modules/cleaning-ops-v1.sql) is applied. */
  private cleaningOpsReady(): Promise<boolean> {
    return (this.cleaningOps ??= cleaningOpsInstalled(this.client));
  }
  private static readonly CLEANING_OPS = new Set<TableName>(['cleaningSites', 'cleaningDays', 'cleaningStock', 'siteKits', 'dutyPlans', 'guardTerms']);

  private officeReady: boolean | null = null;
  /** Whether the optional company office module (db/modules/company-office-v1.sql) is applied in this database. */
  async companyOfficeReady(): Promise<boolean> {
    if (this.officeReady === null)
      this.officeReady = (await this.client.query("SELECT to_regclass('prima.company_desks') IS NOT NULL AS ok")).rows[0].ok === true;
    return this.officeReady;
  }
  private runLinksReady: boolean | null = null;
  /** Whether the optional module for companies run by another office (db/modules/company-run-links-v1.sql) is applied. */
  async companyRunLinksReady(): Promise<boolean> {
    if (this.runLinksReady === null)
      this.runLinksReady = (await this.client.query("SELECT to_regclass('prima.company_run_links') IS NOT NULL AS ok")).rows[0].ok === true;
    return this.runLinksReady;
  }

  private itemsPresence: Promise<boolean> | null = null;
  /** Whether the optional item register module (db/modules/item-register-v1.sql) is applied. */
  private itemsReady(): Promise<boolean> {
    return (this.itemsPresence ??= (async () => {
      if (!(await itemRegisterInstalled(this.client))) return false;
      const problems = await itemRegisterProblems(this.client);
      if (problems.length) throw new Error('Item register protections need setup: ' + problems.join(' '));
      return true;
    })());
  }
  private itemsV2Presence: Promise<boolean> | null = null;
  /** Whether the second part (db/modules/item-register-v2.sql, P85) is applied on top of the first. */
  private itemsV2Ready(): Promise<boolean> {
    return (this.itemsV2Presence ??= (async () => {
      if (!(await this.itemsReady())) return false;
      if (!(await itemRegisterV2Installed(this.client))) return false;
      const problems = await itemRegisterV2Problems(this.client);
      if (problems.length) throw new Error('Item register protections need setup: ' + problems.join(' '));
      return true;
    })());
  }
  private static readonly ITEMS_V2 = new Set<TableName>(ITEM_V2_TABLE_NAMES);
  /** The readiness of the module a table belongs to. */
  private itemsOn(table: TableName): Promise<boolean> {
    return PgStore.ITEMS_V2.has(table) ? this.itemsV2Ready() : this.itemsReady();
  }
  private static readonly ITEMS = new Set<TableName>(ITEM_TABLE_NAMES);
  private static readonly ITEMS_OFF = 'The item register is not installed in this database yet.';
  private cleanupPresence?:Promise<boolean>;
  async itCleanupProblems(){return [...new Set([...(await cleanupSchemaProblems(this.client)),...(await itManualProblems(this.client)),...(await itOperationsProblems(this.client)),...(await procurementProblems(this.client)),...(await rentalCorrectionProblems(this.client))])];}
  private cleanupInstalled(){return this.cleanupPresence??=(async()=>{
    const r=await this.client.query(`SELECT to_regclass('prima.it_cleanup_archives') IS NOT NULL OR to_regclass('prima.it_cleanup_nominations') IS NOT NULL OR to_regclass('prima.it_cleanup_receipts') IS NOT NULL OR to_regclass('prima.it_cleanup_plan_bindings') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' AND left(p.proname,3)='ic_') AS installed`);
    if(r.rows[0]?.installed===false)return false;if(r.rows[0]?.installed!==true||(await this.itCleanupProblems()).length)throw Error('Controlled cleanup protections need setup.');return true;
  })();}
  async itCleanupArchived(kind:CleanupKind,id:string){if(!await this.cleanupInstalled())return false;const r=await this.client.query('SELECT prima.ic_archived($1,$2) AS archived',[kind,id]);if(typeof r.rows[0]?.archived!=='boolean')throw Error('Archive state unavailable.');return r.rows[0].archived as boolean;}
  async itCleanupDependencies(kind:CleanupKind,id:string){if(!await this.cleanupInstalled())return {complete:false,reasons:['cleanup_storage_unavailable']};const r=await this.client.query('SELECT prima.ic_dependencies($1,$2) AS value',[kind,id]);const v=r.rows[0]?.value;if(!v||typeof v.complete!=='boolean'||!Array.isArray(v.reasons)||v.reasons.length>30||v.reasons.some((x:unknown)=>typeof x!=='string'||! /^[A-Za-z0-9_]{1,100}$/.test(x)))return {complete:false,reasons:['dependency_coverage_missing']};return v as {complete:boolean;reasons:string[]};}


  async siteSurveyProblems(): Promise<string[]> {
    const r = await this.client.query(`SELECT to_regclass('prima.site_surveys') IS NOT NULL AS surveys, to_regclass('prima.site_survey_photos') IS NOT NULL AS photos,
      EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'site_survey_guard' AND tgrelid = to_regclass('prima.site_surveys')) AS guard`);
    const row = r.rows[0] ?? {};
    return [...(row.surveys ? [] : ['site_surveys_missing']), ...(row.photos ? [] : ['site_survey_photos_missing']), ...(row.guard ? [] : ['site_survey_guard_missing'])];
  }

  async createItTicket(body: Omit<ItTicket, 'id' | 'ref'>): Promise<ItTicket> {
    // Same transaction lock for ordinary, website and imported requests. No new read/grant authority.
    await this.client.query("SELECT pg_advisory_xact_lock(hashtext('prima:it-ticket-reference'))");
    const id = `it-t-${randomUUID()}`;
    const result = await this.client.query(`
      INSERT INTO prima.it_tickets(id, data)
      SELECT $1, $2::jsonb || jsonb_build_object('id',$1::text,'ref',
        'IT-' || CASE WHEN length(n::text)<4 THEN lpad(n::text,4,'0') ELSE n::text END)
      FROM (SELECT coalesce(max(substring(data->>'ref' from 4)::numeric),0)+1 AS n
        FROM prima.it_tickets WHERE data->>'ref' ~ '^IT-[0-9]{1,18}$') allocated WHERE n <= 999999999999999999
      RETURNING data`, [id, JSON.stringify(body)]);
    if (result.rows.length !== 1) throw new Error('Ticket reference range exhausted.');
    return result.rows[0].data as ItTicket;
  }

  private moduleChecked = new Set<TableName>();
  /** A proposed-module table must exist before it is used; the check runs once per request. */
  private async needModule(table: TableName): Promise<void> {
    const why = MODULE_TABLES[table];
    if (!why || this.moduleChecked.has(table)) return;
    const r = await this.client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [TABLE[table]]);
    if (r.rows[0]?.ok !== true) throw new BadRequest(why);
    this.moduleChecked.add(table);
  }

  async hasTable(table: TableName): Promise<boolean> {
    const r = await this.client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [TABLE[table]]);
    return r.rows[0]?.ok === true;
  }

  private payFormulasPresent: boolean | null = null;
  /** Whether the optional pay formulas module (db/modules/pay-formulas-v1.sql) is applied in this database. */
  async payFormulasReady(): Promise<boolean> {
    if (this.payFormulasPresent === null)
      this.payFormulasPresent = (await this.client.query("SELECT to_regclass('prima.pay_formulas') IS NOT NULL AND to_regclass('prima.pay_formula_uses') IS NOT NULL AND to_regclass('prima.site_hours_approvals') IS NOT NULL AND to_regclass('prima.public_holiday_lists') IS NOT NULL AND to_regclass('prima.pay_law_versions') IS NOT NULL AS ok")).rows[0].ok === true;
    return this.payFormulasPresent;
  }
  private guardPayPresent: boolean | null = null;
  /** Whether the optional guard pay module (db/modules/guard-pay-v1.sql) is applied in this database. */
  async guardPayReady(): Promise<boolean> {
    if (this.guardPayPresent === null)
      this.guardPayPresent = (await this.client.query("SELECT to_regclass('prima.guard_pay_runs') IS NOT NULL AND to_regclass('prima.guard_pay_advances') IS NOT NULL AND to_regclass('prima.statutory_versions') IS NOT NULL AND to_regclass('prima.guard_loans') IS NOT NULL AS ok")).rows[0].ok === true;
    return this.guardPayPresent;
  }
  private async payFormulaTable(table: TableName): Promise<'ready' | 'missing' | 'other'> {
    if (table === 'guardPayRuns' || table === 'guardPayAdvances' || table === 'guardLoans' || table === 'statutoryVersions') return (await this.guardPayReady()) ? 'ready' : 'missing';
    if (table !== 'payFormulas' && table !== 'payFormulaUses' && table !== 'siteHoursApprovals' && table !== 'publicHolidayLists' && table !== 'payLawVersions') return 'other';
    return (await this.payFormulasReady()) ? 'ready' : 'missing';
  }

async list<T extends TableName>(table: T, filter?: Filter<T>, range?: Range<T>): Promise<Row<T>[]> {
    await this.needModule(table);
    if ((await this.payFormulaTable(table)) === 'missing') return [];
    if (PgStore.ITEMS.has(table) && !(await this.itemsOn(table))) return [];
    if (table === 'companyDesks' && !(await this.companyOfficeReady())) return [];
    if (table === 'companyRunLinks' && !(await this.companyRunLinksReady())) return [];
    if (PgStore.CLEANING_OPS.has(table) && !(await this.cleaningOpsReady())) return [];
    if (PgStore.AM_EXTRAS.has(table) && !(await this.amExtrasReady())) return [];
    // Before the optional module is applied there are simply no desks; querying the missing table would abort the request.
    if (table === 'companyDesks' && !(await this.companyOfficeReady())) return [];
    const where: string[] = [];
    const params: unknown[] = [];
    const contains: Record<string, unknown> = {};
    const companyIndexed = COMPANY_INDEXED.has(table);
    for (const [key, value] of Object.entries(filter ?? {})) {
      if (value === undefined) continue;
      if (companyIndexed && key === 'companyId' && typeof value === 'string') {
        params.push(value);
        where.push(`company_id = $${params.length}`);
        continue;
      }
      if (companyIndexed && key === 'companyId' && Array.isArray(value) && value.every((v) => typeof v === 'string')) {
        if (value.length === 0) return [];
        params.push(value);
        where.push(`company_id = ANY($${params.length}::text[])`);
        continue;
      }
      // Rows by id on a company table go through the primary key (the base schema checks data->>'id' = id on these tables).
      if (companyIndexed && key === 'id' && Array.isArray(value) && value.every((v) => typeof v === 'string')) {
        if (value.length === 0) return [];
        params.push(value);
        where.push(`id = ANY($${params.length}::text[])`);
        continue;
      }
      if (Array.isArray(value)) {
        if (value.length === 0) return [];
        params.push(value.map(String));
        where.push(`data->>'${key.replace(/[^A-Za-z]/g, '')}' = ANY($${params.length})`);
      } else {
        contains[key] = value;
      }
    }
    if (Object.keys(contains).length) {
      params.push(JSON.stringify(contains));
      where.push(`data @> $${params.length}::jsonb`);
    }
    // A date window (core Range): the field name is letters only; the bounds are parameters, compared as text like the
    // in-memory store. A row without the field is left out (NULL never compares true).
    if (range) {
      const f = String(range.field).replace(/[^A-Za-z]/g, '');
      if (!f) throw new Error('Range field missing.');
      where.push(`jsonb_typeof(data->'${f}') = 'string'`);
      if (range.from !== undefined) {
        params.push(String(range.from));
        where.push(`data->>'${f}' >= $${params.length}`);
      }
      if (range.before !== undefined) {
        params.push(String(range.before));
        where.push(`data->>'${f}' < $${params.length}`);
      }
    }
    const order = table === 'audit' ? ' ORDER BY seq' : '';
    const sql = `SELECT data FROM ${TABLE[table]}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}${order}`;
    const res = await this.client.query(sql, params);
    return res.rows.map((r) => r.data as Row<T>);
  }

  async get<T extends TableName>(table: T, id: Id): Promise<Row<T> | undefined> {
    await this.needModule(table);
    if ((await this.payFormulaTable(table)) === 'missing') return undefined;
    if (PgStore.ITEMS.has(table) && !(await this.itemsOn(table))) return undefined;
    if (table === 'companyDesks' && !(await this.companyOfficeReady())) return undefined;
    if (table === 'companyRunLinks' && !(await this.companyRunLinksReady())) return undefined;
    if (PgStore.CLEANING_OPS.has(table) && !(await this.cleaningOpsReady())) return undefined;
    if (PgStore.AM_EXTRAS.has(table) && !(await this.amExtrasReady())) return undefined;
    if ((await this.payFormulaTable(table)) === 'missing') return undefined;
    if (PgStore.ITEMS.has(table) && !(await this.itemsOn(table))) return undefined;
    const key = table === 'audit' ? 'seq' : 'id';
    const res = await this.client.query(`SELECT data FROM ${TABLE[table]} WHERE ${key} = $1`, [table === 'audit' ? Number(id) : id]);
    return res.rows[0]?.data as Row<T> | undefined;
  }

  async workflowMetricProblems():Promise<string[]>{return workflowMetricProblems(this.client);}
  async workflowMetricLock(ref:import('@prima/core').MetricRef|null):Promise<void>{await this.client.query('SELECT prima.wm_lock($1::jsonb)',[ref]);}
  async workflowMetricBoundary(streamId:string,_actorId:string,_today:string):Promise<boolean>{const r=await this.client.query('SELECT prima.wm_boundary($1) AS changed',[streamId]);return r.rows[0]?.changed===true;}
  async workflowMetricNextSegment(ref:import('@prima/core').MetricRef):Promise<number>{const r=await this.client.query('SELECT prima.wm_next_segment($1::jsonb) AS segment',[ref]);const n=r.rows[0]?.segment;if(!Number.isSafeInteger(n)||n<1)throw Error('Invalid workflow coverage segment.');return n;}

  hrItTrustedTenant(): string | null { return process.env.ENTRA_TENANT_ID ?? null; }
  async hrItProblems(): Promise<string[]> { const raw=this.hrItTrustedTenant(); const tenant=raw&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)?raw.toLowerCase():''; await this.client.query("SELECT set_config('app.hr_it_tenant', $1, true)",[tenant]); return hrItProblems(this.client); }
  async procurementProblems(): Promise<string[]> { return [...await itManualProblems(this.client), ...await procurementProblems(this.client)]; }
  async rentalCorrectionProblems(): Promise<string[]> { return rentalCorrectionProblems(this.client); }
  async itOperationsProblems(): Promise<string[]> { return [...await itManualProblems(this.client), ...await itOperationsProblems(this.client)]; }

  async itManualProblems(): Promise<string[]> { return itManualProblems(this.client); }

  /** The Finance team recorded for a company (hand-over receivers); the number only, read by the module's function. */
  async orgFinanceTeam(companyId: Id): Promise<number | null> {
    const r = await this.client.query('SELECT prima.org_finance_team($1) AS team', [companyId]);
    const t = r.rows[0]?.team;
    return Number.isInteger(t) ? t : null;
  }

  /** The office running a company (hand-over receivers), read by the module's function; null before run links exist. */
  async orgRunBy(companyId: Id): Promise<Id | null> {
    const r = await this.client.query('SELECT prima.org_run_by($1) AS run_by', [companyId]);
    const v = r.rows[0]?.run_by;
    return typeof v === 'string' && v ? v : null;
  }

  async lock<T extends TableName>(table: T, id: Id): Promise<void> {
    await this.needModule(table);
    if (table === 'companyDesks' && !(await this.companyOfficeReady())) throw new BadRequest('Company office module not installed');
    if (table === 'companyRunLinks' && !(await this.companyRunLinksReady())) throw new BadRequest('Company run links module not installed');
    if (PgStore.CLEANING_OPS.has(table) && !(await this.cleaningOpsReady())) throw new BadRequest('Cleaning and duty plans are not installed in this database yet.');
    if (PgStore.AM_EXTRAS.has(table) && !(await this.amExtrasReady())) throw new BadRequest(PgStore.AM_EXTRAS_MISSING);
    if (table === 'audit') return;
    // P93: one person's clock steps (opening Prima, check-in, check-out, sign-out, a second tab or phone) one at a time,
    // even before their first clock row exists, so two of them never both open a clock or both check in.
    if ((table === 'staffClocks' || table === 'ownerTestCheckins') && id.startsWith('user:')) {
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${table}:${id}`]);
      return;
    }
    // Two sends of the same new offline operation at once: the second waits, then finds the first's receipt.
    // Also serializes one person's help-request duplicate check (id `help:<userId>`) across different operation IDs.
    if (table === 'offlineOps') await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`offline-op:${id}`]);
    // One person's lease count (id `user:<userId>`): two lease requests at once cannot both take the last slot.
    // Leases are never changed (no UPDATE right), so the advisory lock is all there is to take.
    if (table === 'offlineLeases') return void (await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`offline-lease:${id}`]));
    // Office desks serialize per company, even before the first desk row exists.
    if (table === 'companyDesks' && !(await this.companyOfficeReady())) throw new Error('Company office module not installed');
    if (table === 'companyDesks') await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`company-desks:${id}`]);
    // One lock for every run link: the one-level rule reads all links, so two CEO changes must not interleave.
    if (table === 'companyRunLinks') {
      if (!(await this.companyRunLinksReady())) throw new Error('Company run links module not installed');
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['company-run-links']);
      return;
    }
    // The per-manager Arisha AI quota for rebalancing (Arisha main review, 2 Nov 2026): one counter per user id, held
    // until the request's transaction ends, so parallel asks are counted one after the other.
    if (table === 'users' && id.startsWith('rebalance-ai:')) {
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
      return;
    }
    // Company-wide branch keys (invoice numbers, SQL project codes): one company-scoped transaction lock, since two
    // branches have two different rows and a row lock alone cannot keep a key unique across them.
    if (table === 'branches' && id.startsWith('company-keys:')) {
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`branch-keys:${id}`]);
      return;
    }
    // Recruitment cost: drafting a month and changing placements serialize on one key, even before the rates row exists.
    if (table === 'fwCostRates') await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`fw-cost:${id}`]);
    if (PgStore.CLEANING_OPS.has(table)) {
      if (!(await this.cleaningOpsReady())) throw new Error('Cleaning and duty plans are not installed in this database yet.');
      // Serialize per record even before the first row exists.
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cleaning-ops:${table}:${id}`]);
      return;
    }
    // A survey made offline is sent with its own number: two resends at once go one after the other.
    if (table === 'siteSurveys') await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`site-survey:${id}`]);
    await this.needModule(table);
    // The single PDPA settings row may not exist yet; serialize its first save too.
    if (table === 'pdpaSettings') await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pdpa-settings:${id}`]);
    // EPF and SOCSO recharge: one step at a time on a debit note (repay, check in, cancel), before reading it.
    if (table === 'fwStatCharges' && id.startsWith('key:')) {
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`fw-stat:${id}`]);
      return;
    }
    if (PgStore.AM_EXTRAS.has(table)) {
      if (!(await this.amExtrasReady())) throw new BadRequest(PgStore.AM_EXTRAS_MISSING);
      // Serialize per record even before the first row exists (a new letting file, a new booking id).
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`am-extras:${table}:${id}`]);
      return;
    }
    // Pay formula saves serialize on one key, even before any row exists (new codes and place choices).
    if ((await this.payFormulaTable(table)) === 'missing') throw new Error(missingMessage(table));
    // A company's month serializes even before its run row exists (two HR officers preparing at once).
    if (table === 'guardPayRuns' || table === 'guardPayAdvances' || table === 'guardLoans' || table === 'statutoryVersions') await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`guard-pay:${id}`]);
    if ((table === 'payFormulas' || table === 'payFormulaUses' || table === 'siteHoursApprovals' || table === 'publicHolidayLists' || table === 'payLawVersions') && id.startsWith('pay-formulas:')) {
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
      return;
    }
    if (PgStore.ITEMS.has(table)) {
      if (!(await this.itemsOn(table))) throw new Error(PgStore.ITEMS_OFF);
      // Serialize per record, so two people sending or issuing one item at once go one after the other.
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`items:${table}:${id}`]);
      return;
    }
    // Immutable rental ledgers intentionally have no UPDATE privilege. Serialize
    // their decisions with the same transaction lock as the service and SQL guards,
    // rather than SELECT FOR UPDATE (which requires that forbidden privilege).
    if (table === 'itRentalCorrectionRequests' || table === 'itRentalReplacements') {
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['it-manual:create']);
      return;
    }
    // Central Admin: one SQL Account payables reference per entity is checked across firms, so linking serializes on
    // the billed entity rather than on a row (Arisha main round 5b).
    if (table === 'panelFirms' && id.startsWith('ap:')) {
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`central-admin:${id}`]);
      return;
    }
    if (table === 'itSettings' && id.startsWith('it-manual:')) {
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
      return;
    }
    // Setup requests serialize by actor even before a ticket exists, within Db.asUser's transaction.
    if (table === 'itTickets' && /^(job-email|sharepoint)-setup:/.test(id))
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
    // Serialize creation too: SELECT FOR UPDATE alone cannot lock a missing draft.
    if (table === 'arishaDrafts') await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`arisha-draft:${id}`]);
    // One staff directory change at a time (batch send, approval, hand entry), even before any batch row exists.
    if (table === 'staffDirectoryBatches') await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`staff-directory:${id}`]);
    if (table === 'itImportReviews') await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`it-import-review:${id}`]);
    // Website cycle creation and reminder dedupe serialize even before the singleton settings row exists.
    // Opening an ACT investigation serializes numbering and the one-open-file-per-anomaly check before any row exists.
    if (table === 'actAudits' && id === 'act-investigation:open') {
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
      return;
    }
    if (table === 'webSettings') await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`web-settings:${id}`]);
    // P81: one attendance import per company and month at a time, and one remembered match per employee key, even
    // before any row exists.
    if ((table === 'attendanceImports' && id.startsWith('attendance-import:')) || table === 'attendanceMatches') {
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${table}:${id}`]);
      return;
    }
    // Leave: "a refusal is corrected once" and "one MC is used once" serialize on a key, not a row (Arisha review, 3 Nov 2026).
    if (table === 'leaveRequests' && /^leave-(correct|mc):/.test(id)) {
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
      return;
    }
    await this.client.query(`SELECT 1 FROM ${TABLE[table]} WHERE id = $1 FOR UPDATE`, [id]);
  }

  async insert<T extends TableName>(table: T, row: Row<T>): Promise<void> {
    await this.needModule(table);
    if (table === 'companyDesks' && !(await this.companyOfficeReady())) throw new BadRequest('Company office module not installed');
    if (table === 'companyRunLinks' && !(await this.companyRunLinksReady())) throw new BadRequest('Company run links module not installed');
    if (PgStore.CLEANING_OPS.has(table) && !(await this.cleaningOpsReady())) throw new BadRequest('Cleaning and duty plans are not installed in this database yet.');
    if (PgStore.AM_EXTRAS.has(table) && !(await this.amExtrasReady())) throw new BadRequest(PgStore.AM_EXTRAS_MISSING);
    if (table === 'audit') throw new Error('Use audit() to append to the audit log');
    if ((await this.payFormulaTable(table)) === 'missing') throw new Error(missingMessage(table));
    const r = row as unknown as { id: string; companyId?: string; partyIds?: string[] };
    if (PgStore.ITEMS.has(table)) {
      if (!(await this.itemsOn(table))) throw new Error(PgStore.ITEMS_OFF);
      await this.client.query(`INSERT INTO ${TABLE[table]} (id, party_ids, data) VALUES ($1, $2, $3)`, [r.id, r.partyIds ?? [], row]);
      return;
    }
    if (HAS_COMPANY_COLUMN.has(table)) {
      await this.client.query(`INSERT INTO ${TABLE[table]} (id, company_id, data) VALUES ($1, $2, $3)`, [r.id, r.companyId, row]);
    } else {
      await this.client.query(`INSERT INTO ${TABLE[table]} (id, data) VALUES ($1, $2)`, [r.id, row]);
    }
  }

  /**
   * P81: many rows of one company-column table in a few statements (2,000 rows each): a month of report attendance is
   * thousands of rows, and one INSERT each would hold the request for seconds. The company wall checks every row.
   * Tables behind an optional module or a special insert path go row by row through insert() and its checks.
   */
  async insertMany<T extends TableName>(table: T, rows: Row<T>[]): Promise<void> {
    if (table === 'audit') throw new Error('Use audit() to append to the audit log');
    const special = table === 'companyDesks' || table === 'companyRunLinks' || PgStore.ITEMS.has(table) || PgStore.CLEANING_OPS.has(table) || PgStore.AM_EXTRAS.has(table) || MODULE_TABLES[table] !== undefined || (await this.payFormulaTable(table)) !== 'other';
    if (!HAS_COMPANY_COLUMN.has(table) || special) {
      for (const row of rows) await this.insert(table, row);
      return;
    }
    for (let i = 0; i < rows.length; i += 2000) {
      const part = rows.slice(i, i + 2000);
      await this.client.query(
        `INSERT INTO ${TABLE[table]} (id, company_id, data) SELECT x->>'id', x->>'companyId', x FROM jsonb_array_elements($1::jsonb) AS x`,
        [JSON.stringify(part)],
      );
    }
  }

  async update<T extends TableName>(table: T, id: Id, patch: Partial<Row<T>>): Promise<Row<T>> {
    await this.needModule(table);
    if (table === 'companyDesks' && !(await this.companyOfficeReady())) throw new BadRequest('Company office module not installed');
    if (table === 'companyRunLinks' && !(await this.companyRunLinksReady())) throw new BadRequest('Company run links module not installed');
    if (PgStore.CLEANING_OPS.has(table) && !(await this.cleaningOpsReady())) throw new BadRequest('Cleaning and duty plans are not installed in this database yet.');
    if (PgStore.AM_EXTRAS.has(table) && !(await this.amExtrasReady())) throw new BadRequest(PgStore.AM_EXTRAS_MISSING);
    if ('id' in patch || 'companyId' in patch) throw new Error('id and companyId cannot be changed');
    if ((await this.payFormulaTable(table)) === 'missing') throw new Error(missingMessage(table));
    if (PgStore.ITEMS.has(table)) {
      if (!(await this.itemsOn(table))) throw new Error(PgStore.ITEMS_OFF);
      const parties = (patch as { partyIds?: string[] }).partyIds;
      const res = await this.client.query(
        `UPDATE ${TABLE[table]} SET data = data || $2::jsonb, party_ids = coalesce($3::text[], party_ids) WHERE id = $1 RETURNING data`,
        [id, JSON.stringify(patch), parties ?? null],
      );
      if (res.rowCount === 0) throw new Error(`Not found: ${table} ${id}`);
      return res.rows[0].data as Row<T>;
    }
    const res = await this.client.query(`UPDATE ${TABLE[table]} SET data = data || $2::jsonb WHERE id = $1 RETURNING data`, [id, JSON.stringify(patch)]);
    if (res.rowCount === 0) throw new Error(`Not found: ${table} ${id}`);
    return res.rows[0].data as Row<T>;
  }

  /** Offboarding goes through prima.close_access: the API holds no other right to change accounts or grants. */
  async closeAccess(userId: Id, from: string, closed: { by: string; at: string; reason: string }): Promise<number> {
    const res = await this.client.query('SELECT prima.close_access($1, $2::date, $3::jsonb) AS n', [userId, from, JSON.stringify(closed)]);
    return Number(res.rows[0].n);
  }

  /** One person's history by the number typed, through prima.group_history_lookup (reads across companies for that one number). */
  async groupHistoryLookup(idKey: string): Promise<GroupHistoryLookupRow> {
    const res = await this.client.query('SELECT prima.group_history_lookup($1) AS r', [idKey]);
    const r = res.rows[0].r as GroupHistoryLookupRow;
    return { groups: r.groups ?? [], companyNames: r.companyNames ?? {}, rehireNotes: r.rehireNotes ?? null };
  }

  /** "Do not hire again" set or lifted by lookup, through prima.history_set_mark. */
  async historySetMark(idKey: string, mark: { status: RehireStatus; setAt: string; setBy: string }, entry: GroupPersonNotes['rehire'][number], actorPersonId: Id | null): Promise<Id[]> {
    const res = await this.client.query('SELECT prima.history_set_mark($1, $2::jsonb, $3::jsonb, $4) AS g', [idKey, JSON.stringify(mark), JSON.stringify(entry), actorPersonId]);
    return (res.rows[0].g as string[] | null) ?? [];
  }

  /** The person a keyed number already belongs to (prima.history_group_for), for linking across companies. */
  async historyGroupFor(idKey: string, notPersonId: Id): Promise<Id | null> {
    const res = await this.client.query('SELECT prima.history_group_for($1, $2) AS g', [idKey, notPersonId]);
    return (res.rows[0].g as string | null) ?? null;
  }

  /** Expire and clear Arisha IT import reviews; the database function changes and audits each in one step. */
  async tidyItImportReviews(by: string): Promise<{ id: string; kind: string; outcome: 'expired' | 'purged' }[]> {
    const res = await this.client.query('SELECT review_id, review_kind, outcome FROM prima.tidy_it_import_reviews($1)', [by]);
    return res.rows.map((r: { review_id: string; review_kind: string; outcome: 'expired' | 'purged' }) => ({ id: r.review_id, kind: r.review_kind, outcome: r.outcome }));
  }

  /** Readiness for the staff directory: both tables with forced row-level security, its policies and the app role's rights. */
  async staffDirectoryProblems(): Promise<string[]> {
    const res = await this.client.query(
      `SELECT t,
         to_regclass(t) IS NOT NULL AS has_table,
         coalesce((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = to_regclass(t)), false) AS forced_rls,
         (SELECT count(*) FROM pg_policy WHERE polrelid = to_regclass(t))::int AS policies,
         to_regclass(t) IS NOT NULL AND (has_table_privilege('prima_app', t, 'DELETE') OR has_table_privilege('prima_app', t, 'TRUNCATE')) AS app_too_much
       FROM unnest(ARRAY['prima.staff_directory', 'prima.staff_directory_batches']) AS t`,
    );
    const out: string[] = [];
    for (const r of res.rows as { t: string; has_table: boolean; forced_rls: boolean; policies: number; app_too_much: boolean }[]) {
      if (!r.has_table) {
        out.push(`${r.t} is missing: run db/modules/staff-directory-v1.sql.`);
        continue;
      }
      if (!r.forced_rls) out.push(`Row-level security is not forced on ${r.t}.`);
      if (r.policies < 3) out.push(`The access policies on ${r.t} are missing.`);
      if (r.app_too_much) out.push(`The app role may remove rows from ${r.t}.`);
    }
    const fn = await this.client.query(`SELECT to_regprocedure('prima.sd_role(text,text)') IS NOT NULL AS ok`);
    if (!fn.rows[0].ok) out.push('The staff directory role check is missing.');
    return out;
  }

  /** Readiness for the Arisha IT import: the ledger, its protections and the app role's rights, as the database has them. */
  async itImportProblems(): Promise<string[]> {
    const t = 'prima.it_import_reviews';
    const f = 'prima.tidy_it_import_reviews(text)';
    const res = await this.client.query(
      `SELECT
         to_regclass($1) IS NOT NULL AS has_table,
         coalesce((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = to_regclass($1)), false) AS forced_rls,
         EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass($1) AND polname = 'review_own') AS has_policy,
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass($1) AND tgname = 'it_import_review_guard' AND tgenabled = 'O') AS has_guard,
         (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass($1) AND contype = 'c')::int AS checks,
         to_regprocedure($2) IS NOT NULL AS has_tidy,
         coalesce((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure($2)), false) AS tidy_definer,
         to_regprocedure('prima.audit_append_internal(text,text,text,text,text)') IS NOT NULL AS has_audit_fn,
         to_regclass($1) IS NOT NULL AND has_table_privilege('prima_app', $1, 'SELECT') AND has_table_privilege('prima_app', $1, 'INSERT') AND has_table_privilege('prima_app', $1, 'UPDATE') AS app_rights,
         to_regclass($1) IS NOT NULL AND (has_table_privilege('prima_app', $1, 'DELETE') OR has_table_privilege('prima_app', $1, 'TRUNCATE')) AS app_too_much,
         to_regprocedure($2) IS NOT NULL AND has_function_privilege('prima_app', $2, 'EXECUTE') AS app_tidy,
         to_regprocedure('prima.audit_append_internal(text,text,text,text,text)') IS NOT NULL AND has_function_privilege('prima_app', 'prima.audit_append_internal(text,text,text,text,text)', 'EXECUTE') AS app_audit_fn`,
      [t, f],
    );
    const r = res.rows[0];
    const out: string[] = [];
    if (!r.has_table) return ['The import review table is missing: run the database setup.'];
    if (!r.forced_rls) out.push('Row-level security is not forced on the review table.');
    if (!r.has_policy) out.push('The CEO-only policy is missing.');
    if (!r.has_guard) out.push('The review guard trigger is missing or disabled.');
    if (r.checks < 14) out.push('Review field checks are missing.');
    if (!r.has_tidy || !r.tidy_definer) out.push('The retention function is missing.');
    if (!r.has_audit_fn) out.push('The retention audit function is missing.');
    if (!r.app_rights) out.push('The app role cannot read, add or change reviews.');
    if (r.app_too_much) out.push('The app role may remove reviews.');
    if (!r.app_tidy) out.push('The app role cannot run retention.');
    if (r.app_audit_fn) out.push('The app role may write audit entries through the internal function.');
    return out;
  }

  async audit(body: AuditBody): Promise<AuditEntry> {
    const head = await this.client.query('SELECT seq, hash FROM prima.audit_head()');
    const prevSeq = Number(head.rows[0]?.seq ?? 0);
    const prevHash: string = head.rows[0]?.hash ?? GENESIS_HASH;
    const entry = chainEntry(prevSeq, prevHash, body);
    await this.client.query('INSERT INTO prima.audit (seq, company_id, data) VALUES ($1, $2, $3)', [entry.seq, entry.companyId, entry]);
    return entry;
  }

  async transaction<R>(fn: (store: Store) => Promise<R>): Promise<R> {
    // Each request already runs in one transaction; a savepoint keeps a failed unit from
    // leaving half its writes behind. ROLLBACK TO keeps the savepoint, so a failed unit's savepoint
    // is released straight after: otherwise an outer unit's rollback would stop at that leftover and keep
    // everything written before it (Arisha review of PR #56, 2 Nov 2026). The shared name stays so units
    // that run side by side on one connection still release cleanly.
    await this.client.query('SAVEPOINT unit');
    try {
      const out = await fn(this);
      await this.client.query('RELEASE SAVEPOINT unit');
      return out;
    } catch (e) {
      if (!(e instanceof RefusedAfterSave)) await this.client.query('ROLLBACK TO SAVEPOINT unit');
      await this.client.query('RELEASE SAVEPOINT unit');
      throw e;
    }
  }
}
