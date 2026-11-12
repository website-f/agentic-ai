// C6 (Fauzan, 11 Nov 2026): ACT structure. The ACT Director is the head; the ACT Manager leads the work and is the second
// checker; Team A and Team B each have an Auditor (team lead) and an Enforcement officer. Nobody second-checks their own
// work, and each team sees its own work. The ACT Director keeps setting guard pay formulas. Synthetic data only.
import { describe, expect, it } from "vitest";
import { AccessDenied as ActDenied, MemoryStore, PrimaService, RULES, actJobOf, generateDataset, myt } from "../src";

const TODAY = "2026-11-12";
const NOW = myt(TODAY, "09:00");

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => new Date((t += 1000)).toISOString());
  return { svc, store };
}

const high = { companyId: "co-arsh", area: "ARMS", source: "workflow_audit" as const, title: "Synthetic vault key log gap", detail: "", severity: "high" as const, evidence: "Synthetic log pages" };

async function fixedHigh(svc: PrimaService, raiserId: string) {
  const raiser = await svc.user(raiserId);
  const cm = await svc.user("u-cm-arsh");
  const f = await svc.raiseActFinding(raiser, { ...high, ownerUserId: cm.id });
  await svc.actFindingStep(cm, f.id, "plan", { rootCause: "No second signer", solution: "Two signatures", targetOn: "2026-11-20" });
  await svc.actFindingStep(cm, f.id, "fixed", { proof: "Synthetic log with two signatures" });
  return f;
}

describe("C6: ACT Director, ACT Manager and Teams A and B", () => {
  it("knows the ACT Manager's job and shows the structure with both teams", async () => {
    const { svc } = fresh();
    const mgr = await svc.user("u-act-mgr");
    expect(actJobOf(mgr)).toBe("manager");
    expect(actJobOf(await svc.user("u-audit"))).toBe("director");
    const b = await svc.actBoard(mgr);
    expect(b.job).toBe("manager");
    expect(b.structure?.director?.id).toBe("u-audit");
    expect(b.structure?.manager?.id).toBe("u-act-mgr");
    expect(b.structure?.teams.map((t) => [t.name, t.auditor?.id, t.enforcement?.id])).toEqual([
      ["Team A", "u-act-aud1", "u-act-enf1"],
      ["Team B", "u-act-aud2", "u-act-enf2"],
    ]);
    expect(b.canAssign).toBe(true);
    expect(b.canCloseHigh).toBe(true);
    expect(RULES.act.source).toMatch(/Approved by Fauzan, 11 Nov 2026 \(workflow map C6\)/);
  });

  it("lets the ACT Manager second-check a high finding after the Auditor's first check", async () => {
    const { svc } = fresh();
    const f = await fixedHigh(svc, "u-act-aud1");
    const aud1 = await svc.user("u-act-aud1");
    const mgr = await svc.user("u-act-mgr");
    // The Manager cannot skip the first check of the team... but may give it; here the Auditor does.
    const first = await svc.actFindingStep(aud1, f.id, "check", { ok: true, note: "Seen the log" });
    expect(first.status).toBe("fixed");
    expect(first.checks.at(-1)).toMatchObject({ ok: true, stage: "first", byId: aud1.id });
    const row = (await svc.actBoard(mgr)).findings.find((r) => r.finding.id === f.id)!;
    expect(row.check).toMatchObject({ stage: "second", canCheck: true, first: { by: aud1.name } });
    expect((await svc.actBoard(mgr)).kpis.secondChecks).toBeGreaterThanOrEqual(1);
    const closed = await svc.actFindingStep(mgr, f.id, "check", { ok: true, note: "Second check: 7 days of logs" });
    expect(closed.status).toBe("closed");
    expect(closed.checks.at(-1)).toMatchObject({ stage: "second", byId: mgr.id });
  });

  it("never lets anyone second-check their own work", async () => {
    const { svc } = fresh();
    const mgr = await svc.user("u-act-mgr");
    const dir = await svc.user("u-audit");
    // The Manager gives the first check: the Manager cannot also give the second; the Director can.
    const a = await fixedHigh(svc, "u-act-aud1");
    await svc.actFindingStep(mgr, a.id, "check", { ok: true, note: "First check" });
    await expect(svc.actFindingStep(mgr, a.id, "check", { ok: true, note: "Second check" })).rejects.toThrow(/You gave the first check/);
    expect((await svc.actFindingStep(dir, a.id, "check", { ok: true, note: "Second check by the head" })).status).toBe("closed");
    // The Manager raised it: the Manager cannot give its second check.
    const b = await fixedHigh(svc, "u-act-mgr");
    await svc.actFindingStep(mgr, b.id, "assign", { team: 2 });
    await svc.actFindingStep(await svc.user("u-act-aud2"), b.id, "check", { ok: true, note: "First check" });
    await expect(svc.actFindingStep(mgr, b.id, "check", { ok: true, note: "Second check" })).rejects.toBeInstanceOf(ActDenied);
    await expect(svc.actFindingStep(mgr, b.id, "check", { ok: true, note: "Second check" })).rejects.toThrow(/You raised this finding/);
  });

  it("refuses the wrong roles: an Auditor, an Enforcement officer or the owner cannot give the second check", async () => {
    const { svc } = fresh();
    const f = await fixedHigh(svc, "u-act-enf1");
    await svc.actFindingStep(await svc.user("u-act-aud1"), f.id, "check", { ok: true, note: "First check" });
    for (const id of ["u-act-aud1", "u-act-aud2", "u-act-enf1"]) {
      await expect(svc.actFindingStep(await svc.user(id), f.id, "check", { ok: true, note: "x" })).rejects.toBeInstanceOf(ActDenied);
    }
    await expect(svc.actFindingStep(await svc.user("u-cm-arsh"), f.id, "check", { ok: true, note: "x" })).rejects.toThrow();
    // A failed second check sends it back to the owner.
    const back = await svc.actFindingStep(await svc.user("u-act-mgr"), f.id, "check", { ok: false, note: "One page unsigned" });
    expect(back.status).toBe("planned");
    expect(back.fix).toBeNull();
  });

  it("closes low and medium findings on one check, as before", async () => {
    const { svc } = fresh();
    const aud1 = await svc.user("u-act-aud1");
    const cm = await svc.user("u-cm-arsh");
    const f = await svc.raiseActFinding(aud1, { ...high, severity: "medium", ownerUserId: cm.id });
    await svc.actFindingStep(cm, f.id, "plan", { rootCause: "x cause", solution: "y fix", targetOn: "2026-11-20" });
    await svc.actFindingStep(cm, f.id, "fixed", { proof: "proof" });
    expect((await svc.actFindingStep(aud1, f.id, "check", { ok: true, note: "Seen" })).status).toBe("closed");
  });

  it("shows each team its own work; the Director and the ACT Manager see both teams", async () => {
    const { svc } = fresh();
    const cm = await svc.user("u-cm-arsh");
    const a = await svc.raiseActFinding(await svc.user("u-act-aud1"), { ...high, title: "Synthetic Team A finding", ownerUserId: cm.id });
    const b = await svc.raiseActFinding(await svc.user("u-act-aud2"), { ...high, title: "Synthetic Team B finding", ownerUserId: cm.id });
    const ids = async (id: string) => new Set((await svc.actBoard(await svc.user(id))).findings.map((r) => r.finding.id));
    for (const id of ["u-act-aud1", "u-act-enf1"]) {
      const s = await ids(id);
      expect(s.has(a.id)).toBe(true);
      expect(s.has(b.id)).toBe(false);
    }
    for (const id of ["u-act-aud2", "u-act-enf2"]) {
      const s = await ids(id);
      expect(s.has(b.id)).toBe(true);
      expect(s.has(a.id)).toBe(false);
    }
    for (const id of ["u-audit", "u-act-mgr"]) {
      const s = await ids(id);
      expect(s.has(a.id) && s.has(b.id)).toBe(true);
    }
    // Work given to Team A is not on Team B's list.
    const mgr = await svc.user("u-act-mgr");
    await svc.assignActWork(mgr, { kind: "workflow", team: 1, area: "ARMS", companyId: null, note: "Synthetic audit" });
    expect((await svc.actBoard(await svc.user("u-act-aud1"))).work.some((w) => w.audit.area === "ARMS")).toBe(true);
    expect((await svc.actBoard(await svc.user("u-act-aud2"))).work.some((w) => w.audit.area === "ARMS")).toBe(false);
    // Enforcement cannot give work to a team.
    await expect(svc.assignActWork(await svc.user("u-act-enf1"), { kind: "workflow", team: 1, area: "ARMS", companyId: null })).rejects.toBeInstanceOf(ActDenied);
  });

  it("keeps the ACT Director as the one who sets guard pay formulas; the ACT Manager only prepares", async () => {
    const { svc } = fresh();
    const mgr = await svc.user("u-act-mgr");
    await expect(svc.decidePayFormula(mgr, "pf-none", true, "Synthetic decision")).rejects.toThrow(/only the ACT Director or the CEO/);
  });
});
