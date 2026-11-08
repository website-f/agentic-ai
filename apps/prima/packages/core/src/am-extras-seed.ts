import { addMonths } from "./am-extras";
import { bookingBill } from "./am-extras";
import { isSleepType } from "./am-extras";
import type { AmBooking } from "./am-extras";
import type { AmRoom } from "./am-extras";
import type { AmStayTaxes } from "./am-extras";
import type { AmContractor } from "./am-extras";
import type { AmHarvest } from "./am-extras";
import type { AmLetting } from "./am-extras";
import type { AmMeter } from "./am-extras";
import type { AmPmPlan } from "./am-extras";
import { addDays } from "./time";
import type { Dataset } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";


export function seedAmExtras(ds: Dataset, today: IsoDate) {
  let s = 20261105;
  const r = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const at = (d: IsoDate, hhmm = '10:00'): IsoDateTime => `${d}T${hhmm}:00+08:00`;
  const MM = { name: 'Rosli bin Daud', id: 'u-asset-mm' };
  const DIR = { name: 'Datuk Kamarul Ariffin', id: 'u-asset-dir' };
  const RE = { name: 'Nadia binti Rahim', id: 'u-asset-re1' };
  const RX = { name: 'Farah binti Ismail', id: 'u-asset-rx1' };

  // ---- Contractors: the three names already on past work orders, plus others; one waiting for approval. ----
  const c = (
    n: number,
    name: string,
    trades: AmContractor['trades'],
    grade: AmContractor['cidbGrade'],
    expiryDays: number | null,
    states: string[],
    status: AmContractor['status'],
  ): AmContractor => {
    const addedOn = addDays(today, -int(60, 400));
    const decisions: AmContractor['decisions'] =
      status === 'pending'
        ? []
        : [{ status: 'active', by: DIR.name, byId: DIR.id, at: at(addDays(addedOn, 2)), reason: 'Documents checked (mock)' }];
    if (status === 'suspended') decisions.push({ status, by: DIR.name, byId: DIR.id, at: at(addDays(today, -12)), reason: 'Two jobs late and poor finishing; on hold until a meeting (mock)' });
    return {
      id: `am-c-${n}`,
      name,
      ssmNo: `20190${String(100000 + n * 7919).slice(-6)}-X (mock)`,
      trades,
      cidbGrade: grade,
      cidbExpiry: expiryDays == null ? null : addDays(today, expiryDays),
      states,
      contactName: `Contact person ${n} (mock)`,
      phone: `01${int(1, 9)}-${int(200, 999)} ${int(1000, 9999)}`,
      email: `quotes${n}@contractor.example`,
      status,
      addedBy: MM.name,
      addedById: MM.id,
      addedAt: at(addedOn),
      decisions,
      ratings: [],
      version: 1,
    };
  };
  ds.amContractors.push(
    c(1, 'Kontraktor Bina Jaya (mock)', ['CIVIL', 'ROOFING', 'PAINTING', 'GENERAL'], 'G3', 210, ['Pahang', 'Selangor', 'Kuala Lumpur'], 'active'),
    c(2, 'Servis Elektrik Maju (mock)', ['ELECTRICAL', 'AIRCOND'], 'G2', 18, ['Selangor', 'Kuala Lumpur', 'Negeri Sembilan'], 'active'),
    c(3, 'Paip & Air Sdn Bhd (mock)', ['PLUMBING'], 'G1', 400, ['Selangor', 'Pahang'], 'active'),
    c(4, 'Hijau Landskap Enterprise (mock)', ['LANDSCAPE', 'CLEANING'], null, null, ['Pahang', 'Perak', 'Kelantan'], 'active'),
    c(5, 'Kawal Makhluk Perosak Sdn Bhd (mock)', ['PEST'], null, null, ['Pahang', 'Negeri Sembilan', 'Johor'], 'active'),
    c(6, 'Api Selamat Services (mock)', ['FIRE'], 'G1', -5, ['Pahang', 'Negeri Sembilan', 'Selangor'], 'active'),
    c(7, 'Lif Teknik Sdn Bhd (mock)', ['LIFT'], 'G4', 300, ['Negeri Sembilan', 'Kuala Lumpur'], 'active'),
    c(8, 'Cat Cepat Trading (mock)', ['PAINTING'], 'G1', 150, ['Selangor'], 'suspended'),
    c(9, 'Bumbung Kukuh Enterprise (mock)', ['ROOFING', 'CIVIL'], 'G2', 330, ['Perak', 'Pahang'], 'pending'),
  );
  // Ratings on finished work orders already done by the three named contractors.
  for (const w of ds.amWorkOrders.filter((x) => x.status === 'done' && x.contractor).slice(0, 18)) {
    const k = ds.amContractors.find((x) => x.name === w.contractor);
    if (!k) continue;
    const quality = (k.id === 'am-c-2' ? [3, 4, 2][int(0, 2)] : [4, 5, 4, 3][int(0, 3)]) as 1 | 2 | 3 | 4 | 5;
    k.ratings.push({ workOrderId: w.id, quality, onTime: r() < 0.75, note: quality <= 2 ? 'Had to come back twice (mock)' : 'Done as asked (mock)', by: MM.name, byId: MM.id, at: at(w.doneOn ?? today, '16:00') });
  }

  // ---- Finding tenants: letting files for the first vacant units. ----
  const vacant = ds.amUnits.filter((u) => u.status === 'vacant');
  vacant.slice(0, 14).forEach((u, j) => {
    const since = u.vacantSince ?? addDays(today, -30);
    const adverts: AmLetting['adverts'] =
      j % 4 === 3
        ? []
        : [
            { id: `ad-${u.id}-1`, channel: 'PORTAL', on: addDays(since, 3), ref: `Listing ${4400 + j} (mock)`, by: RE.name, at: at(addDays(since, 3)) },
            ...(j % 2 ? [{ id: `ad-${u.id}-2`, channel: 'SIGNBOARD' as const, on: addDays(since, 5), ref: 'Board at the gate (mock)', by: RE.name, at: at(addDays(since, 5)) }] : []),
          ];
    const enquiries: AmLetting['enquiries'] = [];
    const n = j % 4 === 3 ? 0 : int(1, 3);
    for (let k = 0; k < n; k++) {
      const on = addDays(today, -int(1, 20));
      const status = (['new', 'viewing', 'offer', 'lost'] as const)[(j + k) % 4];
      enquiries.push({
        id: `enq-${u.id}-${k + 1}`,
        name: `Prospective tenant ${j + 1}-${k + 1} (mock)`,
        phone: `01${int(1, 9)}-${int(200, 999)} ${int(1000, 9999)}`,
        source: (['PORTAL', 'SIGNBOARD', 'AGENT', 'SOCIAL'] as const)[k % 4],
        on,
        use: u.type === 'RESIDENTIAL' ? 'Family home (mock)' : u.type === 'LAND' ? 'Storage yard (mock)' : 'Shop or workshop (mock)',
        status,
        viewingOn: status === 'new' ? null : addDays(on, 2),
        offer:
          status === 'offer'
            ? {
                rent: Math.round(u.askingRent * 0.92),
                startOn: addDays(today, 14),
                months: 24,
                depositMonths: 2,
                reason: 'Tenant takes the unit as it is; empty for a long time (mock)',
                by: RE.name,
                byId: RE.id,
                at: at(addDays(on, 3)),
              }
            : null,
        decision: null,
        signed: null,
        lost: status === 'lost' ? { reason: 'PRICE', note: 'Wanted under RM' + Math.round(u.askingRent * 0.7) + ' (mock)', by: RE.name, at: at(addDays(on, 4)) } : null,
        lastActionOn: status === 'new' ? on : addDays(on, status === 'viewing' ? 2 : 4),
        notes: [],
      });
    }
    ds.amLettings.push({ id: `let-${u.id}`, unitId: u.id, adverts, enquiries, version: 1 });
  });

  // ---- Utility meters: every unit meter, plus each resort, orchard and the training centre. ----
  const readingsFor = (id: string, base: number, monthly: number, months: number, spike: boolean, by: string): AmMeter['readings'] => {
    const out: AmMeter['readings'] = [];
    let v = base;
    for (let k = months; k >= 1; k--) {
      const on = addDays(today, -k * 30 - int(0, 3));
      const use = k === 1 && spike ? monthly * 3 : Math.round(monthly * (0.85 + r() * 0.3));
      const usage = out.length ? use : null;
      v += out.length ? use : 0;
      out.push({ id: `rd-${id}-${k}`, on, reading: v, usage, photoRef: `IMG-${id}-${k} (mock)`, newMeter: false, note: '', by, at: at(on, '09:30') });
    }
    return out;
  };
  let mi = 0;
  for (const u of ds.amUnits) {
    for (const m of u.meters) {
      mi++;
      const id = `am-m-${mi}`;
      const monthly = m.kind === 'ELECTRICITY' ? (u.type === 'INDUSTRIAL' ? 2400 : u.type === 'COMMERCIAL' ? 900 : 300) : u.type === 'INDUSTRIAL' ? 90 : 25;
      const vacantNow = u.status === 'vacant';
      const months = mi % 9 === 0 ? 1 : 4;
      ds.amMeters.push({
        id,
        unitId: u.id,
        propertyId: null,
        kind: m.kind,
        account: m.account,
        payer: m.payer,
        readings: readingsFor(id, 10000 + mi * 37, vacantNow ? (mi % 5 === 0 ? 40 : 2) : monthly, months, mi % 47 === 0, RE.name),
        bills: [],
        version: 1,
      });
    }
  }
  for (const p of ds.amProperties) {
    const kinds: AmMeter['kind'][] = p.kind === 'ORCHARD' ? ['WATER'] : ['ELECTRICITY', 'WATER'];
    for (const kind of kinds) {
      mi++;
      const id = `am-m-${mi}`;
      const monthly = kind === 'ELECTRICITY' ? (p.kind === 'RESORT' ? 18000 : 6000) : p.kind === 'ORCHARD' ? 400 : 700;
      const readings = readingsFor(id, 50000 + mi * 11, monthly, 4, p.id === 'am-p-1' && kind === 'WATER', p.kind === 'RESORT' ? RX.name : MM.name);
      const bills = readings.slice(1).map((x, k) => ({
        id: `bill-${id}-${k}`,
        period: x.on.slice(0, 7),
        amount: Math.round((x.usage ?? 0) * (kind === 'ELECTRICITY' ? 0.5 : 1.2)),
        billRef: `${kind === 'ELECTRICITY' ? 'TNB' : 'AIR'}-${x.on.slice(0, 7)} (mock)`,
        by: MM.name,
        at: at(addDays(x.on, 6)),
      }));
      ds.amMeters.push({ id, unitId: null, propertyId: p.id, kind, account: `${kind === 'ELECTRICITY' ? 'TNB' : 'AIR'}-P${mi} (mock)`, payer: 'owner', readings, bills, version: 1 });
    }
  }

  // ---- Resorts: rooms, a mock price list and bookings around today. ----
  // Rates from published guidance (service tax 8%, tourism tax RM10 per room-night for foreign guests, Pahang
  // Lestari fee RM3 per room-night). Not confirmed: Finance checks with Customs and the state before any real use.
  const TAXES: AmStayTaxes = { sstPct: 8, tourismTaxPerNight: 10, stateFeePerNight: 3, stateFeeName: '', note: 'From published guidance (mock); Finance to confirm with Customs and the state before use' };
  const resorts = ds.amProperties.filter((p) => p.kind === 'RESORT');
  resorts.forEach((p, j) => {
    p.stay = {
      capacity: j === 0 ? { ROOM: 30, CHALET: 12, HALL: 1 } : { ROOM: 20, CHALET: 8, CAMPSITE: 15 },
      rates: j === 0 ? { ROOM: 220, CHALET: 380, HALL: 2500 } : { ROOM: 180, CHALET: 320, CAMPSITE: 40 },
      setBy: DIR.name,
      setAt: at(addDays(today, -90)),
      rooms: [],
      taxes: { ...TAXES, stateFeeName: p.state === 'Pahang' ? 'Pahang Lestari fee' : '', stateFeePerNight: p.state === 'Pahang' ? 3 : 0 },
    };
    for (const t of ['ROOM', 'CHALET'] as const) {
      const n = p.stay.capacity[t] ?? 0;
      for (let i = 0; i < n; i++) {
        const no = `${t === 'ROOM' ? 'R' : 'C'}${String(i + 1).padStart(2, '0')}`;
        const hk: AmRoom['hk'] = i % 5 === 1 ? 'dirty' : i % 5 === 2 ? 'clean' : 'inspected';
        p.stay.rooms!.push({ no, type: t, hk, hkBy: 'Housekeeping (mock)', hkAt: at(today, '09:00'), out: null });
      }
    }
    // House rules: the first resort has them set (mock values); the second is left for the Asset Director to set in the app.
    if (j === 0)
      p.stay.policy = {
        sstRegistered: true,
        motacNo: 'MOTAC/PHG/0000 (mock)',
        motacExpiresOn: addDays(today, 45),
        checkInTime: '15:00',
        checkOutTime: '12:00',
        freeCancelDays: 7,
        lateCancelKeepPct: 50,
        noShowKeepPct: 100,
        setBy: DIR.name,
        setAt: at(addDays(today, -90)),
      };
    // One chalet out of order for a roof leak, so the grid shows one fewer to sell.
    if (j === 0) {
      const c = p.stay.rooms!.find((x) => x.no === 'C12');
      if (c) c.out = { from: addDays(today, -1), until: addDays(today, 3), reason: 'Roof leak over the bed, contractor booked (mock)', by: RX.name, at: at(addDays(today, -1)) };
    }
  });
  let bk = 0;
  let nat = 0;
  const book = (pi: number, type: AmBooking['type'], qty: number, inDays: number, n: number, status: AmBooking['status'], opts: Partial<AmBooking> = {}) => {
    const p = resorts[pi];
    if (!p?.stay) return;
    bk++;
    const checkIn = addDays(today, inDays);
    const listRate = p.stay.rates[type] ?? 0;
    const rate = opts.rate ?? listRate;
    const madeOn = addDays(today, Math.min(-1, inDays - int(5, 30)));
    const b: AmBooking = {
      id: `am-b-${bk}`,
      ref: `BK-${String(bk).padStart(4, '0')}`,
      propertyId: p.id,
      guest: opts.guest ?? `Guest ${bk} (mock)`,
      phone: `01${int(1, 9)}-${int(200, 999)} ${int(1000, 9999)}`,
      internal: opts.internal ?? false,
      billTo: opts.billTo ?? '',
      type,
      qty,
      checkIn,
      checkOut: addDays(checkIn, n),
      rate,
      listRate,
      discountReason: rate < listRate ? (opts.discountReason ?? 'Repeat corporate guest (mock)') : '',
      status,
      holdUntil: opts.holdUntil ?? addDays(madeOn, 3),
      payments: [],
      by: RX.name,
      byId: RX.id,
      at: at(madeOn),
      history: [{ at: at(madeOn), by: RX.name, what: 'Booked' }],
      version: 1,
      taxRates: p.stay.taxes ?? null,
      terms: p.stay.policy
        ? { checkInTime: p.stay.policy.checkInTime, checkOutTime: p.stay.policy.checkOutTime, freeCancelDays: p.stay.policy.freeCancelDays, lateCancelKeepPct: p.stay.policy.lateCancelKeepPct, noShowKeepPct: p.stay.policy.noShowKeepPct }
        : null,
      settlement: null,
      foreign: opts.foreign ?? false,
      register: null,
      roomNos: [],
      charges: opts.charges ?? [],
    };
    if (status === 'checked_in' || status === 'checked_out') {
      nat++;
      b.register = b.foreign
        ? { idType: 'PASSPORT', idNo: `X${int(1000000, 9999999)} (mock)`, nationality: 'Singapore', by: RX.name, at: at(checkIn, '15:00') }
        : { idType: 'MYKAD', idNo: `8${nat}0101-06-${int(1000, 9999)} (mock)`, nationality: 'Malaysia', by: RX.name, at: at(checkIn, '15:00') };
      if (isSleepType(type)) {
        const free = p.stay.rooms!.filter((x) => x.type === type && !x.out && !ds.amBookings.some((o) => o.propertyId === p.id && o.status === 'checked_in' && o.roomNos?.includes(x.no)));
        b.roomNos = free.slice(-qty).map((x) => x.no);
        if (status === 'checked_in') for (const x of free.slice(-qty)) x.hk = 'dirty';
      }
    }
    if (!b.internal && status !== 'held' && status !== 'cancelled') {
      const total = bookingBill(b).total;
      const dep = status === 'checked_out' ? total : Math.round(total * 0.3);
      b.payments.push({
        id: `sp-${b.id}-1`,
        on: madeOn,
        amount: dep,
        method: bk % 3 === 0 ? 'CASH' : 'TRANSFER',
        receiptNo: `RS-${b.ref}-1`,
        ref: bk % 3 === 0 ? '' : `IBG${700000 + bk}`,
        by: RX.name,
        at: at(madeOn, '11:00'),
        banked: bk % 4 === 0 ? null : { on: addDays(madeOn, 1), slipRef: `STMT-${bk} (mock)`, by: 'Grace Wong Mei Ling' },
      });
    }
    ds.amBookings.push(b);
  };
  book(0, 'ROOM', 6, -2, 3, 'checked_in', {
    charges: [
      { id: 'ch-1', on: addDays(today, -1), what: 'Dinner buffet x 12 (mock)', amount: 540, reason: '', by: RX.name, at: at(addDays(today, -1), '21:00') },
      { id: 'ch-2', on: today, what: 'Extra bed x 2 (mock)', amount: 100, reason: '', by: RX.name, at: at(today, '10:00') },
    ],
  });
  book(0, 'CHALET', 2, -5, 2, 'checked_out');
  book(0, 'HALL', 1, 9, 1, 'confirmed', { guest: 'Wedding reception, family of Encik A (mock)' });
  book(0, 'ROOM', 12, 9, 2, 'confirmed', { rate: 190, discountReason: 'Wedding group, 12 rooms (mock)' });
  book(0, 'ROOM', 20, 16, 2, 'confirmed', { internal: true, billTo: 'Sasa Security Services Sdn Bhd (mock)', guest: 'Supervisors retreat (mock)' });
  book(0, 'CHALET', 4, 4, 2, 'held', { holdUntil: addDays(today, 1) });
  book(0, 'CHALET', 3, 6, 2, 'held', { holdUntil: addDays(today, -2) });
  book(1, 'ROOM', 8, 1, 2, 'confirmed');
  book(1, 'CAMPSITE', 10, 2, 1, 'confirmed', { guest: 'School scouts camp (mock)' });
  book(1, 'CHALET', 2, -1, 3, 'checked_in', { rate: 250, discountReason: 'Long-stay walk-in rate (mock)', foreign: true, guest: 'Mr Tan and family, Singapore (mock)' });
  book(1, 'ROOM', 3, -3, 1, 'no_show');
  book(1, 'ROOM', 2, 12, 2, 'cancelled');

  // ---- Orchards: picks and sales over the last weeks. ----
  const crop = (name: string) => (name.includes('Durian') ? 'Durian' : name.includes('Mango') ? 'Mango (harumanis)' : name.includes('Rambutan') ? 'Rambutan' : name.includes('Pineapple') ? 'Pineapple' : 'Dokong');
  const priceOf = (cr: string) => (cr === 'Durian' ? 28 : cr.startsWith('Mango') ? 22 : cr === 'Rambutan' ? 5 : cr === 'Pineapple' ? 3 : 7);
  let hv = 0;
  ds.amProperties
    .filter((p) => p.kind === 'ORCHARD')
    .forEach((p, j) => {
      const cr = crop(p.name);
      for (let k = 0; k < 4; k++) {
        hv++;
        const on = addDays(today, -(k * 6 + j + 1));
        const picked = int(4, 30) * 50;
        const id = `am-h-${hv}`;
        const price = priceOf(cr) * (j === 0 && k === 0 ? 0.7 : 0.9 + r() * 0.2);
        const soldKg = k === 0 && j === 1 ? Math.round(picked * 0.5) : Math.round(picked * 0.93);
        const spoiled = j === 2 && k === 0 ? Math.round(picked * 0.15) : Math.round(picked * 0.03);
        const method: AmHarvest['sales'][number]['method'] = k % 3 === 2 ? 'CREDIT' : k % 2 ? 'TRANSFER' : 'CASH';
        const amount = Math.round(soldKg * price * 100) / 100;
        const h: AmHarvest = {
          id,
          propertyId: p.id,
          on,
          crop: cr,
          pickedKg: picked,
          photoRef: `IMG-${id} (mock)`,
          sales: [
            {
              id: `hs-${id}-1`,
              buyer: `Fruit wholesaler ${String.fromCharCode(65 + (j % 4))} (mock)`,
              kg: soldKg,
              pricePerKg: Math.round(price * 100) / 100,
              amount,
              slipRef: `WS-${5000 + hv} (mock)`,
              method,
              receiptNo: method === 'CREDIT' ? '' : `RH-${id}-1`,
              ref: method === 'TRANSFER' ? `IBG${800000 + hv}` : '',
              by: MM.name,
              at: at(on, '15:00'),
              banked: method === 'CREDIT' || k === 0 ? null : { on: addDays(on, 1), slipRef: `BIS-H${hv} (mock)`, by: 'Grace Wong Mei Ling' },
            },
          ],
          spoiledKg: spoiled,
          keptKg: j === 3 && k === 1 ? Math.round(picked * 0.08) : 0,
          keptNote: j === 3 && k === 1 ? 'Given to visitors at the open day (mock)' : '',
          by: MM.name,
          at: at(on, '13:00'),
          history: [{ at: at(on, '13:00'), by: MM.name, what: `Picked ${picked} kg` }],
          version: 1,
        };
        ds.amHarvests.push(h);
      }
    });

  // ---- Planned maintenance: statutory and routine jobs at the properties and some units. ----
  let pi = 0;
  const plan = (place: { unitId?: string; propertyId?: string }, task: string, trade: AmPmPlan['trade'], everyMonths: number, dueIn: number, statutory: boolean) => {
    pi++;
    const nextDueOn = addDays(today, dueIn);
    ds.amPmPlans.push({
      id: `am-pm-${pi}`,
      unitId: place.unitId ?? null,
      propertyId: place.propertyId ?? null,
      task,
      trade,
      everyMonths,
      nextDueOn,
      lastDoneOn: addMonths(nextDueOn, -everyMonths),
      statutory,
      openWorkOrderId: null,
      paused: null,
      by: MM.name,
      at: at(addDays(today, -120)),
      history: [],
      version: 1,
    });
  };
  for (const p of ds.amProperties) {
    if (p.kind === 'RESORT') {
      plan({ propertyId: p.id }, 'Fire extinguishers and hose reels serviced (BOMBA)', 'FIRE', 12, p.id === 'am-p-1' ? -4 : 40, true);
      plan({ propertyId: p.id }, 'Air conditioning service, all rooms', 'AIRCOND', 6, int(5, 60), false);
      plan({ propertyId: p.id }, 'Pest control', 'PEST', 3, int(-2, 30), false);
      plan({ propertyId: p.id }, 'Septic tank desludging', 'PLUMBING', 24, int(60, 300), true);
      plan({ propertyId: p.id }, 'Roof and gutter check before the monsoon', 'ROOFING', 12, int(10, 25), false);
    } else if (p.kind === 'TRAINING') {
      plan({ propertyId: p.id }, 'Lift service (DOSH licence)', 'LIFT', 1, 6, true);
      plan({ propertyId: p.id }, 'Fire extinguishers and hose reels serviced (BOMBA)', 'FIRE', 12, 75, true);
      plan({ propertyId: p.id }, 'Grass cutting, range and grounds', 'LANDSCAPE', 1, 3, false);
    } else {
      plan({ propertyId: p.id }, 'Water pump and irrigation check', 'PLUMBING', 6, int(-10, 120), false);
    }
  }
  ds.amUnits
    .filter((u) => u.type === 'COMMERCIAL' || u.type === 'INDUSTRIAL')
    .slice(0, 12)
    .forEach((u, j) => plan({ unitId: u.id }, j % 2 ? 'Roof and gutter check' : 'Fire extinguisher check (BOMBA)', j % 2 ? 'ROOFING' : 'FIRE', 12, int(-5, 90), j % 2 === 0));
  // One plan already has its work order raised and still open.
  const withOrder = ds.amPmPlans.find((p) => p.nextDueOn <= addDays(today, 14) && p.propertyId && !p.statutory);
  if (withOrder) {
    const id = `am-wo-pm-${withOrder.id}`;
    ds.amWorkOrders.push({
      id,
      unitId: null,
      propertyId: withOrder.propertyId,
      title: withOrder.task,
      source: 'planned',
      raisedOn: addDays(today, -3),
      dueOn: withOrder.nextDueOn,
      status: 'open',
      cost: null,
      contractor: null,
      doneOn: null,
    });
    withOrder.openWorkOrderId = id;
  }
}