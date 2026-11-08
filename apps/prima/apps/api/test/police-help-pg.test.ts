// Police call or visit help against a real local PostgreSQL (Fauzan, 3 Nov 2026): the company asks, Arms Control
// assigns and records with proof, the company confirms; the company wall holds in the database. Synthetic data only.
import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Db } from "../src/db";
import { resetDb } from "../src/reset-db";

const URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:localdev@localhost:5432/prima_test";
process.env.DATABASE_URL = URL;

const pdf = (name: string) => ({
  kind: "document" as const,
  name,
  data: `data:application/pdf;base64,${Buffer.from(`%PDF ${name} ${Date.now()}`).toString("base64")}`,
});

describe("police help in the database", () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it("runs ask, assign, outcome and confirm under row-level security, and keeps other companies out", async () => {
    const asked = await db.asUser("u-ae-arsh", (svc, u) =>
      svc.askPoliceHelp(u, {
        companyId: "co-arsh",
        kind: "PHONE_CALL",
        reason: "ARMOURY_CHECK",
        policeUnit: "Synthetic test station",
        asked: "Synthetic: police want to check the armoury register.",
        contactName: "Synthetic Admin",
        contactPhone: "03-1234 5678",
      }),
    );
    assert.equal(asked.policeHelp?.step, "asked");
    // Another company's manager cannot see or act on it: the row is outside their wall.
    const other = await db.asUser("u-cm-sasa", (svc, u) => svc.policeHelp(u));
    assert.equal(
      other.rows.some((r) => r.id === asked.id),
      false,
    );
    await assert.rejects(
      db.asUser("u-cm-sasa", (svc, u) =>
        svc.withdrawPoliceHelp(u, asked.id, "not mine"),
      ),
    );
    // Company staff cannot assign.
    await assert.rejects(
      db.asUser("u-ae-arsh", (svc, u) =>
        svc.assignPoliceHelp(u, asked.id, {
          name: "Me",
          phone: "012-111 2222",
          how: "PHONE",
        }),
      ),
      /Not allowed/,
    );

    await db.asUser("u-pwvsb-arms", (svc, u) =>
      svc.assignPoliceHelp(u, asked.id, {
        name: "Synthetic Helper",
        phone: "012-111 2222",
        how: "PHONE",
      }),
    );
    const helped = await db.asUser("u-pwvsb-arms", (svc, u) =>
      svc.recordPoliceHelpOutcome(u, asked.id, {
        note: "Synthetic: called the officer back.",
        proof: [pdf("note.pdf")],
      }),
    );
    assert.equal(helped.policeHelp?.step, "helped");
    await assert.rejects(
      db.asUser("u-pwvsb-arms", (svc, u) =>
        svc.answerPoliceHelp(u, asked.id, "confirm", "self"),
      ),
      /Not allowed/,
    );
    const done = await db.asUser("u-cm-arsh", (svc, u) =>
      svc.answerPoliceHelp(u, asked.id, "confirm", "Synthetic: help received."),
    );
    assert.equal(done.policeHelp?.step, "confirmed");
    assert.equal(done.status, "closed");

    // CMS sees it read-only.
    const cms = await db.asUser("u-cms-head", (svc, u) => svc.policeHelp(u));
    assert.equal(cms.role, "monitor");
    const row = cms.rows.find((r) => r.id === asked.id);
    if (row)
      assert.deepEqual(row.can, {
        assign: false,
        outcome: false,
        confirm: false,
        withdraw: false,
      });
  });
});
