/** Hand-overs between departments on a disposable localhost PostgreSQL only. Synthetic users; never cloud databases. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client, type PoolClient } from 'pg';
import { NEVER_ROUTED, ORG_DESK_LABEL, ORG_FLOWS, OrgLinkService, dataWalls, deskPeople, flowsFor, withOrgLinks, type OrgDesk, type User } from '@prima/core';
import { orgRoutesSql, routesBlockOf } from '../src/org-links-routes';
import { PgStore } from '../src/pg-store';
import { migrationSql } from '../src/schema';
import { orgLinksProblems } from '../src/org-links-readiness';

const BASE = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(BASE).hostname)) throw Error('Requires disposable localhost PostgreSQL');
const DB = 'prima_org_links_test';
const OWNER = 'prima_org_links_owner_test';
const url = new URL(BASE);
url.pathname = '/' + DB;
url.username = OWNER;
url.password = 'local-test-only';
const path = (f: string) => resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../../' + f : f);

const users: User[] = [
  { id: 'fin', name: 'Synthetic Finance Lead', role: 'pwvsb_officer', department: 'finance', financeRole: 'leader', companyIds: ['co-a'], siteIds: [] },
  { id: 'legal', name: 'Synthetic Legal', role: 'pwvsb_officer', department: 'legal', companyIds: [], siteIds: [] },
  { id: 'cm', name: 'Synthetic Company Manager', role: 'company_manager', companyIds: ['co-a'], siteIds: [] },
  { id: 'cm-b', name: 'Synthetic Other Manager', role: 'company_manager', companyIds: ['co-b'], siteIds: [] },
  { id: 'cm-b-br', name: 'Synthetic Branch Manager', role: 'company_manager', branchId: 'br-syn-b', companyIds: ['co-b'], siteIds: [] },
  { id: 'act', name: 'Synthetic ACT', role: 'pwvsb_officer', department: 'audit', companyIds: [], siteIds: [] },
  { id: 'it', name: 'Synthetic IT', role: 'pwvsb_officer', department: 'it', itRole: 'executive', companyIds: [], siteIds: [] },
  { id: 'fd', name: 'Synthetic FD', role: 'pwvsb_officer', leadership: 'finance_director', companyIds: [], siteIds: [] },
  { id: 'fin-de', name: 'Synthetic Data Entry', role: 'pwvsb_officer', department: 'finance', financeRole: 'data_entry', companyIds: [], siteIds: [] },
  { id: 'ae-a', name: 'Synthetic Admin Exec', role: 'admin_exec', companyIds: ['co-a'], siteIds: [] },
  { id: 'cm-closed', name: 'Synthetic Closed Manager', role: 'company_manager', companyIds: ['co-a'], siteIds: [], accessClosedFrom: '2026-01-01' },
  { id: 'cm-later', name: 'Synthetic Leaving Manager', role: 'company_manager', companyIds: ['co-a'], siteIds: [], accessClosedFrom: '2099-01-01' },
  { id: 'dev-a', name: 'Synthetic Site Device', role: 'site_device', companyIds: ['co-a'], siteIds: [] },
  { id: 'fwm-x', name: 'Synthetic FWM Exec', role: 'pwvsb_officer', department: 'fwm', fwmRole: 'executive', companyIds: [], siteIds: [] },
  { id: 'fwm-d', name: 'Synthetic Despatch', role: 'pwvsb_officer', department: 'fwm', fwmRole: 'despatch', companyIds: [], siteIds: [] },
  { id: 'proc-s', name: 'Synthetic Storekeeper', role: 'pwvsb_officer', department: 'procurement', procRole: 'storekeeper', companyIds: [], siteIds: [] },
  { id: 'proc-x', name: 'Synthetic Procurement', role: 'pwvsb_officer', department: 'procurement', procRole: 'executive', companyIds: [], siteIds: [] },
  { id: 'fin4', name: 'Synthetic Team 4 Leader', role: 'pwvsb_officer', department: 'finance', financeRole: 'leader', financeTeam: 4, companyIds: [], siteIds: [] } as unknown as User,
  { id: 'hrx', name: 'Synthetic HR', role: 'pwvsb_officer', department: 'hr', companyIds: ['co-a'], siteIds: [] },
  // Writes audit entries for the office-desk test only; on no hand-over desk.
  { id: 'writer', name: 'Synthetic Writer', role: 'pwvsb_officer', department: 'transport', companyIds: ['co-nooffice', 'pwvsb', 'merdeka'], siteIds: [] },
  { id: 'cos', name: 'Synthetic CoS', role: 'pwvsb_officer', leadership: 'cos', companyIds: [], siteIds: [] },
  { id: 'coo', name: 'Synthetic COO', role: 'pwvsb_officer', opsTier: 'coo', companyIds: [], siteIds: [] },
  { id: 'cms', name: 'Synthetic CMS', role: 'pwvsb_officer', department: 'cms', companyIds: [], siteIds: [] },
  { id: 'feed', name: 'Synthetic Feed', role: 'pwvsb_officer', department: 'it', integration: { kind: 'test' }, companyIds: [], siteIds: [] },
].map((u) => ({ title: u.name, ...u })) as unknown as User[];

const now = () => new Date().toISOString();
async function connect(s: string) {
  const c = new Client({ connectionString: s });
  await c.connect();
  return c;
}
/** The same session settings Db.asUser sets. */
async function as<T>(id: string, fn: (c: Client, store: PgStore, user: User) => Promise<T>) {
  const c = await connect(url.toString());
  const user = users.find((u) => u.id === id)!;
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(
      "SELECT set_config('app.user_id',$1,true), set_config('app.company_ids',$2,true), set_config('app.group_user','off',true), set_config('app.walls',$3,true)",
      [id, user.companyIds.join(','), dataWalls(user).join(',')],
    );
    const r = await fn(c, withOrgLinks(new PgStore(c as unknown as PoolClient)), user);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}
const insert = (c: Client, t: string, r: { id: string; [k: string]: unknown }) => c.query(`INSERT INTO prima.${t}(id,data) VALUES($1,$2)`, [r.id, r]);

describe('hand-over layer database boundaries', () => {
  before(async () => {
    const c = await connect(BASE);
    try {
      await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
      if (!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [OWNER])).rowCount)
        await c.query(`CREATE ROLE ${OWNER} LOGIN CREATEDB CREATEROLE PASSWORD 'local-test-only'`);
      if ((await c.query("SELECT 1 FROM pg_roles WHERE rolname='prima_app'")).rowCount) await c.query(`GRANT prima_app TO ${OWNER} WITH ADMIN OPTION`);
      await c.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
    } finally {
      await c.end();
    }
    const a = await connect(url.toString());
    try {
      assert.equal((await a.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper, false);
      await a.query(migrationSql());
      await a.query(`GRANT prima_app TO ${OWNER}`);
      for (const u of users) await insert(a, 'users', u as never);
      for (const id of ['co-a', 'co-b', 'co-nooffice']) await a.query('INSERT INTO prima.companies(id,data) VALUES($1,$2)', [id, { id, name: `Synthetic ${id}` }]);
      await a.query(readFileSync(path('db/modules/org-links-v1.sql'), 'utf8'));
    } finally {
      await a.end();
    }
  });
  after(async () => {
    const c = await connect(BASE);
    try {
      await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
    } finally {
      await c.end();
    }
  });

  it('module catalog is ready under the runtime role', async () => {
    assert.deepEqual(await as('fin', (c) => orgLinksProblems(c)), []);
  });

  let taskId = '';
  it('an audited action writes its hand-overs in the same transaction, to the right people only', async () => {
    await as('fin', (_c, store) =>
      store.audit({ at: now(), actor: 'Synthetic Finance Lead', companyId: 'co-a', action: 'credit.loan', entity: 'credit_loan', entityId: 'loan-syn', summary: 'RM 1 synthetic' }),
    );
    const legal = await as('legal', (_c, store, u) => new OrgLinkService(store, now).inbox(u));
    assert.equal(legal.items.length, 1);
    assert.equal(legal.items[0].task.kind, 'todo');
    taskId = legal.items[0].task.id;
    assert.equal((await as('cm', (_c, store, u) => new OrgLinkService(store, now).inbox(u))).items.length, 1);
    // Another company's manager, IT and the keyer see nothing; ACT oversees all.
    for (const id of ['cm-b', 'it', 'fin']) assert.equal((await as(id, (c) => c.query('SELECT 1 FROM prima.org_tasks'))).rowCount, 0);
    assert.equal((await as('act', (c) => c.query('SELECT 1 FROM prima.org_tasks'))).rowCount, 2);
    assert.equal((await as('cm', (c) => c.query('SELECT 1 FROM prima.org_events'))).rowCount, 0);
    // The audit summary (money) never travels into the hand-over.
    const raw = (await as('act', (c) => c.query('SELECT data FROM prima.org_tasks'))).rows.map((r) => JSON.stringify(r.data)).join();
    assert.equal(raw.includes('RM 1'), false);
  });

  it('a failed action leaves no hand-over behind', async () => {
    await assert.rejects(
      as('fin', async (_c, store) => {
        await store.audit({ at: now(), actor: 'Synthetic Finance Lead', companyId: 'co-a', action: 'legal.matter', entity: 'legal_matter', entityId: 'lm-syn', summary: 'x' });
        throw new Error('later step failed');
      }),
    );
    assert.equal((await as('act', (c) => c.query(`SELECT 1 FROM prima.org_tasks WHERE data->>'flowId'='legal_matter'`))).rowCount, 0);
  });

  it('only a receiver closes, once, under their own name; nothing is deleted', async () => {
    await assert.rejects(as('cm-b', (_c, store, u) => new OrgLinkService(store, now).close(u, taskId, 'done', 'not mine')));
    const t = (await as('act', (c) => c.query('SELECT data FROM prima.org_tasks WHERE id=$1', [taskId]))).rows[0].data;
    // A forged close straight in SQL: another person's name, or a changed receiver list.
    await assert.rejects(as('legal', (c) => c.query('UPDATE prima.org_tasks SET data=$2 WHERE id=$1', [taskId, { ...t, status: 'done', closed: { byId: 'legal', by: 'Someone Else', at: now(), note: 'forged' } }])));
    await assert.rejects(as('legal', (c) => c.query('UPDATE prima.org_tasks SET data=$2 WHERE id=$1', [taskId, { ...t, userIds: ['legal', 'it'] }])));
    const done = await as('legal', (_c, store, u) => new OrgLinkService(store, now).close(u, taskId, 'done', 'Agreement drafted, stamping booked'));
    assert.equal(done.status, 'done');
    await assert.rejects(as('legal', (_c, store, u) => new OrgLinkService(store, now).close(u, taskId, 'done', 'again')));
    const del = await as('act', (c) => c.query('DELETE FROM prima.org_tasks').catch((e: Error) => e));
    assert.ok(del instanceof Error);
  });

  it("IT's joining hand-over closes in the database only from the HR/IT joining request", async () => {
    await as('fin', (_c, store) => store.audit({ at: now(), actor: 'Synthetic Finance Lead', companyId: 'co-a', action: 'record.add.officeStaff', entity: 'officeStaff', entityId: 'p-join-syn', summary: 'synthetic' }));
    const t = (await as('act', (c) => c.query(`SELECT data FROM prima.org_tasks WHERE data->>'flowId'='staff_join' AND data->>'desk'='it'`))).rows[0].data;
    assert.deepEqual(t.userIds, ['it']);
    const close = (status: string, note: string) =>
      as('it', (c) => c.query('UPDATE prima.org_tasks SET data=$2 WHERE id=$1', [t.id, { ...t, status, closed: { byId: 'it', by: 'Synthetic IT', at: now(), note } }]));
    // Synthetic HR/IT joining rows, seeded below the app (its own guard is tested in the HR/IT suite).
    const seed = async (status: string, oid: string | null, person = 'p-join-syn') => {
      const sup = new URL(BASE);
      sup.pathname = '/' + DB;
      const c = await connect(sup.toString());
      try {
        await c.query("SET session_replication_role = replica");
        await c.query('DELETE FROM prima.hr_it_requests');
        await c.query('INSERT INTO prima.hr_it_requests(id,data) VALUES($1,$2)', ['hrit-syn', { id: 'hrit-syn', workflow: 'onboard', companyId: 'co-a', subject: { kind: 'hr_person', id: person }, status, technical: { oid, recordedById: oid ? 'it-lead' : null } }]);
      } finally {
        await c.end();
      }
    };
    // No request: a note alone closes nothing, done or not needed.
    await assert.rejects(close('done', 'Account and laptop ready'), /from the HR\/IT joining request/);
    await assert.rejects(close('not_needed', 'Not needed'), /from the HR\/IT joining request/);
    // Open without IT's identity record, or for another person: still refused.
    await seed('submitted', null);
    await assert.rejects(close('done', 'Account ready'), /from the HR\/IT joining request/);
    await seed('submitted', '11111111-2222-4333-8444-555555555555', 'someone-else');
    await assert.rejects(close('done', 'Account ready'), /from the HR\/IT joining request/);
    // Cancelled by HR: not needed only.
    await seed('cancelled', null);
    await assert.rejects(close('done', 'Account ready'), /from the HR\/IT joining request/);
    // IT's identity record on the submitted request: done is accepted.
    await seed('submitted', '11111111-2222-4333-8444-555555555555');
    await assert.rejects(close('not_needed', 'Not needed'), /from the HR\/IT joining request/);
    await close('done', 'Identity recorded on the joining request');
    assert.equal((await as('act', (c) => c.query('SELECT data FROM prima.org_tasks WHERE id=$1', [t.id]))).rows[0].data.status, 'done');
  });

  it("HR's own joining to-do goes to the keyer too and closes in the database only once the request is open", async () => {
    // Review of the combined candidate (W2).
    await as('hrx', (_c, store) => store.audit({ at: now(), actor: 'Synthetic HR', companyId: 'co-a', action: 'record.add.officeStaff', entity: 'officeStaff', entityId: 'p-join-hr', summary: 'synthetic' }));
    const tasks = (await as('act', (c) => c.query(`SELECT data FROM prima.org_tasks WHERE data->>'flowId'='staff_join' AND data->>'entityId'='p-join-hr'`))).rows.map((r) => r.data);
    const hr = tasks.find((x) => x.desk === 'hr');
    assert.deepEqual(hr.userIds, ['hrx'], 'the keyer gets their own next step');
    // Every other line still leaves the keyer out.
    for (const x of tasks.filter((y) => y.desk !== 'hr')) assert.ok(!x.userIds.includes('hrx'), x.desk);
    const close = (status: string, note: string) =>
      as('hrx', (c) => c.query('UPDATE prima.org_tasks SET data=$2 WHERE id=$1', [hr.id, { ...hr, status, closed: { byId: 'hrx', by: 'Synthetic HR', at: now(), note } }]));
    await assert.rejects(close('done', 'Told IT by phone'), /from the HR\/IT joining request/);
    const sup = new URL(BASE);
    sup.pathname = '/' + DB;
    const c = await connect(sup.toString());
    try {
      await c.query("SET session_replication_role = replica");
      await c.query('DELETE FROM prima.hr_it_requests');
      await c.query('INSERT INTO prima.hr_it_requests(id,data) VALUES($1,$2)', ['hrit-syn-hr', { id: 'hrit-syn-hr', workflow: 'onboard', companyId: 'co-a', subject: { kind: 'hr_person', id: 'p-join-hr' }, status: 'submitted', technical: { oid: null, recordedById: null } }]);
    } finally {
      await c.end();
    }
    await assert.rejects(close('not_needed', 'Not needed'), /from the HR\/IT joining request/);
    await close('done', 'Joining request opened');
  });

  it("Finance hand-overs go to the company's assigned team, read by the database's own function (G5)", async () => {
    const audit = (entityId: string) => as('hrx', (_c, store) => store.audit({ at: now(), actor: 'Synthetic HR', companyId: 'co-a', action: 'client.add', entity: 'clientAccount', entityId, summary: 'synthetic' }));
    const finance = async (entityId: string) => (await as('act', (c) => c.query(`SELECT data FROM prima.org_tasks WHERE data->>'entityId'=$1 AND data->>'desk'='finance'`, [entityId]))).rows[0]?.data;
    // No team recorded for the company: the Finance Director.
    await audit('ca-g5-none');
    assert.deepEqual((await finance('ca-g5-none')).userIds, ['fd']);
    // The FD assigns team 4: its leader, even though the person keying cannot change Finance status.
    const sup = new URL(BASE);
    sup.pathname = '/' + DB;
    const c = await connect(sup.toString());
    try {
      await c.query("INSERT INTO prima.fin_status(id,company_id,data) VALUES('fin-co-a','co-a',$1) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data", [{ id: 'fin-co-a', companyId: 'co-a', team: 4 }]);
    } finally {
      await c.end();
    }
    await audit('ca-g5-team');
    // Written and accepted: the database check (org_desk_people -> org_finance_people) names the same receivers.
    assert.deepEqual((await finance('ca-g5-team')).userIds, ['fin4']);
  });

  it('refuses hand-overs that no audited action produced', async () => {
    const fake = { id: 'oe-999-credit_loan', auditSeq: 999, at: now(), flowId: 'credit_loan', action: 'credit.loan', companyId: 'co-a', entity: 'credit_loan', entityId: 'nope', by: 'x' };
    await assert.rejects(as('it', (c) => insert(c, 'org_events', fake)));
    const ev = (await as('act', (c) => c.query('SELECT data FROM prima.org_events LIMIT 1'))).rows[0].data;
    const forged = { id: 'ot-forged', eventId: ev.id, flowId: ev.flowId, at: now(), companyId: ev.companyId, entity: ev.entity, entityId: ev.entityId, desk: 'it', userIds: ['it'], kind: 'info', title: 'x', task: 'x', from: 'x', dueOn: null, status: 'done', closed: { byId: 'it', by: 'Synthetic IT', at: now(), note: 'pre-closed' }, unassigned: false };
    await assert.rejects(as('it', (c) => insert(c, 'org_tasks', forged)));
    await assert.rejects(as('it', (c) => insert(c, 'org_notices', { id: 'on-forged', userId: 'it', taskId, at: now(), channel: 'in_app', readAt: null })));
  });

  it('an old audit entry cannot be replayed into new hand-overs, and only real open accounts receive', async () => {
    // Replay: a later request names the earlier credit.loan entry under a different flow.
    const old = (await as('act', (c) => c.query(`SELECT data FROM prima.org_events WHERE data->>'flowId'='credit_loan'`))).rows[0].data;
    await assert.rejects(as('fin', (c) => insert(c, 'org_events', { ...old, id: `oe-${old.auditSeq}-legal_matter`, flowId: 'legal_matter' })));
    // In its own request, a fresh audited action (written without the hand-over hook, so this test writes the rows).
    await assert.rejects(
      as('fin', async (c) => {
        const ev = (await new PgStore(c as unknown as PoolClient).audit({ at: now(), actor: 'Synthetic Finance Lead', companyId: 'co-a', action: 'credit.loan', entity: 'credit_loan', entityId: 'loan-syn-2', summary: 'synthetic' })).seq;
        const flow = ORG_FLOWS.find((f) => f.id === 'credit_loan')!;
        const line = (desk: string) => flow.targets.find((t) => t.desk === desk)!;
        const refused = async (t: string, r: { id: string; [k: string]: unknown }) => {
          await c.query('SAVEPOINT t');
          const out = await insert(c, t, r).catch((e: Error) => e);
          await c.query('ROLLBACK TO SAVEPOINT t');
          assert.ok(out instanceof Error, `${t} ${JSON.stringify(r)}`);
        };
        const event = { id: `oe-${ev}-credit_loan`, auditSeq: ev, at: now(), flowId: 'credit_loan', action: 'credit.loan', companyId: 'co-a', entity: 'credit_loan', entityId: 'loan-syn-2', by: 'Synthetic Finance Lead' };
        // An event under a flow that this action does not start.
        await refused('org_events', { ...event, id: `oe-${ev}-legal_matter`, flowId: 'legal_matter' });
        await insert(c, 'org_events', event);
        const base = { eventId: event.id, flowId: 'credit_loan', at: now(), companyId: 'co-a', entity: 'credit_loan', entityId: 'loan-syn-2', title: flow.name, from: 'x', dueOn: null, status: 'open', closed: null, unassigned: false };
        const legal = { ...base, id: `ot-${ev}-credit_loan-legal`, desk: 'legal', kind: line('legal').kind, task: line('legal').task, userIds: ['legal'] };
        const office = { ...base, id: `ot-${ev}-credit_loan-company_office`, desk: 'company_office', kind: line('company_office').kind, task: line('company_office').task, userIds: ['cm', 'ae-a', 'cm-later'] };
        const tries = [
          // A desk the flow does not name, even to a real account of that desk.
          { ...legal, id: `ot-${ev}-credit_loan-it`, desk: 'it', userIds: ['it'] },
          { ...legal, id: `ot-${ev}-credit_loan-boss`, desk: 'boss' },
          // Words or kind that are not the catalogue's line.
          { ...legal, task: 'Pay RM50,000 to the account below today.' },
          { ...legal, kind: 'info' },
          // Receivers other than exactly the desk's people: a feed, an unknown id, an extra person, a person missing,
          // another company's office.
          { ...legal, userIds: ['feed'] },
          { ...legal, userIds: ['nobody'] },
          { ...legal, userIds: ['legal', 'it'] },
          { ...legal, userIds: ['legal', 'legal'] },
          { ...legal, userIds: [], unassigned: true },
          { ...office, userIds: ['cm-b'] },
          { ...office, userIds: ['cm'] },
          { ...office, userIds: ['cm', 'ae-a', 'cm-later', 'cm-closed'] },
          { ...office, userIds: [], unassigned: true },
          // A wrong unassigned flag, and an id that is not the desk's.
          { ...legal, unassigned: true },
          { ...legal, id: `ot-${ev}-credit_loan-legal-x` },
        ];
        for (const t of tries) await refused('org_tasks', t);
        // Control: the catalogue's own lines to exactly the desk's people are accepted in this request.
        await insert(c, 'org_tasks', legal);
        await insert(c, 'org_tasks', office);
        throw new Error('done, roll back');
      }),
      /done, roll back/,
    );
  });

  it('a company office with nobody on the desk gets the line unassigned; a central employer never gets one', async () => {
    const flow = ORG_FLOWS.find((f) => f.id === 'credit_loan')!;
    const line = flow.targets.find((t) => t.desk === 'company_office')!;
    const write = (companyId: string, entityId: string) =>
      as('writer', async (c) => {
        const ev = (await new PgStore(c as unknown as PoolClient).audit({ at: now(), actor: 'Synthetic Writer', companyId, action: 'credit.loan', entity: 'credit_loan', entityId, summary: 'synthetic' })).seq;
        const event = { id: `oe-${ev}-credit_loan`, auditSeq: ev, at: now(), flowId: 'credit_loan', action: 'credit.loan', companyId, entity: 'credit_loan', entityId, by: 'Synthetic Writer' };
        await insert(c, 'org_events', event);
        await insert(c, 'org_tasks', { id: `ot-${ev}-credit_loan-company_office`, eventId: event.id, flowId: 'credit_loan', at: now(), companyId, entity: 'credit_loan', entityId, desk: 'company_office', kind: line.kind, task: line.task, userIds: [], unassigned: true, title: flow.name, from: 'x', dueOn: null, status: 'open', closed: null });
        throw new Error('done, roll back');
      });
    // Review of the combined candidate (G4): a security company whose office desk is empty today keeps the line.
    await assert.rejects(write('co-nooffice', 'loan-syn-empty'), /done, roll back/);
    // PWVSB and Merdeka have no company office: the line is refused, not parked as unassigned.
    for (const central of ['pwvsb', 'merdeka']) await assert.rejects(write(central, `loan-syn-${central}`), (e: Error) => /org_tasks/.test(e.message) && !/done, roll back/.test(e.message));
  });

  it('an audit entry from an earlier, committed request is refused even while it is the newest and the lock is taken by hand', async () => {
    const ev = { action: 'credit.loan', entity: 'credit_loan', entityId: 'loan-syn-3', companyId: 'co-a' };
    // Request 1 writes the audit entry and commits, without hand-overs.
    const seq = await as('fin', async (c) => (await new PgStore(c as unknown as PoolClient).audit({ at: now(), actor: 'Synthetic Finance Lead', summary: 'synthetic', ...ev })).seq);
    const event = (n: number) => ({ id: `oe-${n}-credit_loan`, auditSeq: n, at: now(), flowId: 'credit_loan', by: 'Synthetic Finance Lead', ...ev });
    // Request 2: nothing newer is written, the same lock is taken directly and a transaction id is assigned.
    await assert.rejects(
      as('fin', async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('prima.audit'))");
        await c.query('SELECT pg_current_xact_id()');
        assert.equal((await c.query('SELECT max(seq)::int m FROM prima.audit')).rows[0]?.m ?? seq, seq);
        await insert(c, 'org_events', event(seq));
      }),
      /row-level security/,
    );
    // Control: the audit written inside a savepoint of this same request (as PgStore units do) is accepted.
    await assert.rejects(
      as('fin', async (c) => {
        await c.query('SAVEPOINT unit');
        const n = (await new PgStore(c as unknown as PoolClient).audit({ at: now(), actor: 'Synthetic Finance Lead', summary: 'synthetic', ...ev, entityId: 'loan-syn-4' })).seq;
        await c.query('RELEASE SAVEPOINT unit');
        await insert(c, 'org_events', { ...event(n), entityId: 'loan-syn-4' });
        throw new Error('done, roll back');
      }),
      /done, roll back/,
    );
  });

  it('the database catalogue is the code catalogue: every flow, action, desk and line', async () => {
    const sql = readFileSync(path('db/modules/org-links-v1.sql'), 'utf8');
    assert.equal(routesBlockOf(sql), orgRoutesSql(), 'db/modules/org-links-v1.sql is out of date with ORG_FLOWS; paste orgRoutesSql() between the GENERATED markers');
    const desks = Object.keys(ORG_DESK_LABEL);
    await as('act', async (c) => {
      await c.query('RESET ROLE');
      for (const f of ORG_FLOWS) {
        for (const a of f.actions) {
          const act = a.endsWith('.') ? a + 'syn' : a;
          assert.equal((await c.query('SELECT prima.org_flow_starts($1,$2) ok', [f.id, act])).rows[0].ok, flowsFor(act).some((x) => x.id === f.id), `${f.id} ${act}`);
        }
        for (const d of desks) {
          const t = f.targets.find((x) => x.desk === d);
          const ok = (await c.query('SELECT prima.org_flow_target_ok($1,$2,$3,$4) ok', [f.id, d, t?.kind ?? 'info', t?.task ?? 'x'])).rows[0].ok;
          assert.equal(ok, !!t, `${f.id} ${d}`);
        }
      }
      for (const p of NEVER_ROUTED) {
        const act = p.endsWith('.') || p.endsWith('_') ? p + 'syn' : p;
        for (const f of ORG_FLOWS) assert.equal((await c.query('SELECT prima.org_flow_starts($1,$2) ok', [f.id, act])).rows[0].ok, false, act);
      }
      assert.equal((await c.query('SELECT prima.org_flow_starts($1,$2) ok', ['credit_loan', 'credit.loanx'])).rows[0].ok, false);
    });
  });

  it('the database names the same receivers as the code for every desk and company', async () => {
    const day = now().slice(0, 10);
    await as('act', async (c) => {
      await c.query('RESET ROLE');
      const all = (await c.query('SELECT data FROM prima.users')).rows.map((r) => r.data as User);
      for (const d of Object.keys(ORG_DESK_LABEL) as OrgDesk[])
        for (const co of [null, 'co-a', 'co-b']) {
          const want = deskPeople(d, all, co, day).map((u) => u.id).sort();
          const got = (await c.query('SELECT prima.org_desk_people($1,$2,$3) ids', [d, co, day])).rows[0].ids as string[];
          assert.deepEqual([...got].sort(), want, `${d} ${co}`);
        }
    });
  });

  it('an office that runs another company receives that company\'s office lines, in code and in the database alike', async () => {
    // Review of #56 at 8b0c33f. The run links belong to the Company office module; a bare table stands in for it here.
    const own = await connect(url.toString());
    const audit = (entityId: string) =>
      as('writer', (_c, store) => store.audit({ at: now(), actor: 'Synthetic Writer', companyId: 'co-nooffice', action: 'credit.loan', entity: 'credit_loan', entityId, summary: 'synthetic' }));
    const office = async (entityId: string) =>
      (await as('act', (c) => c.query(`SELECT data FROM prima.org_tasks WHERE data->>'entityId'=$1 AND data->>'desk'='company_office'`, [entityId]))).rows[0]?.data;
    try {
      // Before the Company office module: nobody runs it, the line stays unassigned.
      assert.equal((await own.query('SELECT prima.org_run_by($1) r', ['co-nooffice'])).rows[0].r, null);
      await audit('loan-run-before');
      assert.deepEqual((await office('loan-run-before')).userIds, []);
      await own.query('CREATE TABLE prima.company_run_links (id text PRIMARY KEY, data jsonb NOT NULL)');
      await own.query('GRANT SELECT ON prima.company_run_links TO prima_app');
      await own.query('INSERT INTO prima.company_run_links(id,data) VALUES($1,$2)', ['co-nooffice', { id: 'co-nooffice', companyId: 'co-nooffice', runByCompanyId: 'co-b' }]);
      // The app reads the same answer through the store; the branch manager of the running company is not its office.
      assert.equal(await as('writer', (_c, store) => store.orgRunBy!('co-nooffice')), 'co-b');
      await audit('loan-run-after');
      const t = await office('loan-run-after');
      assert.deepEqual(t.userIds, ['cm-b']);
      assert.equal(t.unassigned, false);
      const inbox = await as('cm-b', (_c, store, u) => new OrgLinkService(store, now).inbox(u));
      assert.ok(inbox.items.some((i) => i.task.entityId === 'loan-run-after'));
      assert.ok(inbox.unread >= 1);
      assert.equal((await as('cm-b-br', (c) => c.query(`SELECT 1 FROM prima.org_notices`))).rowCount, 0);
      // Code and database name the same receivers with the link set.
      const day = now().slice(0, 10);
      const all = (await own.query('SELECT data FROM prima.users')).rows.map((r) => r.data as User);
      for (const co of ['co-nooffice', 'co-a', 'co-b']) {
        const runBy = (await own.query('SELECT prima.org_run_by($1) r', [co])).rows[0].r as string | null;
        const want = deskPeople('company_office', all, co, day, null, runBy).map((u) => u.id).sort();
        const got = (await own.query('SELECT prima.org_desk_people($1,$2,$3) ids', ['company_office', co, day])).rows[0].ids as string[];
        assert.deepEqual([...got].sort(), want, co);
      }
      // A running office that is itself run by another office runs nothing (no chains), the same rule as access.
      await own.query('INSERT INTO prima.company_run_links(id,data) VALUES($1,$2)', ['co-b', { id: 'co-b', companyId: 'co-b', runByCompanyId: 'co-a' }]);
      assert.equal((await own.query('SELECT prima.org_run_by($1) r', ['co-nooffice'])).rows[0].r, null);
      assert.equal((await own.query('SELECT prima.org_run_by($1) r', ['co-b'])).rows[0].r, 'co-a');
    } finally {
      await own.query('DROP TABLE IF EXISTS prima.company_run_links').catch(() => undefined);
      await own.end();
    }
  });

  it('import receipts: written once per file, by the importer', async () => {
    const r = { id: 'oimp-1', fingerprint: 'f'.repeat(64), kind: 'itDomain', companyId: null, rows: 1, recordIds: [], byId: 'it', by: 'Synthetic IT', at: now() };
    await assert.rejects(as('it', (c) => insert(c, 'org_imports', { ...r, byId: 'legal' })));
    await as('it', (c) => insert(c, 'org_imports', r));
    await assert.rejects(as('it', (c) => insert(c, 'org_imports', { ...r, id: 'oimp-2' })));
    assert.equal((await as('legal', (c) => c.query('SELECT 1 FROM prima.org_imports'))).rowCount, 0);
  });

  it('readiness reports a missing guard or a deletable table', async () => {
    for (const sql of ['DROP TRIGGER org_task_guard ON prima.org_tasks', 'GRANT DELETE ON prima.org_tasks TO prima_app', 'ALTER TABLE prima.org_notices DISABLE ROW LEVEL SECURITY']) {
      const a = await connect(url.toString());
      try {
        await a.query('BEGIN');
        await a.query(sql);
        assert.notDeepEqual(await orgLinksProblems(a), []);
      } finally {
        await a.query('ROLLBACK');
        await a.end();
      }
    }
  });
});
