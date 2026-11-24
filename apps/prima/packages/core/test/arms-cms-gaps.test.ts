// Arms Control and CMS department check, gaps B1-B5 and decisions D1-D3 (Fauzan, 23 Nov 2026: "Do the gap").
// Mock data only, in memory.
import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  RULES,
  armsIssueCheck,
  decidesForArmsControl,
  demoPin,
  generateDataset,
  holdsArmsKeeperWall,
  keepsVault,
  myt,
  registeredWallsOf,
  type Dataset,
} from '../src';

const TODAY = '2026-10-26';

function fresh(today = TODAY) {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:30') });
  let now = myt(today, '10:30');
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  const at = (hhmm: string, date = today) => (now = myt(date, hhmm));
  return { ds, svc, at };
}
function witnessIn(ds: Dataset, companyId: string, notIds: (string | undefined)[]) {
  const p = ds.people.find((x) => x.companyId === companyId && x.status === 'active' && x.pinHash && !notIds.includes(x.id))!;
  return { staffNo: p.staffNo, pin: demoPin(p.staffNo) };
}

describe('B1 the Amra keeps their own vault', () => {
  it('an admin executive named Amra sees and counts only that vault; another vault stays closed', async () => {
    const { ds, svc } = fresh();
    const ae = await svc.user('u-ae-sasa');
    const vaults = ds.vaults.filter((v) => v.companyId === 'co-sasa');
    expect(vaults.length).toBeGreaterThan(0);
    // Before being named, nothing.
    await expect(svc.arms(ae, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    expect(await svc.keptVaultCompanyIds(ae)).toEqual([]);
    const mine = vaults[0];
    mine.custodianPersonId = ae.personId!;
    expect(keepsVault(ae, mine)).toBe(true);
    expect(await svc.keptVaultCompanyIds(ae)).toEqual(['co-sasa']);
    const view = await svc.arms(ae, 'co-sasa');
    expect(view.vaults.map((v) => v.vault.id)).toEqual([mine.id]);
    expect(view.firearms.every((f) => f.firearm.vaultId === mine.id || view.open.some((o) => o.firearm.id === f.firearm.id))).toBe(true);
    expect(view.can.handle).toBe(true);
    expect(view.can.raise).toBe(false);
    expect(view.requests).toEqual([]);
    const expected = ds.firearms.filter((f) => f.vaultId === mine.id && f.status === 'IN_VAULT').length;
    const r = await svc.countVault(ae, mine.id, { counted: expected, witness: witnessIn(ds, 'co-sasa', [ae.personId]) });
    expect(r).toBeTruthy();
    const other = vaults.find((v) => v.id !== mine.id);
    if (other) await expect(svc.countVault(ae, other.id, { counted: 0, witness: witnessIn(ds, 'co-sasa', [ae.personId]) })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('a person on the written authorised list keeps the vault; once removed, the right ends', async () => {
    const { ds, svc } = fresh();
    const ae = await svc.user('u-ae-sasa-2');
    const v = ds.vaults.find((x) => x.companyId === 'co-sasa')!;
    v.authorisedStaff = [{ personId: ae.personId!, name: ae.name, letterRef: 'AUTH-1', letterOn: TODAY, givenBy: 'CM', givenById: 'u-cm-sasa', reason: 'test' }];
    expect(keepsVault(ae, v)).toBe(true);
    v.authorisedStaff[0].removedOn = TODAY;
    expect(keepsVault(ae, v)).toBe(false);
    // Another company's executive never keeps it, whatever the list says.
    const other = await svc.user('u-ae-inas');
    expect(keepsVault(other, { ...v, custodianPersonId: other.personId! })).toBe(false);
  });

  it('company sign-ins with a person record hold the keeper wall; group staff and feeds do not', async () => {
    const { svc } = fresh();
    expect(holdsArmsKeeperWall(await svc.user('u-ae-sasa'))).toBe(true);
    expect(registeredWallsOf(await svc.user('u-ae-sasa'))).toContain('arms_keeper');
    expect(registeredWallsOf(await svc.user('u-ae-sasa'))).not.toContain('arms');
    expect(holdsArmsKeeperWall(await svc.user('u-pwvsb-arms'))).toBe(false);
  });
});

describe('B2 the written authorised list goes by staff record', () => {
  it('two staff with the same name are not taken for each other', () => {
    const { ds } = fresh();
    const firearm = ds.firearms.find((f) => f.companyId === 'co-sasa' && f.status === 'IN_VAULT' && f.ownership !== 'TRADE')!;
    const vault = { ...ds.vaults.find((v) => v.id === firearm.vaultId)!, authorisedStaff: [{ personId: 'p-ali-1', name: 'Ali bin Abu', letterRef: 'L1', letterOn: TODAY, givenBy: 'CM', givenById: 'u', reason: 'r' }] };
    const site = ds.sites.find((s) => s.companyId === 'co-sasa' && s.armed) ?? ds.sites.find((s) => s.companyId === 'co-sasa')!;
    const person = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard')!;
    const base = { person, credentials: [], firearm, vault, site, shift: null, issuer: 'Ali bin Abu', witness: 'W', today: TODAY, firearmBusy: false };
    const codes = (pid: string | null) => armsIssueCheck({ ...base, issuerPersonId: pid }).map((f) => f.code);
    expect(codes('p-ali-2')).toContain('NOT_AUTHORISED_USER');
    expect(codes(null)).toContain('NOT_AUTHORISED_USER');
    expect(codes('p-ali-1')).not.toContain('NOT_AUTHORISED_USER');
    // The Amra is always authorised at their own vault.
    expect(armsIssueCheck({ ...base, vault: { ...vault, custodianPersonId: 'p-amra' }, issuer: 'Amra', issuerPersonId: 'p-amra' }).map((f) => f.code)).not.toContain('NOT_AUTHORISED_USER');
  });
});

describe('D1 the Arms Control Manager decides, the Assistant prepares', () => {
  it('only the head named in the organisation chart decides; with nobody named, every Arms Control officer still can', async () => {
    const { ds, svc } = fresh();
    const mgr = await svc.user('u-pwvsb-arms');
    const asst = await svc.user('u-pwvsb-arms-asst');
    expect(decidesForArmsControl(mgr, ds.users)).toBe(true);
    expect(decidesForArmsControl(asst, ds.users)).toBe(false);
    await expect(svc.updateCmsSettings(asst, { clockInGraceMin: 12 } as never)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setArmsRfidRequired(asst, { on: false, reason: 'Optional again (test)' })).rejects.toThrow(/Arms Control Manager/);
    await svc.updateCmsSettings(mgr, { clockInGraceMin: 12 } as never);
    const noHead = ds.users.map((u) => (u.id === mgr.id ? { ...u, headOf: [] } : u));
    expect(decidesForArmsControl(asst, noHead)).toBe(true);
  });

  it('the Assistant cannot pass an arms request; the Manager can', async () => {
    const { ds, svc } = fresh();
    Object.assign(ds.armsSuppliers[0], { licenceRef: 'DL-TEST-1', licenceExpiresOn: '2027-12-31' });
    const gm = await svc.user('u-gm-sasa');
    const r = await svc.raiseArmsRequest(gm, { companyId: 'co-sasa', kind: 'ACQUIRE', title: 'Buy cartridges (test)', note: 'Range practice (test)', quantity: 100 });
    await expect(svc.armsRequestStep(await svc.user('u-pwvsb-arms-asst'), r.id, 'pass', 'Checked (test)', { supplierId: ds.armsSuppliers[0].id })).rejects.toThrow(/Arms Control Manager/);
    await svc.armsRequestStep(await svc.user('u-pwvsb-arms'), r.id, 'pass', 'Checked (test)', { supplierId: ds.armsSuppliers[0].id });
    expect(ds.armsRequests.find((x) => x.id === r.id)!.state).toBe('company_auth');
  });
});

describe('D2 and D3 rules', () => {
  it('RFID is compulsory per vault once every firearm there is tagged; licence category required from 1 Jan 2027', () => {
    expect(RULES.armsRfidPerVault.value.onceAllTagged).toBe(true);
    expect(RULES.armsRfidPerVault.label).toBe('Policy');
    expect(RULES.armsLicenceCategory.value.requiredFrom).toBe('2027-01-01');
    expect(RULES.armsLicenceCategory.source).toMatch(/23 Nov 2026/);
  });

  it('a fully tagged vault refuses a return without a scan', async () => {
    const { ds, svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const firearm = ds.firearms.find((f) => f.companyId === 'co-sasa' && f.status === 'IN_VAULT' && f.ownership !== 'TRADE')!;
    for (const [i, f] of ds.firearms.filter((x) => x.vaultId === firearm.vaultId).entries()) f.rfidTag = f.rfidTag ?? `ABCDEF0${String(i).padStart(3, '0')}`;
    const shift = ds.shifts.find((s) => s.companyId === 'co-sasa' && s.personId)!;
    const m = { id: 'am-test', companyId: 'co-sasa', firearmId: firearm.id, vaultId: firearm.vaultId, personId: shift.personId!, shiftId: shift.id, siteId: shift.siteId, issuedAt: myt(TODAY, '08:00'), dueBack: myt(TODAY, '20:00'), returnedAt: null, issuedBy: 'x', witness: 'y', rounds: 0 };
    ds.armsMovements.push(m as never);
    firearm.status = 'ISSUED' as never;
    await expect(svc.returnFirearm(cm, { movementId: m.id, roundsReturned: 0, witness: witnessIn(ds, 'co-sasa', [cm.personId, shift.personId!]) })).rejects.toThrow(/Scan/);
  });
});

describe('B3 replacement for the rest of a CMS shift', () => {
  it('after the first person leaves, Arms Control puts someone on a new seat to the end; the first keeps their hours', async () => {
    const { ds, svc, at } = fresh();
    const day = ds.cmsShifts.find((s) => s.id === `cms-${TODAY}-0700-12h-mo-1`)!;
    const mgr = await svc.user('u-pwvsb-arms');
    // Clear the other seats around today so the rest and day checks do not get in the way of this test.
    for (const s of ds.cmsShifts) if (s.id !== day.id && s.date >= '2026-10-20' && s.date <= '2026-10-30') Object.assign(s, { staffName: null, staffId: null });
    const mos = ds.cmsStaff.filter((p) => p.active && p.posts.includes('MONITOR_OFFICER'));
    expect(mos.length).toBeGreaterThan(1);
    Object.assign(day, { staffName: mos[0].name, staffId: mos[0].id, clockIn: myt(TODAY, '06:58'), clockOut: null });
    await expect(svc.replaceCmsSeat(mgr, day.id, mos[1].id, 'Sick (test)')).rejects.toThrow(/still clocked in/);
    at('11:40');
    day.clockOut = myt(TODAY, '11:30');
    day.clockOutNote = 'Sick';
    await expect(svc.replaceCmsSeat(await svc.user('u-cms-head'), day.id, mos[1].id, 'Sick (test)')).rejects.toBeInstanceOf(AccessDenied);
    // The first person cannot be put back on their own remaining hours (overlaps their seat).
    await expect(svc.replaceCmsSeat(mgr, day.id, mos[0].id, 'Sick (test)')).rejects.toThrow(/already/);
    const rest = ds.cmsShifts.filter((s) => s.replacementOf === day.id && !s.cancelled);
    expect(rest).toHaveLength(1);
    // The empty seat stays; the next try uses it.
    await expect(svc.replaceCmsSeat(mgr, day.id, mos[1].id, 'Sick (test)')).rejects.toThrow(/already exists/);
    await svc.assignCmsShift(mgr, rest[0].id, mos[1].id);
    const seat = ds.cmsShifts.find((s) => s.id === rest[0].id)!;
    expect(seat.staffName).toBe(mos[1].name);
    expect(seat.start).toBe(myt(TODAY, '11:40'));
    expect(seat.end).toBe(day.end);
    expect(day.clockIn).toBe(myt(TODAY, '06:58'));
  });
});

describe('B4 CMS roster upload', () => {
  it('sets planned seats from the file and lists refused lines with the reason', async () => {
    const { ds, svc } = fresh();
    const mgr = await svc.user('u-pwvsb-arms');
    await svc.planCmsRoster(mgr, 7);
    const tomorrow = '2026-10-27';
    const hcs = ds.cmsStaff.filter((p) => p.active && p.posts.includes('HEAD_CONTROL'));
    const target = ds.cmsShifts.find((s) => s.date === tomorrow && s.post === 'HEAD_CONTROL' && !s.cancelled)!;
    target.staffName = null;
    target.staffId = null;
    const r = await svc.uploadCmsRoster(mgr, {
      fileName: 'cms-nov.csv',
      rows: [
        { date: tomorrow, start: target.start.slice(11, 16), post: 'HC', seat: '1', staff: hcs[0].id },
        { date: tomorrow, start: '03:00', post: 'HC', seat: '1', staff: hcs[0].id },
        { date: tomorrow, start: target.start.slice(11, 16), post: 'XX', staff: hcs[0].id },
        { date: '27/10/2026', start: '07:00', post: 'MO', staff: 'x' },
      ],
    });
    expect(r.assigned).toBe(1);
    expect(r.rejected.map((x) => x.line)).toEqual([3, 4, 5]);
    expect(r.rejected[0].reason).toMatch(/Plan the roster/);
    expect(ds.cmsShifts.find((s) => s.id === target.id)!.staffId).toBe(hcs[0].id);
    await expect(svc.uploadCmsRoster(await svc.user('u-cms-head'), { rows: [{}] })).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Review 23 Nov: the company manager names the Amra by staff record', () => {
  it('names, shows on the board, opens the vault to the Amra, refuses self, other company and other roles; blank clears', async () => {
    const { ds, svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ae = await svc.user('u-ae-sasa');
    const v = ds.vaults.find((x) => x.companyId === 'co-sasa')!;
    const act = (u: typeof cm, i: Record<string, unknown>) => svc.armsPolicyAct(u, 'vaultKeeper', i);
    // Only the company head; an admin executive cannot name themselves or anyone.
    await expect(act(ae, { vaultId: v.id, post: 'amra', personId: ae.personId, reason: 'named by letter' })).rejects.toBeInstanceOf(AccessDenied);
    if (cm.personId) await expect(act(cm, { vaultId: v.id, post: 'amra', personId: cm.personId, reason: 'self' })).rejects.toThrow(/themselves/);
    const outsider = ds.people.find((p) => p.companyId !== 'co-sasa' && p.status === 'active')!;
    await expect(act(cm, { vaultId: v.id, post: 'amra', personId: outsider.id, reason: 'wrong company' })).rejects.toThrow(/this company/);
    await expect(act(cm, { vaultId: v.id, post: 'boss', personId: ae.personId, reason: 'x y z' })).rejects.toThrow(/post/);
    await act(cm, { vaultId: v.id, post: 'amra', personId: ae.personId, reason: 'named by letter L/1' });
    expect(await svc.keptVaultCompanyIds(ae)).toEqual(['co-sasa']);
    const board = (await svc.armsPolicyAct(cm, 'board', {})) as { tiles: { vaults: { id: string; amraPersonId: string | null; amra: string | null }[] } };
    const row = board.tiles.vaults.find((x) => x.id === v.id)!;
    expect(row.amraPersonId).toBe(ae.personId);
    expect(row.amra).toBeTruthy();
    // Clearing the post closes the vault again.
    await act(cm, { vaultId: v.id, post: 'amra', personId: '', reason: 'moved to another office' });
    expect(await svc.keptVaultCompanyIds(ae)).toEqual([]);
  });
});
