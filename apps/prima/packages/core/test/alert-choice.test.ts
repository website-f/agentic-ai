import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, type HomeItem } from '../src';

// A13 (Fitri package, Fauzan 11 Nov 2026): staff choose their email and Teams alerts. Synthetic data only.
const TODAY = '2026-10-26';

describe('A13: staff choose their alerts', () => {
  it('mutes chosen topics and the daily summary for email and Teams, never safety topics, and keeps the bell whole', async () => {
    const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
    const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
    const u = await svc.user('u-it-ex3');
    const items: HomeItem[] = [
      { tone: 'warn', tag: 'IT job', title: 'Job to do', detail: '', go: { view: 'it' } } as HomeItem,
      { tone: 'crit', tag: 'Vault alarm', title: 'Door open', detail: '', go: { view: 'arms' } } as HomeItem,
    ];
    (svc as unknown as { alertItems: () => Promise<HomeItem[]> }).alertItems = async () => items;
    const before = await svc.myAlertPrefs(u);
    expect(before.canChoose).toBe(true);
    expect(before.topics.find((t) => t.tag === 'Vault alarm')!.locked).toBe(true);
    await expect(svc.setMyAlertPrefs(u, { digest: true, muted: ['Vault alarm'] })).rejects.toThrow(/cannot be muted/);
    await svc.setMyAlertPrefs(u, { digest: false, muted: ['IT job'] });
    expect((await svc.alertItemsToSend(u, 'urgent')).map((i) => i.tag)).toEqual(['Vault alarm']);
    expect((await svc.alertItemsToSend(u, 'digest')).map((i) => i.tag)).toEqual(['Vault alarm']);
    expect((await svc.myAlerts(u)).length).toBe(2);
  });

  it('a sign-in with no staff record keeps the default', async () => {
    const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
    const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
    const noRecord = ds.users.find((u) => !u.personId && !u.integration)!;
    const u = await svc.user(noRecord.id);
    expect((await svc.myAlertPrefs(u)).canChoose).toBe(false);
    await expect(svc.setMyAlertPrefs(u, { digest: false, muted: [] })).rejects.toThrow(/no staff record/);
  });
});
