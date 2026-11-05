// HR Phase 3, slice 3C (Fauzan, 2 Nov 2026): maternity and paternity leave with HR's override, public holidays kept by
// HR, office leave in working days, working from home only for staff HR allows, flexible work requests. Mock data only.
import { describe, expect, it } from "vitest";
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  generateDataset,
  holidayYearCheck,
  myt,
  officeLeaveDays,
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

describe("Leave in full (slice 3C)", () => {
  it("counts office leave in working days, without weekends and public holidays", () => {
    // Mon 31 Aug 2026 is National Day; Sat and Sun 5-6 Sep are not counted.
    expect(
      officeLeaveDays("2026-08-31", "2026-09-07", new Set(["2026-08-31"])),
    ).toBe(5);
    expect(officeLeaveDays("2026-09-05", "2026-09-06", new Set())).toBe(0);
  });

  it("lets HR keep the holiday list, add more than the Act, and checks the five fixed days", async () => {
    const { svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const list = await svc.publicHolidays(hr, "2026");
    expect(list.canEdit).toBe(true);
    // The mock list has the four fixed-date days for every state; the Ruler's birthday is per state, so HR adds it.
    expect(
      list.checks.every((c) => c.missing.includes("RULER_BIRTHDAY") && !c.ok),
    ).toBe(true);
    const state = list.checks[0].state!;
    await svc.addPublicHoliday(hr, {
      date: "2026-07-11",
      name: "Ruler's birthday",
      states: [state],
      compulsory: "RULER_BIRTHDAY",
      note: "",
    });
    // HR may add a holiday the Act does not require (Fauzan, 2 Nov 2026).
    const after = await svc.addPublicHoliday(hr, {
      date: "2026-12-24",
      name: "Group family day",
      states: null,
      compulsory: null,
      note: "Extra day from HR",
    });
    const c = after.checks.find((x) => x.state === state)!;
    expect(c.missing).toEqual([]);
    expect(c.count).toBe(6);
    await expect(
      svc.addPublicHoliday(hr, {
        date: "2026-12-24",
        name: "Again",
        states: null,
        compulsory: null,
        note: "",
      }),
    ).rejects.toThrow(/already/);
    await expect(
      svc.removePublicHoliday(
        hr,
        after.holidays.find((h) => h.name === "Group family day")!.id,
        "",
      ),
    ).rejects.toThrow(/comment/);
    // Only HR keeps the list; everyone else reads it.
    for (const id of ["u-cm-sasa", "u-coo", "u-fd", "u-it-ex3"]) {
      const u = await svc.user(id);
      expect((await svc.publicHolidays(u, "2026")).canEdit).toBe(false);
      await expect(
        svc.addPublicHoliday(u, {
          date: "2026-12-26",
          name: "Not allowed",
          states: null,
          compulsory: null,
          note: "",
        }),
      ).rejects.toBeInstanceOf(AccessDenied);
    }
    expect(holidayYearCheck([], null, "2026").ok).toBe(false);
  });

  it("skips public holidays and weekends when an office staff member asks for annual leave", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const ex = await svc.user("u-it-ex3");
    await svc.addPublicHoliday(hr, {
      date: "2026-11-09",
      name: "Deepavali (replacement, mock)",
      states: null,
      compulsory: null,
      note: "",
    });
    // Mon 9 to Sun 15 Nov: 5 weekdays, one of them a holiday.
    const q = await svc.requestLeave(ex, {
      personId: ex.personId,
      kind: "ANNUAL",
      from: "2026-11-09",
      to: "2026-11-15",
      reason: "Family trip",
    });
    expect(q.days).toBe(4);
    await expect(
      svc.requestLeave(ex, {
        personId: ex.personId,
        kind: "ANNUAL",
        from: "2026-11-14",
        to: "2026-11-15",
        reason: "Weekend",
      }),
    ).rejects.toThrow(/weekends/);
    expect(ds.leaveRequests.find((l) => l.id === q.id)!.days).toBe(4);
  });

  it("gives maternity (98 days) and paternity (7 days) leave by the Act, and lets HR give more, never less", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const ex = await svc.user("u-it-ex3");
    const p = ds.people.find((x) => x.id === ex.personId)!;
    p.gender = "F";
    p.hiredOn = "2024-01-02";
    let q = await svc.requestLeave(ex, {
      personId: p.id,
      kind: "MATERNITY",
      from: "2026-11-02",
      to: "2027-02-07",
      reason: "Expected birth 2 Nov",
    });
    expect(q.days).toBe(98);
    await expect(
      svc.requestLeave(ex, {
        personId: p.id,
        kind: "MATERNITY",
        from: "2026-11-02",
        to: "2027-02-08",
        reason: "Too long",
      }),
    ).rejects.toThrow(/98/);
    await expect(
      svc.requestLeave(ex, {
        personId: p.id,
        kind: "PATERNITY",
        from: "2026-11-02",
        to: "2026-11-08",
        reason: "x birth",
      }),
    ).rejects.toThrow(/does not apply/);
    // HR raises maternity leave to 120 days with a reason; going below the Act is refused.
    await expect(
      svc.setLeaveOverride(hr, p.id, "MATERNITY", 90, "Less"),
    ).rejects.toThrow(/above the Act/);
    await expect(
      svc.setLeaveOverride(hr, p.id, "MATERNITY", 120, ""),
    ).rejects.toThrow(/comment/);
    const b = await svc.setLeaveOverride(
      hr,
      p.id,
      "MATERNITY",
      120,
      "Group benefit for confirmed staff",
    );
    expect(b.maternity.entitled).toBe(120);
    q = await svc.requestLeave(ex, {
      personId: p.id,
      kind: "MATERNITY",
      from: "2027-03-01",
      to: "2027-06-28",
      reason: "Longer leave",
    });
    expect(q.days).toBe(120);
    // Annual leave above the Act too; HR never sets their own, and nobody else may set it.
    expect(
      (await svc.setLeaveOverride(hr, p.id, "ANNUAL", 20, "Long service award"))
        .annual.entitled,
    ).toBe(20);
    await expect(
      svc.setLeaveOverride(hr, hr.personId!, "ANNUAL", 30, "Myself"),
    ).rejects.toThrow(/Someone else/);
    for (const id of ["u-cm-sasa", "u-coo", "u-fd", "u-it-ex3"])
      await expect(
        svc.setLeaveOverride(await svc.user(id), p.id, "ANNUAL", 25, "x"),
      ).rejects.toBeInstanceOf(AccessDenied);

    // Paternity: a married man with 12 months of service.
    const p2 = ds.people.find((x) => x.id === ex.personId)!;
    p2.gender = "M";
    p2.maritalStatus = "married";
    q = await svc.requestLeave(ex, {
      personId: p2.id,
      kind: "PATERNITY",
      from: "2026-11-02",
      to: "2026-11-08",
      reason: "Wife expects 2 Nov",
    });
    expect(q.days).toBe(7);
  });

  it("opens working from home only for staff HR allows, and stopping it ends the arrangement", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const de = await svc.user("u-fin-t1-de2");
    expect((await svc.myRemote(de)).eligible).toBe(true);
    await svc.setWfhAllowed(
      hr,
      de.personId!,
      false,
      "Finance desk work needs the office for now",
    );
    const mine = await svc.myRemote(de);
    expect(mine.eligible).toBe(false);
    expect(mine.notEligible).toMatch(/HR has not opened/);
    expect(
      ds.remoteArrangements.find((a) => a.id === "wfh-u-fin-t1-de2-1")!.status,
    ).toBe("ended");
    await expect(
      svc.setWfhAllowed(await svc.user("u-cm-sasa"), de.personId!, true, "x"),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.setWfhAllowed(hr, hr.personId!, true, "Myself"),
    ).rejects.toThrow(/Someone else/);
  });

  it("answers a flexible hours request in writing within 60 days, with grounds for a refusal", async () => {
    const { svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const ex = await svc.user("u-it-ex3");
    const r = await svc.requestFlex(ex, {
      kind: "hours",
      detail: "8.00 to 5.00 instead of 8.30 to 5.30",
      reason: "School run",
      from: "2026-11-02",
      to: null,
    });
    expect(r.answerBy).toBe("2026-12-25");
    await expect(
      svc.requestFlex(ex, {
        kind: "days",
        detail: "Mon to Thu",
        reason: "Study",
        from: "2026-11-02",
        to: null,
      }),
    ).rejects.toThrow(/waiting/);
    expect((await svc.flexRequests(ex)).rows).toHaveLength(1);
    expect((await svc.flexRequests(ex)).canDecide).toBe(false);
    await expect(svc.decideFlex(ex, r.id, true, "ok")).rejects.toBeInstanceOf(
      AccessDenied,
    );
    await expect(
      svc.decideFlex(await svc.user("u-cm-sasa"), r.id, true, "ok"),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideFlex(hr, r.id, false, "no")).rejects.toThrow(
      /grounds/,
    );
    await expect(svc.decideFlex(hr, r.id, true, "")).rejects.toThrow(/comment/);
    expect(
      (
        await svc.decideFlex(
          hr,
          r.id,
          true,
          "Fine, the team covers 5.00 to 5.30",
        )
      ).status,
    ).toBe("approved");
    await expect(svc.decideFlex(hr, r.id, true, "again")).rejects.toThrow(
      /answered/,
    );
  });
});
