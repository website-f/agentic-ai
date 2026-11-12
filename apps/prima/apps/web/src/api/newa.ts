/**
 * P100 newa (Fauzan, 11 Nov 2026: "Tell Fitri to build"): the calls of the new workflows. E4 SOCSO extras (the LINDUNG
 * claim form, the company's payments to dependants abroad), E8, E9, E10 and J2 follow in their own blocks.
 */
import type { PrimaService, SocsoClaim } from '@prima/core';

/** E4: payments to dependants abroad for the Finance Director, the CEO and Finance. */
export type SocsoPayAbroadBoard = Awaited<ReturnType<PrimaService['socsoExtras']['board']>>;

export interface NewaClient {
  /** E4: payments to dependants abroad waiting for a decision or a transfer. */
  socsoPaymentsAbroad(): Promise<SocsoPayAbroadBoard>;
  /** E4: one SOCSO extra step; the server checks who may do it and every field. */
  socsoExtraAct(action: string, body: Record<string, unknown>): Promise<SocsoClaim>;
}
