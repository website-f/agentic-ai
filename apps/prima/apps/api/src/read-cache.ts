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
/**
 * Schema checks that only read the database catalogue (table privileges, row-level security, whether an optional module
 * is installed). Their answer does not depend on the person and only changes with a deploy or a module install (which
 * restarts the API), so a PASSING answer is kept for CATALOG_TTL_MS across requests; a failing one is never kept, so a
 * problem still refuses at once. The home screen alone ran one of these on every load.
 */
const CATALOG = new Set<string>([
  'rentalCorrectionProblems',
  'procurementProblems',
  'itOperationsProblems',
  'itManualProblems',
  'workflowMetricProblems',
  'itCleanupProblems',
]);
export const CATALOG_TTL_MS = 5 * 60_000;
const catalogKept = new Map<string, { at: number; value: unknown }>();
const passing = (v: unknown): boolean => v === true || (Array.isArray(v) && v.length === 0);
/** Tests: forget the kept schema answers. */
export function forgetCatalog(): void {
  catalogKept.clear();
  bigSeen.clear();
}

/**
 * P148d: tables found over MAX_ROWS, per database and person (the rows a person sees follow their company walls),
 * remembered for CATALOG_TTL_MS. Their snapshot read (MAX_ROWS + 1 rows,
 * then thrown away) ran on every request that read them three times (shifts and attendance on every leader's home). Only
 * the wasted read is skipped: reads of such a table go to the database as they did after the failed snapshot. A table
 * that has shrunk since is snapshotted again once the time is up; until then its reads are plain queries, also exact.
 */
const bigSeen = new Map<string, number>();
const dbKey = (client: unknown): string | null => {
  const cp = (client as { connectionParameters?: { host?: string; port?: number; database?: string } }).connectionParameters;
  return cp ? `${cp.host ?? ''}:${cp.port ?? ''}/${cp.database ?? ''}` : null;
};

/** Plain reads (no change): everything else on the store counts as a change. hrItProblems sets the tenant for the
 *  transaction, so it is a read but is never kept. */
// P123: the archive checks (prima.ic_archived, a STABLE read) are reads too: as changes they dropped every snapshot once
// per IT record, so a leader's home read the same tables again and again.
// P148d: the module-installed checks below only read the catalogue too; as changes they dropped every snapshot on each
// home load (guard pay, pay formulas, registers, quality), so the tables read before them were read again after.
const READS = new Set<string>(['list', 'get', 'hasTable', 'companyOfficeReady', 'companyRunLinksReady', ...CATALOG, 'hrItProblems', 'itImportProblems', 'rentalSimulation', 'hrItTrustedTenant', 'itCleanupArchived', 'itCleanupArchivedMany', 'guardPayReady', 'payFormulasReady', 'registersReady', 'qualityReady', 'amExtrasReady']);

/**
 * P148d: each row is kept as the database's own JSON text beside the parsed row: the parsed row answers the filters and
 * every caller gets a fresh JSON.parse of the text (2 to 4 times faster than structuredClone of the parsed row, and the
 * same values: jsonb's text is what the database driver parses too). Rows by company are found through an index built
 * on the first company filter, instead of testing every row of the table for each company of a group-wide screen.
 */
type Kept = { o: Record<string, unknown>; t: string };
type Snap = { rows: Kept[]; byId: Map<string, Kept>; byCompany?: Map<string, number[]> } | 'too-big';

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

const fresh = <T>(row: Kept): T => JSON.parse(row.t) as T;

/** The text a row's field is compared as for an array filter (pgMatches), or undefined when it can never match. */
const asText = (have: unknown): string | undefined =>
  have === undefined || have === null ? undefined : typeof have === 'string' ? have : typeof have === 'object' ? JSON.stringify(have) : String(have);

/** pgMatches for one filter and range, with the array values turned to text once instead of once per row. */
function matcher(filter?: Record<string, unknown>, range?: { field: unknown; from?: unknown; before?: unknown }): (row: Record<string, unknown>) => boolean {
  const sets = new Map<string, Set<string>>();
  for (const [key, want] of Object.entries(filter ?? {})) if (Array.isArray(want)) sets.set(key, new Set(want.map(String)));
  const entries = Object.entries(filter ?? {});
  return (row) => {
    for (const [key, want] of entries) {
      if (want === undefined) continue;
      const have = row[key];
      if (Array.isArray(want)) {
        const text = asText(have);
        if (text === undefined || !sets.get(key)!.has(text)) return false;
      } else if (want === null) {
        if (!(key in row) || have !== null) return false;
      } else if (have !== want) return false;
    }
    return range ? pgMatches(row, undefined, range) : true;
  };
}

/** Positions of the rows that may match a company filter (every row that does is among them), in table order. */
function companyRows(snap: Exclude<Snap, 'too-big'>, want: unknown): number[] | null {
  if (want === undefined || want === null || (!Array.isArray(want) && typeof want !== 'string')) return null;
  if (!snap.byCompany) {
    const idx = new Map<string, number[]>();
    snap.rows.forEach((r, i) => {
      const k = asText(r.o.companyId);
      if (k === undefined) return;
      const at = idx.get(k);
      if (at) at.push(i);
      else idx.set(k, [i]);
    });
    snap.byCompany = idx;
  }
  if (!Array.isArray(want)) return snap.byCompany.get(want) ?? [];
  const keys = [...new Set(want.map(String))];
  if (keys.length === 1) return snap.byCompany.get(keys[0]) ?? [];
  const out: number[] = [];
  for (const k of keys) for (const i of snap.byCompany.get(k) ?? []) out.push(i);
  return out.sort((a, b) => a - b);
}

/** The store a request uses: PgStore with the per-request snapshots above. */
export function withReadSnapshots<S extends Store>(store: S, client: Pick<PoolClient, 'query'>, tableOf: (t: TableName) => string, who?: string): S {
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
    const db = who ? dbKey(client) : null;
    const big = db ? `${db} ${who} ${table}` : null;
    const seen = big ? bigSeen.get(big) : undefined;
    if (seen !== undefined && Date.now() - seen < CATALOG_TTL_MS) {
      snaps.set(table, 'too-big');
      return snaps.get(table);
    }
    // P105: a table of a module not installed in this database (upstream's 24 off-list modules) is never snapshotted:
    // its reads go to PgStore, which answers "not installed" without a failed query that would abort the transaction.
    // P148d: through the store's own per-request answer when it has one (PgStore.hasTable: one catalogue read).
    const has = (store as { hasTable?: (t: TableName) => Promise<boolean> }).hasTable;
    const ok = typeof has === 'function' ? await has.call(store, table) : (await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [tableOf(table)])).rows[0]?.ok === true;
    if (!ok) {
      snaps.set(table, 'too-big');
      return snaps.get(table);
    }
    const res = await client.query(`SELECT data::text AS t FROM ${tableOf(table)} LIMIT ${MAX_ROWS + 1}`);
    let snap: Snap;
    if (res.rows.length > MAX_ROWS) {
      snap = 'too-big';
      if (big) {
        if (bigSeen.size > 20_000) bigSeen.clear();
        bigSeen.set(big, Date.now());
      }
    } else {
      const rows: Kept[] = res.rows.map((r: { t?: string; data?: unknown }) => {
        const t = typeof r.t === 'string' ? r.t : JSON.stringify(r.data);
        return { o: JSON.parse(t) as Record<string, unknown>, t };
      });
      snap = { rows, byId: new Map(rows.map((r) => [String(r.o.id), r])) };
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
              const ok = matcher(f, range as { field: unknown } | undefined);
              const some = companyRows(snap, f?.companyId);
              if (some) {
                for (const i of some) if (ok(snap.rows[i].o)) out.push(fresh(snap.rows[i]));
              } else for (const r of snap.rows) if (ok(r.o)) out.push(fresh(r));
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
            return r ? fresh(r) : undefined;
          }
          return value.call(target, table, id);
        };
      }
      if (CATALOG.has(name)) {
        return async (...args: unknown[]) => {
          // Per database (host, port, name): one API process normally serves one, but never mixes two.
          const cp = (client as { connectionParameters?: { host?: string; port?: number; database?: string } }).connectionParameters;
          const key = `${cp?.host ?? ''}:${cp?.port ?? ''}/${cp?.database ?? ''} ${name}:${JSON.stringify(args)}`;
          const kept = catalogKept.get(key);
          if (kept && Date.now() - kept.at < CATALOG_TTL_MS) return structuredClone(kept.value);
          const out = await value.apply(target, args);
          if (passing(out)) catalogKept.set(key, { at: Date.now(), value: out });
          return out;
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
