/**
 * First joint milestone (master plan v1.0, "First joint integration milestone"): a Finance staff member opens a Merdeka IT
 * purchase invoice check, asks Arisha for help, Prima sends a minimised payload to the approved AI gateway, checks the
 * returned draft deterministically against the PO, the person confirms, and Prima submits through the existing scoped
 * procurement action with a fixed request UUID and the packet version the person saw. Every step emits a work event.
 *
 * OFF by default. Synthetic data only. This records an invoice check; it never pays, posts or approves anything.
 */
import { AccessDenied } from './access';
import { BadRequest, NotFound } from './service';
import { ItProcurementService, procurementHash } from './it-procurement';
import type { ProcurementRow } from './it-procurement-types';
import type { Store } from './store';
import type { User } from './types';
import {
  ASSIST_CONTRACT_VERSION, assistMoveAllowed, outboundRequestBlockReason, parseGatewayResponse, type AssistGateway, type AssistJobState,
  type GatewayUsage, type MemoryWorkEventOutbox, type WorkEvent, type WorkEventResult,
} from './assist-contract';

export const ASSIST_EXECUTOR = 'svc:prima-assist';
export const ASSIST_POLICY_VERSION = 'assist-invoice-0.1';
const CONFIRM_WINDOW_MS = 15 * 60_000;
const BUDGET_CAP_MYR = 0.5;

export interface InvoiceFields { ref: string; invoiceOn: string; supplier: string; amount: number; qty: number[]; unitPrices: number[] }

export interface InvoiceCheckLine { index: number; description: string; poQty: number; poUnitPrice: number; qty: number; unitPrice: number; matches: boolean }
export interface InvoiceComparison {
  supplierMatches: boolean;
  totalMatches: boolean;
  /** amount equals the sum of qty x unit price on the invoice itself (deterministic arithmetic, never the model's). */
  arithmeticMatches: boolean;
  lines: InvoiceCheckLine[];
  allMatch: boolean;
}

export interface InvoiceAssistJob {
  id: string;
  taskId: string;
  purchaseId: string;
  companyId: string;
  actorId: string;
  state: AssistJobState;
  /** Packet version the draft was prepared against; submission is refused if it moved. */
  expectedVersion: number;
  /** Fixed procurement request UUID for the eventual submission, so a retry can never create a second check. */
  operationId: string;
  createdAt: string;
  draft: InvoiceFields | null;
  draftOrigin: 'gateway_unverified' | null;
  model: { provider: string; model: string; policyVersion: string; routingReason: string } | null;
  usage: GatewayUsage | null;
  confirmation: { hash: string; edited: boolean; at: string } | null;
  outcome: { terminal: 'committed' | 'rejected' | null; message: string | null; version: number | null } | null;
  reason: string | null;
}

export interface InvoiceAssistOptions {
  enabled: boolean;
  gateway: AssistGateway;
  outbox: MemoryWorkEventOutbox;
  clock: () => string;
  ids: () => string;
  training: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cents = (n: number) => Math.round(n * 100);
const money = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10_000_000 && v === Math.round(v * 100) / 100;

/** Strictly parse the gateway's draft. Anything unexpected is refused rather than repaired. */
export function parseInvoiceDraft(v: unknown, lines: number): InvoiceFields | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const d = v as Record<string, unknown>, keys = ['ref', 'invoiceOn', 'supplier', 'amount', 'qty', 'unitPrices'];
  if (Object.keys(d).length !== keys.length || keys.some(k => !(k in d))) return null;
  const str = (x: unknown, max: number) => typeof x === 'string' && x === x.trim() && x.length >= 3 && x.length <= max && !/[\u0000-\u001f\u007f]/.test(x);
  if (!str(d.ref, 120) || !str(d.supplier, 120) || typeof d.invoiceOn !== 'string' || !DATE.test(d.invoiceOn) || !money(d.amount)) return null;
  if (!Array.isArray(d.qty) || d.qty.length !== lines || d.qty.some(x => !Number.isInteger(x) || x < 0 || x > 1000)) return null;
  if (!Array.isArray(d.unitPrices) || d.unitPrices.length !== lines || d.unitPrices.some(x => !money(x))) return null;
  return { ref: d.ref as string, invoiceOn: d.invoiceOn, supplier: d.supplier as string, amount: d.amount as number, qty: [...d.qty as number[]], unitPrices: [...d.unitPrices as number[]] };
}

export function compareInvoice(row: ProcurementRow, f: InvoiceFields): InvoiceComparison {
  const po = row.packet!.po;
  const lines = po.items.map((it, i) => ({ index: i, description: it.description, poQty: it.qty, poUnitPrice: it.unitPrice, qty: f.qty[i], unitPrice: f.unitPrices[i],
    matches: f.qty[i] === it.qty && cents(f.unitPrices[i]) === cents(it.unitPrice) }));
  const supplierMatches = f.supplier === po.supplier, totalMatches = cents(f.amount) === cents(po.total);
  const arithmeticMatches = f.qty.reduce((s, q, i) => s + q * cents(f.unitPrices[i]), 0) === cents(f.amount);
  return { supplierMatches, totalMatches, arithmeticMatches, lines, allMatch: supplierMatches && totalMatches && arithmeticMatches && lines.every(l => l.matches) };
}

export const invoiceConfirmationHash = (job: Pick<InvoiceAssistJob, 'purchaseId' | 'expectedVersion' | 'operationId'>, f: InvoiceFields) =>
  procurementHash({ purchaseId: job.purchaseId, expectedVersion: job.expectedVersion, operationId: job.operationId, fields: f });

export class InvoiceAssistService {
  private jobs = new Map<string, InvoiceAssistJob>();
  private sequence = 0;
  private procurement: ItProcurementService;
  constructor(private store: Store, private o: InvoiceAssistOptions) { this.procurement = new ItProcurementService(store, o.clock); }

  private on() { if (!this.o.enabled) throw new BadRequest('Arisha invoice assistance is switched off.'); }

  private emit(job: InvoiceAssistJob, type: string, result: WorkEventResult, reason: string | null, detail: WorkEvent['detail'] = {}, executor = ASSIST_EXECUTOR) {
    const at = new Date(this.o.clock()).toISOString();
    const r = this.o.outbox.append({ event_id: this.o.ids(), schema_version: ASSIST_CONTRACT_VERSION, company_id: job.companyId, actor_id: job.actorId,
      executor_id: executor, device_id: null, task_id: job.taskId, source: 'prima', event_type: type, event_time: at, received_time: at,
      source_sequence: ++this.sequence, application: 'prima-secure', result, reason, evidence_ref: `assist-job:${job.id}`,
      policy_version: ASSIST_POLICY_VERSION, training: this.o.training, detail });
    if (!r.stored) throw new Error(`Work event refused: ${r.reason}`);
  }

  private move(job: InvoiceAssistJob, to: AssistJobState) {
    if (!assistMoveAllowed(job.state, to)) throw new BadRequest(`This assistance job cannot go from ${job.state} to ${to}.`);
    job.state = to;
  }

  private own(user: User, id: string) {
    const job = this.jobs.get(id);
    // Another person's job is reported as missing so its existence does not leak.
    if (!job || job.actorId !== user.id) throw new NotFound('Assistance job');
    return job;
  }

  private async row(user: User, purchaseId: string): Promise<ProcurementRow> {
    const board = await this.procurement.board(user);
    if (board.configuration !== 'ready') throw new BadRequest('Procurement recording needs setup first.');
    const row = board.rows.find(r => r.purchaseId === purchaseId);
    if (!row) throw new NotFound('Purchase');
    if (!row.canCheckInvoice || !row.packet) throw new AccessDenied('view', '(invoice check)');
    return row;
  }

  /** Read-only view for the staff screen. Never includes the private comparison material of other services. */
  async view(user: User, id: string): Promise<InvoiceAssistJob> {
    const job = this.own(user, id);
    // The board resolves the current stored actor, active status and Finance mandate.
    const row = await this.row(user, job.purchaseId);
    if (row.ownerId !== job.companyId) throw new AccessDenied('view', '(invoice company)');
    return structuredClone(job);
  }

  /** Step 1-4: open, request help, minimise, gate, call the gateway, validate. Leaves the job awaiting confirmation. */
  async prepare(user: User, input: { purchaseId: string; documentText: string }): Promise<{ job: InvoiceAssistJob; comparison: InvoiceComparison | null; confirmationHash: string | null }> {
    this.on();
    if (!input || typeof input.purchaseId !== 'string' || typeof input.documentText !== 'string') throw new BadRequest('Choose a purchase and give the invoice text.');
    const row = await this.row(user, input.purchaseId);
    const job: InvoiceAssistJob = { id: this.o.ids(), taskId: `it-procurement:${row.purchaseId}:invoice`, purchaseId: row.purchaseId, companyId: row.ownerId,
      actorId: user.id, state: 'planned', expectedVersion: row.version, operationId: this.o.ids(), createdAt: new Date(this.o.clock()).toISOString(),
      draft: null, draftOrigin: null, model: null, usage: null, confirmation: null, outcome: null, reason: null };
    this.jobs.set(job.id, job);
    this.emit(job, 'assist.requested', 'ok', null, { purchase_ref: row.ref, packet_version: row.version }, user.id);

    const po = row.packet!.po;
    const request = { contract_version: ASSIST_CONTRACT_VERSION, request_id: this.o.ids(), task_id: job.taskId, company_id: job.companyId, actor_id: user.id,
      task_class: 'extraction' as const, data_class: 'internal' as const, output_schema: 'prima.invoice_check_draft.v1' as const,
      payload: {
        instructions: 'Extract the supplier invoice reference, invoice date (YYYY-MM-DD), supplier name, total amount in MYR, and quantity and unit price for each PO line index. Return only the fields of prima.invoice_check_draft.v1. Unknown values must make you refuse, not guess.',
        // Minimum reference: line descriptions and supplier only. No people, evidence, approvals, prices or totals, so the
        // model cannot simply copy the expected answer.
        reference: { poRef: po.ref, supplier: po.supplier, currency: po.currency, lines: po.items.map(i => ({ index: i.index, description: i.description })) },
        document_text: input.documentText,
      },
      budget_cap_myr: BUDGET_CAP_MYR, deadline_ms: 15_000, training: this.o.training };
    const blocked = outboundRequestBlockReason(request.payload);
    if (blocked) {
      job.reason = `Not sent to AI: the text contains ${blocked}. Enter the invoice by hand.`;
      this.move(job, 'failed');
      this.emit(job, 'assist.outbound_blocked', 'denied', blocked);
      return { job: structuredClone(job), comparison: null, confirmationHash: null };
    }
    let raw: unknown;
    try { raw = await this.o.gateway.prepare(request); }
    catch { raw = { status: 'failed' as const, request_id: request.request_id, reason: 'Gateway unavailable.', usage: null }; }
    const res = parseGatewayResponse(raw);
    if (!res) {
      job.reason = 'The gateway response or usage accounting was invalid; the draft was discarded.';
      this.move(job, 'failed');
      this.emit(job, 'assist.gateway_decision', 'failed', 'invalid response or usage', {}, 'svc:arisha-gateway');
      return { job: structuredClone(job), comparison: null, confirmationHash: null };
    }
    job.usage = res.usage;
    const cost = { cost_myr: res.usage?.cost_myr ?? null, input_tokens: res.usage?.input_tokens ?? null, output_tokens: res.usage?.output_tokens ?? null };
    if (res.request_id !== request.request_id || res.status !== 'drafted') {
      job.reason = res.status === 'denied' ? `The AI gateway declined: ${res.reason}` : 'Arisha could not prepare a draft. Enter the invoice by hand.';
      this.move(job, 'failed');
      this.emit(job, 'assist.gateway_decision', res.status === 'denied' ? 'denied' : 'failed', res.status === 'drafted' ? 'request id mismatch' : res.reason, cost, 'svc:arisha-gateway');
      return { job: structuredClone(job), comparison: null, confirmationHash: null };
    }
    if (res.usage.cost_myr > BUDGET_CAP_MYR) {
      job.reason = 'The AI gateway reported spending above the cap for this task; the draft was discarded.';
      this.move(job, 'failed');
      this.emit(job, 'assist.gateway_decision', 'failed', 'budget cap exceeded', cost, 'svc:arisha-gateway');
      return { job: structuredClone(job), comparison: null, confirmationHash: null };
    }
    job.model = { provider: res.provider, model: res.model, policyVersion: res.policy_version, routingReason: res.routing_reason };
    this.emit(job, 'assist.gateway_decision', 'ok', null, { ...cost, provider: res.provider, model: res.model }, 'svc:arisha-gateway');
    const draft = parseInvoiceDraft(res.draft, po.items.length);
    if (!draft) {
      job.reason = 'The draft did not match the expected fields, so it was discarded. Enter the invoice by hand.';
      this.move(job, 'failed');
      this.emit(job, 'assist.draft_rejected', 'failed', 'schema');
      return { job: structuredClone(job), comparison: null, confirmationHash: null };
    }
    job.draft = draft; job.draftOrigin = 'gateway_unverified';
    this.move(job, 'awaiting_approval');
    const comparison = compareInvoice(row, draft);
    this.emit(job, 'assist.draft_ready', 'ok', null, { all_match: comparison.allMatch, lines: comparison.lines.length });
    return { job: structuredClone(job), comparison, confirmationHash: invoiceConfirmationHash(job, draft) };
  }

  /** Re-run the deterministic checks for fields the person has corrected on screen, and give the hash to confirm. */
  async check(user: User, id: string, fields: unknown) {
    this.on();
    const job = this.own(user, id);
    if (job.state !== 'awaiting_approval') throw new BadRequest('This draft is no longer waiting for confirmation.');
    const row = await this.row(user, job.purchaseId);
    const f = parseInvoiceDraft(fields, row.packet!.po.items.length);
    if (!f) throw new BadRequest('Fill every invoice field correctly.');
    return { comparison: compareInvoice(row, f), confirmationHash: invoiceConfirmationHash(job, f) };
  }

  /** Step 5-6: the person confirms the exact values they saw; Prima submits through the scoped action. */
  async confirm(user: User, id: string, input: { fields: unknown; confirmationHash: string; evidence: string }) {
    this.on();
    const job = this.own(user, id);
    if (job.state !== 'awaiting_approval') throw new BadRequest('This draft is no longer waiting for confirmation.');
    if (Date.parse(this.o.clock()) - Date.parse(job.createdAt) > CONFIRM_WINDOW_MS) {
      this.move(job, 'cancelled'); job.reason = 'The draft expired. Ask Arisha again.';
      this.emit(job, 'assist.cancelled', 'ok', 'expired');
      throw new BadRequest(job.reason);
    }
    const row = await this.row(user, job.purchaseId);
    const f = parseInvoiceDraft(input?.fields, row.packet!.po.items.length);
    if (!f || input.confirmationHash !== invoiceConfirmationHash(job, f)) throw new BadRequest('Confirm the exact values shown after the latest check.');
    if (row.version !== job.expectedVersion) {
      this.move(job, 'cancelled'); job.reason = 'The purchase changed after the draft was prepared. Ask Arisha again.';
      this.emit(job, 'assist.cancelled', 'ok', 'packet version moved');
      throw new BadRequest(job.reason);
    }
    const edited = procurementHash(f) !== procurementHash(job.draft);
    job.confirmation = { hash: input.confirmationHash, edited, at: new Date(this.o.clock()).toISOString() };
    this.emit(job, 'assist.confirmed', 'ok', null, { edited }, user.id);
    this.move(job, 'running');
    try {
      const r = await this.procurement.save(user, 'invoice', { requestId: job.operationId, purchaseId: job.purchaseId, expectedVersion: job.expectedVersion, ...f, evidence: input.evidence });
      return this.finish(job, r.terminal, r.message, r.version);
    } catch (e) {
      if (e instanceof BadRequest || e instanceof AccessDenied || e instanceof NotFound) return this.finish(job, 'rejected', e.message, null);
      // The write may or may not have happened. Never retry blindly: reconcile by the fixed request UUID.
      this.move(job, 'outcome_unknown'); job.reason = 'Prima could not confirm whether the check was saved. Use Reconcile before trying again.';
      this.emit(job, 'assist.submitted', 'unknown', 'no receipt');
      return structuredClone(job);
    }
  }

  /** Resolve an uncertain submission by asking the procurement service for its own receipt of the fixed request UUID. */
  async reconcile(user: User, id: string) {
    this.on();
    const job = this.own(user, id);
    if (job.state !== 'outcome_unknown') throw new BadRequest('Only an uncertain submission needs reconciling.');
    const r = await this.procurement.receipt(user, { requestId: job.operationId, kind: 'invoice' }) as { found: boolean; terminal?: 'committed' | 'rejected'; message?: string | null; version?: number | null };
    if (!r.found) { this.emit(job, 'assist.reconciled', 'unknown', 'no receipt yet'); return structuredClone(job); }
    return this.finish(job, r.terminal!, r.message ?? null, r.version ?? null);
  }

  cancel(user: User, id: string) {
    const job = this.own(user, id);
    this.move(job, 'cancelled'); job.reason = 'Cancelled by the person.';
    this.emit(job, 'assist.cancelled', 'ok', 'by person', {}, user.id);
    return structuredClone(job);
  }

  private finish(job: InvoiceAssistJob, terminal: 'committed' | 'rejected', message: string | null, version: number | null) {
    this.move(job, terminal === 'committed' ? 'succeeded' : 'failed');
    job.outcome = { terminal, message, version };
    this.emit(job, 'assist.submitted', terminal === 'committed' ? 'ok' : 'failed', message, { packet_version: version, cost_myr: job.usage?.cost_myr ?? 0 });
    return structuredClone(job);
  }
}
