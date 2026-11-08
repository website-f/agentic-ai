// Integration tests against a real local PostgreSQL. They prove the company wall holds in
// the database itself, not only in application code. Run with DATABASE_URL pointing at a
// throwaway local database: the tests reset it.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db, nowMyt } from '../src/db';
import { resetDb } from '../src/reset-db';
import { extractionAudit } from '../src/arisha-it-extraction-audit';
import { ItExtractionPreviewService } from '../src/arisha-it-extraction';
import { officePayload, officeSign } from '../src/office';
import { OfficeController } from '../src/controllers';
import { AuthGuard, OfficeSystemGuard, entraSetup, issueToken, pilotAdmits, resetEntraSetup, userForEntra, verifyFeed, verifyToken } from '../src/auth';
import { linkEntra } from '../src/entra-link';
import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { addDays, dateOf, myt, verifyChain, type AuditEntry } from '@prima/core';

let proofN = 0;
/** A unique test document as case proof (rule CASE-PROOF). */
function proof() {
  proofN += 1;
  return {
    kind: 'document' as const,
    name: `Report ${proofN}.pdf`,
    data: `data:application/pdf;base64,${Buffer.from(`%PDF proof ${proofN} ${Date.now()}`).toString('base64')}`,
  };
}

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';

async function asApp(companyIds: string, sql: string, params: unknown[] = [], walls = '') {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', $1, true)`, [companyIds]);
    await c.query(`SELECT set_config('app.walls', $1, true)`, [walls]);
    const res = await c.query(sql, params);
    await c.query('COMMIT');
    return res;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

describe('database company wall', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('serializes simultaneous first website schedule runs before a settings row exists', async () => {
    const owner = new Client({ connectionString: URL });
    await owner.connect();
    try {
      await owner.query("DELETE FROM prima.web_settings WHERE id = 'settings'");
      const results = await Promise.all([
        db.asUser('u-it-mgr', (svc, u) => svc.websites.act(u, 'runSchedule', {})),
        db.asUser('u-it-lead', (svc, u) => svc.websites.act(u, 'runSchedule', {})),
      ]) as { ran: boolean }[];
      assert.equal(results.filter(r => r.ran).length, 1);
      const duplicateKeys = await owner.query("SELECT data->>'key' AS key FROM prima.web_notices WHERE data->>'key' IS NOT NULL GROUP BY data->>'key' HAVING count(*) > 1");
      assert.equal(duplicateKeys.rowCount, 0);
      const settings = await owner.query("SELECT data FROM prima.web_settings WHERE id = 'settings'");
      assert.equal(settings.rowCount, 1);
      assert.ok(settings.rows[0].data.lastScheduleRun);
    } finally { await owner.end(); }
  });

  it('keeps ungranted website company writes fail-closed, then provisions only synthetic test-company access', async () => {
    await assert.rejects(db.asUser('u-it-mgr', (svc,u) => svc.websites.act(u,'raiseIssue',{
      companyId:'co-arsh',severity:'normal',description:'Unscoped synthetic issue',ownerId:'u-it-lead',
    })), /Company not found/);
    // Existing company RLS is intentional. The following concurrency fixtures need
    // explicit company grants; no production role or company-wall policy is widened.
    for (const userId of ['u-it-mgr','u-it-lead']) {
      const id = `test-website-scope-${userId}`;
      await db.pool.query("INSERT INTO prima.grants(id,company_id,data) VALUES($1,'co-arsh',$2)", [id, {
        id,userId,companyId:'co-arsh',scope:'monitor',basis:'Disposable website concurrency test only',
        validFrom:dateOf(nowMyt()),validTo:addDays(dateOf(nowMyt()),1),
      }]);
    }
  });

  it('serializes website social updates and a duplicate SharePoint decision under restricted transactions', async () => {
    await Promise.all(['Recovery first account','Recovery second account'].map(name=>db.asUser('u-it-mgr',(svc,u)=>svc.websites.act(u,'saveSocial',{companyId:'co-arsh',platform:'facebook',name}))));
    const b=await db.asUser('u-it-mgr',(svc,u)=>svc.websites.board(u));
    assert.ok(b.allowed);if(!b.allowed)throw new Error('Not allowed');
    const accounts=b.social.filter(x=>x.account.name.startsWith('Recovery '));assert.equal(accounts.length,2);assert.equal(new Set(accounts.map(x=>x.account.id)).size,2);
    await db.asUser('u-fauzan',(svc,u)=>svc.websites.act(u,'setConnector',{key:'sharepoint',on:true,note:'Synthetic database test'}));
    const site=b.sites.find(x=>x.site.status==='live'&&x.site.companyId==='co-arsh')!.site;
    await db.asUser('u-it-mgr',(svc,u)=>svc.websites.syncFromFeed(u,{at:nowMyt(),sharepoint:{ok:true,data:{requests:[{id:'recovery-concurrent-sp',kind:'change',title:'Synthetic concurrent request',detail:'Test only',siteUrl:site.url,requestedBy:'Synthetic',at:nowMyt(),link:''}]}}}));
    const decisions=await Promise.allSettled([1,2].map(()=>db.asUser('u-it-mgr',(svc,u)=>svc.websites.act(u,'spDecide',{id:'recovery-concurrent-sp',accept:true,note:'Synthetic acceptance'}))));
    assert.equal(decisions.filter(x=>x.status==='fulfilled').length,1);
    const after=await db.asUser('u-it-mgr',(svc,u)=>svc.websites.board(u));assert.ok(after.allowed);if(after.allowed)assert.equal(after.issues.filter(x=>x.issue.origin.kind==='sharepoint'&&x.issue.origin.id==='recovery-concurrent-sp').length,1);
  });

  it('rolls back linked website and IT resolution together on failure', async () => {
    const issue=await db.asUser('u-it-mgr',(svc,u)=>svc.websites.act(u,'raiseIssue',{companyId:'co-arsh',severity:'normal',description:'Synthetic rollback website issue',ownerId:'u-it-lead'})) as {id:string;itTicketId:string};
    await assert.rejects(db.asUser('u-it-lead',async(svc,u)=>{
      await svc.websites.act(u,'issueStep',{issueId:issue.id,step:'resolve',note:'Synthetic fix',evidence:'Synthetic proof'});
      throw new Error('Synthetic rollback');
    }),/Synthetic rollback/);
    const b=await db.asUser('u-it-mgr',(svc,u)=>svc.websites.board(u));assert.ok(b.allowed);if(b.allowed)assert.equal(b.issues.find(x=>x.issue.id===issue.id)?.issue.status,'open');
    const ticket=await db.asUser('u-it-mgr',async(_svc,_u,store)=>store.get('itTickets',issue.itTicketId));assert.equal(ticket?.status,'open');assert.equal(ticket?.resolvedAt,null);
  });

  it('keeps both concurrent maintenance entries on the same asset', async () => {
    const asset = await db.asUser('u-it-mgr', async (svc,u) => (await svc.itBoard(u)).assets!.find(x => x.asset.status !== 'disposed')!.asset);
    await Promise.all([
      db.asUser('u-it-mgr',(svc,u)=>svc.itMaintenance(u,asset.id,'service','Synthetic concurrent service',0)),
      db.asUser('u-it-ex1',(svc,u)=>svc.itMaintenance(u,asset.id,'repair','Synthetic concurrent repair',12.34)),
    ]);
    const after = await db.asUser('u-it-mgr',async(svc,u)=>(await svc.itBoard(u)).assets!.find(x=>x.asset.id===asset.id)!.asset);
    assert.equal(after.maintenance!.length,(asset.maintenance?.length??0)+2);
    assert.ok(after.maintenance!.some(x=>x.note==='Synthetic concurrent service'&&x.cost===0));
    assert.ok(after.maintenance!.some(x=>x.note==='Synthetic concurrent repair'&&x.cost===12.34));
  });

  it('commits minimized extraction start before model and preserves append-only correlated outcomes', async () => {
    const body={kind:'tickets',source:{type:'paste',label:'PRIVATE_AUDIT_LABEL',text:'PRIVATE_AUDIT_TEXT',dataClass:'synthetic'},acknowledgement:{version:'it-extraction-v1',sendToAzure:true}};
    let calls=0,attempt='';
    const svc=new ItExtractionPreviewService({extract:async()=>{
      calls++;
      // Separate connection sees committed start: no model call is enclosed in its transaction.
      const rows=await asApp('', "SELECT data FROM prima.audit WHERE data->>'action'='arisha.extraction.started' ORDER BY seq DESC LIMIT 1");
      assert.equal(rows.rowCount,1);attempt=rows.rows[0].data.entityId;
      assert.ok(!JSON.stringify(rows.rows).includes('PRIVATE_AUDIT'));
      return {rows:[]};
    }},{enabled:true,arishaEnabled:true,sourceTypes:['paste'],dataClasses:['synthetic']},1000,extractionAudit(db));
    const result=await svc.preview({id:'u-fauzan',opsTier:'ceo',verifiedEntra:true},body);
    assert.equal(calls,1);assert.equal(result.extractionId,attempt);
    const events=await asApp('', "SELECT data FROM prima.audit WHERE data->>'entityId'=$1 ORDER BY seq",[attempt]);
    assert.equal(events.rowCount,2);assert.deepEqual(events.rows.map(r=>r.data.action),['arisha.extraction.started','arisha.extraction.terminal']);
    assert.equal(JSON.parse(events.rows[1].data.summary).outcome,'success');
    await assert.rejects(asApp('', "DELETE FROM prima.audit WHERE data->>'entityId'=$1",[attempt]));
    const failed=new ItExtractionPreviewService({extract:async()=>{throw Error('PRIVATE_PROVIDER');}},{enabled:true,arishaEnabled:true,sourceTypes:['paste'],dataClasses:['synthetic']},1000,extractionAudit(db));
    await assert.rejects(failed.preview({id:'u-fauzan',opsTier:'ceo',verifiedEntra:true},body),{message:'MODEL_UNAVAILABLE'});
    // The chain is global. The disposable test-owner connection sees every company;
    // asApp('') intentionally filters company rows and cannot verify a complete chain.
    const all=await db.pool.query("SELECT data FROM prima.audit ORDER BY seq");
    assert.equal(verifyChain(all.rows.map(r=>r.data)),null);
    assert.ok(!JSON.stringify(all.rows).includes('PRIVATE_PROVIDER'));
  });

  it('keeps durable Arisha proposals tenant-scoped and serializes duplicate submission/commit', async () => {
    const payload = { type: 'record' as const, kind: 'checkpoint' as const, id: null,
      values: { siteId: 'unused', name: 'Synthetic Arisha RLS proposal', tagCode: 'ARISHA-RLS-TEST' } };
    const site = await asApp('co-sasa', 'SELECT id FROM prima.sites LIMIT 1');
    payload.values.siteId = site.rows[0].id;
    const submit = () => db.asUser('u-audit', (svc, u) => svc.arishaDrafts.submit(u, payload, 'co-sasa', 'human'));
    const [a, b] = await Promise.all([submit(), submit()]);
    assert.equal(a.id, b.id);
    assert.equal((await asApp('co-sasa', 'SELECT id FROM prima.arisha_drafts WHERE id=$1', [a.id])).rowCount, 1);
    assert.equal((await asApp('co-inas', 'SELECT id FROM prima.arisha_drafts WHERE id=$1', [a.id])).rowCount, 0);
    await assert.rejects(asApp('co-inas', 'INSERT INTO prima.arisha_drafts(id,data) VALUES($1,$2)', ['forged-draft', {id:'forged-draft',companyId:'co-sasa'}]), /row-level security/);
    await assert.rejects(db.asUser('u-audit', (svc,u) => svc.arishaDrafts.commit(u,a.id,1)), /Not allowed/);
    const commit = () => db.asUser('u-fauzan', (svc,u) => svc.arishaDrafts.commit(u,a.id,1));
    const [first, repeated] = await Promise.all([commit(), commit()]);
    assert.equal(first.resultId, repeated.resultId);
    assert.equal(first.status, 'committed');
    const created = await asApp('co-sasa', "SELECT id FROM prima.checkpoints WHERE data->>'tagCode'=$1", ['ARISHA-RLS-TEST']);
    assert.equal(created.rowCount,1);
    const rows = await db.asUser('u-fauzan',(svc,u) => svc.arishaDrafts.list(u));
    assert.ok(rows.some(d => d.id === a.id));
    assert.ok(!('sourceVersion' in rows.find(d => d.id === a.id)!));
  });

  it('serializes Finance direct-screen and draft writers before reading their shared paper array', async () => {
    const f = (await asApp('co-sasa', "SELECT data FROM prima.fin_status WHERE id='fin-co-sasa'")).rows[0].data;
    const [paperA,paperB] = f.audit;
    for (const paper of [paperA,paperB]) await db.asUser('u-fd',(svc,u) => svc.setFinPack(u,'co-sasa','audit',paper.id,'todo'));
    const draft = await db.asUser('u-audit',(svc,u) => svc.arishaDrafts.submit(u,{type:'finance-paper',pack:'audit',itemId:paperA.id,status:'prepared'},'co-sasa','human'));
    const blocker = new Client({connectionString:URL}); await blocker.connect();
    let committed: Promise<unknown>|undefined, direct: Promise<unknown>|undefined;
    const waitForLocks = async (count:number) => {
      for (let n=0;n<100;n++) {
        // The blocker keeps one transaction open to hold the finance row lock.
        // PostgreSQL caches pg_stat_activity within that transaction; refresh its
        // statistics snapshot before observing each newly blocked writer.
        // https://www.postgresql.org/docs/16/monitoring-stats.html
        await blocker.query('SELECT pg_stat_clear_snapshot()');
        const state = await blocker.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%prima.fin_status%'");
        if (state.rows[0].n >= count) return;
        await new Promise(resolve => setTimeout(resolve,20));
      }
      throw new Error('Finance writers did not reach the test lock barrier.');
    };
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT id FROM prima.fin_status WHERE id='fin-co-sasa' FOR UPDATE");
      committed = db.asUser('u-fd',(svc,u) => svc.arishaDrafts.commit(u,draft.id,draft.version));
      await waitForLocks(1);
      direct = db.asUser('u-fd',(svc,u) => svc.setFinPack(u,'co-sasa','audit',paperB.id,'prepared'));
      await waitForLocks(2);
      await blocker.query('COMMIT');
      await Promise.all([committed,direct]);
    } finally { await blocker.query('ROLLBACK').catch(()=>undefined); await blocker.end(); await Promise.allSettled([committed,direct].filter(Boolean)); }
    const updated = (await asApp('co-sasa', "SELECT data FROM prima.fin_status WHERE id='fin-co-sasa'")).rows[0].data;
    assert.equal(updated.audit.find((p:{id:string})=>p.id===paperA.id).status,'prepared');
    assert.equal(updated.audit.find((p:{id:string})=>p.id===paperB.id).status,'prepared');
  });

  it('shows the app role only the companies in app.company_ids', async () => {
    const res = await asApp('co-sasa', 'SELECT DISTINCT company_id FROM prima.people');
    assert.deepEqual(
      res.rows.map((r) => r.company_id),
      ['co-sasa'],
    );
    const companies = await asApp('co-sasa,co-inas', 'SELECT id FROM prima.companies ORDER BY id');
    assert.deepEqual(
      companies.rows.map((r) => r.id),
      ['co-inas', 'co-sasa'],
    );
  });

  it('allows only CEO-authenticated transactions to update an existing company master row', async () => {
    const before = await asApp('co-sasa', "SELECT data->>'code' AS code, data->>'ssmNo' AS ssm FROM prima.companies WHERE id = 'co-sasa'");
    assert.equal(before.rows[0].ssm, null);
    // A non-CEO transaction has company read access but no company-master UPDATE policy.
    const unauthorized = await asApp('co-sasa', "UPDATE prima.companies SET data = jsonb_set(data, '{name}', '\"Forged Name\"'::jsonb) WHERE id = 'co-sasa' RETURNING id");
    assert.equal(unauthorized.rowCount, 0);
    const result = await db.asUser('u-fauzan', (svc, user) => svc.saveRecord(user, 'company', null, 'co-sasa', {
      name: 'Sasa Security Services Sdn Bhd',
      ssmNo: '201901002101',
      registeredOn: '2019-01-14',
      registeredAddress: 'No. 1 Jalan Contoh, Selangor',
      businessAddress: 'No. 2 Jalan Contoh, Selangor',
      state: 'Selangor',
      headOfCompany: 'Head of company',
      sourceRef: 'SSM profile no. 201901002101, dated 2026-10-30',
      verificationStatus: 'verified',
    }));
    assert.equal((result as { id: string }).id, 'co-sasa');
    const after = await asApp('co-sasa', "SELECT data->>'code' AS code, data->>'ssmNo' AS ssm FROM prima.companies WHERE id = 'co-sasa'");
    assert.equal(after.rows[0].code, before.rows[0].code);
    assert.equal(after.rows[0].ssm, '201901002101');
    await assert.rejects(db.asUser('u-fd', (svc, user) => svc.saveRecord(user, 'company', null, 'co-sasa', {
      name: 'Forged', ssmNo: '201901002109', state: 'Selangor', sourceRef: 'No proof', verificationStatus: 'draft',
    })), /Not allowed/);
  });

  it('shows nothing when no company is set', async () => {
    const res = await asApp('', 'SELECT count(*)::int AS n FROM prima.shifts');
    assert.equal(res.rows[0].n, 0);
  });

  it('refuses to write a row into another company', async () => {
    await assert.rejects(
      asApp('co-sasa', `INSERT INTO prima.cases (id, company_id, data) VALUES ('x', 'co-arsh', '{"id":"x","companyId":"co-arsh"}')`),
      /row-level security/,
    );
  });

  it('refuses to move a row to another company', async () => {
    await assert.rejects(
      asApp('co-sasa', `UPDATE prima.people SET company_id = 'co-arsh' WHERE company_id = 'co-sasa'`),
      /row-level security|violates check constraint/,
    );
  });

  it('keeps the audit log append-only', async () => {
    await assert.rejects(asApp('co-sasa', 'DELETE FROM prima.audit'), /permission denied/);
    const owner = new Client({ connectionString: URL });
    await owner.connect();
    await assert.rejects(owner.query('UPDATE prima.audit SET data = data'), /append-only/);
    await owner.end();
  });

  it('runs a service call under the wall and chains the audit entry', async () => {
    const result = await db.asUser('u-cm-sasa', async (svc, user) => {
      const cases = await svc.cases(user);
      assert.ok(cases.every((c) => c.companyId === 'co-sasa'));
      return svc.raiseCase(user, {
        companyId: 'co-sasa',
        siteId: null,
        type: 'COMPLAINT',
        severity: 'P3',
        title: 'Test case',
        description: 'From the test',
        proof: [proof()],
      });
    });
    assert.match(result.ref, /^SASA-C\d{4}$/);
    const all = new Client({ connectionString: URL });
    await all.connect();
    const rows = (await all.query('SELECT data FROM prima.audit ORDER BY seq')).rows.map((r) => r.data as AuditEntry);
    await all.end();
    assert.equal(verifyChain(rows), null);
    assert.equal(rows[rows.length - 1].action, 'case.raise');
  });

  it('holds an IT record while one request acts on it, so a double click accepts a job once', async () => {
    const jobs = await db.asUser('u-it-mgr', async (svc, user) => (await svc.itBoard(user)).jobs ?? []);
    const row = jobs.find((r) => r.job.status === 'submitted' && !r.job.technical);
    assert.ok(row, 'a submitted job in the test data');
    // The first request keeps its transaction open a moment after acting; the second arrives meanwhile.
    const accept = (holdMs: number) =>
      db.asUser('u-it-mgr', async (svc, user) => {
        const j = await svc.itJobStep(user, row.job.id, 'accept', 'Proof checked');
        await new Promise((r) => setTimeout(r, holdMs));
        return j;
      });
    const first = accept(300);
    await new Promise((r) => setTimeout(r, 100));
    const res = await Promise.allSettled([first, accept(0)]);
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
    const all = new Client({ connectionString: URL });
    await all.connect();
    const n = (await all.query(`SELECT count(*)::int AS n FROM prima.audit WHERE data->>'action' = 'it.job.accept' AND data->>'entityId' = $1`, [row.job.id])).rows[0].n;
    await all.end();
    assert.equal(n, 1);
  });

  it('stops a company manager reaching another company through the service', async () => {
    await assert.rejects(
      db.asUser('u-cm-sasa', (svc, user) => svc.companyDashboard(user, 'co-arsh')),
      /Not allowed/,
    );
  });

  it('keeps tenders and quotations behind the company wall', async () => {
    const res = await asApp('co-arsh', 'SELECT DISTINCT company_id FROM prima.quotations UNION SELECT DISTINCT company_id FROM prima.tenders');
    assert.deepEqual(
      res.rows.map((r) => r.company_id),
      ['co-arsh'],
    );
    const view = await db.asUser('u-ae-arsh', (svc, user) => svc.commercial(user, 'co-arsh'));
    assert.ok(view.quotations.length > 0);
    await assert.rejects(
      db.asUser('u-ae-arsh', (svc, user) => svc.commercial(user, 'co-inas')),
      /Not allowed/,
    );
  });

  it('keeps firearms behind the company wall', async () => {
    const res = await asApp(
      'co-inas',
      'SELECT DISTINCT company_id FROM prima.firearms UNION SELECT DISTINCT company_id FROM prima.arms_movements UNION SELECT DISTINCT company_id FROM prima.vaults',
      [],
      'arms',
    );
    assert.deepEqual(
      res.rows.map((r) => r.company_id),
      ['co-inas'],
    );
    const view = await db.asUser('u-cm-inas', (svc, user) => svc.arms(user, 'co-inas'));
    assert.ok(view.firearms.length > 0);
    const hr = await db.asUser('u-pwvsb-hr', (svc, user) => svc.hrMonitor(user));
    assert.equal(hr.rows.length, 38);
  });

  it('shows a Regional Operations Manager only the companies granted for the region', async () => {
    const north = await db.asUser('u-rom-north', (svc, user) => svc.regionalOps(user));
    assert.deepEqual(
      north.rows.filter((r) => r.hasDetail).map((r) => r.company.id),
      ['co-arsh'],
    );
    await assert.rejects(
      db.asUser('u-rom-north', (svc, user) => svc.regionalOps(user, 'central')),
      /Not allowed/,
    );
    await assert.rejects(
      db.asUser('u-rom-north', (svc, user) => svc.siteDetail(user, 'st-sasa-001')),
      /Not allowed|not found/,
    );
    const arshCentral = await db.asUser('u-rom-north', async (svc, user) => {
      const sites = await svc.sites(user, 'co-arsh');
      const north = [];
      for (const r of sites) if ((await svc.siteDetail(user, r.site.id)).patrol.canSet) north.push(r.site.id);
      return north[0];
    });
    const saved = await db.asUser('u-rom-north', (svc, user) => svc.setPatrolInterval(user, arshCentral, { minutes: 60, note: 'Client request' }));
    assert.equal(saved.intervalMin, 60);
    const back = await db.asUser('u-cm-arsh', (svc, user) => svc.siteDetail(user, arshCentral));
    assert.equal(back.patrol.intervalMin, 60);
  });

  it('lets Arms Control fill a CMS gap and read suppliers through the app role', async () => {
    const board = await db.asUser('u-pwvsb-arms', (svc, user) => svc.armsControl(user));
    assert.ok(board.suppliers.length > 0 && board.jobs.length > 0);
    const gap = board.cms.find((c) => c.state === 'uncovered');
    assert.ok(gap);
    const name = board.cmsStaff.find((n) => !board.cms.some((c) => c.shift.staffName === n && c.shift.start < gap.shift.end && gap.shift.start < c.shift.end));
    const r = await db.asUser('u-pwvsb-arms-asst', (svc, user) => svc.assignCmsShift(user, gap.shift.id, name!));
    assert.equal(r.staffName, name);
    await assert.rejects(
      db.asUser('u-pwvsb-arms', (svc, user) => svc.people(user, 'co-sasa')),
      /Not allowed/,
    );
  });

  it('two Arms Control staff taking the same person off the same CMS seat at once: the seat lock lets only one through', async () => {
    const board = await db.asUser('u-pwvsb-arms', (svc, user) => svc.cms(user));
    const seats = board.roster.flatMap((r) => r.seats).filter((s) => s.state === 'later' && s.shift.staffName);
    const target = seats.at(-1)!;
    assert.ok(target);
    const both = await Promise.allSettled([
      db.asUser('u-pwvsb-arms', (svc, user) => svc.releaseCmsSeat(user, target.shift.id, 'MC (mock) one')),
      db.asUser('u-pwvsb-arms-asst', (svc, user) => svc.releaseCmsSeat(user, target.shift.id, 'MC (mock) two')),
    ]);
    assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
    const after = await db.asUser('u-pwvsb-arms', (svc, user) => svc.cms(user));
    const seat = after.roster.flatMap((r) => r.seats).find((s) => s.shift.id === target.shift.id)!;
    assert.equal(seat.shift.released?.length, (target.shift.released?.length ?? 0) + 1);
  });

  it('takes a person off a CMS seat with the reason, and shows the hours record to Arms Control only, through the app role', async () => {
    const board = await db.asUser('u-pwvsb-arms', (svc, user) => svc.cms(user));
    assert.ok(board.hours);
    const later = board.roster.flatMap((r) => r.seats).find((s) => s.state === 'later' && s.shift.staffName);
    assert.ok(later);
    await assert.rejects(db.asUser('u-cms-head', (svc, user) => svc.releaseCmsSeat(user, later.shift.id, 'MC (mock)')), /Not allowed/);
    const r = await db.asUser('u-pwvsb-arms', (svc, user) => svc.releaseCmsSeat(user, later.shift.id, 'MC (mock)'));
    assert.equal(r.staffName, null);
    assert.equal(r.released?.at(-1)?.reason, 'MC (mock)');
    const desk = await db.asUser('u-cms-head', (svc, user) => svc.cms(user));
    assert.equal(desk.hours, null);
  });

  it('reads the V14 arms tables and records an Arms Control review through the app role', async () => {
    const board = await db.asUser('u-pwvsb-arms', (svc, user) => svc.armsControl(user));
    assert.ok(board.ammo.length > 0 && board.doors.length > 0 && board.agreements.length > 0 && board.readiness.length > 0);
    const req = board.requests.find((r) => r.request.state === 'arms_review');
    assert.ok(req);
    const r = await db.asUser('u-pwvsb-arms-asst', (svc, user) => svc.reviewArmsRequest(user, req.request.id, 'pass', 'Papers checked'));
    assert.equal(r.state, 'company_auth');
    await assert.rejects(
      // Another company's manager: the database hides the row, so the request is simply not found.
      db.asUser('u-cm-arsh', (svc, user) => svc.reviewArmsRequest(user, req.request.id, 'pass', '')),
      /Not allowed|not found/,
    );
  });

  it('shows the Chief of Staff every company insurance record and a company only its own', async () => {
    const cos = await db.asUser('u-cos', (svc, user) => svc.insurance(user));
    assert.equal(cos.rows.length, 38);
    assert.ok(cos.policies.length > 0 && cos.claims.length > 0 && cos.guarantees.length > 0);
    const own = await db.asUser('u-cm-inas', (svc, user) => svc.insurance(user));
    assert.deepEqual([...new Set(own.policies.map((p) => p.policy.companyId))], ['co-inas']);
    const res = await asApp(
      'co-inas',
      'SELECT DISTINCT company_id FROM prima.insurance_policies UNION SELECT DISTINCT company_id FROM prima.insurance_guarantees',
    );
    assert.deepEqual(
      res.rows.map((r) => r.company_id),
      ['co-inas'],
    );
    await assert.rejects(
      db.asUser('u-pwvsb-hr', (svc, user) => svc.insurance(user)),
      /Not allowed/,
    );
  });

  it('runs the CMS desk and settings through the app role, with phone records behind the company wall', async () => {
    const board = await db.asUser('u-cms-head', (svc, user) => svc.cms(user));
    assert.ok(board.callbacks.length > 0 && board.extensions.length > 0);
    const res = await asApp('co-arsh', 'SELECT DISTINCT company_id FROM prima.phone_calls UNION SELECT DISTINCT company_id FROM prima.phone_extensions');
    assert.deepEqual(
      res.rows.map((r) => r.company_id),
      ['co-arsh'],
    );
    const call = board.callbacks[0].call;
    const done = await db.asUser('u-cms-head', (svc, user) => svc.logCallback(user, call.id, 'Passed to the duty officer'));
    assert.ok(done.callbackAt);
    const r = await db.asUser('u-pwvsb-arms', (svc, user) => svc.updateCmsSettings(user, { monitorOfficersPerShift: 2 }));
    assert.ok(r.replanned && r.replanned.added > 0);
    const plan = await db.asUser('u-pwvsb-arms', (svc, user) => svc.planCmsRoster(user, 3));
    assert.ok(plan.added > 0);
    await assert.rejects(
      db.asUser('u-cms-head', (svc, user) => svc.updateCmsSettings(user, { forwardAfterSec: 30 })),
      /Not allowed/,
    );
  });

  it('lets CMS watch every site and turn a real alarm into the company own case', async () => {
    const board = await db.asUser('u-cms-head', (svc, user) => svc.cms(user));
    assert.ok(board.ops.tiles.sites > 0 && board.ops.alarms.length > 0);
    const res = await asApp('co-inas', 'SELECT DISTINCT company_id FROM prima.site_alarms UNION SELECT DISTINCT company_id FROM prima.site_systems');
    assert.deepEqual(
      res.rows.map((r) => r.company_id),
      ['co-inas'],
    );
    const alarm = board.ops.alarms.find((a) => a.alarm.status === 'new')!.alarm;
    await db.asUser('u-cms-head', (svc, user) => svc.acknowledgeAlarm(user, alarm.id));
    const closed = await db.asUser('u-cms-head', (svc, user) => svc.closeAlarm(user, alarm.id, 'real', 'Confirmed on camera'));
    assert.ok(closed.caseId);
    const cases = await asApp(alarm.companyId, `SELECT company_id FROM prima.cases WHERE id = '${closed.caseId}'`);
    assert.equal(cases.rows[0].company_id, alarm.companyId);
  });

  it('keeps attendance follow-ups behind the company wall and lets CMS only contact the guard', async () => {
    // Run at mid-morning of the seeded day, while the day shift is on, so the result does not depend on the hour the test runs.
    const morning = () => myt(dateOf(nowMyt()), '10:00');
    const a = await db.asUser('u-cm-sasa', (svc, user) => svc.attendanceAlerts(user, 'co-sasa'), morning);
    const ns = a.open.find((i) => i.issue === 'NO_SHOW')!;
    assert.ok(ns && ns.repeating);
    const r = await db.asUser(
      'u-cms-head',
      (svc, user) => svc.followUpAttendance(user, { shiftId: ns.shiftId, issue: 'NO_SHOW', kind: 'STAFF_ALERTED', note: 'Called' }),
      morning,
    );
    assert.equal(r.record.byDesk, 'cms');
    await assert.rejects(
      db.asUser('u-cms-head', (svc, user) => svc.followUpAttendance(user, { shiftId: ns.shiftId, issue: 'NO_SHOW', kind: 'EXCUSED', note: 'MC' }), morning),
      /Not allowed/,
    );
    const res = await asApp('co-arsh', 'SELECT DISTINCT company_id FROM prima.attendance_followups');
    assert.ok(res.rows.every((x) => x.company_id === 'co-arsh'));
    const own = await asApp('co-sasa', 'SELECT count(*)::int AS n FROM prima.attendance_followups');
    assert.ok(own.rows[0].n >= 2);
  });

  it('keeps photo evidence and site visits behind the company wall', async () => {
    const jpeg = 'data:image/jpeg;base64,' + Buffer.from('api-photo'.repeat(30)).toString('base64');
    const visit = await db.asUser('u-sv-sasa', async (svc, user) => {
      const site = await svc.siteDetail(user, user.siteIds[2]);
      const v = await svc.startSiteVisit(user, site.site.id, { lat: site.site.lat, lng: site.site.lng, accuracyM: 5, purpose: 'Routine check' });
      await svc.addVisitPhoto(user, v.id, { image: jpeg, lat: site.site.lat, lng: site.site.lng, accuracyM: 5 });
      return svc.closeSiteVisit(user, v.id, 'All in order');
    });
    assert.equal(visit.status, 'closed');
    const res = await asApp('co-inas', 'SELECT DISTINCT company_id FROM prima.evidence_photos UNION SELECT DISTINCT company_id FROM prima.site_visits');
    assert.ok(res.rows.every((x) => x.company_id === 'co-inas'));
    const own = await asApp('co-sasa', 'SELECT count(*)::int AS n FROM prima.evidence_photos');
    assert.ok(own.rows[0].n >= 2);
  });

  it('signs a device report by face and walks the case up to the Regional OM through the app role', async () => {
    const c = await db.asUser('u-dev-sasa-001', (svc, user) =>
      svc.raiseCase(user, {
        companyId: 'co-sasa',
        siteId: user.siteIds[0],
        type: 'COMPLAINT',
        severity: 'P3',
        title: 'Broken fence',
        description: '',
        reporter: { staffNo: 'SASA0002', face: { score: 0.93, live: true } },
        proof: [proof()],
      }),
    );
    assert.equal(c.reporter?.face, 'confirmed');
    await db.asUser('u-sv-sasa', (svc, user) => svc.signOffCase(user, c.id, 'resolved', 'Fence tied, client told', [proof()]));
    await db.asUser('u-po-sasa-1', (svc, user) => svc.signOffCase(user, c.id, 'verified', 'Seen on patrol', [proof()]));
    await db.asUser('u-om-klang', (svc, user) => svc.signOffCase(user, c.id, 'verified', 'Client confirmed', [proof()]));
    const done = await db.asUser('u-rom-central', (svc, user) => svc.signOffCase(user, c.id, 'confirmed', 'All resolved', [proof()]));
    assert.equal(done.status, 'resolved');
    // Each step's proof sits behind the company wall.
    const docs = await asApp('co-sasa', 'SELECT count(*)::int AS n FROM prima.evidence_docs');
    assert.ok(docs.rows[0].n >= 5);
    const other = await asApp('co-inas', 'SELECT DISTINCT company_id FROM prima.evidence_docs');
    assert.ok(other.rows.every((x) => x.company_id === 'co-inas'));
    const mine = await db.asUser('u-rom-central', (svc, user) => svc.cases(user, { waiting: 'me' }));
    assert.ok(mine.every((x) => x.mine));
    // Which cases sit at the ROM level depends on the time the mock data was made; each one there is the ROM's own.
    assert.ok(mine.every((x) => (x.ladder?.level === 'ROM' ? x.mine === 'own' : x.mine === 'step_in')));
  });

  it('takes leave on the site device and lets only the area OM decide it, behind the company wall', async () => {
    const q = await db.asUser('u-dev-sasa-001', (svc, user) =>
      svc.requestLeave(user, {
        staffNo: 'SASA0002',
        face: { score: 0.93, live: true },
        kind: 'ANNUAL',
        from: addDays(dateOf(svc.now()), 3),
        to: addDays(dateOf(svc.now()), 3),
        reason: 'Family matters',
      }),
    );
    assert.equal(q.status, 'pending');
    await assert.rejects(db.asUser('u-cm-sasa', (svc, user) => svc.decideLeave(user, q.id, true, 'ok')));
    const own = await asApp('co-inas', 'SELECT count(*)::int AS n FROM prima.leave_requests WHERE company_id = $1', ['co-sasa']);
    assert.equal(own.rows[0].n, 0);
  });

  it("shows a guard's own sign-in only their own record", async () => {
    const d = await db.asUser('u-guard-sasa-1', (svc, user) => svc.myDuty(user));
    assert.ok(d.roster.length > 0);
    assert.ok(d.clockRecord.length > 0);
    await assert.rejects(db.asUser('u-guard-sasa-1', (svc, user) => svc.companyDashboard(user, 'co-sasa')));
    await assert.rejects(db.asUser('u-guard-sasa-1', (svc, user) => svc.people(user, 'co-sasa')));
    const cases = await db.asUser('u-guard-sasa-1', (svc, user) => svc.cases(user));
    assert.equal(cases.length, 0);
  });

  it('keeps staff clocks behind the company wall, central staff to group users, and pings only while clocked in', async () => {
    const img = 'data:image/jpeg;base64,' + Buffer.from('staff').toString('base64');
    const shot = { image: img, capturedAt: new Date().toISOString(), lat: 3.0567, lng: 101.5851, accuracyM: 8, face: null };
    await assert.rejects(
      db.asUser('u-cm-inas', (svc, u) => svc.staffPing(u, { lat: 3, lng: 101, accuracyM: 5 })),
      /only while/,
    );
    const rec = await db.asUser('u-cm-inas', (svc, u) => svc.staffClockIn(u, shot));
    assert.equal(rec.companyId, 'co-inas');
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.staffClockDetail(u, rec.id)));
    // Central staff clock in from 08:45 in the mock data, so at night clock one in here; already in is fine.
    // A clock photo is used once (insider abuse item 13), so each clock below takes its own picture.
    await db.asUser('u-pwvsb-doa', (svc, u) => svc.staffClockIn(u, { ...shot, image: img + 'ZG9h' })).catch(() => undefined);
    const hr = await db.asUser('u-pwvsb-hr', (svc, u) => svc.staffClockBoard(u));
    assert.ok(hr.rows.some((r) => r.userId === 'u-cm-inas' && r.status === 'in'));
    assert.ok(hr.rows.some((r) => r.company === 'PWVSB (central)' && r.status === 'in'));
    // A company manager reads no PWVSB central staff rows in the database itself.
    const central = await asApp('co-sasa', 'SELECT count(*)::int AS n FROM prima.staff_clocks WHERE company_id IS NULL');
    assert.equal(central.rows[0].n, 0);
    const sasa = await db.asUser('u-cm-sasa', (svc, u) => svc.staffClockBoard(u));
    assert.ok(sasa.rows.every((r) => r.company.startsWith('Sasa')));
    const out = await db.asUser('u-cm-inas', (svc, u) => svc.staffClockOut(u, { ...shot, image: img + 'b3V0' }));
    assert.ok(out.out);
  });

  it('keeps working from home behind the company wall and lets only HR answer', async () => {
    // A company manager reads no central staff arrangements in the database itself.
    const central = await asApp('co-sasa', 'SELECT count(*)::int AS n FROM prima.remote_arrangements WHERE company_id IS NULL');
    assert.equal(central.rows[0].n, 0);
    const cm = await db.asUser('u-cm-arsh', (svc, u) => svc.remoteBoard(u));
    assert.deepEqual(
      cm.applications.map((a) => a.arrangement.userId),
      ['u-ae-arsh'],
    );
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.remoteDecide(u, 'wfh-u-ae-arsh-1', true, '')));
    // Only HR answers working from home applications (Fauzan, 2 Nov 2026); the company manager monitors.
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.remoteDecide(u, 'wfh-u-ae-arsh-1', true, 'Approved for Wednesdays.')));
    const ok = await db.asUser('u-pwvsb-hr', (svc, u) => svc.remoteDecide(u, 'wfh-u-ae-arsh-1', true, 'Approved for Wednesdays.'));
    assert.equal(ok.status, 'approved');
    const hr = await db.asUser('u-pwvsb-hr', (svc, u) => svc.remoteBoard(u));
    assert.ok(hr.people.some((p) => p.arrangement.userId === 'u-it-ex1'));
  });

  it('keeps work tasks and branch records behind the company wall, and runs the work plan through the app role', async () => {
    // A Sasa sign-in reads no central staff tasks and no Arrow Shield branch checklists in the database itself.
    const central = await asApp('co-sasa', 'SELECT count(*)::int AS n FROM prima.work_tasks WHERE company_id IS NULL');
    assert.equal(central.rows[0].n, 0);
    const arsh = await asApp('co-sasa', "SELECT count(*)::int AS n FROM prima.branch_checks WHERE company_id = 'co-arsh'");
    assert.equal(arsh.rows[0].n, 0);
    const mine = await db.asUser('u-it-ex1', (svc, u) => svc.myWork(u));
    assert.equal(mine.manager?.id, 'u-it-lead');
    const team = await db.asUser('u-it-lead', (svc, u) => svc.teamWork(u));
    assert.ok(team.people.some((p) => p.userId === 'u-it-ex1'));
    const bm = await db.asUser('u-bm-arsh-2', (svc, u) => svc.branchWork(u));
    assert.deepEqual(
      bm.branches.map((b) => b.id),
      ['br-arsh-2'],
    );
    const cm = await db.asUser('u-cm-sasa', (svc, u) => svc.branchWork(u));
    assert.ok(cm.branches.every((b) => b.id.startsWith('br-sasa')));
    const sum = await db.asUser('u-fauzan', (svc, u) => svc.workSummary(u));
    assert.equal(sum.branches.length, 9);
  });

  it('keeps SOCSO claims behind the company wall and runs one through the app role', async () => {
    const c = await db.asUser('u-ae-arsh', async (svc, u) => {
      const p = (await svc.people(u, 'co-arsh')).find((x) => x.person.role === 'guard')!.person;
      return svc.startSocsoClaim(u, p.id, {
        type: 'WORK_ACCIDENT',
        incidentAt: new Date(Date.now() - 3_600_000).toISOString(),
        toldAt: new Date(Date.now() - 1_800_000).toISOString(),
        place: 'Gate',
        description: 'Cut hand on the boom gate during the morning shift.',
      });
    });
    await db.asUser('u-ae-arsh', (svc, u) => svc.addSocsoDoc(u, c.id, 'INCIDENT', [proof()]));
    await db.asUser('u-ae-arsh', (svc, u) => svc.advanceSocsoClaim(u, c.id, 'REPORTED', { perkesoRef: 'ASSIST-RLS-1' }));
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.socsoClaimDetail(u, c.id)));
    const seen = await asApp('co-sasa', 'SELECT count(*)::int AS n FROM prima.socso_claims WHERE company_id = $1', ['co-arsh']);
    assert.equal(seen.rows[0].n, 0);
    const list = await db.asUser('u-cm-arsh', (svc, u) => svc.socsoClaims(u));
    assert.ok(list.rows.some((r) => r.claim.id === c.id && r.claim.perkesoRef === 'ASSIST-RLS-1'));
  });

  it('keeps FWM tasks inside the company wall and lets FWM and the OM work them', async () => {
    const np = await asApp(
      'co-sasa',
      "SELECT id FROM prima.people WHERE company_id = 'co-sasa' AND data->>'nationality' = 'NP' AND data->>'role' = 'guard' LIMIT 1",
    );
    const t = await db.asUser('u-fwm-ex1', (svc, u) =>
      svc.createFwmTask(u, np.rows[0].id, { kind: 'FOMEMA', what: 'Bring for the FOMEMA check', place: 'Klang', dueOn: dateOf(svc.now()) }),
    );
    const seen = await asApp('co-arsh', 'SELECT count(*)::int AS n FROM prima.fwm_tasks WHERE company_id = $1', ['co-sasa']);
    assert.equal(seen.rows[0].n, 0);
    const cm = await db.asUser('u-cm-arsh', (svc, u) => svc.fwmBoard(u));
    assert.ok(!cm.tasks.some((x) => x.task.id === t.id));
    if (t.omUserId) {
      await db.asUser(t.omUserId, (svc, u) => svc.doneFwmTask(u, t.id, 'Done', [proof()]));
      const done = await db.asUser('u-fwm-mgr', (svc, u) => svc.reviewFwmTask(u, t.id, true, 'Permit copy checked'));
      assert.equal(done.status, 'accepted');
    }
  });

  it('records FWM papers, acknowledgements and JA workers through the restricted login, inside the company wall', async () => {
    const np = await asApp(
      'co-sasa',
      "SELECT id, data->>'staffNo' AS staff FROM prima.people WHERE company_id = 'co-sasa' AND data->>'nationality' = 'NP' AND data->>'role' = 'guard' AND data->>'status' = 'active' LIMIT 1",
    );
    const id = np.rows[0].id as string;
    const today = await db.asUser('u-fwm-ex1', async (svc) => dateOf(svc.now()));
    const saved = await db.asUser('u-fwm-ex1', (svc, u) =>
      svc.recordFwPaper(u, id, 'FOMEMA', { mode: 'correct', number: 'RLS-FOMEMA-1', issuedOn: addDays(today, -340), expiresOn: addDays(today, 25), reason: 'RLS test: synthetic date' }, [proof()]),
    );
    assert.equal(saved.source, 'prima');
    const wall = await asApp('co-arsh', 'SELECT count(*)::int AS n FROM prima.credentials WHERE id = $1', [saved.id]);
    assert.equal(wall.rows[0].n, 0);
    // Another company's manager does not see it; the FWM despatch cannot record.
    const cm = await db.asUser('u-cm-arsh', (svc, u) => svc.fwmBoard(u));
    assert.ok(!cm.items.some((i) => i.credentialId === saved.id));
    await assert.rejects(db.asUser('u-fwm-desp', (svc, u) => svc.recordFwPaper(u, id, 'FOMEMA', { mode: 'new', number: 'RLS-X', issuedOn: today, expiresOn: addDays(today, 400) }, [proof()])));
    // At 25 days FWM and the Chief of Staff acknowledge; the COO is not reached yet.
    await db.asUser('u-cos', (svc, u) => svc.ackFwPaper(u, saved.id, 'RLS ack'));
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.ackFwPaper(u, saved.id, '')), /Nothing to acknowledge/);
    const row = await asApp('co-sasa', "SELECT data->'fwAcks' AS acks FROM prima.credentials WHERE id = $1", [saved.id]);
    assert.equal(row.rows[0].acks[0].level, 'CHIEF_OF_STAFF');
    // A worker sent by the JA app is added by FWM, and Prima's recorded paper goes back to the JA app.
    await db.asUser('u-ja-sync', (svc, u) =>
      svc.jaIngest(u, 'worker', [{ company: 'SASA', externalId: 'RLS-W-1', updatedAt: new Date().toISOString(), staffNo: 'RLS-NP-1', name: 'RLS Worker', nationality: 'Nepal', status: 'active', papers: [{ paper: 'PLKS', expiresOn: addDays(today, 60) }] }], ['SASA']),
    );
    const board = await db.asUser('u-fwm-ex1', (svc, u) => svc.fwmBoard(u));
    const ja = board.alignment!.jaOnly.find((w) => w.staffNo === 'RLS-NP-1')!;
    const branch = await asApp('co-sasa', "SELECT id FROM prima.branches WHERE company_id = 'co-sasa' LIMIT 1");
    const added = await db.asUser('u-fwm-ex1', (svc, u) => svc.addFwWorkerFromJa(u, ja.recordId, { branchId: branch.rows[0].id, hiredOn: '2024-02-01', dob: '1994-03-03' }));
    assert.equal(added.papers, 1);
    const back = await db.asUser('u-ja-sync', (svc, u) => svc.jaFwPaperChanges(u, null));
    assert.ok(back.records.some((r) => r.kind === 'paper' && r.staffNo === np.rows[0].staff && r.paper === 'FOMEMA'));
    await assert.rejects(db.asUser('u-fwm-ex1', (svc, u) => svc.jaFwPaperChanges(u, null)));
  });

  it('lets the COO check FWM and staff tasks through the restricted login, and the people told read their notices', async () => {
    const np = await asApp(
      'co-sasa',
      "SELECT id FROM prima.people WHERE company_id = 'co-sasa' AND data->>'nationality' = 'NP' AND data->>'role' = 'guard' LIMIT 1",
    );
    const t = await db.asUser('u-fwm-ex1', (svc, u) =>
      svc.createFwmTask(u, np.rows[0].id, { kind: 'JIM', what: 'COO RLS check', place: 'Shah Alam', dueOn: dateOf(svc.now()) }),
    );
    if (t.omUserId) {
      await db.asUser(t.omUserId, (svc, u) => svc.doneFwmTask(u, t.id, 'Done', [proof()]));
      const coo = await db.asUser('u-coo', (svc, u) => svc.fwmBoard(u));
      assert.ok(coo.tasks.some((x) => x.task.id === t.id && x.canReview));
      const done = await db.asUser('u-coo', (svc, u) => svc.reviewFwmTask(u, t.id, true, 'Checked the slip myself.'));
      assert.equal(done.status, 'accepted');
      for (const uid of ['u-fwm-mgr', 'u-fwm-dep', 'u-fwm-ex1']) {
        const b = await db.asUser(uid, (svc, u) => svc.fwmBoard(u));
        const n = b.cooNotices.find((x) => x.recId === t.id);
        assert.ok(n, `${uid} is told`);
        await db.asUser(uid, (svc, u) => svc.seenCooNotice(u, 'fwm', t.id, n.noticeId));
      }
    }
    const w = await db.asUser('u-it-lead', (svc, u) =>
      svc.workTaskAdd(u, { userId: 'u-it-ex1', title: 'COO RLS work check', doneMeans: 'Output attached with the reference.', dueAt: new Date(Date.parse(svc.now()) + 2 * 86_400_000).toISOString(), priority: 'normal' }),
    );
    await db.asUser('u-it-ex1', (svc, u) => svc.workTaskDone(u, w.id, { note: 'Attached', ref: 'RLS-1' }));
    await db.asUser('u-coo', (svc, u) => svc.workTaskReview(u, w.id, true, 'Seen it working on site.'));
    const lead = await db.asUser('u-it-lead', (svc, u) => svc.myWork(u));
    const n = lead.cooNotices.find((x) => x.recId === w.id);
    assert.ok(n, 'the IT Lead is told');
    await db.asUser('u-it-lead', (svc, u) => svc.seenCooNotice(u, 'work', w.id, n.noticeId));
    assert.ok(!(await db.asUser('u-it-lead', (svc, u) => svc.myWork(u))).cooNotices.some((x) => x.recId === w.id));
    // Finance is not a department the COO directly monitors: refused even with a reason.
    const f = await db.asUser('u-fin-t1-lead', (svc, u) =>
      svc.workTaskAdd(u, { userId: 'u-fin-t1-de1', title: 'COO RLS finance check', doneMeans: 'Output attached with the reference.', dueAt: new Date(Date.parse(svc.now()) + 2 * 86_400_000).toISOString(), priority: 'normal' }),
    );
    await db.asUser('u-fin-t1-de1', (svc, u) => svc.workTaskDone(u, f.id, { note: 'Attached', ref: 'RLS-2' }));
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.workTaskReview(u, f.id, true, 'Looks right from the bank file.')));
  });

  it('a manager moves and readjusts work with a reason on PostgreSQL; a colleague cannot (Fauzan, 2 Nov 2026)', async () => {
    const due = (svc: { now(): string }, days: number) => new Date(Date.parse(svc.now()) + days * 86_400_000).toISOString();
    const w = await db.asUser('u-it-lead', (svc, u) =>
      svc.workTaskAdd(u, { userId: 'u-it-ex1', title: 'Rebalance RLS move check', doneMeans: 'Output attached with the reference.', dueAt: due(svc, 2), priority: 'normal' }),
    );
    await assert.rejects(db.asUser('u-it-ex2', (svc, u) => svc.workTaskReassign(u, w.id, { expectedVersion: w.version, toUserId: 'u-it-ex2', reason: 'I will take it' })));
    // Two managers' screens loaded the same version and move at once: exactly one wins, the other is told to reload.
    const race = await Promise.allSettled([
      db.asUser('u-it-lead', (svc, u) => svc.workTaskReassign(u, w.id, { expectedVersion: w.version, toUserId: 'u-it-ex3', reason: 'Ex1 is on site all week' })),
      db.asUser('u-it-mgr', (svc, u) => svc.workTaskReassign(u, w.id, { expectedVersion: w.version, toUserId: 'u-it-ex4', reason: 'Ex4 has room this week' })),
    ]);
    assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1, 'one move wins');
    const lost = race.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    assert.match(String(lost.reason?.message), /changed since/);
    const moved = (race.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<{ userId: string; version: string }>).value;
    assert.ok(['u-it-ex3', 'u-it-ex4'].includes(moved.userId));
    const adj = await db.asUser('u-it-lead', (svc, u) =>
      svc.workTaskAdjust(u, w.id, { expectedVersion: moved.version, priority: 'high', dueAt: due(svc, 3), reason: 'Vendor moved the window' }),
    );
    assert.equal(adj.priority, 'high');
    assert.equal(adj.changes?.length, 2);
    const mine = await db.asUser(moved.userId, (svc, u) => svc.myWork(u));
    assert.ok(mine.open.some((t) => t.id === w.id), 'the new person has it');
    const advice = await db.asUser('u-it-lead', (svc, u) => svc.workRebalance(u));
    assert.deepEqual(advice.people.map((p) => p.userId).sort(), ['u-it-ex1', 'u-it-ex2', 'u-it-ex3', 'u-it-ex4']);
  });

  it('allocates distinct task identities for concurrent same-target requests at the same timestamp under RLS', async () => {
    const fixed = new Date().toISOString();
    const due = new Date(Date.parse(fixed) + 86_400_000).toISOString();
    const tasks = await Promise.all(Array.from({ length: 4 }, (_, i) => db.asUser('u-it-lead', (svc, u) => svc.workTaskAdd(u, { userId: 'u-it-ex1', title: `Synthetic fixed-time task ${i}`, doneMeans: 'Evidence recorded and reviewed', dueAt: due, priority: 'normal' }), () => fixed)));
    assert.equal(new Set(tasks.map(t => t.id)).size, 4);
    await db.asUser('u-it-ex1', async (_svc, _user, store) => {
      for (const task of tasks) assert.equal((await store.get('workTasks', task.id))?.userId, 'u-it-ex1');
    });
  });

  it('caps Arisha AI rebalance asks per manager per day even when they arrive at once (Arisha main review, 2 Nov 2026)', async () => {
    // An explicit overdue fixture, independent of workloads added by other integrated modules.
    await db.asUser('u-it-lead', async (svc, u, store) => {
      const now = Date.parse(svc.now());
      const task = await svc.workTaskAdd(u, { userId: 'u-it-ex1', title: 'Synthetic overdue AI quota case', doneMeans: 'Evidence recorded', dueAt: new Date(now + 86_400_000).toISOString(), priority: 'normal' });
      await store.update('workTasks', task.id, { dueAt: new Date(now - 5 * 86_400_000).toISOString() });
    });
    const r = await db.asUser('u-it-mgr', (svc, u) => svc.workRebalance(u));
    assert.ok(r.advice.length > 0, 'the synthetic team has at least one case');
    const id = r.advice[0].id;
    const asks = await Promise.allSettled(Array.from({ length: 14 }, () => db.asUser('u-it-mgr', (svc, u) => svc.workRebalanceAiCase(u, id))));
    assert.equal(asks.filter((x) => x.status === 'fulfilled').length, 10, 'exactly the daily cap gets through');
    for (const x of asks) if (x.status === 'rejected') assert.match(String(x.reason?.message), /10 times today/);
  });

  it('serializes competing COO decisions, repeated acknowledgements and a notice arriving during one', async () => {
    const due = (svc: { now(): string }) => new Date(Date.parse(svc.now()) + 2 * 86_400_000).toISOString();
    const finished = async (title: string) => {
      const w = await db.asUser('u-it-lead', (svc, u) => svc.workTaskAdd(u, { userId: 'u-it-ex2', title, doneMeans: 'Output attached with the reference.', dueAt: due(svc), priority: 'normal' }));
      await db.asUser('u-it-ex2', (svc, u) => svc.workTaskDone(u, w.id, { note: 'Attached', ref: 'RLS-C' }));
      return w;
    };
    // Read the stored row as the test owner, outside any wall, to see exactly what was saved.
    const row = async (id: string) => {
      const c = new Client({ connectionString: URL });
      await c.connect();
      try {
        return (await c.query('SELECT data FROM prima.work_tasks WHERE id = $1', [id])).rows[0].data;
      } finally {
        await c.end();
      }
    };
    // 1. The COO and the line manager decide the same task at the same moment: exactly one decision lands.
    const a = await finished('COO RLS race: competing decisions');
    const [coo, lead] = await Promise.allSettled([
      db.asUser('u-coo', (svc, u) => svc.workTaskReview(u, a.id, true, 'Seen it working on site.')),
      db.asUser('u-it-lead', (svc, u) => svc.workTaskReview(u, a.id, false, 'The reference number is missing from it.')),
    ]);
    assert.equal([coo, lead].filter((r) => r.status === 'fulfilled').length, 1);
    const loser = [coo, lead].find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.match(String(loser.reason?.message), /Only a finished task waits for review/);
    const after = await row(a.id);
    assert.equal(after.status, coo.status === 'fulfilled' ? 'accepted' : 'returned');
    assert.equal((after.cooNotices ?? []).length, coo.status === 'fulfilled' ? 1 : 0);
    // 2. Seen pressed twice at once: marked once.
    const b = await finished('COO RLS race: repeated seen');
    await db.asUser('u-coo', (svc, u) => svc.workTaskReview(u, b.id, false, 'Attach the screenshot of the result.'));
    const n1 = (await row(b.id)).cooNotices[0].id as string;
    await Promise.all([1, 2].map(() => db.asUser('u-it-lead', (svc, u) => svc.seenCooNotice(u, 'work', b.id, n1))));
    assert.deepEqual((await row(b.id)).cooNotices[0].seen, ['u-it-lead']);
    // 3. A new COO notice lands while the first is being marked seen: neither change is lost, the new one stays unseen.
    await db.asUser('u-it-ex2', (svc, u) => svc.workTaskDone(u, b.id, { note: 'Screenshot attached', ref: 'RLS-C2' }));
    const c = await finished('COO RLS race: notice during seen');
    await db.asUser('u-coo', (svc, u) => svc.workTaskReview(u, c.id, false, 'Attach the screenshot of the result.'));
    await db.asUser('u-it-ex2', (svc, u) => svc.workTaskDone(u, c.id, { note: 'Screenshot attached', ref: 'RLS-C3' }));
    const c1 = (await row(c.id)).cooNotices[0].id as string;
    await Promise.all([
      db.asUser('u-it-lead', (svc, u) => svc.seenCooNotice(u, 'work', c.id, c1)),
      db.asUser('u-coo', (svc, u) => svc.workTaskReview(u, c.id, true, 'Screenshot shows the right result.')),
    ]);
    const cn = (await row(c.id)).cooNotices as { id: string; what: string; seen: string[] }[];
    assert.equal(cn.length, 2);
    assert.deepEqual(cn.find((x) => x.id === c1)!.seen, ['u-it-lead']);
    assert.deepEqual(cn.find((x) => x.id !== c1)!.seen, []);
    assert.equal((await row(c.id)).status, 'accepted');
    // 4. FWM: the COO and FWM decide one OM task at the same moment: exactly one lands.
    const np = await asApp('co-sasa', "SELECT id FROM prima.people WHERE company_id = 'co-sasa' AND data->>'nationality' = 'NP' AND data->>'role' = 'guard' LIMIT 1");
    const t = await db.asUser('u-fwm-ex1', (svc, u) => svc.createFwmTask(u, np.rows[0].id, { kind: 'JIM', what: 'COO RLS race FWM', place: 'Shah Alam', dueOn: dateOf(svc.now()) }));
    if (t.omUserId) {
      await db.asUser(t.omUserId, (svc, u) => svc.doneFwmTask(u, t.id, 'Done', [proof()]));
      const both = await Promise.allSettled([
        db.asUser('u-coo', (svc, u) => svc.reviewFwmTask(u, t.id, true, 'Checked the slip myself.')),
        db.asUser('u-fwm-ex2', (svc, u) => svc.reviewFwmTask(u, t.id, false, 'The slip is not stamped.')),
      ]);
      assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
      assert.match(String((both.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason?.message), /Only a task reported done/);
    }
  });

  it('rolls back a blocked change completely', async () => {
    const before = await asApp('co-sasa', 'SELECT count(*)::int AS n FROM prima.audit');
    await assert.rejects(
      db.asUser('u-cm-sasa', async (svc, user) => {
        const today = dateOf(svc.now());
        const shifts = await svc.roster(user, 'st-sasa-001', addDays(today, 2), 1);
        return svc.assignShift(user, shifts.shifts[0].id, 'pr-sasa-0012'); // over-age guard
      }),
      /Group policy allows guards up to 60/,
    );
    const afterRes = await asApp('co-sasa', 'SELECT count(*)::int AS n FROM prima.audit');
    assert.equal(afterRes.rows[0].n, before.rows[0].n);
  });

  it('stores JA feed records behind the company wall and keeps the feed off the sign-in list', async () => {
    const code = (await asApp('co-sasa', `SELECT data->>'code' AS code FROM prima.companies WHERE id = 'co-sasa'`)).rows[0].code;
    const rec = {
      company: code,
      externalId: 'INC-DB-1',
      updatedAt: '2026-10-26T10:00:00+08:00',
      occurredAt: '2026-10-26T09:00:00+08:00',
      category: 'Theft',
      severity: 'P2',
      status: 'open',
      summary: 'Test',
    };
    const out = await db.asUser('u-ja-sync', (svc, u) => svc.jaIngest(u, 'incident', [rec]));
    assert.equal(out.accepted, 1);
    const arsh = await asApp('co-arsh', `SELECT count(*)::int AS n FROM prima.ja_records WHERE id = 'ja:incident:co-sasa:INC-DB-1'`);
    assert.equal(arsh.rows[0].n, 0);
    const sasa = await asApp('co-sasa', `SELECT count(*)::int AS n FROM prima.ja_records WHERE id = 'ja:incident:co-sasa:INC-DB-1'`);
    assert.equal(sasa.rows[0].n, 1);
    const board = await db.asUser('u-cm-arsh', (svc, u) => svc.jaBoard(u));
    assert.ok(!board.incidents.some((i) => i.externalId === 'INC-DB-1'));
  });

  it('keeps staff payroll behind the employer wall and runs the approvals through the app role', async () => {
    const board = await db.asUser('u-pwvsb-hr', (svc, u) => svc.staffPayroll(u));
    const run = board.runs.find((r) => r.companyId === 'pwvsb' && r.stage === 'submitted')!;
    assert.ok(run);
    // HR Phase 3 (Fauzan, 1 Nov 2026): the Chief of Staff approves, then the COO approves, each with a comment.
    await db.asUser('u-cos', (svc, u) => svc.staffPayStep(u, run.id, 'approve', { note: 'Checked.' }));
    await db.asUser('u-coo', (svc, u) => svc.staffPayStep(u, run.id, 'coo_approve', { note: 'Approved.' }));
    const paid = await db.asUser('u-fin-t1-lead', (svc, u) => svc.staffPayStep(u, run.id, 'pay', { bankRef: 'DB-TEST', pcbChecked: true }));
    assert.equal(paid.stage, 'paid');
    const other = await asApp('co-sasa', `SELECT count(*)::int AS n FROM prima.staff_pay_runs WHERE company_id = 'pwvsb'`);
    assert.equal(other.rows[0].n, 0);
    const cm = await db.asUser('u-cm-arsh', (svc, u) => svc.staffPayroll(u));
    assert.ok(cm.runs.every((r) => r.companyId === 'co-arsh'));
  });
});

describe('HR rollout switch (HR Phase 3, Fauzan 1 Nov 2026)', () => {
  const u = (o: Record<string, unknown>) => ({ id: 'x', name: 'X', title: 'X', role: 'pwvsb_officer', companyIds: [], siteIds: [], ...o }) as never;
  it('admits the Chief of Staff, Deputy and Vice Chairman only when HR_ROLLOUT=true, and leaves the IT pilot as it was', () => {
    const cos = u({ leadership: 'cos', department: 'chief_of_staff' });
    const vc = u({ leadership: 'vice_chairman' });
    const chair = u({ leadership: 'chairman' });
    const it = u({ department: 'it' });
    assert.equal(pilotAdmits(cos, {}), false);
    assert.equal(pilotAdmits(vc, { HR_ROLLOUT: 'false' }), false);
    assert.equal(pilotAdmits(cos, { HR_ROLLOUT: 'true' }), true);
    assert.equal(pilotAdmits(vc, { HR_ROLLOUT: 'true' }), true);
    assert.equal(pilotAdmits(chair, { HR_ROLLOUT: 'true' }), false);
    assert.equal(pilotAdmits(u({ leadership: 'cos', integration: 'ja' }), { HR_ROLLOUT: 'true' }), false);
    assert.equal(pilotAdmits(it, {}), true);
    // The shared department switch: PRIMA_ROLLOUTS=hr is the same as HR_ROLLOUT=true.
    assert.equal(pilotAdmits(cos, { PRIMA_ROLLOUTS: 'hr' }), true);
    // An unrelated name does not open HR. (Other departments' rollouts may admit the CoS for their own work, e.g. #52.)
    assert.equal(pilotAdmits(cos, { PRIMA_ROLLOUTS: 'no_such_department' }), false);
  });
});

describe('development tokens', () => {
  it('round-trips and rejects tampering and expiry', () => {
    const t = issueToken('u-fauzan', 1_000);
    assert.equal(verifyToken(t, 2_000), 'u-fauzan');
    assert.equal(verifyToken(t.slice(0, -2) + 'xx', 2_000), null);
    assert.equal(verifyToken(t, 1_000 + 13 * 3_600_000), null);
  });
});

describe('JA Group app feed (Fauzan, 26 Oct 2026)', () => {
  it('accepts only a signed, fresh call with the right key', () => {
    process.env.JA_API_KEY = 'test-key';
    process.env.JA_SIGNING_SECRET = 'test-signing';
    const body = Buffer.from('{"records":[]}');
    const now = Date.parse('2026-10-26T10:00:00+08:00');
    const ts = new Date(now).toISOString();
    const sig = createHmac('sha256', 'test-signing').update(`${ts}.`).update(body).digest('hex');
    const h = { 'x-api-key': 'test-key', 'x-timestamp': ts, 'x-signature': sig };
    assert.equal(verifyFeed(h, body, now), true);
    assert.equal(verifyFeed({ ...h, 'x-api-key': 'wrong' }, body, now), false);
    assert.equal(verifyFeed(h, Buffer.from('{"records":[1]}'), now), false);
    assert.equal(verifyFeed(h, body, now + 6 * 60_000), false);
  });
});

describe('Microsoft sign-in links to one staff record', () => {
  const TENANT = '11111111-2222-3333-4444-555555555555';
  const SPA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const API = 'cccccccc-1111-2222-3333-444444444444';
  const LEAD = '0a0a0a0a-0000-4000-8000-000000000001';
  const ROM = '0a0a0a0a-0000-4000-8000-000000000002';
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  function token(oid: string, aud = `api://${API}`) {
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: 'RS256', kid: 'k1' });
    const body = b64({ ver: '2.0', iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud, azp: SPA, tid: TENANT, oid, scp: 'access_as_user', nbf: now - 60, exp: now + 3600 });
    return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(pair.privateKey).toString('base64url')}`;
  }
  function ctx(authorization?: string) {
    const req: { headers: Record<string, string>; userId?: string } = { headers: authorization ? { authorization } : {} };
    return { req, c: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext };
  }
  let db: Db;
  let guard: AuthGuard;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    guard = new AuthGuard(db);
    process.env.ENTRA_TENANT_ID = TENANT;
    process.env.ENTRA_SPA_CLIENT_ID = SPA;
    process.env.ENTRA_API_CLIENT_ID = API;
    resetEntraSetup();
    entraSetup(async (kid) => (kid === 'k1' ? pair.publicKey : null));
  });
  after(async () => {
    delete process.env.ENTRA_TENANT_ID;
    delete process.env.ENTRA_SPA_CLIENT_ID;
    delete process.env.ENTRA_API_CLIENT_ID;
    delete process.env.ALLOW_DEV_LOGIN;
    resetEntraSetup();
    await db.onModuleDestroy();
  });

  it('IT links an account by object ID, on the audit chain, and refuses a second record for the same account', async () => {
    const c = await db.pool.connect();
    try {
      assert.match(await linkEntra(c, 'u-it-lead', LEAD.toUpperCase(), 'IT Manager'), /linked to Microsoft account/);
      await assert.rejects(linkEntra(c, 'u-fauzan', LEAD, 'IT Manager'), /already linked to u-it-lead/);
      await assert.rejects(linkEntra(c, 'u-ja-sync', ROM, 'IT Manager'), /system feed/);
      await assert.rejects(linkEntra(c, 'u-it-lead', 'not-a-guid', 'IT Manager'), /GUID/);
      await assert.rejects(linkEntra(c, 'u-it-lead', LEAD, ' '), /--by/);
      await linkEntra(c, 'u-rom-central', ROM, 'IT Manager');
    } finally {
      c.release();
    }
    const log = await db.pool.query(`SELECT data FROM prima.audit ORDER BY seq`);
    const entries = log.rows.map((r) => r.data as AuditEntry);
    assert.equal(verifyChain(entries), null);
    assert.ok(entries.some((e) => e.action === 'ENTRA_LINK' && e.entityId === 'u-it-lead' && e.actor === 'IT Manager'));
  });

  it('signs in a linked pilot user with a Microsoft token', async () => {
    const { req, c } = ctx(`Bearer ${token(LEAD)}`);
    assert.equal(await guard.canActivate(c), true);
    assert.equal(req.userId, 'u-it-lead');
  });

  it('refuses a token for the web app instead of the API', async () => {
    await assert.rejects(guard.canActivate(ctx(`Bearer ${token(LEAD, `api://${SPA}`)}`).c), /Sign in again with Microsoft/);
  });

  it('keeps the company wall for a Microsoft-signed-in user', async () => {
    const { req, c } = ctx(`Bearer ${token(LEAD)}`);
    await guard.canActivate(c);
    const seen = await db.asUser(req.userId!, async (svc, u) => (await svc.visibleCompanies(u)).map((x) => x.id));
    assert.ok(!seen.includes('co-sasa'));
    await assert.rejects(db.asUser(req.userId!, (svc, u) => svc.companyDashboard(u, 'co-sasa')));
  });

  it('refuses an unlinked account and names its ID for IT', async () => {
    await assert.rejects(guard.canActivate(ctx(`Bearer ${token('0a0a0a0a-0000-4000-8000-0000000000ff')}`).c), /Ask IT to link account ID 0a0a0a0a-0000-4000-8000-0000000000ff/);
  });

  it('refuses a linked account outside the pilot', async () => {
    await assert.rejects(guard.canActivate(ctx(`Bearer ${token(ROM)}`).c), /not part of the pilot/);
    await assert.rejects(userForEntra(db, { oid: ROM, tid: TENANT, name: '', username: '' }), /not part of the pilot/);
  });

  it('refuses a forged token and a missing one', async () => {
    const [h, b] = token(LEAD).split('.');
    await assert.rejects(guard.canActivate(ctx(`Bearer ${h}.${b}.AAAA`).c), /Sign in again with Microsoft/);
    await assert.rejects(guard.canActivate(ctx().c), /Sign in again/);
  });

  it('signs in the staff record the Agentic Office names, and only with a valid signature', async () => {
    const SECRET = 'o'.repeat(40);
    process.env.OFFICE_SIGNING_SECRET = SECRET;
    const office = (over: { user?: string; via?: string; ts?: string; url?: string; body?: string; secret?: string } = {}) => {
      const call = { user: over.user ?? 'u-it-lead', via: over.via ?? 'agent:Chief of Staff' };
      const ts = over.ts ?? new Date().toISOString();
      const body = over.body ?? '{"a":1}';
      const sig = officeSign(over.secret ?? SECRET, officePayload(ts, 'POST', '/api/me', call, body));
      const req = {
        method: 'POST',
        originalUrl: over.url ?? '/api/me',
        rawBody: Buffer.from('{"a":1}'),
        headers: { 'x-office-ts': ts, 'x-office-user': call.user, 'x-office-via': call.via, 'x-office-signature': sig } as Record<string, string>,
      } as { method: string; originalUrl: string; rawBody: Buffer; headers: Record<string, string>; userId?: string; office?: { via: string } };
      return { req, c: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext };
    };
    try {
      const ok = office();
      assert.equal(await guard.canActivate(ok.c), true);
      assert.equal(ok.req.userId, 'u-it-lead');
      assert.equal(ok.req.office?.via, 'agent:Chief of Staff');
      // A wrong secret, another body, another path, an old call: all refused, never a fallback.
      await assert.rejects(guard.canActivate(office({ secret: 'x'.repeat(40) }).c), /Open Prima from the office again/);
      await assert.rejects(guard.canActivate(office({ body: '{"a":2}' }).c), /Open Prima from the office again/);
      await assert.rejects(guard.canActivate(office({ url: '/api/payroll' }).c), /Open Prima from the office again/);
      await assert.rejects(guard.canActivate(office({ ts: new Date(Date.now() - 6 * 60_000).toISOString() }).c), /Open Prima from the office again/);
      await assert.rejects(guard.canActivate(office({ via: 'root' }).c), /Open Prima from the office again/);
      // The office itself (no person) never opens a screen or a record.
      await assert.rejects(guard.canActivate(office({ user: '', via: 'system' }).c), /Open Prima from the office again/);
      // Prima's own sign-in rules: no such record, a system feed, someone outside the pilot.
      await assert.rejects(guard.canActivate(office({ user: 'u-nobody' }).c), /no longer exists/);
      await assert.rejects(guard.canActivate(office({ user: 'u-ja-sync' }).c), /system feed/);
      await assert.rejects(guard.canActivate(office({ user: 'u-rom-central' }).c), /not part of the pilot/);
      // P68: with everyone signing in from the office, the pilot no longer keeps them out (closed accounts still do).
      process.env.PRIMA_SIGNIN_EVERYONE = 'true';
      try {
        const rom = office({ user: 'u-rom-central' });
        assert.equal(await guard.canActivate(rom.c), true);
        assert.equal(rom.req.userId, 'u-rom-central');
        assert.equal((await new OfficeController(db).staff()).find((x) => x.id === 'u-rom-central')?.canSignIn, true);
      } finally {
        delete process.env.PRIMA_SIGNIN_EVERYONE;
      }

      // The staff list for linking: only for the office's own system call.
      const sys = office({ user: '', via: 'system' });
      sys.req.method = 'GET';
      sys.req.originalUrl = '/api/office/staff';
      sys.req.rawBody = Buffer.alloc(0);
      const ts = new Date().toISOString();
      sys.req.headers['x-office-ts'] = ts;
      sys.req.headers['x-office-signature'] = officeSign(SECRET, officePayload(ts, 'GET', '/api/office/staff', { user: '', via: 'system' }, ''));
      assert.equal(new OfficeSystemGuard().canActivate(sys.c), true);
      assert.throws(() => new OfficeSystemGuard().canActivate(office().c), /Only the Agentic Office/);
      const staff = await new OfficeController(db).staff();
      const lead = staff.find((x) => x.id === 'u-it-lead');
      assert.equal(lead?.entraOid, LEAD.toLowerCase());
      assert.equal(lead?.canSignIn, true);
      assert.equal(staff.find((x) => x.id === 'u-rom-central')?.canSignIn, false);
      assert.ok(!staff.some((x) => x.id === 'u-ja-sync'));
      // Without a secret on the server the office cannot sign anyone in.
      delete process.env.OFFICE_SIGNING_SECRET;
      await assert.rejects(guard.canActivate(office().c), /Open Prima from the office again/);
    } finally {
      delete process.env.OFFICE_SIGNING_SECRET;
    }
  });

  it('stops accepting a removed link at once', async () => {
    const c = await db.pool.connect();
    try {
      await linkEntra(c, 'u-it-lead', null, 'IT Manager');
    } finally {
      c.release();
    }
    await assert.rejects(guard.canActivate(ctx(`Bearer ${token(LEAD)}`).c), /not linked/);
  });

  it('accepts development tokens only while development sign-in is on', async () => {
    const dev = `Bearer ${issueToken('u-fauzan')}`;
    delete process.env.ALLOW_DEV_LOGIN;
    await assert.rejects(guard.canActivate(ctx(dev).c), /Sign in again/);
    process.env.ALLOW_DEV_LOGIN = 'true';
    const { req, c } = ctx(dev);
    assert.equal(await guard.canActivate(c), true);
    assert.equal(req.userId, 'u-fauzan');
  });
});

