// Special Operations, Phase 4 (Fauzan, 1-2 Nov 2026): Arms Control, CMS, Transport and Asset Management.
// Pure rules and helpers for slices 4A-4H. The service (service.ts) records and enforces them; nothing here writes.

import { can, isGroupRole, seesArmsDetail } from './access';
import { registerRollout } from './rollouts';
import { registerWall } from './walls';
import type { User } from './types';

/**
 * Special Operations rollout (slice 4A): the Arms Control, CMS and Transport departments sign in once the CEO starts
 * the rollout (PRIMA_ROLLOUTS=special_ops, or the older SPECIAL_OPS_ROLLOUT=true). Off by default, so the IT pilot is
 * unchanged. Company arms staff (the pilot company's armoury people) come later.
 */
export const SPECIAL_OPS_DEPARTMENTS = ['arms_control', 'cms', 'transport'] as const;
export function inSpecialOpsRollout(user: User): boolean {
  if (user.integration || user.role !== 'pwvsb_officer') return false;
  return (SPECIAL_OPS_DEPARTMENTS as readonly string[]).includes(user.department ?? '');
}
registerRollout('special_ops', 'Special Operations (Arms Control, CMS, Transport)', inSpecialOpsRollout);

/**
 * Who passes the arms wall (db/modules/special-ops-v1.sql): the people who see arms detail across companies
 * (seesArmsDetail), PWVSB legal (for the legal check on arms requests), and inside a company the roles that see and handle its firearms (company manager, supervisor).
 * Admin executives, site devices, guards and system feeds do not. On top of the company wall, so a Finance, HR or IT
 * sign-in reads no arms row even with a company grant.
 */
export function holdsArmsWall(user: User): boolean {
  if (user.integration) return false;
  // PWVSB legal reads arms requests at their legal check (slice 4C: transfers, disposal, trade); the service shows it
  // nothing else of the arms register.
  if (user.role === 'pwvsb_officer' && user.department === 'legal') return true;
  if (isGroupRole(user)) return seesArmsDetail(user);
  // Company roles need no grant, so the date is not read; a role with arms.view in any of its companies holds it.
  return user.companyIds.some((c) => can(user, [], '', 'arms.view', c));
}

/** Who passes the CMS wall (CMS roster and staff list): the same group people who see arms detail. */
export function holdsCmsWall(user: User): boolean {
  if (user.integration) return false;
  return isGroupRole(user) && seesArmsDetail(user);
}
registerWall('arms', holdsArmsWall);
registerWall('cms', holdsCmsWall);

// ---------- Shared shapes ----------

import type { ArmsRequest, ArmsTradeDetail, Firearm, IsoDate, IsoDateTime, SiteAlarm } from './types';
import { addDays, toMs } from './time';

/** A firearm still on the company's register: not lost, and not sold, disposed of or transferred out. */
export function onRegister(f: Pick<Firearm, 'status'>): boolean {
  return f.status !== 'LOST' && f.status !== 'OFF_REGISTER';
}

// ---------- 4B: arms register ----------

/**
 * Firearm licences under the Arms Act 1960 run to 30 June (s.4). The renewal calendar for a year: licences ending on
 * that 30 June, with the date to start the renewal (proposed: 90 days before, so a firearm never has to be deposited).
 */
export const LICENCE_RENEWAL_START_DAYS = 90;
export function june30(year: number): IsoDate {
  return `${year}-06-30`;
}
export function renewalWindow(today: IsoDate): { year: number; endsOn: IsoDate; startBy: IsoDate } {
  const y = Number(today.slice(0, 4));
  const endsOn = today <= june30(y) ? june30(y) : june30(y + 1);
  return { year: Number(endsOn.slice(0, 4)), endsOn, startBy: addDays(endsOn, -LICENCE_RENEWAL_START_DAYS) };
}

// ---------- 4C: arms requests ----------

export const ARMS_TRADE_KINDS = ['TRADE_BUY', 'TRADE_SELL', 'IMPORT'] as const;
export type ArmsTradeKind = (typeof ARMS_TRADE_KINDS)[number];
export type ArmsRequestKindAll = ArmsRequest['kind'];

export function isTradeKind(k: string): k is ArmsTradeKind {
  return (ARMS_TRADE_KINDS as readonly string[]).includes(k);
}

/**
 * What a request needs before it is approved. Legal review: transfers between companies, disposal and every trade
 * (V14 s.223). Spending: any estimated cost needs the COO or the CEO (plan 4C).
 */
export function armsRequestNeeds(r: Pick<ArmsRequest, 'kind' | 'fromState' | 'toState' | 'estCost' | 'toCompanyId' | 'companyId'>): {
  legal: boolean;
  spend: boolean;
  notice: boolean;
  approval: boolean;
} {
  const interstate = !!r.fromState && !!r.toState && r.fromState !== r.toState;
  const k = r.kind as string;
  return {
    legal: k === 'TRANSFER' || k === 'DISPOSE' || isTradeKind(k),
    spend: (r.estCost ?? 0) > 0,
    // The police are told of every movement, service trip, disposal and loss; they approve buying, crossing a state,
    // transfers, disposal and trade.
    notice: k === 'MOVE' || k === 'SERVICE' || k === 'LOSS_REPORT' || k === 'TRANSFER' || k === 'DISPOSE',
    approval: k === 'ACQUIRE' || k === 'TRANSFER' || k === 'DISPOSE' || k === 'TRADE_BUY' || k === 'TRADE_SELL' || (k === 'MOVE' && interstate),
  };
}

/** What is still missing before the regulator step can become "approved". Empty means it can. */
export function armsRequestMissing(r: ArmsRequest, today: IsoDate): string[] {
  const need = armsRequestNeeds(r);
  const out: string[] = [];
  if (need.notice && !r.policeNotice) out.push(r.kind === 'LOSS_REPORT' ? 'the police report' : 'the police notice');
  if (need.approval && !r.policeApproval) out.push('the police approval');
  if (need.spend && !r.spend) out.push('the COO or CEO approval of the spending');
  if (r.kind === 'TRADE_SELL') out.push(...buyerProblems(r.trade?.buyer ?? null, today));
  if (r.kind === 'IMPORT') {
    const im = r.trade?.import;
    if (!im?.cpo) out.push('the CPO import licence');
    if (!im?.kdn) out.push('KDN approval of the papers');
  }
  return out;
}

/** The buyer of a sale holds the police approval and the end-user certificate (Fauzan, 2 Nov 2026, answer 3). */
export function buyerProblems(b: ArmsTradeDetail['buyer'] | null, today: IsoDate): string[] {
  if (!b) return ['the buyer, their licence, police approval and end-user certificate'];
  const out: string[] = [];
  if (!b.name.trim()) out.push("the buyer's name");
  if (!b.licenceRef.trim()) out.push("the buyer's licence");
  else if (!b.licenceExpiresOn || b.licenceExpiresOn < today) out.push("a valid buyer's licence (it has expired)");
  if (!b.policeApprovalRef.trim()) out.push("the buyer's police approval");
  if (!b.endUserCertRef.trim()) out.push('the end-user certificate');
  return out;
}

// ---------- 4H: import ----------

/** Fauzan, 2 Nov 2026 (answer 4): arms come in through Port Klang or KLIA only. */
export const IMPORT_PORTS = ['PORT_KLANG', 'KLIA'] as const;
export const PORT_LABEL: Record<(typeof IMPORT_PORTS)[number], string> = { PORT_KLANG: 'Port Klang', KLIA: 'KLIA' };
/** Arms Act s.15: the endorsed import licence goes back to the OCPD within 3 days after its term. */
export const ENDORSED_RETURN_DAYS = 3;

/**
 * The order of an import (Fauzan, 2 Nov 2026: "Import it self. After cpo. The paper will need kdn approvals"): CPO
 * import licence, then KDN approval of the papers, then shipping, arrival and declaration, then the endorsed licence
 * back within 3 days. Returns why a step cannot be recorded yet; null means it can.
 */
export function importStepBlocked(im: NonNullable<ArmsTradeDetail['import']>, step: 'cpo' | 'kdn' | 'customs' | 'shipped' | 'arrived' | 'declared' | 'endorsed'): string | null {
  if (step === 'cpo') return null;
  if (!im.cpo) return 'Record the CPO import licence first.';
  if (step === 'kdn') return null;
  if (!im.kdn) return 'KDN must approve the papers before shipping.';
  if (step === 'customs') return null;
  if (step === 'shipped') return im.port ? null : 'Name the port: Port Klang or KLIA.';
  if (!im.shippedOn) return 'Record the shipment first.';
  if (step === 'arrived') return null;
  if (!im.arrivedOn) return 'Record the arrival first.';
  if (step === 'declared') return null;
  return im.declaredOn ? null : 'Record the declaration on arrival first.';
}

/** When the endorsed licence must be back with the OCPD, and whether it is late. */
export function endorsedReturn(im: NonNullable<ArmsTradeDetail['import']>, today: IsoDate): { dueBy: IsoDate | null; late: boolean } {
  if (!im.cpo) return { dueBy: null, late: false };
  const dueBy = addDays(im.cpo.endsOn, ENDORSED_RETURN_DAYS);
  return { dueBy, late: !im.endorsedReturnedOn && today > dueBy };
}

// ---------- 4E: CMS ----------

/**
 * How each CMS app event shows on Prima's CMS desk. Info events (clock-ins, checkpoints, plates allowed) are counted,
 * never raised as alarms; everything else becomes an alarm row the operator acknowledges and closes.
 */
export const CMS_INFO_KINDS = new Set(['GUARD_CLOCKED_IN', 'PATROL_CHECKPOINT', 'GATE_PLATE_ALLOWED', 'GATE_VISITOR_ARRIVED', 'DEVICE_ONLINE', 'ALARM_RESTORED', 'SYSTEM_STATUS']);
export function cmsAlarmKind(kind: string): SiteAlarm['kind'] | null {
  if (CMS_INFO_KINDS.has(kind)) return null;
  if (kind === 'INTRUSION' || kind === 'DOOR_FORCED') return 'INTRUSION';
  if (kind === 'PANIC' || kind === 'VEHICLE_PANIC') return 'PANIC';
  if (kind === 'FIRE') return 'FIRE';
  if (kind === 'TAMPER') return 'CAMERA_TAMPER';
  if (kind === 'DEVICE_OFFLINE') return 'LINK_LOST';
  return 'CMS_EVENT';
}

// ---------- 4F: transport ----------

/**
 * JPJ driving hours (plan 4F): at most 8 hours of driving in a day, and a 30 minute break after 4 hours of driving.
 * The speed limit for company vehicles is PROPOSED at 90 km/h until Fauzan sets it.
 */
export const DRIVER_HOURS = { maxDayMin: 8 * 60, maxStretchMin: 4 * 60, breakMin: 30, joinGapMin: 10, speedLimitKmh: 90 } as const;

/** Driving time in one day, and the longest stretch without a 30 minute break. */
export function driverHours(periods: { from: IsoDateTime; to: IsoDateTime }[], dayStart: IsoDateTime, dayEnd: IsoDateTime) {
  const s = toMs(dayStart);
  const e = toMs(dayEnd);
  const ps = periods
    .map((p) => [Math.max(toMs(p.from), s), Math.min(toMs(p.to), e)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let drivingMs = 0;
  let stretchMs = 0;
  let longestMs = 0;
  let lastEnd: number | null = null;
  for (const [a, b] of ps) {
    if (lastEnd !== null && a - lastEnd >= DRIVER_HOURS.breakMin * 60_000) stretchMs = 0;
    const from = lastEnd !== null && a < lastEnd ? lastEnd : a;
    const add = Math.max(0, b - from);
    drivingMs += add;
    stretchMs += add;
    longestMs = Math.max(longestMs, stretchMs);
    lastEnd = Math.max(lastEnd ?? b, b);
  }
  const drivingMin = Math.round(drivingMs / 60_000);
  const stretchMin = Math.round(stretchMs / 60_000);
  return {
    drivingMin,
    stretchMin,
    longestStretchMin: Math.round(longestMs / 60_000),
    overDay: drivingMin > DRIVER_HOURS.maxDayMin,
    needsBreak: stretchMin >= DRIVER_HOURS.maxStretchMin,
  };
}

/** Distance between two positions in km (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

// ---------- 4H: the trading switch ----------

/** The CEO's arms trading switch is one row in the CMS settings table, under this id (no new table). */
export const ARMS_TRADING_ROW = 'arms-trading';
export interface ArmsTradingSwitch {
  id: typeof ARMS_TRADING_ROW;
  on: boolean;
  by: string | null;
  at: IsoDateTime | null;
  reason: string | null;
  history: { on: boolean; by: string; at: IsoDateTime; reason: string }[];
}

// ---------- 4G: furniture purchases ----------

/** A purchase asked for or decided, not yet received: not an asset, kept out of the register and depreciation. */
export function isBuyRequest(a: { status: string }): boolean {
  return a.status === 'buy_requested' || a.status === 'buy_approved' || a.status === 'buy_refused';
}
