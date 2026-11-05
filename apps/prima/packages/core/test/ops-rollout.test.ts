// Who signs in when the CEO starts the Government or Private Operations rollout during the IT pilot. Synthetic users only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, registeredRollouts, rolloutAdmits, rolloutsOn } from '../src';
import { inGovOpsRollout, inPrivateOpsRollout } from '../src/ops-access';

const NOW = myt('2026-11-03', '10:00');

describe('Operations rollouts', () => {
  it('registers gov_ops and private_ops, and admits nobody until the CEO starts them', async () => {
    const ds = generateDataset({ today: '2026-11-03', now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    expect(registeredRollouts().map((r) => r.key)).toEqual(expect.arrayContaining(['gov_ops', 'private_ops']));
    const ogm = await svc.user('u-ogm');
    const proc = await svc.user('u-proc-exec');
    const store = await svc.user('u-proc-store1');
    const dir = await svc.user('u-opsdir');
    const govOm = { ...(await svc.user('u-om-klang')), opsSector: 'government' as const };
    const privOm = { ...govOm, opsSector: 'private' as const };
    const it = await svc.user('u-it-ex1');
    expect(rolloutAdmits(ogm, rolloutsOn({}))).toBe(false);
    const gov = rolloutsOn({ PRIMA_ROLLOUTS: 'gov_ops' });
    for (const u of [ogm, proc, store, govOm]) expect(rolloutAdmits(u, gov), u.id).toBe(true);
    for (const u of [dir, privOm, it]) expect(rolloutAdmits(u, gov), u.id).toBe(false);
    const priv = rolloutsOn({ PRIMA_ROLLOUTS: 'private_ops' });
    for (const u of [dir, privOm]) expect(rolloutAdmits(u, priv), u.id).toBe(true);
    for (const u of [ogm, proc, govOm]) expect(rolloutAdmits(u, priv), u.id).toBe(false);
    expect(inGovOpsRollout({ ...ogm, integration: { kind: 'ja' } } as never)).toBe(false);
    expect(inPrivateOpsRollout({ ...dir, role: 'guard' })).toBe(false);
  });
});
