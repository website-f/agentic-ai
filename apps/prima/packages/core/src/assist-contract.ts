/**
 * Arisha AI Assistant: Prima-side contracts for the first joint milestone (master plan v1.0, 6 Nov 2026, sections 5-7).
 *
 * Draft contract, synthetic data only, OFF by default. Prima owns task/approval state; the AI gateway (Arisha/Codex side)
 * only receives a minimised payload and returns an unverified draft plus routing and usage evidence. Nothing here sends
 * money, posts accounting entries or grants authority to a model.
 */
import { sha256Hex } from './audit';
import { procurementSerialize } from './it-procurement';

export const ASSIST_CONTRACT_VERSION = '0.1.0';

// ---------------------------------------------------------------------------------------------------------------------
// Work-event envelope (plan section 6, "Minimum event contract")
// ---------------------------------------------------------------------------------------------------------------------

export type WorkEventSource = 'prima' | 'gateway' | 'office' | 'endpoint' | 'connector' | 'staff';
export type WorkEventResult = 'ok' | 'denied' | 'failed' | 'unknown';

export interface WorkEvent {
  event_id: string;
  schema_version: string;
  company_id: string | null;
  /** The person on whose behalf the work happens. */
  actor_id: string;
  /** The identity that actually executed the step (a person, or a service identity such as `svc:prima-assist`). */
  executor_id: string;
  device_id: string | null;
  task_id: string | null;
  source: WorkEventSource;
  event_type: string;
  event_time: string;
  received_time: string;
  /** Monotonic per source stream; the receiver uses it to detect gaps. */
  source_sequence: number;
  application: string;
  result: WorkEventResult;
  reason: string | null;
  evidence_ref: string | null;
  policy_version: string | null;
  training: boolean;
  /** Small, non-sensitive structured detail (ids, counts, costs). Never payload text. */
  detail: Record<string, string | number | boolean | null>;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SAFE_ID = /^[A-Za-z0-9:._-]{1,120}$/;
const EVENT_KEYS = ['event_id', 'schema_version', 'company_id', 'actor_id', 'executor_id', 'device_id', 'task_id', 'source',
  'event_type', 'event_time', 'received_time', 'source_sequence', 'application', 'result', 'reason', 'evidence_ref',
  'policy_version', 'training', 'detail'];

/** Strict shape check. Returns the problems; an empty list means the event is acceptable. */
export function workEventProblems(e: unknown): string[] {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['Event must be an object.'];
  const v = e as Record<string, unknown>, p: string[] = [];
  const keys = Object.keys(v);
  if (keys.length !== EVENT_KEYS.length || EVENT_KEYS.some(k => !(k in v))) p.push('Send exactly the event contract fields.');
  const id = (k: string, nullable = false) => { const x = v[k]; if (!(nullable && x === null) && (typeof x !== 'string' || !SAFE_ID.test(x))) p.push(`${k} is invalid.`); };
  id('event_id'); id('actor_id'); id('executor_id'); id('company_id', true); id('device_id', true); id('task_id', true);
  if (v.schema_version !== ASSIST_CONTRACT_VERSION) p.push('schema_version is not supported.');
  if (!['prima', 'gateway', 'office', 'endpoint', 'connector', 'staff'].includes(v.source as string)) p.push('source is invalid.');
  if (typeof v.event_type !== 'string' || !/^[a-z]+(?:\.[a-z_]+){1,3}$/.test(v.event_type)) p.push('event_type is invalid.');
  for (const k of ['event_time', 'received_time']) if (typeof v[k] !== 'string' || !ISO.test(v[k] as string) || Number.isNaN(Date.parse(v[k] as string))) p.push(`${k} must be UTC ISO time.`);
  if (!Number.isInteger(v.source_sequence) || (v.source_sequence as number) < 0) p.push('source_sequence is invalid.');
  if (typeof v.application !== 'string' || !SAFE_ID.test(v.application)) p.push('application is invalid.');
  if (!['ok', 'denied', 'failed', 'unknown'].includes(v.result as string)) p.push('result is invalid.');
  if (v.reason !== null && (typeof v.reason !== 'string' || v.reason.length > 300)) p.push('reason is invalid.');
  id('evidence_ref', true); id('policy_version', true);
  if (typeof v.training !== 'boolean') p.push('training must be true or false.');
  const d = v.detail;
  if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).length > 20 ||
      Object.values(d).some(x => x !== null && !['string', 'number', 'boolean'].includes(typeof x) || (typeof x === 'string' && x.length > 200)))
    p.push('detail must be a small flat object.');
  return p;
}

export const workEventHash = (e: WorkEvent) => sha256Hex(procurementSerialize(e));

export type OutboxAppend = { stored: true; replayed: boolean } | { stored: false; reason: string };

/**
 * Append-only, de-duplicating event outbox (plan section 20: "one stored result per ID").
 * The in-memory version backs tests and the demo; a PostgreSQL table with the same semantics is follow-up work.
 */
export class MemoryWorkEventOutbox {
  private rows = new Map<string, { hash: string; event: WorkEvent }>();
  private order: string[] = [];
  append(e: WorkEvent): OutboxAppend {
    const problems = workEventProblems(e);
    if (problems.length) return { stored: false, reason: problems.join(' ') };
    const hash = workEventHash(e), old = this.rows.get(e.event_id);
    if (old) return old.hash === hash ? { stored: true, replayed: true } : { stored: false, reason: 'event_id already belongs to a different event.' };
    this.rows.set(e.event_id, { hash, event: structuredClone(e) });
    this.order.push(e.event_id);
    return { stored: true, replayed: false };
  }
  list(filter: { task_id?: string } = {}): WorkEvent[] {
    return this.order.map(id => this.rows.get(id)!.event).filter(e => !filter.task_id || e.task_id === filter.task_id).map(e => structuredClone(e));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// AI gateway port (implemented by the Arisha/Codex side; plan sections 3 and 5)
// ---------------------------------------------------------------------------------------------------------------------

export type DataClass = 'public' | 'internal' | 'confidential' | 'restricted';
export type TaskClass = 'extraction' | 'drafting' | 'research' | 'review' | 'tool_planning' | 'local_only';

export interface GatewayRequest {
  contract_version: string;
  /** Unique per attempt; the gateway must treat a repeated id as the same request (idempotent). */
  request_id: string;
  task_id: string;
  company_id: string;
  actor_id: string;
  task_class: TaskClass;
  data_class: DataClass;
  /** JSON Schema-like name of the output Prima will accept; the gateway must not return anything else. */
  output_schema: 'prima.invoice_check_draft.v1';
  /** Minimised content already checked by Prima's outbound gate. The gateway applies its own gate too. */
  payload: { instructions: string; reference: Record<string, unknown>; document_text: string };
  /** Hard ceiling in MYR for this request, including retries and fallback. */
  budget_cap_myr: number;
  deadline_ms: number;
  training: boolean;
}

export interface GatewayUsage { input_tokens: number; output_tokens: number; cached_tokens: number; cost_myr: number; price_version: string }

export type GatewayResponse =
  | { status: 'drafted'; request_id: string; provider: string; model: string; policy_version: string; routing_reason: string; usage: GatewayUsage; draft: unknown }
  | { status: 'denied'; request_id: string; policy_version: string; reason: string; usage: GatewayUsage | null }
  | { status: 'failed'; request_id: string; reason: string; usage: GatewayUsage | null };

/** Treat gateway transport data as untrusted, including accounting and routing evidence. */
export function parseGatewayResponse(value: unknown): GatewayResponse | null {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v: unknown, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
  if (!object(value)) return null;
  const v = value;
  const fields = v.status === 'drafted'
    ? ['status', 'request_id', 'provider', 'model', 'policy_version', 'routing_reason', 'usage', 'draft']
    : v.status === 'denied' ? ['status', 'request_id', 'policy_version', 'reason', 'usage']
    : v.status === 'failed' ? ['status', 'request_id', 'reason', 'usage'] : null;
  if (!fields || Object.keys(v).length !== fields.length || fields.some(k => !Object.hasOwn(v, k)) || !text(v.request_id, 120)) return null;
  if (v.usage !== null) {
    const u = v.usage, keys = ['input_tokens', 'output_tokens', 'cached_tokens', 'cost_myr', 'price_version'];
    if (!object(u) || Object.keys(u).length !== keys.length || keys.some(k => !Object.hasOwn(u, k))) return null;
    if (['input_tokens', 'output_tokens', 'cached_tokens'].some(k => !Number.isSafeInteger(u[k]) || (u[k] as number) < 0) ||
        typeof u.cost_myr !== 'number' || !Number.isFinite(u.cost_myr) || u.cost_myr < 0 || !text(u.price_version, 120)) return null;
  }
  if (v.status === 'drafted') {
    if (v.usage === null || ['provider', 'model', 'policy_version', 'routing_reason'].some(k => !text(v[k]))) return null;
  } else if (!text(v.reason, 300) || (v.status === 'denied' && !text(v.policy_version))) return null;
  return structuredClone(v) as GatewayResponse;
}

/** Inspect every string in the final minimized payload, before transport serialization. */
export function outboundRequestBlockReason(value: unknown): string | null {
  if (typeof value === 'string') return outboundBlockReason(value);
  if (value === null || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'invalid number';
  if (Array.isArray(value)) {
    for (const entry of value) { const reason = outboundRequestBlockReason(entry); if (reason) return reason; }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const reason = outboundBlockReason(key) || outboundRequestBlockReason(entry);
      if (reason) return reason;
    }
    return null;
  }
  return 'invalid request data';
}

export interface AssistGateway { prepare(request: GatewayRequest, signal?: AbortSignal): Promise<GatewayResponse> }

/** A deterministic stand-in for tests and the demo. It never calls a provider. */
export class SyntheticGateway implements AssistGateway {
  readonly calls: GatewayRequest[] = [];
  constructor(private answer: (r: GatewayRequest) => GatewayResponse) {}
  async prepare(r: GatewayRequest) { this.calls.push(structuredClone(r)); return this.answer(r); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Prima outbound gate (Prima applies this before anything reaches the gateway; fail closed)
// ---------------------------------------------------------------------------------------------------------------------

const RESTRICTED: [RegExp, string][] = [
  [/(?:password|passcode|secret|access[_ -]?token|api[_ -]?key|pin)\s*[:=]/i, 'credentials'],
  [/bearer\s+\S+/i, 'credentials'],
  [/\b\d{6}-\d{2}-\d{4}\b/, 'identity card number'],
  [/\b\d{10,19}\b/, 'long account or card number'],
  [/-----BEGIN [A-Z ]+-----/, 'key material'],
];

/** Returns the reason the text must not leave Prima, or null when it may go to an approved gateway. */
export function outboundBlockReason(text: string): string | null {
  if (typeof text !== 'string') return 'not text';
  if (text.length > 8000) return 'too long to inspect';
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return 'hidden control characters';
  for (const [re, label] of RESTRICTED) if (re.test(text)) return label;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Assist job lifecycle (plan section 7, "Execution safety")
// ---------------------------------------------------------------------------------------------------------------------

export type AssistJobState = 'planned' | 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown';

const MOVES: Record<AssistJobState, AssistJobState[]> = {
  planned: ['awaiting_approval', 'failed', 'cancelled'],
  awaiting_approval: ['running', 'cancelled', 'failed'],
  running: ['succeeded', 'failed', 'outcome_unknown'],
  outcome_unknown: ['succeeded', 'failed'],
  succeeded: [], failed: [], cancelled: [],
};
export const assistMoveAllowed = (from: AssistJobState, to: AssistJobState) => MOVES[from].includes(to);
