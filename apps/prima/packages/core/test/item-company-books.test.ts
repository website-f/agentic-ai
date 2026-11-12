// E11 (Fauzan, 11 Nov 2026, decision D01): one SQL Account book per company, and Goodwill Empire Sdn Bhd is on the item
// register's company list. Synthetic data only: made-up legal names, registration numbers and book ids.
import { describe, expect, it } from 'vitest';
import { CENTRAL_PARTIES, GOODWILL_PARTY_ID, MemoryStore, PrimaService, generateDataset, myt, type ItemAction } from '../src';

const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  let rid = 0;
  const act = async (userId: string, a: ItemAction) => {
    const u = await svc.user(userId);
    return ((await svc.items.act(u, `req-e11-${++rid}`, a)) as { result: unknown }).result as never;
  };
  return { ds, svc, act };
}

const FIN = 'u-fin-t1-lead';
const FD = 'u-fd';
const book = (partyId: string, sqlBookId: string): ItemAction => ({ kind: 'book.set', partyId, legalName: `Synthetic ${partyId} Sdn Bhd`, regNo: 'SYN-0001', sqlBookId, counterparties: [] });

describe('E11: Goodwill Empire on the company list, one SQL book per company', () => {
  it('lists Goodwill Empire Sdn Bhd as its own company with its own SQL book slot', async () => {
    const { svc } = fresh();
    const gw = CENTRAL_PARTIES.find((p) => p.id === GOODWILL_PARTY_ID)!;
    expect(gw.name).toBe('Goodwill Empire Sdn Bhd');
    expect(gw.note).toMatch(/E11: one book per company/);
    const f = await svc.items.finance(await svc.user(FIN), GOODWILL_PARTY_ID);
    expect(f.partyId).toBe(GOODWILL_PARTY_ID);
    expect(f.parties.map((p) => p.id)).toContain(GOODWILL_PARTY_ID);
    expect(f.canAct).toBe(true);
  });

  it("records Goodwill's own book, and refuses the same book id for another company", async () => {
    const { act } = fresh();
    const gw = (await act(FIN, book(GOODWILL_PARTY_ID, 'GW-SYN-2026'))) as { sqlBookId: string; partyId: string };
    expect(gw).toMatchObject({ partyId: GOODWILL_PARTY_ID, sqlBookId: 'GW-SYN-2026' });
    await expect(act(FD, book('pwvsb', 'gw-syn-2026'))).rejects.toThrow(/One SQL book per company: gw-syn-2026 is already recorded for Goodwill Empire Sdn Bhd/);
    // Each company keeps its own book; changing Goodwill's own record is fine.
    expect(await act(FD, book('pwvsb', 'PWVSB-SYN'))).toMatchObject({ partyId: 'pwvsb' });
    expect(await act(FIN, book(GOODWILL_PARTY_ID, 'GW-SYN-2026'))).toMatchObject({ partyId: GOODWILL_PARTY_ID });
  });

  it('refuses the wrong role: a storekeeper or a company manager cannot record a book for Goodwill', async () => {
    const { act } = fresh();
    for (const who of ['u-proc-store1', 'u-cm-sasa', 'u-act-aud1']) await expect(act(who, book(GOODWILL_PARTY_ID, 'GW-NOPE'))).rejects.toThrow();
  });
});
