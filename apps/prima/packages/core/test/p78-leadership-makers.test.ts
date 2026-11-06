import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// P78 (Agentic Office): the owner, signed in as Prima's CEO record, is master administrator. He may enter the maker
// steps on the leadership screens (meeting action items, company files, office desks); checks stay with their people
// and nobody checks their own entry. Dummy data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
const fresh = (drop?: (ds: ReturnType<typeof generateDataset>) => void) => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  drop?.(ds);
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
};

describe('P78 owner maker steps: meetings', () => {
  it('lets whoever runs the meeting add an action item after the minutes, with an audit line; others are refused', async () => {
    const { svc, store } = fresh();
    const ceo = await svc.user('u-fauzan');
    // A coming meeting has no minutes yet, so no action items either.
    const later = (await svc.meetings(ceo)).rows.find((r) => r.meeting.status === 'scheduled' && !r.meeting.summary)!;
    await expect(svc.addMeetingAction(ceo, later.meeting.id, { text: 'Fix the gate lock', owner: 'Site officer' })).rejects.toThrow(/minutes first/);
    expect((await svc.meetings(ceo)).canSchedule).toBe(true);
    const m = await svc.addMeetingAction(ceo, 'mt-arsh-ops', { text: 'Order new torch batteries', owner: 'Admin executive', due: '2026-11-09' });
    expect(m.summary!.actions.at(-1)).toEqual({ text: 'Order new torch batteries', owner: 'Admin executive', due: '2026-11-09', done: false });
    await expect(svc.addMeetingAction(ceo, 'mt-arsh-ops', { text: 'x', owner: 'A' })).rejects.toThrow(/what has to be done/);
    await expect(svc.addMeetingAction(ceo, 'mt-arsh-ops', { text: 'Valid text', owner: '' })).rejects.toThrow(/who does it/);
    await expect(svc.addMeetingAction(ceo, 'mt-arsh-ops', { text: 'Valid text', owner: 'A', due: '2026-02-30' })).rejects.toThrow(/real date/);
    await expect(svc.addMeetingAction(await svc.user('u-cm-sasa'), 'mt-arsh-ops', { text: 'Valid text', owner: 'A' })).rejects.toBeInstanceOf(AccessDenied);
    const log = await store.list('audit', { entityId: 'mt-arsh-ops' });
    expect(log.some((a) => a.action === 'meeting.action.add' && a.actor === ceo.name)).toBe(true);
  });
});

describe('P78 owner maker steps: company file', () => {
  it('lets the owner start a missing file and edit it; the Deputy Chief of Staff checks it, never the owner', async () => {
    const { svc, store } = fresh((ds) => {
      ds.corpProfiles = ds.corpProfiles.filter((p) => p.companyId !== 'co-sasa');
    });
    const ceo = await svc.user('u-fauzan');
    const dcos = await svc.user('u-dcos');
    const input = {
      regNo: '202001012345 (mock)',
      incorporatedOn: '2020-01-01',
      fyeMonth: 12,
      secretaryFirm: 'Secretary firm (mock)',
      secretaryLicence: 'LS0001 (mock)',
      auditor: 'Audit firm (mock)',
      directors: [{ name: 'Director A (mock)', appointedOn: '2020-01-01' }],
    };
    await expect(svc.startCompanyFile(ceo, 'co-sasa', { ...input, directors: [] })).rejects.toThrow(/at least one director/);
    await expect(svc.startCompanyFile(ceo, 'co-sasa', { ...input, incorporatedOn: '2099-01-01' })).rejects.toThrow(/future/);
    await expect(svc.startCompanyFile(ceo, 'co-sasa', { ...input, fyeMonth: 13 })).rejects.toThrow(/month/);
    await expect(svc.startCompanyFile(await svc.user('u-coo'), 'co-sasa', input)).rejects.toThrow();
    const p = await svc.startCompanyFile(ceo, 'co-sasa', input);
    expect(p.file).toMatchObject({ status: 'draft', draftById: 'u-fauzan' });
    await expect(svc.startCompanyFile(ceo, 'co-sasa', input)).rejects.toThrow(/already has a file/);
    const [mine] = await svc.companyFiles(ceo, 'co-sasa');
    expect(mine.can).toEqual({ edit: true, check: false });
    await expect(svc.checkCompanyFile(ceo, 'co-sasa', { ok: true, ssmRef: 'EXTRACT (mock)', note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.saveCompanyFile(ceo, 'co-sasa', { auditor: 'Another audit firm (mock)' });
    const [forDcos] = await svc.companyFiles(dcos, 'co-sasa');
    expect(forDcos.can.check).toBe(true);
    const checked = await svc.checkCompanyFile(dcos, 'co-sasa', { ok: true, ssmRef: 'EXTRACT (mock)', note: 'Matches the extract' });
    expect(checked.file?.status).toBe('checked');
    const log = await store.list('audit', { entityId: 'cp-co-sasa' });
    expect(log.some((a) => a.action === 'corp.file.start' && a.actor === ceo.name)).toBe(true);
  });
});

describe('P78 owner maker steps: company office desks', () => {
  it('lets the owner share out desks; other group leaders only monitor', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    expect((await svc.companyOffice(ceo, 'co-arsh')).canAssign).toBe(true);
    expect((await svc.companyOffice(await svc.user('u-coo'), 'co-arsh')).canAssign).toBe(false);
    const r = await svc.setOfficeDesks(ceo, 'co-arsh', { desks: [{ desk: 'people', ownerUserId: 'u-ae-arsh', backupUserId: 'u-ae-arsh-2' }], note: 'Owner split' });
    expect(r.changed).toBe(1);
    await expect(
      svc.setOfficeDesks(await svc.user('u-coo'), 'co-arsh', { desks: [{ desk: 'people', ownerUserId: 'u-ae-arsh-2', backupUserId: 'u-ae-arsh' }] }),
    ).rejects.toThrow(/Not allowed/);
  });
});
