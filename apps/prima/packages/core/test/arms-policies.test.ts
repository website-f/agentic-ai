// Part R (Fitri package, Fauzan's answers R-X1..R-X11, 13-14 Nov 2026): arms, vault, licence and bulletproof jacket
// policies. Made-up data only, in memory. PostgreSQL is tested apart in apps/api/test/arms-policies-pg.test.ts.
import { describe, expect, it } from 'vitest';
import { AccessDenied, FIREARM_OUT_OF_USE, MemoryStore, PrimaService, TradingOff, armsIssueCheck, generateDataset, myt, type ArmsPolicyRec, type Dataset, type User } from '../src';

const TODAY = '2026-11-16';
const NOW = myt(TODAY, '10:30');
const PDF = (n: string) => [{ kind: 'document', name: `${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 ' + n).toString('base64')}` }];

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const act = async (uid: string, op: string, i: Record<string, unknown>) => svc.armsPolicyAct(await svc.user(uid), op, i);
  return { ds, svc, act };
}
const inVault = (ds: Dataset, companyId = 'co-sasa') => ds.firearms.find((f) => f.companyId === companyId && f.status === 'IN_VAULT' && f.ownership !== 'TRADE')!;
const allTrue = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, true]));
const GRN_CHECKS = ['quantity', 'type', 'serials', 'deliveryOrder', 'invoice', 'condition', 'approvalLetter', 'supplier'];
const INSPECT = ['outerClean', 'rustCrackWear', 'serialMatch', 'statusNotes', 'noIsolationNeeded'];

describe('Part R arms policies: firearm condition (R1-R6)', () => {
  it('blocks the issue for every new out-of-use status', () => {
    const { ds } = fresh();
    const f = inVault(ds);
    const v = ds.vaults.find((x) => x.id === f.vaultId)!;
    const site = ds.sites.find((s) => s.companyId === f.companyId && s.armed)!;
    const person = ds.people.find((p) => p.companyId === f.companyId && p.status === 'active')!;
    for (const status of ['NEEDS_MAINTENANCE', 'UNDER_INSPECTION', 'DAMAGED', 'IN_REPAIR', 'UNUSABLE'] as const) {
      expect(FIREARM_OUT_OF_USE).toContain(status);
      const out = armsIssueCheck({ person, credentials: ds.credentials, firearm: { ...f, status }, vault: v, site, shift: null, issuer: 'x', witness: 'y', today: TODAY, firearmBusy: false });
      const hit = out.find((x) => x.code === 'NOT_IN_VAULT');
      expect(hit?.level).toBe('block');
      expect(hit?.message).toMatch(/JANGAN DIGUNAKAN/);
    }
  });

  it('a damage report puts the firearm out of use; a category is lowered only by Arms Control with a reason; a critical one opens a P1 case', async () => {
    const { ds, act } = fresh();
    const f = inVault(ds);
    const r = (await act('u-cm-sasa', 'damageReport', { firearmId: f.id, what: 'Cracked grip', category: 'MEDIUM', photos: PDF('grip') })) as ArmsPolicyRec;
    expect(ds.firearms.find((x) => x.id === f.id)!.status).toBe('DAMAGED');
    await expect(act('u-cm-sasa', 'damageCategory', { id: r.id, category: 'LIGHT', reason: 'looks fine' })).rejects.toThrow(/Only Arms Control lowers/);
    await expect(act('u-pwvsb-arms', 'damageCategory', { id: r.id, category: 'LIGHT' })).rejects.toThrow(/why the category is lowered/);
    await act('u-pwvsb-arms', 'damageCategory', { id: r.id, category: 'LIGHT', reason: 'Armourer says cosmetic only' });
    const cases = ds.cases.length;
    const up = (await act('u-pwvsb-arms', 'damageCategory', { id: r.id, category: 'CRITICAL' })) as ArmsPolicyRec;
    expect(ds.cases.length).toBe(cases + 1);
    expect(ds.cases.at(-1)!.severity).toBe('P1');
    expect(ds.cases.at(-1)!.type).toBe('ARMS');
    expect(up.d.caseRef).toBe(ds.cases.at(-1)!.ref);
  });

  it('refuses a damage report on an issued firearm (return it first)', async () => {
    const { ds, act } = fresh();
    const f = inVault(ds);
    f.status = 'ISSUED';
    await expect(act('u-cm-sasa', 'damageReport', { firearmId: f.id, what: 'Jammed' })).rejects.toThrow(/Pulangkan/);
  });

  it('the reporter and the repairer cannot confirm reuse; reuse needs a passing inspection and the reviews', async () => {
    const { ds, act } = fresh();
    const f = inVault(ds);
    // Arms Control reports it, so Arms Control (the reporter) cannot confirm; the assistant can.
    const r = (await act('u-pwvsb-arms', 'damageReport', { firearmId: f.id, what: 'Rust on the barrel', category: 'MEDIUM' })) as ArmsPolicyRec;
    await expect(act('u-pwvsb-arms-asst', 'reuse', { firearmId: f.id, reason: 'Cleaned and checked' })).rejects.toThrow(/passing inspection/);
    await act('u-pwvsb-arms-asst', 'inspect', { firearmId: f.id, checks: allTrue(INSPECT) });
    await expect(act('u-pwvsb-arms', 'reuse', { firearmId: f.id, reason: 'Cleaned and checked' })).rejects.toThrow(/did not report it/);
    await expect(act('u-pwvsb-arms-asst', 'reuse', { firearmId: f.id, reason: 'Cleaned and checked' })).rejects.toThrow(/company manager/);
    await act('u-cm-sasa', 'damageReview', { id: r.id, reason: 'Agree it can be repaired in-house by cleaning' });
    await expect(act('u-cm-sasa', 'reuse', { firearmId: f.id, reason: 'ok now' })).rejects.toBeInstanceOf(AccessDenied);
    await act('u-pwvsb-arms-asst', 'reuse', { firearmId: f.id, reason: 'Cleaned and checked, function test passed' });
    expect(ds.firearms.find((x) => x.id === f.id)!.status).toBe('IN_VAULT');
  });

  it('a failed inspection opens a damage report with the findings; possible negligence is only linked by HR, never a pay deduction', async () => {
    const { ds, act } = fresh();
    const f = inVault(ds);
    await expect(act('u-cm-sasa', 'inspect', { firearmId: f.id, checks: { outerClean: true } })).rejects.toThrow(/found/);
    await act('u-cm-sasa', 'inspect', { firearmId: f.id, checks: { outerClean: true }, findings: 'Serial plate loose' });
    const dmg = ds.armsPolicyRecs.find((r) => r.kind === 'damage' && r.firearmId === f.id)!;
    expect(String(dmg.d.what)).toMatch(/Serial plate loose/);
    expect(ds.firearms.find((x) => x.id === f.id)!.status).toBe('DAMAGED');
    const neg = (await act('u-cm-sasa', 'damageReport', { firearmId: inVault(ds).id, what: 'Dropped on duty', negligence: true, negligenceFacts: 'Left unholstered' })) as ArmsPolicyRec;
    await expect(act('u-cm-sasa', 'negligenceLink', { id: neg.id, hrCaseRef: 'HR-1' })).rejects.toBeInstanceOf(AccessDenied);
    const linked = (await act('u-pwvsb-hr', 'negligenceLink', { id: neg.id, hrCaseRef: 'HR-DC-0001' })) as ArmsPolicyRec;
    expect(linked.d.hrCaseRef).toBe('HR-DC-0001');
  });
});

describe('Part R arms policies: licences and vaults (R7-R11)', () => {
  it('a licence application cannot be submitted with a missing document, and the preparer cannot check it', async () => {
    const { ds, act } = fresh();
    const p = ds.people.find((x) => x.companyId === 'co-sasa' && x.status === 'active')!;
    const app = (await act('u-pwvsb-arms', 'licenceApp', { personId: p.id, category: 'AMRA' })) as ArmsPolicyRec;
    await expect(act('u-pwvsb-arms', 'licStep', { id: app.id, step: 'submit', on: TODAY, ipdRef: 'IPD/1', docs: PDF('rcpt') })).rejects.toThrow(/Not complete/);
    await expect(act('u-pwvsb-arms', 'licStep', { id: app.id, step: 'check', reason: 'All in order' })).rejects.toThrow(/never the preparer/);
    await expect(act('u-cm-sasa', 'licStep', { id: app.id, step: 'hr', reason: 'eligible' })).rejects.toBeInstanceOf(AccessDenied);
    await act('u-pwvsb-hr', 'licStep', { id: app.id, step: 'hr', reason: 'Eligible on the HR file' });
    const err = await act('u-pwvsb-arms', 'licStep', { id: app.id, step: 'submit', on: TODAY, ipdRef: 'IPD/1', docs: PDF('rcpt') }).catch((e: Error) => e.message);
    expect(err).not.toMatch(/HR eligibility/);
    expect(err).toMatch(/record and drug check/);
  });

  it('a vault being applied for cannot receive or issue firearms; an Amra without a valid AMRA licence blocks the vault', async () => {
    const { ds, svc, act } = fresh();
    const app = (await act('u-cm-sasa', 'vaultApp', { companyId: 'co-sasa', name: 'New armoury (test)' })) as ArmsPolicyRec;
    const v = ds.vaults.find((x) => x.id === app.vaultId)!;
    expect(v.state).toBe('APPLYING');
    const f = inVault(ds);
    const site = ds.sites.find((s) => s.companyId === 'co-sasa' && s.armed)!;
    const person = ds.people.find((p) => p.companyId === 'co-sasa' && p.status === 'active')!;
    expect((await svc.armsPolicy.issueFindings(f, v, person, site, TODAY)).some((x) => x.code === 'VAULT_APPLYING' && x.level === 'block')).toBe(true);
    const main = ds.vaults.find((x) => x.id === f.vaultId)!;
    main.custodianPersonId = person.id;
    expect((await svc.armsPolicy.issueFindings(f, main, person, site, TODAY)).some((x) => x.code === 'VAULT_STAFF_LICENCE')).toBe(true);
    ds.credentials.push({ id: 'cr-amra-test', companyId: 'co-sasa', personId: person.id, type: 'FIREARM_PERMIT', number: 'AMRA-T1', issuedOn: '2026-01-01', expiresOn: '2027-06-30', licenceCategory: 'AMRA', licenceState: 'active' } as never);
    expect((await svc.armsPolicy.issueFindings(f, main, person, site, TODAY)).some((x) => x.code === 'VAULT_STAFF_LICENCE')).toBe(false);
    // Moving a firearm into the applying vault is refused at the register change.
    const cm = await svc.user('u-cm-sasa');
    const move = await svc.raiseArmsRequest(cm, { companyId: 'co-sasa', kind: 'MOVE', title: 'Move to the new armoury', note: '', firearmIds: [f.id], toVaultId: v.id });
    Object.assign(ds.armsRequests.find((x) => x.id === move.id)!, { state: 'verified' });
    await expect(svc.armsRequestStep(await svc.user('u-pwvsb-arms'), move.id, 'reconcile', '')).rejects.toThrow(/still being applied for/);
  });

  it('vault access is by written authorisation, never self-given; an entry by someone not on the list opens a P1 case', async () => {
    const { ds, act } = fresh();
    const cm = ds.users.find((u) => u.id === 'u-cm-sasa')!;
    const v = ds.vaults.find((x) => x.companyId === 'co-sasa')!;
    await expect(act('u-cm-sasa', 'vaultAuth', { vaultId: v.id, name: cm.name, letterRef: 'AUTH/1', letterOn: TODAY, reason: 'Custodian' })).rejects.toThrow(/Nobody authorises themselves/);
    await act('u-cm-sasa', 'vaultAuth', { vaultId: v.id, name: 'Vault Officer A (test)', letterRef: 'AUTH/2', letterOn: TODAY, reason: 'Appointed vault officer' });
    const cases = ds.cases.length;
    const log = (await act('u-cm-sasa', 'vaultLog', { vaultId: v.id, person: 'Stranger (test)', purpose: 'Count', witness: 'Vault Officer A (test)' })) as ArmsPolicyRec;
    expect(log.status).toBe('unauthorised');
    expect(ds.cases.length).toBe(cases + 1);
    expect(ds.cases.at(-1)!.severity).toBe('P1');
  });
});

describe('Part R arms policies: buying (R12-R18)', () => {
  async function approvedBuy(ds: Dataset, svc: PrimaService, supplierOk = true) {
    Object.assign(ds.armsSuppliers[0], supplierOk ? { licenceRef: 'DL-T', licenceExpiresOn: '2027-12-31' } : { licenceRef: 'DL-T', licenceExpiresOn: '2026-01-31' });
    const arms = await svc.user('u-pwvsb-arms');
    const r = await svc.raiseArmsRequest(arms, { companyId: 'co-sasa', kind: 'ACQUIRE', title: 'Buy pistols and rounds (test)', note: 'Posts', calibre: '9 mm', quantity: 200, estCost: 9000, supplierId: ds.armsSuppliers[0].id });
    return r;
  }

  it('ACQUIRE is refused with an unlicensed or expired dealer', async () => {
    const { ds, svc } = fresh();
    const r = await approvedBuy(ds, svc, false);
    await expect(svc.armsRequestStep(await svc.user('u-pwvsb-arms-asst'), r.id, 'pass', 'Quantities match the posts')).rejects.toThrow(/expired/);
    ds.armsSuppliers[0].licenceRef = null as never;
    await expect(svc.armsRequestStep(await svc.user('u-pwvsb-arms-asst'), r.id, 'pass', 'Quantities match the posts')).rejects.toThrow(/Only licensed dealers/);
  });

  it('receiving above the approved quantity is refused, the requester cannot receive, and ammunition is added by counted rounds', async () => {
    const { ds, svc, act } = fresh();
    const r = await approvedBuy(ds, svc);
    const vault = ds.vaults.find((v) => v.companyId === 'co-sasa' && (v.kind ?? 'COMPANY_ARMOURY') === 'COMPANY_ARMOURY')!;
    await act('u-cm-sasa', 'approvalLetter', { requestId: r.id, permitNo: 'PDRM/T/1', on: TODAY, firearmKind: 'Pistol', firearmQty: 1, calibre: '9 mm', rounds: 200, holderName: 'Licence holder (test)', docs: PDF('letter') });
    const firearms = [{ tag: 'SASA-PT-NEW1', kind: 'Pistol', serial: 'TESTSERIAL001', serialConfirm: 'TESTSERIAL001', vaultId: vault.id, licenceRef: 'LIC-T' }];
    await expect(act('u-pwvsb-arms', 'armsGrn', { requestId: r.id, firearms, roundsCounted: 150, doNo: 'DO-T', checks: allTrue(GRN_CHECKS) })).rejects.toThrow(/not the requester/);
    await expect(act('u-pwvsb-arms-asst', 'armsGrn', { requestId: r.id, firearms, roundsCounted: 250, doNo: 'DO-T', checks: allTrue(GRN_CHECKS) })).rejects.toThrow(/More rounds/);
    await expect(act('u-pwvsb-arms-asst', 'armsGrn', { requestId: r.id, firearms: [...firearms, { ...firearms[0], tag: 'SASA-PT-NEW2', serial: 'TESTSERIAL002' }], roundsCounted: 150, doNo: 'DO-T', checks: allTrue(GRN_CHECKS) })).rejects.toThrow(/More firearms/);
    await act('u-pwvsb-arms-asst', 'armsGrn', { requestId: r.id, firearms, roundsCounted: 150, calibre: '9 mm', doNo: 'DO-T', checks: allTrue(GRN_CHECKS) });
    Object.assign(ds.armsRequests.find((x) => x.id === r.id)!, { state: 'verified' });
    const stock = () => ds.ammoStocks.find((s) => s.vaultId === vault.id && s.ownership !== 'TRADE' && s.calibre.toLowerCase() === '9 mm');
    const before = stock()?.ledger ?? 0;
    await svc.armsRequestStep(await svc.user('u-pwvsb-arms-asst'), r.id, 'reconcile', '');
    expect(stock()!.ledger).toBe(before + 150);
    const added = ds.firearms.find((f) => f.tag === 'SASA-PT-NEW1')!;
    expect(added.status).toBe('UNDER_INSPECTION');
    expect(added.serial).toBe('TESTSERIAL001');
  });

  it('after day 14 of the approval letter there is no order or receipt on it', async () => {
    const { ds, svc, act } = fresh();
    const r = await approvedBuy(ds, svc);
    await act('u-cm-sasa', 'approvalLetter', { requestId: r.id, permitNo: 'PDRM/T/2', on: '2026-10-30', firearmQty: 0, calibre: '9 mm', rounds: 200, holderName: 'Holder (test)', docs: PDF('l2') });
    await expect(act('u-cm-sasa', 'order', { requestId: r.id, poRef: 'PO-1' })).rejects.toThrow(/Lebih 14 hari/);
  });
});

describe('Part R arms policies: bulletproof jackets (R19-R22)', () => {
  it('a jacket is never passed guard to guard without the return being recorded', async () => {
    const { act } = fresh();
    const j = (await act('u-proc-store1', 'jacket', { serial: 'BV-T-0001', maker: 'Maker (test)', model: 'Level IIIA (test)', size: 'L' })) as ArmsPolicyRec;
    expect(j.companyId).toBe('goodwill');
    await act('u-proc-store1', 'jacketIssue', { id: j.id, guard: 'Guard A (test)', guardConfirmed: true, condition: 'Good' });
    await expect(act('u-proc-store1', 'jacketIssue', { id: j.id, guard: 'Guard B (test)', guardConfirmed: true, condition: 'Good' })).rejects.toThrow(/Pulangkan dan rekod dahulu/);
    const h = (await act('u-proc-store1', 'jacketHandover', { id: j.id, guard: 'Guard B (test)', guardConfirmed: true, returnCondition: 'Good' })) as ArmsPolicyRec;
    expect(h.d.holder).toBe('Guard B (test)');
    expect((h.d.issues as { returnedOn: string | null }[])[0].returnedOn).toBe(TODAY);
  });

  it('price alone cannot win a jacket purchase, and the inspector does not decide on a quarantined jacket', async () => {
    const { act } = fresh();
    const b = (await act('u-cm-sasa', 'jacketBuy', { project: 'Bank CIT (test)', purpose: 'CIT crews', justification: 'Two crews', needed: 4, guards: 4, held: 0 })) as ArmsPolicyRec;
    await expect(act('u-proc-exec', 'jacketBuyStep', { id: b.id, step: 'quotes', quotes: [] })).rejects.toThrow(/specification/);
    await act('u-pwvsb-arms', 'jacketBuyStep', { id: b.id, step: 'spec', spec: 'NIJ IIIA, sizes M-XL' });
    await act('u-proc-exec', 'jacketBuyStep', { id: b.id, step: 'quotes', quotes: [{ supplier: 'Cheap (test)', price: 100, specMet: false, docs: true }, { supplier: 'Good (test)', price: 300, specMet: true, docs: true }, { supplier: 'Mid (test)', price: 250, specMet: true, docs: false }] });
    await expect(act('u-proc-exec', 'jacketBuyStep', { id: b.id, step: 'choose', supplier: 'Cheap (test)' })).rejects.toThrow(/Price alone/);
    await expect(act('u-proc-exec', 'jacketBuyStep', { id: b.id, step: 'choose', supplier: 'Mid (test)' })).rejects.toThrow(/product documents/);
    const j = (await act('u-proc-store1', 'jacket', { serial: 'BV-T-0002', maker: 'Maker (test)', model: 'IIIA' })) as ArmsPolicyRec;
    await act('u-proc-store1', 'jacketInspect', { id: j.id, result: 'DIKUARANTIN', checks: { outside: true } });
    await expect(act('u-proc-store1', 'jacketDecide', { id: j.id, decision: 'reuse', reason: 'Looks fine' })).rejects.toThrow(/other than the inspector/);
    await act('u-proc-store2', 'jacketDecide', { id: j.id, decision: 'maker_repair', reason: 'Panel cover torn; maker repairs' });
  });
});

describe('Part R arms policies: the arms wall', () => {
  it('Finance, the CoS and legal see no arms policy records; the store team sees jackets only', async () => {
    const { ds, act, svc } = fresh();
    await act('u-cm-sasa', 'damageReport', { firearmId: inVault(ds).id, what: 'Broken sight' });
    await act('u-proc-store1', 'jacket', { serial: 'BV-T-0009', maker: 'Maker (test)', model: 'IIIA' });
    for (const uid of ['u-fd', 'u-cos', 'u-legal']) await expect(act(uid, 'board', {})).rejects.toBeInstanceOf(AccessDenied);
    const stores = (await act('u-proc-store1', 'board', {})) as { role: string; records: ArmsPolicyRec[] };
    expect(stores.role).toBe('stores');
    expect(stores.records.every((r) => r.kind.startsWith('jacket'))).toBe(true);
    const ac = (await act('u-pwvsb-arms', 'board', {})) as { records: ArmsPolicyRec[] };
    expect(ac.records.some((r) => r.kind === 'damage')).toBe(true);
    // Another company's manager does not see this company's records.
    const arsh = (await svc.armsPolicyAct(await svc.user('u-cm-arsh'), 'board', {})) as { records: ArmsPolicyRec[] };
    expect(arsh.records.some((r) => r.companyId === 'co-sasa')).toBe(false);
  });
});

describe('Part R arms policies: dealer trade stock stays off (R28-R32)', () => {
  async function ceoOn(svc: PrimaService, ds: Dataset) {
    const dl = ds.dealerLicences[0];
    Object.assign(dl, { status: 'approved', reference: 'DL/T/1', expiresOn: '2026-12-31', placeOfBusiness: 'Premises (test)', docId: 'sha-t' });
    await svc.setArmsTrading(await svc.user('u-fauzan'), true, 'Dealer licence DL/T/1 recorded');
    return dl;
  }
  const raiseTrade = async (svc: PrimaService, companyId: string, u: User) => svc.raiseArmsRequest(u, { companyId, kind: 'TRADE_BUY', title: 'Trade rounds (test)', note: '', calibre: '9 mm', quantity: 100 });

  it('switch-on is refused with no licence; one company licensed does not let another trade; an expired licence stops trading', async () => {
    const { ds, svc } = fresh();
    await expect(svc.setArmsTrading(await svc.user('u-fauzan'), true, 'Going live (test)')).rejects.toThrow(/dealer licence/);
    const dl = await ceoOn(svc, ds);
    const arms = await svc.user('u-pwvsb-arms');
    await expect(raiseTrade(svc, 'co-sasa', arms)).rejects.toBeInstanceOf(TradingOff);
    const ok = await raiseTrade(svc, dl.companyId, arms);
    expect(ok.kind).toBe('TRADE_BUY');
    dl.expiresOn = '2026-11-01';
    await expect(raiseTrade(svc, dl.companyId, arms)).rejects.toBeInstanceOf(TradingOff);
  });

  it('every trade action is refused while the switch is off, even with an approved licence', async () => {
    const { ds, svc } = fresh();
    Object.assign(ds.dealerLicences[0], { status: 'approved', reference: 'DL/T/2', expiresOn: '2026-12-31', placeOfBusiness: 'P', docId: 'd' });
    await expect(raiseTrade(svc, ds.dealerLicences[0].companyId, await svc.user('u-pwvsb-arms'))).rejects.toBeInstanceOf(TradingOff);
  });

  it('trade stock is refused into a vault with no trade store approval, and trade rounds are untouched by guard issues', async () => {
    const { ds, svc, act } = fresh();
    const dl = await ceoOn(svc, ds);
    const arms = await svc.user('u-pwvsb-arms');
    const r = await raiseTrade(svc, dl.companyId, arms);
    Object.assign(ds.armsRequests.find((x) => x.id === r.id)!, { state: 'verified' });
    await expect(svc.armsRequestStep(await svc.user('u-pwvsb-arms-asst'), r.id, 'reconcile', '')).rejects.toThrow(/trade store/);
    const v = { ...ds.vaults.find((x) => x.companyId === 'co-sasa')!, id: 'va-trade-test', companyId: dl.companyId, name: 'Dealer store (test)', state: 'ACTIVE' as const, tradeStoreApproval: null };
    ds.vaults.push(v);
    await act('u-pwvsb-arms', 'tradeStore', { vaultId: v.id, ref: 'PDRM/STOR/1', on: TODAY, placeOfBusiness: 'Premises (test)', docs: PDF('store') });
    await svc.armsRequestStep(await svc.user('u-pwvsb-arms-asst'), r.id, 'reconcile', '');
    const trade = ds.ammoStocks.find((s) => s.vaultId === v.id && s.ownership === 'TRADE')!;
    expect(trade.ledger).toBe(100);
    // The operational ledger for the same calibre is a separate row; guard issues look only at OPERATIONAL rows.
    expect(ds.ammoStocks.filter((s) => s.vaultId === v.id && s.calibre === '9 mm' && s.ownership !== 'TRADE').every((s) => s.id !== trade.id)).toBe(true);
  });
});
