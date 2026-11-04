import { restorePendingReview, type PendingReview } from './it-import-review-recovery';
import type { ReviewMarkerStore } from './it-import-review-contract-client';
/** Only safe recovery identity is stored. This is not a data vault or authorization boundary. */
export function durableReviewMarker(options: {
  ownerId: 'u-fauzan'; namespace: string; storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  locks: Pick<LockManager, 'request'>; assertOwner: () => Promise<void>;
}) {
  if (!options.namespace || !options.locks?.request) throw Error('Cross-tab review claims unavailable');
  const key = `prima-review-pending:v1:${encodeURIComponent(options.namespace)}:${options.ownerId}`;
  const read = async (ownerId: string) => {
    await options.assertOwner(); if (ownerId !== options.ownerId) throw Error('Wrong review owner');
    const raw = options.storage.getItem(key); return raw === null ? null : restorePendingReview(JSON.parse(raw), ownerId);
  };
  const store: ReviewMarkerStore = {
    read,
    save: async marker => {
      await options.assertOwner(); const valid = restorePendingReview(marker, options.ownerId);
      const prior = await read(options.ownerId);
      if (prior && prior.requestId !== valid.requestId) throw Error('Recover existing review first');
      options.storage.setItem(key, JSON.stringify(valid));
      if ((await read(options.ownerId))?.requestId !== valid.requestId) throw Error('Recovery identity was not saved');
    },
    clearConfirmed: async marker => {
      await options.assertOwner(); const prior = await read(options.ownerId);
      if (prior?.requestId !== restorePendingReview(marker, options.ownerId).requestId) throw Error('Recovery identity changed');
      options.storage.removeItem(key);
      if (await read(options.ownerId)) throw Error('Recovery identity was not retired');
    },
  };
  const claim = async <T>(run: () => Promise<T>): Promise<T> => options.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) throw Error('Another tab is handling this review. Recover after it finishes.');
    await options.assertOwner(); return run();
  });
  return { store, claim };
}
