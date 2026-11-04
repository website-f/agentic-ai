import { AccessDenied, activeGrants, visibleCompanyIds } from './access';
import { arishaMayReadContext, type ArishaContextKind } from './arisha-policy';
import type { Store } from './store';
import type { User } from './types';
import { addDays, dateOf } from './time';

export interface ArishaContextMetric {
  code: string;
  label: string;
  count: number;
  source: { table: 'sites' | 'posts' | 'checkpoints' | 'licences' | 'finStatus'; refs: string[]; sourceUpdatedAt: null };
}
export interface ArishaContextSummary {
  context: ArishaContextKind;
  observedAt: string;
  scope: { requestedCompanyId: string | null; coveredCompanyIds: string[]; limitations: string[] };
  metrics: ArishaContextMetric[];
  warnings: string[];
}

const MAX_COMPANIES = 50;
const MAX_REFS = 5;
const safeId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(id);
function realDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Typed aggregate-only retrieval. Never returns raw records, names, notes or sensitive fields. */
export class ArishaContextService {
  constructor(private store: Store, private clock: () => string) {}

  async summary(user: User, context: string, requestedCompanyId: string | null = null): Promise<ArishaContextSummary> {
    if (!arishaMayReadContext(user, context)) throw new AccessDenied('view', '(Arisha context not permitted)');
    if (requestedCompanyId !== null && !safeId(requestedCompanyId)) throw new AccessDenied('view', '(Arisha company not permitted)');
    const observedAt = this.clock();
    const today = dateOf(observedAt);
    const grants = await this.store.list('grants');
    // Explicit grant intersection prevents a future user-role fallback from broadening this tool.
    const current = new Set(activeGrants(user, grants, today).map(g => g.companyId));
    const visible = visibleCompanyIds(user, grants, today).filter(id => current.has(id) && safeId(id));
    const companies = await this.store.list('companies', { id: visible });
    const available = [...new Set(companies.filter(c => visible.includes(c.id)).map(c => c.id))].sort();
    if (requestedCompanyId !== null && !available.includes(requestedCompanyId)) throw new AccessDenied('view', '(Arisha company not permitted)');
    const wanted = requestedCompanyId === null ? available : [requestedCompanyId];
    const coveredCompanyIds = wanted.slice(0, MAX_COMPANIES);
    const scopeIds = new Set(coveredCompanyIds);
    const warnings = [
      'Coverage and data freshness are unknown. Counts describe recorded data only, not organization completeness, compliance certification or runtime health.',
      'observedAt is retrieval time. sourceUpdatedAt is unknown, not a claim that source records were updated now.',
    ];
    if (!coveredCompanyIds.length) warnings.push('No currently granted company records are available. Zero counts do not mean that there are no problems.');
    if (wanted.length > MAX_COMPANIES) warnings.push('Scope truncated to the first 50 granted company IDs. Request a specific company for the remainder.');
    if (visible.some(id => !available.includes(id))) warnings.push('Some granted company records are unavailable; they are excluded from coverage.');
    const metrics: ArishaContextMetric[] = [];
    const metric = (code: string, label: string, count: number, table: ArishaContextMetric['source']['table'], refs: string[]) => {
      metrics.push({ code, label, count, source: { table, refs: [...new Set(refs.filter(safeId))].sort().slice(0, MAX_REFS), sourceUpdatedAt: null } });
    };
    if (context === 'operations') {
      for (const [table, label] of [['sites', 'Recorded sites'], ['posts', 'Recorded posts'], ['checkpoints', 'Recorded patrol checkpoints']] as const) {
        const rows = (await this.store.list(table, { companyId: coveredCompanyIds })).filter(r => scopeIds.has(r.companyId));
        metric(`operations.${table}.recorded`, label, rows.length, table, rows.map(r => r.id));
        if (rows.length === 0) warnings.push(`No ${table} records were found in this scope; this is missing evidence, not confirmation of operational readiness.`);
      }
    } else if (context === 'compliance') {
      const rows = (await this.store.list('licences', { companyId: coveredCompanyIds })).filter(r => scopeIds.has(r.companyId));
      const expired = rows.filter(r => realDate(r.expiresOn) && r.expiresOn < today);
      const due = rows.filter(r => realDate(r.expiresOn) && r.expiresOn >= today && r.expiresOn <= addDays(today, 30));
      const unknown = rows.filter(r => !realDate(r.expiresOn));
      metric('compliance.licences.recorded', 'Recorded company licences or registrations', rows.length, 'licences', rows.map(r => r.id));
      metric('compliance.licences.expired', 'Recorded expiry dates before today', expired.length, 'licences', expired.map(r => r.id));
      metric('compliance.licences.due30', 'Recorded expiry dates from today through 30 days', due.length, 'licences', due.map(r => r.id));
      metric('compliance.licences.unknownExpiry', 'Missing or invalid recorded expiry dates', unknown.length, 'licences', unknown.map(r => r.id));
      if (coveredCompanyIds.some(id => !rows.some(r => r.companyId === id))) warnings.push('Some covered companies have no recorded licences; completeness is unknown.');
    } else {
      const rows = (await this.store.list('finStatus', { companyId: coveredCompanyIds })).filter(r => scopeIds.has(r.companyId));
      const papers = rows.flatMap(r => [...(Array.isArray(r.audit) ? r.audit : []), ...(Array.isArray(r.tax) ? r.tax : [])].map(p => ({ status: typeof p?.status === 'string' ? p.status : null, sourceId: r.id })));
      metric('finance.papers.recorded', 'Recorded auditor and tax papers', papers.length, 'finStatus', papers.map(p => p.sourceId));
      for (const status of ['todo', 'prepared', 'reviewed', 'sent'] as const) {
        const these = papers.filter(p => p.status === status);
        metric(`finance.papers.${status}`, `Recorded papers marked ${status}`, these.length, 'finStatus', these.map(p => p.sourceId));
      }
      const unknown = papers.filter(p => p.status === null || !['todo', 'prepared', 'reviewed', 'sent'].includes(p.status));
      metric('finance.papers.unknownStatus', 'Papers with unknown recorded status', unknown.length, 'finStatus', unknown.map(p => p.sourceId));
      if (!papers.length || coveredCompanyIds.some(id => !rows.some(r => r.companyId === id))) warnings.push('Finance paper coverage is incomplete or unknown; zero counts do not establish that accounts are complete or payments have been made.');
    }
    return {
      context, observedAt,
      scope: {
        requestedCompanyId, coveredCompanyIds,
        limitations: ['Only current dated grants and existing company records are included; no implicit organization-wide bypass.', 'At most 50 companies and five sample source record IDs per metric. References are table/record IDs, not URLs.', 'No employee, payroll, bank, medical, whistleblowing, document contents or operational approvals are retrieved into this summary.'],
      },
      metrics, warnings,
    };
  }
}
