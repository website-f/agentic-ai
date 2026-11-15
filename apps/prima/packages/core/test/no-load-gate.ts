import type { Store } from '../src';

/**
 * Agentic Office (P105): the office's import tests check the import kinds themselves, so they run as on a database
 * without upstream's bulk-load-ok-v1 module, where loads work as before. Upstream's N2 gate (backup named, the CEO's OK
 * before the next load) is tested on its own in org-import.test.ts.
 */
export function noLoadGate<S extends Store>(store: S): S {
  store.hasTable = async (table) => table !== 'orgImportOks';
  return store;
}
