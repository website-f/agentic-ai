// Governance registers against a real local PostgreSQL (Fauzan, 5 Nov 2026). Proves the screen stays off until the
// reviewed module is installed, that the company wall holds for the five new tables, and that the department walls
// keep deals and declarations to the Deputy Chief of Staff, Chief of Staff and CEO, and risks to ACT and the CEO.
// Synthetic data only; the database is a throwaway local one that the test resets.
import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { Db } from "../src/db";
import { resetDb } from "../src/reset-db";

const URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:localdev@localhost:5432/prima_test";
process.env.DATABASE_URL = URL;
const MODULE = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "db",
    "modules",
    "governance-registers-v1.sql",
  ),
  "utf8",
);

async function owner(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}
async function asApp(
  companyIds: string,
  sql: string,
  params: unknown[] = [],
  walls = "reg_desk,reg_risk",
) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE prima_app");
    await c.query(
      `SELECT set_config('app.company_ids', $1, true), set_config('app.walls', $2, true)`,
      [companyIds, walls],
    );
    const res = await c.query(sql, params);
    await c.query("COMMIT");
    return res;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}
const deal = (companyId: string, counterparty: string) => ({
  companyId,
  counterparty,
  party: "director_company",
  relationship: "Owned by a director (mock)",
  nature: "rent",
  amount: 12000,
  startOn: "2026-11-01",
  fairPriceBasis: "Two valuer letters on market rent (mock)",
});

describe("governance registers in PostgreSQL", () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it("stays switched off until the reviewed module is installed", async () => {
    await assert.rejects(
      db.asUser("u-cm-sasa", (svc, u) => svc.registers.board(u)),
      /not switched on yet/,
    );
    await assert.rejects(
      db.asUser("u-dcos", (svc, u) =>
        svc.registers.act(
          u,
          "addDeal",
          deal("co-sasa", "Before install (mock)"),
        ),
      ),
      /not switched on yet/,
    );
    // Home still loads; the registers just add nothing.
    const items = await db.asUser("u-cm-sasa", (svc, u) =>
      svc.registers.homeItems(u),
    );
    assert.deepEqual(items, []);
  });

  it("after install, the Deputy Chief of Staff records, the Chief of Staff reviews, and others see no deals", async () => {
    await owner(MODULE);
    await db.asUser("u-dcos", (svc, u) =>
      svc.registers.act(u, "addDeal", deal("co-sasa", "Sasa landlord (mock)")),
    );
    await db.asUser("u-dcos", (svc, u) =>
      svc.registers.act(u, "addDeal", deal("pwvsb", "PWVSB related (mock)")),
    );
    await assert.rejects(
      db.asUser("u-cm-sasa", (svc, u) =>
        svc.registers.act(u, "addDeal", deal("co-sasa", "Manager try (mock)")),
      ),
      /Not allowed/,
    );
    const cos = await db.asUser("u-cos", (svc, u) => svc.registers.board(u));
    const seen = cos.deals!.rows.map((d) => d.deal.counterparty).sort();
    assert.deepEqual(seen, ["PWVSB related (mock)", "Sasa landlord (mock)"]);
    const one = cos.deals!.rows.find((d) => d.deal.companyId === "pwvsb")!;
    const done = await db.asUser("u-cos", (svc, u) =>
      svc.registers.act(u, "reviewDeal", {
        id: one.deal.id,
        agree: true,
        note: "Fair, group rate (mock)",
      }),
    );
    assert.equal((done as { status: string }).status, "done");
    // A company manager and the COO get no deals or declarations section at all.
    const cm = await db.asUser("u-cm-sasa", (svc, u) => svc.registers.board(u));
    assert.equal(cm.deals, null);
    assert.equal(cm.interests, null);
    assert.equal(cm.risks, null);
    const coo = await db.asUser("u-coo", (svc, u) => svc.registers.board(u));
    assert.equal(coo.deals, null);
    // Risks: the ACT Director adds one; the Chief of Staff has no risk section.
    await db.asUser("u-audit", (svc, u) =>
      svc.registers.act(u, "addRisk", {
        companyId: "co-sasa",
        title: "Big client leaves (mock)",
        category: "strategic",
        ownerName: "Company Manager",
        likelihood: 2,
        impact: 3,
        controls: "Monthly client meeting",
      }),
    );
    assert.equal(cos.risks, null);
    const act = await db.asUser("u-audit", (svc, u) => svc.registers.board(u));
    assert.equal(act.risks!.rows.length, 1);
    const audit = await owner(
      `SELECT count(*)::int AS n FROM prima.audit WHERE data->>'action' LIKE 'register.%'`,
    );
    assert.equal(audit.rows[0].n, 4);
  });

  it("the database walls hold for the app role on all five tables, with no delete", async () => {
    const rows = await asApp(
      "co-sasa",
      "SELECT company_id FROM prima.reg_related_parties",
    );
    assert.deepEqual(
      rows.rows.map((r) => r.company_id),
      ["co-sasa"],
    );
    for (const t of [
      "reg_related_parties",
      "reg_interests",
      "reg_committees",
      "reg_risks",
      "reg_settings",
    ]) {
      await assert.rejects(
        asApp(
          "co-sasa",
          `INSERT INTO prima.${t} (id, company_id, data) VALUES ('x-${t}', 'co-arsh', '{"id":"x-${t}","companyId":"co-arsh"}')`,
        ),
        /row-level security/,
      );
      await assert.rejects(
        asApp("co-sasa", `DELETE FROM prima.${t}`),
        /permission denied/,
      );
    }
    // Without the desk wall, deals are invisible even inside the company; without the ACT wall, risks are.
    const noDesk = await asApp(
      "co-sasa,pwvsb",
      "SELECT id FROM prima.reg_related_parties",
      [],
      "reg_risk",
    );
    assert.equal(noDesk.rowCount, 0);
    const noRisk = await asApp(
      "co-sasa,pwvsb",
      "SELECT id FROM prima.reg_risks",
      [],
      "reg_desk",
    );
    assert.equal(noRisk.rowCount, 0);
    const withRisk = await asApp(
      "co-sasa,pwvsb",
      "SELECT id FROM prima.reg_risks",
      [],
      "reg_risk",
    );
    assert.equal(withRisk.rowCount, 1);
    await assert.rejects(
      asApp(
        "co-sasa",
        `INSERT INTO prima.reg_related_parties (id, company_id, data) VALUES ('x-nd', 'co-sasa', '{"id":"x-nd","companyId":"co-sasa"}')`,
        [],
        "reg_risk",
      ),
      /row-level security/,
    );
  });
});
