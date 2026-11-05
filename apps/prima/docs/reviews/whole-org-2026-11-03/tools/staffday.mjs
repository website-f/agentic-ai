// "Be the staff": run real cross-department workflows on the combined build's business code, person by person,
// and record what each person can do and what lands with the next person. Synthetic data only. Pilot rule as built.
import fs from 'node:fs';
const core = await import('/home/claude/prima-secure-app/packages/core/dist/index.js');
const { generateDataset, MemoryStore, PrimaService, withOrgLinks, myt } = core;
const TODAY = '2026-11-03';
const NOW = myt(TODAY, '10:30');
const ds = generateDataset({ today: TODAY, now: NOW });
const svc = new PrimaService(withOrgLinks(new MemoryStore(ds)), () => NOW);
const U = (id) => ds.users.find((u) => u.id === id);
const pdf = (n) => [{ kind: 'document', name: `${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 ' + n).toString('base64')}` }];
const photo = (n) => [{ kind: 'photo', name: `${n}.jpg`, data: `data:image/jpeg;base64,${Buffer.from('jpg ' + n).toString('base64')}` }];
const log = [];
let J = '';
const journey = (name) => { J = name; log.push({ j: name, steps: [] }); console.log('\n### ' + name); };
async function step(who, what, fn) {
  const u = U(who);
  try {
    const r = await fn(u);
    log.at(-1).steps.push({ who: u?.name, role: u?.title, what, ok: true });
    console.log('  OK      ', (u?.title ?? who).slice(0, 38).padEnd(38), what);
    return r;
  } catch (e) {
    log.at(-1).steps.push({ who: u?.name, role: u?.title, what, ok: false, msg: e.message });
    console.log('  REFUSED ', (u?.title ?? who).slice(0, 38).padEnd(38), what, '->', String(e.message).slice(0, 160));
    return null;
  }
}
const before = () => ds.orgTasks.length;
const handovers = (n0) => {
  const t = ds.orgTasks.slice(n0);
  for (const x of t) console.log('  HANDOVER', x.flowId, '->', x.desk, x.kind, x.unassigned ? 'UNASSIGNED' : `${x.userIds.length} people`);
  if (!t.length) console.log('  HANDOVER none');
  log.at(-1).handovers = t.map((x) => ({ flow: x.flowId, desk: x.desk, kind: x.kind, people: x.userIds.length, unassigned: x.unassigned }));
  return t;
};
const sasaSite = ds.sites.find((s) => s.companyId === 'co-sasa').id;

// 1. A new office joiner at Sasa: HR keys once; IT, Finance, CoS and Sasa's office are told; IT closes.
journey('1. New office joiner at Sasa (HR keys once)');
let n0 = before();
const joiner = { staffNo: 'SYN-J1', name: 'Synthetic Joiner One', jobTitle: 'Admin Executive', branchId: ds.branches.find((b) => b.companyId === 'co-sasa').id, employmentType: 'permanent', hiredOn: '2026-11-10', nationality: 'MY', idFull: '900101011234', gender: 'F', dob: '1990-01-01', phone: '012-345 6789', basicPay: 2800, payReason: 'Offer letter (synthetic)', status: 'active' };
await step('u-pwvsb-hr', 'HR adds the joiner (office staff, Sasa)', (u) => svc.saveRecord(u, 'officeStaff', null, 'co-sasa', joiner));
let ts = handovers(n0);
const itTask = ts.find((t) => t.desk === 'it');
await step('u-it-mgr', 'IT Manager sees it in Hand-overs', async (u) => { const i = await svc.orgLinks.inbox(u); if (!JSON.stringify(i).includes(itTask?.id ?? '§')) throw new Error('not in inbox'); return i; });
await step('u-it-mgr', 'IT Manager closes it with a note only', (u) => svc.orgLinks.close(u, itTask.id, 'done', 'Account made'));
const finTask = ts.find((t) => t.desk === 'finance');
await step('u-fin-t1-lead', 'Finance Team 1 leader closes the payroll to-do', (u) => svc.orgLinks.close(u, finTask.id, 'done', 'Added to staff payroll (synthetic)'));
await step('u-cm-sasa', 'Sasa Company Manager sees the joiner notice', async (u) => { const i = await svc.orgLinks.inbox(u); if (!JSON.stringify(i).includes('staff_join')) throw new Error('no notice for Sasa office'); return i; });

// 2. A Sasa admin exec claims medical; head verifies; HR checks; COO approves; Finance pays.
journey('2. Staff medical claim (Sasa admin executive)');
n0 = before();
const claim = await step('u-ae-sasa', 'Admin exec submits a RM120 clinic claim with receipt', (u) => svc.submitStaffClaim(u, { kind: 'MEDICAL', date: '2026-11-02', amount: 120, note: 'Clinic visit (synthetic)' }, pdf('receipt')));
const cid = claim?.id;
await step('u-ae-sasa', 'Admin exec tries to verify own claim', (u) => svc.headVerifyClaim(u, cid, true, 'ok'));
await step('u-cm-sasa', 'Company Manager (head) verifies with comment', (u) => svc.headVerifyClaim(u, cid, true, 'Receipt checked'));
await step('u-pwvsb-hr', 'HR checks the claim', (u) => svc.hrDecideClaim(u, cid, true, 'Within limit'));
await step('u-coo', 'COO approves', (u) => svc.cooDecideClaim(u, cid, true, 'Approved'));
await step('u-fin-t1-lead', 'Finance team leader pays with bank ref', (u) => svc.financePayClaim(u, cid, 'BANK-SYN-001'));
await step('u-fd', 'Finance Director pays with bank ref (if leader could not)', (u) => svc.financePayClaim(u, cid, 'BANK-SYN-001'));
handovers(n0);

// 3. Leave: admin exec applies, Company Manager decides.
journey('3. Annual leave (Sasa admin executive)');
n0 = before();
const lv = await step('u-ae-sasa', 'Admin exec applies 2 days annual leave', (u) => svc.requestLeave(u, { personId: u.personId, kind: 'ANNUAL', from: '2026-11-17', to: '2026-11-18', reason: 'Family matter (synthetic)' }));
const lid = lv?.id;
await step('u-cm-sasa', 'Company Manager approves with reason', (u) => svc.decideLeave(u, lid, true, 'Cover arranged'));
await step('u-pwvsb-hr', 'HR approves (if CM could not)', (u) => svc.decideLeave(u, lid, true, 'Cover arranged'));
handovers(n0);

// 4. Serious case at a Sasa site: raised with photo, escalated, resolved with proof, closed.
journey('4. Serious incident at a Sasa site');
n0 = before();
await step('u-sv-sasa', 'Site officer raises a P1 case with a gallery photo (not camera)', (u) => svc.raiseCase(u, { companyId: 'co-sasa', siteId: 'st-sasa-001', type: 'THEFT', severity: 'P1', title: 'Break-in (synthetic)', description: 'Lock cut', proof: photo('lock') }));
const cs = await step('u-cm-sasa', 'Company Manager raises the P1 theft case with document proof', (u) => svc.raiseCase(u, { companyId: 'co-sasa', siteId: 'st-sasa-001', type: 'THEFT', severity: 'P1', title: 'Break-in at store room (synthetic)', description: 'Lock cut, items missing', proof: pdf('statement') }));
const csId = cs?.id;
console.log('  LEVEL   ', cs?.level);
handovers(n0);
await step('u-sv-sasa', 'Site officer (stationed) verifies with proof', (u) => svc.signOffCase(u, csId, 'verified', 'Seen on site', pdf('so')));
const po = ds.users.find((u) => u.opsTier === 'patrol' && u.siteIds.includes('st-sasa-001'));
if (po) await step(po.id, 'Patrolling officer verifies with proof', (u) => svc.signOffCase(u, csId, 'verified', 'Checked on site', pdf('po')));
await step('u-om-klang', 'OM verifies with proof', (u) => svc.signOffCase(u, csId, 'verified', 'Police report made', pdf('police')));
await step('u-rom-central', 'Regional OM resolves with proof', (u) => svc.signOffCase(u, csId, 'resolved', 'Lock replaced, client told', pdf('done')));
console.log('  STATE   ', ds.cases.find((c) => c.id === csId)?.status);

// 5. New client and contract at Sasa: keyed once, Finance/CoS/Procurement/HR/CMS told.
journey('5. New client and signed contract at Sasa');
n0 = before();
const site2 = ds.sites.filter((s) => s.companyId === 'co-sasa')[5].id;
const acct = await step('u-cm-sasa', 'Company Manager adds the client', (u) => svc.addClientAccount(u, { companyId: 'co-sasa', name: 'Synthetic Client Sdn Bhd', siteIds: [site2], contractEndsOn: '2027-12-31' }));
const ct = await step('u-cm-sasa', 'Company Manager records the signed contract', (u) => svc.addContract(u, { companyId: 'co-sasa', clientAccountId: acct?.id ?? null, clientName: 'Synthetic Client Sdn Bhd', siteIds: [site2], startOn: '2026-12-01', endOn: '2027-11-30', billingMethod: 'M1', rate: 12, fixedFee: null, signedRef: 'SYN/CT/1' }));
handovers(n0);

// 6. Purchase at Sasa: raised by admin exec, quoted by Procurement, approved, ordered.
journey('6. Purchase request (Sasa)');
n0 = before();
const pr = await step('u-ae-sasa', 'Admin exec raises a purchase (torchlights)', (u) => svc.raisePurRequest(u, 'co-sasa', { title: 'Torchlights for night posts', category: 'OTHER', lines: [{ item: 'LED torchlight', stockItemId: null, qty: 10, unitPrice: 45 }] }));
const prId = pr?.id;
const sups = ds.purSuppliers.filter((s) => s.companyId === 'co-sasa').slice(0, 3);
for (const [k, s] of sups.entries()) await step('u-proc-exec', `Procurement adds quote ${k + 1}`, (u) => svc.purStep(u, prId, 'quote', { supplierId: s.id, amount: 450 + k * 10, ref: `Q-${k}`, note: 'quote', proof: pdf('quote' + k) }));
await step('u-proc-exec', 'Procurement adds online price', (u) => svc.purStep(u, prId, 'online', { source: 'Shopee', ref: 'listing', amount: 440, proof: pdf('online') }));
await step('u-proc-exec', 'Procurement submits for approval', (u) => svc.purStep(u, prId, 'submit', { supplierId: sups[0]?.id, note: 'cheapest' }));
await step('u-coo', 'COO approves with reason', (u) => svc.purStep(u, prId, 'approve', { note: 'Needed for night posts' }));
await step('u-fauzan', 'CEO approves with reason', (u) => svc.purStep(u, prId, 'approve', { note: 'Ok' }));
const prNow = ds.purRequests.find((x) => x.id === prId);
console.log('  STATE   ', prNow?.status);
handovers(n0);

// 7. IT help: IT logs a staff request, resolves; the requester confirms.
journey('7. IT help request');
n0 = before();
const tk = await step('u-ae-sasa', 'Sasa admin exec raises own help request in Prima', (u) => svc.raiseItTicket(u, { category: 'M365', priority: 'P3', title: 'Outlook not syncing (synthetic)', detail: 'Phone app' }));
const tkId = tk?.id;
await step('u-it-ex1', 'IT executive takes it', (u) => svc.itTicketStep(u, tkId, 'take', 'Looking'));
await step('u-it-ex1', 'IT executive resolves it', (u) => svc.itTicketStep(u, tkId, 'resolve', 'Re-added account'));
await step('u-ae-sasa', 'Requester (Sasa admin exec) confirms the fix in Prima', (u) => svc.confirmItTicket(u, tkId, true, 'Works now'));
const tkNow = ds.itTickets.find((x) => x.id === tkId);
console.log('  STATE   ', tkNow?.status, 'requester user', tkNow?.requesterId ?? tkNow?.raisedById ?? '(none)');

// 8. ACT finding: raised, owner plans and fixes, ACT checks.
journey('8. ACT finding to a Sasa owner');
const f = await step('u-audit', 'ACT Director raises a finding for Sasa CM', (u) => svc.raiseActFinding(u, { companyId: 'co-sasa', area: 'IT', source: 'manual', title: 'Expired permits on roster (synthetic)', detail: '14 rostered guards not allowed to work', severity: 'high', evidence: 'Company today screen', ownerUserId: 'u-cm-sasa' }));
const fid = f?.id;
await step('u-cm-sasa', 'Company Manager plans the fix', (u) => svc.actFindingStep(u, fid, 'plan', { rootCause: 'No check before rostering', solution: 'Roster refuses expired permits', targetOn: '2026-11-10' }));
await step('u-cm-sasa', 'Company Manager marks fixed with proof', (u) => svc.actFindingStep(u, fid, 'fixed', { proof: 'Roster export 3 Nov (synthetic)' }));
await step('u-audit', 'ACT checks the fix', (u) => svc.actFindingStep(u, fid, 'check', { ok: true, note: 'Verified on roster' }));

fs.writeFileSync('/tmp/claude-0/rev/staffday.json', JSON.stringify(log, null, 1));
