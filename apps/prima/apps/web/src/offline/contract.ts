/** PR46 138e3acc wire-shape preparation ONLY. No HTTP, storage, cryptographic lease or runtime wiring. */
import { OFFLINE_ACCESS_MS, permittedPayload, type Operation, type Owner } from './outbox';
const uuid4 = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const exact = (x: Record<string, unknown>, keys: string[]) => Object.keys(x).sort().join('|') === [...keys].sort().join('|');
function check(ok: unknown): asserts ok { if (!ok) throw Error('Unsupported offline contract; keep runtime disabled'); }
export type ServerLease = Readonly<{ id: string; userId: string; deviceLabel: string; issuedAt: string; expiresAt: string }>;
/** Shape checking is NOT verification of server origin/device trust or a secure offline clock. */
export function decodeServerLease(raw: unknown, owner: Owner): ServerLease {
  check(record(raw) && exact(raw, ['id', 'userId', 'deviceLabel', 'issuedAt', 'expiresAt']));
  check(uuid4(raw.id) && raw.userId === owner.userId && typeof raw.deviceLabel === 'string' && raw.deviceLabel.length >= 3 && raw.deviceLabel.length <= 80);
  check(typeof raw.issuedAt === 'string' && typeof raw.expiresAt === 'string');
  const issued = Date.parse(raw.issuedAt), expires = Date.parse(raw.expiresAt);
  check(Number.isFinite(issued) && Number.isFinite(expires) && expires - issued === OFFLINE_ACCESS_MS);
  return Object.freeze({ id: raw.id, userId: owner.userId, deviceLabel: raw.deviceLabel, issuedAt: raw.issuedAt, expiresAt: raw.expiresAt });
}
export type BoundSubmission = Readonly<{ owner: Owner; leaseId: string; operationId: string; createdAt: string; body: string }>;
/** Create once at queue admission with the original lease. Do not bind old queued work to a renewed lease. */
export function bindSubmission(operation: Operation, originalLease: ServerLease, createdAt: string): BoundSubmission {
  check(uuid4(operation.id) && uuid4(originalLease.id) && originalLease.userId === operation.owner.userId && permittedPayload(operation.payload));
  const when = Date.parse(createdAt); check(Number.isFinite(when) && when >= Date.parse(originalLease.issuedAt) && when < Date.parse(originalLease.expiresAt));
  const p = operation.payload;
  const payload = p.kind === 'helpRequest' ? { ...p.fields } : { targetId: p.targetId, baseVersion: p.baseVersion, note: p.fields.note };
  const body = JSON.stringify({ leaseId: originalLease.id, ops: [{ opId: operation.id, kind: p.kind, createdAt, payload }] });
  return Object.freeze({ owner: Object.freeze({ ...operation.owner }), leaseId: originalLease.id, operationId: operation.id, createdAt, body });
}
/** Reconciliation never sends source/payload or infers authoritative absence from an empty receipt list. */
export function receiptLookup(bound: BoundSubmission, owner: Owner) {
  check(owner.userId === bound.owner.userId && owner.tenantId === bound.owner.tenantId && uuid4(bound.operationId));
  return `/api/offline/ops?opIds=${bound.operationId}`;
}
const reasons = ['duplicate_suspected', 'job_changed', 'not_allowed', 'not_found', 'bad_payload', 'lease_expired', 'lease_not_valid', 'op_id_reused', 'try_again'];
export function decodeOfflineReceipt(raw: unknown, operationId: string) {
  check(record(raw) && exact(raw, ['opId', 'status', 'reason', 'resultId', 'replayed', 'serverAt']));
  check(uuid4(raw.opId) && raw.opId === operationId && ['applied', 'needs_review', 'rejected', 'discarded', 'conflict', 'error'].includes(String(raw.status)));
  check(raw.reason === null || (typeof raw.reason === 'string' && reasons.includes(raw.reason)));
  check(raw.resultId === null || (typeof raw.resultId === 'string' && raw.resultId.length > 0 && raw.resultId.length <= 120));
  check(typeof raw.replayed === 'boolean' && typeof raw.serverAt === 'string' && Number.isFinite(Date.parse(raw.serverAt)));
  return { opId: raw.opId, status: String(raw.status), reason: raw.reason as string | null, resultId: raw.resultId as string | null, replayed: raw.replayed, serverAt: raw.serverAt };
}
