// Finance side of the item register (P85; Fitri's paper sections 5 to 7). Pure functions only: what stops a document,
// the export files Finance imports by hand into SQL Account, reading an SQL export back, and the reconciliation.
//
// Nothing here posts to SQL Account. The outbox is export only until the connection is proved in both books (Phase 0,
// decisions D01, D05, D06). A document is acknowledged only when Finance types the SQL document number shown by SQL
// Account and attaches the evidence; it is reconciled only when that number is found in an SQL document listing.

import { sha256Hex } from './audit';
import {
  BOOK_UNSET,
  type BaseUom,
  type ItemEvent,
  type ItemMovement,
  type ItemSku,
  type ItemSqlBook,
  type ItemSqlSnapshot,
  type ItemSyncJob,
  type PhysicalItem,
  type Sen,
  type SyncBlocker,
  type SyncStatus,
} from './items';
import type { Id, IsoDate, IsoDateTime } from './types';

/** Allowed status changes of an outbox job (paper section 7). 'reconciled' comes only from the reconciliation match. */
export const SYNC_NEXT: Record<SyncStatus, SyncStatus[]> = {
  not_ready: ['ready', 'manual_review'],
  ready: ['not_ready', 'queued', 'manual_review'],
  queued: ['sent', 'manual_review'],
  sent: ['acknowledged', 'rejected', 'outcome_unknown', 'manual_review'],
  acknowledged: ['reconciled'],
  reconciled: [],
  rejected: ['ready', 'manual_review'],
  retryable_error: ['manual_review'],
  outcome_unknown: ['acknowledged', 'ready', 'manual_review'],
  manual_review: ['ready', 'not_ready'],
};

export function canMove(from: SyncStatus, to: SyncStatus): boolean {
  return SYNC_NEXT[from].includes(to);
}

export const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  not_ready: 'Not ready',
  ready: 'Ready to export',
  queued: 'In an export file',
  sent: 'Imported by Finance, waiting for the SQL number',
  acknowledged: 'SQL number recorded',
  reconciled: 'Matched to SQL listing',
  rejected: 'Rejected by SQL',
  retryable_error: 'Retry (API only)',
  outcome_unknown: 'Outcome unknown: look it up',
  manual_review: 'Finance review',
};

/** The SQL item code mapping of one item type in one book. */
export function mappingOf(sku: ItemSku | undefined, partyId: Id) {
  return sku?.sqlCodes.find((c) => c.partyId === partyId) ?? null;
}

/**
 * What stops one job (paper section 7: missing or fuzzy mapping stops posting, never "nearest"). Pure: the same inputs
 * always give the same list, so the screen and the export agree.
 */
export function syncBlockers(
  job: Pick<ItemSyncJob, 'partyId' | 'payload' | 'docDate' | 'docType'>,
  ctx: { book: ItemSqlBook | null; skus: ItemSku[]; counterpartyId: Id | null },
): SyncBlocker[] {
  const out = new Set<SyncBlocker>();
  if (!ctx.book || !ctx.book.verified) out.add('book_unverified');
  for (const l of job.payload.lines) {
    const sku = ctx.skus.find((s) => s.id === l.skuId);
    const map = mappingOf(sku, job.partyId);
    if (!map) {
      out.add('mapping_missing');
      continue;
    }
    if (!map.approvedById) out.add('mapping_unapproved');
    const same = ctx.skus.filter((s) => s.sqlCodes.some((c) => c.partyId === job.partyId && c.itemCode.toUpperCase() === map.itemCode.toUpperCase()));
    if (same.length > 1) out.add('mapping_ambiguous');
    const factor = map.factor ?? 1;
    if (!Number.isInteger(factor) || factor < 1 || Math.abs(l.qty) % factor !== 0) out.add('uom_fraction');
  }
  if (ctx.counterpartyId && ctx.book && !ctx.book.counterparties.some((c) => c.partyId === ctx.counterpartyId)) out.add('counterparty_missing');
  if (ctx.book?.periodLockedThrough && job.docDate && job.docDate <= ctx.book.periodLockedThrough) out.add('period_locked');
  return [...out].sort();
}

/** The other company of a movement's document, for the customer or supplier code. */
export function counterpartyOf(job: Pick<ItemSyncJob, 'partyId'>, m: Pick<ItemMovement, 'fromPartyId' | 'toPartyId'> | undefined): Id | null {
  if (!m) return null;
  return job.partyId === m.fromPartyId ? m.toPartyId : m.fromPartyId;
}

// ---------- CSV ----------

/**
 * One CSV cell. Every value is quoted (codes stay text, leading zeros kept). A cell that a spreadsheet would read as
 * a formula gets a leading apostrophe, so an export opened in Excel never runs anything.
 */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** UTF-8 with a byte-order mark so Excel reads the text right; CRLF line ends. */
export function csvText(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Read a simple CSV (quoted or not) into rows of cells. */
function readCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    if (q) {
      if (c === '"' && src[k + 1] === '"') {
        cell += '"';
        k++;
      } else if (c === '"') q = false;
      else cell += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[k + 1] === '\n') k++;
      row.push(cell);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

// ---------- Export files ----------

const DOC_LABEL: Record<ItemSyncJob['docType'], string> = {
  sales_delivery: 'Sales delivery (seller)',
  purchase_receipt: 'Purchase receipt (buyer)',
  supplier_return_out: 'Return to supplier (sender)',
  supplier_return_in: 'Supplier return received',
  rental_out: 'Rental out',
  rental_in: 'Rental in',
};

/**
 * The export files for one batch, built the same way every time from the same jobs (so a download can be checked
 * against its stored SHA-256). The document file carries ItemCode, UOM and quantity only: SQL's XLS import does not
 * carry serials (paper section 5, U14). The unit ID list is a separate file that stays with Prima as the attachment.
 */
export function buildExport(
  ref: string,
  book: ItemSqlBook,
  jobs: ItemSyncJob[],
  skus: ItemSku[],
  moves: ItemMovement[],
  labelOf: (itemId: Id) => string,
): { files: { name: string; sha256: string; rows: number; content: string }[]; problems: string[] } {
  const problems: string[] = [];
  const docRows: unknown[][] = [['BatchRef', 'Book', 'DocType', 'DocDate', 'CommercialRef', 'CounterpartyCode', 'ItemCode', 'UOM', 'Qty', 'PrimaJob', 'Revision', 'RevisionAction']];
  const unitRows: unknown[][] = [['BatchRef', 'PrimaJob', 'CommercialRef', 'ItemCode', 'UnitId']];
  for (const j of [...jobs].sort((a, b) => a.id.localeCompare(b.id))) {
    if (j.status !== 'ready') problems.push(`${j.id} is not ready.`);
    if ((j.blockers ?? []).length) problems.push(`${j.id} still has blockers.`);
    const m = moves.find((x) => x.id === j.sourceId);
    const cp = counterpartyOf(j, m);
    const cpCode = book.counterparties.find((c) => c.partyId === cp)?.sqlCode ?? '';
    for (const l of [...j.payload.lines].sort((a, b) => a.skuId.localeCompare(b.skuId))) {
      const map = mappingOf(skus.find((s) => s.id === l.skuId), j.partyId);
      if (!map) {
        problems.push(`${j.id}: no SQL item code for ${l.skuId}.`);
        continue;
      }
      const factor = map.factor ?? 1;
      if (l.qty % factor !== 0) problems.push(`${j.id}: ${l.qty} does not divide by ${factor} for ${map.itemCode}.`);
      const sign = j.revisionAction === 'reverse' ? -1 : 1;
      docRows.push([ref, book.sqlBookId, DOC_LABEL[j.docType], j.docDate ?? j.at.slice(0, 10), j.payload.commercialRef ?? '', cpCode, map.itemCode, map.uom, sign * Math.trunc(l.qty / factor), j.id, j.revision, j.revisionAction ?? 'insert']);
      for (const id of [...(l.itemIds ?? [])].sort()) unitRows.push([ref, j.id, j.payload.commercialRef ?? '', map.itemCode, labelOf(id)]);
    }
  }
  const files = [
    { name: `${ref}-documents.csv`, content: csvText(docRows), rows: docRows.length - 1 },
    { name: `${ref}-unit-ids.csv`, content: csvText(unitRows), rows: unitRows.length - 1 },
  ];
  return { files: files.map((f) => ({ ...f, sha256: sha256Hex(f.content) })), problems };
}

// ---------- Reading what SQL Account exported ----------

/** A whole-sen amount from an SQL export cell ("1,234.50", "-12", "RM 3.00"); null when blank or not an amount. */
export function senOfCell(v: string | undefined): Sen | null {
  const s = String(v ?? '').trim().replace(/^RM\s*/i, '').replace(/,/g, '');
  if (!s) return null;
  const m = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const sen = BigInt(m[2]) * 100n + BigInt((m[3] ?? '').padEnd(2, '0') || '0');
  return (m[1] ? -sen : sen).toString();
}

const HEAD = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Parse a stock balance (ItemCode, UOM, Qty) or a document listing (DocType, DocNo, Ref, Net, Tax, Gross) exported
 * from SQL Account. Every row is read, however many (paper section 7: never only the first 50). Codes stay text.
 */
export function parseSnapshot(kind: ItemSqlSnapshot['kind'], text: string): { rows: ItemSqlSnapshot['rows']; problems: string[] } {
  const cells = readCsv(text);
  const problems: string[] = [];
  if (cells.length < 1) return { rows: [], problems: ['The file is empty.'] };
  const head = cells[0].map(HEAD);
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const rows: ItemSqlSnapshot['rows'] = [];
  if (kind === 'stock_balance') {
    const ci = col('itemcode', 'code'), ui = col('uom', 'unit'), qi = col('qty', 'quantity', 'balance', 'balqty');
    if (ci < 0 || qi < 0) return { rows: [], problems: ['A stock balance needs ItemCode and Qty columns.'] };
    for (const [n, r] of cells.slice(1).entries()) {
      const code = (r[ci] ?? '').trim();
      const qty = Number((r[qi] ?? '').replace(/,/g, ''));
      if (!code) continue;
      if (!Number.isFinite(qty) || !Number.isInteger(qty)) {
        problems.push(`Row ${n + 2}: quantity "${r[qi] ?? ''}" is not a whole number.`);
        continue;
      }
      rows.push({ itemCode: code, uom: (r[ui] ?? '').trim() || undefined, qty });
    }
  } else {
    const ti = col('doctype', 'type'), di = col('docno', 'documentno', 'docnumber'), ri = col('ref', 'reference', 'docref', 'commercialref');
    const ni = col('net', 'nett', 'amount', 'subtotal'), xi = col('tax', 'taxamt'), gi = col('gross', 'total', 'doctotal');
    if (di < 0) return { rows: [], problems: ['A document listing needs a DocNo column.'] };
    for (const r of cells.slice(1)) {
      const docNo = (r[di] ?? '').trim();
      if (!docNo) continue;
      rows.push({ docType: ti >= 0 ? (r[ti] ?? '').trim() : undefined, docNo, ref: ri >= 0 ? (r[ri] ?? '').trim() || undefined : undefined, net: ni >= 0 ? senOfCell(r[ni]) ?? undefined : undefined, tax: xi >= 0 ? senOfCell(r[xi]) ?? undefined : undefined, gross: gi >= 0 ? senOfCell(r[gi]) ?? undefined : undefined });
    }
  }
  return { rows, problems };
}

// ---------- Reconciliation ----------

export interface ReconInput {
  partyId: Id;
  period: string; // YYYY-MM
  today: IsoDate;
  oneSidedDays: number;
  book: ItemSqlBook | null;
  jobs: ItemSyncJob[]; // this party's jobs
  otherSide: { commercialRef: string; partyId: Id; status: SyncStatus; docType: ItemSyncJob['docType'] }[];
  moves: ItemMovement[];
  items: PhysicalItem[];
  events: ItemEvent[];
  skus: ItemSku[];
  stock: ItemSqlSnapshot | null;
  listing: ItemSqlSnapshot | null;
}

const daysBetween = (a: IsoDateTime, b: IsoDate) => Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(a)) / 86_400_000);

/**
 * The reconciliation of one company's book (paper section 7):
 * (a) the pipeline by status; (b) intercompany pairs per commercial reference; (c) goods received without a posted
 * document and the reverse; (d) the quantity roll-forward from the event history; (e) Prima against the SQL stock
 * balance; (f) acknowledged documents against the SQL document listing. Differences stay listed until resolved.
 */
export function reconcileBook(x: ReconInput) {
  const periodStart = `${x.period}-01`;
  // (a)
  const pipeline = Object.keys(SYNC_NEXT).map((s) => {
    const js = x.jobs.filter((j) => j.status === s);
    const oldest = js.map((j) => j.at).sort()[0] ?? null;
    return { status: s as SyncStatus, count: js.length, oldest };
  });
  // (b)
  const refs = [...new Set(x.moves.filter((m) => m.commercialRef && m.status !== 'draft' && m.status !== 'cancelled').map((m) => m.commercialRef!))].sort();
  const pairs = refs.map((ref) => {
    const m = x.moves.find((mm) => mm.commercialRef === ref)!;
    const mine = x.jobs.filter((j) => j.payload.commercialRef === ref);
    const other = x.otherSide.filter((o) => o.commercialRef === ref);
    const sent = m.lines.length;
    const received = m.lines.filter((l) => l.result === 'received').length;
    const inTransit = m.lines.filter((l) => l.result === 'pending' || l.result === 'missing').length;
    const rejected = m.lines.filter((l) => l.result === 'damaged' || l.result === 'wrong_item').length;
    const done = (s: SyncStatus) => s === 'acknowledged' || s === 'reconciled';
    const mineDone = mine.some((j) => done(j.status));
    const otherDone = other.some((o) => done(o.status));
    const age = m.dispatched ? daysBetween(m.dispatched.at, x.today) : 0;
    const oneSided = mineDone !== otherDone && age > x.oneSidedDays;
    return { commercialRef: ref, movementRef: m.ref, type: m.type, sent, received, inTransit, rejected, mine: mine.map((j) => ({ id: j.id, docType: j.docType, status: j.status })), other: other.map((o) => ({ docType: o.docType, status: o.status })), oneSided };
  });
  // (c)
  const receivedNoDoc = x.moves
    .filter((m) => m.toPartyId === x.partyId && m.type !== 'transfer' && m.lines.some((l) => l.result === 'received'))
    .filter((m) => !x.jobs.some((j) => j.sourceId === m.id && j.docType !== 'sales_delivery' && j.docType !== 'rental_out' && j.docType !== 'supplier_return_out' && (j.status === 'acknowledged' || j.status === 'reconciled')))
    .map((m) => ({ movementRef: m.ref, commercialRef: m.commercialRef, received: m.lines.filter((l) => l.result === 'received').length }));
  const docNoGoods = x.jobs
    .filter((j) => (j.status === 'acknowledged' || j.status === 'reconciled') && ['purchase_receipt', 'rental_in', 'supplier_return_in'].includes(j.docType))
    .filter((j) => {
      const m = x.moves.find((mm) => mm.id === j.sourceId);
      return !m || !m.lines.some((l) => l.result === 'received');
    })
    .map((j) => ({ jobId: j.id, docNo: j.dest?.docNo ?? '' }));
  // (d) roll-forward per item type: replay every unit's events to its owner and whether it still exists.
  const byItem = new Map<Id, ItemEvent[]>();
  for (const e of x.events) if (e.itemId) byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e]);
  const kits = new Set(x.items.filter((i) => i.componentIds.length).map((i) => i.id));
  const roll = new Map<Id, { opening: number; inn: number; out: number; closing: number; live: number }>();
  const rowOf = (skuId: Id) => roll.get(skuId) ?? (roll.set(skuId, { opening: 0, inn: 0, out: 0, closing: 0, live: 0 }), roll.get(skuId)!);
  for (const i of x.items) {
    if (kits.has(i.id)) continue;
    const evs = (byItem.get(i.id) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at));
    let owner: Id | null = null;
    let alive = false;
    let openingMine = false;
    let openingTaken = false;
    let inn = 0;
    let out = 0;
    for (const e of evs) {
      if (!openingTaken && e.at.slice(0, 10) >= periodStart) {
        openingMine = alive && owner === x.partyId;
        openingTaken = true;
      }
      const before = alive && owner === x.partyId;
      if (e.kind === 'register') {
        owner = e.ownerTo;
        alive = true;
      } else if (e.kind === 'ownership') owner = e.ownerTo;
      else if (e.kind === 'disposed' || e.kind === 'lost') alive = false;
      else if (e.kind === 'found' && !alive) alive = true;
      const after = alive && owner === x.partyId;
      if (openingTaken) {
        if (!before && after) inn++;
        if (before && !after) out++;
      }
    }
    if (!openingTaken) openingMine = alive && owner === x.partyId;
    const r = rowOf(i.skuId);
    if (openingMine) r.opening++;
    r.inn += inn;
    r.out += out;
    if (alive && owner === x.partyId) r.closing++;
    if (i.ownerPartyId === x.partyId && i.state !== 'disposed' && i.state !== 'lost') r.live++;
  }
  const skuCode = (id: Id) => x.skus.find((s) => s.id === id)?.code ?? id;
  const rollForward = [...roll.entries()]
    .filter(([, r]) => r.opening || r.inn || r.out || r.closing || r.live)
    .map(([skuId, r]) => ({ skuId, sku: skuCode(skuId), opening: r.opening, receipts: r.inn, issuesOut: r.out, closing: r.closing, live: r.live, difference: r.live - r.closing }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
  // (e) Prima against the SQL stock balance, per SQL item code.
  const stockCompare = (() => {
    if (!x.stock) return null;
    const owned = x.items.filter((i) => !kits.has(i.id) && i.ownerPartyId === x.partyId && i.state !== 'disposed' && i.state !== 'lost');
    const codes = new Map<string, { itemCode: string; uom: BaseUom | string; prima: number; sql: number | null; inTransit: number; legacy: number; skus: string[] }>();
    const unmapped = new Set<string>();
    for (const i of owned) {
      const sku = x.skus.find((s) => s.id === i.skuId);
      const map = mappingOf(sku, x.partyId);
      if (!map) {
        unmapped.add(sku?.code ?? i.skuId);
        continue;
      }
      const k = map.itemCode.toUpperCase();
      const row = codes.get(k) ?? { itemCode: map.itemCode, uom: map.uom, prima: 0, sql: null, inTransit: 0, legacy: 0, skus: [] };
      row.prima += 1 / (map.factor ?? 1);
      if (i.state === 'in_transit') row.inTransit++;
      if (i.legacyUnverified) row.legacy++;
      if (!row.skus.includes(sku!.code)) row.skus.push(sku!.code);
      codes.set(k, row);
    }
    for (const r of x.stock.rows) {
      const k = (r.itemCode ?? '').toUpperCase();
      const row = codes.get(k) ?? { itemCode: r.itemCode ?? '', uom: r.uom ?? '', prima: 0, sql: null, inTransit: 0, legacy: 0, skus: [] };
      row.sql = (row.sql ?? 0) + (r.qty ?? 0);
      codes.set(k, row);
    }
    const rows = [...codes.values()]
      .map((r) => {
        const diff = (r.sql ?? 0) - r.prima;
        const explained: string[] = [];
        if (r.inTransit) explained.push('in_transit');
        if (r.legacy) explained.push('legacy_unverified');
        if (!r.skus.length) explained.push('unmapped');
        return { ...r, prima: Math.round(r.prima * 1000) / 1000, difference: Math.round(diff * 1000) / 1000, explained };
      })
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
    return { asOf: x.stock.asOf, rows, unmapped: [...unmapped].sort() };
  })();
  // (f) acknowledged documents against the SQL document listing.
  const docCompare = (() => {
    const acked = x.jobs.filter((j) => j.status === 'acknowledged' || j.status === 'reconciled');
    if (!x.listing) return { asOf: null, matched: [] as Id[], missing: acked.map((j) => ({ jobId: j.id, docNo: j.dest?.docNo ?? '' })), differs: [] as { jobId: Id; docNo: string }[] };
    const matched: Id[] = [];
    const missing: { jobId: Id; docNo: string }[] = [];
    const differs: { jobId: Id; docNo: string }[] = [];
    for (const j of acked) {
      const docNo = j.dest?.docNo ?? '';
      const row = x.listing.rows.find((r) => (r.docNo ?? '').toUpperCase() === docNo.toUpperCase());
      if (!row) missing.push({ jobId: j.id, docNo });
      else if (j.dest?.totals && (row.net != null || row.gross != null) && ((row.net != null && row.net !== j.dest.totals.net) || (row.tax != null && row.tax !== j.dest.totals.tax) || (row.gross != null && row.gross !== j.dest.totals.gross)))
        differs.push({ jobId: j.id, docNo });
      else matched.push(j.id);
    }
    return { asOf: x.listing.asOf, matched, missing, differs };
  })();
  return {
    partyId: x.partyId,
    period: x.period,
    book: x.book ? { sqlBookId: x.book.sqlBookId, verified: !!x.book.verified, channel: x.book.channel } : null,
    bookId: x.book?.sqlBookId ?? BOOK_UNSET,
    pipeline,
    pairs,
    oneSided: pairs.filter((p) => p.oneSided).map((p) => p.commercialRef),
    receivedNoDoc,
    docNoGoods,
    rollForward,
    integrityDefects: rollForward.filter((r) => r.difference !== 0).length,
    stockCompare,
    docCompare,
  };
}

export type ItemRecon = ReturnType<typeof reconcileBook>;
