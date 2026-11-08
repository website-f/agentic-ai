import { AccessDenied } from "./access";
import { assetRole } from "./access";
import { AM_AD_CHANNELS } from "./am-extras";
import { AM_LOST_REASONS } from "./am-extras";
import { AM_STAY_TYPES } from "./am-extras";
import { AM_TRADES } from "./am-extras";
import { CIDB_GRADES } from "./am-extras";
import { bookingHolds } from "./am-extras";
import { bookingBill } from "./am-extras";
import { bookingPaid } from "./am-extras";
import { bookingTotal } from "./am-extras";
import { isSleepType } from "./am-extras";
import { roomsOut } from "./am-extras";
import { sellable } from "./am-extras";
import { harvestLeft } from "./am-extras";
import { isDate } from "./am-extras";
import { maskPhone } from "./am-extras";
import { nights } from "./am-extras";
import { nightsTaken } from "./am-extras";
import { pmEffective } from "./am-extras";
import { usageBaseline } from "./am-extras";
import type { AmBooking } from "./am-extras";
import type { AmContractor } from "./am-extras";
import type { AmContractorStatus } from "./am-extras";
import type { AmEnquiry } from "./am-extras";
import type { AmHarvest } from "./am-extras";
import type { AmLetting } from "./am-extras";
import type { AmMeter } from "./am-extras";
import type { AmPmPlan } from "./am-extras";
import type { AmStayType } from "./am-extras";
import type { AmRoom } from "./am-extras";
import type { AmHousekeeping } from "./am-extras";
import type { AmStaySetup } from "./am-extras";
import type { AmStayTaxes } from "./am-extras";
import type { AmStayPolicy } from "./am-extras";
import { cancelSettlement } from "./am-extras";
import { isHhmm } from "./am-extras";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import { addDays } from "./time";
import { dateOf } from "./time";
import { daysBetween } from "./time";
import { fromMs } from "./time";
import { toMs } from "./time";
import type { AmWorkOrder } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { User } from "./types";


type Body = Record<string, unknown>;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const money = (v: unknown) => Math.round(num(v) * 100) / 100;
const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => list.find((x) => x === v);
const round2 = (n: number) => Math.round(n * 100) / 100;

export class AmExtrasService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
  ) {}

  private now() {
    return this.clock();
  }
  private today() {
    return dateOf(this.clock());
  }
  private get rule() {
    return RULES.amExtras.value;
  }

  private role(user: User) {
    if (user.integration) return null;
    return assetRole(user);
  }
  private team(user: User, what: string) {
    if (this.role(user) !== 'team') throw new AccessDenied('view', `(the Asset Management team ${what})`);
  }
  private director(user: User, what: string) {
    if (this.role(user) !== 'team' || user.assetRole !== 'director') throw new AccessDenied('view', `(the Asset Director ${what})`);
  }
  private finance(user: User) {
    return !user.integration && (user.leadership === 'finance_director' || (user.role === 'pwvsb_officer' && user.department === 'finance'));
  }

  /** Lock, read and check the version, then write with one audit entry, all in one transaction. */
  private async change<T extends 'amContractors' | 'amLettings' | 'amMeters' | 'amBookings' | 'amHarvests' | 'amPmPlans'>(
    user: User,
    table: T,
    id: Id,
    version: number | undefined,
    fn: (row: Record<string, unknown> & { version: number }) => { patch: Record<string, unknown>; action: string; summary: string },
  ) {
    return this.store.transaction(async (tx) => {
      await tx.lock?.(table, id);
      const row = (await tx.get(table, id)) as unknown as (Record<string, unknown> & { version: number }) | undefined;
      if (!row) throw new NotFound('Record');
      if (version != null && Number.isFinite(version) && version !== row.version) throw new BadRequest('Someone changed this record a moment ago. Reload and try again.');
      const { patch, action, summary } = fn(row);
      await tx.update(table, id, { ...patch, version: row.version + 1 } as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action, entity: table, entityId: id, summary });
      return (await tx.get(table, id))!;
    });
  }
  private async add<T extends 'amContractors' | 'amLettings' | 'amMeters' | 'amBookings' | 'amHarvests' | 'amPmPlans'>(
    user: User,
    table: T,
    row: { id: Id },
    action: string,
    summary: string,
  ) {
    return this.store.transaction(async (tx) => {
      await tx.lock?.(table, row.id);
      if (await tx.get(table, row.id)) throw new BadRequest('That record already exists.');
      await tx.insert(table, row as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action, entity: table, entityId: row.id, summary });
      return row;
    });
  }
  private newId(prefix: string) {
    return `${prefix}-${toMs(this.now())}-${Math.random().toString(36).slice(2, 7)}`;
  }

  // =====================================================================================================================
  // Board: everything the screens show, worked out on the server.
  // =====================================================================================================================

  async board(user: User) {
    const role = this.role(user);
    if (!role) throw new AccessDenied('view', '(Asset Management)');
    const rule = this.rule;
    const today = this.today();
    const team = role === 'team';
    const phone = (s: string) => (team ? s : maskPhone(s));
    // On the database these tables come with an optional module; until it is applied the screens say so.
    const installed = (await this.store.amExtrasReady?.()) ?? true;
    const [contractors, lettings, meters, bookings, harvests, plans, units, props, orders] = await Promise.all([
      this.store.list('amContractors', {}),
      this.store.list('amLettings', {}),
      this.store.list('amMeters', {}),
      this.store.list('amBookings', {}),
      this.store.list('amHarvests', {}),
      this.store.list('amPmPlans', {}),
      this.store.list('amUnits', {}),
      this.store.list('amProperties', {}),
      this.store.list('amWorkOrders', {}),
    ]);
    const unitOf = new Map(units.map((u) => [u.id, u]));
    const propOf = new Map(props.map((p) => [p.id, p]));
    const placeName = (unitId: Id | null, propertyId: Id | null) =>
      unitId ? `${unitOf.get(unitId)?.code ?? unitId} ${unitOf.get(unitId)?.name ?? ''}`.trim() : (propOf.get(propertyId ?? '')?.name ?? '');

    // ---- Contractors ----
    const lc = (s: string) => s.trim().toLowerCase();
    const contractorRows = contractors
      .map((c) => {
        const jobs = orders.filter((w) => w.contractor && lc(w.contractor) === lc(c.name));
        const done = jobs.filter((w) => w.status === 'done');
        const avg = c.ratings.length ? round2(c.ratings.reduce((n, x) => n + x.quality, 0) / c.ratings.length) : null;
        const onTimePct = c.ratings.length ? Math.round((c.ratings.filter((x) => x.onTime).length / c.ratings.length) * 100) : null;
        const cidbDays = c.cidbExpiry ? daysBetween(today, c.cidbExpiry) : null;
        const flags: string[] = [];
        if (cidbDays != null && cidbDays < 0) flags.push('CIDB registration has ended');
        else if (cidbDays != null && cidbDays <= rule.cidbWarnDays) flags.push(`CIDB registration ends in ${cidbDays} days`);
        if (avg != null && c.ratings.length >= rule.minRatings && avg < rule.lowRating) flags.push(`Low rating ${avg} over ${c.ratings.length} jobs: review`);
        if (c.status !== 'active' && jobs.some((w) => w.status !== 'done')) flags.push(`Has open work while ${c.status}`);
        const unrated = done.filter((w) => !c.ratings.some((x) => x.workOrderId === w.id)).map((w) => ({ id: w.id, title: w.title, doneOn: w.doneOn, place: placeName(w.unitId, w.propertyId) }));
        return {
          ...c,
          phone: phone(c.phone),
          email: team ? c.email : '',
          jobs: jobs.length,
          openJobs: jobs.filter((w) => w.status !== 'done').length,
          spend: done.reduce((n, w) => n + (w.cost ?? 0), 0),
          avgRating: avg,
          onTimePct,
          cidbDays,
          flags,
          unrated,
          canDecide: user.assetRole === 'director' && team,
        };
      })
      .sort((a, b) => ['pending', 'active', 'suspended', 'blacklisted'].indexOf(a.status) - ['pending', 'active', 'suspended', 'blacklisted'].indexOf(b.status) || a.name.localeCompare(b.name));
    const knownNames = new Set(contractors.map((c) => lc(c.name)));
    const unlisted = [...new Set(orders.filter((w) => w.contractor && !knownNames.has(lc(w.contractor))).map((w) => w.contractor!))];

    // ---- Finding tenants ----
    const lettingOf = new Map(lettings.map((l) => [l.unitId, l]));
    const toLet = units
      .filter((u) => u.status === 'vacant' || (u.tenancy && daysBetween(today, u.tenancy.endOn) <= rule.letBeforeEndDays && u.tenancy.endOn >= today))
      .map((u) => {
        const l = lettingOf.get(u.id) ?? null;
        const enquiries = (l?.enquiries ?? []).map((e) => ({
          ...e,
          phone: phone(e.phone),
          stale: !['signed', 'lost', 'approved'].includes(e.status) && daysBetween(e.lastActionOn, today) > rule.enquiryFollowUpDays,
          belowAsking: e.offer ? e.offer.rent < u.askingRent : false,
        }));
        const open = enquiries.filter((e) => !['signed', 'lost'].includes(e.status));
        const vacantDays = u.vacantSince ? daysBetween(u.vacantSince, today) : null;
        const flags: string[] = [];
        if (u.status === 'vacant' && !(l?.adverts.length) && (vacantDays ?? 0) > rule.advertWithinDays) flags.push(`Not advertised, empty ${vacantDays} days`);
        if (enquiries.some((e) => e.stale)) flags.push('Enquiry waiting for a next step');
        return {
          unitId: u.id,
          code: u.code,
          name: u.name,
          type: u.type,
          town: u.town,
          state: u.state,
          status: u.status,
          askingRent: u.askingRent,
          vacantDays,
          endsOn: u.status === 'vacant' ? null : (u.tenancy?.endOn ?? null),
          adverts: l?.adverts ?? [],
          enquiries,
          openEnquiries: open.length,
          offersToApprove: enquiries.filter((e) => e.status === 'offer').length,
          version: l?.version ?? 0,
          flags,
        };
      })
      .sort((a, b) => b.offersToApprove - a.offersToApprove || b.flags.length - a.flags.length || (b.vacantDays ?? 0) - (a.vacantDays ?? 0));
    const allEnq = lettings.flatMap((l) => l.enquiries);
    const lostWhy = AM_LOST_REASONS.map((reason) => ({ reason, count: allEnq.filter((e) => e.lost?.reason === reason).length })).filter((x) => x.count);

    // ---- Meters ----
    const meterRows = meters.map((m) => {
      const last = m.readings.at(-1) ?? null;
      const base = usageBaseline(m.readings.slice(0, -1));
      const flags: string[] = [];
      const days = last ? daysBetween(last.on, today) : null;
      if (!last) flags.push('Never read');
      else if (days! > rule.meterReadDays) flags.push(`Not read for ${days} days`);
      if (last?.usage != null && base != null && base > 0 && last.usage > base * rule.meterSpikeX) flags.push(`Used ${Math.round(last.usage / base)}x the usual: check for a leak or fault`);
      const unit = m.unitId ? unitOf.get(m.unitId) : undefined;
      if (unit?.status === 'vacant' && last?.usage != null && last.usage > (m.kind === 'ELECTRICITY' ? 30 : 5)) flags.push('Usage at an empty unit');
      return {
        id: m.id,
        unitId: m.unitId,
        propertyId: m.propertyId,
        place: placeName(m.unitId, m.propertyId),
        kind: m.kind,
        account: m.account,
        payer: m.payer,
        last,
        usual: base == null ? null : Math.round(base),
        readings: m.readings.slice(-6),
        bills: m.bills.slice(-6),
        version: m.version,
        flags,
      };
    });

    // ---- Resorts ----
    // Laid out the way a hotel front office works: tonight's rooms (sold, out of order, free),
    // arrivals, departures and in-house guests, the cleaning board, and a daily report like a night audit.
    const monthStart = `${today.slice(0, 7)}-01` as IsoDate;
    const nowHm = fromMs(toMs(this.now())).slice(11, 16);
    const resorts = props
      .filter((p) => p.kind === 'RESORT')
      .map((p) => {
        const stay = p.stay ?? null;
        const mine = bookings.filter((b) => b.propertyId === p.id);
        const week = Array.from({ length: 14 }, (_, k) => addDays(today, k));
        const types = AM_STAY_TYPES.filter((t) => (stay?.capacity[t] ?? 0) > 0);
        const grid = types.map((type) => ({
          type,
          capacity: stay?.capacity[type] ?? 0,
          rate: stay?.rates[type] ?? null,
          nights: week.map((night) => {
            const taken = nightsTaken(mine, p.id, type, night, addDays(night, 1), today)[0].taken;
            const out = roomsOut(stay, type, night);
            return { night, taken, out, free: Math.max(0, sellable(stay, type, night) - taken) };
          }),
        }));
        const rows = mine
          .map((b) => {
            const bill = bookingBill(b);
            const total = bill.total;
            const paid = bookingPaid(b);
            const flags: string[] = [];
            if (b.status === 'held' && b.holdUntil < today) flags.push('Hold lapsed: no deposit');
            if (b.rate < b.listRate) flags.push(`Below price list (RM${b.listRate}): ${b.discountReason}`);
            if (b.status === 'checked_out' && !b.internal && paid < total) flags.push(`RM${round2(total - paid)} still unpaid`);
            if (b.status === 'checked_out' && b.internal) flags.push(`Bill RM${total} to ${b.billTo}`);
            if (b.status === 'confirmed' && b.checkIn < today) flags.push('Check-in date passed: check in or mark no-show');
            if (b.status === 'checked_in' && b.checkOut < today) flags.push('Check-out date passed: check the guest out or extend');
            if (b.status === 'checked_in' && !b.register) flags.push('No guest register entry');
            if (b.status === 'checked_in' && b.checkOut === today && b.terms && nowHm > b.terms.checkOutTime) flags.push(`Past check-out time (${b.terms.checkOutTime})`);
            if (b.settlement && b.settlement.refundDue > b.settlement.refunded) flags.push(`RM${round2(b.settlement.refundDue - b.settlement.refunded)} to pay back under the terms`);
            const reg = b.register
              ? team
                ? b.register
                : { idType: b.register.idType, idNo: maskPhone(b.register.idNo), nationality: b.register.nationality, by: b.register.by, at: b.register.at }
              : null;
            return { ...b, register: reg, phone: phone(b.phone), nights: nights(b), bill, total, paid, balance: round2(total - paid), flags };
          })
          .sort((a, b) => a.checkIn.localeCompare(b.checkIn));

        // Cleaning board: every numbered room with its cleaning state and whether a guest is in it.
        const rooms = (stay?.rooms ?? []).map((r) => {
          const guest = rows.find((b) => b.status === 'checked_in' && (b.roomNos ?? []).includes(r.no));
          const outNow = !!r.out && r.out.from <= today && today <= r.out.until;
          const state = outNow ? 'out' : guest ? 'occupied' : 'vacant';
          return { ...r, state, guest: guest ? { bookingId: guest.id, ref: guest.ref, name: guest.guest, checkOut: guest.checkOut } : null, departsToday: guest?.checkOut === today };
        });
        const hk = {
          dirty: rooms.filter((r) => r.state !== 'out' && r.hk === 'dirty').length,
          clean: rooms.filter((r) => r.state !== 'out' && r.hk === 'clean').length,
          inspected: rooms.filter((r) => r.state !== 'out' && r.hk === 'inspected').length,
          out: rooms.filter((r) => r.state === 'out').length,
          readyToSell: rooms.filter((r) => r.state === 'vacant' && r.hk === 'inspected').length,
        };

        // Daily report (what a night audit produces): tonight's sleeping rooms only, because halls and pitches are not rooms.
        const sleepTypes = types.filter(isSleepType);
        const avail = sleepTypes.reduce((n, t) => n + sellable(stay, t, today), 0);
        const tonight = rows.filter((b) => isSleepType(b.type) && bookingHolds(b, today) && b.checkIn <= today && today < b.checkOut);
        const sold = tonight.reduce((n, b) => n + b.qty, 0);
        const roomRev = round2(tonight.reduce((n, b) => n + b.rate * b.qty, 0));
        const paysToday = mine.flatMap((b) => b.payments).filter((x) => x.on === today);
        const byMethod: Record<string, number> = {};
        for (const x of paysToday) byMethod[x.method] = round2((byMethod[x.method] ?? 0) + x.amount);
        // Taxes on stays that ended this month (the bill is final at check-out). Finance files the returns.
        const closed = rows.filter((b) => b.status === 'checked_out' && b.checkOut >= monthStart && b.checkOut <= addDays(today, 1));
        const report = {
          date: today,
          roomsAvailable: avail,
          roomsSold: sold,
          occupancyPct: avail ? Math.round((sold / avail) * 1000) / 10 : 0,
          adr: sold ? round2(roomRev / sold) : 0,
          revpar: avail ? round2(roomRev / avail) : 0,
          roomRevenue: roomRev,
          arrivals: rows.filter((b) => b.checkIn === today && (b.status === 'confirmed' || b.status === 'held' || b.status === 'checked_in')).map((b) => ({ id: b.id, ref: b.ref, guest: b.guest, status: b.status })),
          departures: rows.filter((b) => b.checkOut === today && (b.status === 'checked_in' || b.status === 'checked_out')).map((b) => ({ id: b.id, ref: b.ref, guest: b.guest, status: b.status, balance: b.balance })),
          inHouse: rows.filter((b) => b.status === 'checked_in').length,
          noShowsToMark: rows.filter((b) => b.status === 'confirmed' && b.checkIn < today).map((b) => ({ id: b.id, ref: b.ref, guest: b.guest, checkIn: b.checkIn })),
          paymentsToday: { total: round2(paysToday.reduce((n, x) => n + x.amount, 0)), byMethod },
          openBalances: round2(rows.filter((b) => b.status === 'checked_in' && !b.internal).reduce((n, b) => n + Math.max(0, b.balance), 0)),
          monthToDate: {
            stays: closed.length,
            sst: round2(closed.reduce((n, b) => n + b.bill.sst, 0)),
            tourismTax: round2(closed.reduce((n, b) => n + b.bill.tourism, 0)),
            tourismRoomNights: closed.filter((b) => b.foreign && isSleepType(b.type)).reduce((n, b) => n + b.qty * b.nights, 0),
            stateFee: round2(closed.reduce((n, b) => n + b.bill.stateFee, 0)),
            stateFeeName: stay?.taxes?.stateFeeName ?? '',
          },
        };
        // House rules the Asset Director must keep current.
        const pol = stay?.policy;
        const flags: string[] = [];
        if (stay && !pol) flags.push('House rules not set: service tax, MOTAC, times and cancellation terms');
        if (pol && !pol.motacNo) flags.push('No MOTAC registration recorded');
        if (pol?.motacExpiresOn && pol.motacExpiresOn < today) flags.push(`MOTAC registration ended ${pol.motacExpiresOn}`);
        else if (pol?.motacExpiresOn && daysBetween(today, pol.motacExpiresOn) <= rule.motacWarnDays) flags.push(`MOTAC registration ends ${pol.motacExpiresOn}`);
        return {
          id: p.id,
          name: p.name,
          stay,
          flags,
          grid,
          rooms,
          hk,
          report,
          bookings: rows,
          inHouse: report.inHouse,
          arrivingToday: rows.filter((b) => b.checkIn === today && (b.status === 'confirmed' || b.status === 'held')).length,
        };
      });
    const stayPayments = bookings.flatMap((b) => b.payments.map((p) => ({ ...p, bookingId: b.id, bookingRef: b.ref, guest: b.guest, propertyId: b.propertyId })));

    // ---- Harvest ----
    const sales = harvests.flatMap((h) => h.sales.map((s) => ({ ...s, harvestId: h.id, crop: h.crop, propertyId: h.propertyId, on: dateOf(s.at) })));
    const avgPrice = (crop: string, before: IsoDate, except: Id) => {
      const xs = sales.filter((s) => s.crop === crop && s.id !== except && s.on < before && s.on >= addDays(before, -rule.priceLookbackDays) && s.kg > 0);
      const kg = xs.reduce((n, s) => n + s.kg, 0);
      return kg ? xs.reduce((n, s) => n + s.amount, 0) / kg : null;
    };
    const harvestRows = harvests
      .map((h) => {
        const left = harvestLeft(h);
        const flags: string[] = [];
        if (left > 0 && daysBetween(h.on, today) > 2) flags.push(`${left} kg not yet accounted for`);
        if (h.pickedKg && h.spoiledKg / h.pickedKg > rule.spoilPct / 100) flags.push(`${Math.round((h.spoiledKg / h.pickedKg) * 100)}% spoiled`);
        if (h.pickedKg && h.keptKg / h.pickedKg > rule.keptPct / 100) flags.push(`${Math.round((h.keptKg / h.pickedKg) * 100)}% kept or given: ${h.keptNote}`);
        const saleRows = h.sales.map((s) => {
          const avg = avgPrice(h.crop, dateOf(s.at), s.id);
          const drop = avg && s.pricePerKg < avg * (1 - rule.priceDropPct / 100) ? Math.round((1 - s.pricePerKg / avg) * 100) : null;
          if (drop) flags.push(`${s.buyer} paid RM${s.pricePerKg}/kg, ${drop}% under the recent RM${round2(avg!)}`);
          return { ...s, recentAvg: avg == null ? null : round2(avg), dropPct: drop };
        });
        return { ...h, place: placeName(null, h.propertyId), left, sales: saleRows, amount: round2(h.sales.reduce((n, s) => n + s.amount, 0)), flags };
      })
      .sort((a, b) => b.on.localeCompare(a.on));
    const orchards = props
      .filter((p) => p.kind === 'ORCHARD')
      .map((p) => {
        const hs = harvestRows.filter((h) => h.propertyId === p.id && h.on >= addDays(today, -30));
        return {
          id: p.id,
          name: p.name,
          picked30: hs.reduce((n, h) => n + h.pickedKg, 0),
          sold30: round2(hs.reduce((n, h) => n + h.amount, 0)),
          spoiled30: hs.reduce((n, h) => n + h.spoiledKg, 0),
          flags: hs.reduce((n, h) => n + h.flags.length, 0),
        };
      });

    // ---- Planned maintenance ----
    const pmRows = plans
      .map((raw) => {
        const p = pmEffective(raw, orders);
        const wo = raw.openWorkOrderId ? orders.find((o) => o.id === raw.openWorkOrderId) : undefined;
        const days = daysBetween(today, p.nextDueOn);
        const state = p.paused ? 'paused' : days < 0 ? 'overdue' : p.openWorkOrderId ? 'ordered' : days <= rule.pmLeadDays ? 'due' : 'planned';
        return { ...p, place: placeName(p.unitId, p.propertyId), days, state, workOrder: wo ? { id: wo.id, status: wo.status, dueOn: wo.dueOn } : null };
      })
      .sort((a, b) => Number(!!a.paused) - Number(!!b.paused) || a.nextDueOn.localeCompare(b.nextDueOn));

    const bankList = [
      ...stayPayments.filter((p) => !p.banked).map((p) => ({ kind: 'stay' as const, id: p.id, parentId: p.bookingId, label: `${p.bookingRef} ${p.guest}`, on: p.on, amount: p.amount, method: p.method, receiptNo: p.receiptNo, ref: p.ref })),
      ...sales.filter((s) => !s.banked && s.method !== 'CREDIT').map((s) => ({ kind: 'harvest' as const, id: s.id, parentId: s.harvestId, label: `${s.crop}, ${s.buyer}`, on: s.on, amount: s.amount, method: s.method, receiptNo: s.receiptNo, ref: s.ref })),
    ].sort((a, b) => a.on.localeCompare(b.on));

    return {
      role,
      rule,
      today,
      installed,
      can: {
        act: team,
        decide: team && user.assetRole === 'director',
        bank: this.finance(user),
      },
      kpis: {
        contractorsActive: contractors.filter((c) => c.status === 'active').length,
        contractorsToApprove: contractors.filter((c) => c.status === 'pending').length,
        offersToApprove: toLet.reduce((n, u) => n + u.offersToApprove, 0),
        unitsNotAdvertised: toLet.filter((u) => u.flags.some((f) => f.startsWith('Not advertised'))).length,
        metersFlagged: meterRows.filter((m) => m.flags.length).length,
        inHouse: resorts.reduce((n, r) => n + r.inHouse, 0),
        harvestFlags: harvestRows.filter((h) => h.flags.length).length,
        pmOverdue: pmRows.filter((p) => p.state === 'overdue').length,
        pmStatutoryOverdue: pmRows.filter((p) => p.state === 'overdue' && p.statutory).length,
        toBank: bankList.length,
      },
      contractors: contractorRows,
      unlistedContractors: unlisted,
      toLet,
      lostWhy,
      meters: meterRows.sort((a, b) => b.flags.length - a.flags.length || a.place.localeCompare(b.place)),
      resorts,
      harvests: harvestRows,
      orchards,
      credit: sales.filter((s) => s.method === 'CREDIT').map((s) => ({ ...s, place: placeName(null, s.propertyId), days: daysBetween(s.on, today) })),
      plans: pmRows,
      toBank: bankList,
      units: units.map((u) => ({ id: u.id, code: u.code, name: u.name })),
      properties: props.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    };
  }

  // =====================================================================================================================
  // One entry point for the screens and the API: which area, which step, on which record.
  // =====================================================================================================================

  async act(user: User, area: string, action: string, id: string, b: Body): Promise<{ id: Id }> {
    const version = b.version == null ? undefined : Number(b.version);
    switch (`${area}.${action}`) {
      case 'contractor.add':
        return this.contractorAdd(user, b);
      case 'contractor.decide':
        return this.contractorDecide(user, id, b, version);
      case 'contractor.rate':
        return this.contractorRate(user, id, b, version);
      case 'letting.advert':
        return this.lettingAdvert(user, id, b);
      case 'letting.enquiry':
        return this.lettingEnquiry(user, id, b);
      case 'letting.step':
        return this.lettingStep(user, id, b, version);
      case 'meter.read':
        return this.meterRead(user, id, b, version);
      case 'meter.bill':
        return this.meterBill(user, id, b, version);
      case 'resort.rates':
        return this.resortRates(user, id, b);
      case 'resort.policy':
        return this.resortPolicy(user, id, b);
      case 'booking.add':
        return this.bookingAdd(user, b);
      case 'booking.step':
        return this.bookingStep(user, id, b, version);
      case 'room.step':
        return this.roomStep(user, id, b);
      case 'booking.bank':
        return this.bookingBank(user, id, b, version);
      case 'harvest.add':
        return this.harvestAdd(user, b);
      case 'harvest.step':
        return this.harvestStep(user, id, b, version);
      case 'harvest.bank':
        return this.harvestBank(user, id, b, version);
      case 'pm.add':
        return this.pmAdd(user, b);
      case 'pm.raise':
        return { id: 'pm-raise', ...(await this.pmRaise(user)) };
      case 'pm.pause':
        return this.pmPause(user, id, b, version);
      default:
        throw new BadRequest('Unknown Asset Management step.');
    }
  }

  // ---------- Contractors ----------

  async contractorAdd(user: User, b: Body) {
    this.team(user, 'adds contractors');
    const name = text(b.name, 120);
    const ssmNo = text(b.ssmNo, 40);
    const trades = Array.isArray(b.trades) ? [...new Set(b.trades.map((t) => pick(AM_TRADES, t)).filter((t): t is (typeof AM_TRADES)[number] => !!t))] : [];
    const cidbGrade = b.cidbGrade ? (pick(CIDB_GRADES, b.cidbGrade) ?? null) : null;
    const cidbExpiry = b.cidbExpiry ? text(b.cidbExpiry, 10) : null;
    if (name.length < 3) throw new BadRequest('Give the contractor’s registered name.');
    if (ssmNo.length < 5) throw new BadRequest('Give the SSM registration number.');
    if (!trades.length) throw new BadRequest('Choose at least one kind of work.');
    if (b.cidbGrade && !cidbGrade) throw new BadRequest('Choose a CIDB grade G1 to G7, or leave it empty.');
    if (cidbGrade && !isDate(cidbExpiry)) throw new BadRequest('Give the date the CIDB registration ends.');
    const all = await this.store.list('amContractors', {});
    const norm = (s: string) => s.replace(/[^0-9a-z]/gi, '').toLowerCase();
    if (all.some((c) => norm(c.ssmNo) === norm(ssmNo))) throw new BadRequest('A contractor with this SSM number is already on the list.');
    const c: AmContractor = {
      id: this.newId('am-c'),
      name,
      ssmNo,
      trades,
      cidbGrade,
      cidbExpiry: cidbGrade ? cidbExpiry : null,
      states: Array.isArray(b.states) ? b.states.map((s) => text(s, 40)).filter(Boolean).slice(0, 16) : [],
      contactName: text(b.contactName, 120),
      phone: text(b.phone, 30),
      email: text(b.email, 120),
      status: 'pending',
      addedBy: user.name,
      addedById: user.id,
      addedAt: this.now(),
      decisions: [],
      ratings: [],
      version: 1,
    };
    return this.add(user, 'amContractors', c, 'asset.contractor.add', `${name} (${ssmNo}) added, waiting for the Asset Director`);
  }

  async contractorDecide(user: User, id: Id, b: Body, version?: number) {
    this.director(user, 'approves, suspends or blacklists contractors');
    const to = pick(['active', 'suspended', 'blacklisted'] as const, b.status);
    const reason = text(b.reason, 400);
    if (!to) throw new BadRequest('Choose: approve for use, suspend or blacklist.');
    return this.change(user, 'amContractors', id, version, (row) => {
      const c = row as unknown as AmContractor;
      if (c.status === to) throw new BadRequest(`Already ${to}.`);
      if (to === 'active' && c.status === 'pending' && c.addedById === user.id) throw new BadRequest('You added this contractor, so someone else approves it.');
      if (c.status === 'blacklisted' && to === 'active' && reason.length < 10) throw new BadRequest('Taking a contractor off the blacklist needs a full reason.');
      if ((to !== 'active' || c.status !== 'pending') && reason.length < 5) throw new BadRequest('Say why.');
      const decisions = [...c.decisions, { status: to as AmContractorStatus, by: user.name, byId: user.id, at: this.now(), reason: reason || 'Approved for use' }];
      return { patch: { status: to, decisions }, action: `asset.contractor.${to}`, summary: `${c.name}: ${c.status} → ${to}${reason ? `: ${reason}` : ''}` };
    });
  }

  async contractorRate(user: User, id: Id, b: Body, version?: number) {
    this.team(user, 'rates contractors');
    const woId = text(b.workOrderId, 80);
    const quality = Math.round(num(b.quality));
    if (!(quality >= 1 && quality <= 5)) throw new BadRequest('Rate the work 1 (poor) to 5 (very good).');
    const note = text(b.note, 300);
    if (quality <= 2 && note.length < 5) throw new BadRequest('Say what was wrong.');
    const wo = await this.store.get('amWorkOrders', woId);
    if (!wo) throw new NotFound('Work order');
    if (wo.status !== 'done') throw new BadRequest('Rate the work once the job is done.');
    return this.change(user, 'amContractors', id, version, (row) => {
      const c = row as unknown as AmContractor;
      if (!wo.contractor || wo.contractor.trim().toLowerCase() !== c.name.trim().toLowerCase()) throw new BadRequest('That job was not done by this contractor.');
      if (c.ratings.some((r) => r.workOrderId === woId)) throw new BadRequest('That job is already rated.');
      const ratings = [...c.ratings, { workOrderId: woId, quality: quality as 1 | 2 | 3 | 4 | 5, onTime: b.onTime === true, note, by: user.name, byId: user.id, at: this.now() }];
      return { patch: { ratings }, action: 'asset.contractor.rate', summary: `${c.name} rated ${quality}/5 for ${wo.title} (${b.onTime === true ? 'on time' : 'late'})` };
    });
  }

  // ---------- Finding tenants ----------

  private async lettingFor(user: User, unitId: Id) {
    const u = await this.store.get('amUnits', unitId);
    if (!u) throw new NotFound('Unit');
    const ending = u.tenancy && u.tenancy.endOn >= this.today() && daysBetween(this.today(), u.tenancy.endOn) <= this.rule.letBeforeEndDays;
    if (u.status !== 'vacant' && !ending) throw new BadRequest(`${u.code} is not empty and its tenancy is not ending soon.`);
    const id = `let-${u.id}`;
    if (!(await this.store.get('amLettings', id))) {
      const l: AmLetting = { id, unitId: u.id, adverts: [], enquiries: [], version: 1 };
      // Two people opening the same file at once: the second simply uses the first one's.
      await this.add(user, 'amLettings', l, 'asset.letting.open', `${u.code}: letting file opened`).catch((e) => {
        if (!(e instanceof BadRequest)) throw e;
      });
    }
    return { u, id };
  }

  async lettingAdvert(user: User, unitId: Id, b: Body) {
    this.team(user, 'advertises units');
    const channel = pick(AM_AD_CHANNELS, b.channel);
    const on = text(b.on, 10) || this.today();
    const ref = text(b.ref, 160);
    if (!channel) throw new BadRequest('Choose where it is advertised.');
    if (!isDate(on) || on > this.today()) throw new BadRequest('Give the date it went up, not in the future.');
    if (ref.length < 3) throw new BadRequest('Give the listing link, agent name or where the board is.');
    const { u, id } = await this.lettingFor(user, unitId);
    return this.change(user, 'amLettings', id, undefined, (row) => {
      const l = row as unknown as AmLetting;
      const adverts = [...l.adverts, { id: `ad-${u.id}-${l.adverts.length + 1}`, channel, on, ref, by: user.name, at: this.now() }];
      return { patch: { adverts }, action: 'asset.letting.advert', summary: `${u.code} advertised: ${channel.toLowerCase()}, ${ref}` };
    });
  }

  async lettingEnquiry(user: User, unitId: Id, b: Body) {
    this.team(user, 'records enquiries');
    const name = text(b.name, 120);
    const phone = text(b.phone, 30);
    const source = pick(AM_AD_CHANNELS, b.source);
    const use = text(b.use, 200);
    if (name.length < 2) throw new BadRequest('Give the name of the person or business asking.');
    if (!/^[0-9+\-\s]{8,20}$/.test(phone)) throw new BadRequest('Give a phone number to call back.');
    if (!source) throw new BadRequest('Say how they heard about the unit.');
    const { u, id } = await this.lettingFor(user, unitId);
    const today = this.today();
    return this.change(user, 'amLettings', id, undefined, (row) => {
      const l = row as unknown as AmLetting;
      if (l.enquiries.some((x) => x.status === 'signed')) throw new BadRequest(`${u.code} is already let. Add the tenancy on the unit; a new letting starts when it is empty again.`);
      const e: AmEnquiry = {
        id: `enq-${u.id}-${l.enquiries.length + 1}`,
        name,
        phone,
        source,
        on: today,
        use,
        status: 'new',
        viewingOn: null,
        offer: null,
        decision: null,
        signed: null,
        lost: null,
        lastActionOn: today,
        notes: [],
      };
      return { patch: { enquiries: [...l.enquiries, e] }, action: 'asset.letting.enquiry', summary: `${u.code}: enquiry from ${name} (${source.toLowerCase()})` };
    });
  }

  async lettingStep(user: User, unitId: Id, b: Body, version?: number) {
    const step = pick(['viewing', 'note', 'offer', 'decide', 'signed', 'lost'] as const, b.step);
    if (!step) throw new BadRequest('Unknown step.');
    if (step === 'decide') this.director(user, 'approves tenancy offers');
    else this.team(user, 'follows up enquiries');
    const u = await this.store.get('amUnits', unitId);
    if (!u) throw new NotFound('Unit');
    const enquiryId = text(b.enquiryId, 80);
    const today = this.today();
    return this.change(user, 'amLettings', `let-${unitId}`, version, (row) => {
      const l = row as unknown as AmLetting;
      const e = l.enquiries.find((x) => x.id === enquiryId);
      if (!e) throw new NotFound('Enquiry');
      if (e.status === 'signed' || e.status === 'lost') throw new BadRequest('This enquiry is closed.');
      let next: AmEnquiry = { ...e, lastActionOn: today };
      let summary = '';
      let others = l.enquiries;
      switch (step) {
        case 'viewing': {
          const on = text(b.on, 10);
          if (!isDate(on)) throw new BadRequest('Give the viewing date.');
          next = { ...next, status: e.status === 'new' ? 'viewing' : e.status, viewingOn: on };
          summary = `viewing on ${on}`;
          break;
        }
        case 'note': {
          const t = text(b.text, 400);
          if (t.length < 3) throw new BadRequest('Say what happened.');
          next = { ...next, notes: [...e.notes, { on: today, text: t, by: user.name }] };
          summary = `note: ${t}`;
          break;
        }
        case 'offer': {
          if (e.status === 'approved') throw new BadRequest('An offer is already approved. Record the signing, or close this enquiry.');
          if (l.enquiries.some((x) => x.status === 'signed')) throw new BadRequest('This unit is already let to someone else.');
          const rent = money(b.rent);
          const startOn = text(b.startOn, 10);
          const months = Math.round(num(b.months));
          const depositMonths = num(b.depositMonths);
          const reason = text(b.reason, 400);
          if (!(rent > 0)) throw new BadRequest('Give the monthly rent offered.');
          if (!isDate(startOn) || startOn < today) throw new BadRequest('Give the start date, today or later.');
          if (!(months >= 1 && months <= 120)) throw new BadRequest('Give the tenancy length in months.');
          if (!(depositMonths >= 0 && depositMonths <= 6)) throw new BadRequest('Give the deposit in months of rent (0 to 6).');
          if (rent < u.askingRent && reason.length < 10) throw new BadRequest(`RM${rent} is under the asking rent of RM${u.askingRent}. Say why it should be accepted.`);
          next = { ...next, status: 'offer', offer: { rent, startOn, months, depositMonths, reason, by: user.name, byId: user.id, at: this.now() }, decision: null };
          summary = `offer RM${rent}/month from ${startOn} for ${months} months, deposit ${depositMonths} months, waiting for the Asset Director`;
          break;
        }
        case 'decide': {
          if (e.status !== 'offer' || !e.offer) throw new BadRequest('There is no offer waiting.');
          if (e.offer.byId === user.id) throw new BadRequest('You made this offer, so someone else approves it.');
          const approve = b.approve === true;
          const note = text(b.note, 400);
          if (note.length < 3) throw new BadRequest('Give a reason for your decision.');
          next = { ...next, status: approve ? 'approved' : 'viewing', decision: { approve, note, by: user.name, byId: user.id, at: this.now() } };
          summary = `offer ${approve ? 'approved' : 'turned down'}: ${note}`;
          break;
        }
        case 'signed': {
          if (e.status !== 'approved' || !e.decision?.approve) throw new BadRequest('The Asset Director approves the offer before the agreement is signed.');
          const agreementRef = text(b.agreementRef, 60);
          const on = text(b.on, 10);
          if (agreementRef.length < 3) throw new BadRequest('Give the tenancy agreement number.');
          if (!isDate(on) || on > today) throw new BadRequest('Give the date it was signed, not in the future.');
          next = { ...next, status: 'signed', signed: { agreementRef, on, by: user.name, at: this.now() } };
          // Everyone else who asked about this unit is told it is let.
          others = l.enquiries.map((x) =>
            x.id !== e.id && !['signed', 'lost'].includes(x.status) ? { ...x, status: 'lost' as const, lastActionOn: today, lost: { reason: 'UNIT_LET' as const, note: `Let to ${e.name}`, by: user.name, at: this.now() } } : x,
          );
          summary = `agreement ${agreementRef} signed with ${e.name} on ${on}. Add the tenancy on the unit to start billing.`;
          break;
        }
        case 'lost': {
          const reason = pick(AM_LOST_REASONS, b.reason);
          if (!reason) throw new BadRequest('Choose why it did not go ahead.');
          next = { ...next, status: 'lost', lost: { reason, note: text(b.note, 300), by: user.name, at: this.now() } };
          summary = `closed: ${reason.toLowerCase()}`;
          break;
        }
      }
      const enquiries = others.map((x) => (x.id === e.id ? next : x));
      return { patch: { enquiries }, action: `asset.letting.${step}`, summary: `${u.code}, ${e.name}: ${summary}` };
    });
  }

  // ---------- Meters ----------

  async meterRead(user: User, id: Id, b: Body, version?: number) {
    this.team(user, 'reads meters');
    const on = text(b.on, 10) || this.today();
    const reading = num(b.reading);
    const photoRef = text(b.photoRef, 120);
    const newMeter = b.newMeter === true;
    const note = text(b.note, 300);
    if (!isDate(on) || on > this.today()) throw new BadRequest('Give the date read, not in the future.');
    if (!(reading >= 0) || !Number.isFinite(reading)) throw new BadRequest('Give the number on the meter.');
    if (photoRef.length < 3) throw new BadRequest('Take a photo of the meter and give its reference.');
    if (newMeter && note.length < 5) throw new BadRequest('Say why the meter was changed.');
    return this.change(user, 'amMeters', id, version, (row) => {
      const m = row as unknown as AmMeter;
      const last = m.readings.at(-1);
      if (last && on < last.on) throw new BadRequest(`The last reading was on ${last.on}. Readings go in date order.`);
      if (last && !newMeter && reading < last.reading) throw new BadRequest(`${reading} is lower than the last reading ${last.reading}. Check the number, or tick that the meter was changed.`);
      const usage = last && !newMeter ? round2(reading - last.reading) : null;
      const r = { id: `rd-${m.id}-${m.readings.length + 1}-${toMs(this.now())}`, on, reading, usage, photoRef, newMeter, note, by: user.name, at: this.now() };
      return { patch: { readings: [...m.readings, r] }, action: 'asset.meter.read', summary: `${m.account} read ${reading}${usage != null ? ` (used ${usage})` : newMeter ? ' (new meter)' : ''}` };
    });
  }

  async meterBill(user: User, id: Id, b: Body, version?: number) {
    this.team(user, 'records utility bills');
    const period = text(b.period, 7);
    const amount = money(b.amount);
    const billRef = text(b.billRef, 60);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period > this.today().slice(0, 7)) throw new BadRequest('Choose the bill month (YYYY-MM), not a future one.');
    if (!(amount > 0)) throw new BadRequest('Give the bill amount.');
    if (billRef.length < 3) throw new BadRequest('Give the bill or account statement number.');
    return this.change(user, 'amMeters', id, version, (row) => {
      const m = row as unknown as AmMeter;
      if (m.payer !== 'owner') throw new BadRequest('The tenant pays this meter’s bills.');
      if (m.bills.some((x) => x.period === period)) throw new BadRequest(`The ${period} bill is already recorded.`);
      const bills = [...m.bills, { id: `bill-${m.id}-${period}`, period, amount, billRef, by: user.name, at: this.now() }];
      return { patch: { bills }, action: 'asset.meter.bill', summary: `${m.account} ${period} bill RM${amount} (${billRef}) recorded; Finance pays it` };
    });
  }

  // ---------- Resorts ----------

  /**
   * The resort's house rules, set in the app by the Asset Director (Fauzan, 5 Nov 2026): whether the company is
   * registered for service tax, the MOTAC registration, check-in and check-out times, and the cancellation and
   * no-show terms. New bookings copy the terms; existing bookings keep the terms they were made under.
   */
  async resortPolicy(user: User, propertyId: Id, b: Body) {
    this.director(user, 'sets resort house rules');
    const p0 = await this.store.get('amProperties', propertyId);
    if (!p0 || p0.kind !== 'RESORT') throw new NotFound('Resort');
    const checkInTime = text(b.checkInTime, 5);
    const checkOutTime = text(b.checkOutTime, 5);
    const freeCancelDays = num(b.freeCancelDays);
    const lateCancelKeepPct = num(b.lateCancelKeepPct);
    const noShowKeepPct = num(b.noShowKeepPct);
    const motacNo = text(b.motacNo, 60);
    const motacExpiresOn = text(b.motacExpiresOn, 10);
    if (!isHhmm(checkInTime) || !isHhmm(checkOutTime)) throw new BadRequest('Give check-in and check-out times as HH:MM, for example 15:00 and 12:00.');
    if (!(Number.isInteger(freeCancelDays) && freeCancelDays >= 0 && freeCancelDays <= 90)) throw new BadRequest('Give the free cancellation days, 0 to 90.');
    for (const x of [lateCancelKeepPct, noShowKeepPct]) if (!(x >= 0 && x <= 100)) throw new BadRequest('Give the % kept, 0 to 100.');
    if (motacExpiresOn && !isDate(motacExpiresOn)) throw new BadRequest('Give the MOTAC expiry as a date.');
    if (motacExpiresOn && motacNo.length < 3) throw new BadRequest('Give the MOTAC registration number with its expiry.');
    if (typeof b.sstRegistered !== 'boolean') throw new BadRequest('Say whether the company is registered for service tax.');
    const policy: AmStayPolicy = {
      sstRegistered: b.sstRegistered,
      motacNo,
      motacExpiresOn: motacExpiresOn ? (motacExpiresOn as IsoDate) : null,
      checkInTime,
      checkOutTime,
      freeCancelDays,
      lateCancelKeepPct: round2(lateCancelKeepPct),
      noShowKeepPct: round2(noShowKeepPct),
      setBy: user.name,
      setAt: this.now(),
    };
    return this.store.transaction(async (tx) => {
      await tx.lock?.('amProperties', propertyId);
      const p = (await tx.get('amProperties', propertyId))!;
      if (!p.stay) throw new BadRequest('Set the rooms and price list first.');
      const before = p.stay.policy;
      await tx.update('amProperties', p.id, { stay: { ...p.stay, policy } });
      const changes = before
        ? (['sstRegistered', 'motacNo', 'motacExpiresOn', 'checkInTime', 'checkOutTime', 'freeCancelDays', 'lateCancelKeepPct', 'noShowKeepPct'] as const)
            .filter((k) => before[k] !== policy[k])
            .map((k) => `${k} ${String(before[k])} → ${String(policy[k])}`)
            .join('; ') || 'no change'
        : 'first set';
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.resort.policy', entity: 'am_property', entityId: p.id, summary: `${p.name} house rules: ${changes}` });
      return (await tx.get('amProperties', p.id))!;
    });
  }

  async resortRates(user: User, propertyId: Id, b: Body) {
    this.director(user, 'sets resort price lists');
    const p = await this.store.get('amProperties', propertyId);
    if (!p || p.kind !== 'RESORT') throw new NotFound('Resort');
    const capacity: Partial<Record<AmStayType, number>> = {};
    const rates: Partial<Record<AmStayType, number>> = {};
    const capIn = (b.capacity ?? {}) as Record<string, unknown>;
    const rateIn = (b.rates ?? {}) as Record<string, unknown>;
    for (const t of AM_STAY_TYPES) {
      const cap = Math.round(num(capIn[t] ?? 0));
      if (!(cap >= 0 && cap <= 500)) throw new BadRequest(`Give how many ${t.toLowerCase()}s (0 to 500).`);
      if (!cap) continue;
      const rate = money(rateIn[t]);
      if (!(rate > 0)) throw new BadRequest(`Give the price per night for ${t.toLowerCase()}s.`);
      capacity[t] = cap;
      rates[t] = rate;
    }
    if (!Object.keys(capacity).length) throw new BadRequest('Give at least one kind of room.');
    const before = p.stay ? JSON.stringify(p.stay.rates) : 'none';
    // Taxes and fees: kept as they are unless the form sends them.
    let taxes: AmStayTaxes | undefined = p.stay?.taxes;
    if (b.taxes && typeof b.taxes === 'object') {
      const t = b.taxes as Record<string, unknown>;
      const sstPct = num(t.sstPct ?? 0);
      const tourismTaxPerNight = money(t.tourismTaxPerNight ?? 0);
      const stateFeePerNight = money(t.stateFeePerNight ?? 0);
      if (!(sstPct >= 0 && sstPct <= 20) || !(tourismTaxPerNight >= 0 && tourismTaxPerNight <= 100) || !(stateFeePerNight >= 0 && stateFeePerNight <= 100))
        throw new BadRequest('Give the service tax % (0 to 20) and the per-night taxes in RM.');
      taxes = { sstPct, tourismTaxPerNight, stateFeePerNight, stateFeeName: text(t.stateFeeName, 80), note: text(t.note, 300) };
    }
    return this.store.transaction(async (tx) => {
      await tx.lock?.('amProperties', p.id);
      // Rooms already sold stay sold: the count cannot drop below what any future night already has booked.
      const today = this.today();
      const all = await tx.list('amBookings', { propertyId: p.id });
      for (const t of AM_STAY_TYPES) {
        const mine = all.filter((x) => x.type === t && bookingHolds(x, today) && x.checkOut > today);
        if (!mine.length) continue;
        const last = mine.reduce((m, x) => (x.checkOut > m ? x.checkOut : m), today);
        const peak = Math.max(0, ...nightsTaken(all, p.id, t, today, last, today).map((n) => n.taken));
        if ((capacity[t] ?? 0) < peak) throw new BadRequest(`${peak} ${t.toLowerCase()}s are already booked on one night. Move or cancel bookings before lowering the count.`);
      }
      // Numbered rooms follow the counts: new numbers are added at the end; a room is removed only if it is free.
      const fresh = (await tx.get('amProperties', p.id))!;
      const oldRooms = fresh.stay?.rooms ?? [];
      const inUse = new Set(all.filter((x) => x.status === 'checked_in').flatMap((x) => x.roomNos ?? []));
      const rooms: AmRoom[] = [];
      for (const t of ['ROOM', 'CHALET'] as const) {
        const mineR = oldRooms.filter((r) => r.type === t);
        const want = capacity[t] ?? 0;
        const keep = mineR.slice(0, want);
        for (const r of mineR.slice(want)) if (inUse.has(r.no)) throw new BadRequest(`${r.no} has a guest in it; it cannot be removed.`);
        for (let i = keep.length; i < want; i++) {
          const no = `${t === 'ROOM' ? 'R' : 'C'}${String(i + 1).padStart(2, '0')}`;
          keep.push({ no, type: t, hk: 'clean', hkBy: user.name, hkAt: this.now(), out: null });
        }
        rooms.push(...keep);
      }
      await tx.update('amProperties', p.id, { stay: { capacity, rates, setBy: user.name, setAt: this.now(), rooms, ...(taxes ? { taxes } : {}) } });
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.resort.rates', entity: 'am_property', entityId: p.id, summary: `${p.name} price list ${before} → ${JSON.stringify(rates)}` });
      return (await tx.get('amProperties', p.id))!;
    });
  }

  async bookingAdd(user: User, b: Body) {
    this.team(user, 'takes resort bookings');
    const p = await this.store.get('amProperties', text(b.propertyId, 80));
    if (!p || p.kind !== 'RESORT') throw new NotFound('Resort');
    if (!p.stay) throw new BadRequest('The Asset Director sets this resort’s rooms and price list first.');
    const type = pick(AM_STAY_TYPES, b.type);
    const qty = Math.round(num(b.qty));
    const checkIn = text(b.checkIn, 10);
    const checkOut = text(b.checkOut, 10);
    const guest = text(b.guest, 120);
    const phone = text(b.phone, 30);
    const internal = b.internal === true;
    const billTo = text(b.billTo, 160);
    const today = this.today();
    if (!type || !(p.stay.capacity[type] ?? 0)) throw new BadRequest('Choose a kind of room this resort has.');
    if (!(qty >= 1)) throw new BadRequest('Give how many.');
    if (!isDate(checkIn) || checkIn < today) throw new BadRequest('Give the arrival date, today or later.');
    if (!isDate(checkOut) || checkOut <= checkIn) throw new BadRequest('Give the departure date, after arrival.');
    if (daysBetween(checkIn, checkOut) > 30) throw new BadRequest('A stay over 30 nights is a tenancy, not a booking.');
    if (guest.length < 2) throw new BadRequest('Give the guest or group name.');
    if (!internal && !/^[0-9+\-\s]{8,20}$/.test(phone)) throw new BadRequest('Give a phone number for the guest.');
    if (internal && billTo.length < 3) throw new BadRequest('Say which group company, branch or department it is billed to.');
    const listRate = p.stay.rates[type]!;
    const rate = b.rate == null || b.rate === '' ? listRate : money(b.rate);
    const discountReason = text(b.discountReason, 300);
    if (!(rate > 0)) throw new BadRequest('Give the price per night.');
    if (rate > listRate) throw new BadRequest(`The price list says RM${listRate}. Ask the Asset Director to change the list instead of charging more.`);
    if (rate < listRate && discountReason.length < 5) throw new BadRequest(`RM${rate} is under the price list (RM${listRate}). Say why.`);
    return this.store.transaction(async (tx) => {
      // One booking at a time per resort, so two people cannot sell the last room twice.
      await tx.lock?.('amProperties', p.id);
      const all = await tx.list('amBookings', { propertyId: p.id });
      const stay = (await tx.get('amProperties', p.id))!.stay;
      const full = nightsTaken(all, p.id, type, checkIn, checkOut, today).filter((n) => n.taken + qty > sellable(stay, type, n.night));
      if (full.length)
        throw new BadRequest(`Not enough ${type.toLowerCase()}s on ${full.map((n) => `${n.night} (${Math.max(0, sellable(stay, type, n.night) - n.taken)} left)`).join(', ')}.`);
      const n = all.length + 1;
      const row: AmBooking = {
        id: this.newId('am-b'),
        ref: `BK-${p.id.replace(/\D/g, '')}-${String(n).padStart(4, '0')}-${toMs(this.now()) % 10000}`,
        propertyId: p.id,
        guest,
        phone,
        internal,
        billTo: internal ? billTo : '',
        type,
        qty,
        checkIn,
        checkOut,
        rate,
        listRate,
        discountReason: rate < listRate ? discountReason : '',
        status: internal ? 'confirmed' : 'held',
        holdUntil: addDays(today, this.rule.holdDays),
        payments: [],
        by: user.name,
        byId: user.id,
        at: this.now(),
        history: [{ at: this.now(), by: user.name, what: internal ? `Confirmed, billed to ${billTo}` : `Held until ${addDays(today, this.rule.holdDays)} for a deposit` }],
        version: 1,
        // Not registered for service tax: none is charged. Terms (times, cancellation) are fixed at booking.
        taxRates: p.stay!.taxes ? { ...p.stay!.taxes, sstPct: p.stay!.policy && !p.stay!.policy.sstRegistered ? 0 : p.stay!.taxes.sstPct } : null,
        terms: p.stay!.policy
          ? {
              checkInTime: p.stay!.policy.checkInTime,
              checkOutTime: p.stay!.policy.checkOutTime,
              freeCancelDays: p.stay!.policy.freeCancelDays,
              lateCancelKeepPct: p.stay!.policy.lateCancelKeepPct,
              noShowKeepPct: p.stay!.policy.noShowKeepPct,
            }
          : null,
        settlement: null,
        foreign: b.foreign === true,
        register: null,
        roomNos: [],
        charges: [],
      };
      await tx.insert('amBookings', row);
      await tx.audit({
        at: this.now(),
        actor: user.name,
        companyId: null,
        action: 'asset.booking.add',
        entity: 'amBookings',
        entityId: row.id,
        summary: `${p.name}: ${qty} ${type.toLowerCase()} ${checkIn} to ${checkOut} for ${guest} at RM${rate}${rate < listRate ? ` (list RM${listRate}: ${discountReason})` : ''}`,
      });
      return row;
    });
  }

  async bookingStep(user: User, id: Id, b: Body, version?: number) {
    this.team(user, 'runs resort bookings');
    const step = pick(['pay', 'confirm', 'checkin', 'checkout', 'cancel', 'noshow', 'charge', 'refund'] as const, b.step);
    if (!step) throw new BadRequest('Unknown step.');
    if (step === 'checkin' || step === 'checkout') return this.frontDesk(user, id, step, b, version);
    const today = this.today();
    return this.change(user, 'amBookings', id, version, (row) => {
      const k = row as unknown as AmBooking;
      const total = bookingTotal(k);
      const paid = bookingPaid(k);
      let patch: Partial<AmBooking> = {};
      let what = '';
      switch (step) {
        case 'pay': {
          if (['cancelled', 'no_show'].includes(k.status)) throw new BadRequest('This booking is closed; Finance handles any refund or charge.');
          if (k.internal) throw new BadRequest('A group booking is billed to its company, not paid at the counter.');
          if (k.status === 'held' && k.holdUntil < today) throw new BadRequest('The hold has lapsed and the rooms may be sold. Make a new booking, then take the deposit.');
          const amount = money(b.amount);
          const method = pick(['CASH', 'TRANSFER', 'CARD', 'ONLINE'] as const, b.method);
          const ref = text(b.ref, 60);
          const on = text(b.on, 10) || today;
          if (!(amount > 0)) throw new BadRequest('Give the amount received.');
          if (!method) throw new BadRequest('Choose how it was paid.');
          if (method !== 'CASH' && ref.length < 3) throw new BadRequest('Give the bank, card or online reference.');
          if (!isDate(on) || on > today) throw new BadRequest('Give the date received, not in the future.');
          if (paid + amount > total + 0.001) throw new BadRequest(`That is more than the RM${round2(total - paid)} still due.`);
          const receiptNo = `RS-${k.ref}-${k.payments.length + 1}`;
          patch = { payments: [...k.payments, { id: `sp-${k.id}-${k.payments.length + 1}`, on, amount, method, receiptNo, ref, by: user.name, at: this.now(), banked: null }] };
          what = `RM${amount} ${method.toLowerCase()} received, receipt ${receiptNo}`;
          break;
        }
        case 'confirm': {
          if (k.status !== 'held') throw new BadRequest('Only a held booking is confirmed.');
          if (k.holdUntil < today) throw new BadRequest('The hold has lapsed. Make a new booking if the rooms are still free.');
          const need = round2((total * this.rule.depositPct) / 100);
          if (paid < need) throw new BadRequest(`Record the deposit first: at least RM${need} (${this.rule.depositPct}%).`);
          patch = { status: 'confirmed' };
          what = 'Confirmed';
          break;
        }
        case 'charge': {
          if (!['confirmed', 'checked_in'].includes(k.status)) throw new BadRequest('Extras go on a confirmed or in-house booking.');
          const whatFor = text(b.what, 120);
          const amount = money(b.amount);
          const reason = text(b.reason, 300);
          if (whatFor.length < 2) throw new BadRequest('Say what the charge is for (meal, extra bed, activity).');
          if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 50_000) throw new BadRequest('Give the amount in RM.');
          if (amount < 0 && reason.length < 5) throw new BadRequest('A minus line corrects an earlier charge. Say why.');
          const charges = [...(k.charges ?? []), { id: `ch-${k.id}-${(k.charges ?? []).length + 1}`, on: today, what: whatFor, amount, reason, by: user.name, at: this.now() }];
          patch = { charges };
          what = `${amount < 0 ? 'Correction' : 'Charge'} ${whatFor} RM${amount}${reason ? ` (${reason})` : ''}`;
          break;
        }
        default:
          throw new BadRequest('Unknown step.');
        case 'cancel':
        case 'noshow': {
          if (!['held', 'confirmed'].includes(k.status)) throw new BadRequest('Only a held or confirmed booking is cancelled or marked no-show.');
          if (step === 'noshow' && today < k.checkIn) throw new BadRequest('A no-show is marked on or after the arrival date.');
          const reason = text(b.reason, 300);
          if (reason.length < 3) throw new BadRequest('Say why.');
          // The terms agreed at booking decide what is kept; with no terms on record, the Asset Director decides.
          const set = cancelSettlement(paid, k.terms, step, daysBetween(today, k.checkIn));
          patch = { status: step === 'cancel' ? 'cancelled' : 'no_show', settlement: set ? { ...set, refunded: 0 } : null };
          what = `${step === 'cancel' ? 'Cancelled' : 'No-show'}: ${reason}`;
          if (paid && set) what += `. Under the terms RM${set.keep} (${set.keepPct}%) is kept and RM${set.refundDue} is owed back.`;
          else if (paid) what += `. RM${paid} received; no terms on record, so the Asset Director decides what is refunded.`;
          break;
        }
        case 'refund': {
          const set = k.settlement;
          if (!['cancelled', 'no_show'].includes(k.status) || !set) throw new BadRequest('A refund is paid only on a cancelled or no-show booking with terms.');
          const amount = money(b.amount);
          const method = pick(['CASH', 'TRANSFER', 'CARD', 'ONLINE'] as const, b.method);
          const ref = text(b.ref, 60);
          const left = round2(set.refundDue - set.refunded);
          if (!(amount > 0)) throw new BadRequest('Give the amount paid back.');
          if (amount > left + 0.001) throw new BadRequest(`Only RM${left} is owed back.`);
          if (!method) throw new BadRequest('Choose how it was paid back.');
          if (method !== 'CASH' && ref.length < 3) throw new BadRequest('Give the bank, card or online reference.');
          // Recorded as a minus payment, so Finance confirms it against the bank like any other.
          const receiptNo = `RF-${k.ref}-${k.payments.length + 1}`;
          patch = {
            payments: [...k.payments, { id: `sp-${k.id}-${k.payments.length + 1}`, on: today, amount: -amount, method, receiptNo, ref, by: user.name, at: this.now(), banked: null }],
            settlement: { ...set, refunded: round2(set.refunded + amount) },
          };
          what = `RM${amount} paid back by ${method.toLowerCase()}, slip ${receiptNo}`;
          break;
        }
      }
      return { patch: { ...patch, history: [...k.history, { at: this.now(), by: user.name, what }] }, action: `asset.booking.${step}`, summary: `${k.ref} ${k.guest}: ${what}` };
    });
  }

  /**
   * Check-in and check-out, as a front desk does it. Check-in takes the guest register (ID type, number, nationality;
   * Innkeepers Act 1952) and gives clean or inspected rooms that nobody is in. Check-out needs the bill paid (a group
   * booking is billed to its company) and leaves the rooms dirty for housekeeping.
   */
  private async frontDesk(user: User, id: Id, step: 'checkin' | 'checkout', b: Body, version?: number) {
    const today = this.today();
    return this.store.transaction(async (tx) => {
      const k0 = await tx.get('amBookings', id);
      if (!k0) throw new NotFound('Booking');
      await tx.lock?.('amProperties', k0.propertyId);
      await tx.lock?.('amBookings', id);
      const k = (await tx.get('amBookings', id))!;
      if (version != null && Number.isFinite(version) && version !== k.version) throw new BadRequest('Someone changed this booking a moment ago. Reload and try again.');
      const p = (await tx.get('amProperties', k.propertyId))!;
      const stay = p.stay as AmStaySetup;
      const rooms = stay.rooms ?? [];
      let patch: Partial<AmBooking>;
      let what: string;
      let newRooms = rooms;
      if (step === 'checkin') {
        if (k.status !== 'confirmed') throw new BadRequest('Only a confirmed booking checks in.');
        if (today < k.checkIn) throw new BadRequest(`Check-in is from ${k.checkIn}.`);
        if (today >= k.checkOut) throw new BadRequest('The stay dates have passed.');
        const idType = pick(['MYKAD', 'PASSPORT', 'OTHER'] as const, b.idType);
        const idNo = text(b.idNo, 30);
        const nationality = text(b.nationality, 60);
        if (!idType || idNo.length < 5) throw new BadRequest('Record the guest’s ID: MyKad, passport or other, and its number.');
        if (nationality.length < 2) throw new BadRequest('Give the guest’s nationality.');
        const foreign = !/^(malaysia|malaysian|my|warganegara malaysia)$/i.test(nationality);
        if (idType === 'MYKAD' && foreign) throw new BadRequest('A MyKad holder is Malaysian. Check the nationality.');
        let roomNos: string[] = [];
        if (isSleepType(k.type) && rooms.some((r) => r.type === k.type)) {
          const asked = Array.isArray(b.roomNos) ? b.roomNos : typeof b.roomNos === 'string' ? b.roomNos.split(/[\s,]+/) : [];
          roomNos = [...new Set(asked.map((x) => text(x, 10).toUpperCase()).filter(Boolean))];
          if (roomNos.length !== k.qty) throw new BadRequest(`Give ${k.qty} ${k.type.toLowerCase()} number(s).`);
          const busy = new Set((await tx.list('amBookings', { propertyId: p.id })).filter((x) => x.status === 'checked_in').flatMap((x) => x.roomNos ?? []));
          for (const no of roomNos) {
            const r = rooms.find((x) => x.no === no && x.type === k.type);
            if (!r) throw new BadRequest(`${no} is not a ${k.type.toLowerCase()} here.`);
            if (r.out && r.out.from <= today && today <= r.out.until) throw new BadRequest(`${no} is out of order.`);
            if (busy.has(no)) throw new BadRequest(`${no} already has a guest.`);
            if (r.hk === 'dirty') throw new BadRequest(`${no} is not cleaned yet.`);
          }
        }
        patch = { status: 'checked_in', register: { idType, idNo, nationality, by: user.name, at: this.now() }, foreign, roomNos };
        what = `Checked in${roomNos.length ? ` to ${roomNos.join(', ')}` : ''}; ${foreign ? 'foreign guest (tourism tax applies)' : 'Malaysian guest'}`;
      } else {
        if (k.status !== 'checked_in') throw new BadRequest('Only a guest who checked in checks out.');
        const bill = bookingBill(k);
        const paid = bookingPaid(k);
        if (!k.internal && paid + 0.001 < bill.total) throw new BadRequest(`RM${round2(bill.total - paid)} is still due. Record the payment before check-out.`);
        newRooms = rooms.map((r) => ((k.roomNos ?? []).includes(r.no) ? { ...r, hk: 'dirty' as const, hkBy: user.name, hkAt: this.now() } : r));
        patch = { status: 'checked_out' };
        what = k.internal ? `Checked out; RM${bill.total} to bill to ${k.billTo}` : `Checked out, paid in full (RM${bill.total})`;
      }
      await tx.update('amBookings', k.id, { ...patch, history: [...k.history, { at: this.now(), by: user.name, what }], version: k.version + 1 });
      if (newRooms !== rooms) await tx.update('amProperties', p.id, { stay: { ...stay, rooms: newRooms } });
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: `asset.booking.${step}`, entity: 'amBookings', entityId: k.id, summary: `${k.ref} ${k.guest}: ${what}` });
      return (await tx.get('amBookings', k.id))!;
    });
  }

  /** Housekeeping and out-of-order rooms. A room out of order is not sold; one with a guest in it is not taken out. */
  async roomStep(user: User, propertyId: Id, b: Body) {
    this.team(user, 'runs housekeeping');
    const step = pick(['status', 'out', 'back'] as const, b.step);
    if (!step) throw new BadRequest('Unknown step.');
    const no = text(b.roomNo, 10).toUpperCase();
    const today = this.today();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('amProperties', propertyId);
      const p = await tx.get('amProperties', propertyId);
      if (!p || p.kind !== 'RESORT' || !p.stay) throw new NotFound('Resort');
      const rooms = p.stay.rooms ?? [];
      const r = rooms.find((x) => x.no === no);
      if (!r) throw new NotFound('Room');
      const all = await tx.list('amBookings', { propertyId });
      const occupied = all.some((x) => x.status === 'checked_in' && (x.roomNos ?? []).includes(no));
      let next: AmRoom;
      let what: string;
      if (step === 'status') {
        const hk = pick(['dirty', 'clean', 'inspected'] as const, b.hk) as AmHousekeeping | undefined;
        if (!hk) throw new BadRequest('Choose dirty, clean or inspected.');
        if (hk === 'inspected' && r.hk === 'dirty') throw new BadRequest('Clean the room before it is inspected.');
        if (hk === 'inspected' && r.hkBy === user.name && r.hk === 'clean') throw new BadRequest('You cleaned this room, so someone else inspects it.');
        next = { ...r, hk, hkBy: user.name, hkAt: this.now() };
        what = `${no} ${hk}`;
      } else if (step === 'out') {
        const from = text(b.from, 10) || today;
        const until = text(b.until, 10);
        const reason = text(b.reason, 300);
        if (!isDate(from) || from < today || !isDate(until) || until < from) throw new BadRequest('Give the dates it is out of order, from today on.');
        if (reason.length < 5) throw new BadRequest('Say what is wrong (raise a work order for the repair).');
        if (occupied && from <= today) throw new BadRequest(`${no} has a guest in it. Move the guest first.`);
        const stayIf = { ...p.stay, rooms: rooms.map((x) => (x.no === no ? { ...x, out: { from, until, reason, by: user.name, at: this.now() } } : x)) };
        const clash = nightsTaken(all, propertyId, r.type, from, addDays(until, 1), today).filter((n) => n.taken > sellable(stayIf, r.type, n.night));
        if (clash.length) throw new BadRequest(`Taking ${no} out would leave too few ${r.type.toLowerCase()}s on ${clash.map((n) => n.night).join(', ')}. Move bookings first.`);
        next = { ...r, out: { from, until, reason, by: user.name, at: this.now() } };
        what = `${no} out of order ${from} to ${until}: ${reason}`;
      } else {
        if (!r.out) throw new BadRequest(`${no} is not out of order.`);
        next = { ...r, out: null, hk: 'dirty', hkBy: user.name, hkAt: this.now() };
        what = `${no} back in service (to be cleaned)`;
      }
      await tx.update('amProperties', propertyId, { stay: { ...p.stay, rooms: rooms.map((x) => (x.no === no ? next : x)) } });
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: `asset.room.${step}`, entity: 'am_property', entityId: propertyId, summary: `${p.name}: ${what}` });
      return { id: propertyId, room: next };
    });
  }

  async bookingBank(user: User, id: Id, b: Body, version?: number) {
    if (!this.finance(user)) throw new AccessDenied('view', '(Finance confirms payments in the bank)');
    const paymentId = text(b.paymentId, 120);
    const on = text(b.on, 10);
    const slipRef = text(b.slipRef, 40);
    return this.change(user, 'amBookings', id, version, (row) => {
      const k = row as unknown as AmBooking;
      const p = k.payments.find((x) => x.id === paymentId);
      if (!p) throw new NotFound('Payment');
      if (p.banked) throw new BadRequest('Already confirmed in the bank.');
      if (!isDate(on) || on < p.on || on > this.today() || slipRef.length < 3) throw new BadRequest('Give the bank date (on or after receipt, not in the future) and the slip or statement reference.');
      const payments = k.payments.map((x) => (x.id === p.id ? { ...x, banked: { on, slipRef, by: user.name } } : x));
      return { patch: { payments }, action: 'asset.booking.banked', summary: `${k.ref} receipt ${p.receiptNo} RM${p.amount} confirmed in the bank (${slipRef})` };
    });
  }

  // ---------- Harvest ----------

  async harvestAdd(user: User, b: Body) {
    this.team(user, 'records harvests');
    const p = await this.store.get('amProperties', text(b.propertyId, 80));
    if (!p || p.kind !== 'ORCHARD') throw new NotFound('Orchard');
    const on = text(b.on, 10) || this.today();
    const crop = text(b.crop, 60);
    const pickedKg = round2(num(b.pickedKg));
    const photoRef = text(b.photoRef, 120);
    if (!isDate(on) || on > this.today()) throw new BadRequest('Give the picking date, not in the future.');
    if (crop.length < 2) throw new BadRequest('Say what was picked.');
    if (!(pickedKg > 0) || pickedKg > 200_000) throw new BadRequest('Give the weight picked in kg.');
    if (photoRef.length < 3) throw new BadRequest('Take a photo of the pick on the scale and give its reference.');
    const h: AmHarvest = {
      id: this.newId('am-h'),
      propertyId: p.id,
      on,
      crop,
      pickedKg,
      photoRef,
      sales: [],
      spoiledKg: 0,
      keptKg: 0,
      keptNote: '',
      by: user.name,
      at: this.now(),
      history: [{ at: this.now(), by: user.name, what: `Picked ${pickedKg} kg` }],
      version: 1,
    };
    return this.add(user, 'amHarvests', h, 'asset.harvest.add', `${p.name}: ${pickedKg} kg ${crop} picked on ${on}`);
  }

  async harvestStep(user: User, id: Id, b: Body, version?: number) {
    this.team(user, 'records harvest sales');
    const step = pick(['sale', 'spoiled', 'kept'] as const, b.step);
    if (!step) throw new BadRequest('Unknown step.');
    return this.change(user, 'amHarvests', id, version, (row) => {
      const h = row as unknown as AmHarvest;
      const left = harvestLeft(h);
      let patch: Partial<AmHarvest> = {};
      let what = '';
      const kg = round2(num(b.kg));
      if (!(kg > 0)) throw new BadRequest('Give the weight in kg.');
      if (kg > left + 0.001) throw new BadRequest(`Only ${left} kg of this pick is left to account for.`);
      if (step === 'sale') {
        const buyer = text(b.buyer, 120);
        const pricePerKg = money(b.pricePerKg);
        const slipRef = text(b.slipRef, 40);
        const method = pick(['CASH', 'TRANSFER', 'CREDIT'] as const, b.method);
        const ref = text(b.ref, 60);
        if (buyer.length < 2) throw new BadRequest('Give the buyer.');
        if (!(pricePerKg > 0)) throw new BadRequest('Give the price per kg.');
        if (slipRef.length < 3) throw new BadRequest('Give the weighing slip number.');
        if (!method) throw new BadRequest('Choose cash, transfer or credit (pay later).');
        if (method === 'TRANSFER' && ref.length < 3) throw new BadRequest('Give the bank reference.');
        const amount = round2(kg * pricePerKg);
        const n = h.sales.length + 1;
        const sale = {
          id: `hs-${h.id}-${n}`,
          buyer,
          kg,
          pricePerKg,
          amount,
          slipRef,
          method,
          receiptNo: method === 'CREDIT' ? '' : `RH-${h.id}-${n}`,
          ref,
          by: user.name,
          at: this.now(),
          banked: null,
        };
        patch = { sales: [...h.sales, sale] };
        what = `Sold ${kg} kg to ${buyer} at RM${pricePerKg}/kg = RM${amount} (${method.toLowerCase()}, slip ${slipRef})`;
      } else if (step === 'spoiled') {
        const note = text(b.note, 300);
        if (note.length < 3) throw new BadRequest('Say what spoiled it.');
        patch = { spoiledKg: round2(h.spoiledKg + kg) };
        what = `${kg} kg spoiled: ${note}`;
      } else {
        const note = text(b.note, 300);
        if (note.length < 5) throw new BadRequest('Say who it went to and why.');
        patch = { keptKg: round2(h.keptKg + kg), keptNote: [h.keptNote, note].filter(Boolean).join('; ') };
        what = `${kg} kg kept or given: ${note}`;
      }
      return { patch: { ...patch, history: [...h.history, { at: this.now(), by: user.name, what }] }, action: `asset.harvest.${step}`, summary: `${h.crop} ${h.on}: ${what}` };
    });
  }

  async harvestBank(user: User, id: Id, b: Body, version?: number) {
    if (!this.finance(user)) throw new AccessDenied('view', '(Finance confirms payments in the bank)');
    const saleId = text(b.saleId, 120);
    const on = text(b.on, 10);
    const slipRef = text(b.slipRef, 40);
    return this.change(user, 'amHarvests', id, version, (row) => {
      const h = row as unknown as AmHarvest;
      const s = h.sales.find((x) => x.id === saleId);
      if (!s) throw new NotFound('Sale');
      if (s.banked) throw new BadRequest('Already confirmed in the bank.');
      if (!isDate(on) || on < dateOf(s.at) || on > this.today() || slipRef.length < 3) throw new BadRequest('Give the bank date (on or after the sale, not in the future) and the slip or statement reference.');
      const sales = h.sales.map((x) => (x.id === s.id ? { ...x, banked: { on, slipRef, by: user.name } } : x));
      return { patch: { sales }, action: 'asset.harvest.banked', summary: `${h.crop} sale to ${s.buyer} RM${s.amount} confirmed in the bank (${slipRef})${s.method === 'CREDIT' ? ', credit sale now paid' : ''}` };
    });
  }

  // ---------- Planned maintenance ----------

  async pmAdd(user: User, b: Body) {
    this.team(user, 'plans maintenance');
    const unitId = b.unitId ? text(b.unitId, 80) : null;
    const propertyId = b.propertyId ? text(b.propertyId, 80) : null;
    if (!!unitId === !!propertyId) throw new BadRequest('Choose one unit or one property.');
    if (unitId && !(await this.store.get('amUnits', unitId))) throw new NotFound('Unit');
    if (propertyId && !(await this.store.get('amProperties', propertyId))) throw new NotFound('Property');
    const task = text(b.task, 160);
    const trade = pick(AM_TRADES, b.trade);
    const everyMonths = Math.round(num(b.everyMonths));
    const nextDueOn = text(b.nextDueOn, 10);
    if (task.length < 3) throw new BadRequest('Say what is done.');
    if (!trade) throw new BadRequest('Choose the kind of work.');
    if (!(everyMonths >= 1 && everyMonths <= 120)) throw new BadRequest('Give how often, in months (1 to 120).');
    if (!isDate(nextDueOn)) throw new BadRequest('Give the next due date.');
    const p: AmPmPlan = {
      id: this.newId('am-pm'),
      unitId,
      propertyId,
      task,
      trade,
      everyMonths,
      nextDueOn,
      lastDoneOn: null,
      statutory: b.statutory === true,
      openWorkOrderId: null,
      paused: null,
      by: user.name,
      at: this.now(),
      history: [{ at: this.now(), by: user.name, what: `Planned every ${everyMonths} months from ${nextDueOn}` }],
      version: 1,
    };
    return this.add(user, 'amPmPlans', p, 'asset.pm.add', `${task} every ${everyMonths} months from ${nextDueOn}${p.statutory ? ' (required by law or licence)' : ''}`);
  }

  /** Turn every planned job due within the lead time into a work order, once; a finished job moves its plan on. */
  async pmRaise(user: User) {
    this.team(user, 'raises planned work orders');
    const today = this.today();
    const lead = addDays(today, this.rule.pmLeadDays);
    return this.store.transaction(async (tx) => {
      const plans = await tx.list('amPmPlans', {});
      const orders = await tx.list('amWorkOrders', {});
      const raised: { planId: Id; workOrderId: Id; task: string }[] = [];
      const rolled: Id[] = [];
      for (const raw of plans) {
        await tx.lock?.('amPmPlans', raw.id);
        const fresh = (await tx.get('amPmPlans', raw.id))!;
        const p = pmEffective(fresh, orders);
        let patch: Partial<AmPmPlan> = {};
        const history = [...fresh.history];
        if (p.rolled) {
          patch = { lastDoneOn: p.lastDoneOn, nextDueOn: p.nextDueOn, openWorkOrderId: null };
          history.push({ at: this.now(), by: user.name, what: `Done ${p.lastDoneOn}; next due ${p.nextDueOn}` });
          rolled.push(p.id);
        }
        if (!p.paused && !p.openWorkOrderId && p.nextDueOn <= lead) {
          const woId = `am-wo-pm-${p.id}-${p.nextDueOn}`;
          if (!orders.some((o) => o.id === woId)) {
            const wo: AmWorkOrder = {
              id: woId,
              unitId: p.unitId,
              propertyId: p.propertyId,
              title: p.task,
              source: 'planned',
              raisedOn: today,
              dueOn: p.nextDueOn < today ? today : p.nextDueOn,
              status: 'open',
              cost: null,
              contractor: null,
              doneOn: null,
            };
            await tx.insert('amWorkOrders', wo);
            await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.pm.raised', entity: 'am_work_order', entityId: woId, summary: `Planned job raised: ${p.task}, due ${p.nextDueOn}` });
            raised.push({ planId: p.id, workOrderId: woId, task: p.task });
          }
          patch = { ...patch, openWorkOrderId: woId };
          history.push({ at: this.now(), by: user.name, what: `Work order ${woId} raised, due ${p.nextDueOn}` });
        }
        if (Object.keys(patch).length) await tx.update('amPmPlans', p.id, { ...patch, history, version: fresh.version + 1 });
      }
      return { raised, rolled };
    });
  }

  async pmPause(user: User, id: Id, b: Body, version?: number) {
    this.team(user, 'pauses planned maintenance');
    const resume = b.resume === true;
    const reason = text(b.reason, 300);
    if (reason.length < 5) throw new BadRequest('Say why.');
    const plan = await this.store.get('amPmPlans', id);
    const openOrder = plan?.openWorkOrderId ? await this.store.get('amWorkOrders', plan.openWorkOrderId) : undefined;
    return this.change(user, 'amPmPlans', id, version, (row) => {
      const p = row as unknown as AmPmPlan;
      if (p.statutory && user.assetRole !== 'director') throw new AccessDenied('view', '(only the Asset Director pauses or resumes work the law or a licence requires)');
      if (resume ? !p.paused : !!p.paused) throw new BadRequest(resume ? 'It is not paused.' : 'It is already paused.');
      if (!resume && p.openWorkOrderId && openOrder?.status !== 'done') throw new BadRequest('A work order is open for it. Finish or close that first.');
      const what = `${resume ? 'Resumed' : 'Paused'}: ${reason}`;
      return {
        patch: { paused: resume ? null : { by: user.name, at: this.now(), reason }, history: [...p.history, { at: this.now(), by: user.name, what }] },
        action: `asset.pm.${resume ? 'resume' : 'pause'}`,
        summary: `${p.task}: ${what}`,
      };
    });
  }
}