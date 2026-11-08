import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  PrimaService,
  generateDataset,
  myt,
  supplierRatingState,
  type PurSupplier,
  type SupplierRating,
} from "../src";

// Quality operations (Fauzan, 5 Nov 2026 "Build any not build"): service faults, supplier ratings, objectives,
// controlled documents, management review and the extra corrective-action detail. Synthetic data only.
const TODAY = "2026-11-05";
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, "10:00") });
  const at = { now: myt(TODAY, "10:00") };
  return { ds, at, svc: new PrimaService(new MemoryStore(ds), () => at.now) };
};

describe("who sees quality operations", () => {
  it("guards, officers and ordinary staff have no screen; company managers see their own company only", async () => {
    const { svc, ds } = fresh();
    const guard = ds.users.find((u) => u.role === "guard")!;
    await expect(svc.qualityOps.board(guard)).rejects.toThrow(/Not allowed/);
    await expect(
      svc.qualityOps.board(await svc.user("u-sv-sasa")),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.qualityOps.board(await svc.user("u-ae-arsh")),
    ).rejects.toThrow(/Not allowed/);
    const cm = await svc.qualityOps.board(await svc.user("u-cm-sasa"), {
      companyId: "co-arsh",
    });
    expect(cm.companyId).toBe("co-sasa");
    expect(cm.companies.map((c) => c.id)).toEqual(["co-sasa"]);
    expect(cm.faults.length).toBeGreaterThan(0);
    expect(cm.suppliers.every((s) => s.companyId === "co-sasa")).toBe(true);
    // Company managers see documents in force, never drafts or review records, and no review pack.
    expect(
      cm.items.every(
        (r) => r.item.kind !== "review" && r.item.status !== "draft",
      ),
    ).toBe(true);
    expect(cm.pack).toBeNull();
    const other = await svc.qualityOps.board(await svc.user("u-cm-arsh"));
    expect(other.faults.every((f) => f.nc.companyId === "co-arsh")).toBe(true);
    expect(other.faults.some((f) => f.nc.id === "nc-seed-2")).toBe(false);
  });
});

describe("service faults", () => {
  it("records once with what was done at once; a second fault at the same site is a repeat that needs a root cause", async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user("u-cm-sasa");
    const site = ds.sites.find((s) => s.companyId === "co-sasa")!;
    await expect(
      svc.qualityOps.act(cm, "recordFault", {
        companyId: "co-sasa",
        siteId: site.id,
        source: "site_visit",
        what: "short",
        correction: "x",
      }),
    ).rejects.toThrow(/what happened/);
    await expect(
      svc.qualityOps.act(cm, "recordFault", {
        companyId: "co-sasa",
        siteId: site.id,
        source: "client_complaint",
        what: "Guard asleep at the gate (mock)",
        correction: "Guard replaced (mock)",
      }),
    ).rejects.toThrow(/client raised it/);
    const nc = (await svc.qualityOps.act(cm, "recordFault", {
      companyId: "co-sasa",
      siteId: site.id,
      source: "client_complaint",
      what: "Guard asleep at the gate (mock)",
      correction: "Guard replaced (mock)",
      clientTold: true,
      clientNote: "Phoned the client (mock)",
    })) as { id: string; ref: string; repeatOf: string[] };
    expect(nc.repeatOf.length).toBeGreaterThan(0);
    // Another company cannot record or close it.
    await expect(
      svc.qualityOps.act(await svc.user("u-cm-arsh"), "recordFault", {
        companyId: "co-sasa",
        siteId: site.id,
        source: "site_visit",
        what: "Something wrong here (mock)",
        correction: "Fixed it (mock)",
      }),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.qualityOps.act(await svc.user("u-cm-arsh"), "closeFault", {
        id: nc.id,
        outcome: "corrected",
        note: "done",
      }),
    ).rejects.toThrow(/Not allowed/);
    // A site of another company is refused.
    const arshSite = ds.sites.find((s) => s.companyId === "co-arsh")!;
    await expect(
      svc.qualityOps.act(cm, "recordFault", {
        companyId: "co-sasa",
        siteId: arshSite.id,
        source: "site_visit",
        what: "Something wrong here (mock)",
        correction: "Fixed it (mock)",
      }),
    ).rejects.toThrow(/site of this company/);

    // Only ACT raises the root cause, owned by the company manager, as an ACT finding needing the full detail.
    await expect(
      svc.qualityOps.act(cm, "rootCause", {
        id: nc.id,
        ownerUserId: "u-cm-sasa",
      }),
    ).rejects.toThrow(/Not allowed/);
    const act = await svc.user("u-audit");
    await expect(
      svc.qualityOps.act(act, "rootCause", {
        id: nc.id,
        ownerUserId: "u-cm-arsh",
      }),
    ).rejects.toThrow(/company's manager/);
    const r = (await svc.qualityOps.act(act, "rootCause", {
      id: nc.id,
      ownerUserId: "u-cm-sasa",
      area: "PATROL",
    })) as { finding: { id: string; origin?: string; ownerUserId: string } };
    expect(r.finding.origin).toBe("quality");
    expect(r.finding.ownerUserId).toBe("u-cm-sasa");
    await expect(
      svc.qualityOps.act(act, "rootCause", {
        id: nc.id,
        ownerUserId: "u-cm-sasa",
      }),
    ).rejects.toThrow(/Already raised/);
    await expect(
      svc.actFindingStep(cm, r.finding.id, "plan", {
        rootCause: "Handover at guard room (mock)",
        solution: "Handover at the post (mock)",
        targetOn: "2026-11-20",
      }),
    ).rejects.toThrow(/meanwhile/);
    const planned = await svc.actFindingStep(cm, r.finding.id, "plan", {
      rootCause: "Handover at guard room (mock)",
      solution: "Handover at the post (mock)",
      targetOn: "2026-11-20",
      containment: "Officer watches each change this week (mock)",
      similarWhere: "Checked the other 3 sites with night shifts (mock)",
      effectiveWhen: "No empty post at changes for 60 days (mock)",
    });
    expect(planned.plan?.effectiveWhen).toMatch(/60 days/);

    // A not-serious, first fault cannot be sent for a root cause.
    const first = (await svc.qualityOps.act(cm, "recordFault", {
      companyId: "co-sasa",
      source: "internal_check",
      what: "Uniform badge missing on one guard (mock)",
      correction: "Badge issued (mock)",
    })) as { id: string };
    await expect(
      svc.qualityOps.act(act, "rootCause", {
        id: first.id,
        ownerUserId: "u-cm-sasa",
      }),
    ).rejects.toThrow(/serious or repeated/);

    // Close: client acceptance names the client person; a closed fault cannot be closed again.
    await expect(
      svc.qualityOps.act(cm, "closeFault", {
        id: nc.id,
        outcome: "client_accepted",
        note: "Client agreed (mock)",
      }),
    ).rejects.toThrow(/Name the client/);
    await svc.qualityOps.act(cm, "closeFault", {
      id: nc.id,
      outcome: "corrected",
      note: "New guard on the post (mock)",
    });
    await expect(
      svc.qualityOps.act(cm, "closeFault", {
        id: nc.id,
        outcome: "corrected",
        note: "again",
      }),
    ).rejects.toThrow(/already closed/);
  });

  it("everyday ACT findings keep working without the extra detail", async () => {
    const { svc } = fresh();
    const act = await svc.user("u-audit");
    const f = await svc.raiseActFinding(act, {
      companyId: "co-sasa",
      area: "PATROL",
      source: "manual",
      title: "Patrol gap (mock)",
      detail: "",
      severity: "low",
      evidence: "Report (mock)",
      ownerUserId: "u-cm-sasa",
    });
    expect(f.origin).toBeUndefined();
    const p = await svc.actFindingStep(
      await svc.user("u-cm-sasa"),
      f.id,
      "plan",
      { rootCause: "x cause", solution: "y fix", targetOn: "2026-11-20" },
    );
    expect(p.status).toBe("planned");
  });

  it("Operations records only for sites they cover", async () => {
    const { svc, ds } = fresh();
    const om = await svc.user("u-om-klang");
    const b = await svc.qualityOps.board(om, { companyId: "co-sasa" });
    expect(b.role).toBe("ops");
    expect(b.sites.length).toBeGreaterThan(0);
    const covered = new Set(b.sites.map((s) => s.id));
    const outside = ds.sites.find(
      (s) => s.companyId === "co-sasa" && !covered.has(s.id),
    );
    await expect(
      svc.qualityOps.act(om, "recordFault", {
        companyId: "co-sasa",
        source: "site_visit",
        what: "Something wrong here (mock)",
        correction: "Fixed it (mock)",
      }),
    ).rejects.toThrow(/Not allowed/);
    if (outside)
      await expect(
        svc.qualityOps.act(om, "recordFault", {
          companyId: "co-sasa",
          siteId: outside.id,
          source: "site_visit",
          what: "Something wrong here (mock)",
          correction: "Fixed it (mock)",
        }),
      ).rejects.toThrow(/Not allowed/);
    if (b.sites[0])
      await expect(
        svc.qualityOps.act(om, "recordFault", {
          companyId: "co-sasa",
          siteId: b.sites[0].id,
          source: "site_visit",
          what: "Something wrong here (mock)",
          correction: "Fixed it (mock)",
        }),
      ).resolves.toMatchObject({ companyId: "co-sasa" });
    expect(b.faults.every((f) => f.nc.siteId && covered.has(f.nc.siteId))).toBe(
      true,
    );
  });
});

describe("supplier performance", () => {
  it("Procurement or the company manager rates; stop blocks the supplier; only Finance unblocks", async () => {
    const { svc, ds } = fresh();
    const s = ds.purSuppliers.find(
      (x) => x.companyId === "co-sasa" && !x.blocked,
    )!;
    const proc = await svc.user("u-proc-exec");
    await expect(
      svc.qualityOps.act(await svc.user("u-proc-store1"), "rateSupplier", {
        id: s.id,
        quality: 4,
        onTime: 4,
        paperwork: 4,
        result: "keep",
      }),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.qualityOps.act(await svc.user("u-cm-arsh"), "rateSupplier", {
        id: s.id,
        quality: 4,
        onTime: 4,
        paperwork: 4,
        result: "keep",
      }),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.qualityOps.act(proc, "rateSupplier", {
        id: s.id,
        quality: 6,
        onTime: 4,
        paperwork: 4,
        result: "keep",
      }),
    ).rejects.toThrow(/1 \(poor\) to 5/);
    await expect(
      svc.qualityOps.act(proc, "rateSupplier", {
        id: s.id,
        quality: 2,
        onTime: 4,
        paperwork: 4,
        result: "keep",
      }),
    ).rejects.toThrow(/low score/);
    await expect(
      svc.qualityOps.act(proc, "rateSupplier", {
        id: s.id,
        quality: 4,
        onTime: 4,
        paperwork: 4,
        result: "watch",
      }),
    ).rejects.toThrow(/went wrong/);
    const ok = (await svc.qualityOps.act(proc, "rateSupplier", {
      id: s.id,
      quality: 4,
      onTime: 5,
      paperwork: 4,
      result: "keep",
    })) as PurSupplier & { performance: SupplierRating[] };
    expect(supplierRatingState(ok, TODAY).state).toBe("keep");
    const stop = (await svc.qualityOps.act(
      await svc.user("u-cm-sasa"),
      "rateSupplier",
      {
        id: s.id,
        quality: 1,
        onTime: 2,
        paperwork: 3,
        result: "stop",
        issues: "Wrong items twice (mock)",
      },
    )) as PurSupplier;
    expect(stop.blocked?.note).toMatch(/Stopped after performance rating/);
    await expect(
      svc.qualityOps.act(proc, "rateSupplier", {
        id: s.id,
        quality: 4,
        onTime: 4,
        paperwork: 4,
        result: "keep",
      }),
    ).rejects.toThrow(/blocked/);
    await expect(
      svc.purSupplierStep(proc, s.id, "unblock", ""),
    ).rejects.toThrow(/Not allowed/);
  });

  it("a rating is due again after the rating period", () => {
    const r: SupplierRating = {
      on: "2025-10-01",
      quality: 4,
      onTime: 4,
      paperwork: 4,
      issues: "",
      result: "keep",
      by: "x",
      byId: "x",
      at: "2025-10-01T02:00:00Z",
    };
    expect(
      supplierRatingState({ blocked: null, performance: [r] }, TODAY).state,
    ).toBe("due");
    expect(
      supplierRatingState({ blocked: null, performance: [] }, TODAY).state,
    ).toBe("not_rated");
  });
});

describe("objectives, controlled documents and management review", () => {
  it("objectives: kept by ACT or the Chief of Staff, no approval, progress recorded", async () => {
    const { svc } = fresh();
    await expect(
      svc.qualityOps.act(await svc.user("u-cm-sasa"), "saveItem", {
        kind: "objective",
        title: "X objective",
      }),
    ).rejects.toThrow(/Not allowed/);
    const cos = await svc.user("u-cos");
    await expect(
      svc.qualityOps.act(cos, "saveItem", {
        kind: "objective",
        title: "Fewer complaints (mock)",
        measure: "Complaints per 100 posts",
      }),
    ).rejects.toThrow(/measure, the target/);
    const o = (await svc.qualityOps.act(cos, "saveItem", {
      kind: "objective",
      title: "Fewer complaints (mock)",
      measure: "Complaints per 100 posts",
      target: "Under 2",
      ownerTitle: "COO",
      dueOn: "2027-06-30",
    })) as { id: string; status: string };
    expect(o.status).toBe("active");
    await expect(
      svc.qualityOps.act(cos, "progress", {
        id: o.id,
        value: "1.8",
        done: true,
      }),
    ).rejects.toThrow(/why it is reached/);
    const done = (await svc.qualityOps.act(cos, "progress", {
      id: o.id,
      value: "1.8",
      done: true,
      note: "Three months under target (mock)",
    })) as { status: string };
    expect(done.status).toBe("done");
  });

  it("documents: a new version is approved by a second person, never its writer; the old one stays in force until then", async () => {
    const { svc } = fresh();
    const act = await svc.user("u-audit");
    const cos = await svc.user("u-cos");
    await expect(
      svc.qualityOps.act(act, "saveItem", {
        kind: "document",
        title: "Patrol procedure (mock)",
        code: "bad code!",
        ownerTitle: "COO",
      }),
    ).rejects.toThrow(/document code/);
    await expect(
      svc.qualityOps.act(act, "saveItem", {
        kind: "document",
        title: "Patrol procedure (mock)",
        code: "SOP-OPS-02",
        ownerTitle: "COO",
        link: "http://x",
      }),
    ).rejects.toThrow(/https/);
    const d = (await svc.qualityOps.act(act, "saveItem", {
      kind: "document",
      title: "Patrol procedure (mock)",
      code: "sop-ops-02",
      ownerTitle: "COO",
      link: "https://example.invalid/sop.docx",
    })) as { id: string; code: string; status: string };
    expect(d.code).toBe("SOP-OPS-02");
    expect(d.status).toBe("draft");
    await expect(
      svc.qualityOps.act(act, "saveItem", {
        kind: "document",
        title: "Again (mock)",
        code: "SOP-OPS-02",
        ownerTitle: "COO",
      }),
    ).rejects.toThrow(/exists/);
    await expect(
      svc.qualityOps.act(act, "decideItem", {
        id: d.id,
        agree: true,
        note: "Looks right",
      }),
    ).rejects.toThrow(/Another person decides/);
    await expect(
      svc.qualityOps.act(await svc.user("u-cm-sasa"), "decideItem", {
        id: d.id,
        agree: true,
        note: "Looks right",
      }),
    ).rejects.toThrow(/Not allowed/);
    await svc.qualityOps.act(cos, "decideItem", {
      id: d.id,
      agree: true,
      note: "Matches the patrol rules (mock)",
    });
    // Change it: a version 2 draft; version 1 stays approved until version 2 is approved.
    const v2 = (await svc.qualityOps.act(cos, "saveItem", {
      id: d.id,
      kind: "document",
      title: "Patrol procedure (mock)",
      code: "SOP-OPS-02",
      ownerTitle: "COO",
      note: "New tag rounds (mock)",
    })) as { id: string; version: number };
    expect(v2.version).toBe(2);
    await expect(
      svc.qualityOps.act(act, "saveItem", {
        id: d.id,
        kind: "document",
        title: "Patrol procedure (mock)",
        code: "SOP-OPS-02",
        ownerTitle: "COO",
      }),
    ).rejects.toThrow(/already waiting/);
    let b = await svc.qualityOps.board(act);
    expect(b.items.find((r) => r.item.id === d.id)?.item.status).toBe(
      "approved",
    );
    await expect(
      svc.qualityOps.act(cos, "decideItem", {
        id: v2.id,
        agree: true,
        note: "ok fine",
      }),
    ).rejects.toThrow(/Another person decides/);
    await svc.qualityOps.act(act, "decideItem", {
      id: v2.id,
      agree: true,
      note: "Checked against the rounds (mock)",
    });
    b = await svc.qualityOps.board(act);
    expect(b.items.find((r) => r.item.id === d.id)?.item.status).toBe(
      "replaced",
    );
    expect(b.items.find((r) => r.item.id === v2.id)?.item.status).toBe(
      "approved",
    );
  });

  it("management review: Prima builds the inputs; ACT or the Chief of Staff writes the record; only the CEO agrees it", async () => {
    const { svc } = fresh();
    const act = await svc.user("u-audit");
    const pack = await svc.qualityOps.reviewPack(act);
    expect(pack.items.length).toBeGreaterThanOrEqual(10);
    expect(pack.items.map((i) => i.label)).toContain(
      "Service faults (12 months)",
    );
    expect(JSON.stringify(pack)).not.toMatch(/compliant/i);
    await expect(
      svc.qualityOps.reviewPack(await svc.user("u-cm-sasa")),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.qualityOps.act(act, "saveItem", {
        kind: "review",
        title: "Review Q4 (mock)",
        heldOn: "2026-11-04",
        attendees: "CEO, COO, ACT",
        decisions: [{ text: "Fix handovers" }],
      }),
    ).rejects.toThrow(/owner and a date/);
    const r = (await svc.qualityOps.act(act, "saveItem", {
      kind: "review",
      title: "Review Q4 (mock)",
      heldOn: "2026-11-04",
      attendees: "CEO, COO, ACT Lead (mock)",
      decisions: [
        {
          text: "Move every handover to the post (mock)",
          ownerTitle: "COO",
          dueOn: "2026-12-31",
        },
      ],
    })) as { id: string; inputs: unknown[]; status: string };
    expect(r.inputs.length).toBeGreaterThanOrEqual(10);
    expect(r.status).toBe("draft");
    await expect(
      svc.qualityOps.act(await svc.user("u-cos"), "decideItem", {
        id: r.id,
        agree: true,
        note: "Agreed record",
      }),
    ).rejects.toThrow(/CEO agrees/);
    const ceo = await svc.user("u-fauzan");
    const home = await svc.qualityOps.homeItems(ceo);
    expect(home.some((h) => /to decide/.test(h.title))).toBe(true);
    const agreed = (await svc.qualityOps.act(ceo, "decideItem", {
      id: r.id,
      agree: true,
      note: "Record is right (mock)",
    })) as { status: string };
    expect(agreed.status).toBe("approved");
  });

  it("review round: a waiting version hides New version; Operations reads documents in force only", async () => {
    const { svc } = fresh();
    const act = await svc.user("u-audit");
    const b = await svc.qualityOps.board(act);
    const v1 = b.items.find((r) => r.item.id === "qi-doc-SOP-OPS-01-v1")!;
    expect(v1.canEdit).toBe(false);
    const other = b.items.find((r) => r.item.id === "qi-doc-FRM-HR-03-v1")!;
    expect(other.canEdit).toBe(true);
    const om = await svc.qualityOps.board(await svc.user("u-om-klang"));
    expect(om.items.length).toBeGreaterThan(0);
    expect(
      om.items.every(
        (r) =>
          r.item.status !== "draft" &&
          r.item.kind !== "review" &&
          !r.canEdit &&
          !r.canDecide,
      ),
    ).toBe(true);
    expect(om.pack).toBeNull();
    // Whoever changed a draft cannot approve it, and the screen agrees with the server.
    const cos = await svc.user("u-cos");
    const d = (await svc.qualityOps.act(act, "saveItem", {
      kind: "document",
      title: "Visitor log form (mock)",
      code: "FRM-OPS-09",
      ownerTitle: "COO",
    })) as { id: string };
    await svc.qualityOps.act(cos, "decideItem", {
      id: d.id,
      agree: false,
      note: "Add the vehicle column (mock)",
    });
    await svc.qualityOps.act(act, "saveItem", {
      id: d.id,
      kind: "document",
      title: "Visitor log form (mock)",
      code: "FRM-OPS-09",
      ownerTitle: "COO",
      note: "Vehicle column added (mock)",
    });
    const row = (await svc.qualityOps.board(cos)).items.find(
      (r) => r.item.id === d.id,
    )!;
    expect(row.canDecide).toBe(true);
  });
});
