import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, RULES, applyAlertPrefs, generateDataset, isSafetyAlert, myt, type AlertItem } from '../src';

// J6 (Fauzan, 11 Nov 2026): staff choose which alerts they receive; urgent safety alerts cannot be switched off.
// Synthetic data only.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '09:00');
const item = (tag: string, tone: AlertItem['tone']): AlertItem => ({ key: `${tag}-${tone}`, tag, tone, title: 't', detail: '', view: 'home' });

describe('J6 alert choices', () => {
  const items = [item('Leave', 'crit'), item('Leave', 'warn'), item('Finance', 'info'), item('Arms', 'crit'), item('No guard', 'crit'), item('Arms', 'warn')];

  it('applies the choices per channel and never drops an urgent safety alert', () => {
    expect(RULES.alertSafetyLocked.value.tags).toEqual(expect.arrayContaining(['Arms', 'No guard', 'Incidents', 'PDPA breach']));
    expect(isSafetyAlert(item('Arms', 'crit'))).toBe(true);
    expect(isSafetyAlert(item('Arms', 'warn'))).toBe(false);
    // Defaults: today's behaviour.
    expect(applyAlertPrefs(items, null, 'urgent')).toHaveLength(items.length);
    // Urgent email off: only the urgent safety alerts.
    expect(applyAlertPrefs(items, { urgent: false, digest: true, muted: [] }, 'urgent').map((i) => i.key)).toEqual(['Arms-crit', 'No guard-crit']);
    // Digest off: nothing in the digest (the urgent safety alerts still go out as urgent).
    expect(applyAlertPrefs(items, { urgent: true, digest: false, muted: [] }, 'digest')).toEqual([]);
    // A muted topic leaves email and the bell; a safety topic in the muted list never hides its urgent alerts.
    const muted = { urgent: true, digest: true, muted: ['Leave', 'Arms'] };
    expect(applyAlertPrefs(items, muted, 'bell').map((i) => i.key)).toEqual(['Finance-info', 'Arms-crit', 'No guard-crit']);
  });

  it('saves only the person\'s own choices and refuses to mute a safety topic', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const store = new MemoryStore(ds);
    const svc = new PrimaService(store, () => NOW);
    const me = await svc.user('u-transport');
    const before = await svc.myAlertPrefs(me);
    expect(before).toMatchObject({ ready: true, urgent: true, digest: true, muted: [] });
    expect(before.topics.find((t) => t.tag === 'Arms')?.safety).toBe(true);
    await expect(svc.setMyAlertPrefs(me, { urgent: true, digest: true, muted: ['No guard'] })).rejects.toThrow(/cannot be switched off/);
    await svc.setMyAlertPrefs(me, { urgent: false, digest: true, muted: ['Leave', 'Finance'] });
    expect(await svc.myAlertPrefs(me)).toMatchObject({ urgent: false, muted: ['Finance', 'Leave'] });
    // Someone else's choices are untouched; a guard has no alerts to choose.
    expect((await svc.myAlertPrefs(await svc.user('u-coo'))).urgent).toBe(true);
    await expect(svc.setMyAlertPrefs(await svc.user(ds.users.find((u) => u.role === 'guard')!.id), { urgent: false, digest: false, muted: [] })).rejects.toThrow(/staff sign-ins/);
    expect((await store.list('audit', {})).filter((a) => a.action === 'alerts.prefs')).toHaveLength(1);
  });
});
