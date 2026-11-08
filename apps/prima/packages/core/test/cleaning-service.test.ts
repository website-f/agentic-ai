import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, exifTakenAt, checkTimeMark, stockStatus, kpmSchoolAreas, kpmSchoolStock, kpmWeek } from '../src';

const TODAY = '2026-11-04'; // a Wednesday
const NOW = '2026-11-04T03:00:00.000Z'; // 11:00 in Malaysia

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
}

// A tiny JPEG with an EXIF DateTimeOriginal, built by hand (synthetic).
function jpegWithExif(when: string): string {
  const ascii = [...`${when}\0`].map((c) => c.charCodeAt(0));
  // TIFF little endian: header, IFD0 with one entry (ExifIFD pointer), Exif IFD with DateTimeOriginal.
  const tiff: number[] = [];
  const u16 = (n: number) => tiff.push(n & 255, (n >> 8) & 255);
  const u32 = (n: number) => tiff.push(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255);
  tiff.push(0x49, 0x49); u16(42); u32(8);
  u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0); // IFD0 at 8 (18 bytes) -> exif at 26
  u16(1); u16(0x9003); u16(2); u32(20); u32(44); u32(0); // exif IFD at 26 (18 bytes) -> string at 44
  tiff.push(...ascii);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  const bytes = [0xff, 0xd8, 0xff, 0xe1, (len >> 8) & 255, len & 255, ...app1, 0xff, 0xd9];
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
}
let n = 0;
const png = () => `data:image/png;base64,${Buffer.from(`synthetic-photo-${++n}-${Math.random()}`).toString('base64')}`;

describe('cleaning: who may do what (Fauzan, 4 Nov 2026)', () => {
  it('the OM covering the site manages; OGM monitors all and manages government sites; company manager views only', async () => {
    const { svc, ds } = fresh();
    const site = ds.cleaningSites[0];
    const om = await svc.user('u-om-klang');
    const omJohor = await svc.user('u-om-johor');
    const ogm = await svc.user('u-ogm');
    const cm = await svc.user('u-cm-arsh');
    const cmOther = await svc.user('u-cm-sasa');
    expect((await svc.cleaning.board(om)).rows.map((r) => r.access)).toEqual(['manage', 'manage']);
    expect((await svc.cleaning.board(ogm)).rows.length).toBe(2);
    expect((await svc.cleaning.board(cm)).rows.every((r) => r.access === 'view')).toBe(true);
    expect((await svc.cleaning.board(cmOther)).rows).toEqual([]);
    expect((await svc.cleaning.board(omJohor)).rows).toEqual([]);
    // Company manager: no writes, even through a direct call.
    await expect(svc.cleaning.makePlan(cm, site.siteId, TODAY, [])).rejects.toThrow(/Not allowed/);
    await expect(svc.cleaning.recordTasks(cm, site.siteId, TODAY, { taskIds: ['x'], action: 'done', note: '', proof: null })).rejects.toThrow(/Not allowed/);
    await expect(svc.cleaning.site(omJohor, site.siteId)).rejects.toThrow(/Not allowed/);
    // Guards' own sign-in and HR see nothing.
    await expect(svc.cleaning.site(await svc.user('u-pwvsb-hr'), site.siteId)).rejects.toThrow(/Not allowed/);
  });

  it('checks the set-up on the server', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const s = ds.cleaningSites[1];
    const base = { ...s } as Record<string, unknown>;
    for (const k of ['id', 'companyId', 'siteId', 'map', 'version', 'updatedBy', 'updatedAt']) delete base[k];
    const bad = (patch: Record<string, unknown>) => svc.cleaning.saveSetup(om, s.siteId, { ...(base as never), ...patch }, s.version);
    await expect(bad({ week: [] })).rejects.toThrow(/hours for each day/);
    await expect(bad({ timings: { briefingMin: 500 } })).rejects.toThrow(/briefing/i);
    await expect(bad({ timings: { breakFrom: 'noon' } })).rejects.toThrow(/HH:MM/);
    await expect(bad({ timings: { madeUp: 5 } })).rejects.toThrow(/timings/);
    await expect(bad({ areas: [{ ...s.areas[0], size: -5 }] })).rejects.toThrow(/size/);
    await expect(bad({ crew: [{ id: 'w1', name: '', role: 'cleaner', session: 1, personId: null }] })).rejects.toThrow(/name/);
    await expect(bad({ crew: [{ id: 'w1', name: 'A', role: 'cleaner', session: 2, personId: null }] })).rejects.toThrow(/second session/);
    // Stale version.
    await expect(svc.cleaning.saveSetup(om, s.siteId, base as never, s.version - 1)).rejects.toThrow(/changed/);
    const saved = await svc.cleaning.saveSetup(om, s.siteId, { ...(base as never), requiredHeadcount: 5 }, s.version);
    expect(saved.version).toBe(s.version + 1);
    // A published day made on the old version must be made again before publishing a new day.
  });

  it('starts cleaning on a new site from the KPM template, plans and publishes', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const board = await svc.cleaning.board(om);
    const target = board.startable[0];
    expect(target).toBeTruthy();
    const facts = { acres: 3, blocks: 4, floors: 8, toiletCubicles: 16 };
    const stock = kpmSchoolStock();
    const setup = await svc.cleaning.saveSetup(
      om,
      target.siteId,
      {
        template: 'kpm_school',
        contractRef: 'TEST',
        requiredHeadcount: 3,
        facts,
        week: kpmWeek('sat_sun'),
        secondSession: null,
        closedDays: [],
        cycleStart: '2026-11-02',
        monthlyWage: 1700,
        crew: [
          { id: 'w1', name: 'Sup (test)', role: 'supervisor', session: 1, personId: null },
          { id: 'w2', name: 'C1 (test)', role: 'cleaner', session: 1, personId: null },
          { id: 'w3', name: 'C2 (test)', role: 'cleaner', session: 1, personId: null },
        ],
        areas: kpmSchoolAreas(facts, false).map((a) => (a.id === 'floors' ? { ...a, size: 1500 } : a)),
        equipment: stock.equipment,
        supplies: stock.supplies,
      },
      null,
    );
    expect(setup.version).toBe(1);
    await expect(svc.cleaning.publish(om, target.siteId, '2026-11-05')).rejects.toThrow(/Make the plan first/);
    const day = await svc.cleaning.makePlan(om, target.siteId, '2026-11-05', []);
    expect(day.status).toBe('draft');
    expect(day.tasks.some((t) => t.type === 'work')).toBe(true);
    await expect(svc.cleaning.makePlan(om, target.siteId, '2026-11-08', [])).rejects.toThrow(/not a working day/);
    await expect(svc.cleaning.makePlan(om, target.siteId, '2026-11-05', ['nobody'])).rejects.toThrow(/not on this crew/);
    // Recording before publishing is refused; and future days cannot be recorded.
    const w = day.tasks.find((t) => t.type === 'work')!;
    await expect(svc.cleaning.recordTasks(om, target.siteId, '2026-11-05', { taskIds: [w.id], action: 'done', note: '', proof: null })).rejects.toThrow(/future/);
    const pub = await svc.cleaning.publish(om, target.siteId, '2026-11-05');
    expect(pub.status).toBe('published');
    expect(ds.audit.some((a) => a.action === 'cleaning.day.publish')).toBe(true);
  });

  it('records work with time-marked proof, refuses ordinary or reused photos, and re-plans from now', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const site = ds.cleaningSites[0];
    const day = ds.cleaningDays.find((d) => d.siteId === site.siteId)!;
    const planned = day.tasks.filter((t) => t.type === 'work' && t.status === 'planned');
    const done = day.tasks.find((t) => t.type === 'work' && t.status === 'done')!;
    // Checked needs a photo; redo needs a reason.
    await expect(svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [done.id], action: 'checked', note: '', proof: null })).rejects.toThrow(/time-marked photo/);
    await expect(svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [done.id], action: 'redo', note: '', proof: { image: png(), stampedAt: `${TODAY}T10:40` } })).rejects.toThrow(/Say why/);
    // An ordinary photo with no time mark entered, or a time mark from another day, is refused.
    await expect(svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [done.id], action: 'checked', note: '', proof: { image: png(), stampedAt: '' } })).rejects.toThrow(/time-marked/);
    await expect(svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [done.id], action: 'checked', note: '', proof: { image: png(), stampedAt: '2026-11-03T10:40' } })).rejects.toThrow(/not 2026-11-04/);
    await expect(svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [done.id], action: 'checked', note: '', proof: { image: png(), stampedAt: `${TODAY}T23:40` } })).rejects.toThrow(/later than now/);
    // A camera time from another day is refused even when the stamp says today.
    await expect(
      svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [done.id], action: 'checked', note: '', proof: { image: jpegWithExif('2026:10:20 10:40:00'), stampedAt: `${TODAY}T10:40` } }),
    ).rejects.toThrow(/2026-10-20/);
    const photo = jpegWithExif('2026:11:04 10:41:00');
    const ok = await svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [done.id], action: 'checked', note: 'Passed', proof: { image: photo, stampedAt: `${TODAY}T10:40` } });
    expect(ok.tasks.find((t) => t.id === done.id)!.status).toBe('checked');
    const doc = ds.evidenceDocs.find((d) => d.cleaningId === day.id && d.timeMark?.check === 'matches');
    expect(doc).toBeTruthy();
    // The same photo again is refused.
    await expect(svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [planned[0].id], action: 'done', note: '', proof: { image: photo, stampedAt: `${TODAY}T10:40` } })).rejects.toThrow(/already used/);
    // Wrong order is refused (planned cannot be checked).
    await expect(svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [planned[0].id], action: 'checked', note: '', proof: { image: png(), stampedAt: `${TODAY}T10:40` } })).rejects.toThrow(/cannot be marked/);
    // Stale screen.
    await expect(svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [done.id], action: 'redo', note: 'x', proof: { image: png(), stampedAt: `${TODAY}T10:45` }, expectedStatuses: { [done.id]: 'done' } })).rejects.toThrow(/already recorded/);
    // Someone goes home: re-plan from now keeps recorded work and moves the rest.
    const cleanerOut = site.crew.find((c) => c.role === 'cleaner')!.id;
    const replanned = await svc.cleaning.makePlan(om, site.siteId, TODAY, [cleanerOut]);
    expect(replanned.status).toBe('published');
    expect(replanned.tasks.find((t) => t.id === done.id)!.status).toBe('checked');
    expect(replanned.tasks.filter((t) => t.status === 'planned' && t.type === 'work').every((t) => t.start >= '11:00')).toBe(true);
    expect(replanned.tasks.some((t) => t.crewId === cleanerOut && t.status === 'planned' && t.type === 'work')).toBe(false);
    // A past day cannot be re-planned.
    await expect(svc.cleaning.makePlan(om, site.siteId, '2026-11-03', [])).rejects.toThrow(/past day/);
  });

  it('supplies: over-use, under-use, short delivery, reorder and missing equipment; checks need a time-marked photo', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const [a, b] = ds.cleaningSites;
    const sa = (await svc.cleaning.site(om, a.siteId)).stock!;
    expect(sa.supplies.find((s) => s.supply.id === 'floor-cleaner')!.flags).toContain('over_use');
    expect(sa.supplies.find((s) => s.supply.id === 'tissue')!.flags).toContain('short_delivery');
    expect(sa.equipment.some((e) => (e.missing ?? 0) > 0)).toBe(true);
    const sb = (await svc.cleaning.site(om, b.siteId)).stock!;
    expect(sb.supplies.find((s) => s.supply.id === 'hand-soap')!.flags).toContain('under_use');
    // A stock check without a photo is refused; with one it is saved once per day.
    const lines = { supplies: [{ supplyId: 'floor-cleaner', qty: 3 }], equipment: [{ equipmentId: 'vacuum', qty: 1, broken: 0 }] };
    await expect(svc.cleaning.stockCheck(om, a.siteId, { date: TODAY, ...lines, note: '', proof: null as never })).rejects.toThrow(/time-marked/);
    await svc.cleaning.stockCheck(om, a.siteId, { date: TODAY, ...lines, note: '', proof: { image: png(), stampedAt: `${TODAY}T10:30` } });
    await expect(svc.cleaning.stockCheck(om, a.siteId, { date: TODAY, ...lines, note: '', proof: { image: png(), stampedAt: `${TODAY}T10:31` } })).rejects.toThrow(/already recorded/);
    const after = (await svc.cleaning.site(om, a.siteId)).stock!;
    expect(after.supplies.find((s) => s.supply.id === 'floor-cleaner')!.flags).toContain('reorder');
    // A delivery, then received short.
    const del = await svc.cleaning.recordDelivery(om, a.siteId, { date: TODAY, supplies: [{ supplyId: 'bags', qty: 100 }], note: 'test' });
    await expect(svc.cleaning.receiveDelivery(om, a.siteId, del.id, { supplies: [], note: '', proof: { image: png(), stampedAt: `${TODAY}T10:50` } })).rejects.toThrow(/at least one line|every line/);
    await svc.cleaning.receiveDelivery(om, a.siteId, del.id, { supplies: [{ supplyId: 'bags', qty: 80 }], note: '20 missing', proof: { image: png(), stampedAt: `${TODAY}T10:50` } });
    const st = stockStatus(ds.cleaningSites[0], ds.cleaningStock.filter((e) => e.siteId === a.siteId));
    expect(st.supplies.find((s) => s.supply.id === 'bags')!.shortDelivered).toBe(20);
    // Company manager cannot record stock.
    await expect(svc.cleaning.stockCheck(await svc.user('u-cm-arsh'), a.siteId, { date: TODAY, ...lines, note: '', proof: { image: png(), stampedAt: `${TODAY}T10:30` } })).rejects.toThrow(/Not allowed/);
  });

  it('reads the camera time from a JPEG and compares it with the time mark', () => {
    expect(exifTakenAt(jpegWithExif('2026:11:04 10:41:00'))).toBe('2026-11-04T10:41:00');
    expect(exifTakenAt(png())).toBeNull();
    expect(checkTimeMark(jpegWithExif('2026:11:04 10:41:00'), '2026-11-04T10:40', TODAY, '2026-11-04T11:00:00+08:00').check).toBe('matches');
    expect(checkTimeMark(jpegWithExif('2026:11:04 08:00:00'), '2026-11-04T10:40', TODAY, '2026-11-04T11:00:00+08:00').check).toBe('differs');
    expect(checkTimeMark(png(), '2026-11-04T10:40', TODAY, '2026-11-04T11:00:00+08:00').check).toBe('no_camera_time');
  });

  it('Inventory monitors every site: cleaning stock and guard uniforms (Fauzan, 4 Nov 2026)', async () => {
    const { svc, ds } = fresh();
    const inv = await svc.cleaning.inventoryBoard(await svc.user('u-proc-store1'));
    expect(inv.rows.length).toBeGreaterThan(10);
    const clean = inv.rows.filter((r) => r.cleaning);
    expect(clean.length).toBe(2);
    expect(clean.some((r) => r.cleaning!.flagged.some((f) => f.flags.includes('over_use')))).toBe(true);
    expect(inv.rows.some((r) => r.security && r.security.held.some((h) => h.kind === 'UNIFORM'))).toBe(true);
    // The store sees the cleaning site read-only.
    const site = await svc.cleaning.site(await svc.user('u-proc-store1'), ds.cleaningSites[0].siteId);
    expect(site.access).toBe('view');
    await expect(svc.cleaning.recordDelivery(await svc.user('u-proc-store1'), ds.cleaningSites[0].siteId, { date: TODAY, supplies: [{ supplyId: 'bags', qty: 1 }], note: '' })).rejects.toThrow(/Not allowed/);
    // An OM sees only the sites they cover; a company manager and HR are refused.
    const om = await svc.cleaning.inventoryBoard(await svc.user('u-om-klang'));
    expect(om.rows.length).toBeLessThan(inv.rows.length);
    await expect(svc.cleaning.inventoryBoard(await svc.user('u-cm-arsh'))).rejects.toThrow(/Not allowed/);
    await expect(svc.cleaning.inventoryBoard(await svc.user('u-pwvsb-hr'))).rejects.toThrow(/Not allowed/);
  });

  it('monthly report: plan against actual, with the return the other app must send', async () => {
    const { svc, ds } = fresh();
    const r = await svc.cleaning.monthly(await svc.user('u-cm-arsh'), ds.cleaningSites[1].siteId, '2026-11');
    expect(r.access).toBe('view');
    expect(r.lines.find((l) => l.date === TODAY)!.status).toBe('published');
    expect(r.lines.find((l) => l.date === '2026-11-02')!.status).toBe('not_planned');
    expect(r.totals.planned).toBeGreaterThan(0);
    expect(r.totals.workerDaysShort).toBe(1); // one cleaner absent today
    expect(r.totals.deductionEstimate).toBeCloseTo(1700 / 30.5, 1);
    expect(r.returnSpec.perDay.length).toBeGreaterThan(0);
    await expect(svc.cleaning.monthly(await svc.user('u-cm-arsh'), ds.cleaningSites[1].siteId, '2026-13')).rejects.toThrow(/month/);
  });

  it('site fittings: plan, monthly check with a time-marked photo, short and broken items on the Inventory board', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const kit = ds.siteKits[1];
    const view = await svc.cleaning.siteKit(om, kit.siteId);
    expect(view.access).toBe('manage');
    expect(view.status!.short).toBeGreaterThan(0);
    expect(view.status!.broken).toBe(1);
    expect((await svc.cleaning.siteKit(om, ds.siteKits[2].siteId)).status!.checkDue).toBe(true);
    const inv = await svc.cleaning.inventoryBoard(await svc.user('u-proc-exec'));
    expect(inv.totals.fittingsShort).toBeGreaterThan(0);
    expect(inv.totals.fittingsCheckDue).toBe(1);
    // A check must count every item and carry a time-marked photo; company manager cannot record.
    const lines = kit.items.map((i) => ({ itemId: i.id, inPlace: i.required, broken: 0 }));
    await expect(svc.cleaning.recordSiteKit(om, kit.siteId, { kind: 'check', date: TODAY, lines: lines.slice(1), note: '', proof: { image: png(), stampedAt: `${TODAY}T10:00` } }, kit.version)).rejects.toThrow(/every item/);
    await expect(svc.cleaning.recordSiteKit(om, kit.siteId, { kind: 'check', date: TODAY, lines, note: '', proof: null as never }, kit.version)).rejects.toThrow(/time-marked/);
    await expect(svc.cleaning.recordSiteKit(await svc.user('u-cm-arsh'), kit.siteId, { kind: 'check', date: TODAY, lines, note: '', proof: { image: png(), stampedAt: `${TODAY}T10:00` } }, kit.version)).rejects.toThrow(/Not allowed/);
    const after = await svc.cleaning.recordSiteKit(om, kit.siteId, { kind: 'check', date: TODAY, lines, note: 'All fixed', proof: { image: png(), stampedAt: `${TODAY}T10:00` } }, kit.version);
    expect(after.version).toBe(kit.version + 1);
    expect((await svc.cleaning.siteKit(om, kit.siteId)).status!.short).toBe(0);
    // Plan a new list on a site with none, then stale version is refused.
    const site = ds.sites.find((s) => s.companyId === 'co-arsh' && !ds.siteKits.some((k) => k.siteId === s.id) && s.branchId === ds.sites.find((x) => x.id === kit.siteId)!.branchId)!;
    const k1 = await svc.cleaning.saveSiteKit(om, site.id, [{ id: 'post', name: 'Guard post', category: 'shelter', required: 1, owner: 'company', note: '' }], null);
    expect(k1.version).toBe(1);
    await expect(svc.cleaning.saveSiteKit(om, site.id, [], null)).rejects.toThrow(/changed/);
  });

  it('contract end: everything comes back unless the contract hands it over or the COO/CEO approves a gift', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const kit = ds.siteKits[1];
    const list = await svc.cleaning.closeOutList(om, kit.siteId);
    // Client-owned guard post is not ours to take back.
    expect(list.lines.some((l) => l.ref === 'kit:post')).toBe(false);
    expect(list.lines.every((l) => l.mayGive === 0)).toBe(true);
    const photo = () => ({ image: png(), stampedAt: `${TODAY}T10:00` });
    await expect(svc.cleaning.recordTakeBack(om, kit.siteId, { date: TODAY, lines: [{ ref: 'kit:chair', takenBack: 1, handedOver: 1 }], note: '', proof: photo() })).rejects.toThrow(/only 0 may be handed over/);
    // Only the COO or CEO approves a gift; the OM cannot.
    await expect(svc.cleaning.approveGift(om, kit.siteId, { ref: 'kit:chair', qty: 1, reason: 'Goodwill' })).rejects.toThrow(/Not allowed/);
    await expect(svc.cleaning.approveGift(await svc.user('u-coo'), kit.siteId, { ref: 'kit:chair', qty: 1, reason: '' })).rejects.toThrow(/Reason/);
    await svc.cleaning.approveGift(await svc.user('u-coo'), kit.siteId, { ref: 'kit:chair', qty: 1, reason: 'Client asked; old chair, goodwill' });
    await svc.cleaning.recordTakeBack(om, kit.siteId, { date: TODAY, lines: [{ ref: 'kit:chair', takenBack: 1, handedOver: 1 }, { ref: 'kit:fan', takenBack: 0 }], note: 'Fan missing', proof: photo() });
    const after = await svc.cleaning.closeOutList(om, kit.siteId);
    expect(after.closed).toBe(true);
    expect(after.lines.find((l) => l.ref === 'kit:chair')!.notRecovered).toBe(0);
    expect(after.lines.find((l) => l.ref === 'kit:fan')!.notRecovered).toBe(1);
    const inv = await svc.cleaning.inventoryBoard(await svc.user('u-proc-exec'));
    expect(inv.totals.notRecovered).toBeGreaterThan(0);
    // A contract clause allows handing over cleaning equipment without approval.
    const s = ds.cleaningSites[0];
    const base = { ...s } as Record<string, unknown>;
    for (const k of ['id', 'companyId', 'siteId', 'map', 'version', 'updatedBy', 'updatedAt']) delete base[k];
    await expect(svc.cleaning.saveSetup(om, s.siteId, { ...(base as never), equipment: [{ id: 'hose', name: 'Hose', required: 2, atEnd: 'hand_over', handOverRef: '' }] }, s.version)).rejects.toThrow(/clause/);
    await svc.cleaning.saveSetup(om, s.siteId, { ...(base as never), equipment: [{ id: 'hose', name: 'Hose', required: 2, atEnd: 'hand_over', handOverRef: 'Clause 12.3 (test)' }] }, s.version);
    const cl = await svc.cleaning.closeOutList(om, s.siteId);
    const hose = cl.lines.find((l) => l.ref === 'clean:hose')!;
    expect(hose.mayGive).toBe(hose.inPlace);
    expect(hose.mayGive).toBeGreaterThan(0);
  });

  it('marks a job not needed today with a reason and photo, and gives its time to other due work (Fauzan, 4 Nov 2026)', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const site = ds.cleaningSites[0];
    const before = ds.cleaningDays.find((d) => d.siteId === site.siteId && d.date === TODAY)!;
    // A job later today that the supervisor says is not needed (e.g. drains already clean).
    const later = before.tasks.filter((t) => t.type === 'work' && t.status === 'planned' && t.start > '11:00').sort((a, b) => b.minutes - a.minutes)[0];
    expect(later).toBeTruthy();
    // Baseline: the same day simply re-planned from now with nothing skipped.
    const other = fresh();
    const base = await other.svc.cleaning.makePlan(await other.svc.user('u-om-klang'), site.siteId, TODAY, before.absentIds);
    const coveredBefore = base.uncovered.reduce((n, u) => n + u.minutes, 0);
    await expect(svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [later.id], action: 'not_needed', note: '', proof: { image: jpegWithExif('2026:11:04 10:50:00'), stampedAt: `${TODAY}T10:50` } })).rejects.toThrow(/Say why/);
    await expect(svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [later.id], action: 'not_needed', note: 'Drains already clean', proof: null })).rejects.toThrow(/photo/);
    const day = await svc.cleaning.recordTasks(om, site.siteId, TODAY, { taskIds: [later.id], action: 'not_needed', note: 'Drains already clean', proof: { image: jpegWithExif('2026:11:04 10:50:00'), stampedAt: `${TODAY}T10:50` } });
    const rec = day.tasks!.find((t) => t.id === later.id)!;
    expect(rec.status).toBe('not_needed');
    // Its time went to other work: less due work is left uncovered, and the same job is not placed again.
    expect(day.uncovered!.reduce((n, u) => n + u.minutes, 0)).toBeLessThan(coveredBefore);
    expect(day.tasks!.filter((t) => t.jobKey === later.jobKey && t.type === 'work').length).toBe(1);
    // Done, checked and missed records stay (work sent back for redo is placed again as new work, as before).
    for (const t of before.tasks.filter((x) => x.type === 'work' && ['done', 'checked', 'missed'].includes(x.status))) expect(day.tasks!.find((x) => x.id === t.id)?.status).toBe(t.status);
    // Not on a past day; and the company manager cannot.
    await expect(svc.cleaning.recordTasks(await svc.user('u-cm-arsh'), site.siteId, TODAY, { taskIds: [later.id], action: 'not_needed', note: 'x', proof: null })).rejects.toThrow();
    const m = await svc.cleaning.monthly(om, site.siteId, TODAY.slice(0, 7));
    expect(m.totals.notNeeded).toBe(1);
    expect(m.totals.missed).toBe(m.lines.reduce((n, l) => n + l.missed, 0));
  });

  it("client slip: work done waits for the client's signed slip with its comment (Fauzan, 4 Nov 2026)", async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const s = ds.cleaningSites[1];
    // Today's published day: record one work task done, on an area that needs the client's slip.
    const day = ds.cleaningDays.find((d) => d.siteId === s.siteId && d.date === TODAY && d.status === 'published')!;
    const w = day.tasks.find((t) => t.type === 'work' && t.status === 'planned')!;
    const base = { ...s, areas: s.areas.map((a) => (a.id === w.areaId ? { ...a, clientAck: true } : { ...a, clientAck: false })) } as Record<string, unknown>;
    for (const k of ['id', 'companyId', 'siteId', 'map', 'version', 'updatedBy', 'updatedAt']) delete base[k];
    await svc.cleaning.saveSetup(om, s.siteId, base as never, s.version);
    await svc.cleaning.recordTasks(om, s.siteId, TODAY, { taskIds: [w.id], action: 'done', note: '', proof: null });
    let view = await svc.cleaning.site(om, s.siteId);
    expect(view.slipStatus).toHaveLength(1);
    expect(view.slipStatus[0].outstanding).toEqual([TODAY]);
    expect((await svc.cleaning.board(om)).rows.find((r) => r.siteId === s.siteId)!.slipsOutstanding).toBe(1);
    const slip = (outcome: 'accepted' | 'not_accepted', comment: string, action = '') => ({
      signedOn: TODAY, from: TODAY, to: TODAY, areaIds: [w.areaId!], signer: 'Synthetic school clerk', outcome, comment, action, slip: { name: 'slip.png', data: png() },
    });
    // Not accepted needs the client's comment and what will be done.
    await expect(svc.cleaning.recordClientAck(om, s.siteId, slip('not_accepted', ''))).rejects.toThrow(/comment/);
    await expect(svc.cleaning.recordClientAck(om, s.siteId, slip('not_accepted', 'Edges not trimmed'))).rejects.toThrow(/done about it/);
    await expect(svc.cleaning.recordClientAck(om, s.siteId, { ...slip('accepted', ''), slip: { name: 'x', data: 'data:text/plain;base64,AAAA' } })).rejects.toThrow(/photo or scan/);
    await expect(svc.cleaning.recordClientAck(om, s.siteId, { ...slip('accepted', ''), signedOn: '2026-11-05' })).rejects.toThrow(/future/);
    await expect(svc.cleaning.recordClientAck(await svc.user('u-cm-arsh'), s.siteId, slip('accepted', ''))).rejects.toThrow(/Not allowed/);
    await svc.cleaning.recordClientAck(om, s.siteId, slip('not_accepted', 'Edges not trimmed', 'Redo tomorrow'));
    view = await svc.cleaning.site(om, s.siteId);
    expect(view.slipStatus[0].rejected).toEqual([TODAY]);
    // The same file cannot be used again.
    const again = slip('accepted', 'Done properly');
    await svc.cleaning.recordClientAck(om, s.siteId, again);
    await expect(svc.cleaning.recordClientAck(om, s.siteId, again)).rejects.toThrow(/already used/);
    view = await svc.cleaning.site(om, s.siteId);
    expect(view.slipStatus[0].acknowledged).toEqual([TODAY]);
    expect(view.slips).toHaveLength(2);
    expect(view.entries.every((e) => e.kind !== 'client_ack')).toBe(true);
    const m = await svc.cleaning.monthly(await svc.user('u-cm-arsh'), s.siteId, TODAY.slice(0, 7));
    expect(m.totals.slipsReceived).toBe(2);
    expect(m.totals.slipsNotAccepted).toBe(1);
    expect(m.totals.slipDaysOutstanding).toBe(0);
    expect(m.slips.map((x) => x.comment)).toEqual(['Edges not trimmed', 'Done properly']);
    // The scan opens for someone who may see the site.
    expect((await svc.cleaning.proof(await svc.user('u-cm-arsh'), s.siteId, m.slips[0].proofIds[0])).mime).toBe('image/png');
  });
});
