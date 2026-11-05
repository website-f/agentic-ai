// Special Ops and Asset Management guide cards (Arisha main review, 2 Nov 2026, section A): BM first with English,
// "entered once" filled, no named person, and each card shown only to people the server lets do the task.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, SPECIAL_OPS_GUIDE_CARDS, generateDataset, myt, specialOpsGuideCardsFor } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
const fresh = () => new PrimaService(new MemoryStore(generateDataset({ today: TODAY, now: NOW })), () => NOW);

describe('Special Ops guide cards', () => {
  it('every text is in BM and English, entered-once is filled, and who to ask is a desk or the record keepers', () => {
    const texts = (c: (typeof SPECIAL_OPS_GUIDE_CARDS)[number]) => [c.title, c.purpose, c.who, c.screen.action, c.enteredOnce, ...Object.values(c.steps), ...c.sources.map((s) => s.what), ...c.notVerified, ...c.fields.map((f) => f.format)];
    expect(new Set(SPECIAL_OPS_GUIDE_CARDS.map((c) => c.id)).size).toBe(SPECIAL_OPS_GUIDE_CARDS.length);
    for (const c of SPECIAL_OPS_GUIDE_CARDS) {
      for (const x of texts(c)) {
        expect(x.bm.trim().length, `${c.id} BM`).toBeGreaterThan(0);
        expect(x.en.trim().length, `${c.id} EN`).toBeGreaterThan(0);
      }
      for (const s of c.sources) if (!s.askDesk) expect(s.askName, c.id).toMatch(/Department|team|keepers/i);
      expect(c.checkedAgainst.length).toBeGreaterThan(0);
    }
  });

  it('names no person from the directory', async () => {
    const svc = fresh();
    const names = (await svc.users()).map((u) => u.name);
    const all = JSON.stringify(SPECIAL_OPS_GUIDE_CARDS);
    for (const n of names) expect(all.includes(n), n).toBe(false);
  });

  it('shows a card only to people the server lets do the task', async () => {
    const svc = fresh();
    const team = await svc.user('u-asset-re1');
    const fd = await svc.user('u-fd');
    const gm = await svc.user('u-gm-sasa');
    const asst = await svc.user('u-pwvsb-arms-asst');
    const ids = (u: Parameters<typeof specialOpsGuideCardsFor>[0]) => specialOpsGuideCardsFor(u).map((c) => c.id);
    // Asset team: purchase request card shown, and the server accepts the request.
    expect(ids(team)).toContain('specialops.purchase-request');
    await svc.amBuyRequest(team, { description: 'Chairs', category: 'FURNITURE', qty: 2, estCost: 400, location: 'Office', ownerEntity: 'PWVSB', reason: 'Synthetic test' });
    // Finance Director: no request card, and the server refuses; the decide card is shown.
    expect(ids(fd)).not.toContain('specialops.purchase-request');
    expect(ids(fd)).toContain('specialops.purchase-decide');
    await expect(svc.amBuyRequest(fd, { description: 'Chairs', category: 'FURNITURE', qty: 2, estCost: 400, location: 'Office', ownerEntity: 'PWVSB', reason: 'Synthetic test' })).rejects.toBeInstanceOf(AccessDenied);
    // Company GM raises and authorises arms requests but does not review them; Arms Control reviews.
    expect(ids(gm)).toEqual(expect.arrayContaining(['specialops.arms-request-raise', 'specialops.arms-request-authorise']));
    expect(ids(gm)).not.toContain('specialops.arms-request-review');
    expect(ids(asst)).toContain('specialops.arms-request-review');
    expect(ids(asst)).not.toContain('specialops.arms-request-authorise');
    // A system feed gets none.
    expect(specialOpsGuideCardsFor(await svc.user('u-whatsapp-link'))).toEqual([]);
    expect(specialOpsGuideCardsFor(gm, 'assets')).toEqual([]);
  });
});
