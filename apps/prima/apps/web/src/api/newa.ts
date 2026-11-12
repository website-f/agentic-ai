/**
 * P100 newa (Fauzan, 11 Nov 2026: "Tell Fitri to build"): the calls of the new workflows. E4 SOCSO extras (the LINDUNG
 * claim form, the company's payments to dependants abroad), E8, E9, E10 and J2 follow in their own blocks.
 */
import type { PrimaService, SocsoClaim } from '@prima/core';

/** E4: payments to dependants abroad for the Finance Director, the CEO and Finance. */
export type SocsoPayAbroadBoard = Awaited<ReturnType<PrimaService['socsoExtras']['board']>>;

/** E8: hostels with who lives there, and the check-out memos. */
export type HostelStaysBoard = Awaited<ReturnType<PrimaService['fwExtras']['staysBoard']>>;
/** E8: foreign workers on long SOCSO MC with a permit coming due. */
export type PermitsOnMcBoard = Awaited<ReturnType<PrimaService['fwExtras']['permitsBoard']>>;

/** E9: PIKM records (medical 56+, briefings, 7-year files, client packs, office alarm and CCTV). */
export type PikmBoard = Awaited<ReturnType<PrimaService['pikm']['board']>>;

export interface NewaClient {
  /** E4: payments to dependants abroad waiting for a decision or a transfer. */
  socsoPaymentsAbroad(): Promise<SocsoPayAbroadBoard>;
  /** E4: one SOCSO extra step; the server checks who may do it and every field. */
  socsoExtraAct(action: string, body: Record<string, unknown>): Promise<SocsoClaim>;
  /** E8: who lives in each hostel, and the check-out memos. */
  hostelStays(): Promise<HostelStaysBoard>;
  /** E8: workers on long SOCSO MC whose permit comes due. */
  fwPermitsOnMc(): Promise<PermitsOnMcBoard>;
  /** E8: check in, a check-out memo, its decision, or the permit task; the server checks who may. */
  fwExtraAct(action: string, body: Record<string, unknown>): Promise<unknown>;
  /** E9: the PIKM records this person works, with what is due. */
  pikmBoard(opts?: { companyId?: string }): Promise<PikmBoard>;
  /** E9: one PIKM step; the server checks who may do it and every field. */
  pikmAct(action: string, body: Record<string, unknown>): Promise<import('@prima/core').PikmRecord>;
}
