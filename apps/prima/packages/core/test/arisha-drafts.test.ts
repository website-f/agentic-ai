import { describe, expect, it } from 'vitest';
import { generateDataset, MemoryStore, PrimaService, type ArishaReviewPayload } from '../src';

const TODAY = '2026-10-30';
const NOW = '2026-10-30T04:00:00.000Z';
async function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const [ceo, act, coo, fd, it] = await Promise.all(['u-fauzan', 'u-audit', 'u-coo', 'u-fd', 'u-it-mgr'].map(id => svc.user(id)));
  const site = ds.sites.find(s => s.companyId === 'co-sasa')!;
  const cid = site.companyId;
  const payload: ArishaReviewPayload = { type: 'record', kind: 'checkpoint', id: null, values: { siteId: site.id, name: 'Synthetic review proposal', tagCode: 'UAT-ARISHA-NEW' } };
  return { ds, store, svc, ceo, act, coo, fd, it, cid, site, payload, drafts: svc.arishaDrafts };
}
async function financeFixture() {
  const f = await fresh();
  const row = f.ds.finStatus.find(r => r.companyId === f.cid)!;
  const paper = row.audit[0];
  paper.status = 'todo';
  const reviewer = f.ds.users.find(u => u.department === 'finance' && u.financeTeam === row.team && u.financeRole === 'leader')!;
  const payload: ArishaReviewPayload = { type: 'finance-paper', pack: 'audit', itemId: paper.id, status: 'prepared' };
  return { ...f, row, paper, reviewer, financePayload: payload };
}

describe('Arisha persisted human-review workflow', () => {
  it('allows the CEO to explicitly review and save their own proposal with existing authority', async () => {
    const { drafts, ceo, cid, payload, ds } = await fresh();
    const before = ds.checkpoints.length;
    const d = await drafts.submit(ceo, payload, cid, 'arisha');
    expect(ds.checkpoints).toHaveLength(before);
    expect((await drafts.list(ceo))[0].canCommit).toBe(true);
    const saved = await drafts.commit(ceo, d.id, 1);
    expect(saved).toMatchObject({ authorId: ceo.id, reviewedById: ceo.id, status: 'committed' });
    expect(ds.checkpoints).toHaveLength(before + 1);
  });

  it('lets Finance explicitly resubmit a returned paper and human-save under existing authority', async () => {
    const { drafts, fd, reviewer, cid, financePayload, ds, paper } = await financeFixture();
    const d = await drafts.submit(fd, financePayload, cid, 'arisha');
    await drafts.returnDraft(reviewer, d.id, 1);
    expect((await drafts.list(fd))[0]).toMatchObject({ status: 'returned', canResubmit: true, canCommit: false });
    const [again, retry] = await Promise.all([drafts.resubmit(fd, d.id, 2), drafts.resubmit(fd, d.id, 2)]);
    expect(again).toMatchObject({ id: d.id, status: 'submitted', version: 3, reviewedById: null, reviewedAt: null });
    expect(retry).toEqual(again);
    expect(again).not.toHaveProperty('sourceVersion');
    expect(paper.status).toBe('todo');
    expect(ds.audit.filter(a => a.action === 'arisha.draft.resubmitted')).toHaveLength(1);
    const saved = await drafts.commit(fd, d.id, 3);
    expect(saved).toMatchObject({ status: 'committed', version: 4, authorId: fd.id, reviewedById: fd.id });
    expect(ds.finStatus.find(r => r.companyId === cid)!.audit.find(p => p.id === paper.id)!.status).toBe('prepared');
    await expect(drafts.resubmit(fd, d.id, 4)).rejects.toThrow();
  });

  it('allows only the current author to resubmit the exact returned version', async () => {
    const { drafts, fd, reviewer, cid, financePayload, ds } = await financeFixture();
    const d = await drafts.submit(fd, financePayload, cid, 'human');
    await drafts.returnDraft(reviewer, d.id, 1);
    await expect(drafts.resubmit(reviewer, d.id, 2)).rejects.toThrow();
    for (const version of [1, 3, 2.5]) await expect(drafts.resubmit(fd, d.id, version)).rejects.toThrow();
    for (const grant of ds.grants.filter(g => g.userId === fd.id && g.companyId === cid)) grant.validTo = '2026-10-29';
    await expect(drafts.resubmit(fd, d.id, 2)).rejects.toThrow();
    for (const grant of ds.grants.filter(g => g.userId === fd.id && g.companyId === cid)) grant.validTo = '2027-10-29';
    fd.leadership = undefined;
    await expect(drafts.resubmit(fd, d.id, 2)).rejects.toThrow();
    expect(ds.arishaDrafts[0]).toMatchObject({ status: 'returned', version: 2 });
  });

  it('refreshes a changed todo paper snapshot on explicit resubmit but never reverses an advanced paper', async () => {
    const { drafts, fd, reviewer, cid, financePayload, paper, ds } = await financeFixture();
    const d = await drafts.submit(fd, financePayload, cid, 'human');
    const oldHash = ds.arishaDrafts[0].sourceVersion;
    await drafts.returnDraft(reviewer, d.id, 1);
    paper.label += ' amended';
    await drafts.resubmit(fd, d.id, 2);
    expect(ds.arishaDrafts[0].sourceVersion).not.toBe(oldHash);
    await drafts.returnDraft(reviewer, d.id, 3);
    paper.status = 'reviewed';
    await expect(drafts.resubmit(fd, d.id, 4)).rejects.toThrow(/todo/);
    expect(paper.status).toBe('reviewed');
    expect(ds.arishaDrafts[0]).toMatchObject({ status: 'returned', version: 4 });
  });

  it('revalidates record references when the author resubmits', async () => {
    const { drafts, act, ceo, cid, payload, store, site, ds } = await fresh();
    const d = await drafts.submit(act, payload, cid, 'human');
    await drafts.returnDraft(ceo, d.id, 1);
    await store.update('sites', site.id, { companyId: ds.companies.find(c => c.id !== cid)!.id });
    await expect(drafts.resubmit(act, d.id, 2)).rejects.toThrow(/reference/);
    expect(ds.arishaDrafts[0]).toMatchObject({ status: 'returned', version: 2 });
  });

  it('preserves CEO company preparation without mutating or certifying the existing company', async () => {
    const { drafts, ceo, act, coo, fd, cid, ds } = await fresh();
    const original = JSON.stringify(ds.companies);
    const values = { name: 'Synthetic Registered Company Sdn Bhd', ssmNo: 'UAT-123456', state: 'Selangor', sourceRef: 'Synthetic SSM reference only' };
    const choices = await drafts.form(ceo, 'company', null);
    expect(choices.chooseCompany?.some(([id]) => id === cid)).toBe(true);
    const form = await drafts.form(ceo, 'company', cid);
    expect(form.spec.fields.map(f => f.key)).not.toContain('verificationStatus');
    const proposal = await drafts.prepareRecord(ceo, { kind: 'company', companyId: cid, values });
    expect(proposal).toMatchObject({ kind: 'company', companyId: cid, values: { ...values, verificationStatus: 'draft' } });
    expect(JSON.stringify(ds.companies)).toBe(original);
    expect(ds.arishaDrafts).toHaveLength(0);
    for (const user of [act, coo, fd, { ...ceo, id: 'other-ceo' }, { ...ceo, integration: 'feed' as never }]) {
      await expect(drafts.form(user, 'company', cid)).rejects.toThrow();
      await expect(drafts.prepareRecord(user, { kind: 'company', companyId: cid, values })).rejects.toThrow();
    }
    for (const protectedValues of [
      { ...values, verificationStatus: 'verified' }, { ...values, id: cid },
      { ...values, code: 'NEW-CODE' }, { ...values, companyId: 'another-company' },
    ]) await expect(drafts.prepareRecord(ceo, { kind: 'company', companyId: cid, values: protectedValues })).rejects.toThrow();
    await expect(drafts.prepareRecord(ceo, { kind: 'company', companyId: 'new-company', values })).rejects.toThrow();
    await expect(drafts.prepareRecord(ceo, { kind: 'company', companyId: cid, id: 'different-target', values })).rejects.toThrow();
    // Compatibility preparation must not accidentally widen the create-only cross-user queue.
    await expect(drafts.submit(ceo, { type: 'record', kind: 'company', id: null, values } as never, cid, 'arisha')).rejects.toThrow();
    expect(JSON.stringify(ds.companies)).toBe(original);
    for (const grant of ds.grants.filter(g => g.userId === ceo.id && g.companyId === cid)) grant.validTo = '2026-10-29';
    expect((await drafts.form(ceo, 'company', null)).chooseCompany?.some(([id]) => id === cid)).toBe(false);
    await expect(drafts.prepareRecord(ceo, { kind: 'company', companyId: cid, values })).rejects.toThrow();
  });

  it('independently authorizes prepare without a preceding form call', async () => {
    const { drafts, act, fd, it, cid, payload } = await fresh();
    await expect(drafts.prepareRecord(act, { ...payload, companyId: cid })).resolves.toMatchObject({ kind: 'checkpoint', companyId: cid });
    for (const user of [fd, it, { ...act, id: 'fifth-leader' }, { ...act, actRole: undefined }, { ...act, integration: 'feed' as never }]) {
      await expect(drafts.prepareRecord(user, { ...payload, companyId: cid })).rejects.toThrow();
    }
    for (const kind of ['company', 'officeStaff', 'firearm', '__proto__', 'constructor']) {
      await expect(drafts.prepareRecord(act, { ...payload, companyId: cid, kind })).rejects.toThrow();
    }
  });

  it('enforces company scope, references, create-only IDs and explicit safe fields', async () => {
    const { drafts, act, cid, payload, ds } = await fresh();
    for (const companyId of [null, 'not-a-company', 42]) await expect(drafts.prepareRecord(act, { ...payload, companyId })).rejects.toThrow();
    await expect(drafts.prepareRecord(act, { ...payload, companyId: cid, id: 'existing-record' })).rejects.toThrow();
    const foreign = ds.sites.find(s => s.companyId !== cid)!;
    for (const values of [
      { ...payload.values, siteId: foreign.id }, { ...payload.values, companyId: cid },
      { ...payload.values, verificationStatus: 'verified' }, { ...payload.values, name: { nested: true } },
      { ...payload.values, name: 'x'.repeat(2001) },
    ]) await expect(drafts.prepareRecord(act, { ...payload, companyId: cid, values })).rejects.toThrow();
    const form = await drafts.form(act, 'site', cid);
    expect(form.spec.fields.map(f => f.key)).not.toContain('armed');
    await expect(drafts.prepareRecord(act, { kind: 'site', companyId: cid, values: { armed: true } })).rejects.toThrow(/protected/);
    await expect(drafts.form(act, 'itDomain', cid)).rejects.toThrow(/group-wide/);
  });

  it('offers ACT company-wide choices only for current mandates', async () => {
    const { drafts, act, cid, ds } = await fresh();
    expect((await drafts.form(act, 'checkpoint', null)).chooseCompany?.some(([id]) => id === cid)).toBe(true);
    for (const g of ds.grants.filter(g => g.userId === act.id && g.companyId === cid)) g.validTo = '2026-10-29';
    expect((await drafts.form(act, 'checkpoint', null)).chooseCompany?.some(([id]) => id === cid)).toBe(false);
    await expect(drafts.form(act, 'checkpoint', cid)).rejects.toThrow();
  });

  it('submits only a durable draft and redacted audit, with no operational mutation', async () => {
    const { drafts, act, cid, payload, ds } = await fresh();
    const count = ds.checkpoints.length;
    const d = await drafts.submit(act, payload, cid, 'arisha');
    expect(ds.checkpoints).toHaveLength(count);
    expect(ds.arishaDrafts).toHaveLength(1);
    expect(d).toMatchObject({ authorId: act.id, authorRole: 'act', status: 'submitted', version: 1, provenance: 'unverified' });
    expect(d).not.toHaveProperty('sourceVersion');
    const audit = ds.audit.filter(a => a.action.startsWith('arisha.draft.'));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('Synthetic review proposal');
    expect(JSON.stringify(audit)).not.toContain('UAT-ARISHA-NEW');
  });

  it('does not share mutable submitted payloads with callers', async () => {
    const { drafts, act, cid, payload, ds } = await fresh();
    const d = await drafts.submit(act, payload, cid, 'human');
    if (d.payload.type !== 'record') throw new Error('Expected record');
    d.payload.values.name = 'Mutated result';
    const listed = await drafts.list(act);
    if (listed[0].payload.type !== 'record') throw new Error('Expected record');
    expect(listed[0].payload.values.name).toBe('Synthetic review proposal');
    listed[0].payload.values.name = 'Mutated list';
    const stored = ds.arishaDrafts[0].payload;
    expect(stored.type === 'record' && stored.values.name).toBe('Synthetic review proposal');
  });

  it('requires a real writer; ACT and COO drafting do not confer write authority', async () => {
    const { drafts, svc, act, ceo, coo, fd, cid, payload, ds } = await fresh();
    const d = await drafts.submit(act, payload, cid, 'human');
    await expect(drafts.commit(act, d.id, d.version)).rejects.toThrow();
    await expect(drafts.commit(fd, d.id, d.version)).rejects.toThrow();
    await expect(drafts.commit(coo, d.id, d.version)).rejects.toThrow();
    await expect(svc.saveRecord(act, 'checkpoint', null, cid, payload.values)).rejects.toThrow();
    await expect(svc.recordForm(act, 'company', null, cid)).rejects.toThrow();
    const before = ds.checkpoints.length;
    const saved = await drafts.commit(ceo, d.id, d.version);
    expect(saved).toMatchObject({ status: 'committed', reviewedById: ceo.id, version: 2 });
    expect(ds.checkpoints).toHaveLength(before + 1);
    expect(saved.resultId).toBeTruthy();
    expect(ds.checkpoints.some(p => p.id === saved.resultId)).toBe(true);
  });

  it('serializes repeated and parallel reviewer commits without duplicate saves', async () => {
    const { drafts, act, ceo, cid, payload, ds } = await fresh();
    const d = await drafts.submit(act, payload, cid, 'human');
    const before = ds.checkpoints.length;
    const results = await Promise.all([drafts.commit(ceo, d.id, 1), drafts.commit(ceo, d.id, 1)]);
    expect(results[0].resultId).toBe(results[1].resultId);
    expect(ds.checkpoints).toHaveLength(before + 1);
    await expect(drafts.commit(ceo, d.id, 2)).resolves.toMatchObject({ resultId: results[0].resultId });
    await expect(drafts.commit(ceo, d.id, 0)).rejects.toThrow();
    expect(ds.audit.filter(a => a.action === 'arisha.draft.committed')).toHaveLength(1);
  });

  it('deduplicates parallel submissions and requires a changed proposal or explicit resubmit after return', async () => {
    const { drafts, act, ceo, cid, payload, ds } = await fresh();
    const [first, repeated] = await Promise.all([
      drafts.submit(act, payload, cid, 'arisha'), drafts.submit(act, payload, cid, 'arisha'),
    ]);
    expect(first.id).toBe(repeated.id);
    expect(ds.arishaDrafts).toHaveLength(1);
    expect(ds.audit.filter(a => a.action === 'arisha.draft.submitted')).toHaveLength(1);
    await drafts.returnDraft(ceo, first.id, 1);
    await expect(drafts.submit(act, payload, cid, 'arisha')).rejects.toThrow(/returned/);
    const changed = await drafts.submit(act, { ...payload, values: { ...payload.values, name: 'Revised synthetic proposal' } }, cid, 'human');
    expect(changed.id).not.toBe(first.id);
    expect(changed).toMatchObject({ status: 'submitted', version: 1 });
    expect(ds.arishaDrafts).toHaveLength(2);
  });

  it('returns proposals without a save and rejects stale review versions', async () => {
    const { drafts, act, ceo, cid, payload, ds } = await fresh();
    const d = await drafts.submit(act, payload, cid, 'human');
    const before = ds.checkpoints.length;
    await expect(drafts.commit(ceo, d.id, 0)).rejects.toThrow(/refresh/);
    await expect(drafts.commit(ceo, d.id, 1.5)).rejects.toThrow(/refresh/);
    await expect(drafts.returnDraft(act, d.id, 1)).rejects.toThrow();
    await expect(drafts.returnDraft(ceo, d.id, 1)).resolves.toMatchObject({ status: 'returned', version: 2 });
    await expect(drafts.commit(ceo, d.id, 2)).rejects.toThrow();
    expect(ds.checkpoints).toHaveLength(before);
  });

  it('rechecks revoked author identity and expired company grants at commit', async () => {
    const { drafts, act, ceo, cid, payload, ds } = await fresh();
    const d = await drafts.submit(act, payload, cid, 'human');
    const grant = ds.grants.filter(g => g.userId === act.id && g.companyId === cid);
    for (const g of grant) g.validTo = '2026-10-29';
    await expect(drafts.commit(ceo, d.id, 1)).rejects.toThrow();
    for (const g of grant) g.validTo = '2027-10-29';
    act.actRole = undefined;
    await expect(drafts.commit(ceo, d.id, 1)).rejects.toThrow();
    expect(ds.arishaDrafts[0].status).toBe('submitted');
  });

  it('does not expose proposals to unrelated users or integrations', async () => {
    const { drafts, act, fd, it, cid, payload } = await fresh();
    await drafts.submit(act, payload, cid, 'human');
    expect(await drafts.list(fd)).toEqual([]);
    expect(await drafts.list(it)).toEqual([]);
    expect(await drafts.list({ ...act, integration: 'feed' as never })).toEqual([]);
  });

  it('rechecks reviewer scope and record references rather than trusting the submitted snapshot', async () => {
    const { drafts, act, ceo, cid, payload, ds, store, site } = await fresh();
    const d = await drafts.submit(act, payload, cid, 'human');
    const grants = ds.grants.filter(g => g.userId === ceo.id && g.companyId === cid);
    for (const g of grants) g.validTo = '2026-10-29';
    expect(await drafts.list(ceo)).toEqual([]);
    await expect(drafts.commit(ceo, d.id, 1)).rejects.toThrow();
    for (const g of grants) g.validTo = '2027-10-29';
    const otherCompany = ds.companies.find(c => c.id !== cid)!;
    await store.update('sites', site.id, { companyId: otherCompany.id });
    await expect(drafts.commit(ceo, d.id, 1)).rejects.toThrow(/reference/);
    expect(ds.arishaDrafts[0].status).toBe('submitted');
  });

  it('prepares Finance papers with a distinct authorized finance team human, never approvals or payment', async () => {
    const { drafts, fd, ceo, act, reviewer, cid, financePayload, ds, paper } = await financeFixture();
    const d = await drafts.submit(fd, financePayload, cid, 'arisha');
    expect(paper.status).toBe('todo');
    expect(d).not.toHaveProperty('sourceVersion');
    expect(ds.arishaDrafts[0].sourceVersion).toMatch(/^[a-f0-9]{64}$/);
    await expect(drafts.commit(ceo, d.id, 1)).rejects.toThrow();
    await expect(drafts.commit(act, d.id, 1)).rejects.toThrow();
    expect((await drafts.list(reviewer))[0]).toMatchObject({ canCommit: true });
    await expect(drafts.commit(reviewer, d.id, 1)).resolves.toMatchObject({ status: 'committed', reviewedById: reviewer.id });
    const current = ds.finStatus.find(r => r.companyId === cid)!.audit.find(p => p.id === paper.id)!;
    expect(current.status).toBe('prepared');
    expect(current.by).toBe(reviewer.name);
  });

  it('rejects forged finance status, missing papers, COO scope, and wrong-team reviewers', async () => {
    const { drafts, fd, coo, cid, financePayload, row, ds } = await financeFixture();
    for (const payload of [
      { ...financePayload, status: 'reviewed' }, { ...financePayload, status: 'sent' },
      { ...financePayload, pack: 'bank' }, { ...financePayload, itemId: 'missing' },
    ]) await expect(drafts.submit(fd, payload as never, cid, 'human')).rejects.toThrow();
    await expect(drafts.submit(coo, financePayload, cid, 'human')).rejects.toThrow();
    const d = await drafts.submit(fd, financePayload, cid, 'human');
    const wrongTeam = ds.users.find(u => u.department === 'finance' && u.financeTeam && u.financeTeam !== row.team)!;
    await expect(drafts.commit(wrongTeam, d.id, 1)).rejects.toThrow();
  });

  it('rejects a finance paper changed after submission without advancing it', async () => {
    const { drafts, fd, reviewer, cid, financePayload, paper, ds } = await financeFixture();
    const d = await drafts.submit(fd, financePayload, cid, 'human');
    paper.label = `${paper.label} amended`;
    await expect(drafts.commit(reviewer, d.id, 1)).rejects.toThrow(/source changed/);
    expect(paper.status).toBe('todo');
    expect(ds.arishaDrafts[0].status).toBe('submitted');
  });
});


describe('honest preparation provenance', () => {
  it('does not infer preparation origin from record or finance type or legacy caller hints', async () => {
    for (const hint of ['human', 'arisha', 'unverified'] as const) {
      const f = await financeFixture();
      expect((await f.drafts.submit(f.ceo, f.payload, f.cid, hint)).provenance).toBe('unverified');
      expect((await f.drafts.submit(f.fd, f.financePayload, f.cid, hint)).provenance).toBe('unverified');
    }
  });
  it('retains historical provenance and dedup identity on retry and rejects unsupported hints', async () => {
    const f = await fresh();
    const first = await f.drafts.submit(f.ceo, f.payload, f.cid);
    for (const historical of ['human', 'arisha'] as const) {
      await f.store.update('arishaDrafts', first.id, {provenance: historical});
      const retry = await f.drafts.submit(f.ceo, f.payload, f.cid, 'unverified');
      expect(retry.id).toBe(first.id); expect(retry.provenance).toBe(historical);
      expect(f.ds.arishaDrafts).toHaveLength(1);
    }
    await expect(f.drafts.submit(f.ceo, f.payload, f.cid, 'verified-ai' as never)).rejects.toThrow();
  });
});
