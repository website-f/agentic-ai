import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, type Dataset } from '../src';

// Masterplan item 241 (Fauzan 3 Nov 2026): fraud anomalies, investigations and forensic controls. Synthetic data only.
const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
};
const file = (text: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${text}`).toString('base64')}`;

function plant(ds: Dataset) {
  // A supplier whose account number is a staff member's salary account (synthetic numbers).
  const staff = ds.people.find((p) => p.role === 'office' && p.status === 'active')!;
  staff.bankAccountFull = '5140-1234-5678';
  const sup = ds.purSuppliers[0];
  sup.bank = { ...sup.bank, account: '514012345678' };
  // The same medical claim twice.
  const c = ds.staffClaims.find((x) => x.status !== 'rejected')!;
  ds.staffClaims.push({ ...c, id: `${c.id}-again` });
  return { staff, sup, claim: c };
}

describe('ACT fraud anomalies and investigations (masterplan item 241)', () => {
  it('finds planted patterns from records already kept, shows them to ACT only, and accuses nobody', async () => {
    const { ds, svc } = fresh();
    const { sup, claim } = plant(ds);
    const board = await svc.actBoard(await svc.user('u-act-aud1'));
    const rule = (k: string) => board.anomalies.find((r) => r.key === k)!;
    expect(rule('supplier_staff_bank').items.map((i) => i.ref)).toContain(sup.name);
    expect(rule('duplicate_claim').items.some((i) => i.ref.includes(claim.id))).toBe(true);
    expect(board.kpis.anomaliesOpen).toBeGreaterThanOrEqual(2);
    // Owners and group leaders see the findings screen, never the anomalies or the investigations.
    const ceo = await svc.actBoard(await svc.user('u-fauzan'));
    expect(ceo.anomalies).toEqual([]);
    expect(ceo.investigations).toEqual([]);
  });

  it('keeps an investigation to ACT and its team, logs custody, re-checks evidence hashes, and only the Director closes', async () => {
    const { ds, svc } = fresh();
    plant(ds);
    const dir = await svc.user('u-audit');
    const aud1 = await svc.user('u-act-aud1');
    const aud2 = await svc.user('u-act-aud2');
    const enf1 = await svc.user('u-act-enf1');
    const board = await svc.actBoard(aud1);
    const key = board.anomalies.find((r) => r.key === 'duplicate_claim')!.items[0].key;
    // Enforcement does not open investigations; an Auditor opens one for their own team.
    await expect(svc.openActInvestigation(enf1, { title: 'Duplicate claim', anomalyKey: key, note: 'From the anomaly list' })).rejects.toThrow(/ACT Manager or an ACT Auditor/);
    const row = await svc.openActInvestigation(aud1, { title: 'Duplicate claim', anomalyKey: key, note: 'From the anomaly list' });
    expect(row.team).toBe(1);
    await expect(svc.openActInvestigation(dir, { title: 'Again', anomalyKey: key, note: 'Same anomaly' })).rejects.toThrow(/already covers/);
    // Not ACT, or the other team: refused with a plain reason.
    await expect(svc.addActEvidence(await svc.user('u-fauzan'), row.id, { name: 'x.pdf', data: file('x'), source: 'HR' })).rejects.toThrow(/ACT only/);
    await expect(svc.addActEvidence(aud2, row.id, { name: 'x.pdf', data: file('x'), source: 'HR' })).rejects.toThrow(/Team 1/);
    expect((await svc.actBoard(aud2)).investigations.some((i) => i.id === row.id)).toBe(false);
    // The other team sees that someone is looking, not which file.
    const other = (await svc.actBoard(aud2)).anomalies.flatMap((r) => r.items).find((i) => i.key === key)!;
    expect(other.investigation).toEqual({ id: null, ref: 'Under investigation', state: 'open' });
    // Evidence: hash computed by the server, the same file refused twice, no data in the board list.
    const ev = await svc.addActEvidence(enf1, row.id, { name: 'Receipt copy.pdf', data: file('receipt'), source: 'Copy from the HR claim file' });
    expect(ev.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(svc.addActEvidence(aud1, row.id, { name: 'Same.pdf', data: file('receipt'), source: 'Again' })).rejects.toThrow(/already in/);
    const listed = (await svc.actBoard(dir)).investigations.find((i) => i.id === row.id)!;
    expect('data' in listed.evidence[0]).toBe(false);
    const seen = await svc.actEvidence(dir, row.id, ev.id);
    expect(seen.intact).toBe(true);
    // Only the Director closes, with a reason; a referral names where it goes; then nothing more can be added.
    await expect(svc.actInvestigationStep(aud1, row.id, { action: 'close', outcome: 'referred', text: 'Two claims for one receipt', referredTo: 'HR' })).rejects.toThrow(/Only the ACT Director/);
    await expect(svc.actInvestigationStep(dir, row.id, { action: 'close', outcome: 'referred', text: 'Two claims for one receipt' })).rejects.toThrow(/who it is referred/);
    await svc.actInvestigationStep(aud1, row.id, { action: 'note', text: 'Claimant interviewed; says it was a resubmission.' });
    const closed = await svc.actInvestigationStep(dir, row.id, { action: 'close', outcome: 'referred', text: 'Two claims paid for one receipt', referredTo: 'HR' });
    expect(closed.investigation!.state).toBe('closed');
    await expect(svc.addActEvidence(dir, row.id, { name: 'late.pdf', data: file('late'), source: 'HR' })).rejects.toThrow(/closed/);
    const custody = closed.investigation!.custody.map((c) => c.action);
    expect(custody).toEqual(['opened', 'evidence_added', 'evidence_viewed', 'note', 'closed']);
  });

  it('flags a changed evidence file when it is shown', async () => {
    const { ds, store, svc } = fresh();
    plant(ds);
    const dir = await svc.user('u-audit');
    const row = await svc.openActInvestigation(dir, { title: 'Supplier bank', team: 2, note: 'Supplier and staff share an account' });
    const ev = await svc.addActEvidence(dir, row.id, { name: 'Bank letter.pdf', data: file('letter'), source: 'Finance supplier file' });
    const a = (await store.get('actAudits', row.id))!;
    a.investigation!.evidence[0].data = file('tampered');
    expect((await svc.actEvidence(dir, row.id, ev.id)).intact).toBe(false);
  });

  // Arisha main round 3 (3 Nov 2026): investigation changes run one after the other and hash the file's bytes.
  it('keeps both files and both custody lines when two evidence adds run at once', async () => {
    const { ds, svc } = fresh();
    plant(ds);
    const dir = await svc.user('u-audit');
    const enf1 = await svc.user('u-act-enf1');
    const row = await svc.openActInvestigation(dir, { title: 'Race check', team: 1, note: 'Synthetic race test' });
    const [a, b, c] = await Promise.all([
      svc.addActEvidence(dir, row.id, { name: 'A.pdf', data: file('a'), source: 'Finance file' }),
      svc.addActEvidence(enf1, row.id, { name: 'B.pdf', data: file('b'), source: 'HR file' }),
      svc.actInvestigationStep(enf1, row.id, { action: 'note', text: 'Note written at the same time.' }),
    ]);
    expect(a.id).not.toBe(b.id);
    const inv = (await svc.actBoard(dir)).investigations.find((i) => i.id === row.id)!;
    expect(inv.evidence.map((e) => e.name).sort()).toEqual(['A.pdf', 'B.pdf']);
    expect(inv.custody.map((x) => x.action).sort()).toEqual(['evidence_added', 'evidence_added', 'note', 'opened']);
    expect(c.investigation!.notes).toHaveLength(1);
  });

  it('never reopens a closed investigation when an add races the close', async () => {
    const { ds, svc } = fresh();
    plant(ds);
    const dir = await svc.user('u-audit');
    const row = await svc.openActInvestigation(dir, { title: 'Close race', team: 1, note: 'Synthetic race test' });
    const [close, add] = await Promise.allSettled([
      svc.actInvestigationStep(dir, row.id, { action: 'close', outcome: 'not_substantiated', text: 'Records explained by a correction.' }),
      svc.addActEvidence(dir, row.id, { name: 'Late.pdf', data: file('late'), source: 'Finance file' }),
    ]);
    expect(close.status).toBe('fulfilled');
    expect(add.status).toBe('rejected');
    const inv = (await svc.actBoard(dir)).investigations.find((i) => i.id === row.id)!;
    expect(inv.state).toBe('closed');
    expect(inv.conclusion?.outcome).toBe('not_substantiated');
    expect(inv.evidence).toHaveLength(0);
  });

  it('refuses the same bytes sent again under another type label, and hashes the bytes', async () => {
    const { ds, svc } = fresh();
    plant(ds);
    const dir = await svc.user('u-audit');
    const row = await svc.openActInvestigation(dir, { title: 'Hash check', team: 2, note: 'Synthetic hash test' });
    const raw = Buffer.from('%PDF-1.4 same bytes');
    const ev = await svc.addActEvidence(dir, row.id, { name: 'One.pdf', data: `data:application/pdf;base64,${raw.toString('base64')}`, source: 'Finance file' });
    const { createHash } = await import('node:crypto');
    expect(ev.sha256).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(ev.bytes).toBe(raw.length);
    await expect(
      svc.addActEvidence(dir, row.id, { name: 'One.bin', data: `data:application/octet-stream;base64,${raw.toString('base64')}`, source: 'Same file, other label' }),
    ).rejects.toThrow(/already in/);
    await expect(svc.addActEvidence(dir, row.id, { name: 'Bad.pdf', data: 'data:application/pdf;base64,abc', source: 'Broken' })).rejects.toThrow(/Attach the file/);
  });

  it('gives two investigations opened at once different numbers', async () => {
    const { ds, svc } = fresh();
    plant(ds);
    const dir = await svc.user('u-audit');
    const rows = await Promise.all([1, 2, 3].map((n) => svc.openActInvestigation(dir, { title: `Parallel ${n}`, team: 1, note: 'Synthetic race test' })));
    expect(new Set(rows.map((r) => r.investigation!.ref)).size).toBe(3);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });

  it('words every pattern as a match for a person to check, never as an accusation', async () => {
    const { ds, svc } = fresh();
    plant(ds);
    const board = await svc.actBoard(await svc.user('u-act-aud1'));
    for (const r of board.anomalies) {
      expect(`${r.title} ${r.why}`).not.toMatch(/fraud|shell|stole|theft|cash taken|paid into|clocking for|used to clock|abuse/i);
      expect(r.why).toMatch(/person/);
      for (const i of r.items) expect(i.text).not.toMatch(/fraud|paid into|paid twice/i);
    }
    expect(board.anomalies.find((r) => r.key === 'supplier_staff_bank')!.why).toMatch(/does not show that any payment was made/);
    expect(board.anomalies.find((r) => r.key === 'duplicate_claim')!.why).toMatch(/not yet paid/);
  });
});
