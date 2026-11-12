import { describe, expect, it } from "vitest";
import { MemoryStore, PrimaService, generateDataset, myt } from "../src";

// C9 (Fauzan, 11 Nov 2026): no board-resolution limit for now; every related-party deal recorded in the governance
// registers sends a notice to the CEO and nobody else. Synthetic data only.
const TODAY = "2026-11-12";

describe("C9 related-party deal notice", () => {
  it("tells the CEO only when a deal is recorded", async () => {
    const ds = generateDataset({ today: TODAY, now: myt(TODAY, "10:00") });
    const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, "10:00"));
    const dcos = await svc.user("u-dcos");
    const d = await svc.registers.act(dcos, "addDeal", {
      companyId: "co-arsh",
      counterparty: "Syarikat Sintetik Sdn Bhd",
      party: "director_company",
      relationship: "Owned by a director (synthetic)",
      nature: "rent",
      amount: 999_999,
      startOn: TODAY,
      fairPriceBasis: "Two valuer letters on market rent (synthetic)",
    });
    // No limit and no block: the deal waits for the CoS review as before, with no board step.
    expect(d.status).toBe("awaiting_review");
    expect(d.board).toBeNull();
    expect(d.ceoNotice).toEqual({ at: myt(TODAY, "10:00") });
    const notice = (items: { title: string }[]) => items.filter((i) => /Related-party deal recorded: Syarikat Sintetik/.test(i.title));
    expect(notice(await svc.registers.homeItems(await svc.user("u-fauzan")))).toHaveLength(1);
    for (const id of ["u-dcos", "u-cos", "u-coo", "u-fd", "u-chair"]) {
      const u = await svc.user(id).catch(() => null);
      if (!u) continue;
      expect(notice(await svc.registers.homeItems(u)), id).toHaveLength(0);
    }
    // The CEO's home carries it.
    const home = await svc.home(await svc.user("u-fauzan"));
    const all = [...home.todo, ...((home as { watch?: typeof home.todo }).watch ?? [])];
    expect(all.some((t) => /Related-party deal recorded/.test(t.title))).toBe(true);
  });
});
