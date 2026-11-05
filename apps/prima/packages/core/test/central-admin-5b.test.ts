import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Central Admin 5B (Fauzan, 2 Nov 2026): one company file per company behind the corporate wall. The Head of Company or
// Central Admin drafts it; the Deputy Chief of Staff checks it against the SSM extract, never their own draft. A
// beneficial owner change not notified to SSM within 14 days is flagged. Dummy data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const clock = { now: NOW };
  return { ds, store, clock, svc: new PrimaService(store, () => clock.now) };
};

describe('Company file (5B)', () => {
  it('lets the Head of Company draft and only someone else check, with the SSM reference and a reason', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const dcos = await svc.user('u-dcos');
    const p = await svc.saveCompanyFile(cm, 'co-sasa', {
      directors: [{ name: 'Director X (mock)', appointedOn: '2020-01-01' }],
      shareholders: [
        {
          name: 'Holding company (mock)',
          kind: 'company',
          shares: 1000,
          since: '2020-01-01',
        },
      ],
      beneficialOwners: [
        {
          name: 'Owner Y (mock)',
          basis: 'Over 25% of shares through the holding company',
          since: '2020-01-01',
          ssmNotifiedOn: '2020-01-10',
        },
      ],
      constitution: { adopted: true, ref: 'CONST-1 (mock)', on: '2020-01-01' },
    });
    expect(p.file).toMatchObject({ status: 'draft', draftById: 'u-cm-sasa' });
    let [f] = await svc.companyFiles(dcos, 'co-sasa');
    expect(f.can.check).toBe(true);
    await expect(
      svc.checkCompanyFile(dcos, 'co-sasa', {
        ok: true,
        ssmRef: '',
        note: 'ok',
      }),
    ).rejects.toThrow(/SSM extract/);
    await expect(
      svc.checkCompanyFile(dcos, 'co-sasa', {
        ok: true,
        ssmRef: 'EXTRACT-1 (mock)',
      }),
    ).rejects.toThrow(/reason/);
    await expect(
      svc.checkCompanyFile(dcos, 'co-sasa', {
        ok: false,
        ssmRef: 'EXTRACT-1 (mock)',
      }),
    ).rejects.toThrow(/does not match/);
    await expect(
      svc.checkCompanyFile(cm, 'co-sasa', {
        ok: true,
        ssmRef: 'X',
        note: 'mine',
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await svc.checkCompanyFile(dcos, 'co-sasa', {
      ok: false,
      ssmRef: 'EXTRACT-1 (mock)',
      mismatches: ['Director appointment date differs'],
    });
    const home = await svc.home(cm, 'co-sasa');
    expect(JSON.stringify(home)).toMatch(/company file differs from SSM/);
    // The DCoS fixes and saves the draft: now the DCoS cannot check their own draft.
    await svc.saveCompanyFile(dcos, 'co-sasa', {
      directors: [{ name: 'Director X (mock)', appointedOn: '2020-01-02' }],
    });
    [f] = await svc.companyFiles(dcos, 'co-sasa');
    expect(f.can.check).toBe(false);
    await expect(
      svc.checkCompanyFile(dcos, 'co-sasa', {
        ok: true,
        ssmRef: 'EXTRACT-2 (mock)',
        note: 'ok',
      }),
    ).rejects.toThrow(/other than/);
    // The Head of Company saves again; the DCoS confirms.
    await svc.saveCompanyFile(cm, 'co-sasa', {
      auditor: 'Audit firm 2 (mock)',
    });
    await svc.checkCompanyFile(dcos, 'co-sasa', {
      ok: true,
      ssmRef: 'EXTRACT-2 (mock)',
      note: 'Matches the extract',
    });
    const saved = (await store.list('corpProfiles', { companyId: 'co-sasa' }))[0];
    expect(saved.file).toMatchObject({
      status: 'checked',
      checkedById: 'u-dcos',
      ssmRef: 'EXTRACT-2 (mock)',
    });
    expect(saved.directors[0].appointedOn).toBe('2020-01-02');
    const log = (await store.list('audit', {})).filter((a) => a.action.startsWith('corp.file.'));
    expect(log.map((a) => a.action)).toEqual(['corp.file.save', 'corp.file.mismatch', 'corp.file.save', 'corp.file.save', 'corp.file.checked']);
  });

  it('refuses people outside the corporate wall and staff who only view', async () => {
    const { svc } = fresh();
    for (const id of ['u-fwm-ex1', 'u-pwvsb-hr', 'u-transport']) await expect(svc.companyFiles(await svc.user(id))).rejects.toBeInstanceOf(AccessDenied);
    // Another company's manager cannot even see that the company exists.
    await expect(
      svc.saveCompanyFile(await svc.user('u-cm-arsh'), 'co-sasa', {
        auditor: 'x',
      }),
    ).rejects.toThrow(/not found/i);
    // An admin executive of the company sees the file but does not keep it; the company secretary views only.
    await expect(
      svc.saveCompanyFile(await svc.user('u-bm-sasa-1'), 'co-sasa', {
        auditor: 'x',
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.saveCompanyFile(await svc.user('u-cosec'), 'co-sasa', {
        auditor: 'x',
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    const sec = await svc.companyFiles(await svc.user('u-cosec'));
    expect(sec.every((f) => !f.can.edit && !f.can.check)).toBe(true);
  });

  it('flags a beneficial owner not notified to SSM within 14 days, and a file older than a recorded structure change', async () => {
    const { svc, clock } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const dcos = await svc.user('u-dcos');
    await expect(
      svc.saveCompanyFile(cm, 'co-sasa', {
        beneficialOwners: [
          {
            name: 'Z',
            basis: 'shares',
            since: '2026-10-01',
            ssmNotifiedOn: '2026-09-01',
          },
        ],
      }),
    ).rejects.toThrow(/before the change/);
    await expect(
      svc.saveCompanyFile(cm, 'co-sasa', {
        beneficialOwners: [
          {
            name: 'Z',
            basis: 'shares',
            since: '2026-12-01',
            ssmNotifiedOn: null,
          },
        ],
      }),
    ).rejects.toThrow(/future/);
    await svc.saveCompanyFile(cm, 'co-sasa', {
      beneficialOwners: [
        {
          name: 'Late owner (mock)',
          basis: 'Over 25% of votes',
          since: '2026-10-01',
          ssmNotifiedOn: null,
        },
        {
          name: 'New owner (mock)',
          basis: 'Right to appoint directors',
          since: '2026-10-30',
          ssmNotifiedOn: null,
        },
      ],
    });
    // Directors see the late owner as a legal flag; the company manager sees both owners as tasks (review, 2 Nov 2026).
    const [f] = await svc.companyFiles(await svc.user('u-cos'), 'co-sasa');
    expect(f.boLate.map((b) => b.name)).toEqual(['Late owner (mock)']);
    expect(f.boLate[0].dueOn).toBe('2026-10-15');
    expect(f.boDue.map((b) => b.name)).toEqual(['New owner (mock)']);
    const [mine] = await svc.companyFiles(cm, 'co-sasa');
    expect(mine.boLate).toEqual([]);
    expect(mine.boDue.map((b) => b.name)).toEqual(['Late owner (mock)', 'New owner (mock)']);
    const lead = JSON.stringify(await svc.directorLegalFlags(await svc.user('u-cos')));
    expect(lead).toMatch(/beneficial owner Late owner \(mock\) not notified to SSM/);
    clock.now = myt(TODAY, '11:00');
    // A director change approved and recorded by the board after the file was saved: the file needs updating.
    const c = await svc.raiseCorpChange(cm, 'co-sasa', {
      kind: 'DIRECTOR',
      title: 'Appoint Director W (mock)',
      detail: '',
    });
    await svc.decideCorpChange(dcos, c.id, 'approve', 'In line with the mandate', 'Clause 4.2 (mock)');
    await svc.recordCorpBoard(cm, c.id, 'BR-9 (mock)', '2026-11-01');
    const [g] = await svc.companyFiles(cm, 'co-sasa');
    expect(g.stale.map((s) => s.title)).toEqual(['Appoint Director W (mock)']);
    expect(JSON.stringify(await svc.home(cm, 'co-sasa'))).toMatch(/update the company file/);
  });
});
