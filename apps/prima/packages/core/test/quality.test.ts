import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, addDays, generateDataset, myt, qmsState, type QmsRequirement } from '../src';

// Quality and compliance (Fauzan, 5 Nov 2026): ISO 9001 + PIKM register and the role competency matrix. Synthetic data only.
const TODAY = '2026-11-05';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const at = { now: myt(TODAY, '10:00') };
  return { ds, at, svc: new PrimaService(new MemoryStore(ds), () => at.now) };
};
const iso = (ref: string) => `qr-iso9001-${ref.replace(/\./g, '-')}`;

describe('requirements register: who sees what', () => {
  it('ACT sees every company; a company manager only their own; guards, officers and admin staff never see clause lists', async () => {
    const { svc, ds } = fresh();
    const act = await svc.quality.register(await svc.user('u-audit'));
    expect(act.role).toBe('act');
    expect(act.companies.length).toBeGreaterThan(30);
    expect(act.companies.some((c) => c.id === 'pwvsb')).toBe(true);
    const cm = await svc.quality.register(await svc.user('u-cm-sasa'));
    expect(cm.companies.map((c) => c.id)).toEqual(['co-sasa']);
    await expect(svc.quality.register(await svc.user('u-cm-sasa'), { companyId: 'co-arsh' })).resolves.toMatchObject({ companyId: 'co-sasa' });
    const guard = ds.users.find((u) => u.role === 'guard')!;
    await expect(svc.quality.register(guard)).rejects.toThrow(/Not allowed/);
    await expect(svc.quality.register(await svc.user('u-sv-sasa'))).rejects.toThrow(/Not allowed/);
    await expect(svc.quality.register(await svc.user('u-ae-arsh'))).rejects.toThrow(/Not allowed/);
    const ceo = await svc.quality.register(await svc.user('u-fauzan'));
    expect(ceo.role).toBe('view');
    expect(ceo.rows.every((r) => !r.canLink && !r.canDecide)).toBe(true);
  });

  it('keeps ISO and PIKM apart; PIKM rows follow the 2022 drafts of Parts 1 and 2', async () => {
    const { svc } = fresh();
    const b = await svc.quality.register(await svc.user('u-audit'), { companyId: 'co-sasa' });
    const pikm = b.rows.filter((r) => r.requirement.standard === 'PIKM');
    expect(pikm.length).toBeGreaterThan(0);
    expect(pikm.every((r) => r.requirement.edition === (r.requirement.ref.startsWith('2:') ? '2:2022 draft' : '1:2022 draft'))).toBe(true);
    expect(pikm.some((r) => r.requirement.placeholder)).toBe(false);
    expect(pikm.find((r) => r.requirement.ref === '9.5.1')!.state).toBe('unknown');
    // Part 2 refs never clash with Part 1 clause numbers.
    expect(pikm.find((r) => r.requirement.ref === '2:5.1')!.requirement.id).toBe('qr-pikm-2-5-1');
    expect(new Set(pikm.map((r) => r.requirement.id)).size).toBe(pikm.length);
    const isoOnly = await svc.quality.register(await svc.user('u-audit'), { companyId: 'co-sasa', standard: 'ISO9001' });
    expect(isoOnly.rows.every((r) => r.requirement.standard === 'ISO9001' && r.requirement.edition === '2015')).toBe(true);
    // Clause order reads naturally.
    const refs = isoOnly.rows.map((r) => r.requirement.ref);
    expect(refs.indexOf('7.1')).toBeLessThan(refs.indexOf('7.1.5'));
    expect(refs.indexOf('9.3')).toBeLessThan(refs.indexOf('10.2'));
  });
});

describe('requirements register: evidence is never self-checked and never auto-compliant', () => {
  it('no evidence is Unknown; linked is not checked; only another ACT member checks it', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const before = await svc.quality.register(cm);
    expect(before.rows.find((r) => r.requirement.id === iso('8.4'))!.state).toBe('unknown');
    await svc.quality.act(cm, 'linkEvidence', { requirementId: iso('8.4'), companyId: 'co-sasa', kind: 'prima_record', label: 'Supplier list with yearly review (mock)', ref: 'PUR-SUP-2026' });
    const linked = await svc.quality.register(cm);
    expect(linked.rows.find((r) => r.requirement.id === iso('8.4'))!.state).toBe('not_checked');
    // The company cannot link for another company or check its own evidence.
    await expect(svc.quality.act(cm, 'linkEvidence', { requirementId: iso('8.4'), companyId: 'co-arsh', kind: 'document', label: 'x x x', ref: 'x' })).rejects.toThrow(/Not allowed/);
    const ev = linked.rows.find((r) => r.requirement.id === iso('8.4'))!.entry!.evidence[0];
    await expect(svc.quality.act(cm, 'checkEvidence', { requirementId: iso('8.4'), companyId: 'co-sasa', evidenceId: ev.id, ok: true, note: 'fine' })).rejects.toThrow(/Not allowed/);
    // ACT checks it with a reason.
    const act = await svc.user('u-audit');
    await expect(svc.quality.act(act, 'checkEvidence', { requirementId: iso('8.4'), companyId: 'co-sasa', evidenceId: ev.id, ok: true, note: '' })).rejects.toThrow(/reason/);
    await svc.quality.act(act, 'checkEvidence', { requirementId: iso('8.4'), companyId: 'co-sasa', evidenceId: ev.id, ok: true, note: 'Matches the supplier file (mock)' });
    const done = await svc.quality.register(cm);
    const row = done.rows.find((r) => r.requirement.id === iso('8.4'))!;
    expect(row.state).toBe('checked');
    expect(row.reviewDueOn).toBe(addDays(TODAY, 365));
  });

  it('ACT cannot check evidence it linked itself', async () => {
    const { svc } = fresh();
    const act = await svc.user('u-audit');
    await svc.quality.act(act, 'linkEvidence', { requirementId: iso('9.3'), companyId: 'co-sasa', kind: 'document', label: 'Management review minutes Q3 (mock)', ref: 'MR-2026-Q3' });
    const b = await svc.quality.register(act, { companyId: 'co-sasa' });
    const row = b.rows.find((r) => r.requirement.id === iso('9.3'))!;
    expect(row.checkable).toEqual([]);
    await expect(svc.quality.act(act, 'checkEvidence', { requirementId: iso('9.3'), companyId: 'co-sasa', evidenceId: row.entry!.evidence[0].id, ok: true, note: 'Looks right' })).rejects.toThrow(
      /Another ACT member/,
    );
    const other = await svc.quality.register(await svc.user('u-act-aud1'), { companyId: 'co-sasa' });
    expect(other.rows.find((r) => r.requirement.id === iso('9.3'))!.checkable.length).toBe(1);
  });

  it('a placeholder PIKM row cannot be marked checked until ACT confirms it against the code text', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const act0 = await svc.user('u-audit');
    // A PIKM row added without saying where in the code text it came from stays a placeholder.
    const added = (await svc.quality.act(act0, 'addRequirement', { standard: 'PIKM', ref: 'Part 3', title: 'A future part (mock)' })) as { id: string; placeholder: boolean };
    expect(added.placeholder).toBe(true);
    const req = added.id;
    await svc.quality.act(cm, 'linkEvidence', { requirementId: req, companyId: 'co-sasa', kind: 'prima_record', label: 'Screening files (mock)', ref: 'HR-SCR' });
    const act = await svc.user('u-audit');
    const ev = (await svc.quality.register(act, { companyId: 'co-sasa' })).rows.find((r) => r.requirement.id === req)!.entry!.evidence[0];
    await expect(svc.quality.act(act, 'checkEvidence', { requirementId: req, companyId: 'co-sasa', evidenceId: ev.id, ok: true, note: 'Seen' })).rejects.toThrow(/placeholder/);
    await expect(svc.quality.act(act, 'editRequirement', { id: req, ref: 'Part 3', title: 'A future part (mock)', placeholder: false })).rejects.toThrow(/code text/);
    await svc.quality.act(act, 'editRequirement', { id: req, ref: 'Part 3', title: 'A future part (mock)', placeholder: false, note: 'Checked against Part 3 code text (mock)' });
    await svc.quality.act(act, 'checkEvidence', { requirementId: req, companyId: 'co-sasa', evidenceId: ev.id, ok: true, note: 'Screening files complete (mock)' });
    const row = (await svc.quality.register(act, { companyId: 'co-sasa' })).rows.find((r) => r.requirement.id === req)!;
    expect(row.state).toBe('checked');
    expect(row.requirement.history.length).toBe(1);
  });

  it('a gap opens an ACT finding (existing corrective action), and stays a gap until ACT closes it', async () => {
    const { svc } = fresh();
    const act = await svc.user('u-audit');
    await expect(svc.quality.act(act, 'raiseGap', { requirementId: iso('8.7'), companyId: 'co-sasa', note: 'No containment step recorded on complaints', ownerUserId: 'u-audit' })).rejects.toThrow(/owner/);
    const r = (await svc.quality.act(act, 'raiseGap', { requirementId: iso('8.7'), companyId: 'co-sasa', note: 'No containment step recorded on complaints', ownerUserId: 'u-cm-sasa', severity: 'medium' })) as {
      finding: { id: string; ref: string; area: string; status: string };
    };
    expect(r.finding.ref).toMatch(/^ACT-/);
    expect(r.finding.area).toBe('PATROL');
    const row = (await svc.quality.register(act, { companyId: 'co-sasa' })).rows.find((x) => x.requirement.id === iso('8.7'))!;
    expect(row.state).toBe('gap');
    expect(row.gaps[0].findingRef).toBe(r.finding.ref);
    // A company manager cannot raise gaps.
    await expect(svc.quality.act(await svc.user('u-cm-sasa'), 'raiseGap', { requirementId: iso('8.7'), companyId: 'co-sasa', note: 'x x x', ownerUserId: 'u-cm-sasa' })).rejects.toThrow(/Not allowed/);
  });

  it('Prima figures are filled by the server, not typed, and still need a check', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    await svc.quality.act(cm, 'linkEvidence', { requirementId: iso('7.2'), companyId: 'co-sasa', kind: 'prima_signal', label: 'All competent!', ref: 'fake' });
    const row = (await svc.quality.register(cm)).rows.find((r) => r.requirement.id === iso('7.2'))!;
    const ev = row.entry!.evidence.find((e) => e.kind === 'prima_signal')!;
    expect(ev.label).toMatch(/^Competency matrix on 2026-11-05: \d+ of \d+ staff/);
    expect(ev.label).not.toContain('All competent');
    expect(ev.check).toBeNull();
    await expect(svc.quality.act(cm, 'linkEvidence', { requirementId: iso('7.4'), companyId: 'co-sasa', kind: 'prima_signal', label: 'x' })).rejects.toThrow(/no figures/);
  });

  it('not applicable needs ACT and a reason; the state says so', async () => {
    const { svc } = fresh();
    const act = await svc.user('u-audit');
    await expect(svc.quality.act(await svc.user('u-cm-sasa'), 'setApplies', { requirementId: iso('7.1.5'), companyId: 'co-sasa', applies: false, note: 'No meters' })).rejects.toThrow(/Not allowed/);
    await svc.quality.act(act, 'setApplies', { requirementId: iso('7.1.5'), companyId: 'co-sasa', applies: false, note: 'No measuring equipment used (mock)' });
    const s = (await svc.quality.register(act, { companyId: 'co-sasa' })).rows.find((r) => r.requirement.id === iso('7.1.5'))!.state;
    expect(s).toBe('not_applicable');
  });

  it('qmsState: an old check needs review; a rejected item does not count', () => {
    const req = { placeholder: false } as QmsRequirement;
    const check = (ok: boolean, on: string) => ({ by: 'x', byId: 'x', at: myt(on, '10:00'), note: 'n', ok });
    const ev = (ok: boolean | null, on = '2025-01-01') => ({ id: 'e', kind: 'document' as const, label: 'l', ref: 'r', linkedBy: 'a', linkedById: 'a', at: myt(on, '09:00'), check: ok === null ? null : check(ok, on) });
    const base = { id: 'x', companyId: 'c', requirementId: 'r', applies: true, appliesNote: null, gaps: [], reviews: [] };
    expect(qmsState(req, { ...base, evidence: [ev(true)] }, [], TODAY).state).toBe('review_due');
    expect(qmsState(req, { ...base, evidence: [ev(false)] }, [], TODAY).state).toBe('unknown');
    expect(qmsState(req, { ...base, evidence: [ev(null)] }, [], TODAY).state).toBe('not_checked');
  });
});

describe('competency matrix', () => {
  it('reads licences from HR records and assessments; nobody types a credential twice', async () => {
    const { svc, ds } = fresh();
    const m = await svc.quality.matrix(await svc.user('u-cm-sasa'));
    expect(m.companyId).toBe('co-sasa');
    const guard = m.rows.find((r) => r.person.role === 'guard')!;
    const kdn = guard.items.find((i) => i.itemId === 'g-kdn')!;
    const has = ds.credentials.some((c) => c.personId === guard.person.id && (c.type === 'KDN_GUARD_CARD' || c.type === 'KDN_VETTING'));
    expect(kdn.state === 'missing').toBe(!has);
    expect(m.kpis.people).toBeGreaterThan(0);
    const cm = await svc.user('u-cm-sasa');
    await expect(svc.quality.act(cm, 'assess', { personId: guard.person.id, itemId: 'g-kdn', result: 'competent', method: 'certificate', note: 'Card seen' })).rejects.toThrow(/HR records/);
  });

  it('records an assessment with a refresher date; after a course it is also the training check', async () => {
    const { svc, ds } = fresh();
    const sv = await svc.user('u-sv-sasa');
    const g = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active' && !ds.compAssessments.some((a) => a.personId === p.id))!;
    const a = (await svc.quality.act(sv, 'assess', { personId: g.id, itemId: 'g-emerg', result: 'competent', method: 'practical', note: 'Ran the fire drill correctly (mock)', afterTraining: 'Fire drill course (mock)' })) as {
      nextDueOn: string;
    };
    expect(a.nextDueOn).toBe(addDays(TODAY, 365));
    const m = await svc.quality.matrix(sv);
    expect(m.rows.find((r) => r.person.id === g.id)!.items.find((i) => i.itemId === 'g-emerg')!.state).toBe('met');
    expect(m.kpis.trainingChecks).toBeGreaterThan(0);
    expect(m.kpis.assessedThisMonth).toBeGreaterThan(0);
    expect(m.kpis.trainingWorked).toBeLessThanOrEqual(m.kpis.trainingChecks);
  });

  it('each assessor only their own line; an officer sees and assesses guards only; never yourself', async () => {
    const { svc, ds } = fresh();
    const sv = await svc.user('u-sv-sasa');
    const m = await svc.quality.matrix(sv);
    expect(m.rows.every((r) => r.person.role === 'guard')).toBe(true);
    expect(m.byRole.filter((r) => r.role !== 'guard').every((r) => r.people === 0)).toBe(true);
    const office = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'office' && p.status === 'active')!;
    await expect(svc.quality.act(sv, 'assess', { personId: office.id, itemId: 'o-job', result: 'competent', method: 'interview', note: 'ok ok' })).rejects.toThrow(/Not allowed/);
    const arshGuard = ds.people.find((p) => p.companyId === 'co-arsh' && p.role === 'guard' && p.status === 'active')!;
    await expect(svc.quality.act(await svc.user('u-cm-sasa'), 'assess', { personId: arshGuard.id, itemId: 'g-post', result: 'competent', method: 'observation', note: 'ok ok' })).rejects.toThrow(/Not allowed/);
    // A user assessing their own record is refused.
    const self = { ...(await svc.user('u-cm-sasa')), personId: office.id };
    await expect(svc.quality.act(self, 'assess', { personId: office.id, itemId: 'o-job', result: 'competent', method: 'interview', note: 'I am good' })).rejects.toThrow(/themselves/);
    // Guards and admin executives cannot assess; guards cannot see the matrix.
    const guard = ds.users.find((u) => u.role === 'guard')!;
    await expect(svc.quality.matrix(guard)).rejects.toThrow(/Not allowed/);
    await expect(svc.quality.act(await svc.user('u-ae-arsh'), 'assess', { personId: arshGuard.id, itemId: 'g-post', result: 'competent', method: 'observation', note: 'ok ok' })).rejects.toThrow(/Not allowed/);
  });

  it('a new role profile is HR\'s proposal and the HR Director\'s decision, with a reason; the matrix uses the approved one', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const items = [
      { id: 'g-kdn', label: 'KDN guard card, or vetting submitted', kind: 'credential', credentialTypes: ['KDN_GUARD_CARD', 'KDN_VETTING'] },
      { id: 'g-new', label: 'Body camera use (mock)', kind: 'skill', refreshMonths: 6 },
    ];
    await expect(svc.quality.act(await svc.user('u-cm-sasa'), 'proposeProfile', { role: 'guard', items, note: 'x x x' })).rejects.toThrow(/Not allowed/);
    const p = (await svc.quality.act(hr, 'proposeProfile', { role: 'guard', items, note: 'Add body camera skill (mock)' })) as { id: string; version: number };
    expect(p.version).toBe(2);
    await expect(svc.quality.act(hr, 'proposeProfile', { role: 'guard', items, note: 'again' })).rejects.toThrow(/already waiting/);
    await expect(svc.quality.act(hr, 'decideProfile', { id: p.id, agree: true, note: 'ok ok' })).rejects.toThrow(/Not allowed/);
    const cos = await svc.user('u-cos');
    await expect(svc.quality.act(cos, 'decideProfile', { id: p.id, agree: true, note: '' })).rejects.toThrow(/reason/);
    await svc.quality.act(cos, 'decideProfile', { id: p.id, agree: true, note: 'Body cameras issued from January (mock)' });
    const m = await svc.quality.matrix(await svc.user('u-cm-sasa'));
    const g = m.rows.find((r) => r.person.role === 'guard')!;
    expect(g.items.map((i) => i.itemId)).toEqual(['g-kdn', 'g-new']);
    expect(m.profiles.filter((x) => x.role === 'guard').map((x) => x.status)).toEqual(['approved']);
  });

  it('home shows one grouped line per person, only for their own work', async () => {
    const { svc } = fresh();
    const actItems = await svc.quality.homeItems(await svc.user('u-act-aud1'));
    expect(actItems.some((i) => /evidence to check/.test(i.title))).toBe(true);
    const guardHome = await svc.quality.homeItems({ id: 'g', name: 'g', title: 'g', role: 'guard', companyIds: ['co-sasa'], siteIds: [] });
    expect(guardHome).toEqual([]);
  });
});

describe('QMS foundation: scope, policy, issues, parties, processes', () => {
  it('the CEO decides scope and policy with a reason, never on a version they drafted; the old one stays in force until then', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const f = await svc.quality.foundation(ceo);
    const draft = f.rows.find((r) => r.item.kind === 'policy' && r.item.status === 'draft')!;
    expect(draft.canDecide).toBe(true);
    await expect(svc.quality.act(await svc.user('u-audit'), 'decideFoundation', { id: draft.item.id, agree: true, note: 'ok ok' })).rejects.toThrow(/Not allowed/);
    await expect(svc.quality.act(ceo, 'decideFoundation', { id: draft.item.id, agree: true, note: '' })).rejects.toThrow(/reason/);
    await svc.quality.act(ceo, 'decideFoundation', { id: draft.item.id, agree: true, note: 'Clear and short (mock)' });
    // A change to the agreed scope is a new draft; version 1 stays in force.
    const cos = await svc.user('u-cos');
    const v2 = (await svc.quality.act(cos, 'saveFoundation', { id: 'qf-scope-v1', kind: 'scope', title: 'Scope (mock)', body: 'Guarding, patrol, CMS and cleaning services of the group (mock text for testing).', note: 'Add cleaning (mock)' })) as {
      id: string;
      version: number;
      status: string;
    };
    expect(v2).toMatchObject({ version: 2, status: 'draft' });
    const after = await svc.quality.foundation(cos);
    expect(after.rows.filter((r) => r.item.kind === 'scope').map((r) => r.item.status).sort()).toEqual(['approved', 'draft']);
    expect(after.kpis.scopeApproved).toBe(true);
    await svc.quality.act(ceo, 'decideFoundation', { id: v2.id, agree: true, note: 'Cleaning is now a service (mock)' });
    const done = await svc.quality.foundation(ceo);
    expect(done.rows.filter((r) => r.item.kind === 'scope').map((r) => `${r.item.version}:${r.item.status}`).sort()).toEqual(['1:replaced', '2:approved']);
  });

  it('issues, parties and processes are working lists with no approval; a process needs an owner; company managers only read what is in force', async () => {
    const { svc } = fresh();
    const act = await svc.user('u-audit');
    await expect(svc.quality.act(act, 'saveFoundation', { kind: 'process', title: 'Billing (mock)', body: 'x' })).rejects.toThrow(/owner/);
    const p = (await svc.quality.act(act, 'saveFoundation', { kind: 'process', title: 'Billing (mock)', body: 'Invoice to receipt', ownerTitle: 'Company Manager', requirementIds: ['qr-iso9001-8-2', 'not-a-req'] })) as {
      status: string;
      requirementIds: string[];
    };
    expect(p.status).toBe('active');
    expect(p.requirementIds).toEqual(['qr-iso9001-8-2']);
    await expect(svc.quality.act(await svc.user('u-cm-sasa'), 'saveFoundation', { kind: 'issue', title: 'x x x', body: 'y' })).rejects.toThrow(/Not allowed/);
    const cm = await svc.quality.foundation(await svc.user('u-cm-sasa'));
    expect(cm.rows.every((r) => r.item.status === 'approved' || r.item.status === 'active')).toBe(true);
    expect(cm.rows.every((r) => !r.canEdit && !r.canDecide)).toBe(true);
    await expect(svc.quality.foundation({ id: 'g', name: 'g', title: 'g', role: 'guard', companyIds: ['co-sasa'], siteIds: [] })).rejects.toThrow(/Not allowed/);
    // The register shows the foundation figures next to clause 4 and 5 rows.
    const reg = await svc.quality.register(act, { companyId: 'co-sasa' });
    expect(reg.rows.find((r) => r.requirement.ref === '4.4')!.signal).toMatch(/processes/);
  });
});

describe('staff ease (review, 5 Nov 2026)', () => {
  it('an officer gets one grouped line for guards to check again, and none of the clause lists', async () => {
    const { svc, ds } = fresh();
    const sv = await svc.user('u-sv-sasa');
    const g = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active' && !ds.compAssessments.some((a) => a.personId === p.id))!;
    await svc.quality.act(sv, 'assess', { personId: g.id, itemId: 'g-emerg', result: 'not_yet', method: 'practical', note: 'Did not know the assembly point (mock)' });
    const items = await svc.quality.homeItems(sv);
    const line = items.find((i) => i.tag === 'Guard skills')!;
    expect(line.title).toMatch(/guards? to check at work again/);
    expect(items.filter((i) => i.tag === 'Guard skills').length).toBe(1);
    await expect(svc.quality.register(sv, {})).rejects.toThrow(/Not allowed/);
    await expect(svc.quality.foundation(sv)).rejects.toThrow(/Not allowed/);
  });
});
