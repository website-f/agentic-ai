import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';
import { inGovOpsRollout, isDeputyOgm, isOgm, isOgmByJob } from '../src/ops-access';
import { finRequestHeadFits } from '../src/finance-requests';
import type { User } from '../src/types';

// The Deputy OGM stands in for every OGM step (Fauzan, 23 Nov 2026, decision card "Full stand-in, any time").
// Synthetic data only.
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const om = await svc.user('u-om-klang');
  const deputy: User = { ...om, deputyOf: ['c_goodwill'] };
  return { svc, om, deputy, ogm: await svc.user('u-ogm') };
}

describe('Deputy OGM', () => {
  it('acts as the OGM only when named deputy of Goodwill, in operations, with an open account', async () => {
    const { om, deputy, ogm } = await setup();
    expect(isOgmByJob(ogm)).toBe(true);
    expect(isOgm(ogm)).toBe(true);
    expect(isDeputyOgm(ogm)).toBe(false);
    expect(isOgm(om)).toBe(false);
    expect(isDeputyOgm(deputy)).toBe(true);
    expect(isOgm(deputy)).toBe(true);
    expect(isOgmByJob(deputy)).toBe(false);
    // Deputy of another unit, another department, a closed account or a system feed: no stand-in.
    expect(isOgm({ ...om, deputyOf: ['c_sasateam'] })).toBe(false);
    expect(isOgm({ ...deputy, department: 'hr' })).toBe(false);
    expect(isOgm({ ...deputy, accessClosedFrom: '2026-11-01' })).toBe(false);
    expect(isOgm({ ...deputy, integration: true } as User)).toBe(false);
    expect(inGovOpsRollout(deputy)).toBe(true);
  });

  it('takes the OGM steps: government head of a request, uniform requests seen in full', async () => {
    const { svc, om, deputy } = await setup();
    expect(finRequestHeadFits(deputy, { subject: 'goodwill', sector: 'government' } as never)).toBe(true);
    expect(finRequestHeadFits(deputy, { subject: 'operations', sector: 'private' } as never)).toBe(false);
    expect(finRequestHeadFits(om, { subject: 'goodwill', sector: 'government' } as never)).toBe(false);
    const asDeputy = await svc.uniformRequests(deputy).catch((e: Error) => e);
    expect(asDeputy).not.toBeInstanceOf(Error);
  });
});
