// HR Phase 3, slice 3B (Fauzan, 2 Nov 2026): joining and leaving, statutory filings with the latest day, EA figures,
// the register, probation and retirement reminders, the leaving guide and vacancies (CEO approves, company head signs).
// Mock data only.
import { describe, expect, it } from "vitest";
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  addDays,
  filingsDue,
  generateDataset,
  myt,
  noticeWeeks,
  terminationBenefit,
} from "../src";

const TODAY = "2026-10-26";
const NOW = myt(TODAY, "09:00");

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  const svc = new PrimaService(new MemoryStore(ds), () =>
    new Date((t += 1000)).toISOString(),
  );
  return { ds, svc };
}

describe("Joining and leaving (slice 3B)", () => {
  it("works out notice and termination benefits by length of service", () => {
    expect(noticeWeeks(1)).toBe(4);
    expect(noticeWeeks(3)).toBe(6);
    expect(noticeWeeks(7)).toBe(8);
    expect(terminationBenefit(2600, 0.5).eligible).toBe(false);
    // RM2,600 / 26 = RM100 a day; 3 years at 15 days a year.
    expect(terminationBenefit(2600, 3).amount).toBe(4500);
  });

  it("lists CP22, SOCSO and EPF for a new hire and CP22A for a leaver, by the latest day, and records the reference", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const p = ds.people.find(
      (x) =>
        x.role === "office" && x.companyId === "pwvsb" && x.id !== hr.personId,
    )!;
    p.hiredOn = addDays(TODAY, -10);
    const q = ds.people.find(
      (x) =>
        x.role === "office" &&
        x.id !== p.id &&
        x.id !== hr.personId &&
        x.status === "active",
    )!;
    q.leaving = {
      kind: "resigned",
      noticeOn: TODAY,
      lastDayOn: addDays(TODAY, 40),
      reason: "New job",
      by: "HR",
      at: NOW,
    };
    const b = await svc.hrJoinLeave(hr);
    const cp22 = b.filings.find(
      (f) => f.kind === "CP22" && f.personId === p.id,
    )!;
    expect(cp22.latestBy).toBe(addDays(TODAY, 20));
    expect(
      b.filings.find((f) => f.kind === "SOCSO_REG" && f.personId === p.id)!
        .latestBy,
    ).toBe(addDays(TODAY, 20));
    expect(
      b.filings.find((f) => f.kind === "EPF_REG" && f.personId === p.id)!
        .latestBy,
    ).toBe("2026-11-15");
    expect(
      b.filings.find((f) => f.kind === "CP22A" && f.personId === q.id)!
        .latestBy,
    ).toBe(addDays(TODAY, 10));
    await expect(
      svc.recordHrFiling(hr, {
        kind: "CP22",
        companyId: p.companyId,
        personId: p.id,
        period: p.hiredOn,
        ref: "",
        filedOn: TODAY,
      }),
    ).rejects.toThrow(/reference/);
    await svc.recordHrFiling(hr, {
      kind: "CP22",
      companyId: p.companyId,
      personId: p.id,
      period: p.hiredOn,
      ref: "LHDN-123456",
      filedOn: TODAY,
    });
    expect(
      (await svc.hrJoinLeave(hr)).filings.find((f) => f.id === cp22.id)!.filed
        ?.ref,
    ).toBe("LHDN-123456");
    await expect(
      svc.recordHrFiling(hr, {
        kind: "CP22",
        companyId: p.companyId,
        personId: p.id,
        period: p.hiredOn,
        ref: "again",
        filedOn: TODAY,
      }),
    ).rejects.toThrow(/Already/);
    for (const id of ["u-cm-sasa", "u-fd", "u-it-ex3"])
      await expect(svc.hrJoinLeave(await svc.user(id))).rejects.toBeInstanceOf(
        AccessDenied,
      );
  });

  it("shows EA and Borang E from January, due by end February and 31 March", () => {
    const { ds } = fresh();
    const due = filingsDue(ds.people, [], "2027-01-10");
    expect(due.find((f) => f.kind === "EA")!.latestBy).toBe("2027-02-28");
    expect(due.find((f) => f.kind === "BORANG_E")!.latestBy).toBe("2027-03-31");
    expect(
      filingsDue(ds.people, [], "2026-10-26").some((f) => f.kind === "EA"),
    ).toBe(false);
  });

  it("drafts EA figures from paid payroll and the register of employees, for HR only", async () => {
    const { svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const ea = await svc.eaDraft(hr, "pwvsb", "2026");
    expect(ea.body.split("\n")[0]).toContain("PCB deducted");
    const reg = await svc.employeeRegister(hr, "pwvsb");
    expect(reg.body.split("\n").length).toBeGreaterThan(2);
    await expect(
      svc.eaDraft(await svc.user("u-fd"), "pwvsb", "2026"),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.employeeRegister(await svc.user("u-cm-sasa"), "co-sasa"),
    ).rejects.toBeInstanceOf(AccessDenied);
  });

  it("reminds HR before probation ends, and HR confirms or extends with a comment, never their own", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const p = ds.people.find(
      (x) =>
        x.role === "office" && x.status === "active" && x.id !== hr.personId,
    )!;
    p.employmentType = "probation";
    p.probationEndsOn = addDays(TODAY, 7);
    expect(
      (await svc.hrJoinLeave(hr)).probations.some((x) => x.personId === p.id),
    ).toBe(true);
    await expect(
      svc.decideProbation(hr, p.id, "extend", null, "More time"),
    ).rejects.toThrow(/new last day/);
    await expect(
      svc.decideProbation(hr, p.id, "confirm", null, ""),
    ).rejects.toThrow(/comment/);
    await svc.decideProbation(
      hr,
      p.id,
      "extend",
      addDays(TODAY, 90),
      "Needs three more months on reconciliations",
    );
    expect(
      (await svc.hrJoinLeave(hr)).probations.some((x) => x.personId === p.id),
    ).toBe(false);
    await svc.decideProbation(hr, p.id, "confirm", null, "Met the standard");
    const after = ds.people.find((x) => x.id === p.id)!;
    expect(after.employmentType).toBe("permanent");
    expect(after.probationDecisions).toHaveLength(2);
    const me = ds.people.find((x) => x.id === hr.personId)!;
    me.employmentType = "probation";
    await expect(
      svc.decideProbation(hr, me.id, "confirm", null, "Myself"),
    ).rejects.toThrow(/Someone else/);
  });

  it("flags staff at or near 60 and a termination around maternity leave (s.41A)", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const old = ds.people.find(
      (x) =>
        x.role === "office" && x.status === "active" && x.id !== hr.personId,
    )!;
    old.dob = "1966-12-01";
    const w = ds.people.find(
      (x) =>
        x.role === "office" &&
        x.status === "active" &&
        x.id !== old.id &&
        x.id !== hr.personId,
    )!;
    w.leaving = {
      kind: "terminated",
      noticeOn: TODAY,
      lastDayOn: addDays(TODAY, 30),
      reason: "Performance",
      by: "HR",
      at: NOW,
    };
    ds.leaveRequests.push({
      ...ds.leaveRequests[0],
      id: "lv-mat-test",
      personId: w.id,
      companyId: w.companyId,
      kind: "MATERNITY",
      from: addDays(TODAY, -20),
      to: addDays(TODAY, 78),
      days: 98,
      status: "approved",
    });
    const b = await svc.hrJoinLeave(hr);
    expect(b.retirements.find((x) => x.personId === old.id)!.over).toBe(false);
    expect(b.maternityGuard.map((x) => x.personId)).toContain(w.id);
    const g = await svc.leavingGuide(hr, w.id);
    expect(g.steps.join(" ")).toMatch(/Form PK/);
  });

  it("takes a vacancy to the CEO, then the company head signs it, each with a comment", async () => {
    const { svc } = fresh();
    const cm = await svc.user("u-cm-arsh");
    const ceo = await svc.user("u-fauzan");
    const v = await svc.raiseVacancy(cm, {
      companyId: "co-arsh",
      title: "Admin executive",
      department: "Admin",
      headcount: 1,
      reason: "Replacement for a leaver",
      payFrom: 2200,
      payTo: 2600,
    });
    await expect(
      svc.raiseVacancy(await svc.user("u-cm-sasa"), {
        companyId: "co-arsh",
        title: "X post",
        department: "",
        headcount: 1,
        reason: "Not mine",
        payFrom: null,
        payTo: null,
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.vacancyStep(cm, v.id, "sign", "Signed")).rejects.toThrow(
      /cannot/,
    );
    await expect(svc.vacancyStep(ceo, v.id, "ceo_approve", "")).rejects.toThrow(
      /comment/,
    );
    await svc.vacancyStep(
      ceo,
      v.id,
      "ceo_approve",
      "Approved, keep within budget",
    );
    await expect(
      svc.vacancyStep(await svc.user("u-cm-sasa"), v.id, "sign", "x"),
    ).rejects.toThrow();
    expect(
      (await svc.vacancyStep(cm, v.id, "sign", "Signed for Arrow Shield"))
        .status,
    ).toBe("open");
    expect((await svc.vacancyStep(cm, v.id, "close", "Hired")).status).toBe(
      "filled",
    );
    // A central post raised by HR is signed by the HR Director; the CEO never approves a vacancy he raised.
    const hr = await svc.user("u-pwvsb-hr");
    const c = await svc.raiseVacancy(hr, {
      companyId: "pwvsb",
      title: "HR executive",
      department: "HR",
      headcount: 1,
      reason: "Phase 3 workload",
      payFrom: null,
      payTo: null,
    });
    await svc.vacancyStep(ceo, c.id, "ceo_approve", "Yes");
    expect(
      (await svc.vacancies(await svc.user("u-cos"))).rows.find(
        (r) => r.id === c.id,
      )!.canSign,
    ).toBe(true);
    await expect(
      svc.vacancies(await svc.user("u-it-ex3")),
    ).rejects.toBeInstanceOf(AccessDenied);
  });
});
