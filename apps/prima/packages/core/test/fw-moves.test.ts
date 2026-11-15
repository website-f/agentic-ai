// Part P (Fitri package, FWM papers S1-S7 / T1-T3, Fauzan 13-14 Nov 2026): foreign worker hostel / site moves, hostel
// needs, inventory, checks, damage / loss and maintenance. Made-up workers and photos only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, moveWarnings, priceOn, FW_HOSTEL_DEFAULTS, workingDaysUntil, deductionFlags } from '../src';

const TODAY = '2026-11-18';
const NOW = myt(TODAY, '10:00');
const PHOTO = (n: string) => 'data:image/jpeg;base64,' + btoa(`photo-${n}`);

function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  // The Klang OM covers sites 001 and 004; a second OM (made up for the test) covers site 002.
  const om = ds.users.find((u) => u.id === 'u-om-klang')!;
  om.siteIds = ['st-sasa-001', 'st-sasa-004'];
  ds.users.push({ ...om, id: 'u-om-test-2', name: 'Test OM Two', siteIds: ['st-sasa-002'] });
  ds.grants.push(...ds.grants.filter((g) => g.userId === 'u-om-klang').map((g) => ({ ...g, id: `${g.id}-2`, userId: 'u-om-test-2' })));
  ds.hostels.push({ id: 'hs-sasa-test2', companyId: 'co-sasa', name: 'Test Hostel Two', address: 'Klang (made up)', beds: 2, tenure: 'RENTED', sector: 'private' });
  const fw = ['pr-sasa-0003', 'pr-sasa-0005', 'pr-sasa-0009'];
  for (const id of fw) ds.people.find((p) => p.id === id)!.workSiteId = 'st-sasa-001';
  let now = NOW;
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  return { ds, svc, fw, at: (t: string) => (now = t) };
}

const u = (svc: PrimaService, id: string) => svc.user(id);

describe('Part P pure checks', () => {
  it('3 working days with a holiday in between; other-company move allowed with "employer stays"; certificate warns only', () => {
    // Fri 20 Nov -> Wed 25 Nov: Mon 23, Tue 24 (holiday), Wed 25 = 2 working days.
    expect(workingDaysUntil('2026-11-20', '2026-11-25', new Set(['2026-11-24']))).toBe(2);
    const w = moveWarnings({ leadDays: 3, workingDays: 1, otherCompany: { employer: 'A Sdn Bhd', site: 'B Sdn Bhd' }, papers: [{ name: 'W1', permit: 'expired', passport: 'valid' }], hostelFull: null, cert: 'missing' });
    expect(w.join('|')).toMatch(/urgent/);
    expect(w.join('|')).toMatch(/employer stays A Sdn Bhd/);
    expect(w.join('|')).toMatch(/permit expired/);
    expect(w.join('|')).toMatch(/no accommodation certificate/);
    expect(priceOn(FW_HOSTEL_DEFAULTS.prices, 'Single mattress', '2026-11-18')).toEqual({ amount: 250, from: '2026-10-02' });
    expect(priceOn(FW_HOSTEL_DEFAULTS.prices, 'Single mattress', '2026-09-01')).toBeNull();
    expect(deductionFlags(1200, 2000, 0).join(' ')).toMatch(/s\.24\(8\)/);
  });
});

describe('Part P moves (P1-P6, P9)', () => {
  it('P1: stays, over capacity shown red, a second stay ends the first, a Malaysian cannot be added', async () => {
    const { svc, ds } = setup();
    const fwm = await u(svc, 'u-fwm-ex1');
    for (const id of ['pr-sasa-0003', 'pr-sasa-0005', 'pr-sasa-0009']) await svc.fwMoves.addStay(fwm, { hostelId: 'hs-sasa-test2', personId: id, from: TODAY });
    const b = await svc.fwMoves.board(fwm);
    const row = (b.hostels as { hostel: { id: string }; residents: number; over: boolean }[]).find((h) => h.hostel.id === 'hs-sasa-test2')!;
    expect(row).toMatchObject({ residents: 3, over: true });
    const old = ds.hostelStays.find((s) => s.personId === 'pr-sasa-0003' && s.hostelId === 'hs-sasa-klang')!;
    expect(old.to).toBe('2026-11-17');
    const my = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'MY')!;
    await expect(svc.fwMoves.addStay(fwm, { hostelId: 'hs-sasa-test2', personId: my.id, from: TODAY })).rejects.toThrow(/foreign workers/);
    await expect(svc.fwMoves.addStay(await u(svc, 'u-cm-arsh'), { hostelId: 'hs-sasa-test2', personId: 'pr-sasa-0003', from: TODAY })).rejects.toThrow();
  });

  it('P3-P6: a site + hostel move for 2 workers, five steps in order, release, receive creates the stay, FWM closes', async () => {
    const { svc, ds } = setup();
    const om = await u(svc, 'u-om-klang');
    const om2 = await u(svc, 'u-om-test-2');
    await expect(svc.fwMoves.raiseMove(om, { personIds: ['pr-sasa-0003', 'pr-sasa-0005'], newPicId: 'u-om-test-2', toSiteId: 'st-sasa-002', toHostelId: 'hs-sasa-test2', startOn: '2026-11-19', reason: 'SITE_CHANGE', justification: 'New post opened at site 002' })).rejects.toThrow(/urgent/);
    const m = await svc.fwMoves.raiseMove(om, { personIds: ['pr-sasa-0003', 'pr-sasa-0005'], newPicId: 'u-om-test-2', toSiteId: 'st-sasa-002', toHostelId: 'hs-sasa-test2', startOn: '2026-11-30', reason: 'SITE_CHANGE', justification: 'New post opened at site 002' });
    expect(m.type).toBe('BOTH');
    expect(m.steps.originPic?.bySubmit).toBe(true);
    // The OM cannot sign FWM's step; FWM cannot sign before the new PIC agrees.
    await expect(svc.fwMoves.decideMove(om, m.id, 'fwm', 'approve', 'ok')).rejects.toThrow(/not yours/);
    await expect(svc.fwMoves.decideMove(await u(svc, 'u-fwm-ex1'), m.id, 'fwm', 'approve', 'Papers fine')).rejects.toThrow(/not yours/);
    await svc.fwMoves.decideMove(om2, m.id, 'newPic', 'approve', 'Can take them');
    // FWM returns for correction; the OM resends; earlier rounds kept.
    await svc.fwMoves.decideMove(await u(svc, 'u-fwm-ex1'), m.id, 'fwm', 'return', 'Wrong start date');
    await svc.fwMoves.resubmitMove(om, m.id, { startOn: '2026-12-01' });
    await svc.fwMoves.decideMove(om2, m.id, 'newPic', 'approve', 'Can take them');
    await svc.fwMoves.decideMove(await u(svc, 'u-fwm-ex1'), m.id, 'fwm', 'approve', 'Papers fine');
    // OGM cannot approve a private site move; a reject needs a reason.
    await expect(svc.fwMoves.decideMove(await u(svc, 'u-ogm'), m.id, 'ketua', 'approve', 'ok fine')).rejects.toThrow();
    await expect(svc.fwMoves.decideMove(await u(svc, 'u-cm-sasa'), m.id, 'hq', 'reject', '')).rejects.toThrow(/Reason/);
    await svc.fwMoves.decideMove(await u(svc, 'u-cm-sasa'), m.id, 'hq', 'approve', 'Approved for the new post');
    // One person never signs two steps of the same move.
    await expect(svc.fwMoves.decideMove(await u(svc, 'u-cm-sasa'), m.id, 'ketua', 'approve', 'Also me')).rejects.toThrow(/not yours/);
    const approved = await svc.fwMoves.decideMove(await u(svc, 'u-opsdir'), m.id, 'ketua', 'approve', 'Go ahead');
    expect(approved.status).toBe('approved');
    expect(approved.rounds).toHaveLength(1);
    // Receive before release/move is refused (no stay without an approved, released move).
    await expect(svc.fwMoves.receiveMove(om2, m.id, { arrived: true, identity: 'card', briefing: true })).rejects.toThrow(/on its way/);
    // Release with a missing locker key opens a damage report, not a charge.
    await expect(svc.fwMoves.releaseMove(om, m.id, { attendanceChecked: true, itemsReturned: ['Worker card'], roomChecked: true, gaps: [{ item: 'Room / locker key', note: 'Not returned', personId: 'pr-sasa-0003' }] })).rejects.toThrow(/photo/);
    const rel = await svc.fwMoves.releaseMove(om, m.id, { attendanceChecked: true, itemsReturned: ['Worker card'], roomChecked: true, gaps: [{ item: 'Room / locker key', note: 'Not returned', personId: 'pr-sasa-0003' }], photos: [PHOTO('gap')] });
    expect(rel.release!.damageIds).toHaveLength(1);
    expect((ds.hostelRecs.find((r) => r.id === rel.release!.damageIds[0]) as { penalty: unknown }).penalty).toBeNull();
    await svc.fwMoves.transitMove(om, m.id, { transport: 'Company van', on: '2026-12-01', carries: ['Passport', 'Permit', 'Worker card'] });
    const rec = await svc.fwMoves.receiveMove(om2, m.id, { arrived: true, identity: 'face', briefing: true, room: 'R1' });
    expect(rec.receive!.stayIds).toHaveLength(2);
    expect(ds.hostelStays.find((s) => s.personId === 'pr-sasa-0003' && s.hostelId === 'hs-sasa-klang')!.to).toBe('2026-11-30');
    expect(ds.people.find((p) => p.id === 'pr-sasa-0003')!.workSiteId).toBe('st-sasa-002');
    await expect(svc.fwMoves.closeMove(om, m.id, { jaRef: 'JA-1', headcountOk: true, documentsKept: true })).rejects.toThrow(/FWM/);
    // P6: 25 hours later JA still shows the old hostel: on FWM's difference list.
    ds.jaRecords.push({ id: 'ja:worker:co-sasa:SASA0003', companyId: 'co-sasa', dataset: 'worker', externalId: 'SASA0003', sourceUpdatedAt: NOW, receivedAt: NOW, worker: { staffNo: 'SASA0003', name: 'Made Up', nationality: 'NP', status: 'active', siteCode: 'SASA-001', hostel: 'Old place', papers: [] } } as never);
    const later = new Date(Date.parse(rec.receive!.at) + 25 * 3_600_000).toISOString();
    (svc as unknown as { now: () => string }).now = () => later;
    const diff = await svc.fwMoves.jaDifferences(await u(svc, 'u-fwm-ex1'));
    expect(diff.some((d) => d.staffNo === 'SASA0003' && /24 h/.test(d.what))).toBe(true);
    const closed = await svc.fwMoves.closeMove(await u(svc, 'u-fwm-ex1'), m.id, { jaRef: 'JA-MOVE-1', headcountOk: true, documentsKept: true });
    expect(closed.status).toBe('closed');
  });

  it('P3 change: a new arrival skips step 1; a move to another company site shows "employer stays"', async () => {
    const { svc, ds } = setup();
    ds.users.find((u) => u.id === 'u-om-test-2')!.siteIds = ['st-sasa-002', 'st-arsh-002'];
    const fwm = await u(svc, 'u-fwm-ex1');
    const m = await svc.fwMoves.raiseMove(fwm, { personIds: ['pr-sasa-0009'], newArrival: true, newPicId: 'u-om-test-2', toSiteId: 'st-sasa-002', startOn: '2026-12-01', reason: 'OPERATIONS', justification: 'First placement after arrival' });
    expect(m.type).toBe('ARRIVAL');
    expect(m.originPicId).toBeNull();
    const om2 = await u(svc, 'u-om-test-2');
    await svc.fwMoves.decideMove(om2, m.id, 'newPic', 'approve', 'Ready');
    // FWM raised it: another FWM person checks it.
    await expect(svc.fwMoves.decideMove(fwm, m.id, 'fwm', 'approve', 'mine')).rejects.toThrow(/not yours/);
    await svc.fwMoves.decideMove(await u(svc, 'u-fwm-ex2'), m.id, 'fwm', 'approve', 'Papers fine');
    expect((await svc.fwMoves.board(om2)).moves.length).toBe(1);
    // Despatch sees nothing; an OM of another area cannot open it.
    await expect(svc.fwMoves.board(await u(svc, 'u-fwm-desp'))).rejects.toThrow();
    const other = await svc.fwMoves.board(await u(svc, 'u-om-johor')).catch(() => ({ moves: [] }));
    expect(other.moves).toHaveLength(0);
    // Other company site: allowed, labelled.
    const m2 = await svc.fwMoves.raiseMove(fwm, { personIds: ['pr-sasa-0005'], newArrival: true, newPicId: 'u-om-test-2', toSiteId: 'st-arsh-002', startOn: '2026-12-01', reason: 'OPERATIONS', justification: 'Works at the Arsh site' });
    expect(m2.warnings.join(' ')).toMatch(/employer stays/);
    expect(m2.companyId).toBe('co-sasa');
  });
});

describe('Part P hostel inventory, damage, maintenance and needs (P7, P8, P13-P17)', () => {
  it('first count verified by someone else; damage needs a photo; penalty only after a negligence finding; worker pays first, HR decides a deduction', async () => {
    const { svc, ds } = setup();
    const fwm = await u(svc, 'u-fwm-ex1');
    const fwm2 = await u(svc, 'u-fwm-ex2');
    const om = await u(svc, 'u-om-klang');
    const c = await svc.fwMoves.openCount(fwm, 'hs-sasa-klang');
    await svc.fwMoves.submitCount(om, c.id, [{ name: 'Single mattress', area: 'Rooms', qty: 8, good: 8, damaged: 0, missing: 0 }, { name: 'Fan', area: 'Rooms', qty: 4, good: 4, damaged: 0, missing: 0 }]);
    await svc.fwMoves.verifyCount(fwm, c.id, 'Cross-checked on site');
    await expect(svc.fwMoves.ackCount(await u(svc, 'u-cm-arsh'), c.id)).rejects.toThrow();
    await svc.fwMoves.ackCount(await u(svc, 'u-cm-sasa'), c.id);
    // The counter cannot verify their own count.
    const c2 = await svc.fwMoves.openCount(fwm2, 'hs-sasa-klang');
    await svc.fwMoves.submitCount(await u(svc, 'u-cm-sasa'), c2.id, [{ name: 'Fan', area: 'Rooms', qty: 4, good: 4, damaged: 0, missing: 0 }]);
    await expect(svc.fwMoves.verifyCount(await u(svc, 'u-cm-sasa'), c2.id, 'mine')).rejects.toThrow();
    await expect(svc.fwMoves.reportDamage(om, 'hs-sasa-klang', { lines: [{ item: 'Single mattress', qty: 1 }], workerIds: ['pr-sasa-0003'], cause: 'NEGLIGENCE', suggested: 'replace', note: 'Burnt', photos: [] })).rejects.toThrow(/photo/);
    const d = await svc.fwMoves.reportDamage(om, 'hs-sasa-klang', { lines: [{ item: 'Single mattress', qty: 1 }], workerIds: ['pr-sasa-0003'], cause: 'NEGLIGENCE', suggested: 'replace', note: 'Burnt by a cigarette', photos: [PHOTO('dmg')] });
    // No named worker on a charge outside the report, and only FWM decides.
    await expect(svc.fwMoves.decideDamage(om, d.id, { action: 'replace', finding: 'Negligence found', negligenceBy: 'pr-sasa-0003' })).rejects.toThrow(/FWM/);
    await expect(svc.fwMoves.decideDamage(fwm, d.id, { action: 'replace', finding: 'Negligence found', negligenceBy: 'pr-sasa-0009' })).rejects.toThrow(/worker involved/);
    const dec = await svc.fwMoves.decideDamage(fwm, d.id, { action: 'replace', finding: 'Negligence found: smoking in the room', negligenceBy: 'pr-sasa-0003' });
    expect(dec.penalty).toMatchObject({ amount: 250, status: 'due' });
    // Replace created exactly one need, already checked by FWM.
    expect(ds.hostelNeeds.filter((n) => n.fromDamageId === d.id)).toHaveLength(1);
    // Not paid: notice only after the due date; then FWM asks HR; HR decides with the s.24 flag.
    await expect(svc.fwMoves.penaltyStep(fwm, d.id, 'notice', {})).rejects.toThrow(/due date/);
    (svc as unknown as { today: () => string }).today = () => '2026-12-31';
    await svc.fwMoves.penaltyStep(fwm, d.id, 'notice', { note: 'Notice issued' });
    await svc.fwMoves.penaltyStep(fwm, d.id, 'ask', { note: 'Still unpaid after the notice' });
    await expect(svc.fwMoves.penaltyStep(fwm, d.id, 'hr', { decision: 'approve', note: 'ok' })).rejects.toThrow(/HR/);
    const hr = await svc.fwMoves.penaltyStep(await u(svc, 'u-pwvsb-hr'), d.id, 'hr', { decision: 'spread', months: 2, note: 'Spread over two months' });
    expect((hr as { penalty: { status: string; hr: { flags: string[] } } }).penalty.status).toBe('deduction_approved');
    expect((hr as { penalty: { hr: { flags: string[] } } }).penalty.hr.flags[0]).toMatch(/s\.24\(4\)/);
  });

  it('maintenance: before photos, 3 quotes or 2 with the Asset Director, OD approves, critical skips, close needs after photos', async () => {
    const { svc } = setup();
    const om = await u(svc, 'u-om-klang');
    const fwm = await u(svc, 'u-fwm-ex1');
    const q = (n: number) => Array.from({ length: n }, (_, i) => ({ contractor: `Contractor ${i + 1}`, amount: 500 + i * 50, doc: PHOTO(`q${i}`) }));
    await expect(svc.fwMoves.requestMaint(om, 'hs-sasa-klang', { what: 'Roof leak over room 2', critical: false, costBy: 'company', before: [], quotes: q(3) })).rejects.toThrow(/photo/);
    const m = await svc.fwMoves.requestMaint(om, 'hs-sasa-klang', { what: 'Roof leak over room 2', critical: false, costBy: 'company', before: [PHOTO('b1')], quotes: q(2) });
    await svc.fwMoves.maintStep(fwm, m.id, 'fwm', { note: 'Checked; roof needs a contractor' });
    await expect(svc.fwMoves.maintStep(await u(svc, 'u-ogm'), m.id, 'approve', { note: 'ok go' })).rejects.toThrow(/Operations Director/);
    await svc.fwMoves.maintStep(await u(svc, 'u-opsdir'), m.id, 'approve', { note: 'Approved, residents at risk of wet beds' });
    await expect(svc.fwMoves.maintStep(await u(svc, 'u-asset-mm'), m.id, 'order', {})).rejects.toThrow(/Asset Director/);
    await svc.fwMoves.maintStep(await u(svc, 'u-asset-dir'), m.id, 'order', { twoQuotesReason: 'Only two roofers serve this area' });
    await expect(svc.fwMoves.maintStep(fwm, m.id, 'close', {})).rejects.toThrow(/after photos/);
    await svc.fwMoves.maintStep(om, m.id, 'done', { after: [PHOTO('a1')], note: 'Fixed as scoped' });
    await svc.fwMoves.maintStep(fwm, m.id, 'close', {});
    const crit = await svc.fwMoves.requestMaint(om, 'hs-sasa-klang', { what: 'Main electricity tripped, no power', critical: true, costBy: 'landlord', before: [PHOTO('c1')] });
    expect(crit.toldAt).toBeTruthy();
    expect(crit.status).toBe('landlord');
    expect(crit.workOrderId).toBeNull();
  });

  it('needs: shows residents and items, FWM verifies, OD approves, one linked purchase, RM12,000 goes to the COO, OM receipt raises the list', async () => {
    const { svc, ds } = setup();
    const om = await u(svc, 'u-om-klang');
    const fwm = await u(svc, 'u-fwm-ex1');
    const c = await svc.fwMoves.openCount(fwm, 'hs-sasa-klang');
    await svc.fwMoves.submitCount(om, c.id, [{ name: 'Single mattress', area: 'Rooms', qty: 8, good: 8, damaged: 0, missing: 0 }]);
    await svc.fwMoves.verifyCount(await u(svc, 'u-fwm-ex2'), c.id, 'Verified');
    const n = await svc.fwMoves.raiseNeed(om, 'hs-sasa-klang', { items: [{ name: 'Single mattress', qty: 10 }], reason: 'MORE_WORKERS', justification: 'Ten more workers arriving', neededBy: '2026-12-10' });
    expect(n.seen).toMatchObject({ residents: 8, goodItems: { 'Single mattress': 8 } });
    await svc.fwMoves.decideNeed(fwm, n.id, 'fwm', 'Verified on the visit');
    await expect(svc.fwMoves.decideNeed(await u(svc, 'u-opsdir'), n.id, 'reject', '')).rejects.toThrow(/Reason/);
    await svc.fwMoves.decideNeed(await u(svc, 'u-opsdir'), n.id, 'approve', 'Real need for the new workers');
    // Asset Management sees it without worker names; the OM cannot order it.
    const am = await u(svc, 'u-asset-mm');
    const amb = await svc.fwMoves.board(am);
    expect(JSON.stringify(amb)).not.toMatch(/Bikash|Gurung/);
    await expect(svc.fwMoves.orderNeed(om, n.id, { estCost: 12000, reason: 'Buy' })).rejects.toThrow();
    await expect(svc.amBuyRequest(am, { description: 'Hostel beds', category: 'FURNITURE', qty: 2, estCost: 400, location: 'Klang hostel', ownerEntity: 'Sasa', reason: 'For hostel', hostelId: 'hs-sasa-klang' })).rejects.toThrow(/approved hostel need/);
    const o = await svc.fwMoves.orderNeed(am, n.id, { estCost: 12000, reason: 'Mattresses for the hostel' });
    expect(ds.amAssets.filter((a) => a.hostelNeedId === n.id)).toHaveLength(1);
    await expect(svc.fwMoves.orderNeed(am, n.id, { estCost: 12000, reason: 'Again' })).rejects.toThrow();
    await expect(svc.amBuyDecide(await u(svc, 'u-fd'), o.amAssetId!, true, 'ok')).rejects.toThrow(/COO/);
    await svc.amBuyDecide(await u(svc, 'u-coo'), o.amAssetId!, true, 'Approved for the new workers');
    await svc.fwMoves.needDelivered(am, n.id, TODAY);
    await svc.fwMoves.needReceived(om, n.id, PHOTO('goods'));
    const inv = ds.hostelRecs.find((r) => r.kind === 'inventory' && r.hostelId === 'hs-sasa-klang') as { lines: { name: string; good: number }[]; history: { source: string }[] };
    expect(inv.lines.find((l) => l.name === 'Single mattress')!.good).toBe(18);
    expect(inv.history.map((h) => h.source)).toEqual(['count', 'need']);
  });

  it('checks: a weekly check missed shows on the OM’s Do today; settings are FWM only', async () => {
    const { svc } = setup();
    const om = await u(svc, 'u-om-klang');
    const items = await svc.fwMoves.homeItems(om);
    expect(items.some((i) => /Weekly check overdue/.test(i.title))).toBe(true);
    await svc.fwMoves.recordCheck(om, 'hs-sasa-klang', { freq: 'weekly', ticks: { clean: true, safe: true, working: true }, photos: [PHOTO('w1'), PHOTO('w2')] });
    expect((await svc.fwMoves.homeItems(om)).some((i) => /Weekly check overdue/.test(i.title))).toBe(false);
    await expect(svc.fwMoves.setSettings(om, { penaltyPayDays: 7 }, 'shorter')).rejects.toThrow(/FWM/);
    const st = await svc.fwMoves.setSettings(await u(svc, 'u-fwm-mgr'), { checkDays: { weekly: 10, monthly: 30, audit: 182, sweep: 90 } }, 'Weekly is every 10 days for now');
    expect(st.checkDays.weekly).toBe(10);
  });
});
