// Real-data import through the forms' own save (connect-departments, 2 Nov 2026). Synthetic data only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, parseCsv, withOrgLinks } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = withOrgLinks(new MemoryStore(ds));
  const svc = new PrimaService(store, () => NOW);
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  return { ds, svc, user };
}

const good = 'name,kind,registrar,expiresOn\nsynthetic-one.example,domain,Synthetic Registrar,01/12/2027\n"synthetic-two.example",Domain,"Registrar, Synthetic",2027-06-30\n';

describe('CSV', () => {
  it('reads quotes, commas inside quotes, doubled quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
    ]);
    expect(() => parseCsv('a\n"open')).toThrow(/never closed/);
  });
});

describe('import', () => {
  it('previews with the real checks and keeps nothing', async () => {
    const { ds, svc, user } = fresh();
    const before = ds.itDomains.length;
    const auditBefore = ds.audit.length;
    const bad = good + 'synthetic-three.example,bogus,Somebody,2027-01-01\n';
    const p = await svc.orgImport.preview(user('u-it-mgr'), 'itDomain', null, bad);
    expect(p.okRows).toBe(2);
    expect(p.badRows).toBe(1);
    expect(p.rows[2].problems.join(' ')).toMatch(/from the list/);
    expect(p.rows[0].values.expiresOn).toBe('2027-12-01');
    expect(p.canImport).toBe(false);
    expect(ds.itDomains.length).toBe(before);
    expect(ds.audit.length).toBe(auditBefore);
  });

  it('a row refused inside the real save, between good rows, still leaves nothing behind', async () => {
    const { ds, svc, user } = fresh();
    const before = ds.itDomains.length;
    const auditBefore = ds.audit.length;
    const long = 'x'.repeat(200) + '.example';
    const mixed = `name,kind,registrar\nsynthetic-a.example,domain,R\n${long},domain,R\nsynthetic-b.example,domain,R\n`;
    const p = await svc.orgImport.preview(user('u-it-mgr'), 'itDomain', null, mixed);
    expect(p.rows.map((r) => r.ok)).toEqual([true, false, true]);
    expect(p.canImport).toBe(false);
    expect(ds.itDomains.length).toBe(before);
    expect(ds.audit.length).toBe(auditBefore);
  });

  it('refuses dates that are not on the calendar', async () => {
    const { svc, user } = fresh();
    const p = await svc.orgImport.preview(user('u-it-mgr'), 'itDomain', null, 'name,kind,registrar,expiresOn\nsynthetic-d.example,domain,R,30/02/2027\nsynthetic-e.example,domain,R,2027-13-01\nsynthetic-f.example,domain,R,29/02/2028\n');
    expect(p.rows.map((r) => r.ok)).toEqual([false, false, true]);
    expect(p.rows[0].problems.join(' ')).toMatch(/not a real date/);
  });

  it('imports a clean, unchanged file once, all rows or none', async () => {
    const { ds, svc, user } = fresh();
    const it = user('u-it-mgr');
    const p = await svc.orgImport.preview(it, 'itDomain', null, good);
    expect(p.canImport).toBe(true);
    await expect(svc.orgImport.commit(it, 'itDomain', null, good + 'extra.example,domain,X\n', p.fingerprint)).rejects.toThrow(/changed since the preview/);
    const r = await svc.orgImport.commit(it, 'itDomain', null, good, p.fingerprint);
    expect(r.rows).toBe(2);
    expect(r.recordIds).toHaveLength(2);
    expect(ds.itDomains.filter((d) => d.name.startsWith('synthetic-'))).toHaveLength(2);
    expect(ds.audit.at(-1)!.action).toBe('org.import');
    await expect(svc.orgImport.commit(it, 'itDomain', null, good, p.fingerprint)).rejects.toThrow(/already imported/);
    expect((await svc.orgImport.preview(it, 'itDomain', null, good)).alreadyImported?.by).toBe(it.name);
  });

  it('refuses people who do not keep the record, and kinds kept on their own path', async () => {
    const { svc, user } = fresh();
    await expect(svc.orgImport.preview(user('u-cm-sasa'), 'itDomain', null, good)).rejects.toThrow();
    await expect(svc.orgImport.preview(user('u-it-mgr'), 'firearm' as never, null, good)).rejects.toThrow(/not imported in bulk/);
    await expect(svc.orgImport.preview(user('u-it-mgr'), 'company' as never, null, good)).rejects.toThrow(/not imported in bulk/);
  });

  it('never echoes a restricted number and starts no joiner hand-overs', async () => {
    const { ds, svc, user } = fresh();
    const csv =
      'staffNo,name,jobTitle,branchId,employmentType,hiredOn,nationality,idFull,gender,dob,phone,basicPay,payReason,status\n' +
      'SYN-9,Synthetic Staff,Clerk,br-pwvsb-hq,permanent,2020-01-01,MY,900101011234,F,1990-01-01,012-345 6789,2500,Existing pay,active\n';
    const hr = user('u-pwvsb-hr');
    const p = await svc.orgImport.preview(hr, 'officeStaff', 'pwvsb', csv);
    expect(p.rows[0].problems).toEqual([]);
    expect(JSON.stringify(p)).not.toContain('900101011234');
    await svc.orgImport.commit(hr, 'officeStaff', 'pwvsb', csv, p.fingerprint);
    expect(ds.orgTasks.filter((t) => t.flowId === 'staff_join')).toHaveLength(0);
  });
});
