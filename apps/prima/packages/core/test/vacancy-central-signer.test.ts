// C2 (Fauzan, 11 Nov 2026, workflow map answers): PWVSB central vacancies are signed by the CEO, not the HR Director.
// The CEO's approval of a central post is also its signature; company vacancies are unchanged (CEO approves, then the
// company head signs). Synthetic data only.
import { describe, expect, it } from "vitest";
import { MemoryStore, PrimaService, RULES, generateDataset, myt } from "../src";

const TODAY = "2026-11-12";
const NOW = myt(TODAY, "09:00");

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => new Date((t += 1000)).toISOString());
  return { svc, store };
}

const central = { companyId: "pwvsb", title: "Synthetic HR executive", department: "HR", headcount: 1, reason: "Synthetic workload", payFrom: null, payTo: null };

describe("C2: the CEO signs PWVSB central vacancies", () => {
  it("records the rule as approved by Fauzan on 11 Nov 2026", () => {
    expect(RULES.vacancy.value.centralSigner).toBe("ceo");
    expect(RULES.vacancy.source).toMatch(/Approved by Fauzan, 11 Nov 2026/);
  });

  it("opens a central post only with the CEO's approval, which is also the signature", async () => {
    const { svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const ceo = await svc.user("u-fauzan");
    const cos = await svc.user("u-cos");
    const v = await svc.raiseVacancy(hr, central);
    expect(v.status).toBe("waiting_ceo");
    // The HR Director no longer signs or approves a central post.
    const cosRow = (await svc.vacancies(cos)).rows.find((r) => r.id === v.id)!;
    expect(cosRow.canSign).toBe(false);
    expect(cosRow.canCeo).toBe(false);
    expect(cosRow.signer).toBe("ceo");
    await expect(svc.vacancyStep(cos, v.id, "sign", "Signed")).rejects.toThrow(/cannot/);
    await expect(svc.vacancyStep(cos, v.id, "ceo_approve", "Approved")).rejects.toThrow(/cannot/);
    // Still no post can be published: nothing is open yet.
    expect((await svc.vacancies(hr)).rows.find((r) => r.id === v.id)!.status).toBe("waiting_ceo");
    // The CEO needs a comment, then approves and signs in one step.
    await expect(svc.vacancyStep(ceo, v.id, "ceo_approve", " ")).rejects.toThrow(/comment/);
    const opened = await svc.vacancyStep(ceo, v.id, "ceo_approve", "Approved and signed for PWVSB");
    expect(opened.status).toBe("open");
    expect(opened.ceo?.byId).toBe(ceo.id);
    expect(opened.head?.byId).toBe(ceo.id);
    expect(opened.head?.note).toBe("Approved and signed for PWVSB");
  });

  it("lets the CEO sign a central post an earlier version left waiting for the HR Director, and refuses everyone else", async () => {
    const { svc, store } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const ceo = await svc.user("u-fauzan");
    const v = await svc.raiseVacancy(hr, central);
    // A row approved under the old rule (approved, waiting for a head signature).
    await store.update("vacancies", v.id, { status: "waiting_head", ceo: { by: ceo.name, byId: ceo.id, at: NOW, note: "Approved earlier", approve: true } });
    for (const id of ["u-cos", "u-dcos", "u-pwvsb-hr", "u-cm-arsh"]) {
      const u = await svc.user(id);
      await expect(svc.vacancyStep(u, v.id, "sign", "Signed")).rejects.toThrow();
    }
    expect((await svc.vacancies(ceo)).rows.find((r) => r.id === v.id)!.canSign).toBe(true);
    const signed = await svc.vacancyStep(ceo, v.id, "sign", "Signed as CEO");
    expect(signed.status).toBe("open");
    expect(signed.head?.byId).toBe(ceo.id);
  });

  it("leaves company vacancies unchanged: the CEO approves, then the company head signs", async () => {
    const { svc } = fresh();
    const cm = await svc.user("u-cm-arsh");
    const ceo = await svc.user("u-fauzan");
    const v = await svc.raiseVacancy(cm, { ...central, companyId: "co-arsh", title: "Synthetic admin executive" });
    const approved = await svc.vacancyStep(ceo, v.id, "ceo_approve", "Approved");
    expect(approved.status).toBe("waiting_head");
    expect(approved.head).toBeNull();
    const row = (await svc.vacancies(ceo)).rows.find((r) => r.id === v.id)!;
    expect(row.signer).toBe("company_head");
    expect(row.canSign).toBe(false);
    await expect(svc.vacancyStep(ceo, v.id, "sign", "Signed")).rejects.toThrow(/cannot/);
    expect((await svc.vacancyStep(cm, v.id, "sign", "Signed for the company")).status).toBe("open");
  });
});
