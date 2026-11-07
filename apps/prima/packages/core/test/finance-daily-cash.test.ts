import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, finDailyCashExceptions, generateDataset, myt } from '../src';
import { finDailyCashPersonCheck } from '../src/finance-daily-cash';

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
  { name: 'Ali bin Abu', idLast4: '1234', work: 'Orchard harvest, Kedah', dailyRate: 120, days: ['2026-10-29', '2026-10-30', '2026-10-31'], pay: 'cash' },
  { name: 'Bala a/l Muthu', idLast4: 'A987', work: 'Orchard harvest, Kedah', dailyRate: 100, pay: 'cash' },
];
/** Cash only when the Director Office lists the person and the COO or CEO gives it (Fauzan, 6 Nov 2026). */
const amountOf = async (svc: PrimaService, doa: Awaited<ReturnType<PrimaService['user']>>, listId: string, personId: string) =>
    (await svc.financeControls.dailyCashMine(doa)).decisions.find((d) => d.id === listId)!.people.find((p) => p.id === personId)!.amount;
  const giveCash = async (svc: PrimaService, listId: string, personIds: string[], deciderId = 'u-fauzan') => {
  const [doa, decider] = await who(svc, 'u-pwvsb-doa', deciderId);
  for (const personId of personIds) {
    await svc.financeControls.dailyCashAction(doa, C, 'listCash', { listId, personId, reason: 'Will not work unless paid in cash daily (mock)', site: 'Harvest site (mock)', amount: await amountOf(svc, doa, listId, personId) });
    await svc.financeControls.dailyCashAction(decider, C, 'decideCash', { listId, personId, give: true, comment: 'Cash given for this list (mock)' });
  }
};
/** The Director Office uploads each signed receipt (Fauzan, 6 Nov 2026). Test files are made-up PNG bytes. */
const uploadReceipts = async (svc: PrimaService, co: string, listId: string) => {
  const doa = await svc.user('u-pwvsb-doa');
  const due = (await svc.financeControls.dailyCashMine(doa)).receipts.filter((r) => r.listId === listId);
  for (const r of due)
    await svc.financeControls.dailyCashAction(doa, co, 'receipt', {
      listId,
      payoutId: r.payoutId,
      name: `Signed receipt ${r.day} (mock).png`,
      data: `data:image/png;base64,${Buffer.from(`mock receipt ${listId} ${r.payoutId}`).toString('base64')}`,
    });
  return due.length;
};

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
    await giveCash(svc, l.id, [ali, bala]);
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
    // Not settled until the Director Office uploads every signed receipt; only the Director Office uploads.
    await expect(act(de2, 'settle', { counted: 390, depositRef: 'CDM 55', comment: 'RM10 short against the COO count' })).rejects.toThrow(/no signed receipt/);
    expect(finDailyCashExceptions(F(), '2026-10', TODAY).map((e) => e.key)).toContain(`dcash:${l.id}:receipt`);
    await expect(act(coo, 'receipt', { payoutId: 'pay1', name: 'r.png', data: 'data:image/png;base64,AAAA' })).rejects.toThrow(/Director Office/);
    await expect(act(de2, 'receipt', { payoutId: 'pay1', name: 'r.png', data: 'data:image/png;base64,AAAA' })).rejects.toThrow(/Director Office/);
    const doa = await svc.user('u-pwvsb-doa');
    await expect(svc.financeControls.dailyCashAction(doa, C, 'receipt', { listId: l.id, payoutId: 'pay1', name: 'r.txt', data: 'data:text/plain;base64,AAAA' })).rejects.toThrow(/PDF, JPEG or PNG/);
    expect(await uploadReceipts(svc, C, l.id)).toBe(6);
    await expect(svc.financeControls.dailyCashAction(doa, C, 'receipt', { listId: l.id, payoutId: 'pay1', name: 'again.png', data: 'data:image/png;base64,QUFB' })).rejects.toThrow(/already has/);
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
    })) as { id: string; people: { id: string }[] };
    await svc.financeControls.dailyCashAction(de1, C, 'submit', { listId: l.id });
    await giveCash(svc, l.id, [l.people[0].id], 'u-coo');
    await svc.financeControls.dailyCashAction(fd, C, 'approve', { listId: l.id, comment: 'Approved for the week' });
    await svc.financeControls.dailyCashAction(de1, C, 'withdraw', { listId: l.id, on: TODAY, amount: 360, ref: 'CHQ 100300' });
    await svc.financeControls.dailyCashAction(de1, C, 'handover', { listId: l.id, toId: ceo.id, amount: 360 });
    await expect(svc.financeControls.dailyCashAction(ceo, C, 'received', { listId: l.id, handoverId: 'h1', counted: 300 })).rejects.toThrow(/Say why/);
    await svc.financeControls.dailyCashAction(ceo, C, 'received', { listId: l.id, handoverId: 'h1', counted: 360 });
    const mineView = await svc.financeControls.dailyCashMine(ceo);
    expect(mineView.lists.find((x) => x.id === l.id)?.held).toBe(360);
  });

  it('pays by bank account or e-wallet only; cash only when the Director Office lists and the COO or CEO gives it (Fauzan, 6 Nov 2026)', async () => {
    const { svc, F } = fresh();
    const [de1, de2, fd, ceo, coo, doa] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fd', 'u-fauzan', 'u-coo', 'u-pwvsb-doa');
    const bankId = F().banks[0].id;
    const days = ['2026-10-29', '2026-10-30', '2026-10-31'];
    const base = { period: 'week', from: '2026-10-29', to: '2026-10-31', bankId, purpose: 'Casual workers paid each day (mock)' };
    const add = (ps: Record<string, unknown>[]) => svc.financeControls.dailyCashAction(de1, C, 'add', { ...base, people: ps });
    const consent = { consentRef: 'CL-2026-001 (mock)', signedOn: '2026-10-27', commissioner: 'Pesuruhjaya Sumpah A (mock)', stampRef: 'PS-123', stampedOn: '2026-10-28' };
    const w = { work: 'Orchard harvest', dailyRate: 100, days };

    // Every person needs a way to be paid; Prima keeps only the last 4 digits.
    await expect(add([{ name: 'No Method', idLast4: '1111', ...w }])).rejects.toThrow(/choose how they are paid/);
    await expect(add([{ name: 'Full Number', idLast4: '1111', ...w, pay: 'bank', account: { bank: 'Maybank', last4: '512345678901' } }])).rejects.toThrow(/last 4 digits/);
    // A relative's account needs the letter stamped by a Commissioner for Oaths.
    await expect(
      add([{ name: 'Raju a/l Siva', idLast4: '3333', ...w, pay: 'bank', account: { bank: 'CIMB', last4: '4444', holder: 'relative', holderName: 'Siva (mock)', relationship: 'father', consentRef: 'CL-1', signedOn: '2026-10-27' } }]),
    ).rejects.toThrow(/Commissioner for Oaths/);
    // Cash is never above the cash limit; bank has no such limit.
    await expect(add([{ name: 'High Rate', idLast4: '9999', ...w, dailyRate: 400, pay: 'cash' }])).rejects.toThrow(/most paid in cash/);

    const l = (await add([
      { name: 'Ali bin Abu', idLast4: '1234', ...w, pay: 'bank', account: { bank: 'Maybank', last4: '6789' } },
      { name: 'Siti binti Omar', idLast4: '2222', ...w, pay: 'ewallet', account: { bank: "Touch 'n Go eWallet", last4: '5555' } },
      { name: 'Raju a/l Siva', idLast4: '3333', ...w, pay: 'bank', account: { bank: 'CIMB', last4: '4444', holder: 'relative', holderName: 'Siva (mock)', relationship: 'father', ...consent } },
      { name: 'Bala a/l Muthu', idLast4: 'A987', ...w, pay: 'cash' },
    ])) as { id: string; total: number; people: { id: string; account: { accountMasked: string } | null }[] };
    expect(l.total).toBe(1200);
    expect(l.people[0].account?.accountMasked).toBe('****6789');
    const [ali, siti, raju, bala] = l.people.map((p) => p.id);
    const act = (u: typeof de1, action: string, input: Record<string, unknown> = {}) => svc.financeControls.dailyCashAction(u, C, action, { listId: l.id, ...input });
    await act(de1, 'submit');

    // The FD cannot approve until the cash and the consent letter are decided.
    await expect(act(fd, 'approve', { comment: 'ok' })).rejects.toThrow(/Not every person.*Raju.*COO's approval.*Bala.*Director Office/);

    // The Director Office lists for cash, with the reason; Finance cannot, and only a person Finance asked cash for.
    // (The Director Office has its own board: the request shows on its Director Office screen.)
    expect((await svc.financeControls.dailyCashCollectorHome(doa)).some((t) => /asked to be paid daily in cash/.test(t.title) && t.go.view === 'doa')).toBe(true);
    expect((await svc.financeControls.dailyCashMine(doa)).decisions.flatMap((x) => x.people.map((p) => p.need))).toEqual(['list']);
    await expect(act(de1, 'listCash', { personId: bala, reason: 'Needs cash' })).rejects.toThrow(/Director Office/);
    await expect(act(doa, 'listCash', { personId: ali, reason: 'Wants cash' })).rejects.toThrow(/Finance asks for cash first/);
    await expect(act(doa, 'listCash', { personId: bala })).rejects.toThrow(/Why this person needs cash/);
    await expect(act(doa, 'listCash', { personId: bala, reason: 'No bank account yet (mock)', site: 'Orchard, Kedah (mock)', amount: 500 })).rejects.toThrow(/cannot be more/);
    await act(doa, 'listCash', { personId: bala, reason: 'No bank account yet; opening one next month (mock)', site: 'Orchard, Kedah (mock)', amount: 300 });
    // Only the COO or the CEO gives cash, with a comment.
    await expect(act(doa, 'decideCash', { personId: bala, give: true, comment: 'ok' })).rejects.toThrow(/COO or the CEO/);
    await expect(act(fd, 'decideCash', { personId: bala, give: true, comment: 'ok' })).rejects.toThrow(/COO or the CEO/);
    await expect(act(ceo, 'decideCash', { personId: bala, give: true })).rejects.toThrow(/comment/);
    expect((await svc.home(coo)).todo.some((t) => /daily cash request\(s\) to give or refuse/.test(t.title))).toBe(true);
    await act(ceo, 'decideCash', { personId: bala, give: false, comment: 'Open a bank account first' });
    await expect(act(fd, 'approve', { comment: 'ok' })).rejects.toThrow(/Cash refused by/);
    // Listed again with a better reason; the COO gives it this time.
    await act(doa, 'listCash', { personId: bala, reason: 'Bank refused the account until his permit is renewed (mock)', site: 'Orchard, Kedah (mock)', amount: 200 });
    await act(coo, 'decideCash', { personId: bala, give: true, comment: 'Cash for this week only' });

    // The COO approves the stamped consent letter; Finance and the Director Office cannot.
    await expect(act(de1, 'approveConsent', { personId: raju, comment: 'ok' })).rejects.toThrow(/only the COO/);
    await expect(act(doa, 'approveConsent', { personId: raju, comment: 'ok' })).rejects.toThrow(/only the COO/);
    // The CEO may stand in only through the pilot rule (Fauzan's review note 7 Nov 2026, item 2); the FD never approves.
    await expect(act(fd, 'approveConsent', { personId: raju, comment: 'ok' })).rejects.toThrow(/only the COO/);
    expect((await svc.home(coo)).todo.some((t) => /consent letter\(s\) to approve/.test(t.title))).toBe(true);
    await act(coo, 'approveConsent', { personId: raju, comment: 'Stamp checked against the letter' });
    await act(fd, 'approve', { comment: 'Approved: three by transfer, one in cash' });

    // Only the cash person's pay is withdrawn.
    // The Director Office's cash amount (RM200) caps the cash, not Bala's RM300 approved pay.
    await expect(act(de1, 'withdraw', { on: TODAY, amount: 300, ref: 'CHQ 9' })).rejects.toThrow(/approved cash of RM200.00/);
    // Transfers: Finance only, never the approving FD, never a cash person; the COO pays only the cash person.
    await expect(act(coo, 'transfer', { personId: ali, day: '2026-10-29', ref: 'IBG 1' })).rejects.toThrow();
    await expect(act(fd, 'transfer', { personId: ali, day: '2026-10-29', ref: 'IBG 1' })).rejects.toThrow(/approved the list/);
    await expect(act(de1, 'transfer', { personId: bala, day: '2026-10-29', ref: 'IBG 1' })).rejects.toThrow(/paid in cash/);
    await expect(act(de1, 'transfer', { personId: ali, day: '2026-10-29' })).rejects.toThrow(/Transfer reference/);
    await act(de1, 'transfer', { personId: ali, day: '2026-10-29', ref: 'IBG 1 (mock)' });
    await expect(act(de1, 'transfer', { personId: ali, day: '2026-10-29', ref: 'IBG 2' })).rejects.toThrow(/already paid/);
    // Once anyone is paid the list is closed or settled, never cancelled.
    await expect(act(de1, 'cancel', { comment: 'Changed our mind about the list' })).rejects.toThrow(/anyone is paid/);
    await act(de2, 'transfer', { personId: siti, day: '2026-10-29', ref: 'DuitNow 1 (mock)' });
    await act(de2, 'transfer', { personId: raju, day: '2026-10-29', ref: 'IBG 3 (mock)' });
    await act(de1, 'withdraw', { on: TODAY, amount: 200, ref: 'CHQ 9' });
    await act(de1, 'handover', { toId: coo.id, amount: 200 });
    await act(coo, 'received', { handoverId: 'h1', counted: 200 });
    await expect(act(coo, 'pay', { personId: ali, day: '2026-10-30', idLast4: '1234', proof: 'sheet' })).rejects.toThrow(/paid by bank or e-wallet/);
    await act(coo, 'pay', { personId: bala, day: '2026-10-29', idLast4: 'A987', proof: 'Pay sheet 1 (mock)' });
    // Cash held counts only the cash paid, not the transfers.
    expect((await svc.financeControls.dailyCashMine(coo)).lists.find((x) => x.id === l.id)?.held).toBe(100);
    await act(coo, 'pay', { personId: bala, day: '2026-10-30', idLast4: 'A987' });
    await expect(act(coo, 'pay', { personId: bala, day: '2026-10-31', idLast4: 'A987' })).rejects.toThrow(/cash on this list is RM200.00/);

    const saved = F().dailyCash!.find((x) => x.id === l.id)!;
    expect(saved.payouts.filter((x) => x.method !== 'cash').map((x) => x.ref)).toEqual(['IBG 1 (mock)', 'DuitNow 1 (mock)', 'IBG 3 (mock)']);
    expect(finDailyCashPersonCheck(saved.people[1]).flags.join(' ')).toMatch(/e-wallet.*EA s.25/);
    expect(finDailyCashPersonCheck(saved.people[2]).flags.join(' ')).toMatch(/consent letter CL-2026-001.*Commissioner for Oaths.*approved by/);
  });

  it('keeps decisions on an edit only for the same person and the same account, and closes a transfer-only list without cash', async () => {
    const { svc, F } = fresh();
    const [de1, de2, fd, coo] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fd', 'u-coo');
    const bankId = F().banks[0].id;
    const raju = {
      name: 'Raju a/l Siva',
      idLast4: '3333',
      work: 'Harvest',
      dailyRate: 80,
      days: ['2026-10-30', '2026-10-31'],
      pay: 'bank',
      account: { bank: 'CIMB', last4: '4444', holder: 'friend', holderName: 'Kumar (mock)', relationship: 'friend', consentRef: 'CL-9', signedOn: '2026-10-27', commissioner: 'PS B (mock)', stampRef: 'PS-9', stampedOn: '2026-10-27' },
    };
    const l = (await svc.financeControls.dailyCashAction(de1, C, 'add', { period: 'week', from: '2026-10-30', to: '2026-10-31', bankId, purpose: 'Casual workers paid each day (mock)', people: [raju] })) as {
      id: string;
      people: { id: string }[];
    };
    const act = (u: typeof de1, action: string, input: Record<string, unknown> = {}) => svc.financeControls.dailyCashAction(u, C, action, { listId: l.id, ...input });
    await act(coo, 'approveConsent', { personId: l.people[0].id, comment: 'Stamp checked' });
    // The same account and letter keeps the approval; a different account needs it again.
    const same = (await act(de1, 'edit', { people: [{ ...raju, dailyRate: 90 }] })) as { people: { account: { consent: { approved: unknown } } }[] };
    expect(same.people[0].account.consent.approved).toBeTruthy();
    const other = (await act(de1, 'edit', { people: [{ ...raju, account: { ...raju.account, last4: '7777' } }] })) as { people: { account: { consent: { approved: unknown } } }[] };
    expect(other.people[0].account.consent.approved).toBeNull();
    await act(coo, 'approveConsent', { personId: l.people[0].id, comment: 'New account, stamp checked' });
    await act(de1, 'submit');
    await act(fd, 'approve', { comment: 'Approved by transfer' });
    await expect(act(de1, 'withdraw', { on: TODAY, amount: 80, ref: 'CHQ' })).rejects.toThrow(/Nobody on this list is paid in cash/);
    await act(de1, 'transfer', { personId: l.people[0].id, day: '2026-10-30', ref: 'IBG 10 (mock)' });
    // Closed once ended; a shortfall needs a reason; the approving FD does not close it.
    await expect(act(fd, 'settle', {})).rejects.toThrow(/approved the list/);
    await expect(act(de2, 'settle', {})).rejects.toThrow(/Say why/);
    const closed = (await act(de2, 'settle', { comment: 'Raju did not come on the 31st (mock)' })) as { status: string };
    expect(closed.status).toBe('settled');
    expect(finDailyCashExceptions(F(), '2026-10', TODAY)).toHaveLength(0);
  });
});
