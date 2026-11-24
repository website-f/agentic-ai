import type { PrimaService } from '../src';
import type { FinPayoutSource } from '../src/finance-payouts';

/**
 * Fauzan, 23 Nov 2026 (Finance D2): a salary, claim, advance or loan payout is prepared by one Finance person before
 * another records it paid. Tests that pay call this first; the CEO prepares by default, so the recorder is someone else.
 */
export async function preparePayout(svc: PrimaService, source: FinPayoutSource, sourceId: string, by = 'u-fauzan') {
  const u = await svc.user(by);
  for (const companyId of await svc.finance.companies(u)) {
    const v = await svc.financePayouts.view(u, companyId).catch(() => null);
    if (v?.waiting.some((w) => w.source === source && w.sourceId === sourceId)) return svc.financePayouts.prepare(u, { source, sourceId, bankId: v.banks[0].id });
  }
  throw new Error(`${source} ${sourceId} is not waiting to be paid`);
}
