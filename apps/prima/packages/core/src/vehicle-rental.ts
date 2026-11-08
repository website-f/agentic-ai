import { addDays } from "./time";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { Vehicle } from "./types";
import type { VehicleRental } from "./types";


/** The last day of month m (YYYY-MM). */
export function lastDayOf(m: string): IsoDate {
  return addDays(`${addDays(`${m}-28`, 4).slice(0, 7)}-01`, -1);
}

type Period = { ownerId: Id; since: IsoDate; endedOn: IsoDate | null; rates: VehicleRental['rates'] };

/** The rental period billed for month m: the one the vehicle is still in on the month's last day, or null. */
export function rentalPeriodAt(r: VehicleRental | null | undefined, m: string): Period | null {
  if (!r) return null;
  const last = lastDayOf(m);
  const periods: Period[] = [...(r.past ?? []), { ownerId: r.ownerId, since: r.since, endedOn: r.endedOn, rates: r.rates }];
  return periods.find((p) => p.since <= last && (p.endedOn == null || p.endedOn >= last)) ?? null;
}

/** Whether month m's rent is billed: the vehicle is still rented on the month's last day. */
export function rentedAtMonthEnd(r: VehicleRental | null | undefined, m: string): boolean {
  return rentalPeriodAt(r, m) != null;
}

/** The monthly rent in effect for month m, or null when none is set for it. Ties go to the later change. */
export function rentInEffect(r: Pick<VehicleRental, 'rates'> | null | undefined, m: string): VehicleRental['rates'][number] | null {
  const applies = (r?.rates ?? []).filter((x) => x.from <= m).sort((a, b) => a.from.localeCompare(b.from) || a.at.localeCompare(b.at));
  return applies.length ? applies[applies.length - 1] : null;
}

/** The company using the vehicle on day d: the latest move on or before d, else the owner (companyId). */
export function vehicleUserOn(v: Pick<Vehicle, 'companyId' | 'usedBy'>, d: IsoDate): Id {
  const moves = (v.usedBy ?? []).filter((x) => x.from <= d).sort((a, b) => a.from.localeCompare(b.from) || a.at.localeCompare(b.at));
  return moves.length ? moves[moves.length - 1].companyId : v.companyId;
}