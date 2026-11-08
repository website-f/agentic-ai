// Quality and compliance against a real local PostgreSQL (Fauzan, 5 Nov 2026). Proves the screens stay off until the
// reviewed module is installed, that a fresh install starts empty and loads the starter lists through the app, and that
// the company wall holds in the database for the per-company tables. Synthetic data only; throwaway local database.
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
    "quality-compliance-v1.sql",
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
async function asApp(companyIds: string, sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE prima_app");
    await c.query(`SELECT set_config('app.company_ids', $1, true)`, [
      companyIds,
    ]);
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

describe("quality and compliance in PostgreSQL", () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it("stays switched off until the reviewed module is installed, and home still loads", async () => {
    await assert.rejects(
      db.asUser("u-audit", (svc, u) => svc.quality.register(u)),
      /not switched on yet/,
    );
    await assert.rejects(
      db.asUser("u-cm-sasa", (svc, u) => svc.quality.matrix(u)),
      /not switched on yet/,
    );
    const items = await db.asUser("u-audit", (svc, u) =>
      svc.quality.homeItems(u),
    );
    assert.deepEqual(items, []);
  });

  it("after install: ACT loads the starter list, HR proposes profiles, the HR Director approves, and staff are assessed", async () => {
    await owner(MODULE);
    const empty = await db.asUser("u-audit", (svc, u) =>
      svc.quality.register(u),
    );
    assert.equal(empty.rows.length, 0);
    const loaded = (await db.asUser("u-audit", (svc, u) =>
      svc.quality.act(u, "loadStarter", {}),
    )) as { added: number };
    assert.ok(loaded.added > 30);
    const again = (await db.asUser("u-audit", (svc, u) =>
      svc.quality.act(u, "loadStarter", {}),
    )) as { added: number };
    assert.equal(again.added, 0);
    // The company manager reads the same group list (group table) for their own company only.
    const cm = await db.asUser("u-cm-sasa", (svc, u) =>
      svc.quality.register(u),
    );
    assert.equal(cm.rows.length, loaded.added);
    assert.deepEqual(
      cm.companies.map((c) => c.id),
      ["co-sasa"],
    );
    await db.asUser("u-cm-sasa", (svc, u) =>
      svc.quality.act(u, "linkEvidence", {
        requirementId: "qr-iso9001-8-4",
        companyId: "co-sasa",
        kind: "prima_record",
        label: "Supplier review 2026 (mock)",
        ref: "PUR-2026",
      }),
    );
    await db.asUser("u-cm-arsh", (svc, u) =>
      svc.quality.act(u, "linkEvidence", {
        requirementId: "qr-iso9001-8-4",
        companyId: "co-arsh",
        kind: "prima_record",
        label: "Supplier review 2026 (mock)",
        ref: "PUR-2026",
      }),
    );
    const sasa = await db.asUser("u-cm-sasa", (svc, u) =>
      svc.quality.register(u),
    );
    assert.equal(
      sasa.rows.find((r) => r.requirement.id === "qr-iso9001-8-4")!.state,
      "not_checked",
    );
    await db.asUser("u-audit", (svc, u) =>
      svc.quality.act(u, "checkEvidence", {
        requirementId: "qr-iso9001-8-4",
        companyId: "co-sasa",
        evidenceId: sasa.rows.find(
          (r) => r.requirement.id === "qr-iso9001-8-4",
        )!.entry!.evidence[0].id,
        ok: true,
        note: "Supplier file matches (mock)",
      }),
    );

    await db.asUser("u-pwvsb-hr", (svc, u) =>
      svc.quality.act(u, "loadStarter", {}),
    );
    const proposed = await db.asUser("u-cos", (svc, u) =>
      svc.quality.matrix(u, { companyId: "co-sasa" }),
    );
    assert.ok(proposed.profiles.every((p) => p.status === "proposed"));
    for (const p of proposed.profiles)
      await db.asUser("u-cos", (svc, u) =>
        svc.quality.act(u, "decideProfile", {
          id: p.id,
          agree: true,
          note: "Starting point agreed (mock)",
        }),
      );
    const m = await db.asUser("u-sv-sasa", (svc, u) => svc.quality.matrix(u));
    const g = m.rows.find((r) => r.canAssess)!;
    await db.asUser("u-sv-sasa", (svc, u) =>
      svc.quality.act(u, "assess", {
        personId: g.person.id,
        itemId: "g-post",
        result: "competent",
        method: "observation",
        note: "Knows the post orders (mock)",
      }),
    );
    // Foundation: ACT drafts the scope, the CEO agrees it.
    const scope = (await db.asUser("u-audit", (svc, u) =>
      svc.quality.act(u, "saveFoundation", {
        kind: "scope",
        title: "Scope (mock)",
        body: "Guarding, patrol and CMS of the group companies (mock text).",
      }),
    )) as { id: string };
    await db.asUser("u-fauzan", (svc, u) =>
      svc.quality.act(u, "decideFoundation", {
        id: scope.id,
        agree: true,
        note: "Agreed (mock)",
      }),
    );
    const fnd = await db.asUser("u-cm-sasa", (svc, u) =>
      svc.quality.foundation(u),
    );
    assert.equal(fnd.kpis.scopeApproved, true);
    const audit = await owner(
      `SELECT count(*)::int AS n FROM prima.audit WHERE data->>'action' LIKE 'quality.%'`,
    );
    assert.ok(audit.rows[0].n >= 8);
  });

  it("the database wall holds for the app role on the company tables, with no delete anywhere", async () => {
    const rows = await asApp(
      "co-sasa",
      "SELECT company_id FROM prima.qms_entries",
    );
    assert.deepEqual(
      [...new Set(rows.rows.map((r) => r.company_id))],
      ["co-sasa"],
    );
    const ca = await asApp(
      "co-arsh",
      "SELECT company_id FROM prima.comp_assessments",
    );
    assert.equal(ca.rows.length, 0);
    for (const t of [
      "qms_entries",
      "comp_assessments",
      "qms_nonconformities",
    ]) {
      await assert.rejects(
        asApp(
          "co-sasa",
          `INSERT INTO prima.${t} (id, company_id, data) VALUES ('x-${t}', 'co-arsh', '{"id":"x-${t}","companyId":"co-arsh"}')`,
        ),
        /row-level security/,
      );
    }
    for (const t of [
      "qms_requirements",
      "qms_entries",
      "qms_foundation",
      "comp_profiles",
      "comp_assessments",
      "qms_items",
      "qms_nonconformities",
    ])
      await assert.rejects(
        asApp("co-sasa", `DELETE FROM prima.${t}`),
        /permission denied/,
      );
  });

  it("quality operations: faults, root cause, supplier rating, documents and review work through the app role", async () => {
    const sites = await owner(
      `SELECT id FROM prima.sites WHERE company_id = 'co-sasa' ORDER BY id LIMIT 1`,
    );
    const siteId = sites.rows[0].id as string;
    const rec = (what: string) =>
      db.asUser("u-cm-sasa", (svc, u) =>
        svc.qualityOps.act(u, "recordFault", {
          companyId: "co-sasa",
          siteId,
          source: "client_complaint",
          what,
          correction: "Relief guard sent (mock)",
          clientTold: true,
          clientNote: "Phoned (mock)",
        }),
      ) as Promise<{ id: string; repeatOf: string[]; ref: string }>;
    const a = await rec("Post left empty at shift change (mock)");
    const b = await rec("Post left empty again at shift change (mock)");
    assert.equal(a.repeatOf.length, 0);
    assert.deepEqual(b.repeatOf, [a.id]);
    assert.notEqual(a.ref, b.ref);
    await assert.rejects(
      db.asUser("u-cm-arsh", (svc, u) =>
        svc.qualityOps.act(u, "closeFault", {
          id: b.id,
          outcome: "corrected",
          note: "done (mock)",
        }),
      ),
    );
    const r = (await db.asUser("u-audit", (svc, u) =>
      svc.qualityOps.act(u, "rootCause", {
        id: b.id,
        ownerUserId: "u-cm-sasa",
        area: "PATROL",
      }),
    )) as { finding: { id: string; origin?: string } };
    assert.equal(r.finding.origin, "quality");
    await assert.rejects(
      db.asUser("u-cm-sasa", (svc, u) =>
        svc.actFindingStep(u, r.finding.id, "plan", {
          rootCause: "Handover (mock)",
          solution: "At the post (mock)",
          targetOn: "2026-12-01",
        }),
      ),
      /meanwhile/,
    );
    await db.asUser("u-cm-sasa", (svc, u) =>
      svc.actFindingStep(u, r.finding.id, "plan", {
        rootCause: "Handover (mock)",
        solution: "At the post (mock)",
        targetOn: "2026-12-01",
        containment: "Officer watches (mock)",
        similarWhere: "Other night sites (mock)",
        effectiveWhen: "No empty post for 60 days (mock)",
      }),
    );
    await db.asUser("u-cm-sasa", (svc, u) =>
      svc.qualityOps.act(u, "closeFault", {
        id: b.id,
        outcome: "corrected",
        note: "New guard on the post (mock)",
      }),
    );
    const cm = await db.asUser("u-cm-sasa", (svc, u) =>
      svc.qualityOps.board(u),
    );
    assert.ok(cm.faults.every((f) => f.nc.companyId === "co-sasa"));
    const arsh = await db.asUser("u-cm-arsh", (svc, u) =>
      svc.qualityOps.board(u),
    );
    assert.equal(arsh.faults.length, 0);

    const sup = await owner(
      `SELECT id FROM prima.pur_suppliers WHERE company_id = 'co-sasa' AND data->'blocked' = 'null'::jsonb ORDER BY id LIMIT 1`,
    );
    if (sup.rows[0]) {
      const supplierId = sup.rows[0].id as string;
      const rated = (await db.asUser("u-proc-exec", (svc, u) =>
        svc.qualityOps.act(u, "rateSupplier", {
          id: supplierId,
          quality: 1,
          onTime: 2,
          paperwork: 3,
          result: "stop",
          issues: "Wrong items twice (mock)",
        }),
      )) as { blocked: { note: string } | null };
      assert.match(rated.blocked!.note, /Stopped after performance rating/);
    }

    const d = (await db.asUser("u-audit", (svc, u) =>
      svc.qualityOps.act(u, "saveItem", {
        kind: "document",
        title: "Shift handover (mock)",
        code: "SOP-OPS-01",
        ownerTitle: "COO",
        link: "https://example.invalid/sop.docx",
      }),
    )) as { id: string };
    await assert.rejects(
      db.asUser("u-audit", (svc, u) =>
        svc.qualityOps.act(u, "decideItem", {
          id: d.id,
          agree: true,
          note: "ok (mock)",
        }),
      ),
      /Another person/,
    );
    await db.asUser("u-cos", (svc, u) =>
      svc.qualityOps.act(u, "decideItem", {
        id: d.id,
        agree: true,
        note: "Matches the sites (mock)",
      }),
    );
    const v2 = (await db.asUser("u-cos", (svc, u) =>
      svc.qualityOps.act(u, "saveItem", {
        id: d.id,
        kind: "document",
        title: "Shift handover (mock)",
        code: "SOP-OPS-01",
        ownerTitle: "COO",
        note: "At the post (mock)",
      }),
    )) as { id: string; version: number };
    assert.equal(v2.version, 2);
    const rv = (await db.asUser("u-audit", (svc, u) =>
      svc.qualityOps.act(u, "saveItem", {
        kind: "review",
        title: "Review (mock)",
        heldOn: "2026-11-04",
        attendees: "CEO, COO, ACT (mock)",
        decisions: [
          {
            text: "Fix handovers (mock)",
            ownerTitle: "COO",
            dueOn: "2026-12-31",
          },
        ],
      }),
    )) as { id: string; inputs: { label: string; value: string }[] };
    assert.ok(
      rv.inputs.some(
        (i) =>
          i.label === "Service faults (12 months)" &&
          /2 recorded/.test(i.value),
      ),
    );
    await db.asUser("u-fauzan", (svc, u) =>
      svc.qualityOps.act(u, "decideItem", {
        id: rv.id,
        agree: true,
        note: "Record agreed (mock)",
      }),
    );
    const docs = await db.asUser("u-cm-sasa", (svc, u) =>
      svc.qualityOps.board(u),
    );
    assert.ok(
      docs.items.every(
        (i) => i.item.kind !== "review" && i.item.status !== "draft",
      ),
    );
  });
});
