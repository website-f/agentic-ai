import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  PrimaService,
  addDays,
  dataWalls,
  generateDataset,
  myt,
  riskLevel,
} from "../src";

// Governance registers (Fauzan, 5 Nov 2026): light listing-style governance. Synthetic data only.
// Deals and declarations: Deputy CoS records, CoS reviews, only DCoS/CoS/CEO see them.
// Risks: ACT only; the ACT Director runs them and tells the team what to do. Board limit: a CEO setting, not set yet.
const TODAY = "2026-11-05";
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, "10:00") });
  const at = { now: myt(TODAY, "10:00") };
  return { ds, at, svc: new PrimaService(new MemoryStore(ds), () => at.now) };
};
const deal = (
  companyId: string,
  amount: number,
  extra: Record<string, unknown> = {},
) => ({
  companyId,
  counterparty: "Syarikat Ujian Sdn Bhd (mock)",
  party: "director_company",
  relationship: "Owned by a director (mock)",
  nature: "rent",
  amount,
  startOn: TODAY,
  fairPriceBasis: "Two valuer letters on market rent (mock)",
  ...extra,
});
const risk = (extra: Record<string, unknown> = {}) => ({
  companyId: "co-sasa",
  title: "Big client leaves (mock)",
  category: "strategic",
  ownerName: "Company Manager",
  likelihood: 4,
  impact: 5,
  controls: "Monthly client meeting",
  action: "Renewal talks 6 months early",
  actionDueOn: addDays(TODAY, 30),
  ...extra,
});

describe("who sees which register", () => {
  it("deals and declarations: only the Deputy CoS, the CoS and the CEO", async () => {
    const { svc } = fresh();
    const see = async (id: string) =>
      (await svc.registers.board(await svc.user(id))).deals?.role ?? null;
    expect(await see("u-dcos")).toBe("record");
    expect(await see("u-cos")).toBe("review");
    expect(await see("u-fauzan")).toBe("view");
    for (const id of ["u-coo", "u-audit", "u-cm-sasa", "u-legal"]) {
      const b = await svc.registers.board(await svc.user(id)).catch(() => null);
      expect(b?.deals ?? null).toBeNull();
      expect(b?.interests ?? null).toBeNull();
    }
  });

  it("risks: only ACT and the CEO", async () => {
    const { svc } = fresh();
    expect(
      (await svc.registers.board(await svc.user("u-audit"))).risks?.role,
    ).toBe("director");
    expect(
      (await svc.registers.board(await svc.user("u-act-aud1"))).risks?.role,
    ).toBe("team");
    expect(
      (await svc.registers.board(await svc.user("u-fauzan"))).risks?.role,
    ).toBe("view");
    for (const id of ["u-cos", "u-dcos", "u-coo", "u-cm-sasa"])
      expect((await svc.registers.board(await svc.user(id))).risks).toBeNull();
  });

  it("committees: the company sees only its own; guards see nothing", async () => {
    const { svc, ds } = fresh();
    const b = await svc.registers.board(await svc.user("u-cm-sasa"));
    expect(
      b.committees?.rows.every((c) => c.committee.companyId === "co-sasa"),
    ).toBe(true);
    expect(b.committees?.companies.map((c) => c.id)).toEqual(["co-sasa"]);
    await expect(
      svc.registers.board(ds.users.find((u) => u.role === "guard")!),
    ).rejects.toThrow(/Not allowed/);
  });

  it("database walls match the screens", () => {
    const { ds } = fresh();
    const w = (id: string) => dataWalls(ds.users.find((u) => u.id === id)!);
    for (const id of ["u-dcos", "u-cos", "u-fauzan"])
      expect(w(id)).toContain("reg_desk");
    for (const id of ["u-coo", "u-audit", "u-cm-sasa"])
      expect(w(id)).not.toContain("reg_desk");
    for (const id of ["u-audit", "u-act-aud1", "u-fauzan"])
      expect(w(id)).toContain("reg_risk");
    for (const id of ["u-cos", "u-dcos", "u-coo"])
      expect(w(id)).not.toContain("reg_risk");
  });
});

describe("related-party deals", () => {
  it("the Deputy CoS records, the CoS reviews with a reason; nobody else records or reviews", async () => {
    const { svc } = fresh();
    const dcos = await svc.user("u-dcos");
    const cos = await svc.user("u-cos");
    for (const id of ["u-cos", "u-fauzan", "u-cm-arsh"])
      await expect(
        svc.registers.act(await svc.user(id), "addDeal", deal("co-arsh", 1000)),
      ).rejects.toThrow(/Not allowed/);
    const d = await svc.registers.act(dcos, "addDeal", deal("co-arsh", 12_000));
    expect(d.status).toBe("awaiting_review");
    await expect(
      svc.registers.act(dcos, "reviewDeal", {
        id: d.id,
        agree: true,
        note: "fine by me",
      }),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.registers.act(await svc.user("u-fauzan"), "reviewDeal", {
        id: d.id,
        agree: true,
        note: "fine by me",
      }),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.registers.act(cos, "reviewDeal", { id: d.id, agree: true, note: "" }),
    ).rejects.toThrow(/reason/);
    expect(
      (
        await svc.registers.act(cos, "reviewDeal", {
          id: d.id,
          agree: true,
          note: "Matches market rent",
        })
      ).status,
    ).toBe("done");
    await expect(
      svc.registers.act(cos, "reviewDeal", {
        id: d.id,
        agree: true,
        note: "again",
      }),
    ).rejects.toThrow(/not waiting/);
  });

  it("with no CEO limit set there is no board step, however large the deal", async () => {
    const { svc } = fresh();
    const d = await svc.registers.act(
      await svc.user("u-dcos"),
      "addDeal",
      deal("co-arsh", 5_000_000),
    );
    expect(
      (await svc.registers.board(await svc.user("u-cos"))).deals
        ?.boardApprovalAbove,
    ).toBeNull();
    expect(
      (
        await svc.registers.act(await svc.user("u-cos"), "reviewDeal", {
          id: d.id,
          agree: true,
          note: "Fair, valued",
        })
      ).status,
    ).toBe("done");
  });

  it("only the CEO sets the board limit, with a reason; then large deals need a board resolution", async () => {
    const { svc } = fresh();
    const ceo = await svc.user("u-fauzan");
    const dcos = await svc.user("u-dcos");
    const cos = await svc.user("u-cos");
    await expect(
      svc.registers.act(cos, "setBoardLimit", {
        boardApprovalAbove: 100_000,
        note: "my view",
      }),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.registers.act(ceo, "setBoardLimit", {
        boardApprovalAbove: 100_000,
        note: "",
      }),
    ).rejects.toThrow(/reason/);
    await expect(
      svc.registers.act(ceo, "setBoardLimit", {
        boardApprovalAbove: -5,
        note: "test it",
      }),
    ).rejects.toThrow(/ringgit/);
    await svc.registers.act(ceo, "setBoardLimit", {
      boardApprovalAbove: 100_000,
      note: "Board sees big deals",
    });
    expect((await svc.registers.board(cos)).deals?.boardApprovalAbove).toBe(
      100_000,
    );
    const d = await svc.registers.act(
      dcos,
      "addDeal",
      deal("co-arsh", 300_000, { interestedDirectors: ["Director X (mock)"] }),
    );
    expect(
      (
        await svc.registers.act(cos, "reviewDeal", {
          id: d.id,
          agree: true,
          note: "Fair, two valuations",
        })
      ).status,
    ).toBe("board_needed");
    await expect(
      svc.registers.act(cos, "boardDeal", {
        id: d.id,
        resolutionRef: "BR/1",
        on: TODAY,
        interestedStayedOut: true,
      }),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.registers.act(dcos, "boardDeal", {
        id: d.id,
        resolutionRef: "BR/1",
        on: TODAY,
      }),
    ).rejects.toThrow(/stayed out/);
    await expect(
      svc.registers.act(dcos, "boardDeal", {
        id: d.id,
        resolutionRef: "BR/1",
        on: addDays(TODAY, 1),
        interestedStayedOut: true,
      }),
    ).rejects.toThrow(/future/);
    expect(
      (
        await svc.registers.act(dcos, "boardDeal", {
          id: d.id,
          resolutionRef: "BR/1",
          on: TODAY,
          interestedStayedOut: true,
        })
      ).status,
    ).toBe("done");
    // Cleared again: no board step.
    await svc.registers.act(ceo, "setBoardLimit", {
      boardApprovalAbove: null,
      note: "Not needed for now",
    });
    const s = (await svc.registers.board(ceo)).deals!;
    expect(s.boardApprovalAbove).toBeNull();
    expect(s.limitHistory).toHaveLength(2);
  });

  it("the CoS cannot review a deal naming them as interested", async () => {
    const { svc } = fresh();
    const cos = await svc.user("u-cos");
    const d = await svc.registers.act(
      await svc.user("u-dcos"),
      "addDeal",
      deal("co-sasa", 5_000, { interestedDirectors: [cos.name] }),
    );
    await expect(
      svc.registers.act(cos, "reviewDeal", {
        id: d.id,
        agree: true,
        note: "ok fine",
      }),
    ).rejects.toThrow(/interest/);
    expect(
      (await svc.registers.board(cos)).deals?.rows.find(
        (x) => x.deal.id === d.id,
      )?.canReview,
    ).toBe(false);
  });

  it("a questioned deal goes back to the Deputy CoS, who answers or drops it", async () => {
    const { svc } = fresh();
    const dcos = await svc.user("u-dcos");
    const cos = await svc.user("u-cos");
    const d = await svc.registers.act(dcos, "addDeal", deal("co-sasa", 9_000));
    expect(
      (
        await svc.registers.act(cos, "reviewDeal", {
          id: d.id,
          agree: false,
          note: "Only one quote",
        })
      ).status,
    ).toBe("questioned");
    await expect(
      svc.registers.act(cos, "answerDeal", { id: d.id, note: "x y z" }),
    ).rejects.toThrow(/Not allowed/);
    const back = await svc.registers.act(dcos, "answerDeal", {
      id: d.id,
      note: "Two more quotes attached",
      fairPriceBasis: "Three quotes, ours lowest (mock)",
    });
    expect(back.status).toBe("awaiting_review");
    await svc.registers.act(cos, "reviewDeal", {
      id: d.id,
      agree: false,
      note: "Still above market",
    });
    expect(
      (
        await svc.registers.act(dcos, "answerDeal", {
          id: d.id,
          drop: true,
          note: "Will buy elsewhere",
        })
      ).status,
    ).toBe("not_agreed");
  });

  it("requires a fair-price reason and a real amount", async () => {
    const { svc } = fresh();
    const dcos = await svc.user("u-dcos");
    await expect(
      svc.registers.act(
        dcos,
        "addDeal",
        deal("co-sasa", 1000, { fairPriceBasis: "ok" }),
      ),
    ).rejects.toThrow(/fair/);
    await expect(
      svc.registers.act(dcos, "addDeal", deal("co-sasa", -5)),
    ).rejects.toThrow(/value/);
    await expect(
      svc.registers.act(
        dcos,
        "addDeal",
        deal("co-sasa", 1000, { party: "friend" }),
      ),
    ).rejects.toThrow(/Choose/);
  });

  it("links a deal to a director's declared interest by name", async () => {
    const { svc } = fresh();
    const b = await svc.registers.board(await svc.user("u-cos"));
    expect(
      b.deals?.rows.find((d) =>
        d.deal.counterparty.startsWith("Hartanah Seri Mewah"),
      )?.linkedDeclarations,
    ).toContain("Rahim Osman (mock)");
  });
});

describe("directors' interests", () => {
  it("the Deputy CoS records the yearly form and it replaces the old one; missing is Unknown", async () => {
    const { svc } = fresh();
    const dcos = await svc.user("u-dcos");
    await expect(
      svc.registers.act(await svc.user("u-cm-sasa"), "declare", {
        companyId: "co-sasa",
        directorName: "X",
        declaredOn: TODAY,
        formRef: "F",
        nothingToDeclare: true,
      }),
    ).rejects.toThrow(/Not allowed/);
    let b = (await svc.registers.board(dcos)).interests!;
    expect(
      b.rows.find(
        (d) => d.declaration.directorName === "Zulkifli Hamzah (mock)",
      )?.state,
    ).toBe("overdue");
    expect(b.noDeclarations.length).toBeGreaterThan(0);
    await expect(
      svc.registers.act(dcos, "declare", {
        companyId: "co-sasa",
        directorName: "Zulkifli Hamzah (mock)",
        declaredOn: TODAY,
        formRef: "F1",
      }),
    ).rejects.toThrow(/nothing to declare/);
    await svc.registers.act(dcos, "declare", {
      companyId: "co-sasa",
      directorName: "Zulkifli Hamzah (mock)",
      declaredOn: TODAY,
      formRef: "F1",
      nothingToDeclare: true,
    });
    b = (await svc.registers.board(dcos)).interests!;
    const now = b.rows.filter(
      (d) => d.declaration.directorName === "Zulkifli Hamzah (mock)",
    );
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({
      state: "ok",
      doneThisYear: true,
      history: 1,
    });
  });

  it("the CoS reads it with a comment", async () => {
    const { svc } = fresh();
    const d = await svc.registers.act(await svc.user("u-dcos"), "declare", {
      companyId: "pwvsb",
      directorName: "Group director B (mock)",
      declaredOn: TODAY,
      formRef: "F2",
      nothingToDeclare: true,
    });
    const cos = await svc.user("u-cos");
    await expect(
      svc.registers.act(await svc.user("u-fauzan"), "seeDeclaration", {
        id: d.id,
        note: "seen ok",
      }),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.registers.act(cos, "seeDeclaration", { id: d.id, note: "" }),
    ).rejects.toThrow(/reason/);
    expect(
      (
        await svc.registers.act(cos, "seeDeclaration", {
          id: d.id,
          note: "Matches SSM list",
        })
      ).seen?.by,
    ).toBe(cos.name);
  });
});

describe("committees", () => {
  it("needs one chair and two members; meetings need minutes and a past date", async () => {
    const { svc } = fresh();
    const cm = await svc.user("u-cm-inas");
    const base = {
      companyId: "co-inas",
      name: "Inas tender committee",
      kind: "tender",
      meetEveryMonths: 1,
      termsRef: "BR/TOR/1",
    };
    await expect(
      svc.registers.act(cm, "addCommittee", {
        ...base,
        members: [{ name: "A", chair: true }],
      }),
    ).rejects.toThrow(/two members/);
    await expect(
      svc.registers.act(cm, "addCommittee", {
        ...base,
        members: [{ name: "A" }, { name: "B" }],
      }),
    ).rejects.toThrow(/chair/);
    await expect(
      svc.registers.act(cm, "addCommittee", {
        ...base,
        companyId: "co-sasa",
        members: [{ name: "A", chair: true }, { name: "B" }],
      }),
    ).rejects.toThrow(/Not allowed/);
    const c = await svc.registers.act(cm, "addCommittee", {
      ...base,
      members: [{ name: "A", chair: true }, { name: "B" }],
    });
    expect(
      (await svc.registers.board(cm)).committees?.rows.find(
        (x) => x.committee.id === c.id,
      )?.state,
    ).toBe("unknown");
    await expect(
      svc.registers.act(cm, "addMeeting", { id: c.id, on: TODAY, present: 2 }),
    ).rejects.toThrow(/minutes/);
    await expect(
      svc.registers.act(cm, "addMeeting", {
        id: c.id,
        on: TODAY,
        present: 5,
        minutesRef: "M1",
      }),
    ).rejects.toThrow(/present/);
    await svc.registers.act(cm, "addMeeting", {
      id: c.id,
      on: TODAY,
      present: 2,
      minutesRef: "M1",
    });
    expect(
      (await svc.registers.board(cm)).committees?.rows.find(
        (x) => x.committee.id === c.id,
      )?.state,
    ).toBe("ok");
  });
});

describe("risk register (ACT)", () => {
  it("the ACT Director adds and closes risks; a high risk needs an action", async () => {
    const { svc } = fresh();
    const dir = await svc.user("u-audit");
    expect(riskLevel(20)).toBe("high");
    for (const id of ["u-act-aud1", "u-cm-sasa", "u-cos", "u-fauzan"])
      await expect(
        svc.registers.act(await svc.user(id), "addRisk", risk()),
      ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.registers.act(dir, "addRisk", risk({ action: "" })),
    ).rejects.toThrow(/action/);
    const r = await svc.registers.act(dir, "addRisk", risk());
    await expect(
      svc.registers.act(await svc.user("u-act-aud1"), "closeRisk", {
        id: r.id,
        note: "gone now",
      }),
    ).rejects.toThrow(/Not allowed/);
    expect(
      (
        await svc.registers.act(dir, "closeRisk", {
          id: r.id,
          note: "Client signed 3 years",
        })
      ).status,
    ).toBe("closed");
  });

  it("the ACT Director gives a risk to a team member, who then updates it; others in the team cannot", async () => {
    const { svc } = fresh();
    const dir = await svc.user("u-audit");
    const dep = await svc.user("u-act-aud1");
    const other = await svc.user("u-act-enf1");
    const r = await svc.registers.act(dir, "addRisk", risk());
    await expect(
      svc.registers.act(dep, "reviewRisk", {
        id: r.id,
        likelihood: 3,
        impact: 5,
        note: "checked it",
      }),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.registers.act(dir, "assignRisk", {
        id: r.id,
        toId: "u-cm-sasa",
        note: "check it",
      }),
    ).rejects.toThrow(/ACT team/);
    await expect(
      svc.registers.act(dep, "assignRisk", {
        id: r.id,
        toId: "u-act-enf1",
        note: "check it",
      }),
    ).rejects.toThrow(/Not allowed/);
    const a = await svc.registers.act(dir, "assignRisk", {
      id: r.id,
      toId: dep.id,
      note: "Check the bank guarantee with the owner",
    });
    expect(a).toMatchObject({ assignedToId: dep.id, assignedTo: dep.name });
    expect(a.instructions).toHaveLength(1);
    const rv = await svc.registers.act(dep, "reviewRisk", {
      id: r.id,
      likelihood: 3,
      impact: 5,
      note: "Contract renewed for 1 year",
    });
    expect(rv.reviews).toHaveLength(2);
    await expect(
      svc.registers.act(other, "reviewRisk", {
        id: r.id,
        likelihood: 2,
        impact: 2,
        note: "x y z",
      }),
    ).rejects.toThrow(/Not allowed/);
    const b = (await svc.registers.board(dep)).risks!;
    expect(b.rows.find((x) => x.risk.id === r.id)?.mine).toBe(true);
    expect(b.rows.findIndex((x) => !x.mine)).toBeGreaterThan(
      b.rows.findIndex((x) => x.risk.id === r.id),
    );
    expect(b.heat.flat().reduce((s, n) => s + n, 0)).toBe(
      b.rows.filter((x) => x.risk.status === "open").length,
    );
  });

  it("the CEO sees risks but changes nothing", async () => {
    const { svc } = fresh();
    const b = (await svc.registers.board(await svc.user("u-fauzan"))).risks!;
    expect(b.rows.length).toBeGreaterThan(0);
    expect(
      b.rows.every((r) => !r.canUpdate && !r.canAssign && !r.canClose),
    ).toBe(true);
  });
});

describe("audit trail and home", () => {
  it("every change is in the audit trail", async () => {
    const { svc, ds } = fresh();
    const before = ds.audit.length;
    await svc.registers.act(
      await svc.user("u-dcos"),
      "addDeal",
      deal("co-sasa", 1000),
    );
    expect(ds.audit.length).toBe(before + 1);
    expect(ds.audit.at(-1)?.action).toBe("register.deal.add");
  });

  it("home: CoS sees deals to review, DCoS sees declarations to collect, ACT Director sees late risks", async () => {
    const { svc } = fresh();
    expect(
      (await svc.registers.homeItems(await svc.user("u-cos"))).some((i) =>
        /related-party deal/.test(i.title),
      ),
    ).toBe(true);
    const dcos = await svc.registers.homeItems(await svc.user("u-dcos"));
    expect(dcos.some((i) => /declarations due/.test(i.title))).toBe(true);
    expect(dcos.some((i) => /asked a question/.test(i.title))).toBe(true);
    expect(
      (await svc.registers.homeItems(await svc.user("u-audit"))).some((i) =>
        /risk/.test(i.title),
      ),
    ).toBe(true);
    expect(
      (await svc.registers.homeItems(await svc.user("u-cm-sasa"))).some((i) =>
        /deal|declaration|risk/.test(i.title),
      ),
    ).toBe(false);
  });
});
