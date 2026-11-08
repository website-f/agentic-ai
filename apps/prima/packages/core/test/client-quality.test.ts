import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  PrimaService,
  addDays,
  diligenceState,
  generateDataset,
  myt,
} from "../src";

// Client due diligence and assignment instructions (PIKM/ISO review, Fauzan 5 Nov 2026). Synthetic data only.
const TODAY = "2026-11-05";
const fresh = async () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, "10:00") });
  const at = { now: myt(TODAY, "10:00") };
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => at.now);
  const aeArsh = (await store.get("users", "u-ae-arsh"))!;
  await store.insert("users", {
    ...aeArsh,
    id: "u-ae-sasa-test",
    name: "Synthetic Admin Exec",
    companyIds: ["co-sasa"],
  });
  const acct = ds.clientAccounts.find(
    (a) => a.companyId === "co-sasa" && a.siteIds.length,
  )!;
  await store.update("clientAccounts", acct.id, { diligence: null });
  return {
    ds,
    store,
    svc,
    at,
    acct,
    cm: await svc.user("u-cm-sasa"),
    ae: await svc.user("u-ae-sasa-test"),
  };
};
const KINDS = [
  "identity",
  "authority",
  "purpose",
  "credit",
  "conflict",
  "site_risk",
  "pdpa",
];

describe("client due diligence", () => {
  it("the company office works the checks; only the company manager decides, with a reason; others read or are refused", async () => {
    const { svc, acct, cm, ae } = await fresh();
    await svc.clientQuality.diligenceAct(ae, "start", { accountId: acct.id });
    await expect(
      svc.clientQuality.diligenceAct(ae, "start", { accountId: acct.id }),
    ).rejects.toThrow(/already open/);
    await expect(
      svc.clientQuality.diligenceAct(ae, "check", {
        accountId: acct.id,
        kind: "identity",
        status: "clear",
      }),
    ).rejects.toThrow(/reference/);
    await expect(
      svc.clientQuality.diligenceAct(cm, "decide", {
        accountId: acct.id,
        result: "accepted",
        note: "Looks fine",
      }),
    ).rejects.toThrow(/Still open/);
    for (const kind of KINDS.filter((k) => k !== "credit"))
      await svc.clientQuality.diligenceAct(ae, "check", {
        accountId: acct.id,
        kind,
        status: "clear",
        ref: `REF-${kind} (mock)`,
      });
    await svc.clientQuality.diligenceAct(ae, "check", {
      accountId: acct.id,
      kind: "credit",
      status: "concern",
      note: "Paid late twice last year (mock)",
    });
    await expect(
      svc.clientQuality.diligenceAct(ae, "decide", {
        accountId: acct.id,
        result: "accepted",
        note: "ok ok",
      }),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.clientQuality.diligenceAct(cm, "decide", {
        accountId: acct.id,
        result: "accepted",
        note: "Long-standing client",
      }),
    ).rejects.toThrow(/concern/);
    await expect(
      svc.clientQuality.diligenceAct(cm, "decide", {
        accountId: acct.id,
        result: "accepted_conditions",
        note: "Long-standing client",
      }),
    ).rejects.toThrow(/conditions/);
    const d = await svc.clientQuality.diligenceAct(cm, "decide", {
      accountId: acct.id,
      result: "accepted_conditions",
      note: "Long-standing client (mock)",
      conditions: "One month deposit (mock)",
    });
    expect(d.state.ok).toBe(true);
    expect(d.diligence!.reviewDueOn! > TODAY).toBe(true);
    // Read only: Operations OM, group leaders and ACT. Another company's manager is refused.
    expect(
      (await svc.clientQuality.diligence(await svc.user("u-om-klang"), acct.id))
        .can.work,
    ).toBe(false);
    expect(
      (await svc.clientQuality.diligence(await svc.user("u-audit"), acct.id))
        .role,
    ).toBe("view");
    await expect(
      svc.clientQuality.diligence(await svc.user("u-cm-arsh"), acct.id),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.clientQuality.diligence(await svc.user("u-guard-sasa-1"), acct.id),
    ).rejects.toThrow(/Not allowed/);
  });

  it("a declined client or an overdue review fails the mobilisation check; a review can be opened again", async () => {
    const { svc, store, at, acct, cm, ae } = await fresh();
    await svc.clientQuality.diligenceAct(ae, "start", { accountId: acct.id });
    await svc.clientQuality.diligenceAct(cm, "decide", {
      accountId: acct.id,
      result: "declined",
      note: "Purpose not clear (mock)",
    });
    expect(
      diligenceState(await store.get("clientAccounts", acct.id), TODAY).state,
    ).toBe("declined");
    await svc.clientQuality.diligenceAct(ae, "start", { accountId: acct.id });
    for (const kind of KINDS)
      await svc.clientQuality.diligenceAct(ae, "check", {
        accountId: acct.id,
        kind,
        status: kind === "credit" ? "not_needed" : "clear",
        ref: "REF (mock)",
        note: "Government agency, no credit check (mock)",
      });
    const d = await svc.clientQuality.diligenceAct(cm, "decide", {
      accountId: acct.id,
      result: "accepted",
      note: "Cleared on second look (mock)",
    });
    expect(d.diligence!.round).toBe(2);
    expect(d.diligence!.past.length).toBe(1);
    const later = addDays(d.diligence!.reviewDueOn!, 1);
    expect(
      diligenceState(await store.get("clientAccounts", acct.id), later).ok,
    ).toBe(false);
    at.now = myt(addDays(d.diligence!.reviewDueOn!, -10), "10:00");
    expect((await svc.clientQuality.diligence(cm, acct.id)).can.start).toBe(
      true,
    );
  });
});

describe("assignment instructions", () => {
  const body = (
    siteId: string,
    posts: { id: string }[],
    extra: Record<string, unknown> = {},
  ) => ({
    siteId,
    general:
      "Control the main gate, patrol every hour, keep the key and visitor logbooks (mock).",
    emergency: "Police 999, Bomba 994, client duty manager 03-1234 5678 (mock)",
    reporting:
      "Report to the site officer; incidents in the app within 15 minutes (mock).",
    posts: posts.map((p) => ({
      postId: p.id,
      duties: "Check every vehicle and visitor pass at this post (mock).",
    })),
    ...extra,
  });

  it("needs duties for every post; a material change asks the client to sign again, a small correction does not", async () => {
    const { svc, store, acct, ae } = await fresh();
    const siteId = acct.siteIds[0];
    const posts = await store.list("posts", { siteId });
    await expect(
      svc.clientQuality.instructionsAct(
        ae,
        "save",
        body(siteId, posts.slice(1)),
      ),
    ).rejects.toThrow(/duties for/);
    await svc.clientQuality.instructionsAct(ae, "save", body(siteId, posts));
    await expect(
      svc.clientQuality.instructionsAct(ae, "client_signed", {
        siteId,
        name: "Encik Pelanggan (mock)",
        role: "Facility manager",
        on: addDays(TODAY, 1),
        ref: "File 1",
      }),
    ).rejects.toThrow(/future/);
    await svc.clientQuality.instructionsAct(ae, "client_signed", {
      siteId,
      name: "Encik Pelanggan (mock)",
      role: "Facility manager",
      on: TODAY,
      ref: "File AI-1 (mock)",
    });
    let v = await svc.clientQuality.instructionsAct(
      ae,
      "save",
      body(siteId, posts, { material: false, note: "Typo" }),
    );
    expect(v.instructions!.version).toBe(2);
    expect(v.state.ok).toBe(true);
    v = await svc.clientQuality.instructionsAct(
      ae,
      "save",
      body(siteId, posts, {
        general:
          "Patrol every 30 minutes now, gate as before, logbooks as before (mock).",
      }),
    );
    expect(v.instructions!.version).toBe(3);
    expect(v.instructions!.clientSigned).toBeNull();
    expect(v.state.ok).toBe(false);
    expect(v.instructions!.history.length).toBe(2);
  });

  it("Operations writes them for its area; another company and guards cannot; guards read their own site on the Duty screen", async () => {
    const { svc, store, ds, acct } = await fresh();
    const om = await svc.user("u-om-klang");
    const siteId = acct.siteIds[0];
    const posts = await store.list("posts", { siteId });
    await svc.clientQuality.instructionsAct(om, "save", body(siteId, posts));
    await expect(
      svc.clientQuality.instructionsAct(
        await svc.user("u-cm-arsh"),
        "save",
        body(siteId, posts),
      ),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.clientQuality.instructionsAct(
        await svc.user("u-guard-sasa-1"),
        "save",
        body(siteId, posts),
      ),
    ).rejects.toThrow(/Not allowed/);
    // Guards do not see assignment instructions in Prima (Fauzan, 5 Nov 2026): officers brief them.
    await expect(
      svc.clientQuality.siteInstructions(
        await svc.user("u-guard-sasa-1"),
        siteId,
      ),
    ).rejects.toThrow(/Not allowed/);
  });

  it("review fixes: OMs outside the area are refused; the client cannot sign before the version was written", async () => {
    const { svc, store, acct, ae } = await fresh();
    const siteId = acct.siteIds[0];
    const posts = await store.list("posts", { siteId });
    const johor = await svc.user("u-om-johor");
    await expect(
      svc.clientQuality.instructionsAct(johor, "save", body(siteId, posts)),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.clientQuality.siteInstructions(johor, siteId),
    ).rejects.toThrow(/Not allowed/);
    await expect(svc.clientQuality.diligence(johor, acct.id)).rejects.toThrow(
      /Not allowed/,
    );
    await svc.clientQuality.instructionsAct(ae, "save", body(siteId, posts));
    await expect(
      svc.clientQuality.instructionsAct(ae, "client_signed", {
        siteId,
        name: "Encik Pelanggan (mock)",
        role: "Facility manager",
        on: addDays(TODAY, -3),
        ref: "File AI-1 (mock)",
      }),
    ).rejects.toThrow(/on or after/);
  });
});

describe("client due diligence review fixes", () => {
  it("an accepted client cannot be reopened until the review is near", async () => {
    const { svc, acct, cm, ae } = await fresh();
    await svc.clientQuality.diligenceAct(ae, "start", { accountId: acct.id });
    for (const kind of KINDS)
      await svc.clientQuality.diligenceAct(ae, "check", {
        accountId: acct.id,
        kind,
        status: "clear",
        ref: "REF (mock)",
      });
    await svc.clientQuality.diligenceAct(cm, "decide", {
      accountId: acct.id,
      result: "accepted",
      note: "All clear (mock)",
    });
    await expect(
      svc.clientQuality.diligenceAct(ae, "start", { accountId: acct.id }),
    ).rejects.toThrow(/next review is due/);
    expect((await svc.clientQuality.diligence(cm, acct.id)).can.start).toBe(
      false,
    );
  });
});
