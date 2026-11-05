import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';
import { OPS_GUIDE_CARDS } from '../src/ops-guide-cards';

// Guide cards for Gov Ops, Private Ops, management fees and client care (shared format of PR #56). Synthetic data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');

describe('Ops guide cards', () => {
  it('are in Bahasa Melayu and English, with entered-once, and never name a person to ask', () => {
    for (const c of OPS_GUIDE_CARDS) {
      for (const x of [c.title, c.purpose, c.who, c.screen.action, c.enteredOnce, ...Object.values(c.steps), ...c.notVerified]) {
        expect(x.bm.trim().length, c.id).toBeGreaterThan(1);
        expect(x.en.trim().length, c.id).toBeGreaterThan(1);
        expect(x.bm).not.toBe(x.en);
      }
      for (const s of c.sources) expect(s.askDesk != null || !!s.askName, c.id).toBe(true);
    }
    expect(new Set(OPS_GUIDE_CARDS.map((c) => c.id)).size).toBe(OPS_GUIDE_CARDS.length);
    // Eight cards: Goodwill issue, Goodwill handover, two monitors (government, private), fee entry, fee bills, client
    // rating, client complaint. Commit 9e24e1f's message said nine; eight is right (Arisha main round 3, 3 Nov 2026).
    expect(OPS_GUIDE_CARDS.map((c) => c.id).sort()).toEqual(
      ['client.complaint', 'client.rating', 'fin.management_fee.bills', 'fin.management_fee.enter', 'ops.goodwill.handover', 'ops.goodwill.issue', 'ops.monitor.government', 'ops.monitor.private'],
    );
  });

  it('show a card only to people the server lets do the task', async () => {
    const svc = new PrimaService(new MemoryStore(generateDataset({ today: TODAY, now: NOW })), () => NOW);
    const cardsFor = async (id: string) => {
      const u = await svc.user(id);
      return OPS_GUIDE_CARDS.filter((c) => c.allowed(u)).map((c) => c.id);
    };
    // Each card agrees with the server call it describes.
    const check = async (id: string) => {
      const u = await svc.user(id);
      const has = new Set(await cardsFor(id));
      const ok = async (p: Promise<unknown>) => p.then(() => true).catch(() => false);
      expect(has.has('ops.monitor.government'), `${id} gov`).toBe(await ok(svc.govOpsMonitor(u, '2026-10')));
      expect(has.has('ops.monitor.private'), `${id} private`).toBe(await ok(svc.privateOpsMonitor(u, '2026-10')));
      expect(has.has('fin.management_fee.enter'), `${id} fee`).toBe(await ok(svc.managementFees(u)));
      expect(has.has('fin.management_fee.bills'), `${id} bills`).toBe(await ok(svc.managementFeeBills(u, '2026-10')));
    };
    for (const id of ['u-fd', 'u-fauzan', 'u-coo', 'u-ogm', 'u-opsdir', 'u-om-klang', 'u-proc-store1', 'u-chair']) await check(id);
    expect(await cardsFor('u-proc-store1')).toContain('ops.goodwill.issue');
    expect(await cardsFor('u-om-klang')).toEqual(expect.arrayContaining(['ops.goodwill.handover', 'client.rating', 'client.complaint']));
    expect(await cardsFor('u-fd')).not.toContain('client.rating');
  });
});
