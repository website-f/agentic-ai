import {assertMemoryCleanupWrite,memoryCleanupDependencies} from './it-cleanup-guards';
import type {CleanupKind} from './it-cleanup-types';
// Storage port. The service talks only to this interface, so the same business code runs
// against PostgreSQL in the API and against memory in the browser demo.

import { appendAudit } from './audit';
import type { AuditEntry, Dataset, Id, IsoDate, LegalHoldTable, TableName, User, ItTicket } from './types';

export type Row<T extends TableName> = Dataset[T][number];
export type AuditBody = Omit<AuditEntry, 'hash' | 'prevHash' | 'seq'>;

/** Equality filter on top-level fields; an array value means "field is one of". */
export type Filter<T extends TableName> = { [K in keyof Row<T>]?: Row<T>[K] | Row<T>[K][] };

/**
 * A date window on one text field holding an ISO date or date-time (review, 3 Nov 2026: screens that showed a day or a
 * month read every shift, attendance row and patrol tap ever recorded, which grows every month). `from` is inclusive,
 * `before` exclusive, both compared as text, so a date bound works on a date-time field. A row without the field is left
 * out when a range is given.
 */
export interface Range<T extends TableName> {
  field: keyof Row<T> & string;
  from?: string;
  before?: string;
}

export function inRange(row: unknown, range: { field: string; from?: string; before?: string } | undefined): boolean {
  if (!range) return true;
  const v = (row as Record<string, unknown>)[range.field];
  if (typeof v !== 'string') return false;
  return (range.from === undefined || v >= range.from) && (range.before === undefined || v < range.before);
}

export interface Store {
  workflowMetricProblems?():Promise<string[]>;
  workflowMetricNextSegment?(ref:import('./it-workflow-metrics-types').MetricRef):Promise<number>;
  workflowMetricLock?(ref:import('./it-workflow-metrics-types').MetricRef|null):Promise<void>;
  workflowMetricBoundary?(streamId:string,actorId:string,today:string):Promise<boolean>;
  /** Only the in-memory demo enables simulated rental money; never derived from a request or data label. */
  rentalSimulation?(): boolean;
  /** Fail-closed catalog verification before manual register mutations. */
  /** Synthetic cleanup unit-of-work rollback; production uses the PostgreSQL transaction. */
  cleanupTransaction?<R>(fn:(store:Store)=>Promise<R>):Promise<R>;
  itCleanupProblems?(): Promise<string[]>;
  itCleanupDependencies?(kind:CleanupKind,id:string):Promise<{complete:boolean;reasons:string[]}>;
  itCleanupArchived?(kind:CleanupKind,id:string):Promise<boolean>;
  itManualProblems?(): Promise<string[]>;
  itOperationsProblems?(): Promise<string[]>;
  procurementProblems?(): Promise<string[]>;
  /** False until the optional company office module is applied in the database (memory stores always have it). */
  companyOfficeReady?(): Promise<boolean>;
  /** False until the optional module for companies run by another office is applied (memory stores always have it). */
  companyRunLinksReady?(): Promise<boolean>;
  rentalCorrectionProblems?(): Promise<string[]>;
  hrItProblems?(): Promise<string[]>;
  hrItTrustedTenant?(): string | null;
  /** Allocate and insert one ticket atomically; historical references are never renumbered. */
  createItTicket(body: Omit<ItTicket, 'id' | 'ref'>): Promise<ItTicket>;
  /** False when an optional module's table is not installed yet (PostgreSQL); the in-memory store has every table. */
  hasTable?(table: TableName): Promise<boolean>;
  list<T extends TableName>(table: T, filter?: Filter<T>, range?: Range<T>): Promise<Row<T>[]>;
  get<T extends TableName>(table: T, id: Id): Promise<Row<T> | undefined>;
  insert<T extends TableName>(table: T, row: Row<T>): Promise<void>;
  update<T extends TableName>(table: T, id: Id, patch: Partial<Row<T>>): Promise<Row<T>>;
  audit(body: AuditBody): Promise<AuditEntry>;
  /** Run several writes as one unit. */
  transaction<R>(fn: (store: Store) => Promise<R>): Promise<R>;
  /**
   * Hold one record until the request ends, so two people (or a double click) acting on it at once go one after the
   * other and the second sees what the first did. The single-threaded test store has nothing to hold.
   */
  lock?<T extends TableName>(table: T, id: Id): Promise<void>;
  /**
   * The Finance team (a number) recorded for a company, read past the company wall by the database's own function
   * (prima.org_finance_team), so the hand-over layer and its database check always see the same team. Optional: a
   * store without it falls back to reading finStatus.
   */
  orgFinanceTeam?(companyId: Id): Promise<number | null>;
  /** The company whose office runs this one (hand-over receivers), when the run-links module is installed. */
  orgRunBy?(companyId: Id): Promise<Id | null>;
  /**
   * Retention for Arisha IT import reviews (expire after 24h, clear rows 30 days after closing), done and audited by the
   * database in one step; in memory the service tidies and audits itself.
   */
  tidyItImportReviews?(by: string): Promise<{ id: string; kind: string; outcome: 'expired' | 'purged' }[]>;
  /** What is missing or wrong in the database for the Arisha IT import handoff; empty when ready. */
  itImportProblems?(): Promise<string[]>;
  /**
   * Offboarding: close an account from a day and end its company grants the day before; returns how many grants
   * ended. The database store calls prima.close_access, the only way the API may change accounts and grants.
   */
  closeAccess?(userId: Id, from: IsoDate, closed: NonNullable<User['accessClosed']>): Promise<number>;
}

export function matches<T extends TableName>(row: Row<T>, filter?: Filter<T>): boolean {
  if (!filter) return true;
  for (const [key, want] of Object.entries(filter)) {
    if (want === undefined) continue;
    const have = (row as unknown as Record<string, unknown>)[key];
    if (Array.isArray(want) ? !want.includes(have) : have !== want) return false;
  }
  return true;
}

function idOf(row: unknown): Id {
  const r = row as { id?: Id; seq?: number };
  return r.id ?? String(r.seq);
}

/** In-memory store for the browser demo and tests. */
export class MemoryStore implements Store {
  /** Synthetic only. Production derives and locks authority inside a reviewed database helper. */
  async workflowMetricBoundary(streamId:string,actorId:string,today:string):Promise<boolean>{
    const s=await this.get('itMetricStreams',streamId),u=await this.get('users',actorId);if(!s||s.ownerId!==actorId||!u||u.integration||u.role==='site_device'||u.accessClosedFrom&&u.accessClosedFrom<=today)return false;
    const it=u.role==='pwvsb_officer'&&u.department==='it'&&['manager','lead','executive'].includes(u.itRole??'');
    if(s.ref.workflow==='job'){
      const j=await this.get('itJobs',s.ref.recordId);if(!j)return false;
      if(j.returns+1!==s.ref.cycle||j.status==='cancelled')return true;
      const terminal=s.ref.stage==='work'?!!j.submittedAt&&['submitted','checked','accepted'].includes(j.status):s.ref.stage==='check'?!!j.checkedBy&&['checked','accepted'].includes(j.status):j.status==='accepted';
      const event=j.log.filter(e=>e.what===({work:'submit',check:'check',approve:'accept'} as Record<string,string>)[s.ref.stage]).at(-1);
      if(terminal)return !event?.byId||event.byId!==actorId;
      const doer=await this.get('users',j.assigneeId),coo=u.role==='pwvsb_officer'&&u.opsTier==='coo',ceo=['director','pwvsb_officer'].includes(u.role)&&u.opsTier==='ceo';
      if(s.ref.stage==='work')return !it||j.assigneeId!==actorId;
      if(s.ref.stage==='check')return !it||u.itRole!=='lead'||j.assigneeId===actorId||!j.technical;
      if(s.ref.stage==='approve')return j.assigneeId===actorId||!(coo||ceo||it&&u.itRole==='manager'&&doer?.itRole!=='manager');
      return false;
    }
    if(s.ref.workflow==='ticket'||s.ref.workflow==='website'){
      const t=await this.get('itTickets',s.ref.recordId);if(!t)return false;if((t.reopened??0)+1!==s.ref.cycle)return true;
      if(s.ref.stage==='work')return t.status==='resolved'? !t.resolvedById||t.resolvedById!==actorId:!it||t.assignedToId!==actorId;
      if(s.ref.stage==='confirm'){
        if(t.confirmedAt){const who=t.sourceRef?.startsWith('web:')?(t.webHistory??[]).filter(e=>e.action==='confirm').at(-1)?.actorId:t.raisedById;return !who||who!==actorId;}
        if(t.sourceRef?.startsWith('web:')){const {WebsiteService}=await import('./websites');const policies=await new WebsiteService(this,()=>today+'T00:00:00+08:00').ticketPolicies(u);return !policies[t.id]?.canConfirm;}
        const {PrimaService}=await import('./service');const board=await new PrimaService(this,()=>today+'T00:00:00+08:00').itBoard(u);return !board.mine.find(x=>x.id===t.id)?.canConfirm;
      }
    }return false;
  }
  async workflowMetricNextSegment(ref:import('./it-workflow-metrics-types').MetricRef):Promise<number>{const {nextMetricSegment}=await import('./it-workflow-metrics');return nextMetricSegment(this.data.itMetricStreams,ref);}
  async workflowMetricLock(_ref:import('./it-workflow-metrics-types').MetricRef|null):Promise<void>{}

  async workflowMetricProblems():Promise<string[]> { return ['itMetricStreams','itMetricReceipts','itMetricTargets','itMetricCalendars'].every(k=>Array.isArray((this.data as unknown as Record<string,unknown>)[k]))?[]:['WORKFLOW_METRICS_DATASET_MISSING']; }

  rentalSimulation(): boolean { return true; }
  async cleanupTransaction<R>(fn:(store:Store)=>Promise<R>):Promise<R>{const before=structuredClone(this.data);try{return await fn(this);}catch(e){Object.assign(this.data,before);this.index.clear();this.onChange?.(this.data);throw e;}}
  async itCleanupProblems(){return [];}
  async itCleanupDependencies(kind:CleanupKind,id:string){return memoryCleanupDependencies(this.data,kind,id);}
  async itCleanupArchived(kind:CleanupKind,id:string){return (this.data.itCleanupArchives??[]).some(a=>a.kind===kind&&a.recordId===id&&a.archived);}
  async procurementProblems(): Promise<string[]> { return []; }
  /** Explicit synthetic-only adapter; not PostgreSQL catalog evidence. */
  async rentalCorrectionProblems(): Promise<string[]> { return []; }
  private index = new Map<TableName, Map<Id, number>>();

  constructor(
    public readonly data: Dataset,
    private onChange?: (data: Dataset) => void,
  ) {}

  private idx(table: TableName): Map<Id, number> {
    let m = this.index.get(table);
    if (!m) {
      m = new Map();
      (this.data[table] as unknown[]).forEach((r, i) => m!.set(idOf(r), i));
      this.index.set(table, m);
    }
    return m;
  }

  async createItTicket(body: Omit<ItTicket, 'id' | 'ref'>): Promise<ItTicket> {
    let max = 0n;
    for (const row of this.data.itTickets) {
      if (/^IT-[0-9]{1,18}$/.test(row.ref)) {
        const n = BigInt(row.ref.slice(3)); if (n > max) max = n;
      }
    }
    if (max >= 999999999999999999n) throw new Error('Ticket reference range exhausted.');
    const ticket: ItTicket = {...body, id: `it-t-${globalThis.crypto.randomUUID()}`, ref: `IT-${String(max + 1n).padStart(4, '0')}`};
    // insert executes synchronously before its promise resolves; another allocator sees this reservation.
    await this.insert('itTickets', ticket);
    return ticket;
  }

  async list<T extends TableName>(table: T, filter?: Filter<T>, range?: Range<T>): Promise<Row<T>[]> {
    return (this.data[table] as Row<T>[]).filter((r) => matches(r, filter) && inRange(r, range));
  }

  async get<T extends TableName>(table: T, id: Id): Promise<Row<T> | undefined> {
    const i = this.idx(table).get(id);
    return i === undefined ? undefined : (this.data[table][i] as Row<T>);
  }

  async insert<T extends TableName>(table: T, row: Row<T>): Promise<void> {
    const arr = this.data[table] as Row<T>[];
    if (this.idx(table).has(idOf(row))) throw new Error(`Duplicate id ${idOf(row)} in ${table}`);
    assertMemoryCleanupWrite(this.data,table,row);
    arr.push(row);
    this.idx(table).set(idOf(row), arr.length - 1);
    this.onChange?.(this.data);
  }

  async update<T extends TableName>(table: T, id: Id, patch: Partial<Row<T>>): Promise<Row<T>> {
    const i = this.idx(table).get(id);
    if (i === undefined) throw new Error(`Not found: ${table} ${id}`);
    const arr = this.data[table] as Row<T>[];
    if(table==='itJobs'&&idOf({...arr[i],...patch})!==id)throw new Error('Job identity cannot be changed.');
    assertMemoryCleanupWrite(this.data,table,{...arr[i],...patch});
    memoryLegalHoldPreserve(this.data, table, id, arr[i]);
    arr[i] = { ...arr[i], ...patch };
    this.onChange?.(this.data);
    return arr[i];
  }

  async audit(body: AuditBody): Promise<AuditEntry> {
    const e = appendAudit(this.data.audit, body);
    this.onChange?.(this.data);
    return e;
  }

  async transaction<R>(fn: (store: Store) => Promise<R>): Promise<R> {
    // Single-threaded; writes are applied in order. The demo has no rollback.
    return fn(this);
  }
}

/**
 * Same rule as the database trigger prima.lh_preserve (db/modules/central-admin-legal-holds-v1.sql): before a record on
 * an open legal hold changes, its earlier content is kept as a version. Synthetic demo and tests only.
 */
const LEGAL_HOLD_TABLES: Partial<Record<TableName, LegalHoldTable>> = {
  evidenceDocs: 'evidence_docs',
  evidencePhotos: 'evidence_photos',
  cases: 'cases',
  contracts: 'contracts',
  corpProfiles: 'corp_profiles',
  people: 'people',
  insuranceClaims: 'insurance_claims',
};
function memoryLegalHoldPreserve(data: Dataset, table: TableName, id: Id, before: unknown) {
  const tbl = LEGAL_HOLD_TABLES[table];
  if (!tbl || !data.legalHolds?.length) return;
  const h = data.legalHolds.find((x) => x.tbl === tbl && x.refId === id && !x.released);
  if (!h) return;
  (data.legalHoldVersions ??= []).push({
    id: `lhv-${data.legalHoldVersions.length + 1}-${h.id}`,
    companyId: h.companyId,
    holdId: h.id,
    tbl,
    refId: id,
    at: new Date().toISOString().slice(0, 19) + 'Z',
    byId: null,
    before: structuredClone(before),
  });
}
