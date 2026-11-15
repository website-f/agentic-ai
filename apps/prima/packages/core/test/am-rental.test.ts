// Part V rental homes (V20-V89; Fauzan's answers V-X11..V-X37, 14 Nov 2026). Made-up units, tenants and owners
// only, in memory. PostgreSQL is tested apart in apps/api/test/am-rental-pg.test.ts.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, firstReplyDue, generateDataset, incomeNeeded, myt, occupantLimit, officeMinutesBetween, type AmUnit, type RentRec } from '../src';

const TODAY = '2026-11-18';
const PDF = (n: string) => [{ kind: 'document', name: `${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 ' + n).toString('base64')}` }];
const allTrue = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, true]));
const NO_H = new Set<string>();

function fresh() {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '09:00') });
  const clock = { now: myt(TODAY, '09:00') };
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => clock.now);
  const act = async (uid: string, op: string, i: Record<string, unknown>) => svc.amRentalAct(await svc.user(uid), op, i) as Promise<RentRec>;
  const unit = ds.amUnits.find((u) => u.type === 'RESIDENTIAL' && !u.office)! as AmUnit;
  unit.tenancy = null;
  unit.status = 'vacant';
  unit.askingRent = 1200;
  return { ds, svc, act, unit, clock, at: (d: string, hm: string) => (clock.now = myt(d, hm)) };
}
const TEAM = 'u-asset-re1';
const TEAM2 = 'u-asset-mm';
const AD = 'u-asset-dir';
const FIN = 'u-finance-am';
const VC = 'u-vchair';
const CEO = 'u-fauzan';

async function owner(f: ReturnType<typeof fresh>) {
  return f.act(AD, 'owner', { reason: 'Owner company set up', ownerEntity: f.unit.ownerEntity, companyNo: '202001000001', bankName: 'Bank Contoh', bankAccount: '1234567890', edsRole: true, edsStaffIds: [TEAM], signatories: [{ name: 'Pengarah Contoh', post: 'Director', kind: 'DIRECTOR' }] });
}
async function ready(f: ReturnType<typeof fresh>) {
  await owner(f);
  await f.act(TEAM, 'unitInfo', { unitId: f.unit.id, bedrooms: 3, bathrooms: 2, building: 'TERRACE', propertyKind: 'HOUSE', facilities: ['Dapur'], availableOn: '2026-12-01', contactPhone: '012-345 6789', address: 'No 1, Jalan Contoh', photos: PDF('front'), moveInKeys: [{ item: 'kunci utama', count: 2 }] });
  const l = await f.act(TEAM, 'listingOpen', { unitId: f.unit.id });
  await f.act(TEAM, 'terms', { id: l.id, rent: 1200, deposit: 2400, termMonths: 12 });
  await expect(f.act(TEAM, 'termsDecide', { id: l.id, approve: true, note: 'ok' })).rejects.toThrow(/Asset Director/);
  await f.act(AD, 'termsDecide', { id: l.id, approve: true, note: 'Market rate' });
  return l;
}
async function approvedApp(f: ReturnType<typeof fresh>, extra: Record<string, unknown> = {}) {
  const l = await ready(f);
  await f.act(TEAM, 'advert', { id: l.id, platform: 'MUDAH', link: 'https://example.com/ad', photosChecked: true, screenshot: PDF('shot') });
  const app = await f.act(TEAM, 'application', { unitId: f.unit.id, conditionsExplained: true, applicant: { name: 'Pemohon Contoh', ic: '900101-01-0001', phone: '011-1111 1111', email: 'p@example.com', net: 3000 }, spouse: { name: 'Pasangan', net: 2000 }, occupants: 4, cars: 1, motorcycles: 1, declarationSigned: true, annexSignedOn: TODAY, docs: PDF('ic'), ...extra });
  await f.act(TEAM, 'appStep', { id: app.id, step: 'check', note: 'IC, payslips and employer checked' });
  await f.act(TEAM, 'appStep', { id: app.id, step: 'assess', recommendation: 'Recommend: income and occupants fit' });
  await f.act(TEAM, 'appStep', { id: app.id, step: 'forDecision' });
  await f.act(AD, 'appStep', { id: app.id, step: 'decide', approve: true, note: 'Good fit' });
  await f.act(VC, 'appStep', { id: app.id, step: 'consent', note: 'Setuju' });
  return { l, app };
}
async function template(f: ReturnType<typeof fresh>, t = 'agreement') {
  return f.act(AD, 'setSettings', { reason: 'Standard template', template: t, file: PDF(t) });
}
async function stamped(f: ReturnType<typeof fresh>) {
  const { app } = await approvedApp(f);
  await f.act(TEAM, 'appStep', { id: app.id, step: 'dpr' });
  await f.act(FIN, 'appStep', { id: app.id, step: 'depositConfirm', amount: 3600, bankRef: 'BNK-1', payer: 'ZAKAT', payerName: 'Lembaga Zakat Contoh' });
  await template(f);
  const ag = await f.act(TEAM, 'agreementOpen', { appId: app.id });
  await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'send', proof: PDF('sent') });
  await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'final' });
  await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'sign', party: 'TENANT', signer: 'Pemohon Contoh', witness: 'Saksi A', proof: PDF('t') });
  await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'sign', party: 'OWNER', signer: 'Pengarah Contoh', witness: 'Staf AM', proof: PDF('o') });
  const sheet = allTrue(['state', 'date', 'landlord', 'tenant', 'copies', 'description', 'rent', 'address', 'type', 'file']);
  await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'edsSubmit', sheet, assessedDuty: 30, lhdnRef: 'LHDN-1', submittedOn: TODAY, proof: PDF('eds') });
  await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'stampNotice', proof: PDF('n') });
  await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'stampTenantProof', amount: 30, proof: PDF('tp') });
  await f.act(FIN, 'agreementStep', { id: ag.id, step: 'stampConfirm', amount: 30, bankRef: 'BNK-2' });
  await f.act(FIN, 'agreementStep', { id: ag.id, step: 'stampPay', amount: 30, method: 'FPX_BYRHASIL', proof: PDF('pay') });
  await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'stampCert', checks: allTrue(['names', 'premises', 'date', 'amount', 'readable']), certRef: 'SIJIL-1', proof: PDF('cert') });
  await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'handover', proof: PDF('copy') });
  return { app, ag };
}
async function let_(f: ReturnType<typeof fresh>) {
  const { app, ag } = await stamped(f);
  for (const acc of ['TNB', 'AIR', 'IWK']) await f.act(TEAM, 'appStep', { id: app.id, step: 'utility', account: acc, proof: PDF(acc) });
  await f.act(TEAM, 'appStep', { id: app.id, step: 'handoverDate', on: '2026-12-01' });
  await f.act(TEAM, 'keys', { id: app.id, keys: [{ item: 'kunci utama', count: 2 }], photos: PDF('h'), tenantAck: PDF('ack') });
  return { app, ag };
}

describe('Part V rental: rules and times', () => {
  it('first reply due in 2 office hours the same day, or 10 am next working day after 5.30 pm (V-X11)', () => {
    expect(firstReplyDue(myt('2026-11-18', '10:00'), NO_H)).toBe('2026-11-18T12:00:00+08:00');
    expect(firstReplyDue(myt('2026-11-18', '16:30'), NO_H)).toBe('2026-11-18T17:30:00+08:00');
    expect(firstReplyDue(myt('2026-11-20', '18:00'), NO_H)).toBe('2026-11-23T10:00:00+08:00');
    expect(officeMinutesBetween(myt('2026-11-18', '17:00'), myt('2026-11-19', '09:30'), NO_H)).toBe(90);
  });
  it('income bands on applicant + spouse; gaps use the band below; outside the table the unit minimum (V45, V-X21)', () => {
    expect(incomeNeeded(1200, null)).toMatchObject({ need: 4500 });
    expect(incomeNeeded(950, null)).toMatchObject({ need: 3500 });
    expect(incomeNeeded(1550, null)).toMatchObject({ need: 4500 });
    expect(incomeNeeded(700, null).need).toBeNull();
    expect(incomeNeeded(3000, 9000).need).toBe(9000);
    expect(occupantLimit(4)).toEqual({ max: 7, warnAbove: 6 });
    expect(occupantLimit(2).max).toBe(4);
  });
});

describe('Part V rental: letting (V35-V39)', () => {
  it('blocks the advert until the unit is ready, refuses an unlisted platform and needs the screenshot', async () => {
    const f = fresh();
    await owner(f);
    const l = await f.act(TEAM, 'listingOpen', { unitId: f.unit.id });
    await expect(f.act(TEAM, 'advert', { id: l.id, platform: 'MUDAH', link: 'https://x', photosChecked: true, screenshot: PDF('s') })).rejects.toThrow(/Jangan iklan lagi: .*rent and deposit approved/);
    const f2 = fresh();
    const l2 = await ready(f2);
    await expect(f2.act(TEAM, 'advert', { id: l2.id, platform: 'TIKTOK', link: 'https://x', photosChecked: true, screenshot: PDF('s') })).rejects.toThrow(/not on the approved list/);
    await expect(f2.act(TEAM, 'advert', { id: l2.id, platform: 'MUDAH', link: 'https://x', photosChecked: true })).rejects.toThrow(/screenshot/);
    const a = await f2.act(TEAM, 'advert', { id: l2.id, platform: 'MUDAH', link: 'https://x', photosChecked: true, screenshot: PDF('s') });
    expect(a.status).toBe('DIIKLANKAN');
    expect(String((a.d.adverts as { text: string }[])[0].text)).toMatch(/RM1200\.00 sebulan/);
  });
  it('the proposer cannot approve the terms; an enquiry needs a time; Tidak layak needs a reason without race or religion', async () => {
    const f = fresh();
    const l = await ready(f);
    await f.act(TEAM, 'advert', { id: l.id, platform: 'MUDAH', link: 'https://x', photosChecked: true, screenshot: PDF('s') });
    await expect(f.act(TEAM, 'enquiry', { id: l.id, name: 'Prospek', phone: '012-1234567' })).rejects.toThrow(/date AND time/);
    await f.act(TEAM, 'enquiry', { id: l.id, name: 'Prospek', phone: '012-1234567', at: '2026-11-18T08:50' });
    await expect(f.act(TEAM, 'enquiryStep', { id: l.id, n: 1, step: 'screen', result: 'TIDAK_LAYAK' })).rejects.toThrow(/short reason/);
    await expect(f.act(TEAM, 'enquiryStep', { id: l.id, n: 1, step: 'screen', result: 'TIDAK_LAYAK', reason: 'bangsa' })).rejects.toThrow(/race, religion/);
    const r = await f.act(TEAM, 'enquiryStep', { id: l.id, n: 1, step: 'screen', result: 'BERMINAT_LAYAK', purpose: 'family' });
    expect(r.status).toBe('DALAM_PROSES');
    const b = (await f.svc.amRentalAct(await f.svc.user(AD), 'board', {})) as { late: { what: string }[] };
    f.at(TODAY, '13:00');
    const b2 = (await f.svc.amRentalAct(await f.svc.user(AD), 'board', {})) as { late: { what: string }[] };
    expect(b.late.some((x) => /first reply late/.test(x.what))).toBe(false);
    expect(b2.late.some((x) => /first reply late/.test(x.what))).toBe(true);
    // Back to Diiklankan only after the re-check.
    await expect(f.act(TEAM, 'relist', { id: l.id, reason: 'fell through', checked: { details: true } })).rejects.toThrow(/Re-check/);
    const back = await f.act(TEAM, 'relist', { id: l.id, reason: 'fell through', checked: allTrue(['details', 'rent', 'deposit', 'photos', 'terms']) });
    expect(back.status).toBe('DIIKLANKAN');
  });
  it('agent only when due, approved by the Asset Director (not the proposer), fee only with all papers and a tenant from that agent', async () => {
    const f = fresh();
    const l = await ready(f);
    await f.act(TEAM, 'advert', { id: l.id, platform: 'MUDAH', link: 'https://x', photosChecked: true, screenshot: PDF('s') });
    await expect(f.act(TEAM, 'agentPropose', { listingId: l.id, name: 'Ejen', phone: '012', why: 'no takers' })).rejects.toThrow(/after 30 days/);
    await f.act(TEAM, 'enquiry', { id: l.id, name: 'Prospek', phone: '012-1234567', at: '2026-11-18T08:50' });
    await f.act(TEAM, 'enquiryStep', { id: l.id, n: 1, step: 'screen', result: 'TIDAK_LAYAK', reason: 'income too low' });
    const a = await f.act(TEAM, 'agentPropose', { listingId: l.id, name: 'Ejen Contoh', phone: '012-9999999', why: 'every prospect unsuitable' });
    await expect(f.act(TEAM, 'agentStep', { id: a.id, step: 'feeRequest', docs: allTrue(['approval', 'terms', 'serviceProof', 'invoice']) })).rejects.toThrow(/not approved/);
    await f.act(AD, 'agentStep', { id: a.id, step: 'decide', approve: true, note: 'Use agent' });
    await expect(f.act(TEAM, 'agentStep', { id: a.id, step: 'feeRequest', docs: allTrue(['approval', 'terms', 'serviceProof', 'invoice']) })).rejects.toThrow(/did not come through this agent/);
    // An agent prospect skipping screening is refused.
    await expect(f.act(TEAM, 'application', { unitId: f.unit.id, conditionsExplained: true, applicant: { name: 'X Y' }, source: 'AGENT', agentId: a.id })).rejects.toThrow(/same screening/);
  });
});

describe('Part V rental: application to keys (V42-V48)', () => {
  it('conditions before the form; related staff blocked; income short shown; decision by the Asset Director then the Chairman / VC', async () => {
    const f = fresh();
    await ready(f);
    await expect(f.act(TEAM, 'application', { unitId: f.unit.id, applicant: { name: 'A B' } })).rejects.toThrow(/syarat diterangkan/);
    const app = await f.act(TEAM, 'application', { unitId: f.unit.id, conditionsExplained: true, applicant: { name: 'Pemohon', net: 2500 }, spouse: { name: 'P', net: 1700 }, occupants: 6, declarationSigned: true, annexSignedOn: TODAY, docs: PDF('ic'), related: { yes: true, staffUserId: TEAM2, details: 'cousin' } });
    await expect(f.act(TEAM2, 'appStep', { id: app.id, step: 'check', note: 'checked' })).rejects.toThrow(/related/);
    await f.act(TEAM, 'appStep', { id: app.id, step: 'check', note: 'checked all' });
    const s = await f.act(TEAM, 'appStep', { id: app.id, step: 'assess', recommendation: 'Short on income; Asset Director judges' });
    const rules = (s.d.assessment as { rules: { rule: string; ok: boolean | null; note: string }[] }).rules;
    expect(rules.find((r) => r.rule === 'income')).toMatchObject({ ok: false });
    expect(rules.find((r) => r.rule === 'income')!.note).toMatch(/income short/);
    expect(rules.find((r) => r.rule === 'occupants')).toMatchObject({ ok: false });
    await f.act(TEAM, 'appStep', { id: app.id, step: 'forDecision' });
    await expect(f.act(VC, 'appStep', { id: app.id, step: 'consent', note: 'ok' })).rejects.toThrow(/No approved application/);
    await f.act(AD, 'appStep', { id: app.id, step: 'decide', approve: true, note: 'Accept' });
    const c = await f.act(VC, 'appStep', { id: app.id, step: 'consent', note: 'Setuju' });
    expect(c.status).toBe('LULUS');
    // Overseers see "documents complete", never IC numbers.
    const b = (await f.svc.amRentalAct(await f.svc.user(CEO), 'board', {})) as { applications: { d: Record<string, unknown> }[] };
    expect(JSON.stringify(b.applications)).not.toMatch(/ic"/);
  });
  it('waiting for documents pauses the clock', async () => {
    const f = fresh();
    await ready(f);
    const app = await f.act(TEAM, 'application', { unitId: f.unit.id, conditionsExplained: true, applicant: { name: 'Pemohon', net: 5000 }, enquiryAt: '2026-11-18T09:00' });
    await f.act(TEAM, 'appStep', { id: app.id, step: 'waitDocs', missing: ['payslip'] });
    f.at('2026-11-24', '09:00');
    const r = await f.act(TEAM, 'appStep', { id: app.id, step: 'docsIn', docs: PDF('slip') });
    const clock = await f.svc.rental.appClock(r, '2026-11-24');
    expect(clock.waiting).toBe(4);
    expect(clock.team).toBe(0);
  });
  it('DPR in the owner company name and bank; the team cannot confirm money; part payment keeps the agreement locked', async () => {
    const f = fresh();
    const { app } = await approvedApp(f);
    const d = await f.act(TEAM, 'appStep', { id: app.id, step: 'dpr' });
    const dpr = d.d.dpr as { no: string; total: number; owner: { bankAccount: string; name: string } };
    expect(dpr.no).toMatch(/^DPR\/2026\/001$/);
    expect(dpr.total).toBe(3600);
    expect(dpr.owner.bankAccount).toBe('1234567890');
    expect(dpr.owner.name).toBe(f.unit.ownerEntity);
    await expect(f.act(TEAM, 'appStep', { id: app.id, step: 'dpr' })).rejects.toThrow(/never reused/);
    await expect(f.act(TEAM, 'appStep', { id: app.id, step: 'depositConfirm', amount: 3600, bankRef: 'x' })).rejects.toThrow(/Finance/);
    await f.act(TEAM, 'appStep', { id: app.id, step: 'depositProof', proof: PDF('slip'), amount: 3600 });
    await template(f);
    await expect(f.act(TEAM, 'agreementOpen', { appId: app.id })).rejects.toThrow(/confirms the deposit in full/);
    await f.act(FIN, 'appStep', { id: app.id, step: 'depositConfirm', result: 'DALAM_SEMAKAN', note: 'not in statement yet' });
    await f.act(FIN, 'appStep', { id: app.id, step: 'depositConfirm', amount: 2000, bankRef: 'B1' });
    await expect(f.act(TEAM, 'agreementOpen', { appId: app.id })).rejects.toThrow(/in full/);
    await f.act(FIN, 'appStep', { id: app.id, step: 'depositConfirm', amount: 1600, bankRef: 'B2' });
    const ag = await f.act(TEAM, 'agreementOpen', { appId: app.id });
    expect((ag.d.fields as { rent: number; bankAccount: string }).rent).toBe(1200);
  });
  it('keys refused until every condition (Indah Water included); then the tenancy starts with stamped from the certificate', async () => {
    const f = fresh();
    const { app } = await stamped(f);
    await f.act(TEAM, 'appStep', { id: app.id, step: 'utility', account: 'TNB', proof: PDF('tnb') });
    await f.act(TEAM, 'appStep', { id: app.id, step: 'utility', account: 'AIR', proof: PDF('air') });
    await f.act(TEAM, 'appStep', { id: app.id, step: 'handoverDate', on: '2026-12-01' });
    await expect(f.act(TEAM, 'keys', { id: app.id, keys: [{ item: 'kunci', count: 2 }], photos: PDF('h'), tenantAck: PDF('a') })).rejects.toThrow(/IWK proof/);
    await f.act(TEAM, 'appStep', { id: app.id, step: 'utility', account: 'IWK', proof: PDF('iwk') });
    await f.act(TEAM, 'keys', { id: app.id, keys: [{ item: 'kunci', count: 2 }], photos: PDF('h'), tenantAck: PDF('a') });
    const u = f.ds.amUnits.find((x) => x.id === f.unit.id)!;
    expect(u.status).toBe('let');
    expect(u.tenancy?.stamped).toBe(true);
    expect(u.tenancy?.rent).toBe(1200);
    expect(u.tenancy?.depositPayers?.[0].payer).toBe('ZAKAT');
  });
});

describe('Part V rental: agreement and stamping (V51-V57, V74-V77)', () => {
  it('an edited figure needs the Asset Director, the Chairman / VC consent and the supervisor check; LHDN only after Finance confirms the exact duty', async () => {
    const f = fresh();
    const { app } = await approvedApp(f);
    await f.act(TEAM, 'appStep', { id: app.id, step: 'dpr' });
    await f.act(FIN, 'appStep', { id: app.id, step: 'depositConfirm', amount: 3600, bankRef: 'B' });
    await template(f);
    const ag = await f.act(TEAM, 'agreementOpen', { appId: app.id });
    await expect(f.act(TEAM, 'agreementStep', { id: ag.id, step: 'change', field: 'bankAccount', value: '999', note: 'tenant asked' })).rejects.toThrow(/filled by Prima/);
    await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'change', field: 'rent', value: 1150, note: 'tenant asked for less', tenantAsked: true });
    await expect(f.act(TEAM, 'agreementStep', { id: ag.id, step: 'changeDecide', n: 1, approve: true, note: 'ok' })).rejects.toThrow(/Asset Director/);
    await f.act(AD, 'agreementStep', { id: ag.id, step: 'changeDecide', n: 1, approve: true, note: 'Accept RM1150' });
    await f.act(VC, 'agreementStep', { id: ag.id, step: 'changeConsent', n: 1, note: 'Setuju' });
    await expect(f.act(TEAM, 'agreementStep', { id: ag.id, step: 'send', proof: PDF('s') })).rejects.toThrow(/supervisor checks/);
    await expect(f.act(TEAM, 'agreementStep', { id: ag.id, step: 'check' })).rejects.toThrow(/other than the preparer/);
    await f.act(TEAM2, 'agreementStep', { id: ag.id, step: 'check' });
    await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'send', proof: PDF('s') });
    await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'final' });
    await expect(f.act(TEAM, 'agreementStep', { id: ag.id, step: 'edsSubmit' })).rejects.toThrow(/signed by both/);
    await expect(f.act(TEAM, 'agreementStep', { id: ag.id, step: 'sign', party: 'OWNER', signer: 'Orang Lain', witness: 'W', proof: PDF('o') })).rejects.toThrow(/not a recorded signatory/);
    await expect(f.act(TEAM, 'agreementStep', { id: ag.id, step: 'sign', party: 'TENANT', signer: 'Pemohon Contoh', witness: 'pemohon contoh', proof: PDF('t') })).rejects.toThrow(/witness cannot be/);
    await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'sign', party: 'TENANT', signer: 'Pemohon Contoh', witness: 'Saksi', proof: PDF('t') });
    await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'sign', party: 'OWNER', signer: 'Pengarah Contoh', witness: 'Staf', proof: PDF('o') });
    const sheet = allTrue(['state', 'date', 'landlord', 'tenant', 'copies', 'description', 'rent', 'address', 'type', 'file']);
    await expect(f.act(TEAM2, 'agreementStep', { id: ag.id, step: 'edsSubmit', sheet, assessedDuty: 30, lhdnRef: 'L', submittedOn: TODAY, proof: PDF('e') })).rejects.toThrow(/not named/);
    const e = await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'edsSubmit', sheet, assessedDuty: 30, lhdnRef: 'L', submittedOn: TODAY, proof: PDF('e') });
    expect(f.svc.rental.stampDeadline(e)).toBe('2026-12-18');
    await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'stampNotice', proof: PDF('n') });
    await f.act(TEAM, 'agreementStep', { id: ag.id, step: 'stampTenantProof', amount: 25, proof: PDF('tp') });
    await expect(f.act(FIN, 'agreementStep', { id: ag.id, step: 'stampPay', amount: 30, method: 'FPX_BYRHASIL', proof: PDF('p') })).rejects.toThrow(/only after Finance confirms/);
    await expect(f.act(FIN, 'agreementStep', { id: ag.id, step: 'stampConfirm', amount: 25, bankRef: 'B' })).rejects.toThrow(/differs from the assessed/);
    await f.act(FIN, 'agreementStep', { id: ag.id, step: 'stampConfirm', amount: 30, bankRef: 'B' });
    await f.act(FIN, 'agreementStep', { id: ag.id, step: 'stampPay', amount: 30, method: 'FPX_BYRHASIL', proof: PDF('p') });
    await expect(f.act(TEAM, 'agreementStep', { id: ag.id, step: 'stampCert', checks: { names: true }, proof: PDF('c') })).rejects.toThrow(/Check the certificate/);
  });
  it('a rental home cannot be ticked stamped by hand in the records form', async () => {
    const f = fresh();
    const u = f.ds.amUnits.find((x) => x.type === 'RESIDENTIAL' && !x.office && x.tenancy && !x.tenancy.stamped);
    if (!u) return;
    const t = u.tenancy!;
    await expect(f.svc.saveRecord(await f.svc.user(TEAM), 'amTenancy', u.id, null, { tenant: t.tenant, startOn: t.startOn, endOn: t.endOn, rent: t.rent, deposit: t.deposit, utilityDeposit: t.utilityDeposit, internal: t.internal, stamped: true })).rejects.toThrow(/stamp certificate/);
  });
});

describe('Part V rental: monthly collection and zakat (V58-V63, V28, V-X26, V-X29)', () => {
  it('invoice equals the tenancy; proof never pays; only Finance confirms; cheque only when cleared; bounce re-opens; receipts per payer', async () => {
    const f = fresh();
    await let_(f);
    await f.act(TEAM, 'zakat', { unitId: f.unit.id, body: 'Lembaga Zakat Contoh', monthly: 800, from: '2026-12-01', to: '2027-11-30', letterRef: 'LZ/1', proof: PDF('lz') });
    await expect(f.act(FIN, 'invoice', { unitId: f.unit.id, period: '2026-12', invoiceNo: 'IV-1', invoiceOn: '2026-11-20', amount: 1100 })).rejects.toThrow(/differs from the tenancy rent/);
    await expect(f.act(TEAM, 'invoice', { unitId: f.unit.id, period: '2026-12', invoiceNo: 'IV-1', invoiceOn: '2026-11-20', amount: 1200 })).rejects.toThrow(/Finance/);
    const c = await f.act(FIN, 'invoice', { unitId: f.unit.id, period: '2026-12', invoiceNo: 'IV-1', invoiceOn: '2026-11-20', amount: 1200 });
    expect(c.d).toMatchObject({ zakatPart: 800, tenantPart: 400 });
    await f.act(TEAM, 'collectionStep', { id: c.id, step: 'sent', channel: 'WHATSAPP', proof: PDF('sent') });
    const p = await f.act(TEAM, 'collectionStep', { id: c.id, step: 'proof', method: 'CHEQUE', amount: 400, on: '2026-11-26', chequeNo: '000123', chequeBank: 'Bank X', proof: PDF('chq') });
    expect(p.status).toBe('BUKTI_DITERIMA');
    const unitAfterProof = f.ds.amUnits.find((x) => x.id === f.unit.id)!;
    expect(unitAfterProof.tenancy!.invoices.find((x) => x.period === '2026-12')!.paid).toBe(0);
    await expect(f.act(TEAM, 'collectionStep', { id: c.id, step: 'confirm', n: 1, amount: 400, bankRef: 'B', on: '2026-11-27' })).rejects.toThrow(/Finance/);
    await expect(f.act(FIN, 'collectionStep', { id: c.id, step: 'confirm', n: 1, amount: 400, bankRef: 'B', on: '2026-11-27' })).rejects.toThrow(/cleared/);
    const ok = await f.act(FIN, 'collectionStep', { id: c.id, step: 'confirm', n: 1, amount: 400, bankRef: 'B', on: '2026-11-27', cleared: true });
    expect(ok.status).toBe('DISAHKAN_KEWANGAN');
    const bounced = await f.act(FIN, 'collectionStep', { id: c.id, step: 'bounce', n: 1 });
    expect(bounced.status).toBe('BUKTI_DITERIMA');
    expect(f.ds.amUnits.find((x) => x.id === f.unit.id)!.tenancy!.invoices.find((x) => x.period === '2026-12')!.paid).toBe(0);
    await f.act(FIN, 'collectionStep', { id: c.id, step: 'confirm', amount: 400, bankRef: 'B3', on: '2026-11-28' });
    await f.act(FIN, 'collectionStep', { id: c.id, step: 'confirm', amount: 500, bankRef: 'PA2612', on: '2026-12-07', payer: 'ZAKAT' });
    // Review B1: one bank credit is counted once, whatever the spelling of the reference.
    await expect(f.act(FIN, 'collectionStep', { id: c.id, step: 'confirm', amount: 100, bankRef: 'b3 ', on: '2026-12-08' })).rejects.toThrow(/counted once/);
    const rc = await f.act(FIN, 'collectionStep', { id: c.id, step: 'receipt' });
    const receipts = rc.d.receipts as { no: string; to: string }[];
    expect(receipts).toHaveLength(2);
    expect(receipts.some((r) => /Lembaga Zakat Contoh \(untuk/.test(r.to))).toBe(true);
    // After the 10th the zakat shortfall (RM300) is the tenant's.
    f.at('2026-12-11', '09:00');
    expect(f.svc.rental.tenantOwes(rc, '2026-12-11')).toMatchObject({ shortfall: 300, owes: 300 });
    expect(f.svc.rental.tenantOwes(rc, '2026-12-09').owes).toBe(0);
  });
  it('the team sees only unmatched bank lines (date, amount, reference); Finance confirms the match', async () => {
    const f = fresh();
    await let_(f);
    const c = await f.act(FIN, 'invoice', { unitId: f.unit.id, period: '2026-12', invoiceNo: 'IV-1', invoiceOn: '2026-11-20', amount: 1200 });
    const [b] = (await f.svc.amRentalAct(await f.svc.user(FIN), 'bankLine', { ownerEntity: f.unit.ownerEntity, on: '2026-11-28', amount: 1200, ref: 'IBG 555' })) as unknown as RentRec[];
    const board = (await f.svc.amRentalAct(await f.svc.user(TEAM), 'board', {})) as { bankLines: { d: Record<string, unknown> }[] };
    expect(Object.keys(board.bankLines[0].d).sort()).toEqual(['amount', 'match', 'on', 'ref']);
    await f.act(TEAM, 'bankLineStep', { id: b.id, step: 'match', unitId: f.unit.id, period: '2026-12', how: 'tenant confirmed by phone' });
    await expect(f.act(TEAM, 'bankLineStep', { id: b.id, step: 'confirm' })).rejects.toThrow(/Finance/);
    await f.act(FIN, 'bankLineStep', { id: b.id, step: 'confirm' });
    expect(f.ds.amUnits.find((x) => x.id === f.unit.id)!.tenancy!.invoices.find((x) => x.period === '2026-12')!.paid).toBe(1200);
    expect(c.status).toBe('INVOIS_DIKELUARKAN');
  });
});

describe('Part V rental: arrears (V64-V68, V-X27)', () => {
  it('3 months of the tenant part; Finance figure; 3 working days; notice on day 4 by the Asset Director (not the preparer); 14 days; lock-out locked until the lawyer', async () => {
    const f = fresh();
    await let_(f);
    const u = f.ds.amUnits.find((x) => x.id === f.unit.id)!;
    u.tenancy!.invoices = ['2026-08', '2026-09', '2026-10'].map((period) => ({ period, amount: 1200, paid: 0, paidOn: null }));
    await template(f, 'notice');
    await f.act(AD, 'setSettings', { reason: 'Authorised officers', officers: [TEAM2] });
    const a = await f.act(TEAM, 'arrearsOpen', { unitId: u.id });
    await expect(f.act(TEAM, 'arrearsStep', { id: a.id, step: 'contact', method: 'CALL' })).rejects.toThrow(/Finance confirms the amount first/);
    await f.act(FIN, 'arrearsStep', { id: a.id, step: 'confirm', amount: 3600 });
    const c = await f.act(TEAM, 'arrearsStep', { id: a.id, step: 'contact', method: 'CALL', reply: 'will try' });
    // Wed 18 Nov + 3 working days = Mon 23 Nov.
    expect(c.d.payBy).toBe('2026-11-23');
    f.at('2026-11-23', '10:00');
    await expect(f.act(TEAM, 'arrearsStep', { id: a.id, step: 'notice', officerId: TEAM2 })).rejects.toThrow(/day 4/);
    f.at('2026-11-24', '10:00');
    const n = await f.act(TEAM, 'arrearsStep', { id: a.id, step: 'notice', officerId: TEAM2 });
    expect((n.d.notice as { amountText: string; bank: string }).amountText).toBe('RM1200.00 X 3 bulan');
    expect((n.d.notice as { bank: string }).bank).toBe('1234567890');
    await expect(f.act(TEAM, 'arrearsStep', { id: a.id, step: 'noticeDeliver', proof: PDF('n') })).rejects.toThrow(/approves the notice first/);
    await f.act(AD, 'arrearsStep', { id: a.id, step: 'noticeApprove', note: 'Proceed' });
    const dl = await f.act(TEAM, 'arrearsStep', { id: a.id, step: 'noticeDeliver', proof: PDF('n'), letterOn: '2026-11-24' });
    expect((dl.d.notice as { deadline: string }).deadline).toBe('2026-12-08');
    f.at('2026-12-08', '10:00');
    const r = await f.act(TEAM, 'arrearsStep', { id: a.id, step: 'day14', vacated: false });
    expect(r.status).toBe('REFERRED');
    await expect(f.act(AD, 'arrearsStep', { id: a.id, step: 'decide', route: 'LOCKOUT', note: 'Lock out' })).rejects.toThrow(/Locked/);
    const lg = await f.act(AD, 'arrearsStep', { id: a.id, step: 'decide', route: 'LAWYER', note: "Lawyer's letter" });
    expect(lg.status).toBe('LEGAL');
  });
});

describe('Part V rental: move-out (V69-V73, V-X28, V-X29)', () => {
  it('short notice needs a reason; 2 pm rule; every room a photo; normal wear not charged; inspector cannot approve; zakat deposit back to the zakat body; never cash', async () => {
    const f = fresh();
    await let_(f);
    await expect(f.act(TEAM, 'moveoutOpen', { unitId: f.unit.id, receivedOn: '2026-12-01', proposedOn: '2026-12-15', proof: PDF('n') })).rejects.toThrow(/under the tenancy's 30/);
    const m = await f.act(TEAM, 'moveoutOpen', { unitId: f.unit.id, receivedOn: '2026-12-01', proposedOn: '2026-12-15', proof: PDF('n'), shortReason: 'Job transfer' });
    const k = await f.act(TEAM, 'moveoutStep', { id: m.id, step: 'keys', at: '2026-12-15T15:00', items: [{ item: 'kunci utama', count: 1 }], tenantSign: PDF('sig') });
    expect((k.d.keys as { inspectBy: string; missing: { item: string }[] }).inspectBy).toBe('2026-12-16');
    expect((k.d.keys as { missing: { item: string }[] }).missing[0].item).toBe('kunci utama');
    const checks = Object.fromEntries(['walls_ceiling', 'floor', 'doors_windows', 'pipes_sanitary', 'lights_switches', 'cabinets_furniture', 'cleanliness'].map((x) => [x, 'ok']));
    await expect(f.act(TEAM, 'moveoutStep', { id: m.id, step: 'inspect', rooms: [{ room: 'Bilik 1' }], checks })).rejects.toThrow(/Every room needs a photo/);
    await f.act(TEAM, 'moveoutStep', { id: m.id, step: 'inspect', rooms: [{ room: 'Bilik 1', photos: PDF('r1') }], checks, defects: [{ area: 'wall', text: 'faded paint', kind: 'NORMAL_WEAR', photos: PDF('d1') }, { area: 'door', text: 'broken by impact', kind: 'TENANT_DAMAGE', cost: 300, photos: PDF('d2') }] });
    await f.act(TEAM, 'moveoutStep', { id: m.id, step: 'utilities', accounts: [{ account: 'TNB', reading: '1234', status: 'BILL_PENDING', estimate: 120, followUpOn: '2026-12-30' }], photos: PDF('meter') });
    await f.act(FIN, 'moveoutStep', { id: m.id, step: 'figures', unpaidRent: 0 });
    const st = await f.act(TEAM, 'moveoutStep', { id: m.id, step: 'statement' });
    const s = st.d.statement as { lines: { kind: string; amount: number }[]; refund: number; payees: { payee: string }[] };
    expect(s.lines.map((x) => x.kind).sort()).toEqual(['DAMAGE', 'HOLD']);
    expect(s.refund).toBe(2400 - 420);
    expect(s.payees[0].payee).toBe('ZAKAT');
    await f.act(FIN, 'moveoutStep', { id: m.id, step: 'statementCheck' });
    await expect(f.act(TEAM, 'moveoutStep', { id: m.id, step: 'statementApprove', note: 'ok' })).rejects.toThrow(/Asset Director/);
    await f.act(AD, 'moveoutStep', { id: m.id, step: 'statementApprove', note: 'Approved' });
    await expect(f.act(FIN, 'moveoutStep', { id: m.id, step: 'refund', method: 'CASH', ref: 'x' })).rejects.toThrow(/never cash/);
    await expect(f.act(FIN, 'moveoutStep', { id: m.id, step: 'refund', method: 'TRANSFER', ref: 'x', payee: 'TENANT' })).rejects.toThrow(/zakat body/);
    await f.act(FIN, 'moveoutStep', { id: m.id, step: 'refund', method: 'TRANSFER', ref: 'IBG-9', payee: 'ZAKAT' });
    await f.act(TEAM, 'moveoutStep', { id: m.id, step: 'statementSent', proof: PDF('st') });
    await expect(f.act(TEAM, 'moveoutStep', { id: m.id, step: 'close' })).rejects.toThrow(/unsettled bill/);
    await f.act(FIN, 'moveoutStep', { id: m.id, step: 'heldSettle', account: 'TNB', amount: 90, ref: 'TNB-final' });
    const cl = await f.act(TEAM, 'moveoutStep', { id: m.id, step: 'close' });
    expect(cl.status).toBe('CLOSED');
    expect(f.ds.amUnits.find((x) => x.id === f.unit.id)!.tenancy).toBeNull();
  });
  it('a written zakat release sends the deposit to the tenant', async () => {
    const f = fresh();
    await let_(f);
    const z = await f.act(TEAM, 'zakat', { unitId: f.unit.id, body: 'Lembaga Zakat Contoh', monthly: 800, from: '2026-12-01', to: '2027-11-30', proof: PDF('lz') });
    await f.act(TEAM, 'zakat', { unitId: f.unit.id, id: z.id, release: true, ref: 'LZ/REL/1', amount: 'full', proof: PDF('rel') });
    expect((await f.svc.rental.depositPayee(f.ds.amUnits.find((x) => x.id === f.unit.id)!, 'ZAKAT')).payee).toBe('TENANT');
  });
});

describe('Part V rental: repairs, one flow (V78-V89, V-X31..V-X37)', () => {
  it('no charge without inspection; unclear blocks; quotes after the decision; proposer cannot approve; VC above RM5,000; work after the written decision; close after the tenant is told', async () => {
    const f = fresh();
    await let_(f);
    const r = await f.act(TEAM, 'repairReport', { unitId: f.unit.id, tenantLevel: 'MEDIUM', location: 'Dapur', description: 'Paip bocor', noticedOn: '2026-11-17', photos: PDF('leak') });
    await expect(f.act(TEAM, 'repairStep', { id: r.id, step: 'decide', outcome: 'TENANT', note: 'misuse' })).rejects.toThrow(/Inspect first/);
    const answers = Object.fromEntries(['atHandover', 'wornByAge', 'misuse', 'routineServicing', 'noticedVsReported', 'lateMadeWorse', 'agreementSays'].map((q) => [q, 'tidak']));
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'inspect', answers, finding: 'Old pipe in the wall', photos: PDF('in') });
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'decide', outcome: 'UNCLEAR', note: 'need contractor' });
    await expect(f.act(TEAM, 'repairStep', { id: r.id, step: 'quotes', quotes: [{ contractor: 'A', price: 100 }] })).rejects.toThrow(/before asking for quotes/);
    await expect(f.act(TEAM, 'repairStep', { id: r.id, step: 'work', on: '2026-11-20' })).rejects.toThrow(/Unclear/);
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'contractorFinding', contractor: 'Paip Contoh', cause: 'Pipe rusted by age', fee: 80, proof: PDF('cf') });
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'decide', outcome: 'OWNER', note: 'age, list A' });
    await expect(f.act(TEAM, 'repairStep', { id: r.id, step: 'quotes', quotes: [{ contractor: 'A', price: 6000 }] })).rejects.toThrow(/3 quotes/);
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'quotes', quotes: [{ contractor: 'A', price: 6000, warrantyMonths: 6 }, { contractor: 'B', price: 6500 }, { contractor: 'C', price: 7000 }], chosen: 0, proof: PDF('q') });
    await expect(f.act(TEAM, 'repairStep', { id: r.id, step: 'work', on: '2026-11-20' })).rejects.toThrow(/only after approval/);
    const ap = await f.act(AD, 'repairStep', { id: r.id, step: 'approve', approve: true, note: 'Cheapest' });
    expect(ap.status).toBe('WAITING_CONSENT');
    await expect(f.act(CEO, 'repairStep', { id: r.id, step: 'consent', note: 'ok' })).rejects.toThrow(/Vice Chairman/);
    await f.act(VC, 'repairStep', { id: r.id, step: 'consent', note: 'Setuju' });
    await expect(f.act(TEAM, 'repairStep', { id: r.id, step: 'work', on: '2026-11-20' })).rejects.toThrow(/written decision/);
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'decisionSent', proof: PDF('dec') });
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'work', on: '2026-11-20' });
    await expect(f.act(FIN, 'repairStep', { id: r.id, step: 'pay', ref: 'P' })).rejects.toThrow(/after the work is confirmed/);
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'complete', after: PDF('after'), report: PDF('rep'), invoice: PDF('inv'), scopeOk: true, test: 'no leak' });
    await expect(f.act(TEAM, 'repairStep', { id: r.id, step: 'close' })).rejects.toThrow(/Tell the tenant/);
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'told', note: 'Repair done' });
    const cl = await f.act(TEAM, 'repairStep', { id: r.id, step: 'close' });
    expect(cl.status).toBe('CLOSED');
    // A repeat within the warranty goes back to the same contractor.
    const again = await f.act(TEAM, 'repairReport', { unitId: f.unit.id, tenantLevel: 'MINOR', location: 'dapur', description: 'Bocor lagi', noticedOn: TODAY, photos: PDF('x') });
    expect(again.d.level).toBe('MEDIUM');
    expect((again.d.warrantyRepeatOf as { contractor: string }).contractor).toBe('A');
  });
  it('a tenant charge only after the decision is sent; not while an objection is open; water refund only when repaired after 3 months', async () => {
    const f = fresh();
    await let_(f);
    const r = await f.act(TEAM, 'repairReport', { unitId: f.unit.id, tenantLevel: 'MEDIUM', location: 'Pintu', description: 'Pintu pecah', noticedOn: TODAY, photos: PDF('door') });
    const answers = Object.fromEntries(['atHandover', 'wornByAge', 'misuse', 'routineServicing', 'noticedVsReported', 'lateMadeWorse', 'agreementSays'].map((q) => [q, 'tidak']));
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'inspect', answers, finding: 'Broken by impact', photos: PDF('in') });
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'decide', outcome: 'TENANT', note: 'impact damage, list B' });
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'quotes', quotes: [{ contractor: 'A', price: 300 }, { contractor: 'B', price: 350 }, { contractor: 'C', price: 400 }], chosen: 0 });
    await expect(f.act(TEAM, 'repairStep', { id: r.id, step: 'approve', approve: true, note: 'x' })).rejects.toThrow(/Asset Director/);
    await f.act(AD, 'repairStep', { id: r.id, step: 'approve', approve: true, note: 'Tenant pays' });
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'decisionSent', proof: PDF('dec') });
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'objection', note: 'I did not break it' });
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'work', on: '2026-11-20' });
    await f.act(TEAM, 'repairStep', { id: r.id, step: 'complete', after: PDF('a'), report: PDF('r'), invoice: PDF('i'), scopeOk: true, test: 'door closes' });
    await expect(f.act(FIN, 'repairStep', { id: r.id, step: 'charge', invoiceNo: 'IV-R1' })).rejects.toThrow(/objection is open/);
    await f.act(AD, 'repairStep', { id: r.id, step: 'objectionReply', note: 'Photos show impact', upheld: false });
    const ch = await f.act(FIN, 'repairStep', { id: r.id, step: 'charge', invoiceNo: 'IV-R1' });
    expect((ch.d.charge as { amount: number; dueOn: string }).amount).toBe(300);
    expect((ch.d.charge as { dueOn: string }).dueOn).toBe('2026-12-02');
    // Not counted in rent arrears.
    expect(await f.svc.rental.tenantUnpaidMonths(f.ds.amUnits.find((x) => x.id === f.unit.id)!, TODAY)).toHaveLength(0);
    const w = await f.act(TEAM, 'repairReport', { unitId: f.unit.id, tenantLevel: 'MEDIUM', location: 'Bilik air', description: 'Bil air naik', noticedOn: TODAY, photos: PDF('w') });
    await f.act(TEAM, 'repairStep', { id: w.id, step: 'inspect', answers, finding: 'Hidden pipe leak', photos: PDF('in') });
    await f.act(TEAM, 'repairStep', { id: w.id, step: 'decide', outcome: 'OWNER', note: 'hidden pipe' });
    await expect(f.act(TEAM, 'repairStep', { id: w.id, step: 'waterRefund', foundOn: '2026-08-01', repairedOn: '2026-10-15', avgBefore: 50, bills: [], proof: PDF('b') })).rejects.toThrow(/no water refund/);
    const wr = await f.act(TEAM, 'repairStep', { id: w.id, step: 'waterRefund', foundOn: '2026-06-01', repairedOn: '2026-10-15', avgBefore: 50, bills: [{ month: '2026-06', amount: 80 }, { month: '2026-07', amount: 120 }, { month: '2026-05', amount: 200 }], proof: PDF('b') });
    expect((wr.d.waterRefund as { extra: number }).extra).toBe(100);
  });
  it('a shared-area fault takes the JMB route; a critical report starts on the recorded instruction before quotes', async () => {
    const f = fresh();
    await let_(f);
    const j = await f.act(TEAM, 'repairReport', { unitId: f.unit.id, tenantLevel: 'MEDIUM', location: 'Koridor', description: 'Siling koridor bocor', noticedOn: TODAY, photos: PDF('j'), sharedArea: true });
    expect(j.status).toBe('JMB');
    const c = await f.act(TEAM, 'repairReport', { unitId: f.unit.id, tenantLevel: 'CRITICAL', location: 'DB box', description: 'Wayar terbakar', noticedOn: TODAY, photos: PDF('c') });
    await expect(f.act(TEAM, 'repairStep', { id: c.id, step: 'work', on: TODAY })).rejects.toThrow(/only after approval/);
    await f.act(TEAM, 'repairStep', { id: c.id, step: 'emergency', instructedBy: 'Asset Director by phone', note: 'Fire risk', tenantToldStop: true });
    const wk = await f.act(TEAM, 'repairStep', { id: c.id, step: 'work', on: TODAY, contractor: 'Elektrik Contoh' });
    expect(wk.status).toBe('IN_PROGRESS');
  });
});
