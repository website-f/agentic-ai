// PDPA officer department check (Fauzan, 23 Nov 2026: "Do the gap"): Do today, downloads, the client's PDPA step,
// lost devices and staff questions in the inbox, keep periods and the clean-up OK, and the Chief of Staff's cover.
// Synthetic seed data only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PDPA_COVER_NOTE, PrimaService, generateDataset, myt, pdpaOfficerAway, type Dataset } from '../src';

const TODAY = '2026-11-20';
const NOW = myt(TODAY, '10:00');

function setup(): { ds: Dataset; svc: PrimaService; store: MemoryStore } {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

/** Put the PDPA officer on approved leave today (gives the officer a synthetic person record). */
function officerOnLeave(ds: Dataset) {
  const u = ds.users.find((x) => x.id === 'u-pdpa')!;
  const p = ds.people.find((x) => x.companyId === 'co-sasa')!;
  u.personId = 'p-pdpa-synthetic';
  ds.people.push({ ...p, id: 'p-pdpa-synthetic', name: 'PDPA Officer (synthetic)' });
  ds.leaveRequests.push({
    ...(ds.leaveRequests[0] ?? {}),
    id: 'lv-pdpa-synthetic',
    companyId: 'co-sasa',
    personId: 'p-pdpa-synthetic',
    kind: 'ANNUAL',
    from: TODAY,
    to: TODAY,
    days: 1,
    reason: 'Synthetic leave',
    status: 'approved',
  } as Dataset['leaveRequests'][number]);
}

describe('B1 Do today', () => {
  it('lists the officer’s work; monitors and other staff get nothing', async () => {
    const { svc } = setup();
    const officer = await svc.user('u-pdpa');
    const items = await svc.pdpaOfficer.doToday(officer);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.go.view === 'pdpa')).toBe(true);
    // The seeded breach due to the Commissioner shows first (crit).
    expect(items.some((i) => i.tag === 'Breach')).toBe(true);
    expect(items[0].tone).toBe('crit');
    // No clean-up OK yet this week.
    expect(items.some((i) => i.tag === 'Clean-up')).toBe(true);
    expect(await svc.pdpaOfficer.doToday(await svc.user('u-opsdir'))).toEqual([]);
    expect(await svc.pdpaOfficer.doToday(await svc.user('u-cos'))).toEqual([]);
  });
});

describe('B2 personal data downloads', () => {
  it('shows sensitive downloads with the reason to the officer and monitors, never to others', async () => {
    const { svc } = setup();
    const hr = await svc.user('u-pwvsb-hr');
    await svc.exports.log(hr, { screen: 'hr', tab: 'Staff', format: 'xlsx', rows: 12, reason: 'Monthly headcount for the CoS (synthetic)' });
    await svc.exports.log(hr, { screen: 'company', tab: 'Overview', format: 'pdf', rows: 3 });
    const d = await svc.pdpaOfficer.downloads(await svc.user('u-pdpa'));
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ by: hr.name, screen: 'hr', sensitivity: 'personal', rows: 12, reason: 'Monthly headcount for the CoS (synthetic)' });
    expect(d.rows[0].ref).toMatch(/^EXP-/);
    expect((await svc.pdpaOfficer.downloads(await svc.user('u-opsdir'))).rows).toHaveLength(1);
    await expect(svc.pdpaOfficer.downloads(hr)).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('B3 client PDPA step', () => {
  it('only the PDPA officer closes it, from consent given or with a reason', async () => {
    const { ds, svc } = setup();
    const officer = await svc.user('u-pdpa');
    const acct = ds.clientAccounts.find((a) => a.stage === 'onboarding' && a.onboarding.some((s) => s.key === 'pdpa' && !s.doneAt))!;
    expect(acct).toBeTruthy();
    const list = await svc.pdpaOfficer.clientSteps(officer);
    expect(list.map((x) => x.accountId)).toContain(acct.id);
    await expect(svc.pdpaOfficer.clientStepDone(await svc.user('u-opsdir'), { accountId: acct.id, note: 'No camera at this client' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.pdpaOfficer.clientStepDone(officer, { accountId: acct.id, note: 'short' })).rejects.toThrow(/say why no consent/);
    // A consent case still pending is refused.
    const c = await svc.openPdpaCase(officer, { kind: 'CLIENT_CONSENT', companyId: acct.companyId, title: 'CCTV consent', detail: '', client: acct.name, product: 'CCTV' });
    await expect(svc.pdpaOfficer.clientStepDone(officer, { accountId: acct.id, caseId: c.id })).rejects.toThrow(/not given consent/);
    await svc.pdpaStep(officer, c.id, 'advised', 'Explained the notice');
    await svc.pdpaStep(officer, c.id, 'consent_given', 'Signed', [{ kind: 'document', name: 'consent.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 synthetic').toString('base64')}` }]);
    expect((await svc.pdpaOfficer.clientSteps(officer)).find((x) => x.accountId === acct.id)!.consentCases.some((x) => x.id === c.id && x.decision === 'given')).toBe(true);
    await svc.pdpaOfficer.clientStepDone(officer, { accountId: acct.id, caseId: c.id });
    const after = ds.clientAccounts.find((a) => a.id === acct.id)!;
    expect(after.onboarding.find((s) => s.key === 'pdpa')!.doneAt).toBeTruthy();
    expect(after.onboarding.find((s) => s.key === 'pdpa')!.note).toMatch(/Client consent on file for CCTV/);
    await expect(svc.pdpaOfficer.clientStepDone(officer, { accountId: acct.id, note: 'Again with a reason' })).rejects.toThrow(/Already done/);
  });
});

describe('B4 and D2 inbox', () => {
  it('a staff question becomes a data request with the 21 days from the ask; others never read it', async () => {
    const { ds, svc } = setup();
    const staffUser = ds.users.find((u) => u.personId && u.role === 'pwvsb_officer' && u.department === 'finance')!;
    const staff = await svc.user(staffUser.id);
    await expect(svc.pdpaOfficer.ask(staff, { kind: 'NOPE', detail: 'My bank account number' })).rejects.toThrow(/Choose/);
    const q = await svc.pdpaOfficer.ask(staff, { kind: 'CORRECTION', detail: 'My bank account number is wrong' });
    expect(q.handled).toBeNull();
    const mine = await svc.pdpaOfficer.myAsks(staff);
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0].dueOn).toBe('2026-12-11');
    // Another staff member sees none of it; the inbox screen is for the PDPA wall only.
    const other = await svc.user(ds.users.find((u) => u.personId && u.id !== staffUser.id && u.role === 'pwvsb_officer' && u.department === 'it')!.id);
    expect((await svc.pdpaOfficer.myAsks(other)).rows).toHaveLength(0);
    await expect(svc.pdpaOfficer.inbox(other)).rejects.toBeInstanceOf(AccessDenied);
    // The audit line carries no data.
    expect(ds.audit.find((a) => a.action === 'pdpa.ask')!.summary).not.toMatch(/bank/);
    const officer = await svc.user('u-pdpa');
    const today = await svc.pdpaOfficer.doToday(officer);
    expect(today.some((i) => i.tag === 'Staff asked')).toBe(true);
    await expect(svc.pdpaOfficer.handle(await svc.user('u-opsdir'), { id: q.id, action: 'request' })).rejects.toBeInstanceOf(AccessDenied);
    const companyId = staff.companyIds[0] ? undefined : 'co-sasa';
    await svc.pdpaOfficer.handle(officer, { id: q.id, action: 'request', companyId });
    const req = ds.pdpaRequests.find((r) => r.subjectName === staff.name)!;
    expect(req).toMatchObject({ kind: 'CORRECTION', receivedOn: TODAY, dueOn: '2026-12-11' });
    expect(req.idVerified).toBeTruthy();
    expect((await svc.pdpaOfficer.myAsks(staff)).rows[0].handled).toMatchObject({ outcome: 'request', ref: req.ref });
    await expect(svc.pdpaOfficer.handle(officer, { id: q.id, action: 'close', note: 'Duplicate question here' })).rejects.toThrow(/Already handled/);
  });

  it('a lost or stolen device reaches the officer, who opens a breach or closes it with a reason', async () => {
    const { ds, svc } = setup();
    const s = ds.users.find((u) => u.personId && u.role === 'pwvsb_officer' && u.department !== 'it' && !u.integration && !u.opsTier && u.department !== 'hr')!;
    const asset = ds.itAssets.find((a) => a.status === 'in_use')!;
    ds.physicalItems.push({
      id: 'pi-mock-pdpa-1', token: 'P1-MOCK0099', skuId: ds.itemSkus[0]?.id ?? 'sku-x', serial: 'SN-MOCK-99', ownerPartyId: 'merdeka',
      custody: { kind: 'person', partyId: 'pwvsb', ref: s.personId!, label: 'Staff (mock)', since: NOW },
      state: 'with_person', condition: 'good', version: 1, labelPrints: 1, registeredBy: 'IT (mock)', registeredAt: NOW, legacyUnverified: false,
      replacesId: null, replacedById: null, itAssetId: asset.id, kitId: null, componentIds: [], pendingAck: null, reservedFor: null, dueBack: null,
    } as unknown as (typeof ds.physicalItems)[number]);
    const staff = await svc.user(s.id);
    const t = await svc.reportItDevice(staff, { assetId: asset.id, kind: 'lost', detail: 'Left in a taxi (mock)' });
    const line = ds.pdpaInbox.find((i) => i.kind === 'device')!;
    expect(line).toMatchObject({ userId: s.id, sourceRef: (t as { ref: string }).ref, handled: null });
    const officer = await svc.user('u-pdpa');
    expect((await svc.pdpaOfficer.doToday(officer)).some((i) => i.tag === 'Possible breach' && i.tone === 'crit')).toBe(true);
    await expect(svc.pdpaOfficer.handle(officer, { id: line.id, action: 'no_breach', note: 'short' })).rejects.toThrow(/Say why/);
    await expect(svc.pdpaOfficer.handle(officer, { id: line.id, action: 'request' })).rejects.toThrow(/questions from staff/);
    await svc.pdpaOfficer.handle(officer, { id: line.id, action: 'breach', note: 'Laptop had the HR list' });
    const c = ds.pdpaCases.find((x) => x.kind === 'BREACH' && x.title.startsWith('Possible breach'))!;
    // The 72-hour clock counts from the report.
    expect(c.breach!.detectedAt).toBe(line.at);
    // A damaged device does not reach the officer.
    const before = ds.pdpaInbox.length;
    const asset2 = ds.itAssets.find((a) => a.status === 'in_use' && a.id !== asset.id)!;
    ds.physicalItems.push({ ...(ds.physicalItems.find((p) => p.id === 'pi-mock-pdpa-1') as object), id: 'pi-mock-pdpa-2', token: 'P1-MOCK0098', serial: 'SN-MOCK-98', itAssetId: asset2.id } as unknown as (typeof ds.physicalItems)[number]);
    await svc.reportItDevice(staff, { assetId: asset2.id, kind: 'damaged', detail: 'Screen cracked (mock)' });
    expect(ds.pdpaInbox.length).toBe(before);
  });
});

describe('B5 and D1 keep periods and the clean-up OK', () => {
  it('lists every keep period; only the officer gives a 7-day OK with a reason', async () => {
    const { svc } = setup();
    const officer = await svc.user('u-pdpa');
    const k = await svc.pdpaOfficer.keepList(officer);
    expect(k.rows.find((r) => /gate records/.test(r.what))!.keep).toMatch(/7 years/);
    expect(k.rows.find((r) => /survey photos/.test(r.what))!.state).toBe('unknown');
    expect(k.ok).toBeNull();
    await expect(svc.pdpaOfficer.okCleanUp(await svc.user('u-cos'), { reason: 'Checked the legal holds today' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.pdpaOfficer.okCleanUp(officer, { reason: 'ok' })).rejects.toThrow(/Say what you checked/);
    const ok = await svc.pdpaOfficer.okCleanUp(officer, { reason: 'No open legal hold or case needs the records due' });
    expect(ok).toMatchObject({ okOn: TODAY, validUntil: '2026-11-26' });
    await expect(svc.pdpaOfficer.okCleanUp(officer, { reason: 'No open legal hold or case needs the records due' })).rejects.toThrow(/already given/);
    expect((await svc.pdpaOfficer.keepList(officer)).ok?.id).toBe(ok.id);
    expect((await svc.pdpaOfficer.doToday(officer)).some((i) => i.tag === 'Clean-up')).toBe(false);
  });
});

describe('D3 Chief of Staff cover', () => {
  it('acts on breaches and requests only while the officer is away, marked as cover', async () => {
    const { ds, svc, store } = setup();
    const cos = await svc.user('u-cos');
    expect(await pdpaOfficerAway(store, TODAY)).toBe(false);
    await expect(svc.openPdpaCase(cos, { kind: 'BREACH', companyId: 'co-sasa', title: 'Wrong email sent', detail: '' })).rejects.toBeInstanceOf(AccessDenied);
    officerOnLeave(ds);
    expect(await pdpaOfficerAway(store, TODAY)).toBe(true);
    expect((await svc.pdpaBoard(cos)).acts).toBe('cover');
    const c = await svc.openPdpaCase(cos, { kind: 'BREACH', companyId: 'co-sasa', title: 'Wrong email sent', detail: 'Payslip went to the wrong person (synthetic)' });
    expect(c.openedBy).toContain(PDPA_COVER_NOTE);
    await svc.pdpaBreachDetails(cos, c.id, { dataKinds: 'Name and salary', cause: 'Wrong address picked', remedy: 'Asked to delete' });
    // Only breaches: client consent and social media wait for the officer.
    await expect(svc.openPdpaCase(cos, { kind: 'SOCIAL', companyId: null, title: 'Post about a guard', detail: '', platform: 'Facebook' })).rejects.toBeInstanceOf(AccessDenied);
    const r = await svc.addPdpaRequest(cos, { companyId: 'co-sasa', kind: 'ACCESS', subjectName: 'Guard A (synthetic)', subjectKind: 'guard', detail: 'Copy of file', receivedOn: TODAY });
    await svc.pdpaRequestStep(cos, r.id, 'verify', 'IC sighted at the office');
    expect(ds.audit.filter((a) => a.summary.includes(PDPA_COVER_NOTE)).length).toBeGreaterThanOrEqual(4);
    // The Chief of Staff's Home carries the PDPA work while covering.
    const home = await svc.home(cos);
    expect(home.todo.some((i) => i.tag.startsWith('PDPA cover'))).toBe(true);
    // Someone else in leadership never covers.
    await expect(svc.openPdpaCase(await svc.user('u-coo'), { kind: 'BREACH', companyId: 'co-sasa', title: 'X breach', detail: '' })).rejects.toBeInstanceOf(AccessDenied);
    // Back from leave: the officer sees what was done while away.
    ds.leaveRequests = ds.leaveRequests.filter((l) => l.id !== 'lv-pdpa-synthetic');
    const back = await svc.pdpaOfficer.doToday(await svc.user('u-pdpa'));
    expect(back.some((i) => i.tag === 'Done while away')).toBe(true);
    await expect(svc.openPdpaCase(cos, { kind: 'BREACH', companyId: 'co-sasa', title: 'Another', detail: '' })).rejects.toBeInstanceOf(AccessDenied);
  });
});
