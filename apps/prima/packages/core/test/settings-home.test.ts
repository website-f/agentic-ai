// J7 (Fauzan, 11 Nov 2026): one Settings home listing each setting screen, who owns it, and whether it is set yet.
// Synthetic data only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

const TODAY = '2026-11-12';
const NOW = myt(TODAY, '09:00');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc };
}
const row = (h: Awaited<ReturnType<PrimaService['settingsHome']>>, id: string) => h.rows.find((r) => r.id === id)!;

describe('J7: the Settings home', () => {
  it('lists every setting the handover names, each with an owner and a screen or an honest "no screen"', async () => {
    const { svc } = fresh();
    const h = await svc.settingsHome(await svc.user('u-fauzan'));
    const ids = h.rows.map((r) => r.id);
    for (const id of [
      'rates.it',
      'rates.fwcost',
      'rates.fees',
      'rates.claims',
      'rates.vehicles',
      'rates.quotation',
      'pay.formulas',
      'pay.law',
      'pay.statutory',
      'pay.allowances',
      'holidays.staff',
      'holidays.guards',
      'people.directory',
      'people.desks',
      'people.cms',
      'limits.approval',
      'connections.mail',
      'connections.powerbi',
    ])
      expect(ids).toContain(id);
    for (const r of h.rows) {
      expect(r.owner.length).toBeGreaterThan(1);
      expect(r.view !== null || r.state === 'no_screen').toBe(true);
      // Never an amount: the home shows counts and dates only.
      expect(r.detail).not.toMatch(/RM\s?\d/);
    }
    expect(row(h, 'holidays.guards').dueOn).toBe('2026-12-10');
    expect(row(h, 'holidays.guards').title).toBe('Guard public holiday lists 2027');
    expect(row(h, 'connections.mail').state).toBe('server_off');
    expect(row(h, 'people.cms').state).toBe('no_screen');
    expect(row(h, 'rates.quotation').state).toBe('no_screen');
  });

  it('shows "Not set" until something is entered, and "Set" after', async () => {
    const { svc, ds } = fresh();
    const ceo = await svc.user('u-fauzan');
    expect(row(await svc.settingsHome(ceo), 'limits.approval').state).toBe('later');
    ds.publicHolidays = ds.publicHolidays.filter((x) => !x.date.startsWith('2027-'));
    expect(row(await svc.settingsHome(ceo), 'holidays.staff').state).toBe('not_set');
    ds.publicHolidays.push({ ...ds.publicHolidays[0], id: 'ph-syn-2027', date: '2027-01-01' } as never);
    const h = await svc.settingsHome(ceo);
    expect(row(h, 'holidays.staff')).toMatchObject({ state: 'set', detail: '1 holiday entered for 2027' });
    expect(h.counts.set + h.counts.notSet + h.counts.notInstalled + h.counts.later + h.counts.serverOff + h.counts.noScreen + h.counts.ownerOnly).toBe(h.rows.length);
  });

  it('shows a setting\'s state only to its owner and group leadership; others see who keeps it', async () => {
    const { svc } = fresh();
    const hr = await svc.settingsHome(await svc.user('u-pwvsb-hr'));
    expect(row(hr, 'pay.allowances').state).not.toBe('owner_only');
    expect(row(hr, 'rates.it')).toMatchObject({ state: 'owner_only', owner: 'the IT Manager' });
    const cm = await svc.settingsHome(await svc.user('u-cm-arsh'));
    expect(row(cm, 'rates.fwcost').state).toBe('owner_only');
    expect(row(cm, 'people.desks').state).not.toBe('owner_only');
  });

  it('refuses a guard, an officer, a site device and a system feed', async () => {
    const { svc, ds } = fresh();
    for (const role of ['guard', 'supervisor', 'site_device'] as const) {
      const u = ds.users.find((x) => x.role === role)!;
      expect(u).toBeTruthy();
      await expect(svc.settingsHome(await svc.user(u.id))).rejects.toBeInstanceOf(AccessDenied);
    }
    const feed = ds.users.find((x) => x.integration)!;
    await expect(svc.settingsHome(await svc.user(feed.id))).rejects.toBeInstanceOf(AccessDenied);
  });
});
