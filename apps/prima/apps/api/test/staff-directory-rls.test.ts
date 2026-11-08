/** Staff directory on a disposable localhost PostgreSQL with the restricted app role. Synthetic rows only. */
import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client, type PoolClient } from "pg";
import { StaffDirectoryService, type User } from "@prima/core";
import { PgStore } from "../src/pg-store";
import { migrationSql } from "../src/schema";

const base =
  process.env.DATABASE_URL ??
  "postgres://postgres:localdev@localhost:5432/prima_test";
if (
  !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(base).hostname)
)
  throw Error("Disposable localhost database required");
const DB = "prima_staff_directory_test",
  OWNER = "prima_staff_directory_owner";
const url = new URL(base);
url.pathname = "/" + DB;
url.username = OWNER;
url.password = "local-test-only";
async function connect(cs = url.toString()) {
  const c = new Client({ connectionString: cs });
  await c.connect();
  return c;
}
const users = (
  [
    { id: "hr", role: "pwvsb_officer", department: "hr" },
    {
      id: "cos",
      role: "pwvsb_officer",
      department: "chief_of_staff",
      leadership: "cos",
    },
    { id: "ceo", role: "director", opsTier: "ceo" },
    { id: "it", role: "pwvsb_officer", department: "it", itRole: "executive" },
    { id: "coo", role: "pwvsb_officer", opsTier: "coo" },
  ] as Partial<User>[]
).map((x) => ({
  name: `Synthetic ${x.id}`,
  title: "Synthetic",
  companyIds: [],
  siteIds: [],
  ...x,
})) as User[];
const user = (id: string) => users.find((u) => u.id === id)!;
const CSV =
  "group,org_unit,name,title,email\ncompany,Synthetic Co,Sample A,PENGURUS,a@example.test\ncentral_unit,UNIT IT,Sample B,,b@outlook.com";
async function as<T>(
  uid: string,
  fn: (c: Client, s: StaffDirectoryService) => Promise<T>,
) {
  const c = await connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE prima_app");
    await c.query("SELECT set_config('app.user_id',$1,true)", [uid]);
    const v = await fn(
      c,
      new StaffDirectoryService(new PgStore(c as unknown as PoolClient), () =>
        new Date().toISOString(),
      ),
    );
    await c.query("COMMIT");
    return v;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}
/** A forbidden write either errors or, under row-level security, touches no row. */
async function blocked(p: Promise<{ rowCount: number | null }>) {
  const r = await p.catch(() => null);
  if (r) assert.equal(r.rowCount, 0);
}
const status = (uid: string) =>
  as(uid, (c) =>
    c
      .query(
        "SELECT data->>'status' AS s FROM prima.staff_directory_batches WHERE id=$1",
        [batchId],
      )
      .then((r) => r.rows[0]?.s as string),
  );
const ids = (c: Client, t: string) =>
  c
    .query(`SELECT id FROM prima.${t} ORDER BY id`)
    .then((r) => r.rows.map((x) => x.id as string));

before(async () => {
  const c = await connect(base);
  try {
    await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
    if (
      !(await c.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [OWNER]))
        .rowCount
    )
      await c.query(
        `CREATE ROLE ${OWNER} LOGIN CREATEDB CREATEROLE PASSWORD 'local-test-only'`,
      );
    if (
      (await c.query("SELECT 1 FROM pg_roles WHERE rolname='prima_app'"))
        .rowCount
    )
      await c.query(`GRANT prima_app TO ${OWNER} WITH ADMIN OPTION`);
    await c.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
  } finally {
    await c.end();
  }
  const a = await connect();
  try {
    assert.equal(
      (
        await a.query(
          "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0].rolsuper,
      false,
    );
    await a.query(migrationSql());
    await a.query(`GRANT prima_app TO ${OWNER}`);
    for (const u of users)
      await a.query("INSERT INTO prima.users(id,data) VALUES($1,$2)", [
        u.id,
        u,
      ]);
    const before = await new StaffDirectoryService(
      new PgStore(a as unknown as PoolClient),
      () => new Date().toISOString(),
    ).problems();
    assert.ok(before.some((p) => p.includes("missing")));
    const path = resolve(
      process.cwd(),
      process.cwd().endsWith("/apps/api")
        ? "../../db/modules/staff-directory-v1.sql"
        : "db/modules/staff-directory-v1.sql",
    );
    await a.query(readFileSync(path, "utf8"));
  } finally {
    await a.end();
  }
});
after(async () => {
  const c = await connect(base);
  try {
    await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
  } finally {
    await c.end();
  }
});

let batchId = "";
it("the installed module reports ready to the app role", async () => {
  assert.deepEqual(await as("hr", (_, s) => s.problems()), []);
});

it("HR sends a batch; nobody outside HR, the HR Director, the CEO and IT reads it", async () => {
  const p = await as("hr", (_, s) =>
    s.preview(user("hr"), { text: CSV, source: "synthetic.csv" }),
  );
  batchId = (
    await as("hr", (_, s) =>
      s.submit(user("hr"), {
        text: CSV,
        source: "synthetic.csv",
        fingerprint: p.fingerprint,
      }),
    )
  ).id;
  assert.deepEqual(await as("it", (c) => ids(c, "staff_directory_batches")), [
    batchId,
  ]);
  assert.deepEqual(
    await as("coo", (c) => ids(c, "staff_directory_batches")),
    [],
  );
  await assert.rejects(as("coo", (_, s) => s.board(user("coo"))));
});

it("the database refuses forged approvals, self-approval and deletes", async () => {
  // HR cannot approve its own batch directly in the table.
  await blocked(
    as("hr", (c) =>
      c.query(
        `UPDATE prima.staff_directory_batches SET data = data || '{"status":"approved","decidedById":"hr"}' WHERE id=$1`,
        [batchId],
      ),
    ),
  );
  assert.equal(await status("hr"), "waiting");
  const sent = await as("cos", (c) =>
    c.query("SELECT 1 FROM prima.staff_directory_batches WHERE id=$1", [
      batchId,
    ]),
  );
  assert.equal(sent.rowCount, 1);
  // A decision in someone else's name is refused.
  await assert.rejects(
    as("cos", (c) =>
      c.query(
        `UPDATE prima.staff_directory_batches SET data = data || '{"status":"approved","decidedById":"ceo"}' WHERE id=$1`,
        [batchId],
      ),
    ),
  );
  // IT cannot add entries; nobody in the app can delete.
  await assert.rejects(
    as("it", (c) =>
      c.query(
        `INSERT INTO prima.staff_directory(id,data) VALUES('sd-x','{"id":"sd-x","group":"company","name":"X","addedById":"it","batchId":null}')`,
      ),
    ),
  );
  await assert.rejects(
    as("cos", (c) => c.query("DELETE FROM prima.staff_directory_batches")),
  );
});

it("the HR Director approves through the service; entries appear, the batch is closed", async () => {
  const r = await as("cos", (_, s) =>
    s.decide(user("cos"), {
      batchId,
      approve: true,
      comment: "Checked against HR list",
    }),
  );
  assert.deepEqual(r, { id: batchId, status: "approved", added: 2 });
  assert.equal((await as("it", (c) => ids(c, "staff_directory"))).length, 2);
  assert.equal((await as("coo", (c) => ids(c, "staff_directory"))).length, 0);
  await blocked(
    as("ceo", (c) =>
      c.query(
        `UPDATE prima.staff_directory_batches SET data = data || '{"status":"returned","decidedById":"ceo"}' WHERE id=$1`,
        [batchId],
      ),
    ),
  );
  assert.equal(await status("ceo"), "approved");
  await assert.rejects(
    as("hr", (c) =>
      c.query(
        `UPDATE prima.staff_directory SET data = data || '{"name":"Changed"}'`,
      ),
    ),
  );
});

it("HR keys in one more by hand; the same rows cannot be sent again", async () => {
  await as("hr", (_, s) =>
    s.addOne(user("hr"), {
      group: "central_unit",
      orgUnit: "UNIT HR",
      name: "Sample C",
      sourceNote: "Offer letter",
    }),
  );
  assert.equal((await as("hr", (c) => ids(c, "staff_directory"))).length, 3);
  const p = await as("hr", (_, s) =>
    s.preview(user("hr"), { text: CSV, source: "synthetic.csv" }),
  );
  await assert.rejects(
    as("hr", (_, s) =>
      s.submit(user("hr"), {
        text: CSV,
        source: "synthetic.csv",
        fingerprint: p.fingerprint,
      }),
    ),
  );
});
