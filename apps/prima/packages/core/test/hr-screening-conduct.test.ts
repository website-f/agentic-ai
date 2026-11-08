import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  PrimaService,
  generateDataset,
  myt,
  type ScreeningCase,
} from "../src";

// Screening case file and the guard code of conduct (PIKM/ISO review, Fauzan 5 Nov 2026). Synthetic data only.
const TODAY = "2026-11-05";
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, "10:00") });
  const at = { now: myt(TODAY, "10:00") };
  return { ds, at, svc: new PrimaService(new MemoryStore(ds), () => at.now) };
};

describe("screening case file", () => {
  it("HR opens a case once; Prima fills what HR already holds; only HR, the HR Director, the CEO and ACT see it", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const withCard = ds.people.find(
      (p) =>
        p.role === "guard" &&
        p.status === "active" &&
        ds.credentials.some(
          (c) =>
            c.personId === p.id &&
            c.type === "KDN_GUARD_CARD" &&
            (!c.expiresOn || c.expiresOn >= TODAY),
        ),
    )!;
    const c = (await svc.screening.act(hr, "open", {
      subject: "guard",
      personId: withCard.id,
    })) as ScreeningCase;
    expect(c.name).toBe(withCard.name);
    expect(c.companyId).toBe(withCard.companyId);
    const kdn = c.checks.find((k) => k.kind === "kdn_vetting")!;
    expect(kdn).toMatchObject({ status: "clear", byId: "prima" });
    expect(c.checks.find((k) => k.kind === "identity")!.status).toBe("pending");
    await expect(
      svc.screening.act(hr, "open", {
        subject: "guard",
        personId: withCard.id,
      }),
    ).rejects.toThrow(/already an open/);
    await expect(
      svc.screening.act(hr, "open", {
        subject: "office",
        personId: withCard.id,
      }),
    ).rejects.toThrow(/recorded as guard/);
    // HR may also type the staff number from the file.
    const other = ds.people.find(
      (p) =>
        p.role === "guard" && p.status === "active" && p.id !== withCard.id,
    )!;
    const byNo = (await svc.screening.act(hr, "open", {
      subject: "guard",
      staffNo: other.staffNo,
    })) as ScreeningCase;
    expect(byNo.personId).toBe(other.id);
    await expect(
      svc.screening.act(hr, "open", {
        subject: "guard",
        staffNo: "NO-SUCH-NUMBER",
      }),
    ).rejects.toThrow(/Staff member/);
    await expect(
      svc.screening.board(await svc.user("u-cm-sasa")),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.screening.board(await svc.user("u-sv-sasa")),
    ).rejects.toThrow(/Not allowed/);
    const act = await svc.screening.board(await svc.user("u-audit"));
    expect(act.role).toBe("view");
    expect(act.rows.every((r) => !r.canWork && !r.canDecide)).toBe(true);
    await expect(
      svc.screening.act(await svc.user("u-audit"), "check", {
        id: c.id,
        kind: "police",
        status: "clear",
        ref: "x",
      }),
    ).rejects.toThrow(/Not allowed/);
  });

  it("the HR Director decides with a reason, never on their own case; cleared needs every check done", async () => {
    const { svc } = fresh();
    const cos = await svc.user("u-cos");
    const c = (await svc.screening.act(cos, "open", {
      subject: "director",
      companyId: "co-sasa",
      name: "Encik Pengarah Ujian (mock)",
      idMasked: "xxxxxx-xx-1234",
    })) as ScreeningCase;
    // PIKM 2 (Fauzan, 8 Nov 2026): directors also give an application form, are interviewed and KDN-vetted.
    expect(c.checks.map((k) => k.kind)).toEqual([
      "application",
      "interview",
      "consent",
      "identity",
      "kdn_vetting",
      "police",
      "bankruptcy",
      "company_search",
    ]);
    await expect(
      svc.screening.act(cos, "decide", {
        id: c.id,
        result: "not_cleared",
        note: "Testing self",
      }),
    ).rejects.toThrow(/other HR Director/);
    const dcos = await svc.user("u-dcos");
    await expect(
      svc.screening.act(dcos, "decide", {
        id: c.id,
        result: "cleared",
        note: "All good",
      }),
    ).rejects.toThrow(/Still open/);
    const hr = await svc.user("u-pwvsb-hr");
    await expect(
      svc.screening.act(hr, "check", {
        id: c.id,
        kind: "police",
        status: "clear",
      }),
    ).rejects.toThrow(/reference/);
    for (const kind of ["application", "interview", "consent", "identity", "kdn_vetting", "police", "company_search"])
      await svc.screening.act(hr, "check", {
        id: c.id,
        kind,
        status: "clear",
        ref: `REF-${kind} (mock)`,
        authority: "mock",
      });
    await svc.screening.act(hr, "check", {
      id: c.id,
      kind: "bankruptcy",
      status: "concern",
      ref: "MDI-1 (mock)",
      note: "Old discharged bankruptcy (mock)",
    });
    await expect(
      svc.screening.act(hr, "decide", {
        id: c.id,
        result: "cleared",
        note: "ok",
      }),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.screening.act(dcos, "decide", {
        id: c.id,
        result: "cleared",
        note: "Discharged in 2015",
      }),
    ).rejects.toThrow(/conditions/);
    const d = (await svc.screening.act(dcos, "decide", {
      id: c.id,
      result: "cleared",
      note: "Discharged in 2015 (mock)",
      conditions: "Not a cheque signatory (mock)",
    })) as ScreeningCase;
    expect(d.status).toBe("decided");
    expect(d.repeatDueOn! > TODAY).toBe(true);
  });

  it("a guard may be cleared to start while KDN vetting is pending, only once it is submitted and everything else is clear", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const p = ds.people.find(
      (x) =>
        x.role === "guard" &&
        x.status === "active" &&
        ds.credentials.some(
          (c) => c.personId === x.id && c.type === "KDN_VETTING",
        ) &&
        !ds.credentials.some(
          (c) => c.personId === x.id && c.type === "KDN_GUARD_CARD",
        ),
    );
    if (!p) return; // the synthetic data always has some, but stay robust
    const c = (await svc.screening.act(hr, "open", {
      subject: "guard",
      personId: p.id,
    })) as ScreeningCase;
    for (const k of c.checks.filter((k) => k.kind !== "kdn_vetting"))
      await svc.screening.act(hr, "check", {
        id: c.id,
        kind: k.kind,
        status: "clear",
        ref: "REF (mock)",
      });
    const board = await svc.screening.board(await svc.user("u-cos"));
    const row = board.rows.find((r) => r.case.id === c.id)!;
    expect(row.canClear).toBe(false);
    expect(row.canClearPending).toBe(true);
    const d = (await svc.screening.act(await svc.user("u-cos"), "decide", {
      id: c.id,
      result: "cleared_pending",
      note: "Vetting submitted in eSIMS (mock)",
    })) as ScreeningCase;
    expect(d.decision!.result).toBe("cleared_pending");
  });
});

describe("guard code of conduct", () => {
  const code = {
    id: null,
    kind: "code_of_conduct" as const,
    title: "Guard code of conduct (mock)",
    body: "Be at your post on time, in uniform, and report every incident (mock text).",
    audience: "guards" as const,
    copies: [{ lang: "ms" as const, title: "Salinan BM (mock)", body: "Teks dasar dalam Bahasa Melayu untuk ujian (mock).", translator: "HR (mock)" }],
  };

  it("guards acknowledge on their own sign-in; office staff are not asked; officers record briefings for their own guards only", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const pol = (await svc.publishPolicy(hr, code)) as { id: string };
    const guardUser = ds.users.find((u) => u.role === "guard" && u.personId)!;
    const mine = await svc.hrPolicies(guardUser);
    expect(mine.rows.find((r) => r.id === pol.id)!.canAck).toBe(true);
    await svc.acknowledgePolicy(guardUser, pol.id);
    await expect(svc.acknowledgePolicy(guardUser, pol.id)).rejects.toThrow(
      /Already/,
    );
    const officeUser = ds.users.find(
      (u) =>
        u.personId &&
        ds.people.find((p) => p.id === u.personId)?.role === "office",
    )!;
    await expect(svc.acknowledgePolicy(officeUser, pol.id)).rejects.toThrow(
      /not one you need/,
    );

    const sv = await svc.user("u-sv-sasa");
    const b = await svc.hrPolicies(sv);
    const row = b.rows.find((r) => r.id === pol.id)!;
    expect(row.briefableCount).toBeGreaterThan(0);
    expect(row.briefable.every((x) => x.companyId === "co-sasa")).toBe(true);
    const ids = row.briefable.slice(0, 5).map((x) => x.personId);
    await expect(svc.recordBriefingAcks(sv, pol.id, ids, "")).rejects.toThrow(
      /briefing reference/,
    );
    const r = await svc.recordBriefingAcks(
      sv,
      pol.id,
      ids,
      "Night briefing 5 Nov, sheet 12 (mock)",
    );
    expect(r.recorded).toBe(5);
    const arsh = ds.people.find(
      (p) =>
        p.companyId === "co-arsh" &&
        p.role === "guard" &&
        p.status === "active",
    )!;
    await expect(
      svc.recordBriefingAcks(sv, pol.id, [arsh.id], "Sheet 13 (mock)"),
    ).rejects.toThrow(/Not allowed/);
    const office = ds.people.find(
      (p) =>
        p.companyId === "co-sasa" &&
        p.role === "office" &&
        p.status === "active",
    )!;
    await expect(
      svc.recordBriefingAcks(sv, pol.id, [office.id], "Sheet 13 (mock)"),
    ).rejects.toThrow(/Not allowed/);
    const ack = ds.policyAcks.find(
      (a) => a.personId === ids[0] && a.policyId === pol.id,
    )!;
    expect(ack).toMatchObject({
      method: "briefing",
      witness: { byId: "u-sv-sasa" },
    });
  });

  it("a material change asks everyone again; a small correction keeps the acknowledgements", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const pol = (await svc.publishPolicy(hr, code)) as { id: string };
    const guardUser = ds.users.find((u) => u.role === "guard" && u.personId)!;
    await svc.acknowledgePolicy(guardUser, pol.id);
    await svc.publishPolicy(hr, {
      ...code,
      id: pol.id,
      body: `${code.body} Typo fixed.`,
      material: false,
    });
    expect(
      (await svc.hrPolicies(guardUser)).rows.find((r) => r.id === pol.id)!
        .canAck,
    ).toBe(false);
    await expect(
      svc.publishPolicy(hr, {
        ...code,
        id: pol.id,
        audience: "all",
        material: false,
      }),
    ).rejects.toThrow(/material/);
    await svc.publishPolicy(hr, {
      ...code,
      id: pol.id,
      body: `${code.body} New rule on phones at post (mock).`,
      material: true,
    });
    const again = (await svc.hrPolicies(guardUser)).rows.find(
      (r) => r.id === pol.id,
    )!;
    expect(again.version).toBe(3);
    expect(again.canAck).toBe(true);
  });

  it("existing office policies behave as before", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const pol = (await svc.publishPolicy(hr, {
      id: null,
      kind: "handbook",
      title: "Staff handbook (mock)",
      body: "Office hours 8.30 to 5.30 with a flexible hour (mock text).",
      copies: [{ lang: "ms" as const, title: "Salinan BM (mock)", body: "Teks dasar dalam Bahasa Melayu untuk ujian (mock).", translator: "HR (mock)" }],
    })) as { id: string; audience: string };
    expect(pol.audience).toBe("office");
    const guardUser = ds.users.find((u) => u.role === "guard" && u.personId)!;
    expect(
      (await svc.hrPolicies(guardUser)).rows.some((r) => r.id === pol.id),
    ).toBe(false);
  });
});

describe("review fixes (screening and conduct)", () => {
  it("KDN vetting filled from the licence record clears without retyping its number; repeat waits until due", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const p = ds.people.find((x) => x.role === "guard" && x.status === "active" && ds.credentials.some((c) => c.personId === x.id && c.type === "KDN_VETTING") && !ds.credentials.some((c) => c.personId === x.id && c.type === "KDN_GUARD_CARD"));
    if (!p) return;
    const c = (await svc.screening.act(hr, "open", { subject: "guard", personId: p.id })) as ScreeningCase;
    const k = (await svc.screening.act(hr, "check", { id: c.id, kind: "kdn_vetting", status: "clear" })) as ScreeningCase;
    expect(k.checks.find((x) => x.kind === "kdn_vetting")!.status).toBe("clear");
    for (const x of k.checks.filter((x) => x.status === "pending")) await svc.screening.act(hr, "check", { id: c.id, kind: x.kind, status: "clear", ref: "REF (mock)" });
    await svc.screening.act(await svc.user("u-cos"), "decide", { id: c.id, result: "cleared", note: "All clear (mock)" });
    await expect(svc.screening.repeat(hr, c.id)).rejects.toThrow(/Repeat screening is due/);
  });

  it("a guard acknowledges again after a material change, on own sign-in or at a briefing", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const pol = (await svc.publishPolicy(hr, { id: null, kind: "code_of_conduct", title: "Guard code (mock)", body: "Be at your post on time and report every incident (mock text).", audience: "guards", copies: [{ lang: "ms" as const, title: "Salinan BM (mock)", body: "Teks dasar dalam Bahasa Melayu untuk ujian (mock).", translator: "HR (mock)" }] })) as { id: string };
    const guardUser = ds.users.find((u) => u.id === "u-guard-sasa-1")!;
    const sv = await svc.user("u-sv-sasa");
    const other = (await svc.hrPolicies(sv)).rows.find((r) => r.id === pol.id)!.briefable.find((x) => x.personId !== guardUser.personId)!;
    await svc.acknowledgePolicy(await svc.user(guardUser.id), pol.id);
    await svc.recordBriefingAcks(sv, pol.id, [other.personId], "Sheet 1 (mock)");
    await svc.publishPolicy(hr, { id: pol.id, kind: "code_of_conduct", title: "Guard code (mock)", body: "Be at your post on time, no phones at post, report every incident (mock text).", audience: "guards", material: true, copies: [{ lang: "ms" as const, title: "Salinan BM (mock)", body: "Teks dasar dalam Bahasa Melayu untuk ujian (mock).", translator: "HR (mock)" }] });
    const again = await svc.acknowledgePolicy(await svc.user(guardUser.id), pol.id);
    expect(again.version).toBe(2);
    expect((await svc.recordBriefingAcks(sv, pol.id, [other.personId], "Sheet 2 (mock)")).recorded).toBe(1);
    const ack = ds.policyAcks.find((a) => a.policyId === pol.id && a.personId === other.personId)!;
    expect(ack).toMatchObject({ version: 2, witness: { ref: "Sheet 2 (mock)" } });
  });
});

describe("screening to PIKM Part 2 (Fauzan, 8 Nov 2026)", () => {
  const clearAllBut = async (svc: PrimaService, id: string, keep: string[]) => {
    const hr = await svc.user("u-pwvsb-hr");
    const c = (await svc.screening.board(hr)).rows.find((r) => r.case.id === id)!.case;
    for (const k of c.checks)
      if (!keep.includes(k.kind) && k.status === "pending")
        await svc.screening.act(hr, "check", { id, kind: k.kind, status: "clear", ref: `REF-${k.kind} (mock)`, authority: "mock" });
  };

  it("office staff need KDN vetting and a police check, and may start while vetting is pending", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const p = ds.people.find((x) => x.role === "office" && x.status === "active")!;
    const c = (await svc.screening.act(hr, "open", { subject: "office", personId: p.id })) as ScreeningCase;
    expect(c.checks.map((k) => k.kind)).toEqual(expect.arrayContaining(["kdn_vetting", "police"]));
    await clearAllBut(svc, c.id, ["kdn_vetting"]);
    await svc.screening.act(hr, "check", { id: c.id, kind: "kdn_vetting", status: "pending", ref: "ESIMS-OFF-1 (mock)", authority: "KDN eSIMS" });
    const dcos = await svc.user("u-dcos");
    const d = (await svc.screening.act(dcos, "decide", { id: c.id, result: "cleared_pending", note: "Submitted to KDN (mock)" })) as ScreeningCase;
    expect(d.decision!.result).toBe("cleared_pending");
  });

  it("a passed KDN result clears; a failed one ends the employment, shown at home until HR records it", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const dcos = await svc.user("u-dcos");
    const guards = ds.people.filter(
      (x) => x.role === "guard" && x.status === "active" && ds.credentials.some((c) => c.personId === x.id && c.type === "KDN_VETTING"),
    );
    const start = async (personId: string) => {
      const c = (await svc.screening.act(hr, "open", { subject: "guard", personId })) as ScreeningCase;
      await clearAllBut(svc, c.id, ["kdn_vetting"]);
      return (await svc.screening.act(dcos, "decide", { id: c.id, result: "cleared_pending", note: "Submitted (mock)" })) as ScreeningCase;
    };
    const a = await start(guards[0].id);
    const b = await start(guards[1].id);
    // Only for a cleared-to-start case, by HR, with a reference; a fail needs what KDN said.
    await expect(svc.screening.act(await svc.user("u-audit"), "vettingResult", { id: a.id, passed: true, ref: "KDN-1" })).rejects.toThrow(/Not allowed/);
    await expect(svc.screening.act(hr, "vettingResult", { id: a.id, passed: true, ref: "" })).rejects.toThrow(/reference/);
    await expect(svc.screening.act(hr, "vettingResult", { id: b.id, passed: false, ref: "KDN-2 (mock)" })).rejects.toThrow(/what KDN said/);
    const ok = (await svc.screening.act(hr, "vettingResult", { id: a.id, passed: true, ref: "KDN-1 (mock)" })) as ScreeningCase;
    expect(ok.decision!.result).toBe("cleared");
    expect(ok.checks.find((k) => k.kind === "kdn_vetting")!.status).toBe("clear");
    expect(ok.endEmployment).toBeNull();
    await expect(svc.screening.act(hr, "vettingResult", { id: a.id, passed: false, ref: "KDN-1 (mock)", note: "again" })).rejects.toThrow(/Only for someone/);
    const bad = (await svc.screening.act(hr, "vettingResult", { id: b.id, passed: false, ref: "KDN-2 (mock)", note: "Not approved by KDN (mock)" })) as ScreeningCase;
    expect(bad.decision!.result).toBe("not_cleared");
    expect(bad.repeatDueOn).toBeNull();
    expect(bad.endEmployment).toMatchObject({ dueOn: TODAY, doneOn: null });
    const board = await svc.screening.board(hr);
    expect(board.kpis.endEmployment).toBe(1);
    const home = await svc.screening.homeItems(hr);
    expect(home.some((i) => /end the employment/.test(i.title))).toBe(true);
    await expect(svc.screening.act(hr, "employmentEnded", { id: b.id, note: "" })).rejects.toThrow(/how and when/);
    const ended = (await svc.screening.act(hr, "employmentEnded", { id: b.id, note: "Leaving record LV-1 (mock)" })) as ScreeningCase;
    expect(ended.endEmployment!.doneOn).toBe(TODAY);
    expect((await svc.screening.board(hr)).kpis.endEmployment).toBe(0);
    await expect(svc.screening.act(hr, "employmentEnded", { id: b.id, note: "Leaving record LV-1 (mock)" })).rejects.toThrow(/Nothing to record/);
  });

  it("directors are not cleared to start before KDN vetting; screeners are listed with screened, confidentiality and training", async () => {
    const { svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const c = (await svc.screening.act(hr, "open", { subject: "director", companyId: "co-sasa", name: "Puan Pengarah Ujian (mock)", idMasked: "xxxxxx-xx-5678" })) as ScreeningCase;
    await clearAllBut(svc, c.id, ["kdn_vetting"]);
    await svc.screening.act(hr, "check", { id: c.id, kind: "kdn_vetting", status: "pending", ref: "KDN-DIR (mock)", authority: "KDN" });
    await expect(svc.screening.act(await svc.user("u-dcos"), "decide", { id: c.id, result: "cleared_pending", note: "Submitted (mock)" })).rejects.toThrow(/Only for an employee/);
    const b = await svc.screening.board(await svc.user("u-dcos"));
    const me = b.screeners.find((x) => x.userId === "u-pwvsb-hr")!;
    expect(me).toMatchObject({ screened: false, trained: false });
    expect(typeof me.confidentiality).toBe("boolean");
    expect((await svc.screening.board(await svc.user("u-audit"))).screeners).toEqual([]);
  });
});
