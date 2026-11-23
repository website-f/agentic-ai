import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_ACTIONS,
  GOV_OPS_COMPANY_ID,
  MemoryStore,
  PrimaService,
  assistantActionsFor,
  assistantAllowed,
  assistantDates,
  assistantItems,
  assistantMayPublish,
  assistantUnderstand,
  emptyStyle,
  generateDataset,
  myt,
} from '../src';

// The Prima agent (Fauzan, 23 Nov 2026: "Make sure ai agent can help with everything. Like start new inventory request
// when ogm instructed"; "Make sure agent know what to do on everything and can help the staff to do it"). Fixed rules
// only; synthetic data only.
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
const G = GOV_OPS_COMPANY_ID;
const GUARD_SITE = 'st-sasa-011';
const TROUSERS = `stk-${G}-uni-3`;

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const site = ds.sites.find((s) => s.id === GUARD_SITE)!;
  return { ds, store, svc, site, a: svc.assistant, im: await svc.user('u-proc-manager'), om: await svc.user('u-om-klang'), ogm: await svc.user('u-ogm'), sk: await svc.user('u-proc-store1') };
}

describe('Understanding plain words (fixed rules)', () => {
  it('reads dates in Malay and English', () => {
    expect(assistantDates('cuti esok hingga lusa', TODAY)).toEqual(['2026-11-24', '2026-11-25']);
    expect(assistantDates('meeting on 25 Nov', TODAY)).toEqual(['2026-11-25']);
    expect(assistantDates('dari 1/12 hingga 3/12', TODAY)).toEqual(['2026-12-01', '2026-12-03']);
  });

  it('reads quantities and store items, size included', () => {
    const items = [
      { id: 'a', name: 'Uniform trousers (32)', size: '32' },
      { id: 'b', name: 'Uniform trousers (34)', size: '34' },
      { id: 'c', name: 'Belt', size: null },
    ];
    const got = assistantItems('20 seluar trousers saiz 32 dan 5 belt', items);
    expect(got.map((x) => [x.stockItemId, x.qty])).toEqual([
      ['a', 20],
      ['c', 5],
    ]);
  });

  it('never swaps a size the store does not have for another size', () => {
    expect(assistantItems('2 seluar saiz 34', [{ id: 'a', name: 'Uniform trousers (32)', size: '32' }])).toEqual([]);
    expect(assistantItems('2 seluar saiz 32', [{ id: 'a', name: 'Uniform trousers (32)', size: '32' }])).toEqual([{ stockItemId: 'a', qty: 2, said: 'trousers' }]);
  });

  it('fills a leave form and marks what came from the words', () => {
    const d = assistantUnderstand({ text: 'Saya nak cuti tahunan esok hingga lusa sebab urusan keluarga', today: TODAY, actions: ASSISTANT_ACTIONS, skills: [], style: null, lists: {}, actionId: null });
    expect(d.actionId).toBe('leave');
    expect(d.values).toMatchObject({ kind: 'ANNUAL', from: '2026-11-24', to: '2026-11-25' });
    expect(d.missing).toEqual([]);
  });

  it('a skill fills the usual choices; a person\'s own words for an item are learned', () => {
    const skill = { id: 's1', scope: 'team' as const, owner: 'dept:procurement', name: 'New site start-up', words: ['tapak baharu', 'new site'], actionId: 'site-supplies', values: { forNewSite: true }, note: '', by: 'x', byId: 'x', at: NOW, retired: null };
    const style = { ...emptyStyle('u', NOW), words: [{ field: 'items', said: 'pants', value: 'a', label: 'Uniform trousers (32)' }] };
    const d = assistantUnderstand({ text: 'new site: 10 pants', today: TODAY, actions: ASSISTANT_ACTIONS, skills: [skill], style, lists: { items: [{ id: 'a', name: 'Uniform trousers (32)', size: '32' }] }, actionId: null });
    expect(d.actionId).toBe('site-supplies');
    expect(d.skillId).toBe('s1');
    expect(d.values.forNewSite).toBe(true);
    expect(d.values.lines).toEqual([expect.objectContaining({ stockItemId: 'a', qty: 10 })]);
  });
});

describe('Who the agent helps, and with what', () => {
  it('offers only the jobs the person may do; never to a site device or an integration', async () => {
    const { svc, im, sk } = await setup();
    expect(assistantActionsFor(im).map((a) => a.id)).toContain('site-supplies');
    // A storekeeper issues and counts; they do not start requests.
    expect(assistantActionsFor(sk).map((a) => a.id)).not.toContain('site-supplies');
    const device = (await svc.store.list('users')).find((u) => u.role === 'site_device');
    if (device) expect(assistantAllowed(device)).toBe(false);
  });

  it('only a unit\'s head publishes a team skill', async () => {
    const { im, sk, svc } = await setup();
    expect(assistantMayPublish(im, 'dept:procurement')).toBe(true);
    expect(assistantMayPublish(sk, 'dept:procurement')).toBe(false);
    expect(assistantMayPublish(im, 'dept:it')).toBe(false);
    expect(assistantMayPublish(await svc.user('u-coo'), 'dept:it')).toBe(true);
  });
});

describe('Starting a site supplies request when the OGM says so', () => {
  it('the Inventory Manager types the OGM\'s instruction; the agent fills it; the server checks it on Send', async () => {
    const { a, ss, im, om, site, store } = await (async () => { const x = await setup(); return { ...x, ss: x.svc.siteSupplies }; })();
    await ss.act(om, 'siteType', { siteId: GUARD_SITE, contract: 'PKK', reason: 'Local guards' });
    const u = await a.understand(im, { text: `OGM minta 5 uniform trousers saiz 32 untuk ${site.name}, tapak baharu`, lang: 'bm' });
    expect(u.sent).toBe(false);
    expect(u.draft.actionId).toBe('site-supplies');
    expect(u.draft.values.siteId).toBe(GUARD_SITE);
    expect(u.draft.values.lines).toEqual([expect.objectContaining({ stockItemId: TROUSERS, qty: 5 })]);
    // Only the OMs covering the site are offered as the receiver; one of them is chosen before Send.
    expect(u.lists.receivers!.map((r) => r.id)).toContain(om.id);
    await expect(a.send(im, { actionId: 'site-supplies', values: { ...u.draft.values } })).rejects.toThrow(/Choose the OM/);
    const before = (await store.list('stockRequests', {})).length;
    const r = await a.send(im, { actionId: 'site-supplies', values: { ...u.draft.values, receiverUserId: om.id }, text: 'x', draft: u.draft });
    expect(r.sent).toBe(true);
    expect((await store.list('stockRequests', {})).length).toBe(before + 1);
    expect(r.result).toMatchObject({ status: 'kelulusan', startedBy: { role: 'office', name: im.name }, receiverId: om.id });
    const audit = (await store.list('audit', {})).filter((x) => x.action === 'assistant.sent');
    expect(audit).toHaveLength(1);
  });

  it('the agent adds no right: a storekeeper cannot send one through it', async () => {
    const { a, sk, om } = await setup();
    await expect(a.send(sk, { actionId: 'site-supplies', values: { siteId: GUARD_SITE, receiverUserId: om.id, lines: [{ stockItemId: TROUSERS, qty: 1 }] } })).rejects.toThrow(/not one the agent fills/);
  });

  it('an OM\'s request is entered and submitted in one Send', async () => {
    const { a, svc, om } = await setup();
    await svc.siteSupplies.act(om, 'siteType', { siteId: GUARD_SITE, contract: 'PKK', reason: 'Local guards' });
    const r = await a.send(om, { actionId: 'site-supplies', values: { siteId: GUARD_SITE, lines: [{ stockItemId: TROUSERS, qty: 1 }], notes: 'Torn trousers' } });
    expect((r.result as { status: string }).status).not.toBe('baharu');
  });
});

describe('Other jobs through the same server actions', () => {
  it('raises an IT help request and adds the person\'s own task', async () => {
    const { a, svc, store } = await setup();
    const me = await svc.user('u-finance-am');
    const u = await a.understand(me, { text: 'Laptop saya rosak, tidak boleh on. Segera.' });
    expect(u.draft.actionId).toBe('it-help');
    expect(u.draft.values).toMatchObject({ category: 'DEVICE', priority: 'P2' });
    await a.send(me, { actionId: 'it-help', values: u.draft.values });
    expect((await store.list('itTickets', {})).some((t) => t.raisedById === me.id && t.category === 'DEVICE')).toBe(true);
    const t = await a.understand(me, { text: 'Ingatkan saya hantar laporan bulanan esok 3pm' });
    expect(t.draft.actionId).toBe('my-task');
    expect(t.draft.values).toMatchObject({ date: '2026-11-24', time: '15:00' });
    await a.send(me, { actionId: 'my-task', values: t.draft.values });
  });

  it('says where to go for a job it does not fill, from the person\'s own guide', async () => {
    const { a, svc } = await setup();
    const me = await svc.user('u-finance-am');
    const u = await a.understand(me, { text: 'How do I approve a payment voucher?' });
    expect(u.draft.actionId === null || u.guide.length > 0).toBe(true);
  });
});

describe('Skill library and personal style', () => {
  it('before the module it says so; after, skills and style are kept per person and per team', async () => {
    const { ds, svc, im, sk } = await setup();
    const a = svc.assistant;
    expect((await a.home(im)).installed).toBe(true); // the memory store has every table
    const skill = await a.saveSkill(im, { scope: 'team', owner: 'dept:procurement', name: 'New site start-up', words: ['tapak baharu'], actionId: 'site-supplies', values: { forNewSite: true, siteId: GUARD_SITE, date: '2026-11-24' } });
    // A skill keeps choices, never dates.
    expect(skill.values).toEqual({ forNewSite: true, siteId: GUARD_SITE });
    await expect(a.saveSkill(sk, { scope: 'team', owner: 'dept:procurement', name: 'Not mine', actionId: 'leave' })).rejects.toThrow(/head or manager/);
    // The storekeeper's agent uses the team skill.
    expect((await a.skills(sk)).map((s) => s.id)).toContain(skill.id);
    // Style: own only.
    await a.setStyle(sk, { lang: 'bm', signOff: 'Terima kasih' });
    expect((await a.style(sk)).signOff).toBe('Terima kasih');
    expect((await a.style(im)).signOff).toBe(null);
    await a.forget(sk, { all: true });
    expect((await a.style(sk)).signOff).toBe(null);
    await expect(a.retireSkill(sk, { id: skill.id, reason: 'No longer used' })).rejects.toThrow(/head or manager/);
    await a.retireSkill(im, { id: skill.id, reason: 'No longer used' });
    expect((await a.skills(sk)).map((s) => s.id)).not.toContain(skill.id);
    expect(ds.assistantMemory.length).toBeGreaterThan(0);
  });

  it('learns the person\'s own word for an item from what they sent, and uses it next time', async () => {
    const { svc, im, om } = await setup();
    const a = svc.assistant;
    await svc.siteSupplies.act(om, 'siteType', { siteId: GUARD_SITE, contract: 'PKK', reason: 'Local guards' });
    const site = (await svc.store.get('sites', GUARD_SITE))!;
    const u = await a.understand(im, { text: `10 pants for ${site.name}`, actionId: 'site-supplies' });
    expect(u.draft.values.lines).toBeUndefined();
    await a.send(im, { actionId: 'site-supplies', text: `10 pants for ${site.name}`, draft: u.draft, values: { ...u.draft.values, receiverUserId: om.id, lines: [{ stockItemId: TROUSERS, qty: 10 }] } });
    expect((await a.style(im)).words).toEqual([expect.objectContaining({ field: 'items', said: 'pants', value: TROUSERS })]);
    const again = await a.understand(im, { text: `3 pants for ${site.name}`, actionId: 'site-supplies' });
    expect(again.draft.values.lines).toEqual([{ stockItemId: TROUSERS, qty: 3 }]);
    // Only the person sees their style.
    expect((await a.style(om)).words).toEqual([]);
  });
});
