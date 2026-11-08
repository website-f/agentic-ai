// Policy languages and discipline appeals (IKEA IWAY finding, Fauzan 6 Nov 2026), proved in the database: translations,
// the signed language and the mother tongue save through the real walls; a guard appeals on their own sign-in; the
// HR Director or CEO decides; the company cannot. Uses the throwaway local database and resets it. Mock data only.
import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import type { AttendanceFollowUp, HrPolicy, Person, PolicyAck } from "@prima/core";
import { Db } from "../src/db";
import { resetDb } from "../src/reset-db";

const URL = process.env.DATABASE_URL ?? "postgres://postgres:localdev@localhost:5432/prima_test";
process.env.DATABASE_URL = URL;

const MS = { lang: "ms" as const, title: "Kod pengawal (mock)", body: "Berada di pos tepat pada masanya dan laporkan insiden (mock).", translator: "HR (mock)" };
const NE = { lang: "ne" as const, title: "गार्ड संहिता (mock)", body: "समयमै पोस्टमा पुग्नुहोस् र घटना रिपोर्ट गर्नुहोस् (mock).", translator: "Translator A (mock)" };

async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}

describe("policy languages and discipline appeals (database)", () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it("HR publishes English and Malay, adds Nepali, sets a mother tongue; the guard signs in Nepali", async () => {
    const pol = (await db.asUser("u-pwvsb-hr", (svc, u) =>
      svc.publishPolicy(u, { id: null, kind: "code_of_conduct", title: "Guard code (mock)", body: "Be at your post on time and report every incident (mock text).", audience: "guards", copies: [MS] }),
    )) as HrPolicy;
    await assert.rejects(db.asUser("u-cm-sasa", (svc, u) => svc.addPolicyCopy(u, pol.id, NE)));
    await db.asUser("u-pwvsb-hr", (svc, u) => svc.addPolicyCopy(u, pol.id, NE));
    const [{ data: saved }] = await sql<{ data: HrPolicy }>("SELECT data FROM prima.hr_policies WHERE id = $1", [pol.id]);
    assert.deepEqual(saved.copies!.map((c) => c.lang).sort(), ["ms", "ne"]);

    const guardPerson = (await sql<{ data: Person }>("SELECT p.data FROM prima.people p JOIN prima.users u ON u.data->>'personId' = p.id WHERE u.id = 'u-guard-sasa-1'"))[0].data;
    await assert.rejects(db.asUser("u-cm-sasa", (svc, u) => svc.setMotherTongue(u, guardPerson.id, "ne")));
    await db.asUser("u-pwvsb-hr", (svc, u) => svc.setMotherTongue(u, guardPerson.id, "ne"));
    const [{ data: p2 }] = await sql<{ data: Person }>("SELECT data FROM prima.people WHERE id = $1", [guardPerson.id]);
    assert.equal(p2.motherTongue, "ne");

    const ack = (await db.asUser("u-guard-sasa-1", (svc, u) => svc.acknowledgePolicy(u, pol.id))) as PolicyAck;
    assert.equal(ack.lang, "ne");
    const [{ data: row }] = await sql<{ data: PolicyAck }>("SELECT data FROM prima.policy_acks WHERE id = $1", [ack.id]);
    assert.equal(row.lang, "ne");
  });

  it("a guard appeals on their own sign-in; the company and the recorder cannot decide; the CEO overturns", async () => {
    const [{ data: shift }] = await sql<{ data: { id: string; companyId: string; siteId: string; postId: string; personId: string } }>(
      "SELECT s.data FROM prima.shifts s JOIN prima.users u ON u.data->>'personId' = s.data->>'personId' WHERE u.id = 'u-guard-sasa-1' LIMIT 1",
    );
    const now = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 19) + "+08:00";
    const rec: AttendanceFollowUp = {
      id: "fu-rls-appeal-1",
      companyId: shift.companyId,
      siteId: shift.siteId,
      postId: shift.postId,
      shiftId: shift.id,
      attendanceId: null,
      personId: shift.personId,
      date: now.slice(0, 10),
      issue: "NO_SHOW",
      kind: "DISCIPLINE",
      at: now,
      by: "Officer (mock)",
      byId: "u-sv-sasa",
      byDesk: "company",
      note: "Absent without leave (mock)",
      replacementShiftId: null,
      replacementPersonId: null,
      discipline: "WRITTEN_WARNING",
    };
    await sql("INSERT INTO prima.attendance_followups (id, company_id, data) VALUES ($1, $2, $3)", [rec.id, rec.companyId, rec]);
    await db.asUser("u-guard-sasa-1", (svc, u) => svc.lodgeDisciplineAppeal(u, rec.id, { grounds: "मेरो बुबा अस्पतालमा हुनुहुन्थ्यो (mock)" }));
    const [{ data: lodged }] = await sql<{ data: AttendanceFollowUp }>("SELECT data FROM prima.attendance_followups WHERE id = $1", [rec.id]);
    assert.equal(lodged.appeal?.via, "own");
    assert.equal(lodged.appeal?.lang, "ne");
    await assert.rejects(db.asUser("u-cm-sasa", (svc, u) => svc.decideDisciplineAppeal(u, rec.id, { result: "overturned", reason: "The company may not decide its own appeal (mock)" })));
    await assert.rejects(db.asUser("u-sv-sasa", (svc, u) => svc.decideDisciplineAppeal(u, rec.id, { result: "overturned", reason: "The recorder may not decide the appeal (mock)" })));
    await db.asUser("u-fauzan", (svc, u) => svc.decideDisciplineAppeal(u, rec.id, { result: "overturned", reason: "Hospital letter confirms the emergency (mock)" }));
    const [{ data: decided }] = await sql<{ data: AttendanceFollowUp }>("SELECT data FROM prima.attendance_followups WHERE id = $1", [rec.id]);
    assert.equal(decided.appeal?.decision?.result, "overturned");
    const audit = await sql("SELECT 1 FROM prima.audit WHERE data->>'action' = 'attendance.discipline_appeal_decided'");
    assert.equal(audit.length, 1);
  });

  it("an office HR case appeal is recorded by HR and decided by the HR Director through the HR wall", async () => {
    const staffPersonId = (await sql<{ pid: string }>("SELECT data->>'personId' AS pid FROM prima.users WHERE id = 'u-it-ex3'"))[0].pid;
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    const c = await db.asUser("u-pwvsb-hr", (svc, u) => svc.openHrCase(u, { personId: staffPersonId, kind: "misconduct", title: "Late repeatedly (mock)", complainantId: null, receivedOn: today, note: "Mock case" }));
    await db.asUser("u-pwvsb-hr", (svc, u) => svc.hrCaseStep(u, c.id, { kind: "written_warning", note: "Written warning for lateness (mock)" }));
    await db.asUser("u-pwvsb-hr", (svc, u) => svc.hrCaseStep(u, c.id, { kind: "appeal", note: "Staff appeals: bus route changed (mock letter)", lang: "ms" }));
    await assert.rejects(db.asUser("u-cm-sasa", (svc, u) => svc.hrCaseStep(u, c.id, { kind: "appeal_decided", note: "Company tries to decide the appeal (mock)", appealResult: "upheld" })));
    const done = await db.asUser("u-dcos", (svc, u) => svc.hrCaseStep(u, c.id, { kind: "appeal_decided", note: "Warning stands: lateness continued after the route change (mock)", appealResult: "upheld" }));
    assert.equal(done.steps.at(-1)?.appealResult, "upheld");
  });
});
