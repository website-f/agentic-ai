import { RULES } from "./rules";
import type { FuelFill } from "./types";
import type { FuelFlag } from "./types";
import type { Id } from "./types";
import type { Vehicle } from "./types";
import type { VehicleCard } from "./types";


export const FUEL_FLAG_LABEL: Record<FuelFlag, string> = {
  NO_RECEIPT: 'No receipt',
  ODOMETER_ORDER: 'Odometer out of order with the other fill-ups',
  OVER_TANK: 'More litres than the tank holds',
  KM_PER_LITRE: 'Km per litre far from this vehicle’s usual',
  TOO_SOON: 'Another fill-up within a few hours',
  CARD_OTHER_VEHICLE: 'Card kept for another vehicle',
  CARD_ENDED: 'Card not in use on that date',
  WRONG_FUEL: 'Fuel not the one this vehicle or card takes',
  OVER_LIMIT: 'Fuel card over its monthly limit',
  OVER_QUOTA: 'Subsidy card over its monthly quota',
};

/** The physical card behind a card record: the same card kept for two vehicles has one key (and one limit or quota). */
export function cardKey(c: Pick<VehicleCard, 'kind' | 'issuer' | 'last4'>): string {
  return `${c.kind}|${c.issuer.trim().toLowerCase()}|${c.last4}`;
}

type Fill = Pick<FuelFill, 'id' | 'at' | 'litres' | 'odometerKm' | 'amountRm' | 'cardId' | 'fuel' | 'docId' | 'paidWith'>;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Km per litre between consecutive fill-ups (each fill-up's litres over the km since the one before), oldest first. */
export function kmPerLitreSeries(fills: Fill[]): { id: Id; kmpl: number }[] {
  const s = [...fills].sort((a, b) => a.at.localeCompare(b.at));
  const out: { id: Id; kmpl: number }[] = [];
  for (let i = 1; i < s.length; i++) {
    const km = s[i].odometerKm - s[i - 1].odometerKm;
    if (km > 0 && s[i].litres > 0) out.push({ id: s[i].id, kmpl: km / s[i].litres });
  }
  return out;
}

/**
 * The checks on one fill-up against the vehicle's other fill-ups and the card used. `card` is the card with the
 * vehicle it is kept for; `cardMonth` is what that card already bought in the same month (all vehicles).
 */
export function fuelFlags(
  v: Pick<Vehicle, 'id' | 'fuelType' | 'tankLitres'> & { fuel?: Fill[] },
  fill: Fill,
  card: { card: VehicleCard; vehicleId: Id } | null,
  cardMonth: { rm: number; litres: number },
): FuelFlag[] {
  const r = RULES.fleetFuel.value;
  const flags: FuelFlag[] = [];
  const others = (v.fuel ?? []).filter((f) => f.id !== fill.id).sort((a, b) => a.at.localeCompare(b.at));
  if (!fill.docId) flags.push('NO_RECEIPT');
  const prev = [...others].reverse().find((f) => f.at <= fill.at) ?? null;
  const next = others.find((f) => f.at > fill.at) ?? null;
  if ((prev && fill.odometerKm < prev.odometerKm) || (next && fill.odometerKm > next.odometerKm)) flags.push('ODOMETER_ORDER');
  if (v.tankLitres && fill.litres > v.tankLitres * (1 + r.tankSlackPct / 100)) flags.push('OVER_TANK');
  if (prev && fill.odometerKm > prev.odometerKm) {
    const usual = kmPerLitreSeries(others.filter((f) => f.at <= fill.at)).slice(-10).map((x) => x.kmpl);
    if (usual.length >= r.kmPerLitreMinFills) {
      const u = median(usual);
      const now = (fill.odometerKm - prev.odometerKm) / fill.litres;
      if (u > 0 && Math.abs(now - u) / u > r.kmPerLitreBandPct / 100) flags.push('KM_PER_LITRE');
    }
  }
  const t = Date.parse(fill.at);
  if (others.some((f) => Math.abs(Date.parse(f.at) - t) < r.tooSoonHours * 3_600_000)) flags.push('TOO_SOON');
  if (v.fuelType && fill.fuel !== v.fuelType) flags.push('WRONG_FUEL');
  if (card) {
    const c = card.card;
    if (card.vehicleId !== v.id) flags.push('CARD_OTHER_VEHICLE');
    const day = fill.at.slice(0, 10);
    if (day < c.since || (c.endedOn != null && day > c.endedOn)) flags.push('CARD_ENDED');
    if (c.kind === 'SUBSIDY' && fill.fuel !== c.fuel && !flags.includes('WRONG_FUEL')) flags.push('WRONG_FUEL');
    if (c.kind === 'FUEL' && c.monthlyLimitRm != null && cardMonth.rm + fill.amountRm > c.monthlyLimitRm + 1e-9) flags.push('OVER_LIMIT');
    if (c.kind === 'SUBSIDY' && c.monthlyQuotaLitres != null && cardMonth.litres + fill.litres > c.monthlyQuotaLitres + 1e-9) flags.push('OVER_QUOTA');
  }
  return flags;
}

/**
 * One vehicle's usage in month m from its fill-ups: km between the last fill-up before the month (or the month's first)
 * and the month's last, litres and ringgit, km per litre and ringgit per km. Null where it cannot be worked out.
 */
export function monthUsage(fills: Fill[], m: string) {
  const s = [...fills].sort((a, b) => a.at.localeCompare(b.at));
  const inMonth = s.filter((f) => f.at.slice(0, 7) === m);
  const before = s.filter((f) => f.at.slice(0, 7) < m).pop() ?? null;
  const litres = inMonth.reduce((a, f) => a + f.litres, 0);
  const rm = inMonth.reduce((a, f) => a + f.amountRm, 0);
  const byPaid = { FUEL_CARD: 0, SUBSIDY_CARD: 0, CASH: 0, OWN_MONEY: 0 } as Record<FuelFill['paidWith'], number>;
  for (const f of inMonth) byPaid[f.paidWith] += f.amountRm;
  let km: number | null = null;
  let kmpl: number | null = null;
  let usedRm = 0;
  if (inMonth.length) {
    const base = before ?? inMonth[0];
    const last = inMonth[inMonth.length - 1];
    const span = last.odometerKm - base.odometerKm;
    const counted = before ? inMonth : inMonth.slice(1);
    const used = counted.reduce((a, f) => a + f.litres, 0);
    usedRm = counted.reduce((a, f) => a + f.amountRm, 0);
    if (span >= 0 && (before || inMonth.length > 1)) km = span;
    if (km != null && km > 0 && used > 0) kmpl = km / used;
  }
  return {
    fills: inMonth.length,
    litres: Math.round(litres * 100) / 100,
    rm: Math.round(rm * 100) / 100,
    byPaid,
    km,
    kmPerLitre: kmpl == null ? null : Math.round(kmpl * 100) / 100,
    rmPerKm: km && km > 0 && usedRm > 0 ? Math.round((usedRm / km) * 100) / 100 : null,
  };
}