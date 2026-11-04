import type { BranchAgreement, BranchSettlement, IsoDate } from './types';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The agreement version in force on a date, or null when none is signed yet. */
export function agreementOn(agreements: BranchAgreement[] | undefined, on: IsoDate): BranchAgreement | null {
  return [...(agreements ?? [])].filter((a) => a.effectiveFrom <= on).sort((a, b) => b.version - a.version)[0] ?? null;
}

/**
 * The month's split under the signed agreement (V12, V12.1). A missing term never falls back to a default: the
 * settlement is held for contract review. Wages are paid whatever the split; a Model A shortfall is the company's.
 */
export function branchSplit(a: BranchAgreement | null, s: Pick<BranchSettlement, 'billing' | 'costs'>) {
  const costs = r2(s.costs.wages + s.costs.statutory + s.costs.other);
  const net = r2(s.billing - costs);
  const none = {
    model: a?.model ?? null,
    pct: null as number | null,
    costs,
    net,
    companyShare: 0,
    managerShare: 0,
    shortfall: 0,
    missingTerm: true,
    lossMonth: false,
  };
  if (!a) return none;
  if (a.model === 'A') {
    const pct = a.companyBillingSharePct;
    if (pct == null || !(pct >= 0 && pct <= 100)) return none;
    const companyShare = r2((s.billing * pct) / 100);
    const residual = r2(s.billing - companyShare - costs);
    return {
      model: a.model,
      pct,
      costs,
      net,
      companyShare,
      managerShare: Math.max(0, residual),
      shortfall: residual < 0 ? -residual : 0,
      missingTerm: false,
      lossMonth: residual < 0,
    };
  }
  if (a.model === 'B') {
    if (a.managerSalary == null) return none;
    // The manager is paid a salary through payroll; the company keeps the branch result.
    return { model: a.model, pct: null, costs, net, companyShare: net, managerShare: 0, shortfall: 0, missingTerm: false, lossMonth: net < 0 };
  }
  const pct = a.companyNetProfitSharePct;
  if (pct == null || !(pct >= 0 && pct <= 100)) return none;
  if (net < 0) return { model: a.model, pct, costs, net, companyShare: net, managerShare: 0, shortfall: 0, missingTerm: false, lossMonth: true };
  const companyShare = r2((net * pct) / 100);
  return { model: a.model, pct, costs, net, companyShare, managerShare: r2(net - companyShare), shortfall: 0, missingTerm: false, lossMonth: false };
}
