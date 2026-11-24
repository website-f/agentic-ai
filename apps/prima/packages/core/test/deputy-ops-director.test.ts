import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';
import { actsAsOpsDirector, inPrivateOpsRollout, isDeputyOpsDirector, isOpsDirector, isOpsDirectorByJob, managementFeeBillScope } from '../src/ops-access';
import { finRequestHeadFits } from '../src/finance-requests';
import { lineManagerOf } from '../src/work';
import type { User } from '../src/types';

// Private operations study gaps (Fauzan, 23 Nov 2026): the Deputy Operations Director stands in fully ("Yes, full
// stand-in any time"), the COO covers the OD's decisions ("Let coo cover also"), and lines follow the side.
// Synthetic data only.
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const users = ds.users as User[];
  const om = await svc.user('u-om-klang');
  const od = users.find((u) => u.opsTier === 'ops_director')!;
  const ogm = users.find((u) => u.opsTier === 'ogm')!;
  const coo = users.find((u) => u.opsTier === 'coo' && u.role === 'pwvsb_officer')!;
  const deputy: User = { ...om, deputyOf: ['c_sasateam'] };
  return { svc, users, om, od, ogm, coo, deputy };
}

describe('Deputy Operations Director and COO cover', () => {
  it('acts as the OD only when named deputy of Sasa Team, in operations, with an open account', async () => {
    const { om, od, ogm, coo, deputy } = await setup();
    expect(isOpsDirectorByJob(od)).toBe(true);
    expect(isOpsDirector(od)).toBe(true);
    expect(isDeputyOpsDirector(od)).toBe(false);
    expect(isOpsDirector(om)).toBe(false);
    expect(isDeputyOpsDirector(deputy)).toBe(true);
    expect(isOpsDirector(deputy)).toBe(true);
    expect(isOpsDirectorByJob(deputy)).toBe(false);
    expect(isOpsDirector({ ...om, deputyOf: ['c_goodwill'] })).toBe(false);
    expect(isOpsDirector({ ...deputy, department: 'hr' })).toBe(false);
    expect(isOpsDirector({ ...deputy, accessClosedFrom: '2026-11-01' })).toBe(false);
    expect(isOpsDirector({ ...deputy, integration: true } as User)).toBe(false);
    expect(isOpsDirector({ ...ogm, deputyOf: ['c_sasateam'] })).toBe(false);
    expect(inPrivateOpsRollout(deputy)).toBe(true);
    expect(managementFeeBillScope(deputy)).toEqual(['sasateam']);
    // The COO covers OD decisions but is not the OD for scoping.
    expect(isOpsDirector(coo)).toBe(false);
    expect(actsAsOpsDirector(coo)).toBe(true);
    expect(actsAsOpsDirector(deputy)).toBe(true);
    expect(actsAsOpsDirector(om)).toBe(false);
    expect(actsAsOpsDirector({ ...coo, integration: true } as User)).toBe(false);
  });

  it('takes the OD step on a private request; the COO covers it; never the government one', async () => {
    const { om, coo, deputy } = await setup();
    const priv = { subject: 'operations', sector: 'private' } as never;
    const gov = { subject: 'operations', sector: 'government' } as never;
    expect(finRequestHeadFits(deputy, priv)).toBe(true);
    expect(finRequestHeadFits(coo, priv)).toBe(true);
    expect(finRequestHeadFits(deputy, gov)).toBe(false);
    expect(finRequestHeadFits(coo, gov)).toBe(false);
    expect(finRequestHeadFits(om, priv)).toBe(false);
  });
});

describe('Operations lines follow the side', () => {
  it('a government Regional OM reports to the OGM, a private one to the OD', async () => {
    const { users, od, ogm } = await setup();
    const rom = users.find((u) => u.opsTier === 'regional')!;
    const others = users.filter((u) => u.id !== rom.id);
    expect(lineManagerOf({ ...rom, opsSector: 'government' }, [...others, { ...rom, opsSector: 'government' }]).manager?.id).toBe(ogm.id);
    expect(lineManagerOf({ ...rom, opsSector: 'private' }, users).manager?.id).toBe(od.id);
    expect(lineManagerOf({ ...rom, opsSector: undefined }, users).manager?.id).toBe(od.id);
  });

  it('an OM goes to a Regional OM of the same side, not the other side', async () => {
    const { users, om } = await setup();
    const region = om.regionIds![0];
    const romGov: User = { ...users.find((u) => u.opsTier === 'regional')!, id: 'u-rom-gov-t', regionIds: [region], opsSector: 'government' };
    const romPriv: User = { ...romGov, id: 'u-rom-priv-t', opsSector: 'private' };
    const rest = users.filter((u) => u.opsTier !== 'regional');
    const privOm: User = { ...om, opsSector: 'private' };
    expect(lineManagerOf(privOm, [romGov, romPriv, ...rest]).manager?.id).toBe('u-rom-priv-t');
    expect(lineManagerOf(privOm, [romGov, ...rest]).manager?.id).not.toBe('u-rom-gov-t');
    expect(lineManagerOf({ ...om, opsSector: 'government' }, [romPriv, romGov, ...rest]).manager?.id).toBe('u-rom-gov-t');
  });

  it('a private patrolling officer with no OM falls back to the OD, a government one to the OGM', async () => {
    const { users, od, ogm } = await setup();
    const po: User = { ...users.find((u) => u.opsTier === 'patrol')!, title: 'Patrolling Officer, Sasa (Perlis)' };
    const noOps = users.filter((u) => !(u.opsTier === 'om' || u.opsTier === 'regional'));
    expect(lineManagerOf({ ...po, opsSector: 'private' }, noOps).manager?.id).toBe(od.id);
    expect(lineManagerOf({ ...po, opsSector: 'government' }, noOps).manager?.id).toBe(ogm.id);
  });
});

describe('COO covers OD decisions on the private side only', () => {
  it('approves extra man-hours at a private site, never at a government site; the deputy approves too', async () => {
    const day = '2026-11-06';
    const ds = generateDataset({ today: day, now: myt(day, '10:00') });
    const svc = new PrimaService(new MemoryStore(ds), () => myt(day, '10:00'));
    const coo = ds.users.find((u) => u.id === 'u-coo') as User;
    const priv = ds.sites.find((s) => s.companyId === 'co-sasa' && s.sector !== 'government')!;
    const gov = ds.sites.find((s) => s.sector === 'government')!;
    const input = { month: '2026-11', extraHours: 12, cause: 'annual_leave' as const, reason: 'OD on leave, COO covers (test)' };
    const row = await svc.approveSiteHours(coo, { ...input, siteId: priv.id });
    expect(row.approvedById).toBe('u-coo');
    expect(row.approverTier).toBe('ops_director');
    await expect(svc.approveSiteHours(coo, { ...input, siteId: gov.id })).rejects.toThrow(/OGM/);
    const deputy = { ...(ds.users.find((u) => u.id === 'u-om-klang') as User), deputyOf: ['c_sasateam'] };
    const byDeputy = await svc.approveSiteHours(deputy, { ...input, siteId: priv.id, reason: 'Deputy OD stands in (test)' });
    expect(byDeputy.approvedById).toBe('u-om-klang');
  });
});
