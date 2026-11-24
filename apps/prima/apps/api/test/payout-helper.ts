import type { Db } from '../src/db';

/**
 * Fauzan, 23 Nov 2026 (Finance D2): a salary, claim, advance or loan payout is prepared by one Finance person before
 * another records it paid. PostgreSQL tests that pay call this first; the CEO prepares by default.
 */
export async function preparePayout(db: Db, source: 'staff_pay' | 'guard_pay' | 'staff_claim' | 'guard_advance' | 'guard_loan', sourceId: string, clock?: () => string, by = 'u-fauzan') {
  return db.asUser(
    by,
    async (svc, u) => {
      for (const companyId of await svc.finance.companies(u)) {
        const v = await svc.financePayouts.view(u, companyId).catch(() => null);
        if (v?.waiting.some((w) => w.source === source && w.sourceId === sourceId)) return svc.financePayouts.prepare(u, { source, sourceId, bankId: v.banks[0].id });
      }
      throw new Error(`${source} ${sourceId} is not waiting to be paid`);
    },
    clock,
  );
}
