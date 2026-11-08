// Special Operations Phase 4, slice 4A (Fauzan, 2 Nov 2026): the rollout switch's people, the arms and CMS walls, the
// foreign-guard rule (ARMS-LOCAL-ONLY) and armed cover moving to the Arms Control board. Mock data only.
import { describe, expect, it } from 'vitest';
import {
  BadRequest,
  MemoryStore,
  PrimaService,
  RuleBlocked,
  addDays,
  dataWalls,
  demoPin,
  deployability,
  generateDataset,
  holdsArmsWall,
  holdsCmsWall,
  inSpecialOpsRollout,
  myt,
  type Dataset,
} from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

function witnessIn(ds: Dataset, companyId: string, notIds: string[]): { staffNo: string; pin: string } {
  const p = ds.people.find((x) => x.companyId === companyId && x.status === 'active' && x.pinHash && !notIds.includes(x.id))!;
  return { staffNo: p.staffNo, pin: demoPin(p.staffNo) };
}

describe('Special Ops rollout switch: who it lets in', () => {
  it('admits Arms Control, CMS and Transport only; never Finance, HR, IT, a company user or a system feed', () => {
    const { ds } = fresh();
    const u = (id: string) => ds.users.find((x) => x.id === id)!;
    for (const id of ['u-pwvsb-arms', 'u-pwvsb-arms-asst', 'u-cms-head', 'u-transport']) expect(inSpecialOpsRollout(u(id))).toBe(true);
    for (const id of ['u-fd', 'u-cos', 'u-pwvsb-hr', 'u-it-ex1', 'u-pdpa', 'u-cm-sasa', 'u-sv-sasa', 'u-ae-arsh', 'u-coo', 'u-fauzan'])
      expect(inSpecialOpsRollout(u(id))).toBe(false);
    for (const f of ds.users.filter((x) => x.integration)) expect(inSpecialOpsRollout(f)).toBe(false);
  });
});

describe('arms and CMS walls', () => {
  it('gives the arms wall to arms people and the company roles that handle firearms, and to nobody else', () => {
    const { ds } = fresh();
    const u = (id: string) => ds.users.find((x) => x.id === id)!;
    for (const id of ['u-pwvsb-arms', 'u-cms-head', 'u-coo', 'u-fauzan', 'u-audit', 'u-cm-sasa', 'u-sv-sasa']) expect(holdsArmsWall(u(id))).toBe(true);
    // Finance Director, Chief of Staff, HR, IT, PDPA, Transport and admin executives never read arms rows.
    for (const id of ['u-fd', 'u-cos', 'u-pwvsb-hr', 'u-it-ex1', 'u-pdpa', 'u-transport', 'u-ae-arsh']) expect(holdsArmsWall(u(id))).toBe(false);
    // Asset feeds hold only asset walls; JA holds only its narrow guard-feed wall. No integration holds arms or staff identity walls.
    for (const f of ds.users.filter((x) => x.integration && x.integration !== 'am' && x.integration !== 'whatsapp' && x.integration !== 'ja')) expect(dataWalls(f)).toEqual([]);
    for (const k of ['am', 'whatsapp']) expect(dataWalls(ds.users.find((x) => x.integration === k)!)).toEqual(['asset_read', 'asset_write']);
    expect(dataWalls(ds.users.find((x) => x.integration === 'ja')!)).toEqual(['guard_feed']);
    for (const f of ds.users.filter((x) => x.integration)) {
      expect(holdsArmsWall(f)).toBe(false);
      for (const wall of ['staff_ids', 'staff_accounts', 'arms']) expect(dataWalls(f)).not.toContain(wall);
    }
  });

  it('gives the CMS wall to CMS, Arms Control and group arms viewers, never to a company user', () => {
    const { ds } = fresh();
    const u = (id: string) => ds.users.find((x) => x.id === id)!;
    for (const id of ['u-cms-head', 'u-pwvsb-arms', 'u-coo']) expect(holdsCmsWall(u(id))).toBe(true);
    for (const id of ['u-cm-sasa', 'u-sv-sasa', 'u-fd', 'u-cos', 'u-it-ex1', 'u-transport']) expect(holdsCmsWall(u(id))).toBe(false);
  });
});

describe('foreign guards never carry arms (ARMS-LOCAL-ONLY)', () => {
  it('blocks a foreign guard from an armed post, but not from an unarmed one', () => {
    const { ds } = fresh();
    const np = ds.people.find((p) => p.nationality !== 'MY' && p.role !== 'office' && p.status === 'active')!;
    const creds = ds.credentials.filter((c) => c.personId === np.id);
    expect(deployability(np, creds, TODAY, true).map((f) => f.code)).toContain('FOREIGN_ARMED');
    expect(deployability(np, creds, TODAY, false).map((f) => f.code)).not.toContain('FOREIGN_ARMED');
  });

  it('refuses to issue a firearm to a foreign guard even with a permit and an armed shift', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const view = await svc.arms(cm, 'co-sasa');
    const free = view.firearms.find((f) => f.firearm.status === 'IN_VAULT' && f.firearm.licenceExpiresOn)!.firearm;
    const armedSite = ds.sites.find((s) => s.companyId === 'co-sasa' && s.armed)!;
    const holder = ds.credentials.find((c) => c.companyId === 'co-sasa' && c.type === 'FIREARM_PERMIT')!.personId;
    ds.people.find((p) => p.id === holder)!.nationality = 'NP';
    const shift = ds.shifts.find((s) => s.siteId === armedSite.id && s.date === addDays(TODAY, 1))!;
    shift.personId = holder;
    const err = await svc.issueFirearm(cm, { shiftId: shift.id, firearmId: free.id, rounds: 5, witness: witnessIn(ds, 'co-sasa', [holder]) }).catch((e) => e);
    expect(err).toBeInstanceOf(RuleBlocked);
    expect(String(err.message)).toMatch(/not Malaysian/);
    expect(ds.firearms.find((f) => f.id === free.id)!.status).toBe('IN_VAULT');
  });

  it('leaves foreign guards out of the armed-job crew list and refuses them on a CIT job', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const before = await svc.arms(cm, 'co-sasa');
    const pick = before.crewChoices[0];
    ds.people.find((p) => p.id === pick.id)!.nationality = 'NP';
    const after = await svc.arms(cm, 'co-sasa');
    expect(after.crewChoices.map((p) => p.id)).not.toContain(pick.id);
    const job = {
      companyId: 'co-sasa',
      kind: 'CIT' as const,
      client: 'Bank Test Berhad',
      detail: 'Branch run, Petaling Jaya to Klang',
      start: myt('2026-10-29', '08:00'),
      end: myt('2026-10-29', '12:00'),
      crew: [pick.id],
      vehicle: 'Armoured van WXX1234',
      states: [after.homeState ?? 'Selangor'],
      policeApproval: null,
    };
    const err = await svc.planArmedJob(cm, job).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequest);
    expect(String(err.message)).toMatch(/Only Malaysian guards/);
  });
});

describe('armed cover moves to the Arms Control board', () => {
  it('tells the Chief of Staff armed and CIT cover is checked by Arms Control, and never lists it as missing', async () => {
    const { svc } = fresh();
    const cos = await svc.insurance(await svc.user('u-cos'));
    expect(cos.armedCoverOnArmsBoard).toBe(true);
    for (const r of cos.rows) if (r.hasDetail) expect(r.missing.map((m) => m.kind)).not.toContain('ARMED_SERVICE');
    const coo = await svc.insurance(await svc.user('u-coo'));
    expect(coo.armedCoverOnArmsBoard).toBe(false);
  });

  it('shows a company holding firearms with no valid armed-service policy as red on the Arms Control board', async () => {
    const { svc, ds } = fresh();
    const armed = [...new Set(ds.firearms.map((f) => f.companyId))][0];
    for (const p of ds.insurancePolicies.filter((x) => x.companyId === armed && x.kind === 'ARMED_SERVICE')) p.expiresOn = addDays(TODAY, -1);
    const board = await svc.armsControl(await svc.user('u-pwvsb-arms'));
    expect(board.alerts.some((a) => a.kind === 'No cover' && a.companyId === armed)).toBe(true);
  });
});
