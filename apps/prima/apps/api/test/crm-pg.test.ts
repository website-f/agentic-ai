// Client CRM against a real local PostgreSQL (Fauzan, 4 Nov 2026: "We want complete"): contacts, requests and
// renewals are written under row-level security, and another company stays out. Synthetic data only.
import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Db } from "../src/db";
import { resetDb } from "../src/reset-db";

const URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:localdev@localhost:5432/prima_test";
process.env.DATABASE_URL = URL;

describe("client CRM in the database", () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it("keeps the company wall, records contacts and requests, and lets only the company manager decide a renewal", async () => {
    const board = await db.asUser("u-cm-arsh", (svc, u) => svc.crmBoard(u));
    assert.ok(board.clients.length > 0);
    assert.ok(board.clients.every((c) => c.companyId === "co-arsh"));
    assert.equal(board.group, null);
    const acct = board.clients.find(
      (c) => c.stage === "active" || c.stage === "renewal",
    )!;
    assert.ok(acct);

    await db.asUser("u-ae-arsh", (svc, u) =>
      svc.addClientPerson(u, acct.id, {
        name: "Synthetic Contact PG",
        position: "Facility Manager",
        role: "site",
        phone: "03-0000 9999",
        email: "",
        main: true,
      }),
    );
    await db.asUser("u-ae-arsh", (svc, u) =>
      svc.addClientRequest(u, acct.id, {
        kind: "temporary",
        what: "Synthetic: two guards for an open day",
        from: "Synthetic Contact PG",
        neededBy: null,
      }),
    );
    const file = await db.asUser("u-cm-arsh", (svc, u) =>
      svc.crmClient(u, acct.id),
    );
    assert.ok(
      file.people.some((p) => p.name === "Synthetic Contact PG" && p.main),
    );
    assert.ok(
      file.requests.some((q) => q.what.startsWith("Synthetic: two guards")),
    );

    // Another company's manager and admin cannot read or write this client.
    await assert.rejects(
      db.asUser("u-cm-sasa", (svc, u) => svc.crmClient(u, acct.id)),
    );
    await assert.rejects(
      db.asUser("u-cm-sasa", (svc, u) =>
        svc.addClientPerson(u, acct.id, {
          name: "Intruder",
          position: "X",
          role: "other",
          phone: "03-0000 0000",
          email: "",
          main: false,
        }),
      ),
    );
    // Group leadership sees it and the group view, but monitors only.
    const coo = await db.asUser("u-coo", (svc, u) => svc.crmBoard(u));
    assert.ok(coo.clients.some((c) => c.id === acct.id));
    assert.ok(coo.group);
    await assert.rejects(
      db.asUser("u-coo", (svc, u) =>
        svc.addClientRequest(u, acct.id, {
          kind: "other",
          what: "Monitor writes",
          from: "Nobody",
          neededBy: null,
        }),
      ),
    );

    // A renewal in its window: the admin executive cannot decide; the company manager can.
    const due = board.renewals.find(
      (r) => !r.renewalDecision && r.renewal && r.renewal.daysLeft >= 0,
    );
    assert.ok(due, "a seeded Arrow Shield renewal is waiting for a decision");
    {
      await assert.rejects(
        db.asUser("u-ae-arsh", (svc, u) =>
          svc.decideClientRenewal(u, due.id, {
            choice: "renew",
            pricePct: 0,
            reason: "Synthetic",
          }),
        ),
      );
      const r = await db.asUser("u-cm-arsh", (svc, u) =>
        svc.decideClientRenewal(u, due.id, {
          choice: "renew",
          pricePct: 0,
          reason: "Synthetic: good service",
        }),
      );
      assert.equal(r.renewal?.decision?.choice, "renew");
    }
  });
});
