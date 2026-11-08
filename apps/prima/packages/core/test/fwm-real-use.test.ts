import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset, myt } from '../src';

// FWM permit board ready for real use in both Prima and the JA Group app (Fauzan, 5 Nov 2026, audit decision 1).
// Synthetic data only: generated workers, made-up paper numbers and a made-up JA feed.
const TODAY = '2026-11-05'; // a Thursday
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const at = { now: myt(TODAY, '10:00') };
  const np = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard' && p.status === 'active')!;
  ds.fwRenewals = ds.fwRenewals.filter((r) => r.personId !== np.id);
  // Put the worker's PLKS 30 days out, so FWM and the Chief of Staff are alerted and owe an acknowledgement.
  const plks = ds.credentials.filter((c) => c.personId === np.id && c.type === 'PLKS_PERMIT');
  ds.credentials = ds.credentials.filter((c) => !(c.personId === np.id && c.type === 'PLKS_PERMIT'));
  ds.credentials.push({ ...plks[0], id: 'cr-uat-plks', issuedOn: '2025-11-20', expiresOn: addDays(TODAY, 30), number: 'UAT-PLKS-1' });
  // Start with no JA feed (the demo set carries a sample one), so each test sends its own.
  ds.jaRecords = [];
  ds.jaSyncs = [];
  const svc = new PrimaService(new MemoryStore(ds), () => at.now);
  return { ds, at, svc, np };
};
const pdf = (name: string) => ({ kind: 'document' as const, name, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name}`).toString('base64')}` });
const item = async (svc: PrimaService, uid: string, personId: string, paper = 'PLKS_PERMIT') =>
  (await svc.fwmBoard(await svc.user(uid))).items.find((i) => i.person.id === personId && i.paper === paper)!;

describe('FWM records papers in Prima from the paper itself', () => {
  it('records a renewed PLKS from its copy, closes the submitted renewal and restarts the ladder', async () => {
    const { svc, np, ds } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    expect((await item(svc, 'u-fwm-ex1', np.id)).source).toBe('sample');
    await svc.submitFwRenewal(fwm, np.id, 'PLKS_PERMIT', { submittedOn: TODAY, channel: 'FWCMS' }, [pdf('uat-receipt.pdf')]);
    expect((await item(svc, 'u-fwm-ex1', np.id)).stage?.paused).toBe(true);
    const input = { mode: 'new' as const, number: 'UAT-PLKS-2', issuedOn: TODAY, expiresOn: addDays(TODAY, 395) };
    await expect(svc.recordFwPaper(fwm, np.id, 'PLKS_PERMIT', input, [])).rejects.toThrow(/copy/);
    await expect(svc.recordFwPaper(fwm, np.id, 'PLKS_PERMIT', { ...input, issuedOn: '2025-11-01' }, [pdf('a.pdf')])).rejects.toThrow(/Correct/);
    await expect(svc.recordFwPaper(fwm, np.id, 'PLKS_PERMIT', { ...input, expiresOn: addDays(TODAY, 10) }, [pdf('a.pdf')])).rejects.toThrow(/expire after/);
    await expect(svc.recordFwPaper(fwm, np.id, 'PLKS_PERMIT', { ...input, issuedOn: addDays(TODAY, 1) }, [pdf('a.pdf')])).rejects.toThrow(/future/);
    const saved = await svc.recordFwPaper(fwm, np.id, 'PLKS_PERMIT', input, [pdf('uat-plks-copy.pdf')]);
    expect(saved).toMatchObject({ source: 'prima', recordedById: 'u-fwm-ex1', expiresOn: addDays(TODAY, 395) });
    expect((await svc.fwmDocs(fwm, saved.id)).length).toBe(1);
    // More than 120 days away again: off the ladder; the worker's file shows the new paper.
    const board = await svc.fwmBoard(fwm);
    expect(board.items.some((i) => i.person.id === np.id && i.paper === 'PLKS_PERMIT')).toBe(false);
    expect(board.workers.find((w) => w.id === np.id)!.papers.find((p) => p.paper === 'PLKS_PERMIT')).toMatchObject({ source: 'prima', expiresOn: addDays(TODAY, 395) });
    expect(ds.fwRenewals.find((r) => r.personId === np.id)!.doneCredentialId).toBe(saved.id);
    expect(ds.audit.at(-1)!.action).toBe('fwm.paper');
  });

  it('corrects a typing mistake only with a reason and keeps the old values', async () => {
    const { svc, np } = fresh();
    const fwm = await svc.user('u-fwm-ex2');
    const fix = { mode: 'correct' as const, number: 'UAT-PLKS-1', issuedOn: '2025-11-20', expiresOn: addDays(TODAY, 31) };
    await expect(svc.recordFwPaper(fwm, np.id, 'PLKS_PERMIT', fix, [])).rejects.toThrow(/what was wrong/);
    // A later expiry keeps the worker legal for longer: it needs the copy.
    await expect(svc.recordFwPaper(fwm, np.id, 'PLKS_PERMIT', { ...fix, reason: 'Day typed wrong from the sticker' }, [])).rejects.toThrow(/copy/);
    const saved = await svc.recordFwPaper(fwm, np.id, 'PLKS_PERMIT', { ...fix, reason: 'Day typed wrong from the sticker' }, [pdf('uat-sticker.pdf')]);
    // An earlier expiry (the safe direction) needs only the reason.
    await svc.recordFwPaper(fwm, np.id, 'PLKS_PERMIT', { ...fix, expiresOn: addDays(TODAY, 29), reason: 'Checked again: one day earlier' }, []);
    expect(saved.expiresOn).toBe(addDays(TODAY, 31));
    expect(saved.corrections![0]).toMatchObject({ reason: 'Day typed wrong from the sticker', byId: 'u-fwm-ex2', before: { expiresOn: addDays(TODAY, 30) } });
    await expect(svc.recordFwPaper(fwm, np.id, 'PLKS_PERMIT', { ...fix, expiresOn: addDays(TODAY, 29), reason: 'again' }, [])).rejects.toThrow(/Nothing changed/);
  });

  it('keeps only the last 4 characters of a passport number', async () => {
    const { svc, np } = fresh();
    const fwm = await svc.user('u-fwm-ex3');
    const saved = await svc.recordFwPaper(fwm, np.id, 'PASSPORT', { mode: 'new', number: 'PA 1234 5678', issuedOn: TODAY, expiresOn: addDays(TODAY, 3650) }, [pdf('uat-pp.pdf')]);
    expect(saved.number).toBe('****5678');
  });

  it('refuses everyone outside the FWM team at the server', async () => {
    const { svc, np } = fresh();
    const input = { mode: 'new' as const, number: 'UAT-X-1', issuedOn: TODAY, expiresOn: addDays(TODAY, 365) };
    for (const uid of ['u-fwm-desp', 'u-coo', 'u-fauzan', 'u-om-klang', 'u-pwvsb-hr']) {
      await expect(svc.recordFwPaper(await svc.user(uid), np.id, 'FOMEMA', input, [pdf('x.pdf')])).rejects.toBeInstanceOf(AccessDenied);
    }
    const my = (await svc.fwmBoard(await svc.user('u-fwm-ex1'))).workers.length;
    expect(my).toBeGreaterThan(0);
  });
});

describe('Acknowledgement within 1 working day at 30 days or less (rule FWM-ACK)', () => {
  it('asks FWM and the Chief of Staff at 30 days, not yet the COO, and shows late after 1 working day', async () => {
    const { svc, np, at } = fresh();
    const i = await item(svc, 'u-fwm-ex1', np.id);
    expect(i.acksOwed.map((a) => a.level).sort()).toEqual(['CHIEF_OF_STAFF', 'FWM']);
    expect(i.acksOwed.every((a) => a.dueOn === '2026-11-06' && !a.late)).toBe(true);
    const coo = await item(svc, 'u-coo', np.id);
    expect(coo.canAck).toBe(false);
    await expect(svc.ackFwPaper(await svc.user('u-coo'), i.credentialId!, '')).rejects.toThrow(/Nothing to acknowledge/);
    await expect(svc.ackFwPaper(await svc.user('u-fwm-desp'), i.credentialId!, '')).rejects.toBeInstanceOf(AccessDenied);
    // Friday passes without the Chief of Staff: late on Monday.
    at.now = myt('2026-11-09', '09:00');
    const late = await item(svc, 'u-cos', np.id);
    expect(late.canAck).toBe(true);
    expect(late.acksOwed.every((a) => a.late)).toBe(true);
    expect((await svc.fwmBoard(await svc.user('u-cos'))).counts.ackLate).toBeGreaterThan(0);
    await svc.ackFwPaper(await svc.user('u-cos'), i.credentialId!, 'Asked FWM for the FWCMS slip today');
    await expect(svc.ackFwPaper(await svc.user('u-cos'), i.credentialId!, '')).rejects.toThrow(/already acknowledged|Nothing to acknowledge/);
    const after = await item(svc, 'u-fwm-ex1', np.id);
    expect(after.acks.map((a) => a.level)).toEqual(['CHIEF_OF_STAFF']);
    expect(after.acksOwed.map((a) => a.level)).toEqual(['FWM']);
    await svc.ackFwPaper(await svc.user('u-fwm-ex1'), i.credentialId!, '');
    expect((await item(svc, 'u-fwm-ex1', np.id)).acksOwed).toEqual([]);
  });

  it('skips Saturday, Sunday and public holidays (Deepavali replacement, Mon 9 Nov 2026)', async () => {
    const { svc, np, ds, at } = fresh();
    ds.credentials.find((c) => c.id === 'cr-uat-plks')!.expiresOn = addDays('2026-11-06', 30);
    at.now = myt('2026-11-06', '09:00');
    const i = await item(svc, 'u-fwm-ex1', np.id);
    expect(i.acksOwed.map((a) => a.dueOn)).toEqual(['2026-11-10', '2026-11-10']);
  });

  it('puts SPIKPA and the KDN letter on the ladder; a missing KDN letter counts only from year 4', async () => {
    const { svc, ds } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    const board = await svc.fwmBoard(fwm);
    expect(board.workers[0].papers.map((p) => p.paper)).toEqual(['PLKS_PERMIT', 'PASSPORT', 'FOMEMA', 'FW_INSURANCE', 'SPIKPA', 'KDN_LETTER']);
    const missingKdn = board.items.filter((i) => i.paper === 'KDN_LETTER' && i.stage === null);
    for (const m of missingKdn) {
      const p = ds.people.find((x) => x.id === m.person.id)!;
      expect(p.hiredOn <= addDays(TODAY, -3 * 365)).toBe(true);
    }
    const young = ds.people.find((p) => p.nationality === 'NP' && p.status === 'active' && p.hiredOn > addDays(TODAY, -365))!;
    expect(board.items.some((i) => i.person.id === young.id && i.paper === 'KDN_LETTER' && i.stage === null)).toBe(false);
    const saved = await svc.recordFwPaper(fwm, young.id, 'SPIKPA', { mode: 'new', number: 'UAT-SPK-1', issuedOn: TODAY, expiresOn: addDays(TODAY, 3650) }, [pdf('uat-spikpa.pdf')]);
    expect(saved.type).toBe('SPIKPA');
  });

  it('needs no acknowledgement once the renewal is submitted', async () => {
    const { svc, np } = fresh();
    await svc.submitFwRenewal(await svc.user('u-fwm-ex1'), np.id, 'PLKS_PERMIT', { submittedOn: TODAY, channel: 'FWCMS' }, [pdf('uat-r.pdf')]);
    expect((await item(svc, 'u-cos', np.id)).acksOwed).toEqual([]);
  });
});

describe('The same board in Prima and the JA Group app', () => {
  const jaWorker = (staffNo: string, papers: { paper: string; expiresOn: string | null; renewalSubmittedOn?: string | null }[], extra: Record<string, unknown> = {}) => ({
    company: 'SASA',
    externalId: `W-${staffNo}`,
    updatedAt: `${TODAY}T09:00:00+08:00`,
    staffNo,
    name: `UAT Worker ${staffNo}`,
    nationality: 'Nepal',
    status: 'active',
    papers,
    ...extra,
  });

  it('shows both dates, counts to the earlier one and lets FWM take the JA date', async () => {
    const { svc, np } = fresh();
    const feed = await svc.user('u-ja-sync');
    await svc.jaIngest(feed, 'worker', [jaWorker(np.staffNo, [{ paper: 'PLKS', expiresOn: addDays(TODAY, 20) }, { paper: 'KDN_LETTER', expiresOn: addDays(TODAY, 40) }])], ['SASA']);
    const i = await item(svc, 'u-fwm-ex1', np.id);
    expect(i).toMatchObject({ datesDiffer: true, countedFrom: 'ja', expiresOn: addDays(TODAY, 20), primaExpiresOn: addDays(TODAY, 30) });
    expect(i.ja?.stale).toBe(false);
    const board = await svc.fwmBoard(await svc.user('u-fwm-ex1'));
    expect(board.alignment!.datesDiffer.some((d) => d.person.id === np.id)).toBe(true);
    // The KDN letter is on the ladder too (Fauzan, 5 Nov 2026), from the JA date when Prima has none.
    expect(board.items.find((x) => x.person.id === np.id && x.paper === 'KDN_LETTER')).toMatchObject({ countedFrom: 'ja', expiresOn: addDays(TODAY, 40) });
    await svc.recordFwPaper(await svc.user('u-fwm-ex1'), np.id, 'PLKS_PERMIT', { mode: 'ja' }, []);
    const after = await item(svc, 'u-fwm-ex1', np.id);
    expect(after).toMatchObject({ datesDiffer: false, source: 'ja', primaExpiresOn: addDays(TODAY, 20) });
    await expect(svc.recordFwPaper(await svc.user('u-fwm-ex1'), np.id, 'PLKS_PERMIT', { mode: 'ja' }, [])).rejects.toThrow(/same date/);
  });

  it('pauses on a JA renewal submission only for the date it is about', async () => {
    const { svc, np } = fresh();
    const feed = await svc.user('u-ja-sync');
    await svc.jaIngest(feed, 'worker', [jaWorker(np.staffNo, [{ paper: 'PLKS', expiresOn: addDays(TODAY, 30), renewalSubmittedOn: TODAY }])], ['SASA']);
    expect((await item(svc, 'u-fwm-ex1', np.id))).toMatchObject({ jaSubmitted: true, stage: { paused: true } });
    await svc.jaIngest(feed, 'worker', [{ ...jaWorker(np.staffNo, [{ paper: 'PLKS', expiresOn: addDays(TODAY, 45), renewalSubmittedOn: TODAY }]), updatedAt: `${TODAY}T09:30:00+08:00` }], ['SASA']);
    // Prima's own 30-day date is earlier and nobody submitted for it: not paused.
    expect((await item(svc, 'u-fwm-ex1', np.id))).toMatchObject({ jaSubmitted: false, datesDiffer: true, stage: { paused: false } });
  });

  it('puts workers only in the JA app on the ladder and lets FWM add them to Prima', async () => {
    const { svc, ds } = fresh();
    const feed = await svc.user('u-ja-sync');
    await svc.jaIngest(
      feed,
      'worker',
      [
        jaWorker('UAT-NP-9001', [{ paper: 'PLKS', expiresOn: addDays(TODAY, 10) }, { paper: 'FWIG', expiresOn: addDays(TODAY, 200) }]),
        jaWorker('UAT-NP-9002', [{ paper: 'PLKS', expiresOn: addDays(TODAY, 5) }], { status: 'absconded' }),
      ],
      ['SASA'],
    );
    const fwm = await svc.user('u-fwm-ex1');
    const board = await svc.fwmBoard(fwm);
    const row = board.items.find((i) => i.person.staffNo === 'UAT-NP-9001' && i.paper === 'PLKS_PERMIT')!;
    expect(row).toMatchObject({ jaOnly: true, canAck: false, stage: { urgent: true } });
    expect(row.person.id).toBeNull();
    // An absconded worker is never put on the ladder or added automatically (no auto-abscondment either way).
    expect(board.items.some((i) => i.person.staffNo === 'UAT-NP-9002')).toBe(false);
    const ja = board.alignment!.jaOnly.find((w) => w.staffNo === 'UAT-NP-9001')!;
    const branch = ds.branches.find((b) => b.companyId === 'co-sasa')!;
    await expect(svc.addFwWorkerFromJa(await svc.user('u-coo'), ja.recordId, { branchId: branch.id, hiredOn: '2024-01-10', dob: '1995-04-01' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.addFwWorkerFromJa(fwm, ja.recordId, { branchId: branch.id, hiredOn: '2024-01-10', dob: '2015-04-01' })).rejects.toThrow(/age/);
    const other = ds.branches.find((b) => b.companyId !== 'co-sasa')!;
    await expect(svc.addFwWorkerFromJa(fwm, ja.recordId, { branchId: other.id, hiredOn: '2024-01-10', dob: '1995-04-01' })).rejects.toThrow(/branch/);
    const added = await svc.addFwWorkerFromJa(fwm, ja.recordId, { branchId: branch.id, hiredOn: '2024-01-10', dob: '1995-04-01' });
    expect(added.papers).toBe(2);
    expect(added.person).toMatchObject({ nationality: 'NP', staffNo: 'UAT-NP-9001', companyId: 'co-sasa', idMasked: '' });
    await expect(svc.addFwWorkerFromJa(fwm, ja.recordId, { branchId: branch.id, hiredOn: '2024-01-10', dob: '1995-04-01' })).rejects.toThrow(/already in Prima/);
    const now = (await svc.fwmBoard(fwm)).items.find((i) => i.person.staffNo === 'UAT-NP-9001' && i.paper === 'PLKS_PERMIT')!;
    expect(now).toMatchObject({ jaOnly: false, source: 'ja', datesDiffer: false });
    expect(now.canAck).toBe(true);
    const absconded = (await svc.fwmBoard(fwm)).alignment!.jaOnly.find((w) => w.staffNo === 'UAT-NP-9002')!;
    await expect(svc.addFwWorkerFromJa(fwm, absconded.recordId, { branchId: branch.id, hiredOn: '2024-01-10', dob: '1995-04-01' })).rejects.toThrow(/absconded/);
  });

  it('flags Prima workers missing from a current JA feed, and treats a late feed as unknown', async () => {
    const { svc, np, at } = fresh();
    const feed = await svc.user('u-ja-sync');
    await svc.jaIngest(feed, 'worker', [jaWorker(np.staffNo, [{ paper: 'PLKS', expiresOn: addDays(TODAY, 30) }])], ['SASA']);
    const b1 = await svc.fwmBoard(await svc.user('u-fwm-mgr'));
    expect(b1.alignment!.feeds.find((f) => f.companyId === 'co-sasa')!.state).toBe('ok');
    expect(b1.alignment!.notInJa.length).toBeGreaterThan(0);
    expect(b1.alignment!.notInJa.some((p) => p.id === np.id)).toBe(false);
    at.now = myt(addDays(TODAY, 2), '10:00');
    const b2 = await svc.fwmBoard(await svc.user('u-fwm-mgr'));
    expect(b2.alignment!.feeds.find((f) => f.companyId === 'co-sasa')!.state).toBe('stale');
    expect(b2.alignment!.notInJa).toEqual([]);
    expect(b2.items.find((i) => i.person.id === np.id && i.paper === 'PLKS_PERMIT')!.ja?.stale).toBe(true);
  });

  it('gives the JA app what FWM recorded in Prima, to the JA feed sign-in only', async () => {
    const { svc, np, at, ds } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    await svc.recordFwPaper(fwm, np.id, 'PASSPORT', { mode: 'new', number: 'PA12345678', issuedOn: TODAY, expiresOn: addDays(TODAY, 3650) }, [pdf('uat-pp.pdf')]);
    await svc.submitFwRenewal(fwm, np.id, 'FOMEMA', { submittedOn: TODAY, channel: 'FOMEMA' }, [pdf('uat-f.pdf')]).catch(() => undefined);
    await expect(svc.jaFwPaperChanges(fwm, null)).rejects.toBeInstanceOf(AccessDenied);
    at.now = myt(TODAY, '10:05');
    const out = await svc.jaFwPaperChanges(await svc.user('u-ja-sync'), null);
    const pp = out.records.find((r) => r.kind === 'paper' && r.staffNo === np.staffNo)!;
    expect(pp).toMatchObject({ company: 'SASA', paper: 'PASSPORT', number: '****5678', expiresOn: addDays(TODAY, 3650) });
    // Sample rows never leave as if they were recorded from the paper.
    expect(out.records.filter((r) => r.kind === 'paper')).toHaveLength(1);
    expect((await svc.jaFwPaperChanges(await svc.user('u-ja-sync'), out.asOf)).records).toEqual([]);
    // The same instant written in UTC gives the same answer; the read is in the activity log.
    const utc = new Date(Date.parse(out.asOf)).toISOString();
    expect((await svc.jaFwPaperChanges(await svc.user('u-ja-sync'), utc)).records).toEqual([]);
    expect((await svc.jaFwPaperChanges(await svc.user('u-ja-sync'), myt(TODAY, '09:00'))).records.length).toBeGreaterThan(0);
    await expect(svc.jaFwPaperChanges(await svc.user('u-ja-sync'), 'yesterday')).rejects.toThrow(/since/);
    expect(ds.audit.at(-1)!.action).toBe('ja.fw_papers.read');
  });
});

describe('Review round (5 Nov 2026): privacy, pauses and JA stand-in dates', () => {
  it('shows paper numbers to the FWM team only, and passports as the last 4 characters', async () => {
    const { svc, np } = fresh();
    const staff = await item(svc, 'u-fwm-ex1', np.id);
    expect(staff.number).toBe('UAT-PLKS-1');
    for (const uid of ['u-cos', 'u-coo', 'u-fauzan']) expect((await item(svc, uid, np.id)).number).toBeNull();
    const board = await svc.fwmBoard(await svc.user('u-fwm-ex1'));
    for (const w of board.workers) {
      const pp = w.papers.find((p) => p.paper === 'PASSPORT');
      if (pp?.number) expect(pp.number).toMatch(/^\*\*\*\*.{1,4}$/);
    }
  });

  it('pauses on a Prima renewal even while the JA app holds an earlier date', async () => {
    const { svc, np } = fresh();
    await svc.jaIngest(await svc.user('u-ja-sync'), 'worker', [{ company: 'SASA', externalId: 'W-P', updatedAt: `${TODAY}T09:00:00+08:00`, staffNo: np.staffNo, name: 'UAT', nationality: 'Nepal', status: 'active', papers: [{ paper: 'PLKS', expiresOn: addDays(TODAY, 12) }] }], ['SASA']);
    expect((await item(svc, 'u-fwm-ex1', np.id))).toMatchObject({ datesDiffer: true, stage: { urgent: true } });
    await svc.submitFwRenewal(await svc.user('u-fwm-ex1'), np.id, 'PLKS_PERMIT', { submittedOn: TODAY, channel: 'FWCMS' }, [pdf('uat-r2.pdf')]);
    expect((await item(svc, 'u-fwm-ex1', np.id)).stage).toMatchObject({ paused: true });
  });

  it('lets FWM record the real paper on the same day a JA date was taken', async () => {
    const { svc, ds } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    await svc.jaIngest(await svc.user('u-ja-sync'), 'worker', [{ company: 'SASA', externalId: 'W-S', updatedAt: `${TODAY}T09:00:00+08:00`, staffNo: 'UAT-NP-7001', name: 'UAT New', nationality: 'Nepal', status: 'active', papers: [{ paper: 'SPIKPA', expiresOn: addDays(TODAY, 300) }] }], ['SASA']);
    const ja = (await svc.fwmBoard(fwm)).alignment!.jaOnly.find((w) => w.staffNo === 'UAT-NP-7001')!;
    const { person } = await svc.addFwWorkerFromJa(fwm, ja.recordId, { branchId: ds.branches.find((b) => b.companyId === 'co-sasa')!.id, hiredOn: '2025-01-01', dob: '1996-01-01' });
    // The JA date was recorded today with today standing in as the issue date; the real paper issued today still goes in.
    const real = await svc.recordFwPaper(fwm, person.id, 'SPIKPA', { mode: 'new', number: 'UAT-SPK-9', issuedOn: TODAY, expiresOn: addDays(TODAY, 365) }, [pdf('uat-spk.pdf')]);
    expect(real).toMatchObject({ source: 'prima', expiresOn: addDays(TODAY, 365) });
  });
});
