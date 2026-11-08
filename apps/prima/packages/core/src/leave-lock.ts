import type { Store } from './store';
// MemoryStore transactions are not serializable merely because JavaScript is single-threaded.
// Database serialization uses the existing real people row FOR UPDATE, held until commit.
const queues = new WeakMap<Store, Map<string, Promise<unknown>>>();
export function withLeavePersonLock<T>(store: Store, personId: string, run: (tx: Store) => Promise<T>): Promise<T> {
  let byPerson = queues.get(store);
  if (!byPerson) { byPerson = new Map(); queues.set(store, byPerson); }
  const previous = byPerson.get(personId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => store.transaction(run));
  byPerson.set(personId, next);
  return next.finally(() => {
    if (byPerson!.get(personId) === next) byPerson!.delete(personId);
    if (byPerson!.size === 0) queues.delete(store);
  });
}
