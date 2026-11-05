// Teams approvals read job (Fauzan, 1 Nov 2026: "5. Yes"). Track A of docs/TEAMS_APPROVALS_INTEGRATION.md.
// Reads the protected SharePoint results list (and the request row each result names) through Microsoft Graph v1.0,
// read-only, and hands each result to Prima's checks (packages/core/src/finance-teams.ts). Off unless
// TEAMS_APPROVALS_READ=true. Nothing here is scheduled, and no tenant app, grant, list or flow exists yet: the tenant
// admin and the Finance Director set those up first (gated), then Arisha main wires the schedule and the token.
import type { FinTeamsRequestItem, FinTeamsResultItem } from '@prima/core';

/** A Graph v1.0 listItem with its fields expanded. */
export interface GraphListItem {
  id: string;
  eTag?: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  createdBy?: { user?: { id?: string } };
  lastModifiedBy?: { user?: { id?: string } };
  fields?: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return Array.isArray(v) ? (v as T) : fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** Maps one results-list item and its version count to what Prima checks. Missing fields stay empty and fail the checks. */
export function mapGraphResult(item: GraphListItem, versionCount: number | null): FinTeamsResultItem {
  const f = item.fields ?? {};
  const responses = json<Record<string, unknown>[]>(f.Responses, []).map((r) => ({
    objectId: str(r.objectId),
    upn: str(r.upn),
    response: str(r.response),
    comment: str(r.comment),
    responseDate: str(r.responseDate) || null,
  }));
  return {
    itemId: item.id,
    etag: item.eTag ?? '',
    createdById: item.createdBy?.user?.id ?? '',
    lastModifiedById: item.lastModifiedBy?.user?.id ?? '',
    createdAt: item.createdDateTime,
    modifiedAt: item.lastModifiedDateTime,
    versionCount,
    approvalId: str(f.ApprovalId),
    outcome: str(f.Outcome),
    completionDate: str(f.CompletionDate) || null,
    requestItemId: str(f.RequestItemId),
    requestVersion: str(f.RequestVersion),
    fingerprint: str(f.Fingerprint),
    paymentId: str(f.PrimaPaymentId),
    companyId: str(f.CompanyId),
    assignedTo: json<unknown[]>(f.AssignedTo, []).map(str).filter(Boolean),
    responses,
  };
}

/** Maps the request row a result names. Prima never takes an outcome from it. */
export function mapGraphRequest(item: GraphListItem, version: string): FinTeamsRequestItem {
  const f = item.fields ?? {};
  return {
    itemId: item.id,
    version,
    createdById: item.createdBy?.user?.id ?? '',
    modifiedAt: item.lastModifiedDateTime,
    paymentId: str(f.PrimaPaymentId),
    companyId: str(f.CompanyId),
    fingerprint: str(f.Fingerprint),
  };
}

export interface TeamsReadDeps {
  /** GET a Graph v1.0 path with the app's read-only token; returns parsed JSON. */
  graphGet: (path: string) => Promise<unknown>;
  /** The site and list IDs from configuration (never from the lists themselves). */
  siteId: string;
  resultsListId: string;
  requestsListId: string;
  /** Prima's checks and save (PrimaService.financeTeams.record). */
  record: (companyId: string, result: FinTeamsResultItem, request: FinTeamsRequestItem | null) => Promise<{ verdict: string }>;
}

/** One pass over the results list. Every failure is recorded by Prima as not approved, never skipped silently. */
export async function readTeamsApprovals(d: TeamsReadDeps): Promise<{ read: number; verdicts: Record<string, number> }> {
  if (process.env.TEAMS_APPROVALS_READ !== 'true') return { read: 0, verdicts: {} };
  const base = `/sites/${encodeURIComponent(d.siteId)}/lists`;
  const page = (await d.graphGet(`${base}/${encodeURIComponent(d.resultsListId)}/items?expand=fields`)) as { value?: GraphListItem[] };
  const verdicts: Record<string, number> = {};
  let read = 0;
  for (const item of page.value ?? []) {
    let versions: number | null = null;
    try {
      const v = (await d.graphGet(`${base}/${encodeURIComponent(d.resultsListId)}/items/${encodeURIComponent(item.id)}/versions`)) as { value?: unknown[] };
      versions = Array.isArray(v.value) ? v.value.length : null;
    } catch {
      versions = null;
    }
    const result = mapGraphResult(item, versions);
    let request: FinTeamsRequestItem | null = null;
    if (result.requestItemId)
      try {
        const q = (await d.graphGet(`${base}/${encodeURIComponent(d.requestsListId)}/items/${encodeURIComponent(result.requestItemId)}?expand=fields`)) as GraphListItem;
        // SharePoint's own version label of the row (not a value staff type).
        request = mapGraphRequest(q, String((q.fields ?? {})._UIVersionString ?? ''));
      } catch {
        request = null;
      }
    if (!result.companyId || !result.paymentId) continue;
    try {
      const out = await d.record(result.companyId, result, request);
      verdicts[out.verdict] = (verdicts[out.verdict] ?? 0) + 1;
      read += 1;
    } catch {
      verdicts.error = (verdicts.error ?? 0) + 1;
    }
  }
  return { read, verdicts };
}
