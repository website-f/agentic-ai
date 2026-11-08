// Cleaning plans, stock, fittings and duty plans against a real local PostgreSQL (Fauzan, 4 Nov 2026): before the
// optional module is applied nothing is read and every save is refused; after it, the OM works under row-level
// security and other companies stay out. Synthetic data only.
import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { kpmSchoolAreas, kpmSchoolStock, kpmWeek } from "@prima/core";
import { Db } from "../src/db";
import { resetDb } from "../src/reset-db";
import { cleaningOpsProblems } from "../src/cleaning-ops-readiness";

const URL = process.env.DATABASE_URL ?? "postgres://postgres:localdev@localhost:5432/prima_test";
process.env.DATABASE_URL = URL;
let n = 0;
const photo = () => ({ image: `data:image/png;base64,${Buffer.from(`synthetic ${++n} ${Date.now()}`).toString("base64")}`, stampedAt: "" });

describe("cleaning and duty plans in the database", () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it("refuses to save before the module is applied, then works under row-level security", async () => {
    const board0 = await db.asUser("u-om-klang", (svc, u) => svc.cleaning.board(u));
    assert.deepEqual(board0.rows, []);
    const site = board0.startable[0];
    assert.ok(site, "the OM has a site to start cleaning on");
    const facts = { acres: 2, blocks: 3, floors: 6, toiletCubicles: 12 };
    const stock = kpmSchoolStock();
    const setup = {
      template: "kpm_school" as const,
      contractRef: "SYNTHETIC",
      requiredHeadcount: 3,
      facts,
      week: kpmWeek("sat_sun"),
      secondSession: null,
      closedDays: [],
      cycleStart: "2026-11-02",
      monthlyWage: 1700,
      crew: [
        { id: "w1", name: "Synthetic supervisor", role: "supervisor" as const, session: 1 as const, personId: null },
        { id: "w2", name: "Synthetic cleaner 1", role: "cleaner" as const, session: 1 as const, personId: null },
        { id: "w3", name: "Synthetic cleaner 2", role: "cleaner" as const, session: 1 as const, personId: null },
      ],
      areas: kpmSchoolAreas(facts, false).map((a) => (a.id === "floors" ? { ...a, size: 1200 } : a)),
      equipment: stock.equipment,
      supplies: stock.supplies.map((s) => ({ ...s, perDay: 1 })),
    };
    await assert.rejects(db.asUser("u-om-klang", (svc, u) => svc.cleaning.saveSetup(u, site.siteId, setup, null)), /not installed/);

    const admin = new Client({ connectionString: URL });
    await admin.connect();
    const sql = readFileSync(join(__dirname, "../../../../db/modules/cleaning-ops-v1.sql"), "utf8");
    await admin.query(sql);
    await admin.query(sql); // repeat-safe
    assert.deepEqual(await cleaningOpsProblems(admin as never), []);
    await admin.end();

    const saved = await db.asUser("u-om-klang", (svc, u) => svc.cleaning.saveSetup(u, site.siteId, setup, null));
    assert.equal(saved.version, 1);
    const today = (await db.asUser("u-om-klang", (svc, u) => svc.cleaning.board(u))).today;
    const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
    if (wd !== 0) {
      const day = await db.asUser("u-om-klang", (svc, u) => svc.cleaning.makePlan(u, site.siteId, today, []));
      await db.asUser("u-om-klang", (svc, u) => svc.cleaning.publish(u, site.siteId, today));
      const w = day.tasks.find((t) => t.type === "work")!;
      await db.asUser("u-om-klang", (svc, u) => svc.cleaning.recordTasks(u, site.siteId, today, { taskIds: [w.id], action: "done", note: "", proof: null }));
      const now = new Date(Date.now() + 8 * 3600_000 - 60_000).toISOString().slice(0, 16);
      const p = { ...photo(), stampedAt: now };
      await db.asUser("u-om-klang", (svc, u) => svc.cleaning.recordTasks(u, site.siteId, today, { taskIds: [w.id], action: "checked", note: "ok", proof: p }));
      // Same photo again is refused by its fingerprint.
      await assert.rejects(db.asUser("u-om-klang", (svc, u) => svc.cleaning.stockCheck(u, site.siteId, { date: today, supplies: [{ supplyId: "bags", qty: 3 }], note: "", proof: p })), /already used/);
      await db.asUser("u-om-klang", (svc, u) => svc.cleaning.stockCheck(u, site.siteId, { date: today, supplies: [{ supplyId: "bags", qty: 3 }], note: "", proof: { ...photo(), stampedAt: now } }));
    }
    // The site's company manager sees it read-only; another company's manager sees nothing and cannot open it.
    const cm = await db.asUser("u-cm-arsh", (svc, u) => svc.cleaning.board(u));
    const own = site.companyName.startsWith("Arrow");
    if (own) assert.ok(cm.rows.some((r) => r.siteId === site.siteId && r.access === "view"));
    const other = own ? "u-cm-sasa" : "u-cm-arsh";
    assert.equal((await db.asUser(other, (svc, u) => svc.cleaning.board(u))).rows.some((r) => r.siteId === site.siteId), false);
    await assert.rejects(db.asUser(other, (svc, u) => svc.cleaning.site(u, site.siteId)));
    // Fittings and duty plan rows go through the same wall.
    await db.asUser("u-om-klang", (svc, u) => svc.cleaning.saveSiteKit(u, site.siteId, [{ id: "fan", name: "Fan", category: "fan_light", required: 1, owner: "company", note: "" }], null));
    const inv = await db.asUser("u-proc-exec", (svc, u) => svc.cleaning.inventoryBoard(u));
    assert.ok(inv.rows.some((r) => r.siteId === site.siteId));
    // Guard contract terms and a client slip go through the same wall.
    const terms = { contractRef: "SYNTHETIC", ratePerGuardHour: 12.61, shifts: [{ name: "Day", start: "08:00", end: "20:00", guards: 1 }], minCheckpoints: 4, officerVisitDays: 7, dailyReportBy: "09:00" };
    const t = await db.asUser("u-om-klang", (svc, u) => svc.duty.saveTerms(u, site.siteId, terms, null));
    assert.equal(t.id, `gterms-${site.siteId}`);
    assert.equal((await db.asUser("u-om-klang", (svc, u) => svc.duty.posts(u, site.siteId, today))).terms?.version, 1);
    await assert.rejects(db.asUser(other, (svc, u) => svc.duty.posts(u, site.siteId, today)));
    const slipData = `data:image/png;base64,${Buffer.from(`synthetic slip ${Date.now()}`).toString("base64")}`;
    const ack = await db.asUser("u-om-klang", (svc, u) =>
      svc.cleaning.recordClientAck(u, site.siteId, { signedOn: today, from: today, to: today, areaIds: [setup.areas[0].id], signer: "Synthetic clerk", outcome: "accepted", comment: "Done properly", action: "", slip: { name: "slip.png", data: slipData } }),
    );
    assert.equal(ack.kind, "client_ack");
    const officers = await db.asUser("u-om-klang", (svc, u) => svc.duty.officers(u));
    const o = officers.find((x) => x.access === "manage");
    if (o) {
      const pub = await db.asUser("u-om-klang", (svc, u) => svc.duty.publishRoute(u, o.id, today, null));
      assert.equal(pub.kind, "route");
    }
  });
});
