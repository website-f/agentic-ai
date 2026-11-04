import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, parseItImportTable, readItImportDate } from '../src';

// The CEO's batch import of open IT work (task T9). Dummy rows only.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const TICKETS = [
  'Title\tRequester\tChannel\tUrgency\tAbout\tDate raised\tIT person',
  'UAT printer jam\tUAT Staff A\tTeams\tP2\tDevice\t30/10/2026\tIT Executive 1 (mock)',
  'UAT outlook stuck\tUAT Staff B\temail\t3\t\t\t',
  'UAT printer jam\tUAT Staff A\tTeams\tP2\tDevice\t30/10/2026\t',
  'UAT no channel\tUAT Staff C\t\tP1\t\t\t',
  'UAT bad person\tUAT Staff D\tphone\tP1\t\t\tSomeone Else',
].join('\n');
const JOBS = ['Job,Doer,Due date,Urgency,Technical', '"UAT patch, laptops",u-it-ex2,2026-11-03,P2,yes', 'UAT check wifi,IT Lead (mock),31-10-2026,low,no'].join('\n');
const OTHERS = ['u-it-mgr', 'u-it-lead', 'u-coo', 'u-fd', 'u-audit'];

/** Preview as the CEO, then the approval input bound to that preview. */
async function previewed(svc: PrimaService, kind: 'tickets' | 'jobs', text: string, source: string, batchId: string, skipRows: number[] = []) {
  const p = await svc.itImportPreview(await svc.user('u-fauzan'), { kind, text, source });
  return { p, input: { kind, text, source, batchId, previewToken: p.previewToken, skipRows } };
}

describe('CEO batch import of open IT work', () => {
  it('reads pasted Excel rows and CSV with quoted commas, and only real dates', () => {
    const cells = (t: string) => parseItImportTable(t).records.map((r) => r.cells);
    expect(cells('a\tb\n1\t2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
    const csv = 'a,b\n"x, y","say ""hi"""';
    expect(cells(csv)).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseItImportTable(csv).problems).toEqual([]);
    expect(readItImportDate('31/10/2026')).toBe('2026-10-31');
    expect(readItImportDate('2026-02-30')).toBeNull();
    expect(readItImportDate('next week')).toBeNull();
  });

  it('previews without changing anything: errors, repeats and source rows', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const before = (await svc.itBoard(ceo)).tickets?.length ?? 0;
    const p = await svc.itImportPreview(ceo, { kind: 'tickets', text: TICKETS, source: 'UAT open requests.xlsx' });
    expect(p.missingColumns).toEqual([]);
    expect(p.problems).toEqual([]);
    expect(p.previewToken).toMatch(/^[0-9a-f]{64}$/);
    expect(p.rows.map((r) => r.row)).toEqual([2, 3, 4, 5, 6]);
    expect(p.rows[0].errors).toEqual([]);
    expect(p.rows[0].ticket?.itPersonId).toBe('u-it-ex1');
    expect(p.rows[0].sourceRef).toBe('UAT open requests.xlsx, row 2');
    expect(p.rows[1].ticket?.category).toBe('OTHER');
    expect(p.rows[1].warnings.length).toBeGreaterThan(0);
    expect(p.rows[2].duplicateOf).toBe('row 2 of this batch');
    expect(p.rows[3].errors).toContain('No channel.');
    expect(p.rows[4].errors[0]).toMatch(/not the IT Lead or an IT Executive/);
    expect(p.ready).toBe(2);
    expect((await svc.itBoard(ceo)).tickets?.length ?? 0).toBe(before);
  });

  it('lets only the CEO preview or approve', async () => {
    const { svc } = fresh();
    for (const id of OTHERS) {
      const u = await svc.user(id);
      await expect(svc.itImportPreview(u, { kind: 'tickets', text: TICKETS, source: 'UAT file' })).rejects.toThrow(/Not allowed/);
      await expect(
        svc.itImportApprove(u, { kind: 'tickets', text: TICKETS, source: 'UAT file', batchId: 'batch-0001', previewToken: 'a'.repeat(64), skipRows: [] }),
      ).rejects.toThrow(/Not allowed/);
    }
  });

  it('refuses everyone but the CEO on a retry of a batch already imported, and shows them nothing', async () => {
    const { svc } = fresh();
    const { input } = await previewed(svc, 'tickets', TICKETS, 'UAT file', 'batch-retry-01');
    expect((await svc.itImportApprove(await svc.user('u-fauzan'), input)).already).toBe(false);
    for (const id of OTHERS) await expect(svc.itImportApprove(await svc.user(id), input)).rejects.toThrow(/Not allowed/);
    expect((await svc.itImportApprove(await svc.user('u-fauzan'), input)).already).toBe(true);
  });

  it('approves only the preview the CEO saw: changed rows, source or kind, or new open items, stop the batch', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const { input } = await previewed(svc, 'tickets', TICKETS, 'UAT file', 'batch-bind-01');
    const changed = /changed since your preview/;
    await expect(svc.itImportApprove(ceo, { ...input, text: TICKETS.replace('UAT Staff B', 'UAT Staff Z') })).rejects.toThrow(changed);
    await expect(svc.itImportApprove(ceo, { ...input, source: 'UAT other file' })).rejects.toThrow(changed);
    await expect(svc.itImportApprove(ceo, { ...input, kind: 'jobs' })).rejects.toThrow(changed);
    await expect(svc.itImportApprove(ceo, { ...input, previewToken: 'b'.repeat(64) })).rejects.toThrow(changed);
    await expect(svc.itImportApprove(ceo, { ...input, previewToken: 'not a token' })).rejects.toThrow(/Preview the batch again/);
    // IT logs the same request by hand after the preview: row 2 is now a repeat, so the preview no longer holds.
    await svc.logItTicket(await svc.user('u-it-lead'), { raisedFor: 'UAT Staff A', channel: 'teams', category: 'DEVICE', priority: 'P2', title: 'UAT printer jam', detail: '' });
    await expect(svc.itImportApprove(ceo, input)).rejects.toThrow(changed);
    expect(((await svc.itBoard(ceo)).tickets ?? []).filter((t) => t.ticket.importBatchId === 'batch-bind-01')).toHaveLength(0);
  });

  it('refuses a batch ID that comes back with different rows, and never mixes help requests and jobs under one ID', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const first = (await previewed(svc, 'tickets', TICKETS, 'UAT file', 'batch-reuse-01')).input;
    await svc.itImportApprove(ceo, first);
    await expect(svc.itImportApprove(ceo, { ...first, text: `${TICKETS}\nUAT added later\tUAT Staff E\tTeams\tP2\t\t\t` })).rejects.toThrow(
      /already imported with different rows/,
    );
    const other = await previewed(svc, 'tickets', TICKETS.replace('UAT outlook stuck', 'UAT outlook frozen'), 'UAT file', 'batch-reuse-01');
    await expect(svc.itImportApprove(ceo, other.input)).rejects.toThrow(/already imported with different rows/);
    const jobs = await previewed(svc, 'jobs', JOBS, 'UAT email', 'batch-reuse-01');
    await expect(svc.itImportApprove(ceo, jobs.input)).rejects.toThrow(/already imported with different rows/);
    expect(((await svc.itBoard(ceo)).jobs ?? []).filter((j) => j.job.importBatchId === 'batch-reuse-01')).toHaveLength(0);
  });

  it('keeps sheet row numbers across blank rows and multi-line cells', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const text = ['Title,Requester,Channel,Urgency,Detail', 'UAT one,UAT Staff A,Teams,P2,', '', '"UAT two",UAT Staff B,email,P3,"line 1', 'line 2"', 'UAT three,UAT Staff C,phone,P1,'].join('\n');
    const p = await svc.itImportPreview(ceo, { kind: 'tickets', text, source: 'UAT csv' });
    expect(p.problems).toEqual([]);
    expect(p.rows.map((r) => r.row)).toEqual([2, 4, 5]);
    expect(p.rows[1].ticket?.detail).toBe('line 1\nline 2');
    expect(p.rows[2].sourceRef).toBe('UAT csv, row 5');
    expect(p.ready).toBe(3);
  });

  it('flags broken CSV on its row instead of guessing, and stops a table it cannot read', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const head = 'Title,Requester,Channel,Urgency';
    const bad = [head, 'UAT 5" screen,UAT Staff A,Teams,P2', '"UAT quoted" extra,UAT Staff B,Teams,P2', 'UAT patch, laptops,UAT Staff C,Teams,P2', 'UAT fine,UAT Staff D,Teams,P2'].join('\n');
    const q = await svc.itImportPreview(ceo, { kind: 'tickets', text: bad, source: 'UAT csv' });
    expect(q.rows[0].errors[0]).toMatch(/quote mark sits inside a cell/);
    expect(q.rows[1].errors[0]).toMatch(/Text follows a closing quote/);
    expect(q.rows[2].errors[0]).toMatch(/5 cells but the heading row has 4/);
    expect(q.rows[3].errors).toEqual([]);
    expect(q.ready).toBe(1);

    const open = await svc.itImportPreview(ceo, { kind: 'tickets', text: `${head}\n"UAT never closed,UAT Staff A,Teams,P2\nUAT x,UAT Staff B,Teams,P2`, source: 'UAT csv' });
    expect(open.problems[0]).toMatch(/opened on row 2 is never closed/);
    expect(open.ready).toBe(0);

    const twoTitles = 'Title,Subject,Requester,Channel,Urgency\nUAT a,UAT b,UAT Staff A,Teams,P2';
    const t = await previewed(svc, 'tickets', twoTitles, 'UAT csv', 'batch-two-titles');
    expect(t.p.problems[0]).toMatch(/both read as title/);
    expect(t.p.ready).toBe(0);
    await expect(svc.itImportApprove(ceo, t.input)).rejects.toThrow(/both read as title/);
    expect((await svc.itImportPreview(ceo, { kind: 'tickets', text: head, source: 'UAT csv' })).problems).toContain('There are no rows under the heading row.');
  });

  it('approves once: creates the ready rows, leaves out the rest, never imports a batch twice', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const { input } = await previewed(svc, 'tickets', TICKETS, 'UAT open requests.xlsx', 'batch-uat-0001');
    const r = await svc.itImportApprove(ceo, input);
    expect(r.already).toBe(false);
    expect(r.created).toHaveLength(2);
    expect(r.skipped.map((s) => s.row)).toEqual([4, 5, 6]);
    const again = await svc.itImportApprove(ceo, input);
    expect(again.already).toBe(true);
    expect(again.created).toEqual(r.created);
    const board = await svc.itBoard(await svc.user('u-it-mgr'));
    const mine = (board.tickets ?? []).filter((t) => t.ticket.importBatchId === 'batch-uat-0001').map((t) => t.ticket);
    expect(mine).toHaveLength(2);
    expect(mine.find((t) => t.title === 'UAT printer jam')).toMatchObject({
      raisedFor: 'UAT Staff A',
      channel: 'teams',
      assignedToId: 'u-it-ex1',
      status: 'open',
      sourceRef: 'UAT open requests.xlsx, row 2',
      importToken: input.previewToken,
    });
    // A new batch with the same rows now finds them already open in Prima.
    const p = await svc.itImportPreview(ceo, { kind: 'tickets', text: TICKETS, source: 'UAT again' });
    expect(p.rows[0].duplicateOf).toMatch(/already open in Prima/);
  });

  it('writes one audit line per item and one for the batch', async () => {
    const { ds, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    await svc.itImportApprove(ceo, (await previewed(svc, 'tickets', TICKETS, 'UAT open requests.xlsx', 'batch-uat-0003')).input);
    const lines = ds.audit.filter((a) => a.action === 'it.ticket.import' || (a.action === 'it.import' && a.entityId === 'batch-uat-0003'));
    expect(lines.map((a) => a.action).sort()).toEqual(['it.import', 'it.ticket.import', 'it.ticket.import']);
    expect(lines.every((a) => a.actor === ceo.name)).toBe(true);
  });

  it('respects rows the CEO leaves out, and refuses a batch with nothing ready or an unknown row', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const { input } = await previewed(svc, 'tickets', TICKETS, 'UAT file', 'batch-uat-0002', [2, 3]);
    await expect(svc.itImportApprove(ceo, input)).rejects.toThrow(/No row is ready/);
    await expect(svc.itImportApprove(ceo, { ...input, skipRows: [99] })).rejects.toThrow(/Row 99 is not in this batch/);
    await expect(svc.itImportApprove(ceo, { ...input, batchId: 'bad id!', skipRows: [] })).rejects.toThrow(/Preview the batch again/);
  });

  it('imports jobs for named IT doers, logged with their source and left open for IT', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const { p, input } = await previewed(svc, 'jobs', JOBS, 'UAT email 31 Oct', 'batch-uat-jobs');
    expect(p.rows.map((r) => r.errors)).toEqual([[], []]);
    expect(p.rows[0].job).toMatchObject({ title: 'UAT patch, laptops', doerId: 'u-it-ex2', technical: true, priority: 'P2' });
    expect(p.rows[1].job).toMatchObject({ doerId: 'u-it-lead', priority: 'P3', dueOn: TODAY });
    const r = await svc.itImportApprove(ceo, input);
    expect(r.created).toHaveLength(2);
    const board = await svc.itBoard(await svc.user('u-it-mgr'));
    const job = (board.jobs ?? []).map((j) => j.job).find((j) => j.title === 'UAT patch, laptops');
    expect(job).toMatchObject({ status: 'todo', givenById: 'u-fauzan' });
    expect(job?.log[0].note).toMatch(/UAT email 31 Oct, row 2/);
  });
});

describe('CEO batch import of open IT work: second review', () => {
  it('refuses values that are too long on their row instead of cutting them short', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const long = 'x'.repeat(121);
    const text = ['Title,Requester,Channel,Urgency,Detail', `UAT ${long},UAT Staff A,Teams,P2,`, `UAT ok,${'y'.repeat(81)},Teams,P2,`, `UAT ok two,UAT Staff C,Teams,P2,${'z'.repeat(1001)}`, 'UAT fine,UAT Staff D,Teams,P2,short'].join('\n');
    const p = await svc.itImportPreview(ceo, { kind: 'tickets', text, source: 'UAT csv' });
    expect(p.rows[0].errors.join(' ')).toMatch(/Title is 125 characters; the most is 120/);
    expect(p.rows[1].errors.join(' ')).toMatch(/Requester is 81 characters; the most is 80/);
    expect(p.rows[2].errors.join(' ')).toMatch(/Detail is 1001 characters; the most is 1000/);
    expect(p.rows[3].ticket?.detail).toBe('short');
    expect(p.ready).toBe(1);
    await expect(svc.itImportPreview(ceo, { kind: 'tickets', text, source: 's'.repeat(201) })).rejects.toThrow(/too long; the most is 200/);
    // Over the API's action route, too long is refused, never cut: a long source, batch ID or token is not shortened to fit.
    await expect(svc.itAct(ceo, 'importPreview', { kind: 'tickets', text, source: 's'.repeat(201) })).rejects.toThrow(/too long/);
    await expect(svc.itAct(ceo, 'importApprove', { kind: 'tickets', text, source: 'UAT csv', batchId: 'b'.repeat(81), previewToken: p.previewToken, skipRows: [] })).rejects.toThrow(
      /Preview the batch again/,
    );
    await expect(svc.itAct(ceo, 'importApprove', { kind: 'tickets', text, source: 'UAT csv', batchId: 'batch-long-01', previewToken: `${p.previewToken}0`, skipRows: [] })).rejects.toThrow(
      /Preview the batch again/,
    );
  });

  it('returns the original receipt on a retry, and refuses a retry that leaves out different rows', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const text = ['Title\tRequester\tChannel\tUrgency', 'UAT a\tUAT Staff A\tTeams\tP2', 'UAT b\tUAT Staff B\tTeams\tP2', 'UAT c\tUAT Staff C\t\tP2'].join('\n');
    const { input } = await previewed(svc, 'tickets', text, 'UAT sheet', 'batch-receipt-01', [3, 3]);
    const r = await svc.itImportApprove(ceo, input);
    expect(r.created).toHaveLength(1);
    expect(r.skipped.map((s) => s.row)).toEqual([3, 4]);
    const again = await svc.itImportApprove(ceo, { ...input, skipRows: [3] });
    expect(again).toEqual({ ...r, already: true });
    await expect(svc.itImportApprove(ceo, { ...input, skipRows: [] })).rejects.toThrow(/different rows left out/);
    await expect(svc.itImportApprove(ceo, { ...input, skipRows: [2, 3] })).rejects.toThrow(/different rows left out/);
    const board = await svc.itBoard(ceo);
    expect((board.tickets ?? []).filter((t) => t.ticket.importBatchId === 'batch-receipt-01')).toHaveLength(1);
  });
});
