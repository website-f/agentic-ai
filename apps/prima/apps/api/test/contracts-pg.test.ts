// Contracts and site mobilisation for real use against a real local PostgreSQL (5 Nov 2026): the signed paper, item
// proof, variations and renewals are written under row-level security, and another company stays out. Synthetic data only.
import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addDays } from "@prima/core";
import { Db } from "../src/db";
import { resetDb } from "../src/reset-db";

const URL = process.env.DATABASE_URL ?? "postgres://postgres:localdev@localhost:5432/prima_test";
process.env.DATABASE_URL = URL;
let n = 0;
const doc = (what: string) => {
  n += 1;
  return { kind: "document" as const, name: `${what} ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 synthetic ${what} ${n}`).toString("base64")}` };
};

describe("contracts in the database", () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it("records the signed paper and item proof inside the company wall, opens an expansion and moves the end date", async () => {
    const board = await db.asUser("u-cm-arsh", (svc, u) => svc.contracts(u));
    assert.ok(board.rows.every((r) => r.contract.companyId === "co-arsh"));
    const opt = board.canAdd[0];
    assert.equal(opt.companyId, "co-arsh");
    const client = opt.clients[0];
    const today = (await db.asUser("u-cm-arsh", (svc) => Promise.resolve(svc.today())));
    const c = await db.asUser("u-cm-arsh", (svc, u) =>
      svc.addContract(u, {
        companyId: "co-arsh",
        clientAccountId: client.id,
        clientName: "",
        siteIds: client.siteIds.slice(0, 1),
        startOn: addDays(today, 10),
        endOn: addDays(today, 740),
        billingMethod: "M1",
        rate: 11,
        fixedFee: null,
        signedRef: "SYN/ARSH/PG-1",
        paperKind: "loa",
        paymentDays: 45,
        proof: [doc("letter of award")],
      }),
    );
    assert.equal(c.paper?.kind, "loa");
    assert.equal(c.terms?.paymentDays, 45);

    // The admin executive marks an office item with proof; another company cannot touch or read it.
    const item = c.mobilisation.find((i) => i.owner === "company" && i.status === "open" && !i.auto)!;
    await assert.rejects(db.asUser("u-ae-arsh", (svc, u) => svc.setMobItem(u, c.id, item.id, "done", "")));
    await db.asUser("u-ae-arsh", (svc, u) => svc.setMobItem(u, c.id, item.id, "done", "Synthetic", null, [doc("stamp duty")]));
    await assert.rejects(db.asUser("u-cm-sasa", (svc, u) => svc.setMobItem(u, c.id, item.id, "open", "Intruder")));
    await assert.rejects(db.asUser("u-cm-sasa", (svc, u) => svc.contractProof(u, c.id)));
    const proof = await db.asUser("u-coo", (svc, u) => svc.contractProof(u, c.id));
    assert.equal(proof.docs.length, 2);
    // Group leadership watches only.
    await assert.rejects(db.asUser("u-coo", (svc, u) => svc.setMobItem(u, c.id, item.id, "open", "Monitor writes")));

    // A live contract: a variation adding a site opens an expansion round; a signed renewal moves the end date.
    const live = board.rows.find((r) => r.contract.state === "active" && r.client)!;
    const extra = opt.sites.find((s) => !live.contract.siteIds.includes(s.id))!;
    const last = live.contract.versions[live.contract.versions.length - 1];
    const v = await db.asUser("u-cm-arsh", (svc, u) =>
      svc.addContractVariation(u, live.contract.id, {
        effectiveFrom: addDays(today, 14),
        billingMethod: last.billingMethod,
        posts: last.posts,
        fixedFee: last.fixedFee,
        signedRef: "SYN/ARSH/VAR-PG",
        reason: "Synthetic: second building",
        addSiteIds: [extra.id],
        proof: [doc("variation")],
      }),
    );
    assert.equal(v.rounds?.length, 1);
    assert.ok(v.mobilisation.some((i) => i.round === 2));
    const r = await db.asUser("u-cm-arsh", (svc, u) =>
      svc.renewContract(u, live.contract.id, { newEndOn: addDays(live.contract.endOn, 365), signedRef: "SYN/ARSH/REN-PG", proof: [doc("renewal")] }),
    );
    assert.equal(r.endOn, addDays(live.contract.endOn, 365));
    const file = await db.asUser("u-cm-arsh", (svc, u) => svc.crmClient(u, live.client!.id));
    assert.ok(file.account.contractEndsOn! >= r.endOn);
    assert.ok(file.contracts.some((k) => k.id === live.contract.id && k.openExpansions === 1));
  });

  it("reads a paper for the company manager only and keeps no words of it", async () => {
    const text = "SYNTHETIC SECURITY SERVICES AGREEMENT. Contract No: SYN/ARSH/READ-1. This Agreement commences on 1 January 2027 and ends on 31 December 2028. Payment shall be made within 45 days of the invoice.";
    const r = await db.asUser("u-cm-arsh", (svc, u) => svc.readContractPaper(u, { companyId: "co-arsh", text }));
    assert.equal(r.values.find((v) => v.field === "startOn")?.value, "2027-01-01");
    assert.equal(r.online, "off");
    await assert.rejects(db.asUser("u-cm-sasa", (svc, u) => svc.readContractPaper(u, { companyId: "co-arsh", text })));
    await assert.rejects(db.asUser("u-coo", (svc, u) => svc.readContractPaper(u, { companyId: "co-arsh", text })));
    const rows = await db.pool.query("SELECT data->>'summary' AS summary FROM prima.audit WHERE data->>'action' = 'contract.paper_read'");
    assert.equal(rows.rowCount, 1);
    assert.doesNotMatch(rows.rows[0].summary, /READ-1|commences/);
  });
});
