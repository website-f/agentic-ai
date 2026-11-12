import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, RULES, addDays, generateDataset, keepUntil, medicalDue, myt } from '../src';

// E9 PIKM / ISO records (Fauzan, 11 Nov 2026). Synthetic data only: the generated mock dataset.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

let n = 0;
function paper() {
  n += 1;
  return { kind: 'document' as const, name: `Paper ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 pikm ${n}`).toString('base64')}` };
}

describe('E9 yearly medical for guards 56 and over', () => {
  it('follows the rule: from age 56, every 12 months, due soon 60 days ahead', () => {
    expect(RULES.pikmRecords.value).toMatchObject({ medicalFromAge: 56, keepYears: 7 });
    const g = { dob: '1968-01-01', role: 'guard' as const, status: 'active' as const };
    expect(medicalDue(g, null, TODAY).state).toBe('missing');
    expect(medicalDue({ ...g, dob: '1975-01-01' }, null, TODAY).state).toBe('not_needed');
    expect(medicalDue(g, { nextDueOn: addDays(TODAY, 30), status: 'checked' }, TODAY).state).toBe('due_soon');
    expect(medicalDue(g, { nextDueOn: addDays(TODAY, -1), status: 'checked' }, TODAY).state).toBe('overdue');
    expect(medicalDue(g, { nextDueOn: addDays(TODAY, 200), status: 'checked' }, TODAY).state).toBe('ok');
  });

  it('HR records it with the certificate, another HR person checks it, and the HR Director checks a restricted result', async () => {
    const { svc, ds, store } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const cos = await svc.user('u-cos');
    const g = ds.people.find((p) => p.role === 'guard' && p.status === 'active' && p.companyId === 'co-sasa')!;
    await store.update('people', g.id, { dob: '1968-03-01' });
    const board = await svc.pikm.board(hr);
    expect(board.ready && board.medical!.due.some((d) => d.personId === g.id)).toBe(true);
    const rec = { personId: g.id, examinedOn: addDays(TODAY, -2), result: 'fit_restricted', restrictions: 'No night shifts (test)', clinic: 'Klinik Ujian (test)' };
    await expect(svc.pikm.act(hr, 'medical_record', rec)).rejects.toThrow(/certificate/);
    const r = await svc.pikm.act(hr, 'medical_record', { ...rec, proof: [paper()] });
    expect(r.nextDueOn).toBe(addDays(TODAY, -2).replace(/^2026/, '2027'));
    // Wrong roles: the person who recorded it, a company manager, and plain HR for a restricted result.
    await expect(svc.pikm.act(hr, 'medical_check', { id: r.id, ok: true, note: 'Mine' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.pikm.act(await svc.user('u-cm-sasa'), 'medical_record', { ...rec, proof: [paper()] })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.pikm.act(cos, 'medical_check', { id: r.id, ok: true, note: '' })).rejects.toThrow(/comment/);
    const done = await svc.pikm.act(cos, 'medical_check', { id: r.id, ok: true, note: 'Restriction passed to the OM' });
    expect(done.status).toBe('checked');
    expect(done.decided!.by).toBe(cos.name);
  });
});

describe('E9 site risk briefing before deployment', () => {
  it('lists first-time guards, records the briefing with the signed sheet, and another person checks it', async () => {
    const { svc, ds, store } = fresh();
    const site = ds.sites.find((s) => s.companyId === 'co-sasa')!;
    const g = ds.people.find((p) => p.role === 'guard' && p.status === 'active' && p.companyId === 'co-sasa')!;
    await store.insert('shifts', { ...ds.shifts.find((s) => s.companyId === 'co-sasa')!, id: 'sh-pikm-test', siteId: site.id, personId: g.id, date: addDays(TODAY, 2) });
    const sasaShifts = (await store.list('shifts', { companyId: 'co-sasa' })).filter((s) => s.siteId === site.id && s.personId === g.id && s.date < TODAY && s.date >= addDays(TODAY, -180));
    for (const s of sasaShifts) await store.update('shifts', s.id, { personId: null });
    const cm = await svc.user('u-cm-sasa');
    const b = await svc.pikm.board(cm);
    expect(b.ready && b.briefing!.toBrief.some((x) => x.personId === g.id && x.siteId === site.id)).toBe(true);
    const r = await svc.pikm.act(cm, 'briefing_record', { siteId: site.id, briefedOn: TODAY, risks: 'Loading bay traffic and the unlit back gate (test)', personIds: [g.id], proof: [paper()] });
    expect((await svc.pikm.board(cm)).briefing!.toBrief.some((x) => x.personId === g.id && x.siteId === site.id)).toBe(false);
    // The company manager recorded it, so the OM checks; a supervisor may not check; HR cannot record.
    await expect(svc.pikm.act(cm, 'briefing_check', { id: r.id, ok: true, note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.pikm.act(await svc.user('u-pwvsb-hr'), 'briefing_record', { siteId: site.id, briefedOn: TODAY, risks: 'x'.repeat(20), personIds: [g.id], proof: [paper()] })).rejects.toBeInstanceOf(AccessDenied);
    const om = await svc.user('u-om-klang');
    const checked = await svc.pikm.act(om, 'briefing_check', { id: r.id, ok: true, note: 'Seen the signed sheet' });
    expect(checked.status).toBe('checked');
  });
});

describe('E9 personnel records kept 7 years', () => {
  it('refuses clearing before 7 years and under a legal hold; the HR Director decides, never the proposer', async () => {
    const { svc, ds, store } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const cos = await svc.user('u-cos');
    const p = ds.people.find((x) => x.role === 'office' && x.status === 'active' && x.companyId === 'co-sasa') ?? ds.people.find((x) => x.status === 'active' && x.companyId === 'co-sasa')!;
    await store.update('people', p.id, { status: 'left', leaving: { kind: 'resigned', noticeOn: '2018-01-01', lastDayOn: '2019-01-31', reason: 'test', by: 'test', at: NOW } });
    expect(keepUntil('2019-01-31')).toBe('2026-01-31');
    const recent = ds.people.find((x) => x.id !== p.id && x.status === 'active' && x.companyId === 'co-sasa')!;
    await store.update('people', recent.id, { status: 'left', leaving: { kind: 'resigned', noticeOn: '2025-01-01', lastDayOn: '2025-01-31', reason: 'test', by: 'test', at: NOW } });
    await expect(svc.pikm.act(hr, 'retention_propose', { personId: recent.id, note: 'Old file' })).rejects.toThrow(/kept until 2032-01-31/);
    await store.insert('legalHolds', { id: 'lh-pikm-test', companyId: p.companyId, tbl: 'people', refId: p.id, matterId: 'm-test', by: 'Legal', byId: 'u-legal', at: NOW, released: null });
    await expect(svc.pikm.act(hr, 'retention_propose', { personId: p.id, note: 'Past 7 years' })).rejects.toThrow(/legal hold/);
    await store.update('legalHolds', 'lh-pikm-test', { released: { by: 'Legal', byId: 'u-legal', at: NOW } });
    const r = await svc.pikm.act(hr, 'retention_propose', { personId: p.id, note: 'Past 7 years, no claim open' });
    await expect(svc.pikm.act(hr, 'retention_decide', { id: r.id, ok: true, note: 'Mine' })).rejects.toBeInstanceOf(AccessDenied);
    const done = await svc.pikm.act(cos, 'retention_decide', { id: r.id, ok: true, note: 'Cleared under the PDPA register' });
    expect(done.status).toBe('cleared');
    // Prima keeps the person record itself.
    expect(await store.get('people', p.id)).toBeTruthy();
  });
});

describe('E9 client information pack and office alarm/CCTV', () => {
  it('fills the pack from the records, refuses approval by the preparer or with a lapsed paper, then records it sent', async () => {
    const { svc, store } = fresh();
    const ae = await svc.user('u-ae-sasa');
    const cm = await svc.user('u-cm-sasa');
    const pack = await svc.pikm.act(ae, 'pack_prepare', { companyId: 'co-sasa', clientName: 'Client Test Sdn Bhd (test)', membership: 'PIKM member no. TEST-1' });
    expect(pack.items!.map((i) => i.key)).toEqual(['licence', 'registration', 'insurance', 'membership', 'iso']);
    await expect(svc.pikm.act(ae, 'pack_decide', { id: pack.id, ok: true, note: 'Mine' })).rejects.toBeInstanceOf(AccessDenied);
    const missing = pack.items!.filter((i) => i.required && !i.ok);
    if (missing.length) {
      await expect(svc.pikm.act(cm, 'pack_decide', { id: pack.id, ok: true, note: 'Send it' })).rejects.toThrow(/Not ready/);
      await store.update('companies', 'co-sasa', { ssmNo: '202601000001 (test)' });
      for (const l of (await store.list('licences', { companyId: 'co-sasa' })).filter((x) => x.type === 'KDN_LICENCE')) await store.update('licences', l.id, { expiresOn: addDays(TODAY, 300) });
      for (const p of (await store.list('insurancePolicies', { companyId: 'co-sasa' })).filter((x) => x.kind === 'PUBLIC_LIABILITY')) await store.update('insurancePolicies', p.id, { startsOn: addDays(TODAY, -10), expiresOn: addDays(TODAY, 300) });
    }
    const ok = await svc.pikm.act(cm, 'pack_decide', { id: pack.id, ok: true, note: 'All current' });
    expect(ok.status).toBe('approved');
    const sent = await svc.pikm.act(ae, 'pack_sent', { id: pack.id, on: TODAY, to: 'Client admin (test)', how: 'Email' });
    expect(sent.status).toBe('sent');
  });

  it('keeps the office alarm and CCTV with each service report; ACT checks, never the keeper', async () => {
    const { svc } = fresh();
    const ae = await svc.user('u-ae-sasa');
    const act = await svc.user('u-audit');
    const r = await svc.pikm.act(ae, 'system_record', { companyId: 'co-sasa', system: 'cctv', installer: 'CCTV Installer Test Sdn Bhd', place: 'Sasa main office (test)', installedOn: '2025-05-01', nextServiceOn: addDays(TODAY, 20) });
    await expect(svc.pikm.act(ae, 'system_visit', { id: r.id, on: TODAY, contractor: 'Test Service', result: 'All cameras recording', nextServiceOn: addDays(TODAY, 180) })).rejects.toThrow(/service report/);
    const v = await svc.pikm.act(ae, 'system_visit', { id: r.id, on: TODAY, contractor: 'Test Service', result: 'All cameras recording', nextServiceOn: addDays(TODAY, 180), proof: [paper()] });
    expect(v.visits!.length).toBe(1);
    await expect(svc.pikm.act(ae, 'system_check', { id: r.id, note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    const c = await svc.pikm.act(act, 'system_check', { id: r.id, note: 'Report and contract seen' });
    expect(c.status).toBe('checked');
  });
});
