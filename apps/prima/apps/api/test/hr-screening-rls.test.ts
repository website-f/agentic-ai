// Screening case files and the guard code of conduct (PIKM/ISO review, Fauzan 5 Nov 2026), proved in the database:
// screening rows sit behind the company wall plus the 'hr_cases' wall (ACT reads through 'act'); briefing
// acknowledgements go through the normal policy_acks wall. Uses the throwaway local database and resets it. Mock data only.
import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import type { ScreeningCase } from "@prima/core";
import { Db } from "../src/db";
import { resetDb } from "../src/reset-db";

const URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:localdev@localhost:5432/prima_test";
process.env.DATABASE_URL = URL;

/** One statement as the API's runtime role with the given walls and the co-sasa company visible. */
async function asApp(walls: string, sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE prima_app");
    await c.query(`SELECT set_config('app.walls', $1, true)`, [walls]);
    await c.query(`SELECT set_config('app.company_ids', 'co-sasa', true)`);
    const res = await c.query(sql, params);
    await c.query("COMMIT");
    return res;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

describe("screening and guard code of conduct (database)", () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it("HR opens and works a case; the HR Director decides; company staff never see it; ACT reads only", async () => {
    const c = (await db.asUser("u-pwvsb-hr", (svc, u) =>
      svc.screening.act(u, "open", {
        subject: "director",
        companyId: "co-sasa",
        name: "Encik Pengarah Ujian (mock)",
        idMasked: "xxxxxx-xx-1234",
      }),
    )) as ScreeningCase;
    for (const kind of [
      "application",
      "interview",
      "consent",
      "identity",
      "kdn_vetting",
      "police",
      "bankruptcy",
      "company_search",
    ])
      await db.asUser("u-pwvsb-hr", (svc, u) =>
        svc.screening.act(u, "check", {
          id: c.id,
          kind,
          status: "clear",
          ref: `REF-${kind} (mock)`,
        }),
      );
    await assert.rejects(
      db.asUser("u-pwvsb-hr", (svc, u) =>
        svc.screening.act(u, "decide", {
          id: c.id,
          result: "cleared",
          note: "ok",
        }),
      ),
    );
    const d = (await db.asUser("u-dcos", (svc, u) =>
      svc.screening.act(u, "decide", {
        id: c.id,
        result: "cleared",
        note: "All checks clear (mock)",
      }),
    )) as ScreeningCase;
    assert.equal(d.status, "decided");

    await assert.rejects(
      db.asUser("u-cm-sasa", (svc, u) => svc.screening.board(u)),
    );
    const ceo = await db.asUser("u-fauzan", (svc, u) => svc.screening.board(u));
    assert.ok(ceo.rows.some((r) => r.case.id === c.id));
    const act = await db.asUser("u-audit", (svc, u) => svc.screening.board(u));
    assert.equal(act.role, "view");
    assert.ok(act.rows.some((r) => r.case.id === c.id));

    const n = async (walls: string) =>
      Number(
        (
          await asApp(
            walls,
            `SELECT count(*) AS n FROM prima.hr_screenings WHERE id = $1`,
            [c.id],
          )
        ).rows[0].n,
      );
    assert.equal(await n(""), 0, "the company itself does not see screening");
    assert.equal(await n("staff_company"), 0, "nor does its manager");
    assert.equal(await n("act"), 1, "ACT reads");
    assert.equal(await n("hr_cases"), 1, "HR reads");
    await assert.rejects(
      asApp(
        "act",
        `UPDATE prima.hr_screenings SET data = data || '{"status":"withdrawn"}' WHERE id = $1 RETURNING id`,
        [c.id],
      ).then((r) => assert.equal(r.rowCount, 1)),
      "ACT cannot change a case",
    );
    await assert.rejects(
      asApp(
        "act",
        `INSERT INTO prima.hr_screenings (id, company_id, data) VALUES ('scr-x', 'co-sasa', '{"id":"scr-x"}')`,
      ),
      "ACT cannot open a case",
    );
    await assert.rejects(
      asApp("hr_cases", `DELETE FROM prima.hr_screenings WHERE id = $1`, [
        c.id,
      ]),
      "nobody deletes a case",
    );
  });

  it("an officer records briefing acknowledgements for own guards, and the company cannot change the policy", async () => {
    const pol = (await db.asUser("u-pwvsb-hr", (svc, u) =>
      svc.publishPolicy(u, {
        id: null,
        kind: "code_of_conduct",
        title: "Guard code of conduct (mock)",
        body: "Be at your post on time and report every incident (mock text).",
        audience: "guards",
        copies: [{ lang: "ms" as const, title: "Salinan BM (mock)", body: "Teks dasar dalam Bahasa Melayu untuk ujian (mock).", translator: "HR (mock)" }],
      }),
    )) as { id: string };
    const board = await db.asUser("u-sv-sasa", (svc, u) => svc.hrPolicies(u));
    const row = board.rows.find((r) => r.id === pol.id)!;
    assert.ok(row.briefableCount > 0);
    const ids = row.briefable.slice(0, 3).map((x) => x.personId);
    const r = await db.asUser("u-sv-sasa", (svc, u) =>
      svc.recordBriefingAcks(
        u,
        pol.id,
        ids,
        "Night briefing 5 Nov, sheet 12 (mock)",
      ),
    );
    assert.equal(r.recorded, 3);
    const after = await db.asUser("u-sv-sasa", (svc, u) => svc.hrPolicies(u));
    assert.equal(
      after.rows.find((x) => x.id === pol.id)!.briefableCount,
      row.briefableCount - 3,
    );
    await assert.rejects(
      db.asUser("u-cm-sasa", (svc, u) =>
        svc.publishPolicy(u, {
          id: pol.id,
          kind: "code_of_conduct",
          title: "x",
          body: "Changed by the company (mock text).",
          audience: "guards",
          material: true,
        }),
      ),
    );
  });

  it('after a material change the guard and the officer record the new version over the old acknowledgement (review fix)', async () => {
    const pol = (await db.asUser('u-pwvsb-hr', (svc, u) =>
      svc.publishPolicy(u, { id: null, kind: 'code_of_conduct', title: 'Guard code v (mock)', body: 'Be at your post on time and report every incident (mock text).', audience: 'guards', copies: [{ lang: "ms" as const, title: "Salinan BM (mock)", body: "Teks dasar dalam Bahasa Melayu untuk ujian (mock).", translator: "HR (mock)" }] }),
    )) as { id: string };
    const other = (await db.asUser('u-sv-sasa', (svc, u) => svc.hrPolicies(u))).rows.find((r) => r.id === pol.id)!.briefable.find((x) => x.staffNo !== 'SASA0212')!;
    await db.asUser('u-guard-sasa-1', (svc, u) => svc.acknowledgePolicy(u, pol.id));
    await db.asUser('u-sv-sasa', (svc, u) => svc.recordBriefingAcks(u, pol.id, [other.personId], 'Sheet 1 (mock)'));
    await db.asUser('u-pwvsb-hr', (svc, u) =>
      svc.publishPolicy(u, { id: pol.id, kind: 'code_of_conduct', title: 'Guard code v (mock)', body: 'Be at your post on time, no phones at post, report incidents (mock text).', audience: 'guards', material: true, copies: [{ lang: "ms" as const, title: "Salinan BM (mock)", body: "Teks dasar dalam Bahasa Melayu untuk ujian (mock).", translator: "HR (mock)" }] }),
    );
    const again = await db.asUser('u-guard-sasa-1', (svc, u) => svc.acknowledgePolicy(u, pol.id));
    assert.equal(again.version, 2);
    const r = await db.asUser('u-sv-sasa', (svc, u) => svc.recordBriefingAcks(u, pol.id, [other.personId], 'Sheet 2 (mock)'));
    assert.equal(r.recorded, 1);
  });
});
