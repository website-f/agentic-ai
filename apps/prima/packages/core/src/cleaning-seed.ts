import { kpmSchoolAreas } from "./cleaning";
import { kpmSchoolStock } from "./cleaning";
import { kpmWeek } from "./cleaning";
import { planCleaningDay } from "./cleaning";
import { planPeople } from "./cleaning";
import type { CleaningSite } from "./cleaning";
import type { CleaningStockEntry } from "./cleaning";
import { addDays } from "./time";
import { fromMs } from "./time";
import { toMs } from "./time";
import { weekday } from "./time";
import type { Dataset } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";


/** 1x1 PNG: stands in for a time-marked photo in test data. */
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export function seedCleaning(ds: Dataset, today: IsoDate, now: IsoDateTime): void {
  const om = ds.users.find((u) => u.id === 'u-om-klang');
  const selangor = new Set(ds.branches.filter((b) => b.companyId === 'co-arsh' && b.state === 'Selangor').map((b) => b.id));
  const sites = ds.sites.filter((s) => s.companyId === 'co-arsh' && s.sector === 'government' && selangor.has(s.branchId)).slice(0, 2);
  if (!om || !sites.length) return;
  const names = [
    ['Rohani binti Kassim', 'Siti Aminah binti Yusof', 'Kumari a/p Muniandy', 'Noraini binti Hassan', 'Lim Siew Peng', 'Fatimah binti Ali'],
    ['Zainab binti Omar', 'Mohd Rizal bin Ahmad', 'Saraswathy a/p Raju', 'Halimah binti Ismail'],
  ];
  sites.forEach((site, k) => {
    const two = k === 0;
    const facts = two ? { acres: 7.5, blocks: 8, floors: 13, toiletCubicles: 34 } : { acres: 4.2, blocks: 5, floors: 9, toiletCubicles: 18 };
    const sizes: Record<string, number> = two
      ? { floors: 3800, fittings: 900, carpets: 220, rubbish: 40, hedges: 600, drains: 450, pots: 80, fertilise: 1200, soil: 1200 }
      : { floors: 2100, fittings: 500, carpets: 0, rubbish: 22, hedges: 350, drains: 260, pots: 40, fertilise: 700, soil: 700 };
    const areas = kpmSchoolAreas(facts, two).map((a, i) => ({
      ...a,
      size: sizes[a.id] ?? a.size,
      pin: { x: 12 + ((i * 23) % 76), y: 14 + ((i * 37) % 70) },
    }));
    const crewNames = names[k];
    const crew = crewNames.map((name, i) => ({
      id: `w${i + 1}`,
      name: `${name} (test)`,
      role: (i === 0 ? 'supervisor' : 'cleaner') as 'supervisor' | 'cleaner',
      session: (two && i >= Math.round(crewNames.length * 0.6) ? 2 : 1) as 1 | 2,
      personId: null,
    }));
    const stock = kpmSchoolStock();
    const perDay: Record<string, number> = { 'floor-cleaner': two ? 1.5 : 0.8, 'toilet-cleaner': two ? 1 : 0.5, 'hand-soap': two ? 0.8 : 0.4, tissue: two ? 12 : 6, bags: two ? 30 : 15, freshener: 0.5 };
    const setup: CleaningSite = {
      id: `clean-${site.id}`,
      companyId: site.companyId,
      siteId: site.id,
      template: 'kpm_school',
      contractRef: `KPM-KBK-TEST-${k + 1} (test contract)`,
      requiredHeadcount: crew.length,
      facts,
      week: kpmWeek('sat_sun'),
      secondSession: two ? { start: '09:00', end: '18:00' } : null,
      closedDays: [],
      cycleStart: addDays(today, -((weekday(today) + 6) % 7) - 7),
      monthlyWage: 1700,
      map: null,
      crew,
      areas,
      equipment: stock.equipment.map((e) => ({ ...e, required: two ? e.required * 2 : e.required })),
      supplies: stock.supplies.map((s) => ({ ...s, perDay: perDay[s.id] ?? 0 })),
      version: 1,
      updatedBy: om.name,
      updatedAt: `${addDays(today, -10)}T09:00:00+08:00`,
    };
    ds.cleaningSites.push(setup);

    // Supplies: a delivery 8 days ago, received; checks 7 days ago and 1 day ago.
    const at = (d: IsoDate, hm: string): IsoDateTime => `${d}T${hm}:00+08:00`;
    const proof = (id: string, linkId: string, d: IsoDate, hm: string, caption: string) => {
      ds.evidenceDocs.push({
        id,
        companyId: site.companyId,
        caseId: null,
        followUpId: null,
        cleaningId: linkId,
        timeMark: { stampedAt: `${d}T${hm}`, cameraAt: null, check: 'no_camera_time' },
        name: `Time-marked photo ${d} ${hm}`,
        mime: 'image/png',
        bytes: 70,
        sha256: id.padEnd(64, '0'),
        data: TINY_PNG,
        caption,
        uploadedBy: om.name,
        receivedAt: at(d, hm),
      });
      return id;
    };
    const dDel = addDays(today, -8);
    const del: CleaningStockEntry = {
      id: `cstk-${site.id}-seed-delivery`,
      companyId: site.companyId,
      siteId: site.id,
      kind: 'delivery',
      date: dDel,
      supplies: setup.supplies.map((s) => ({ supplyId: s.id, sent: Math.ceil(s.perDay * 20), counted: s.id === 'tissue' ? Math.ceil(s.perDay * 20) - 24 : Math.ceil(s.perDay * 20) })),
      equipment: setup.equipment.slice(0, 3).map((e) => ({ equipmentId: e.id, sent: 1, working: 1, broken: null })),
      note: 'Monthly supplies from the store (test)',
      by: om.name,
      byId: om.id,
      at: at(dDel, '08:30'),
      received: { by: om.name, byId: om.id, at: at(dDel, '15:00'), note: 'Supervisor counted on arrival; tissue 2 packs short (test)' },
      proofIds: [],
    };
    del.proofIds = [proof(`doc-cln${k}del00000000`.slice(0, 20), del.id, dDel, '14:52', `${site.name}: delivery received`)];
    const check = (d: IsoDate, factor: number, n: number): CleaningStockEntry => {
      const id = `cstk-${site.id}-${d}-check`;
      return {
        id,
        companyId: site.companyId,
        siteId: site.id,
        kind: 'check',
        date: d,
        supplies: setup.supplies.map((s) => ({ supplyId: s.id, sent: null, counted: Math.max(0, Math.round(s.perDay * factor * 10) / 10) })),
        equipment: n ? setup.equipment.map((e, i) => ({ equipmentId: e.id, sent: null, working: i === 3 && k === 0 ? e.required - 1 : e.required, broken: i === 3 && k === 0 ? 1 : 0 })) : [],
        note: n ? 'Grass cutter 2 not starting (test)' : 'Store counted (test)',
        by: om.name,
        byId: om.id,
        at: at(d, '16:10'),
        received: null,
        proofIds: [proof(`doc-cln${k}chk${n}0000000`.slice(0, 20), id, d, '15:58', `${site.name} ${d}: stock check`)],
      };
    };
    // Between the checks: site 1 uses floor cleaner much faster than budget, site 2 under-uses soap.
    const c1 = check(addDays(today, -7), 22, 0);
    const c2 = check(addDays(today, -1), 12, 1);
    c2.supplies = c2.supplies.map((x) =>
      k === 0 && x.supplyId === 'floor-cleaner' ? { ...x, counted: 8 } : k === 1 && x.supplyId === 'hand-soap' ? { ...x, counted: 8.4 } : x,
    );
    ds.cleaningStock.push(del, c1, c2);

    // Today's plan, published at 06:45; the morning's first round recorded up to "now".
    const out = planCleaningDay({ site: setup, date: today, people: planPeople(setup), absentIds: k === 1 ? ['w4'] : [] });
    if (!out.hours) return;
    const nowHm = fromMs(toMs(now)).slice(11, 16);
    let n = 0;
    const tasks = out.tasks.map((t) => {
      if (t.type !== 'work' || t.end > nowHm) return t;
      n++;
      const status = n % 7 === 0 ? 'redo' : n % 3 === 0 ? 'done' : 'checked';
      return {
        ...t,
        status: status as 'redo' | 'done' | 'checked',
        doneBy: om.name,
        doneById: om.id,
        doneAt: at(today, t.end),
        checkedBy: status === 'done' ? null : om.name,
        checkedById: status === 'done' ? null : om.id,
        checkedAt: status === 'done' ? null : at(today, t.end),
        note: status === 'redo' ? `${t.note} | Floor still wet and smells, supervisor asked to redo (test)` : t.note,
      };
    });
    ds.cleaningDays.push({
      id: `cday-${site.id}-${today}`,
      companyId: site.companyId,
      siteId: site.id,
      date: today,
      planVersion: setup.version,
      status: 'published',
      hours: out.hours,
      absentIds: k === 1 ? ['w4'] : [],
      tasks,
      uncovered: out.uncovered,
      watchList: out.watchList,
      summary: out.summary,
      generatedAt: at(today, '06:40'),
      generatedBy: om.name,
      publishedAt: at(today, '06:45'),
      publishedBy: om.name,
      log: [
        { at: at(today, '06:40'), by: om.name, what: 'Plan made' },
        { at: at(today, '06:45'), by: om.name, what: 'Published' },
      ],
    });
  });

  // Fittings plans: the first cleaning school, and two security sites of Arrow Shield in Selangor.
  const guardSites = ds.sites.filter((x) => x.companyId === 'co-arsh' && selangor.has(x.branchId) && !sites.includes(x)).slice(0, 2);
  const kitSites = [...sites.slice(0, 1), ...guardSites];
  kitSites.forEach((site, k) => {
    const items =
      k === 0
        ? [
            { id: 'table', name: 'Folding table (store room)', category: 'furniture' as const, required: 1, owner: 'company' as const, note: '' },
            { id: 'chairs', name: 'Plastic chair', category: 'furniture' as const, required: 4, owner: 'company' as const, note: 'Crew rest area' },
            { id: 'fan', name: 'Standing fan', category: 'fan_light' as const, required: 1, owner: 'company' as const, note: '' },
          ]
        : [
            { id: 'post', name: 'Guard post (pondok)', category: 'shelter' as const, required: 1, owner: k === 1 ? ('client' as const) : ('company' as const), note: 'Main gate' },
            { id: 'chair', name: 'Chair', category: 'furniture' as const, required: 2, owner: 'company' as const, note: '' },
            { id: 'table', name: 'Table', category: 'furniture' as const, required: 1, owner: 'company' as const, note: '' },
            { id: 'fan', name: 'Fan', category: 'fan_light' as const, required: 1, owner: 'company' as const, note: '' },
            { id: 'cctv', name: 'CCTV camera at the gate', category: 'cctv' as const, required: 2, owner: 'rented' as const, note: 'Recorder in the guard post' },
          ];
    const d = addDays(today, k === 2 ? -40 : -6);
    const recId = `kitrec-${site.id}-${d}-1`;
    const docId = `doc-kit${k}000000000000`.slice(0, 20);
    ds.evidenceDocs.push({
      id: docId,
      companyId: site.companyId,
      caseId: null,
      followUpId: null,
      cleaningId: recId,
      timeMark: { stampedAt: `${d}T10:15`, cameraAt: null, check: 'no_camera_time' },
      name: `Time-marked photo ${d} 10:15`,
      mime: 'image/png',
      bytes: 70,
      sha256: docId.padEnd(64, '0'),
      data: TINY_PNG,
      caption: `${site.name} ${d}: fittings check`,
      uploadedBy: om.name,
      receivedAt: `${d}T10:30:00+08:00`,
    });
    ds.siteKits.push({
      id: `kit-${site.id}`,
      companyId: site.companyId,
      siteId: site.id,
      items,
      records: [
        {
          id: recId,
          kind: 'check',
          date: d,
          lines: items.map((i) => {
            const broken = i.id === 'fan' && k === 1 ? 1 : 0;
            const inPlace = i.id === 'cctv' ? 1 : i.required;
            return { itemId: i.id, inPlace, working: inPlace - broken, broken };
          }),
          note: k === 1 ? 'Fan not working; one CCTV camera not yet installed (test)' : 'All in place (test)',
          by: om.name,
          byId: om.id,
          at: `${d}T10:30:00+08:00`,
          proofIds: [docId],
        },
      ],
      version: 2,
      updatedBy: om.name,
      updatedAt: `${d}T10:30:00+08:00`,
    });
  });
}