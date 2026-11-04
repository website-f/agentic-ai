import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset } from '../src';

const TODAY = '2026-10-28';
const NOW = '2026-10-28T03:00:00.000Z';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
}

describe('secrecy in the company (Fauzan, 28 Oct 2026)', () => {
  it('shows an IT tender only to the people on it, and the price file only to who prepares or approves it', async () => {
    const { svc, ds } = fresh();
    const ids = (b: Awaited<ReturnType<typeof svc.itBoard>>) => (b.tenders ?? []).map((t) => t.task.id);
    const mgr = await svc.itBoard(await svc.user('u-it-mgr'));
    const ex1 = await svc.itBoard(await svc.user('u-it-ex1'));
    const ex3 = await svc.itBoard(await svc.user('u-it-ex3'));
    const hr = await svc.itBoard(await svc.user('u-pwvsb-hr'));
    expect(ids(mgr).length).toBeGreaterThan(0);
    expect(ids(ex1)).toEqual(ids(mgr));
    expect(ids(ex3)).toEqual([]);
    expect(ids(hr)).toEqual([]);
    // A file of a tender the person is not on cannot be opened, even with its fingerprint.
    const t = ds.itTenderTasks.find((x) => x.items.some((i) => i.proof?.length))!;
    const f = t.items.find((i) => i.proof?.length)!.proof![0];
    await expect(svc.itJobProof(await svc.user('u-it-ex3'), t.id, f.sha256)).rejects.toThrow(/not found/i);
    await expect(svc.itJobProof(await svc.user('u-pwvsb-hr'), t.id, f.sha256)).rejects.toThrow(/not found/i);
    // Opening a file is recorded.
    const before = ds.audit.length;
    await svc.itJobProof(await svc.user('u-it-mgr'), t.id, f.sha256);
    expect(ds.audit.slice(before).some((a) => a.action === 'file.open' && a.summary.includes(f.name))).toBe(true);
  });

  it('sends HR and the Finance Director only what their IT tabs need, and IT executives no rental figures', async () => {
    const { svc } = fresh();
    const hr = await svc.itBoard(await svc.user('u-pwvsb-hr'));
    expect([hr.purchases.length, hr.assets.length, hr.accounts.length, hr.tickets.length, hr.rental]).toEqual([0, 0, 0, 0, null]);
    expect(hr.teamRows!.length).toBeGreaterThan(0);
    const fd = await svc.itBoard(await svc.user('u-fd'));
    expect(fd.purchases.length).toBeGreaterThan(0);
    expect([fd.jobs.length, fd.accounts.length, fd.tickets.length]).toEqual([0, 0, 0]);
    expect((await svc.itBoard(await svc.user('u-it-ex2'))).rental).toBeNull();
  });

  it('offers MOF certificate files only to who may open them, and no firearms tile to the Finance Director', async () => {
    const { svc } = fresh();
    const files = (b: Awaited<ReturnType<typeof svc.itBoard>>) =>
      [...(b.codeHolders ?? []).map((h) => h.holder), ...(b.tenders ?? []).map((t) => t.holder)].flatMap((h) => h?.proof ?? []).length;
    expect(files(await svc.itBoard(await svc.user('u-it-mgr')))).toBeGreaterThan(0);
    expect(files(await svc.itBoard(await svc.user('u-it-ex1')))).toBe(0);
    const home = await svc.home(await svc.user('u-fd'));
    expect(JSON.stringify(home)).not.toMatch(/Firearms overdue/);
  });

  it('asks each person to accept the confidentiality rule once, and records it', async () => {
    const { svc, ds } = fresh();
    const u = await svc.user('u-it-ex2');
    expect((await svc.confidentiality(u)).accepted).toBe(false);
    await svc.acceptConfidentiality(u);
    expect((await svc.confidentiality(u)).accepted).toBe(true);
    expect(ds.audit.some((a) => a.action === 'confidentiality.accept' && a.actor === u.name)).toBe(true);
  });
});
