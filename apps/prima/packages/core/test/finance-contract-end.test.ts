import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, finBillingDue, generateDataset, myt } from '../src';

// Contract end and money held by clients (Fauzan, 2 Nov 2026: suggestions 3, 24 and A11). Dummy data only.
const TODAY = '2026-10-31';

function setup() {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const store = new MemoryStore(ds);
  let now = myt(TODAY, '10:00');
  const svc = new PrimaService(store, () => now);
  return { ds, store, svc, setDay: (d: string) => (now = myt(d, '10:00')) };
}

describe('Contract end, deposits and retention', () => {
  it('stops billing at termination, lists the follow-ups, and finds the deposit paid back on the statement', async () => {
    const { ds, store, svc, setDay } = setup();
    const c = ds.contracts.find((x) => x.state === 'active' && x.endOn > '2026-12-31')!;
    const C = c.companyId;
    const team = ds.finStatus.find((x) => x.companyId === C)!.team;
    const [lead, dep] = await Promise.all([svc.user(`u-fin-t${team}-lead`), svc.user(team === 1 ? 'u-fin-t1-dep' : 'u-fd')]);
    const bank = ds.finStatus.find((x) => x.companyId === C)!.banks[0];

    // A deposit held by the client, linked to the contract: entered, then checked by someone else.
    const d = (await svc.financeControls.depositAction(lead, C, 'add', {
      kind: 'deposit',
      contractId: c.id,
      amount: 12000,
      heldSince: '2026-01-05',
      doc: 'Contract clause 9.2',
    })) as { id: string; client: string };
    expect(d.client).toBe(c.clientName);
    await expect(svc.financeControls.depositAction(lead, C, 'check', { depositId: d.id, comment: 'Checked to clause 9.2' })).rejects.toThrow();
    await svc.financeControls.depositAction(dep, C, 'check', { depositId: d.id, comment: 'Checked to clause 9.2' });
    // Claiming before the contract ends needs a reason.
    await expect(svc.financeControls.depositAction(lead, C, 'claim', { depositId: d.id, ref: 'CL-1', docs: 'Claim letter' })).rejects.toThrow(/not ended/);

    // The company manager terminates the contract today: billing stops after October.
    const cm = ds.users.find((u) => u.role === 'company_manager' && u.companyIds.includes(C))!;
    await svc.contractStep(cm, c.id, 'terminate', 'Client ended the service (mock)');
    const ended = (await store.get('contracts', c.id))!;
    expect(ended.endedOn).toBe(TODAY);
    expect(finBillingDue([ended], C, '2026-11').length).toBe(0);
    expect(finBillingDue([ended], C, '2026-10').length).toBe(1);

    // The follow-ups open by themselves and show on Finance's home.
    const v = await svc.financeControls.view(lead, C);
    const end = v.contractEnd.ends.find((e) => e.contract.id === c.id)!;
    expect(end.steps.map((s) => s.kind)).toEqual(['final_invoice', 'deposit']);
    expect(end.open).toBe(2);
    expect((await svc.financeControls.home(lead)).some((t) => /ended contract/.test(t.title) && t.go.section === 'in')).toBe(true);

    // Claimed back; in November the money arrives and Prima finds it on the October-November statement.
    await svc.financeControls.depositAction(lead, C, 'claim', { depositId: d.id, ref: 'CL-77', docs: 'Claim letter CL-77' });
    setDay('2026-12-02');
    const csv = `date,description,ref,amount\n2026-11-20,IBG ${c.clientName.toUpperCase()},CL-77,12000.00`;
    const other = await svc.user('u-fd');
    await svc.financeControls.statementAction(team === 1 ? other : dep, C, 'load', {
      bankId: bank.id,
      period: '2026-11',
      opening: 0,
      closing: 12000,
      csv,
      source: 'mock-nov.csv',
    });
    const row = (await store.get('finStatus', `fin-${C}`))!;
    expect(row.clientDeposits![0]).toMatchObject({ status: 'refunded', refund: { amount: 12000, date: '2026-11-20' } });
  });
});
