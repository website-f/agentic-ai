import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, parseReceiptText, receiptKindOf, testReceiptReader } from '../src';

// Staff receipt wallet and company head verification (Fauzan, 2 Nov 2026: "staff can upload receipts when they get it,
// upload or phone camera scanner. Then system automatically read it. Staff have the power to push claim now or later.
// A place to store all receipt for claim. Hr and company head must be notify about the claim also to check or
// verify"). Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  svc.receiptReader = testReceiptReader;
  return { ds, svc };
};
const jpg = (name: string, salt = name) => ({
  kind: 'document' as const,
  name,
  data: `data:image/jpeg;base64,${Buffer.from(`jpeg ${salt}`).toString('base64')}`,
});

describe('Reading receipts', () => {
  it('finds the total, date, shop and kind on Malay and English receipts', () => {
    const r = parseReceiptText(
      [
        'RESIT RASMI',
        'Klinik Sejahtera Bangi',
        'No. 12, Jalan 3',
        'Tarikh: 28/10/2026',
        'Konsultasi 30.00',
        'Ubat 55.00',
        'Subtotal 85.00',
        'JUMLAH RM85.00',
        'Tunai 100.00',
        'Baki 15.00',
      ].join('\n'),
      NOW,
    );
    expect(r).toMatchObject({
      date: '2026-10-28',
      amount: 85,
      merchant: 'Klinik Sejahtera Bangi',
      kind: 'MEDICAL',
      by: 'text',
    });
    expect(parseReceiptText('PLUS Malaysia\n12 Okt 2026\nTOLL RM 7.40', NOW)).toMatchObject({ date: '2026-10-12', amount: 7.4, kind: 'TOLL' });
    expect(parseReceiptText('Optik Vision\n2026-09-30\nGrand Total 1,250.00', NOW)).toMatchObject({ date: '2026-09-30', amount: 1250, kind: 'OPTICAL' });
    // Nothing invented: an unreadable date stays empty.
    expect(parseReceiptText('Kedai\n31/02/2026\nTotal 5.00', NOW).date).toBeNull();
    expect(receiptKindOf('Klinik Pergigian Senyum')).toBe('DENTAL');
  });
});

describe('Receipt wallet: keep now, claim now or later', () => {
  it('keeps receipts, reads them, and claims from the wallet once confirmed', async () => {
    const { svc } = fresh();
    const ex = await svc.user('u-it-ex1');
    const [r1] = await svc.addReceipts(ex, [jpg('Klinik Sejahtera 28-10-2026 RM85.00.jpg')]);
    // The same photo again, or the same file given as proof elsewhere, is refused.
    await expect(svc.addReceipts(ex, [jpg('Klinik Sejahtera 28-10-2026 RM85.00.jpg')])).rejects.toThrow(/already in your wallet/);
    // The reader runs after saving (the API does this outside the database transaction).
    const read = await svc.receiptReader.read({ name: r1.name, mime: r1.mime, data: r1.data }, NOW);
    await svc.saveReceiptRead(ex, r1.id, read);
    let w = await svc.myReceipts(ex);
    expect(w.reader).toBe('test');
    expect(w.receipts[0]).toMatchObject({
      readState: 'read',
      read: { date: '2026-10-28', amount: 85, kind: 'MEDICAL' },
      claimBy: '2026-12-27',
      daysLeft: 57,
    });
    // Someone else cannot see or change my receipts.
    const other = await svc.user('u-it-ex2');
    await expect(
      svc.receiptAction(other, r1.id, 'confirm', {
        date: '2026-10-28',
        amount: 85,
        merchant: 'Klinik',
        kind: 'MEDICAL',
      }),
    ).rejects.toThrow(/Receipt in your wallet/);
    // The staff member confirms (or corrects) and keeps it for later.
    await svc.receiptAction(ex, r1.id, 'confirm', {
      date: '2026-10-28',
      amount: 85,
      merchant: 'Klinik Sejahtera',
      kind: 'MEDICAL',
    });
    // Later: claim it from the wallet with no new upload.
    const c = await svc.submitStaffClaim(ex, { kind: 'MEDICAL', date: '2026-10-28', amount: 85, walletIds: [r1.id] }, []);
    expect(c.receiptIds).toEqual([r1.id]);
    w = await svc.myReceipts(ex);
    expect(w.receipts[0]).toMatchObject({
      claimId: c.id,
      claimStatus: 'submitted',
      daysLeft: null,
    });
    await expect(svc.submitStaffClaim(ex, { kind: 'MEDICAL', date: '2026-10-28', amount: 85, walletIds: [r1.id] }, [])).rejects.toThrow(/already in claim/);
    await expect(svc.receiptAction(ex, r1.id, 'remove', {})).rejects.toThrow(/no longer changes/);
  });

  it('warns about receipts near the claim cut-off and lets a wrong photo be removed', async () => {
    const { svc } = fresh();
    const ex = await svc.user('u-it-ex1');
    const [old] = await svc.addReceipts(ex, [jpg('Parking KLCC 05-09-2026 RM12.00.jpg')]);
    await svc.saveReceiptRead(ex, old.id, await svc.receiptReader.read(old, NOW));
    expect((await svc.myReceipts(ex)).dueSoon).toBe(1);
    const [blur] = await svc.addReceipts(ex, [jpg('blurry.jpg')]);
    await svc.saveReceiptRead(ex, blur.id, await svc.receiptReader.read(blur, NOW));
    expect((await svc.myReceipts(ex)).receipts.find((r) => r.id === blur.id)!.readState).toBe('failed');
    await svc.receiptAction(ex, blur.id, 'remove', {
      why: 'Blurry, took again',
    });
    expect((await svc.myReceipts(ex)).receipts.map((r) => r.id)).not.toContain(blur.id);
  });
});

describe('Company head verifies; HR and the head are told', () => {
  it('a company staff claim waits for the company manager as well as HR before the COO', async () => {
    const { svc, ds } = fresh();
    // An admin executive in a company: the company manager is the head.
    const ae = ds.users.find((u) => u.role === 'admin_exec' && u.personId && ds.people.find((p) => p.id === u.personId)?.role === 'office')!;
    const staff = await svc.user(ae.id);
    const manager = ds.users.find((u) => u.role === 'company_manager' && u.companyIds.includes(ds.people.find((p) => p.id === ae.personId)!.companyId))!;
    const c = await svc.submitStaffClaim(staff, { kind: 'MEDICAL', date: '2026-10-29', amount: 60 }, [jpg('clinic.jpg')]);
    expect(c.headIds).toEqual([manager.id]);
    const head = await svc.user(manager.id);
    // The head is told on their home and sees it on the claims screen.
    expect((await svc.home(head)).todo.some((t) => /to verify as company head/.test(t.title))).toBe(true);
    expect((await svc.staffClaims(head)).toVerify).toBe(1);
    // HR is told too.
    expect((await svc.claimNotices(await svc.user('u-pwvsb-hr'))).some((t) => /for HR to check/.test(t.title))).toBe(true);
    // A verification needs a comment; the claimant never verifies their own.
    await expect(svc.headVerifyClaim(head, c.id, true, '')).rejects.toThrow(/comment/);
    await expect(svc.headVerifyClaim(staff, c.id, true, 'Fine')).rejects.toThrow();
    await svc.hrDecideClaim(await svc.user('u-pwvsb-hr'), c.id, true, 'Within the RM1,000 limit');
    const coo = await svc.user('u-coo');
    await expect(svc.cooDecideClaim(coo, c.id, true, 'OK')).rejects.toThrow(/company head/);
    await svc.headVerifyClaim(head, c.id, true, 'On sick leave that day, MC on file');
    expect((await svc.cooDecideClaim(coo, c.id, true, 'Approved')).status).toBe('approved');
  });

  it('a head can reject, which ends the claim', async () => {
    const { svc } = fresh();
    const ex = await svc.user('u-it-ex1');
    const c = await svc.submitStaffClaim(ex, { kind: 'MEDICAL', date: '2026-10-29', amount: 40 }, [jpg('clinic2.jpg')]);
    const head = await svc.user(c.headIds![0]);
    await expect(svc.headVerifyClaim(head, c.id, false, 'no')).rejects.toThrow(/Say why/);
    expect((await svc.headVerifyClaim(head, c.id, false, 'Was on leave abroad that day')).status).toBe('rejected');
  });
});
