import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Central Admin 5D (Fauzan, 2 Nov 2026): staff key in the audit, law and secretary firms. Central Admin keeps audit and
// secretary firms, PWVSB legal keeps law firms; yearly review; a firm taken off stays on record. Dummy data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
};

describe('Panel firms (5D)', () => {
  it('lets each keeper add only their kind of firm, and nobody outside the walls see the list', async () => {
    const { svc } = fresh();
    const dcos = await svc.user('u-dcos');
    const legal = await svc.user('u-legal');
    const input = {
      name: 'Law firm Z (mock)',
      regNo: 'LF-1 (mock)',
      appointedOn: '2026-01-10',
    };
    await expect(svc.addPanelFirm(dcos, { kind: 'LAW', ...input })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.addPanelFirm(legal, { kind: 'AUDIT', ...input })).rejects.toBeInstanceOf(AccessDenied);
    const f = await svc.addPanelFirm(legal, { kind: 'LAW', ...input });
    expect(f).toMatchObject({ status: 'active', reviewOn: '2027-01-10' });
    await expect(svc.addPanelFirm(legal, { kind: 'LAW', ...input })).rejects.toThrow(/already on the panel/);
    await expect(
      svc.addPanelFirm(dcos, {
        kind: 'AUDIT',
        name: 'Audit firm 9 (mock)',
        regNo: '',
        appointedOn: '2026-01-10',
      }),
    ).rejects.toThrow(/registration/);
    for (const id of ['u-fwm-ex1', 'u-pwvsb-hr', 'u-transport']) await expect(svc.panelBoard(await svc.user(id))).rejects.toBeInstanceOf(AccessDenied);
    // The company secretary views; it keeps nothing.
    const sec = await svc.panelBoard(await svc.user('u-cosec'));
    expect(Object.values(sec.canKeep).every((v) => !v)).toBe(true);
  });

  it('checks audits against the list staff keep, and takes a firm off with a reason, keeping its record', async () => {
    const { svc, store } = fresh();
    const dcos = await svc.user('u-dcos');
    const before = await svc.corpAuditLegal(dcos);
    const firm = before.audits[0].audit.auditorFirm;
    expect(before.audits[0].onPanel).toBe(true);
    const row = (await svc.panelBoard(dcos)).firms.find((r) => r.firm.name === firm)!;
    await expect(svc.panelFirmStep(dcos, row.firm.id, 'remove', '')).rejects.toThrow(/why/);
    await svc.panelFirmStep(dcos, row.firm.id, 'remove', 'Independence concern (mock)');
    const after = await svc.corpAuditLegal(dcos);
    expect(after.audits.filter((a) => a.audit.auditorFirm === firm).every((a) => !a.onPanel)).toBe(true);
    expect((await store.get('panelFirms', row.firm.id))!.status).toBe('removed');
    const log = (await store.list('audit', {})).filter((a) => a.action.startsWith('panel.'));
    expect(log.map((a) => a.action)).toEqual(['panel.remove']);
  });

  it('puts a firm due for its yearly review on the keeper’s home, and the review moves the date on', async () => {
    const { svc } = fresh();
    const dcos = await svc.user('u-dcos');
    const h = await svc.home(dcos);
    expect(JSON.stringify(h)).toMatch(/due for the yearly review/);
    const due = (await svc.panelBoard(dcos)).firms.find((r) => r.reviewDue)!;
    const f = await svc.panelFirmStep(dcos, due.firm.id, 'review', 'Fees and independence checked');
    expect(f.reviewOn).toBe('2027-11-02');
    expect(JSON.stringify(await svc.home(dcos))).not.toMatch(/due for the yearly review/);
  });

  it('shows mandates ending within 90 days for renewal', async () => {
    const { svc, store } = fresh();
    const m = (await store.list('govMandates', {})).find((x) => x.validTo && !x.terminated && x.companyConfirm && x.legalVerify)!;
    await store.update('govMandates', m.id, { validTo: '2027-01-20' });
    const b = await svc.govBoard(await svc.user('u-legal'));
    const row = JSON.stringify(b);
    expect(row).toContain(m.id);
    expect(JSON.stringify(await svc.home(await svc.user('u-cos')))).toMatch(/ends in 79 days/);
  });
});
