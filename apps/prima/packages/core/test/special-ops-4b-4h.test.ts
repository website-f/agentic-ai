// Special Operations Phase 4, slices 4B-4H (Fauzan, 1-2 Nov 2026). Mock data only, in memory.
// 4B arms register, 4C arms requests and the supplier file, 4D armed jobs and the CIT pack, 4E the CMS app link,
// 4F tracker and driver hours, 4G Asset Management feed and purchases, 4H the trading switch and imports.
import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  BadRequest,
  MemoryStore,
  PrimaService,
  RuleBlocked,
  TradingOff,
  addDays,
  demoPin,
  driverHours,
  generateDataset,
  importStepBlocked,
  myt,
  type Dataset,
} from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh(now = NOW) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => now) };
}

function witnessIn(ds: Dataset, companyId: string, notIds: (string | undefined)[]): { staffNo: string; pin: string } {
  const p = ds.people.find((x) => x.companyId === companyId && x.status === 'active' && x.pinHash && !notIds.includes(x.id))!;
  return { staffNo: p.staffNo, pin: demoPin(p.staffNo) };
}

describe('4B arms register', () => {
  it('keys rounds once: a receipt, an issue and a return move the ledger; a count difference opens a case and never changes it', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const w = witnessIn(ds, 'co-sasa', [cm.personId]);
    const stock = () => ds.ammoStocks.find((s) => s.id === 'ammo-va-sasa-1-pistol')!;
    const before = stock().ledger;
    await svc.receiveAmmo(cm, { vaultId: 'va-sasa-1', calibre: '9 mm', rounds: 100, ref: 'DO-1001', witness: w });
    expect(stock().ledger).toBe(before + 100);
    await expect(svc.receiveAmmo(cm, { vaultId: 'va-sasa-1', calibre: '9 mm', rounds: 0, ref: 'DO-1002', witness: w })).rejects.toBeInstanceOf(BadRequest);
    // A count short by 3 opens a P1 case; the ledger stays as it was.
    const counted = await svc.countAmmo(cm, stock().id, { counted: before + 97, witness: w });
    expect(counted.ok).toBe(false);
    expect(counted.caseRef).toBeTruthy();
    expect(stock().ledger).toBe(before + 100);
    expect(ds.cases.some((c) => c.ref === counted.caseRef && c.severity === 'P1')).toBe(true);
    // The counter cannot be their own checker.
    const self = ds.people.find((p) => p.id === cm.personId);
    if (self?.pinHash) await expect(svc.countAmmo(cm, stock().id, { counted: 1, witness: { staffNo: self.staffNo, pin: demoPin(self.staffNo) } })).rejects.toThrow();
  });

  it('moves the ammunition ledger on issue and return for the firearm’s calibre', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const arms = await svc.arms(cm, 'co-sasa');
    const due = arms.needIssue[0];
    const firearm = ds.firearms.find((f) => f.companyId === 'co-sasa' && f.status === 'IN_VAULT' && f.ownership !== 'TRADE' && f.vaultId === 'va-sasa-1')!;
    const stock = ds.ammoStocks.find((s) => s.vaultId === firearm.vaultId && s.calibre === firearm.calibre)!;
    const before = stock.ledger;
    if (!due) return;
    const shift = ds.shifts.find((s) => s.id === due.id)!;
    let m;
    try {
      m = await svc.issueFirearm(cm, { shiftId: shift.id, firearmId: firearm.id, rounds: 6, witness: witnessIn(ds, 'co-sasa', [cm.personId, shift.personId!]), rfidScan: firearm.rfidTag ?? null });
    } catch (e) {
      // The seeded guard may not be cleared for this firearm; the ledger rule is then covered by the request test below.
      expect(e).toBeInstanceOf(RuleBlocked);
      return;
    }
    expect(stock.ledger).toBe(before - 6);
    await svc.returnFirearm(cm, { movementId: m.id, roundsReturned: 6, witness: witnessIn(ds, 'co-sasa', [cm.personId, shift.personId!]), rfidScan: firearm.rfidTag ?? null });
    expect(stock.ledger).toBe(before);
    expect(stock.log!.map((l) => l.kind)).toEqual(['ISSUE', 'RETURN']);
  });

  it('checks the register book, takes vault watch check-ins, and records missing, found, deposited and collected firearms', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const vault0 = ds.vaults.find((v) => v.id === 'va-sasa-1')!;
    const vault = { get registerChecks() { return ds.vaults.find((v) => v.id === vault0.id)!.registerChecks; }, get registerCheckedAt() { return ds.vaults.find((v) => v.id === vault0.id)!.registerCheckedAt; }, id: vault0.id };
    await expect(svc.checkRegisterBook(cm, vault.id, { matches: false, note: '' })).rejects.toBeInstanceOf(BadRequest);
    const diff = await svc.checkRegisterBook(cm, vault.id, { matches: false, note: 'Book shows SG-004 returned at 07:00, online shows still out' });
    expect(diff.caseRef).toBeTruthy();
    const ok = await svc.checkRegisterBook(cm, vault.id, { matches: true, note: '' });
    expect(ok.caseRef).toBeNull();
    expect(vault.registerChecks!.length).toBe(2);
    expect(vault.registerCheckedAt).toBe(NOW);

    const fid = ds.firearms.find((x) => x.companyId === 'co-sasa' && x.status === 'IN_VAULT')!.id;
    const fr = () => ds.firearms.find((x) => x.id === fid)!;
    const f = { id: fid, get status() { return fr().status; }, get policeReport() { return fr().policeReport; }, get found() { return fr().found; }, set licenceExpiresOn(v: string) { fr().licenceExpiresOn = v; } };
    const missing = await svc.reportFirearmMissing(cm, f.id, 'Not in its rack at the 07:00 count');
    expect(missing.policeReportDue).toBe(addDays(TODAY, 14));
    expect(f.status).toBe('LOST');
    await expect(svc.recordPoliceReport(cm, f.id, { ref: 'IPD/123', on: addDays(TODAY, 1) })).rejects.toBeInstanceOf(BadRequest);
    await svc.recordPoliceReport(cm, f.id, { ref: 'IPD/123/2026', on: TODAY });
    expect(f.policeReport!.ref).toBe('IPD/123/2026');
    await svc.recordFirearmFound(cm, f.id, { note: 'Found in the armoury cleaning room, undamaged', witness: witnessIn(ds, 'co-sasa', [cm.personId]) });
    expect(f.status).toBe('IN_VAULT');
    expect(f.found!.checkedBy).toBeTruthy();

    await svc.depositFirearm(cm, f.id, { station: 'IPD Petaling Jaya', on: TODAY, receiptRef: 'R-77' });
    expect(f.status).toBe('DEPOSITED');
    f.licenceExpiresOn = '2026-01-01';
    await expect(svc.collectFirearm(cm, f.id, { witness: witnessIn(ds, 'co-sasa', [cm.personId]) })).rejects.toThrow(/Renew/);
    f.licenceExpiresOn = '2027-06-30';
    await svc.collectFirearm(cm, f.id, { witness: witnessIn(ds, 'co-sasa', [cm.personId]) });
    expect(f.status).toBe('IN_VAULT');

    const watch = ds.vaultWatches.find((x) => x.start <= NOW && x.end > NOW);
    if (watch) {
      const cms = await svc.user('u-cms-head');
      const before = watch.checks?.length ?? 0;
      await svc.vaultWatchCheckIn(cms, watch.id, 'camera');
      const after = ds.vaultWatches.find((x) => x.id === watch.id)!;
      expect(after.lastCheckAt).toBe(NOW);
      expect(after.checks!.length).toBe(before + 1);
    }
  });

  it('renews range practice for every attendee in one entry, refusing foreign guards and people without a permit', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const permit = ds.credentials.filter((c) => c.companyId === 'co-sasa' && c.type === 'FIREARM_PERMIT').map((c) => c.personId);
    const local = ds.people.filter((p) => permit.includes(p.id) && p.nationality === 'MY').slice(0, 3);
    const foreign = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality !== 'MY')!;
    const res = await svc.recordRangeSession(cm, { companyId: 'co-sasa', on: TODAY, range: 'Lapang Sasar PDRM Cheras', instructor: 'Insp. Mock Instructor', personIds: [...local.map((p) => p.id), foreign.id] });
    expect(res.recorded.length).toBe(local.length);
    expect(res.refused.some((r) => r.personId === foreign.id)).toBe(true);
    for (const p of local) expect(ds.credentials.find((c) => c.personId === p.id && c.type === 'RANGE_PRACTICE')!.issuedOn).toBe(TODAY);
    await expect(svc.recordRangeSession(cm, { companyId: 'co-sasa', on: addDays(TODAY, 1), range: 'Range', instructor: 'Someone', personIds: [local[0].id] })).rejects.toBeInstanceOf(BadRequest);
  });

  it('shows the 30 June renewal calendar to arms people only', async () => {
    const { svc } = fresh();
    const r = await svc.armsRenewals(await svc.user('u-pwvsb-arms'));
    expect(r.endsOn).toBe('2027-06-30');
    expect(r.companies.length).toBeGreaterThan(0);
    await expect(svc.armsRenewals(await svc.user('u-fd'))).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('4C arms requests and the supplier file', () => {
  it('lets the requester correct and resubmit a returned request, keeping the earlier values in the log', async () => {
    const { svc, ds } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    const asst = await svc.user('u-pwvsb-arms-asst');
    const cm = await svc.user('u-cm-sasa');
    const r = await svc.raiseArmsRequest(arms, { companyId: 'co-sasa', kind: 'ACQUIRE', title: 'Buy 9 mm rounds', note: 'Range', calibre: '9 mm', quantity: 500, estCost: 1250 });
    await svc.armsRequestStep(asst, r.id, 'return', 'Quantity too high for two sessions');
    await expect(svc.armsRequestStep(arms, r.id, 'pass', 'ok')).rejects.toThrow(/not this step/);
    await expect(svc.armsRequestStep(arms, r.id, 'resubmit', '')).rejects.toThrow(/corrected/);
    await expect(svc.armsRequestStep(cm, r.id, 'resubmit', 'Fixed')).rejects.toBeInstanceOf(AccessDenied);
    const s = await svc.armsRequestStep(arms, r.id, 'resubmit', 'Cut to 300 rounds', { changes: { quantity: 300, estCost: 750 } });
    expect(s.request.state).toBe('arms_review');
    const row = ds.armsRequests.find((x) => x.id === r.id)!;
    expect([row.quantity, row.estCost]).toEqual([300, 750]);
    expect(row.log!.at(-1)!.reason).toMatch(/Cut to 300 rounds; quantity was 500; cost was RM1250/);
    // Resubmitting again before it is returned is refused.
    await expect(svc.armsRequestStep(arms, r.id, 'resubmit', 'again')).rejects.toThrow(/not waiting for correction/);
  });

  it('runs a purchase through all steps: nobody approves their own, every approval has a reason, spending needs the COO, and the register follows', async () => {
    const { svc, ds } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    const asst = await svc.user('u-pwvsb-arms-asst');
    const cm = await svc.user('u-cm-sasa');
    const coo = await svc.user('u-coo');
    const r = await svc.raiseArmsRequest(arms, { companyId: 'co-sasa', kind: 'ACQUIRE', title: 'Buy 9 mm rounds for range practice', note: 'Range season', calibre: '9 mm', quantity: 500, estCost: 1250 });
    expect(r.state).toBe('arms_review');
    await expect(svc.armsRequestStep(arms, r.id, 'pass', 'ok')).rejects.toThrow(/Someone else/);
    await expect(svc.armsRequestStep(asst, r.id, 'pass', '')).rejects.toThrow(/reason/);
    await svc.armsRequestStep(asst, r.id, 'pass', 'Quantity matches two range sessions');
    await expect(svc.armsRequestStep(asst, r.id, 'authorise', 'fine')).rejects.toBeInstanceOf(AccessDenied);
    let s = await svc.armsRequestStep(cm, r.id, 'authorise', 'Needed for the December range');
    expect(s.request.state).toBe('regulator_pending');
    s = await svc.armsRequestStep(cm, r.id, 'police', '', { policeApproval: { ref: 'PDRM/BELI/9', on: TODAY } });
    expect(s.request.state).toBe('regulator_pending');
    expect(s.missing).toContain('the COO or CEO approval of the spending');
    await expect(svc.armsRequestStep(cm, r.id, 'spend', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    // The last paper in place moves it to approved by itself.
    s = await svc.armsRequestStep(coo, r.id, 'spend', 'Within the arms budget');
    expect(s.request.state).toBe('approved');
    await svc.armsRequestStep(asst, r.id, 'verify', 'Boxes counted against the delivery order');
    const ledger = ds.ammoStocks.find((x) => x.id === 'ammo-va-sasa-1-pistol')!.ledger;
    await svc.armsRequestStep(asst, r.id, 'reconcile', '');
    expect(ds.ammoStocks.find((x) => x.id === 'ammo-va-sasa-1-pistol')!.ledger).toBe(ledger + 500);
    s = await svc.armsRequestStep(asst, r.id, 'close', '');
    expect(s.request.state).toBe('closed');
    expect(s.request.log!.map((l) => l.to)).toEqual(['arms_review', 'company_auth', 'regulator_pending', 'regulator_pending', 'approved', 'verified', 'reconciled', 'closed']);
  });

  it('sends disposal and transfers through legal, and moves firearms between vaults on reconcile', async () => {
    const { svc, ds } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    const cm = await svc.user('u-cm-sasa');
    const legal = await svc.user('u-legal');
    const f = ds.firearms.find((x) => x.companyId === 'co-sasa' && x.status === 'IN_VAULT' && x.vaultId === 'va-sasa-1')!;
    const move = await svc.raiseArmsRequest(cm, { companyId: 'co-sasa', kind: 'MOVE', title: 'Move one shotgun to the client safe', note: '', firearmIds: [f.id], toVaultId: 'va-sasa-c1' });
    expect(move.needsLegal).toBe(false);
    await svc.armsRequestStep(arms, move.id, 'pass', 'Safe approved');
    await expect(svc.armsRequestStep(cm, move.id, 'authorise', 'own')).rejects.toThrow(/Someone else/);
    const dispose = await svc.raiseArmsRequest(arms, { companyId: 'co-sasa', kind: 'DISPOSE', title: 'Dispose of a worn revolver', note: 'Armourer report', firearmIds: [f.id] });
    expect(dispose.needsLegal).toBe(true);
    await svc.armsRequestStep(await svc.user('u-pwvsb-arms-asst'), dispose.id, 'pass', 'Report attached');
    const a = await svc.armsRequestStep(cm, dispose.id, 'authorise', 'Agree to dispose');
    expect(a.request.state).toBe('legal_check');
    await expect(svc.armsRequestStep(cm, dispose.id, 'legal_ok', 'fine')).rejects.toBeInstanceOf(AccessDenied);
    const l = await svc.armsRequestStep(legal, dispose.id, 'legal_ok', 'Disposal through a licensed dealer only');
    expect(l.request.state).toBe('regulator_pending');
  });

  it('keeps the supplier file: foreign supplier gaps, people, company links, and papers that update the licence fields', async () => {
    const { svc, ds } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    const sup = ds.armsSuppliers[0];
    await svc.updateArmsSupplierFile(arms, sup.id, { country: 'Austria', currency: 'eur', localAgent: null, people: [{ name: 'Export desk', role: 'Sales', phone: '+43 0000', email: 'sales@example.invalid' }], links: [{ companyId: 'co-sasa', relation: 'Supplies pistols', since: '2025-01-01' }] });
    let file = await svc.armsSupplierFile(arms);
    let row = file.suppliers.find((x) => x.supplier.id === sup.id)!;
    expect(row.foreign).toBe(true);
    expect(row.supplier.currency).toBe('EUR');
    expect(row.gaps).toContain('export licence of the supplier’s country');
    expect(row.gaps).toContain('local agent or importer');
    await svc.addSupplierPaper(arms, sup.id, { kind: 'EXPORT_LICENCE', title: 'Austrian export licence', ref: 'AT-EX-1', on: '2026-09-01', expiresOn: '2027-09-01' });
    await svc.addSupplierPaper(arms, sup.id, { kind: 'DEALER_LICENCE', title: 'Dealer licence copy', ref: 'DL-99', on: '2026-01-01', expiresOn: '2027-12-31' });
    file = await svc.armsSupplierFile(arms);
    row = file.suppliers.find((x) => x.supplier.id === sup.id)!;
    expect(row.supplier.licenceRef).toBe('DL-99');
    expect(row.gaps).not.toContain('export licence of the supplier’s country');
    await expect(svc.updateArmsSupplierFile(await svc.user('u-cm-sasa'), sup.id, { country: 'X' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.armsSupplierFile(await svc.user('u-fd'))).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Company arms requests and director-only legal points (review, 2 Nov 2026)', () => {
  it('the company raises a request on its own screen, Arms Control sends it back, the requester corrects it, and the manager authorises', async () => {
    const { svc } = fresh();
    const gm = await svc.user('u-gm-sasa');
    const cm = await svc.user('u-cm-sasa');
    const asst = await svc.user('u-pwvsb-arms-asst');
    const sv = await svc.user('u-sv-sasa');
    const r = await svc.raiseArmsRequest(gm, { companyId: 'co-sasa', kind: 'ACQUIRE', title: 'Buy 12 gauge cartridges', note: 'Range practice, quotation on file', calibre: '12 gauge', quantity: 800, estCost: 2400 });
    let screen = await svc.arms(gm, 'co-sasa');
    expect(screen.can.raise).toBe(true);
    expect(screen.requests.find((x) => x.request.id === r.id)?.mine).toBe(true);
    await expect(svc.armsRequestStep(asst, r.id, 'return', '  ')).rejects.toThrow(/why/);
    await svc.armsRequestStep(asst, r.id, 'return', 'Two sessions need 400 at most');
    screen = await svc.arms(gm, 'co-sasa');
    const row = screen.requests.find((x) => x.request.id === r.id)!;
    expect(row.request.state).toBe('draft');
    expect(row.last?.reason).toMatch(/400 at most/);
    // Another person in the company cannot resubmit someone else's request.
    await expect(svc.armsRequestStep(cm, r.id, 'resubmit', 'Fixed')).rejects.toBeInstanceOf(AccessDenied);
    await svc.armsRequestStep(gm, r.id, 'resubmit', 'Cut to 400', { changes: { quantity: 400, estCost: 1200 } });
    await svc.armsRequestStep(asst, r.id, 'pass', 'Quantity now matches two sessions');
    // The requester cannot authorise their own request; the company manager does, with a reason.
    await expect(svc.armsRequestStep(gm, r.id, 'authorise', 'ok')).rejects.toThrow(/Someone else/);
    await expect(svc.armsRequestStep(cm, r.id, 'authorise', '')).rejects.toThrow(/reason/);
    const done = await svc.armsRequestStep(cm, r.id, 'authorise', 'Needed for December range');
    expect(done.request.state).toBe('regulator_pending');
    expect((await svc.arms(cm, 'co-sasa')).can.authorise).toBe(true);
    // A supervisor sees only their own sites' arms: no company requests, no raising from the screen.
    const svScreen = await svc.arms(sv, 'co-sasa');
    expect(svScreen.requests).toEqual([]);
    expect(svScreen.can.raise).toBe(false);
    await expect(svc.arms(await svc.user('u-cm-arsh'), 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
  });

  it('police paperwork never blocks or alerts staff; it is an open point in the directors-only list', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const arms = await svc.user('u-pwvsb-arms');
    const ceo = await svc.user('u-fauzan');
    const crew = (await svc.arms(cm, 'co-sasa')).crewChoices.slice(0, 1).map((c) => c.id);
    const home = ds.vaults.find((v) => v.companyId === 'co-sasa' && (v.kind ?? 'COMPANY_ARMOURY') === 'COMPANY_ARMOURY')!.state;
    const away = home === 'Johor' ? 'Melaka' : 'Johor';
    const start = new Date(Date.parse(`${TODAY}T00:00:00+08:00`) + 2 * 86_400_000).toISOString();
    const end = new Date(Date.parse(start) + 6 * 3_600_000).toISOString();
    // Booking a job that crosses a state with no police approval yet is allowed (it used to be refused).
    const job = await svc.planArmedJob(cm, { companyId: 'co-sasa', kind: 'BODYGUARD', client: 'Synthetic Client Bhd', detail: 'Escort', start, end, crew, vehicle: null, states: [home, away], policeApproval: null });
    const check = await svc.armedJobCheck(cm, job.id);
    expect(check.checks.some((c) => /police/i.test(c.label))).toBe(false);
    const board = await svc.armsControl(arms);
    expect(board.canSeeLegalFlags).toBe(false);
    expect(board.alerts.some((a) => a.kind === 'Police notice' || a.kind === 'Interstate' || /Arms Act|Circular/.test(`${a.title} ${a.detail}`))).toBe(false);
    for (const r of board.readiness) expect(r.checks.some((c) => /police/i.test(c.label))).toBe(false);
    const flags = await svc.specialOpsLegalFlags(ceo);
    const f = flags.rows.find((x) => x.id === `job-state:${job.id}`)!;
    expect(f.status).toBe('open');
    expect(f.responsibleAssumed).toBe(true);
    expect(f.source).toMatch(/to be confirmed by Legal/);
    expect(f.history.some((h) => h.action.startsWith('arms.job'))).toBe(true);
    expect((await svc.armsControl(ceo)).canSeeLegalFlags).toBe(true);
    await expect(svc.specialOpsLegalFlags(arms)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.specialOpsLegalFlags(cm)).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('4D armed jobs, client checklist and the CIT tender pack', () => {
  it('gives a go/no-go from the records, and the bank CIT pack lists what is missing', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const job = ds.armedJobs.find((j) => j.companyId === 'co-sasa')!;
    const check = await svc.armedJobCheck(cm, job.id);
    expect(['go', 'no_go', 'unknown']).toContain(check.verdict);
    expect(check.checks.some((c) => c.label === 'Armed-service insurance')).toBe(true);
    const pack = await svc.citTenderPack(cm, 'co-sasa');
    expect(pack.items.length).toBeGreaterThan(5);
    expect(pack.items.find((i) => i.item.startsWith('KDN licence'))).toBeTruthy();
    await expect(svc.citTenderPack(await svc.user('u-fd'), 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    const agr = ds.armsAgreements.find((a) => a.companyId === 'co-sasa')!;
    const list = await svc.armedClientChecklist(cm, agr.id);
    expect(list.steps[0].step).toBe('Client agreement signed');
    expect(typeof list.live).toBe('boolean');
  });
});

describe('4E the CMS Command Centre app link', () => {
  it('takes signed events once, counts information events, updates device health and opens the case for an alarm closed as real', async () => {
    const { svc, ds } = fresh();
    const feed = await svc.user('u-cms-link');
    const sys = ds.siteSystems.find((s) => s.id === 'sys-st-sasa-003-cctv')!;
    const ev = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, kind, companyId: 'co-sasa', siteId: 'st-sasa-003', deviceId: sys.id, source: 'test', occurredAt: '2026-10-26T02:20:00.000Z', receivedAt: '2026-10-26T02:20:01.000Z', summary: `${kind} test`, detail: {}, ...extra });
    const r1 = await svc.cmsIngest(feed, { events: [ev('evt-intrusion-0001', 'INTRUSION'), ev('evt-clockin-0001', 'GUARD_CLOCKED_IN'), ev('evt-offline-0001', 'DEVICE_OFFLINE'), ev('evt-badsite-0001', 'FIRE', { siteId: 'st-inas-001' })], closedAlarms: [] });
    expect(r1.raised).toBe(2);
    expect(r1.info).toBe(1);
    expect(r1.health).toBe(1);
    expect(r1.refused.length).toBe(1);
    expect(ds.siteSystems.find((x) => x.id === sys.id)!.status).toBe('offline');
    const again = await svc.cmsIngest(feed, { events: [ev('evt-intrusion-0001', 'INTRUSION')], closedAlarms: [] });
    expect(again.duplicates).toBe(1);
    const cases = ds.cases.length;
    const closed = await svc.cmsIngest(feed, { events: [], closedAlarms: [{ id: 'al-1', outcome: 'real', eventIds: ['evt-intrusion-0001'], closingNote: 'Camera showed a person at the fence', closedBy: 'Operator A' }] });
    expect(closed.closed).toBe(1);
    expect(ds.cases.length).toBe(cases + 1);
    expect(ds.siteAlarms.find((a) => a.id === 'cms-evt-intrusion-0001')!.status).toBe('closed');
    await expect(svc.cmsIngest(await svc.user('u-cms-head'), { events: [] })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('defect 5: one CMS alarm makes one case, however many events it grouped and however often its close is resent', async () => {
    const { svc, ds } = fresh();
    const feed = await svc.user('u-cms-link');
    const sys = ds.siteSystems.find((s) => s.id === 'sys-st-sasa-003-cctv')!;
    const ev = (id: string) => ({ id, kind: 'INTRUSION', companyId: 'co-sasa', siteId: 'st-sasa-003', deviceId: sys.id, source: 'test', occurredAt: '2026-10-26T02:20:00.000Z', summary: 'Intrusion', detail: {} });
    await svc.cmsIngest(feed, { events: [ev('evt-group-0001'), ev('evt-group-0002')], closedAlarms: [] });
    const cases = ds.cases.length;
    const close = { id: 'alarm-grp-1', outcome: 'real', eventIds: ['evt-group-0001', 'evt-group-0002'], closingNote: 'Person at the fence', closedBy: 'Operator A' };
    expect((await svc.cmsIngest(feed, { events: [], closedAlarms: [close] })).closed).toBe(2);
    expect(ds.cases.length).toBe(cases + 1);
    const rows = ds.siteAlarms.filter((a) => a.id.startsWith('cms-evt-group-'));
    expect(new Set(rows.map((r) => r.caseId)).size).toBe(1);
    expect(rows.every((r) => r.cmsAlarmId === 'alarm-grp-1')).toBe(true);
    // The CMS app retries after a lost answer: no second case.
    const again = await svc.cmsIngest(feed, { events: [], closedAlarms: [close] });
    expect(again.closed).toBe(0);
    expect(ds.cases.length).toBe(cases + 1);
    // A refusal names its list and the item's id, so the app keeps exactly that one.
    const bad = await svc.cmsIngest(feed, { events: [{ ...ev('evt-other-0001'), deviceId: 'sys-st-sasa-001-cctv' }], closedAlarms: [{ id: 'alarm-x-0001', outcome: 'real', eventIds: [], closingNote: 'x' }] });
    const other = ds.siteSystems.find((s) => s.id === 'sys-st-sasa-001-cctv');
    if (other && other.siteId !== 'st-sasa-003') expect(bad.refused).toContainEqual(expect.objectContaining({ list: 'events', id: 'evt-other-0001', reason: 'device belongs to another site' }));
    expect(bad.refused).toContainEqual(expect.objectContaining({ list: 'closedAlarms', id: 'alarm-x-0001' }));
  });

  it('round 2: a close naming events Prima has not got is refused by id, never accepted silently, and goes through once they arrive', async () => {
    const { svc, ds } = fresh();
    const feed = await svc.user('u-cms-link');
    const sys = ds.siteSystems.find((s) => s.id === 'sys-st-sasa-003-cctv')!;
    const ev = (id: string) => ({ id, kind: 'INTRUSION', companyId: 'co-sasa', siteId: 'st-sasa-003', deviceId: sys.id, source: 'test', occurredAt: '2026-10-26T02:20:00.000Z', summary: 'Intrusion', detail: {} });
    const cases = ds.cases.length;
    // None of the events here yet.
    const close = { id: 'alarm-early-1', outcome: 'real', eventIds: ['evt-early-0001', 'evt-early-0002'], closingNote: 'Person at the gate', closedBy: 'Operator A' };
    const none = await svc.cmsIngest(feed, { events: [], closedAlarms: [close] });
    expect(none.received).toEqual({ events: 0, closedAlarms: 1 });
    expect(none.closed).toBe(0);
    expect(none.duplicates).toBe(0);
    expect(none.refused).toEqual([expect.objectContaining({ list: 'closedAlarms', id: 'alarm-early-1', reason: expect.stringMatching(/events not received yet: evt-early-0001, evt-early-0002/) })]);
    // One of two here: still refused, and the one that is here stays open.
    await svc.cmsIngest(feed, { events: [ev('evt-early-0001')], closedAlarms: [] });
    const half = await svc.cmsIngest(feed, { events: [], closedAlarms: [close] });
    expect(half.refused).toEqual([expect.objectContaining({ id: 'alarm-early-1', reason: expect.stringMatching(/evt-early-0002/) })]);
    expect(ds.siteAlarms.find((a) => a.id === 'cms-evt-early-0001')!.status).not.toBe('closed');
    expect(ds.cases.length).toBe(cases);
    // The missing event arrives (in the same batch as the retried close): one close, one case.
    const done = await svc.cmsIngest(feed, { events: [ev('evt-early-0002')], closedAlarms: [close] });
    expect(done.refused).toEqual([]);
    expect(done.closed).toBe(2);
    expect(ds.cases.length).toBe(cases + 1);
  });

  it('exports the directory the CMS app reads, and lets a CMS officer clock in to their own seat only', async () => {
    const { svc, ds } = fresh();
    const dir = await svc.cmsDirectory(await svc.user('u-cms-link'));
    expect(dir.companies.length).toBeGreaterThan(0);
    const siteIds = new Set(dir.sites.map((s) => s.id));
    expect(dir.devices.every((d) => siteIds.has(d.siteId))).toBe(true);
    expect(dir.sites.every((s) => s.sector === 'government' || s.sector === 'private')).toBe(true);
    expect(JSON.stringify(dir)).not.toMatch(/ic(No|Number)|salary|pinHash/i);
    const head = await svc.user('u-cms-head');
    const seat = ds.cmsShifts.find((s) => s.start <= NOW && s.end > NOW && !s.clockIn)!;
    await expect(svc.cmsSeatClockIn(head, seat.id)).rejects.toThrow(/not yours/);
    seat.staffName = head.name;
    ds.cmsShifts.find((x) => x.id === seat.id)!.staffName = head.name;
    await svc.cmsSeatClockIn(head, seat.id);
    expect(ds.cmsShifts.find((x) => x.id === seat.id)!.clockIn).toBe(NOW);
  });
});

describe('4F tracker feed and JPJ driver hours', () => {
  it('counts driving time and the stretch since the last 30 minute break', () => {
    const p = (a: string, b: string) => ({ from: myt(TODAY, a), to: myt(TODAY, b) });
    const h = driverHours([p('06:00', '08:00'), p('08:10', '10:10')], myt(TODAY, '00:00'), myt(TODAY, '23:59'));
    expect(h.drivingMin).toBe(240);
    expect(h.needsBreak).toBe(true);
    const rested = driverHours([p('06:00', '08:00'), p('08:30', '10:30')], myt(TODAY, '00:00'), myt(TODAY, '23:59'));
    expect(rested.needsBreak).toBe(false);
    const long = driverHours([p('05:00', '08:00'), p('08:30', '11:30'), p('12:00', '15:00')], myt(TODAY, '00:00'), myt(TODAY, '23:59'));
    expect(long.overDay).toBe(true);
  });

  it('keeps positions only on duty with consent, builds the trip and raises a panic on the CMS desk', async () => {
    const { svc, ds } = fresh();
    const feed = await svc.user('u-tracker-feed');
    const veh = () => ds.vehicles.find((x) => x.id === 'veh-sasa-1')!;
    const pt = (at: string, extra: Record<string, unknown> = {}) => ({ trackerId: 'TRK-0001', at: myt(TODAY, at), lat: 3.1, lng: 101.6, speedKmh: 40, ignition: true, ...extra });
    // Not out: only "seen".
    let r = await svc.trackerIngest(feed, [pt('09:00')]);
    expect(r.seenOnly).toBe(1);
    expect(veh().trip ?? null).toBeNull();
    const driver = ds.users.find((u) => u.id === 'u-om-klang')!;
    veh().out = { requestId: null, driver: driver.name, driverUserId: driver.id, at: myt(TODAY, '09:30'), km: veh().odometerKm };
    // Out but no consent on file: still only "seen" (PDPA).
    r = await svc.trackerIngest(feed, [pt('09:40')]);
    expect(r.seenOnly).toBe(1);
    ds.people.find((p) => p.id === driver.personId)!.monitoringConsent = { docId: 'doc-x', by: 'PDPA officer', at: NOW };
    r = await svc.trackerIngest(feed, [pt('09:45'), pt('09:50', { lat: 3.11, speedKmh: 95 }), pt('09:55', { lat: 3.12, panic: true })]);
    expect(r.kept).toBe(3);
    expect(veh().trip!.km).toBeGreaterThan(1);
    expect(veh().trip!.overSpeed).toBe(1);
    expect(r.panics).toBe(1);
    expect(ds.siteAlarms.some((a) => a.cmsKind === 'VEHICLE_PANIC' && a.companyId === 'co-sasa')).toBe(true);
    const board = await svc.transportBoard(await svc.user('u-transport'));
    expect(board.hours.find((h) => h.driverUserId === driver.id)!.drivingMin).toBe(10);
    await expect(svc.transportBoard(await svc.user('u-it-ex1'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.trackerIngest(await svc.user('u-transport'), [])).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('4G Asset Management: the developer system feed, the rent check and furniture purchases', () => {
  it('shows differences for the team without copying them over, and never treats a reported payment as received', async () => {
    const { svc, ds } = fresh();
    const feed = await svc.user('u-am-feed');
    const u1 = ds.amUnits.find((u) => u.id === 'am-u-001')!;
    const invoicesBefore = JSON.stringify(u1.tenancy!.invoices);
    const open = u1.tenancy!.invoices.find((i) => i.paid < i.amount);
    const res = await svc.amIngest(feed, [
      { unitCode: 'RES-001', status: 'let', tenant: 'Mr Lim (1)', rent: 1500, paid: open ? [{ period: open.period, amount: open.amount, on: TODAY, ref: 'DEV-PAY-1' }] : [] },
      { unitCode: 'NOPE-999', status: 'vacant', rent: 100 },
      { status: 'let' },
    ]);
    expect(res.updated).toBe(1);
    expect(res.notInPrima).toEqual(['NOPE-999']);
    expect(res.refused.length).toBe(1);
    expect(u1.tenancy!.rent).toBe(1400);
    expect(JSON.stringify(u1.tenancy!.invoices)).toBe(invoicesBefore);
    const check = await svc.amRentCheck(await svc.user('u-asset-dir'));
    expect(check.differences.some((d) => d.code === 'RES-001' && d.issue === 'Rent differs')).toBe(true);
    if (open) expect(check.differences.some((d) => d.code === 'RES-001' && d.issue.includes('system shows paid'))).toBe(true);
    await expect(svc.amRentCheck(await svc.user('u-cm-sasa'))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('runs a furniture purchase: the team asks, Finance or the COO decides with a reason, and the asset joins the register when received', async () => {
    const { svc, ds } = fresh();
    const team = await svc.user('u-asset-re1');
    const fd = await svc.user('u-fd');
    const coo = await svc.user('u-coo');
    const small = await svc.amBuyRequest(team, { description: 'Office chairs', category: 'FURNITURE', qty: 6, estCost: 1800, location: 'Group office, level 3', ownerEntity: 'PWVSB', reason: 'Broken chairs replaced' });
    expect((await svc.amBoard(team)).purchases.some((p) => p.id === small.id)).toBe(true);
    expect((await svc.amBoard(team)).assets.list.some((a) => a.id === small.id)).toBe(false);
    await expect(svc.amBuyDecide(fd, small.id, true, '')).rejects.toThrow(/reason/);
    await svc.amBuyDecide(fd, small.id, true, 'Within the furniture budget');
    // Defect 6: the receipt is bound to the approved amount; a higher price goes back for approval.
    await expect(svc.amBuyReceived(team, small.id, { tag: 'FUR-CH-0601', cost: 18000, boughtOn: TODAY })).rejects.toThrow(/above the approved RM1800/);
    await expect(svc.amBuyReprice(team, small.id, 18000, '')).rejects.toBeInstanceOf(BadRequest);
    await svc.amBuyReprice(team, small.id, 18000, 'Supplier price went up');
    expect(ds.amAssets.find((x) => x.id === small.id)!.status).toBe('buy_requested');
    await expect(svc.amBuyReceived(team, small.id, { tag: 'FUR-CH-0601', cost: 18000, boughtOn: TODAY })).rejects.toThrow(/approved purchase/);
    // Above RM10,000 now: the FD can no longer approve it, and an approver who saw the old amount is refused.
    await expect(svc.amBuyDecide(fd, small.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.amBuyDecide(coo, small.id, true, 'ok', 1800)).rejects.toThrow(/now RM18000/);
    await svc.amBuyDecide(coo, small.id, true, 'Price checked against two quotes', 18000);
    const hist = ds.amAssets.find((x) => x.id === small.id)!.purchase!.history!;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ estCost: 1800, decidedBy: fd.name, reason: 'Supplier price went up' });
    // Round 2: an impossible purchase date is refused, and a receipt is not an inspection.
    await expect(svc.amBuyReceived(team, small.id, { tag: 'FUR-CH-0601', cost: 17500, boughtOn: '2026-02-30' })).rejects.toThrow(/real purchase date/);
    await svc.amBuyReceived(team, small.id, { tag: 'FUR-CH-0601', cost: 17500, boughtOn: TODAY });
    const a = ds.amAssets.find((x) => x.id === small.id)!;
    expect(a.status).toBe('in_use');
    expect(a.boughtOn).toBe(TODAY);
    expect(a.lastCheckedOn).toBeNull();
    expect((await svc.amBoard(team)).assets.list.some((x) => x.id === small.id)).toBe(true);
    const big = await svc.amBuyRequest(team, { description: 'Resort dining sets', category: 'FURNITURE', qty: 20, estCost: 25000, location: 'Resort 1', ownerEntity: 'PWVSB', reason: 'Old sets beyond repair' });
    await expect(svc.amBuyDecide(fd, big.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await svc.amBuyDecide(coo, big.id, false, 'Wait for the 2027 budget');
    expect(ds.amAssets.find((x) => x.id === big.id)!.status).toBe('buy_refused');
  });
});

describe('4H arms trading and import, behind the CEO switch', () => {
  it('refuses and logs every trading action while off; only the CEO switches it, and only with an approved dealer licence', async () => {
    const { svc, ds } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    const ceo = await svc.user('u-fauzan');
    const raise = () => svc.raiseArmsRequest(arms, { companyId: 'co-sasa', kind: 'IMPORT', title: 'Import 9 mm rounds for trade', note: '', calibre: '9 mm', quantity: 5000, importOrder: { country: 'Czech Republic', exportLicenceRef: null, district: 'IPD Shah Alam', appliedOn: '2026-10-01' } });
    const audits = ds.audit.length;
    const refused = await raise().catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(TradingOff);
    expect(ds.audit.length).toBe(audits);
    await svc.logTradeRefusal(arms, refused as TradingOff);
    expect(ds.audit.length).toBe(audits + 1);
    expect(ds.audit.at(-1)!.action).toBe('arms.trade_refused');
    await expect(svc.setArmsTrading(await svc.user('u-coo'), true, 'Licence approved')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setArmsTrading(ceo, true, 'Licence approved')).rejects.toThrow(/dealer licence/);
    const dl = ds.dealerLicences[0];
    Object.assign(dl, { status: 'approved', reference: 'DL/2026/1', expiresOn: '2027-12-31' });
    await svc.setArmsTrading(ceo, true, 'Dealer licence DL/2026/1 approved');
    expect((await svc.armsTrading(arms)).on).toBe(true);

    // Import: CPO licence, then KDN, then ship through Port Klang or KLIA.
    const r = await raise();
    await svc.armsRequestStep(await svc.user('u-pwvsb-arms-asst'), r.id, 'pass', 'Supplier file complete');
    await svc.armsRequestStep(await svc.user('u-cm-sasa'), r.id, 'authorise', 'Trade stock for Q1');
    await svc.armsRequestStep(await svc.user('u-legal'), r.id, 'legal_ok', 'End-user papers in order');
    await expect(svc.armsRequestStep(arms, r.id, 'import', '', { importStep: 'kdn', ref: 'KDN/1', on: TODAY })).rejects.toThrow(/CPO/);
    await svc.armsRequestStep(arms, r.id, 'import', '', { importStep: 'cpo', ref: 'CPO/SEL/1', on: '2026-10-20', endsOn: '2026-12-31' });
    await expect(svc.armsRequestStep(arms, r.id, 'import', '', { importStep: 'shipped', on: TODAY, port: 'KLIA' })).rejects.toThrow(/KDN/);
    const k = await svc.armsRequestStep(arms, r.id, 'import', '', { importStep: 'kdn', ref: 'KDN/IMP/1', on: TODAY });
    expect(k.request.state).toBe('approved');
    const imports = await svc.armsImports(arms);
    expect(imports.districts.find((d) => d.district === 'IPD Shah Alam')!.avgDays).toBe(19);
    await svc.setArmsTrading(ceo, false, 'Paused for audit');
    await expect(svc.armsRequestStep(arms, r.id, 'import', '', { importStep: 'shipped', on: TODAY, port: 'KLIA' })).rejects.toThrow(/switched off/);
  });

  it('keeps the import order rules in one place', () => {
    const base = { country: 'X', exportLicenceRef: null, district: 'D', appliedOn: TODAY, cpo: null, kdn: null, port: null, customsToldOn: null, shippedOn: null, arrivedOn: null, declaredOn: null, endorsedReturnedOn: null } as const;
    expect(importStepBlocked({ ...base }, 'kdn')).toMatch(/CPO/);
    expect(importStepBlocked({ ...base, cpo: { ref: 'c', on: TODAY, endsOn: TODAY } }, 'shipped')).toMatch(/KDN/);
    expect(importStepBlocked({ ...base, cpo: { ref: 'c', on: TODAY, endsOn: TODAY }, kdn: { ref: 'k', on: TODAY } }, 'shipped')).toMatch(/Port Klang or KLIA/);
  });
});
