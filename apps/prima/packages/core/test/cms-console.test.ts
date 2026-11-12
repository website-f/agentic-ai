import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// E7 (Fauzan, 11 Nov 2026): who opens the CMS console from Prima, under which roster name. Synthetic data only.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '09:00');

describe('E7 CMS console sign-in from Prima', () => {
  it('lets roster staff with their own account in under the roster name, and Arms Control under their own', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const store = new MemoryStore(ds);
    const svc = new PrimaService(store, () => NOW);
    const head = await svc.user('u-cms-head');
    const p = await svc.cmsConsoleSignIn(head, 'microsoft');
    const roster = ds.cmsStaff.find((s) => s.userId === 'u-cms-head')!;
    expect(p).toMatchObject({ sub: 'u-cms-head', name: roster.name, as: 'roster' });
    expect(p.posts).toContain('HEAD_CONTROL');
    expect(await svc.cmsConsoleSignIn(await svc.user('u-pwvsb-arms'), 'office')).toMatchObject({ as: 'arms_control', posts: [] });
    const audit = (await store.list('audit', {})).filter((a) => a.action === 'cms.console.sign_in');
    expect(audit.map((a) => a.summary)).toEqual([`${roster.name} opened the CMS console (CMS roster; signed in to Prima via microsoft).`, expect.stringContaining('Arms Control; signed in to Prima via office')]);
  });

  it('refuses people not on the roster, a roster entry switched off, and guards', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const store = new MemoryStore(ds);
    const svc = new PrimaService(store, () => NOW);
    for (const id of ['u-cm-sasa', 'u-transport', 'u-coo', ds.users.find((u) => u.role === 'guard')!.id])
      await expect(svc.cmsConsoleSignIn(await svc.user(id), 'microsoft')).rejects.toBeInstanceOf(AccessDenied);
    const roster = ds.cmsStaff.find((s) => s.userId === 'u-cms-head-b')!;
    await store.update('cmsStaff', roster.id, { active: false });
    await expect(svc.cmsConsoleSignIn(await svc.user('u-cms-head-b'), 'microsoft')).rejects.toBeInstanceOf(AccessDenied);
  });
});
