import type { Store } from "./store";
import type { TableName } from "./types";


/**
 * A read-through memo for one read-only screen (whole-organisation review G2, 3 Nov 2026). A leader's home asked the
 * database for the same reference tables dozens of times (grants 63 times, credentials 79 times at group scale). While
 * the memo is in use, the same list with the same filter is read once. Any write through it (insert, update, audit,
 * transaction, lock or another method) clears the memo first, so a read after a write is always fresh. Each caller
 * gets its own array, so sorting one result never reorders another.
 */
export const MEMO_TABLES: ReadonlySet<TableName> = new Set<TableName>([
  'grants',
  'credentials',
  'people',
  'sites',
  'posts',
  'companies',
  'users',
  'branches',
  'firearms',
  'contracts',
  'clientAccounts',
]);

export function readMemo(store: Store, tables: ReadonlySet<TableName> = MEMO_TABLES): Store {
  const memo = new Map<string, Promise<unknown[]>>();
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'list') {
        return async (table: TableName, filter?: unknown, range?: unknown) => {
          if (!tables.has(table)) return target.list(table as never, filter as never, range as never);
          const key = `${table}|${JSON.stringify(filter ?? null)}|${JSON.stringify(range ?? null)}`;
          let p = memo.get(key);
          if (!p) {
            p = target.list(table as never, filter as never, range as never) as Promise<unknown[]>;
            memo.set(key, p);
            p.catch(() => memo.delete(key));
          }
          return [...(await p)];
        };
      }
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== 'function') return v;
      if (prop === 'get' || prop === 'hasTable') return v.bind(target);
      // Anything else may write: forget what was read, then pass straight through.
      return (...args: unknown[]) => {
        memo.clear();
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}