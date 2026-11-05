import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, finDailyCashExceptions, generateDataset, myt } from '../src';

// Daily cash pay (Fauzan, 2 Nov 2026): Finance lists the people for the week or month, only the FD approves, then the
// cash is prepared and the COO or CEO collects it and pays. Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const C = 'co-09'; // Finance team 1
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const F = () => ds.finStatus.find((x) => x.companyId === C)!;
  return { ds, svc, F };
};
const who = (svc: PrimaService, ...ids: string[]) => Promise.all(ids.map((id) => svc.user(id)));
const people = [
  { name: 'Ali bin Abu', idLast4: '1234', work: 'Orchard harvest, Kedah', dailyRate: 120, days: ['2026-10-29', '2026-10-30', '2026-10-31'] },
  { name: 'Bala a/l Muthu', idLast4: 'A987', work: 'Orchard harvest, Kedah', dailyRate: 100 },
];

describe('Daily cash pay (Fauzan, 2 Nov 2026)', () => {
  it('lists, has only the FD approve, prepares the cash after, and lets only the COO or CEO pay listed people', async () => {
    const { svc, F } = fresh();
    const [de1, de2, lead, fd, ceo, coo] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-lead', 'u-fd', 'u-fauzan', 'u-coo');
    const bankId = F().banks[0].id;
    const l = (await svc.financeControls.dailyCashAction(de1, C, 'add', {
      period: 'week',
      from: '2026-10-29',
      to: '2026-11-04',
      bankId,
      purpose: 'Harvest workers who are paid in cash at the end of each day',
      people,
    })) as { id: string; total: number; people: { id: string; amount: number }[] };
    expect(l.total).toBe(1060); // 3 x 120 + 7 x 100
    const [ali, bala] = l.people.map((p) => p.id);
    const act = (u: typeof de1, action: string, input: Record<string, unknown> = {}) =>
      svc.financeControls.dailyCashAction(u, C, action, { listId: l.id, ...input });

    // Cash is prepared only after the FD approves.
    await expect(act(de1, 'withdraw', { on: TODAY, amount: 1060, ref: 'CHQ 100201' })).rejects.toThrow(/after the Finance Director approves/);
    await act(de1, 'submit');
    expect((await svc.financeControls.home(fd)).some((t) => /daily cash list\(s\) to approve/.test(t.title))).toBe(true);
    // Only the FD: not the CEO, not the team leader; always with a comment.
    await expect(act(ceo, 'approve', { comment: 'ok' })).rejects.toThrow(/only the Finance Director/);
    await expect(act(lead, 'approve', { comment: 'ok' })).rejects.toThrow(/only the Finance Director/);
    await expect(act(fd, 'approve')).rejects.toThrow(/comment/);
    await act(fd, 'approve', { comment: 'Harvest week, rates as agreed with the orchard manager' });

    // Never more than the approved total.
    await expect(act(de1, 'withdraw', { on: TODAY, amount: 2000, ref: 'CHQ 100201' })).rejects.toThrow(/more than the approved/);
    await act(de1, 'withdraw', { on: TODAY, amount: 1060, ref: 'CHQ 100201' });
    // Handed only to the COO or the CEO.
    await expect(act(de1, 'handover', { toId: de2.id, amount: 1060 })).rejects.toThrow(/only to the COO or the CEO/);
    await act(de1, 'handover', { toId: coo.id, amount: 1060 });
    expect((await svc.home(coo)).todo.some((t) => /daily cash handover\(s\) to count and confirm/.test(t.title))).toBe(true);

    // The COO counts before paying; Finance staff cannot pay.
    await expect(act(coo, 'pay', { personId: ali, day: '2026-10-29', idLast4: '1234', proof: 'Pay sheet signed' })).rejects.toThrow(/hold none/);
    await act(coo, 'received', { handoverId: 'h1', counted: 1060 });
    await expect(act(de1, 'pay', { personId: ali, day: '2026-10-29', idLast4: '1234', proof: 'Pay sheet signed' })).rejects.toThrow(/only the COO or the CEO/);
    await expect(act(coo, 'pay', { personId: ali, day: '2026-10-29', idLast4: '9999', proof: 'Pay sheet signed' })).rejects.toThrow(/do not match/);
    await expect(act(coo, 'pay', { personId: ali, day: '2026-10-29', idLast4: '1234' })).rejects.toThrow(/proof/);
    await expect(act(coo, 'pay', { personId: ali, day: '2026-10-29', idLast4: '1234', amount: 150, proof: 'Pay sheet' })).rejects.toThrow(/daily rate/);
    await expect(act(coo, 'pay', { personId: 'p9', day: '2026-10-29', idLast4: '1234', proof: 'Pay sheet' })).rejects.toThrow(/approved list/);
    await expect(act(coo, 'pay', { personId: bala, day: '2026-11-01', idLast4: 'A987', proof: 'Pay sheet' })).rejects.toThrow(/once it has come/);
    for (const day of ['2026-10-29', '2026-10-30', '2026-10-31']) {
      await act(coo, 'pay', { personId: ali, day, idLast4: '1234', proof: `Pay sheet ${day} signed` });
      await act(coo, 'pay', { personId: bala, day, idLast4: 'a987', proof: `Pay sheet ${day} thumbprint` });
    }
    await expect(act(coo, 'pay', { personId: ali, day: '2026-10-31', idLast4: '1234', proof: 'again' })).rejects.toThrow(/already paid/);

    // Unpaid cash given back; Finance (not the COO) counts and banks it; a difference goes to the FD.
    await act(coo, 'giveBack', { amount: 400 });
    await expect(act(coo, 'settle', { counted: 400, depositRef: 'CDM 55' })).rejects.toThrow(/Not allowed/);
    await expect(act(de2, 'settle', { counted: 390, depositRef: 'CDM 55' })).rejects.toThrow(/Say why/);
    await act(de2, 'settle', { counted: 390, depositRef: 'CDM 55', comment: 'RM10 short against the COO count; asked the COO' });
    let ex = finDailyCashExceptions(F(), '2026-10', TODAY);
    expect(ex.map((e) => e.key)).toEqual(expect.arrayContaining([`dcash:${l.id}:w1`, `dcash:${l.id}:diff`]));
    await expect(act(de2, 'acceptDifference', { comment: 'ok' })).rejects.toThrow(/only the Finance Director/);
    await act(fd, 'acceptDifference', { comment: 'Counted with the COO; RM10 recovered from petty cash float' });

    // The withdrawal found on the bank statement.
    const sign = { by: de2.name, byId: de2.id, at: NOW, comment: '', source: 'test' };
    F().statements = [
      ...(F().statements ?? []),
      {
        id: 'st-dc',
        bankId,
        period: '2026-10',
        opening: 5000,
        closing: 3940,
        lines: [{ id: 'ln1', date: TODAY, description: 'CHQ WDL 100201', ref: '100201', amount: -1060, match: null }],
        loaded: sign,
      },
    ];
    await expect(act(de1, 'bank', { withdrawalId: 'w1', statementId: 'st-dc', lineId: 'ln1' })).resolves.toBeTruthy();
    ex = finDailyCashExceptions(F(), '2026-10', TODAY);
    expect(ex).toHaveLength(0);
    expect(F().dailyCash![0].status).toBe('settled');
  });

  it('never lets the FD approve a list they prepared, and lets the CEO collect too', async () => {
    const { svc, F } = fresh();
    const [fd, de1, ceo] = await who(svc, 'u-fd', 'u-fin-t1-de1', 'u-fauzan');
    const bankId = F().banks[0].id;
    const mine = (await svc.financeControls.dailyCashAction(fd, C, 'add', {
      period: 'month',
      from: '2026-11-01',
      to: '2026-11-30',
      bankId,
      purpose: 'Casual workers paid daily in cash',
      people: [people[1]],
    })) as { id: string };
    await svc.financeControls.dailyCashAction(fd, C, 'submit', { listId: mine.id });
    await expect(svc.financeControls.dailyCashAction(fd, C, 'approve', { listId: mine.id, comment: 'ok' })).rejects.toThrow(
      /nobody approves a list they prepared/,
    );
    // The same person cannot be on two lists for the same days.
    await expect(
      svc.financeControls.dailyCashAction(de1, C, 'add', {
        period: 'week',
        from: '2026-11-02',
        to: '2026-11-08',
        bankId,
        purpose: 'Casual workers paid daily in cash',
        people: [people[1]],
      }),
    ).rejects.toThrow(/already on another cash list/);
    // A list made by someone else: the FD approves, the CEO collects and counts.
    const l = (await svc.financeControls.dailyCashAction(de1, C, 'add', {
      period: 'week',
      from: '2026-10-29',
      to: '2026-10-31',
      bankId,
      purpose: 'Casual workers paid daily in cash',
      people: [{ ...people[0], name: 'Chong Wei' }],
    })) as { id: string };
    await svc.financeControls.dailyCashAction(de1, C, 'submit', { listId: l.id });
    await svc.financeControls.dailyCashAction(fd, C, 'approve', { listId: l.id, comment: 'Approved for the week' });
    await svc.financeControls.dailyCashAction(de1, C, 'withdraw', { listId: l.id, on: TODAY, amount: 360, ref: 'CHQ 100300' });
    await svc.financeControls.dailyCashAction(de1, C, 'handover', { listId: l.id, toId: ceo.id, amount: 360 });
    await expect(svc.financeControls.dailyCashAction(ceo, C, 'received', { listId: l.id, handoverId: 'h1', counted: 300 })).rejects.toThrow(/Say why/);
    await svc.financeControls.dailyCashAction(ceo, C, 'received', { listId: l.id, handoverId: 'h1', counted: 360 });
    const mineView = await svc.financeControls.dailyCashMine(ceo);
    expect(mineView.lists.find((x) => x.id === l.id)?.held).toBe(360);
  });
});
