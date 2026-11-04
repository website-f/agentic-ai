import {workflowMetricProblems} from './it-workflow-metrics-readiness';
import {cleanupSchemaProblems} from './it-cleanup-readiness';
import type {CleanupKind} from '@prima/core';
import {procurementProblems} from './procurement-readiness';
import {rentalCorrectionProblems} from './rental-correction-readiness';
import { randomUUID } from 'node:crypto';
import { hrItProblems } from './hr-it-readiness';
import { itOperationsProblems } from './it-operations-readiness';
import { itManualProblems } from './it-manual-readiness';
import { GENESIS_HASH, chainEntry, type AuditBody, type AuditEntry, type Filter, type Id, type Row, type Store, type TableName, type ItTicket } from '@prima/core';
import type { PoolClient } from 'pg';

const TABLE: Record<TableName, string> = {
  itMetricStreams:'prima.it_metric_streams',
  itMetricReceipts:'prima.it_metric_receipts',
  itMetricTargets:'prima.it_metric_targets',
  itMetricCalendars:'prima.it_metric_calendars',
  arishaDrafts: 'prima.arisha_drafts',
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
  itRentalCorrectionRequests:'prima.it_rental_correction_requests', itRentalCorrectionReviews:'prima.it_rental_correction_reviews', itRentalReplacements:'prima.it_rental_replacements', itRentalReplacementPayments:'prima.it_rental_replacement_payments', itRentalCorrectionReceipts:'prima.it_rental_correction_receipts',
  itRentalRates: 'prima.it_rental_rates',
  itAssetInspections: 'prima.it_asset_inspections',
  itOperationalReceipts: 'prima.it_operational_receipts',
  itPurchaseFinanceAuthorities:'prima.it_purchase_finance_authorities',
  itProcurementPackets:'prima.it_procurement_packets',
  itProcurementReceipts:'prima.it_procurement_receipts',
  itCleanupNominations:'prima.it_cleanup_nominations',itCleanupArchives:'prima.it_cleanup_archives',itCleanupReceipts:'prima.it_cleanup_receipts',itCleanupPlanBindings:'prima.it_cleanup_plan_bindings',
  hrItRequests:'prima.hr_it_requests', hrItApprovals:'prima.hr_it_approvals', hrItDelegations:'prima.hr_it_delegations', hrItAuthorityMappings:'prima.hr_it_authority_mappings', hrItReceipts:'prima.hr_it_receipts',
  confidentialityAcks: 'prima.confidentiality_acks',
  itAccounts: 'prima.it_accounts',
  itAccessRequests: 'prima.it_access_requests',
  itCodeHolders: 'prima.it_code_holders',
  itSettings: 'prima.it_settings',
  itManualReceipts: 'prima.it_manual_receipts',
  claimRates: 'prima.claim_rates',
  memos: 'prima.memos',
  pdpaCases: 'prima.pdpa_cases',
  pdpaDpos: 'prima.pdpa_dpos',
  pdpaRequests: 'prima.pdpa_requests',
  bcmSystems: 'prima.bcm_systems',
  bcmDrills: 'prima.bcm_drills',
  amDepnPostings: 'prima.am_depn_postings',
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
};

/** Tables whose rows carry companyId in a company_id column. */
const HAS_COMPANY_COLUMN = new Set<TableName>([
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
  'remoteArrangements',
  'remoteDays',
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
  'attendanceFollowUps',
  'evidencePhotos',
  'evidenceDocs',
  'leaveRequests',
  'siteVisits',
  'grants',
]);

/**
 * Store backed by one PostgreSQL client inside an open transaction. The caller has already
 * switched to the prima_app role and set app.company_ids, so row-level security applies
 * to every statement here.
 */
export class PgStore implements Store {
  constructor(private client: PoolClient) {}
  private cleanupPresence?:Promise<boolean>;
  async itCleanupProblems(){return [...new Set([...(await cleanupSchemaProblems(this.client)),...(await itManualProblems(this.client)),...(await itOperationsProblems(this.client)),...(await procurementProblems(this.client)),...(await rentalCorrectionProblems(this.client))])];}
  private cleanupInstalled(){return this.cleanupPresence??=(async()=>{
    const r=await this.client.query(`SELECT to_regclass('prima.it_cleanup_archives') IS NOT NULL OR to_regclass('prima.it_cleanup_nominations') IS NOT NULL OR to_regclass('prima.it_cleanup_receipts') IS NOT NULL OR to_regclass('prima.it_cleanup_plan_bindings') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' AND left(p.proname,3)='ic_') AS installed`);
    if(r.rows[0]?.installed===false)return false;if(r.rows[0]?.installed!==true||(await this.itCleanupProblems()).length)throw Error('Controlled cleanup protections need setup.');return true;
  })();}
  async itCleanupArchived(kind:CleanupKind,id:string){if(!await this.cleanupInstalled())return false;const r=await this.client.query('SELECT prima.ic_archived($1,$2) AS archived',[kind,id]);if(typeof r.rows[0]?.archived!=='boolean')throw Error('Archive state unavailable.');return r.rows[0].archived as boolean;}
  async itCleanupDependencies(kind:CleanupKind,id:string){if(!await this.cleanupInstalled())return {complete:false,reasons:['cleanup_storage_unavailable']};const r=await this.client.query('SELECT prima.ic_dependencies($1,$2) AS value',[kind,id]);const v=r.rows[0]?.value;if(!v||typeof v.complete!=='boolean'||!Array.isArray(v.reasons)||v.reasons.length>30||v.reasons.some((x:unknown)=>typeof x!=='string'||! /^[A-Za-z0-9_]{1,100}$/.test(x)))return {complete:false,reasons:['dependency_coverage_missing']};return v as {complete:boolean;reasons:string[]};}


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

  async list<T extends TableName>(table: T, filter?: Filter<T>): Promise<Row<T>[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const contains: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filter ?? {})) {
      if (value === undefined) continue;
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
    const order = table === 'audit' ? ' ORDER BY seq' : '';
    const sql = `SELECT data FROM ${TABLE[table]}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}${order}`;
    const res = await this.client.query(sql, params);
    return res.rows.map((r) => r.data as Row<T>);
  }

  async get<T extends TableName>(table: T, id: Id): Promise<Row<T> | undefined> {
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

  async lock<T extends TableName>(table: T, id: Id): Promise<void> {
    if (table === 'audit') return;
    // Immutable rental ledgers intentionally have no UPDATE privilege. Serialize
    // their decisions with the same transaction lock as the service and SQL guards,
    // rather than SELECT FOR UPDATE (which requires that forbidden privilege).
    if (table === 'itRentalCorrectionRequests' || table === 'itRentalReplacements') {
      await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['it-manual:create']);
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
    if (table === 'itImportReviews') await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`it-import-review:${id}`]);
    // Website cycle creation and reminder dedupe serialize even before the singleton settings row exists.
    if (table === 'webSettings') await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`web-settings:${id}`]);
    await this.client.query(`SELECT 1 FROM ${TABLE[table]} WHERE id = $1 FOR UPDATE`, [id]);
  }

  async insert<T extends TableName>(table: T, row: Row<T>): Promise<void> {
    if (table === 'audit') throw new Error('Use audit() to append to the audit log');
    const r = row as unknown as { id: string; companyId?: string };
    if (HAS_COMPANY_COLUMN.has(table)) {
      await this.client.query(`INSERT INTO ${TABLE[table]} (id, company_id, data) VALUES ($1, $2, $3)`, [r.id, r.companyId, row]);
    } else {
      await this.client.query(`INSERT INTO ${TABLE[table]} (id, data) VALUES ($1, $2)`, [r.id, row]);
    }
  }

  async update<T extends TableName>(table: T, id: Id, patch: Partial<Row<T>>): Promise<Row<T>> {
    if ('id' in patch || 'companyId' in patch) throw new Error('id and companyId cannot be changed');
    const res = await this.client.query(`UPDATE ${TABLE[table]} SET data = data || $2::jsonb WHERE id = $1 RETURNING data`, [id, JSON.stringify(patch)]);
    if (res.rowCount === 0) throw new Error(`Not found: ${table} ${id}`);
    return res.rows[0].data as Row<T>;
  }

  /** Offboarding goes through prima.close_access: the API holds no other right to change accounts or grants. */
  async closeAccess(userId: Id, from: string, closed: { by: string; at: string; reason: string }): Promise<number> {
    const res = await this.client.query('SELECT prima.close_access($1, $2::date, $3::jsonb) AS n', [userId, from, JSON.stringify(closed)]);
    return Number(res.rows[0].n);
  }

  /** Expire and clear Arisha IT import reviews; the database function changes and audits each in one step. */
  async tidyItImportReviews(by: string): Promise<{ id: string; kind: string; outcome: 'expired' | 'purged' }[]> {
    const res = await this.client.query('SELECT review_id, review_kind, outcome FROM prima.tidy_it_import_reviews($1)', [by]);
    return res.rows.map((r: { review_id: string; review_kind: string; outcome: 'expired' | 'purged' }) => ({ id: r.review_id, kind: r.review_kind, outcome: r.outcome }));
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
    // leaving half its writes behind.
    await this.client.query('SAVEPOINT unit');
    try {
      const out = await fn(this);
      await this.client.query('RELEASE SAVEPOINT unit');
      return out;
    } catch (e) {
      await this.client.query('ROLLBACK TO SAVEPOINT unit');
      throw e;
    }
  }
}

