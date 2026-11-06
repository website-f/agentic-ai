/**
 * P83: a per-request read snapshot over PgStore, so a screen that reads the same table company by company (the group
 * overview: about 350 reads for 54 companies; the CEO's home: about 550) costs one query per table instead of one per
 * company. On a busy server each round trip to the database is several milliseconds, so this is the difference
 * between seconds and a fraction of a second.
 *
 * How it stays correct:
 *  - Only within one request (one transaction, one person): the snapshot is the same rows the person's own queries
 *    would see, because it is read through the same row-level security (no WHERE, the company wall still applies).
 *  - A table is snapshotted only once a request has read it SNAPSHOT_AFTER times; single reads stay plain queries.
 *  - A table with more than MAX_ROWS visible rows is never snapshotted (the query stops at MAX_ROWS + 1).
 *  - Any call that is not a plain read (insert, update, audit, lock, transaction, a database function) drops every
 *    snapshot before and after it, so a read after a write always goes to the database.
 *  - Filters are applied with the database's own rules (pgMatches below); a filter it cannot reproduce exactly (an
 *    object or array value inside a containment) falls back to the database.
 *  - Rows are copied before they are handed out, so a caller changing a row cannot change the next read.
 */
import type { Filter, Range, Row, Store, TableName } from '@prima/core';
import type { PoolClient } from 'pg';

export const SNAPSHOT_AFTER = 3;
export const MAX_ROWS = 3000;

/** Tables read in their own order (audit, by seq) or behind readiness checks: never snapshotted. */
const NEVER = new Set<string>(['audit', 'companyDesks', 'companyRunLinks']);
/** Plain reads: everything else on the store counts as a change. */
const READS = new Set<string>(['list', 'get', 'hasTable', 'companyOfficeReady', 'companyRunLinksReady']);

type Snap = { rows: Record<string, unknown>[]; byId: Map<string, Record<string, unknown>> } | 'too-big';

const isPrimitive = (v: unknown): boolean => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Whether a filter and range can be applied in memory exactly as PgStore's SQL applies them. */
export function exact(filter?: Record<string, unknown>, range?: { field: unknown }): boolean {
  for (const v of Object.values(filter ?? {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (!v.every((x) => isPrimitive(x) && x !== null)) return false;
    } else if (!isPrimitive(v)) return false;
  }
  return !range || !!String(range.field).replace(/[^A-Za-z]/g, '');
}

/**
 * PgStore.list's WHERE, in memory: an array value is `data->>key = ANY(values)` (text comparison; a missing or null
 * field never matches); a single value is `data @> {key: value}` (the field present with that exact JSON value); a
 * range needs a string field and compares as text.
 */
export function pgMatches(row: Record<string, unknown>, filter?: Record<string, unknown>, range?: { field: unknown; from?: unknown; before?: unknown }): boolean {
  for (const [key, want] of Object.entries(filter ?? {})) {
    if (want === undefined) continue;
    const have = row[key];
    if (Array.isArray(want)) {
      if (have === undefined || have === null) return false;
      const text = typeof have === 'string' ? have : typeof have === 'object' ? JSON.stringify(have) : String(have);
      if (!want.map(String).includes(text)) return false;
    } else if (want === null) {
      if (!(key in row) || have !== null) return false;
    } else if (have !== want) return false;
  }
  if (range) {
    const f = String(range.field).replace(/[^A-Za-z]/g, '');
    const v = row[f];
    if (typeof v !== 'string') return false;
    if (range.from !== undefined && !(v >= String(range.from))) return false;
    if (range.before !== undefined && !(v < String(range.before))) return false;
  }
  return true;
}

const copy = <T>(row: T): T => structuredClone(row);

/** The store a request uses: PgStore with the per-request snapshots above. */
export function withReadSnapshots<S extends Store>(store: S, client: Pick<PoolClient, 'query'>, tableOf: (t: TableName) => string): S {
  const snaps = new Map<string, Snap>();
  const reads = new Map<string, number>();
  const drop = () => {
    snaps.clear();
    reads.clear();
  };

  async function snapshot(table: TableName): Promise<Snap | undefined> {
    if (NEVER.has(table)) return undefined;
    const have = snaps.get(table);
    if (have) return have;
    const n = (reads.get(table) ?? 0) + 1;
    reads.set(table, n);
    if (n < SNAPSHOT_AFTER) return undefined;
    const res = await client.query(`SELECT data FROM ${tableOf(table)} LIMIT ${MAX_ROWS + 1}`);
    let snap: Snap;
    if (res.rows.length > MAX_ROWS) snap = 'too-big';
    else {
      const rows = res.rows.map((r) => r.data as Record<string, unknown>);
      snap = { rows, byId: new Map(rows.map((r) => [String(r.id), r])) };
    }
    snaps.set(table, snap);
    return snap;
  }

  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const name = String(prop);
      if (name === 'list') {
        return async (table: TableName, filter?: Filter<TableName>, range?: Range<TableName>) => {
          const f = filter as Record<string, unknown> | undefined;
          if (exact(f, range as { field: unknown } | undefined)) {
            const snap = await snapshot(table);
            if (snap && snap !== 'too-big') {
              const out: Row<TableName>[] = [];
              for (const r of snap.rows) if (pgMatches(r, f, range as { field: unknown })) out.push(copy(r) as unknown as Row<TableName>);
              return out;
            }
          }
          return value.call(target, table, filter, range);
        };
      }
      if (name === 'get') {
        return async (table: TableName, id: string) => {
          const snap = await snapshot(table);
          if (snap && snap !== 'too-big') {
            const r = snap.byId.get(String(id));
            return r ? copy(r) : undefined;
          }
          return value.call(target, table, id);
        };
      }
      if (READS.has(name)) return value.bind(target);
      // Anything else may change what a read would see: drop the snapshots before and after it. A synchronous method
      // (a setting, a capability flag) stays synchronous.
      return (...args: unknown[]) => {
        drop();
        const out = value.apply(target, args);
        if (out && typeof (out as Promise<unknown>).then === 'function') return (out as Promise<unknown>).finally(drop);
        drop();
        return out;
      };
    },
  });
}
