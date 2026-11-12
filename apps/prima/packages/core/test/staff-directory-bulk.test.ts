// K2 (Fauzan, 11 Nov 2026: "Yes, turn on" the staff directory bulk load, with HR's approval step). CHECK: HR loads a
// made-up file of 50 people, the HR Director approves it, and all 50 appear once; a bad row is refused with a reason.
// Synthetic rows only: made-up names and example.test mailboxes, never the real staff list.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const HEAD = 'group,org_unit,name,title,email,account_type,entra_status,verified,account_status';
const UNITS = ['UNIT IT', 'UNIT KEWANGAN', 'UNIT AUDIT', 'OPERASI JOHOR', 'OPERASI UTARA'];
/** 50 made-up office staff across central units and regions. */
const FIFTY = Array.from({ length: 50 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  const unit = UNITS[i % UNITS.length];
  const group = unit.startsWith('OPERASI') ? 'operations_region' : 'central_unit';
  return `${group},${unit},Kakitangan Contoh ${n},EKSEKUTIF,contoh${n}@example.test,Outlook HQ,Aktif,Telah Disahkan,Sedang digunakan`;
});
/** One bad row: no group and no name. */
const BAD = ',UNIT IT,,EKSEKUTIF,rosak@example.test,Outlook HQ,Aktif,Telah Disahkan,Sedang digunakan';
const SRC = 'synthetic-staff-50.csv';

describe('K2 staff directory bulk load: 50 made-up people with HR’s approval', () => {
  it('a bad row is refused with its reason; HR may leave it out and send the other 50', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const text = [HEAD, ...FIFTY.slice(0, 20), BAD, ...FIFTY.slice(20)].join('\n');
    const p = await svc.staffDirectory.preview(hr, { text, source: SRC });
    expect(p.rows).toHaveLength(51);
    const bad = p.rows.filter((r) => r.errors.length);
    expect(bad.map((r) => r.row)).toEqual([22]);
    expect(bad[0].errors.join(' ')).toMatch(/Group is missing/);
    expect(bad[0].errors.join(' ')).toMatch(/Name is missing/);
    expect(p.ready).toBe(50);
    // Without leaving it out, the whole batch is refused, naming the row and the reason.
    await expect(svc.staffDirectory.submit(hr, { text, source: SRC, fingerprint: p.fingerprint })).rejects.toThrow(/Fix row 22 first, or leave it out: row 22: Group is missing/);
    const sent = await svc.staffDirectory.submit(hr, { text, source: SRC, fingerprint: p.fingerprint, leaveOutBad: true });
    expect(sent).toMatchObject({ rows: 50, alreadyIn: 0, refused: 1 });
    const board = await svc.staffDirectory.board(hr);
    expect(board.batches[0]).toMatchObject({ status: 'waiting', rows: 50, inFile: 51, ownBatch: true, canDecide: false });
    expect(board.batches[0].refused).toEqual([{ row: 22, reasons: bad[0].errors }]);
    expect(board.entries).toHaveLength(0);
  });

  it('the HR Director approves with a comment and all 50 appear exactly once; the same file never loads twice', async () => {
    const { ds, svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const cos = await svc.user('u-cos');
    const text = [HEAD, ...FIFTY].join('\n');
    const p = await svc.staffDirectory.preview(hr, { text, source: SRC });
    const sent = await svc.staffDirectory.submit(hr, { text, source: SRC, fingerprint: p.fingerprint });
    // HR never approves its own batch; IT and the COO cannot approve at all.
    await expect(svc.staffDirectory.decide(hr, { batchId: sent.id, approve: true, comment: 'Own batch.' })).rejects.toThrow();
    await expect(svc.staffDirectory.decide(await svc.user('u-it-mgr'), { batchId: sent.id, approve: true, comment: 'IT approving.' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.staffDirectory.decide(await svc.user('u-coo'), { batchId: sent.id, approve: true, comment: 'COO approving.' })).rejects.toBeInstanceOf(AccessDenied);
    // A comment is needed.
    await expect(svc.staffDirectory.decide(cos, { batchId: sent.id, approve: true, comment: '' })).rejects.toThrow(/comment/);
    const d = await svc.staffDirectory.decide(cos, { batchId: sent.id, approve: true, comment: 'Checked against the synthetic list.' });
    expect(d).toMatchObject({ status: 'approved', added: 50 });
    const names = ds.staffDirectory.map((e) => e.name);
    expect(names).toHaveLength(50);
    expect(new Set(names).size).toBe(50);
    for (let i = 1; i <= 50; i++) expect(names.filter((n) => n === `Kakitangan Contoh ${String(i).padStart(2, '0')}`)).toHaveLength(1);
    expect(ds.staffDirectory.every((e) => e.batchId === sent.id && e.addedById === cos.id)).toBe(true);
    // The same file again: refused; a new file with the same people: every row already in, nothing to send.
    await expect(svc.staffDirectory.submit(hr, { text, source: SRC, fingerprint: p.fingerprint })).rejects.toThrow(/already in the directory/);
    const again = [HEAD, ...FIFTY.slice().reverse()].join('\n');
    const p2 = await svc.staffDirectory.preview(hr, { text: again, source: 'synthetic-again.csv' });
    expect(p2.ready).toBe(0);
    await expect(svc.staffDirectory.submit(hr, { text: again, source: 'synthetic-again.csv', fingerprint: p2.fingerprint })).rejects.toThrow(/Nothing to send/);
    expect(ds.staffDirectory).toHaveLength(50);
    // The approval is in the audit trail with its comment.
    expect(ds.audit.some((a) => a.action === 'staff_directory.batch.approved' && a.summary.includes('50 entries added') && a.summary.includes('Checked against the synthetic list.'))).toBe(true);
  });

  it('only HR prepares a batch: IT, the COO, Finance and a company manager are refused', async () => {
    const { svc } = fresh();
    const text = [HEAD, ...FIFTY.slice(0, 2)].join('\n');
    for (const id of ['u-it-mgr', 'u-coo', 'u-fin-t1-lead', 'u-cm-sasa'])
      await expect(svc.staffDirectory.preview(await svc.user(id), { text, source: SRC }), id).rejects.toBeInstanceOf(AccessDenied);
  });
});
