// Client due diligence and assignment instructions (PIKM/ISO review, Fauzan 5 Nov 2026) against PostgreSQL with
// row-level security: the company keeps them on its own client and site rows; another company cannot read or change
// them; a guard reads only the instructions for the site they are rostered at. Uses the throwaway local database.
import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Db } from "../src/db";
import { resetDb } from "../src/reset-db";

const URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:localdev@localhost:5432/prima_test";
process.env.DATABASE_URL = URL;

describe("client due diligence and assignment instructions (database)", () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it("the company manager works and decides due diligence on its own client; another company is refused", async () => {
    const acctId = await db.asUser("u-cm-sasa", async (svc, u) => {
      for (const a of (await svc.clientBoard(u)).accounts.filter(
        (x) => x.companyId === "co-sasa",
      ))
        if (!(await svc.clientQuality.diligence(u, a.id)).diligence)
          return a.id;
      throw new Error("no Sasa client without due diligence in the seed");
    });
    await db.asUser("u-cm-sasa", (svc, u) =>
      svc.clientQuality.diligenceAct(u, "start", { accountId: acctId }),
    );
    for (const kind of [
      "identity",
      "authority",
      "purpose",
      "credit",
      "conflict",
      "site_risk",
      "pdpa",
    ])
      await db.asUser("u-cm-sasa", (svc, u) =>
        svc.clientQuality.diligenceAct(u, "check", {
          accountId: acctId,
          kind,
          status: "clear",
          ref: `REF-${kind} (mock)`,
        }),
      );
    const done = await db.asUser("u-cm-sasa", (svc, u) =>
      svc.clientQuality.diligenceAct(u, "decide", {
        accountId: acctId,
        result: "accepted",
        note: "All checks clear (mock)",
      }),
    );
    assert.equal(done.role, "decide");
    assert.equal(done.state.ok, true);
    await assert.rejects(
      db.asUser("u-cm-arsh", (svc, u) =>
        svc.clientQuality.diligence(u, acctId),
      ),
    );
    await assert.rejects(
      db.asUser("u-cm-arsh", (svc, u) =>
        svc.clientQuality.diligenceAct(u, "start", { accountId: acctId }),
      ),
    );
  });

  it("operations reads the seeded site instructions; guards and another company cannot", async () => {
    const siteId = "st-sasa-002";
    await assert.rejects(
      db.asUser("u-guard-sasa-1", (svc, u) =>
        svc.clientQuality.siteInstructions(u, siteId),
      ),
      "guards do not see assignment instructions in Prima",
    );
    const v = await db.asUser("u-om-klang", (svc, u) =>
      svc.clientQuality.siteInstructions(u, siteId),
    );
    assert.equal(v.state.ok, true);
    await assert.rejects(
      db.asUser("u-cm-arsh", (svc, u) =>
        svc.clientQuality.siteInstructions(u, siteId),
      ),
    );
    await assert.rejects(
      db.asUser("u-guard-sasa-1", (svc, u) =>
        svc.clientQuality.instructionsAct(u, "save", {
          siteId,
          general: "x".repeat(30),
          emergency: "x".repeat(20),
          reporting: "x".repeat(20),
        }),
      ),
    );
    const posts = v.posts.map((p) => ({
      postId: p.id,
      duties: "Check every vehicle at this post (mock).",
    }));
    const next = await db.asUser("u-om-klang", (svc, u) =>
      svc.clientQuality.instructionsAct(u, "save", {
        siteId,
        general: "Patrol every 30 minutes, gate and logbooks as before (mock).",
        emergency: v.instructions!.emergency,
        reporting: v.instructions!.reporting,
        posts,
      }),
    );
    assert.equal(next.instructions!.version, 2);
    assert.equal(
      next.state.ok,
      false,
      "a material change waits for the client to sign again",
    );
  });
});
