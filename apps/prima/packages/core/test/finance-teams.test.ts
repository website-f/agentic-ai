import { describe, expect, it } from 'vitest';
import { GROUP_EMPLOYER_ID, MemoryStore, PrimaService, finTeamsFingerprint, generateDataset, myt } from '../src';
type Result = import('../src').FinTeamsResultItem;
type Request = import('../src').FinTeamsRequestItem;

// Teams approvals read into Prima (Fauzan, 1 Nov 2026: "5. Yes"). Dummy data and fake Teams results only; nothing
// reaches Microsoft 365 and nothing touches staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const T1 = GROUP_EMPLOYER_ID;
const SVC = 'oid-flow-service';
const OID: Record<string, string> = { 'u-fd': 'oid-fd', 'u-fauzan': 'oid-ceo', 'u-fin-t1-de1': 'oid-de1', 'u-fin-t1-dep': 'oid-dep', 'u-fin-t1-lead': 'oid-lead' };

async function setup(enabled = true) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  for (const u of ds.users) if (OID[u.id]) u.entraOid = OID[u.id];
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  svc.teamsApprovals = enabled;
  svc.teamsServiceOid = SVC;
  const F = () => ds.finStatus.find((x) => x.companyId === T1)!;
  const [de1, dep, fd] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd'].map((id) => svc.user(id)));
  if (enabled) await svc.finance.setSettings(fd, { values: { approvalMethod: 'teams' }, comment: 'Approve payments in Teams.' });
  const p = await svc.finance.createPayment(de1, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Office supplies', amount: 1, dueOn: '2026-11-10', bankId: F().banks[0].id, sqlRef: 'PI-TEAMS-1', evidence: ['inv.pdf'] });
  if (enabled) await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
  const pay = () => F().payments!.find((x) => x.id === p.id)!;
  const fp = finTeamsFingerprint(pay());
  const request: Request = { itemId: 'req-1', version: '1.0', createdById: 'oid-de1', modifiedAt: myt(TODAY, '10:00'), paymentId: p.id, companyId: T1, fingerprint: fp };
  const result = (over: Partial<Result> = {}): Result => ({
    itemId: 'res-1',
    etag: '"1"',
    createdById: SVC,
    lastModifiedById: SVC,
    createdAt: myt(TODAY, '10:20'),
    modifiedAt: myt(TODAY, '10:20'),
    versionCount: 1,
    approvalId: 'appr-1',
    outcome: 'Approve',
    completionDate: myt(TODAY, '10:15'),
    requestItemId: 'req-1',
    requestVersion: '1.0',
    fingerprint: fp,
    paymentId: p.id,
    companyId: T1,
    assignedTo: ['oid-fd', 'oid-ceo'],
    responses: [{ objectId: 'oid-fd', upn: 'fd@example.test', response: 'Approve', comment: 'Pay the supplier.', responseDate: myt(TODAY, '10:15') }],
    ...over,
  });
  // The read job runs a little after the approval.
  const later = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '11:00'));
  later.teamsApprovals = enabled;
  later.teamsServiceOid = SVC;
  return { svc, later, F, p, pay, request, result, fp };
}

describe('Teams approvals read into Prima (off by default)', () => {
  it('approves the payment in the name of the FD who approved in Teams, with the comment, and never twice', async () => {
    const { later, pay, request, result } = await setup();
    expect(pay().status).toBe('reviewed');
    const r = await later.financeTeams.record(T1, result(), request);
    expect([r.verdict, r.failures]).toEqual(['approved', []]);
    expect(pay().status).toBe('approved');
    expect(pay().steps.at(-1)).toMatchObject({ step: 'approved', byId: 'u-fd' });
    expect(pay().steps.at(-1)!.comment).toMatch(/Pay the supplier/);
    // Reading the same result again changes nothing.
    await later.financeTeams.record(T1, result(), request);
    expect(pay().steps.filter((s) => s.step === 'approved')).toHaveLength(1);
  });

  it('refuses everything while the switch is off', async () => {
    const { later, request, result } = await setup(false);
    await expect(later.financeTeams.record(T1, result(), request)).rejects.toThrow(/switched off/);
  });

  const notApproved: [string, (r: (o?: Partial<Result>) => Result) => Result, RegExp][] = [
    ['a result a staff member wrote', (r) => r({ createdById: 'oid-de1' }), /service account/],
    ['a result edited after it was written', (r) => r({ versionCount: 2 }), /edited/],
    ['versions that cannot be read', (r) => r({ versionCount: null }), /could not be read/],
    ['a result for an earlier version of the payment', (r) => r({ fingerprint: 'deadbeef' }), /fingerprint/],
    ['approvers assigned in Teams other than Prima’s', (r) => r({ assignedTo: ['oid-fd', 'oid-lead'] }), /exactly Prima's approvers/],
    ['an approval still pending', (r) => r({ outcome: 'Pending', completionDate: null }), /not complete|Pending/],
    ['an approver with no comment', (r) => r({ responses: [{ objectId: 'oid-fd', upn: 'fd', response: 'Approve', comment: ' ', responseDate: null }] }), /no comment/],
    ['the preparer approving in Teams', (r) => r({ assignedTo: ['oid-fd', 'oid-ceo'], responses: [{ objectId: 'oid-de1', upn: 'de1', response: 'Approve', comment: 'ok', responseDate: null }] }), /outside the required|No required approver/],
    ['an approval older than the lapse', (r) => r({ completionDate: myt('2026-09-01', '10:00') }), /older than the approval lapse|before this version/],
  ];
  for (const [name, make, why] of notApproved)
    it(`does not approve on ${name}`, async () => {
      const { later, pay, request, result } = await setup();
      const r = await later.financeTeams.record(T1, make(result), request);
      expect(r.verdict).toBe('not_approved');
      expect(r.failures.join('; ')).toMatch(why);
      expect(pay().status).toBe('reviewed');
    });

  it('does not approve when the request row was not made by Finance or names another version', async () => {
    const { later, request, result } = await setup();
    expect((await later.financeTeams.record(T1, result(), { ...request, createdById: 'oid-outsider' })).failures.join()).toMatch(/Finance staff/);
    expect((await later.financeTeams.record(T1, result({ itemId: 'res-2' }), { ...request, version: '2.0' })).failures.join()).toMatch(/version differs/);
  });

  it('a trusted Reject blocks approval and release', async () => {
    const { later, pay, request, result } = await setup();
    const r = await later.financeTeams.record(T1, result({ outcome: 'Reject', responses: [{ objectId: 'oid-fd', upn: 'fd', response: 'Reject', comment: 'Wrong supplier.', responseDate: myt(TODAY, '10:15') }] }), request);
    expect(r.verdict).toBe('rejected');
    expect(pay().status).toBe('reviewed');
    // Even forced to approved by a fault, the release is held.
    pay().status = 'approved';
    const de2 = await later.user('u-fin-t1-de2');
    await expect(later.finance.paymentStep(de2, T1, pay().id, 'release', { bankRef: 'M2U-T1', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' })).rejects.toThrow(/rejected in Teams/);
  });

  it('voids a result that changes between two reads, and refuses a replay on another payment', async () => {
    const { later, F, request, result } = await setup();
    await later.financeTeams.record(T1, result({ outcome: 'Pending', completionDate: null }), request);
    const v = await later.financeTeams.record(T1, result({ etag: '"2"' }), request);
    expect(v.verdict).toBe('void');
    // A genuine approval used for payment A cannot be pointed at payment B.
    const [de1, dep] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep'].map((id) => later.user(id)));
    const b = await later.finance.createPayment(de1, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Office supplies', amount: 2, dueOn: '2026-11-10', bankId: F().banks[0].id, sqlRef: 'PI-TEAMS-2', evidence: ['inv.pdf'] });
    await later.finance.paymentStep(dep, T1, b.id, 'review', { comment: 'ok' });
    const fpB = finTeamsFingerprint(F().payments!.find((x) => x.id === b.id)!);
    const { later: l2 } = { later };
    void l2;
    const first = await later.financeTeams.record(T1, result({ itemId: 'res-9', approvalId: 'appr-9' }), request);
    expect(first.verdict).toBe('approved');
    const replay = await later.financeTeams.record(
      T1,
      result({ itemId: 'res-9', approvalId: 'appr-9', paymentId: b.id, fingerprint: fpB }),
      { ...request, paymentId: b.id, fingerprint: fpB },
    );
    expect(replay.verdict).toBe('not_approved');
    expect(replay.failures.join()).toMatch(/already used/);
  });
});
