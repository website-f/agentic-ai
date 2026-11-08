// Shift handover at the CMS desk (two steps, roster from Prima). Sample data only; no device, Prima or Azure connection.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeEvent } from '../src/event';
import { directoryProblems } from '../src/directory';
import { demoDirectory } from '../src/demo';
import { Hub, HubError } from '../src/hub';
import { flush, newLinkState } from '../src/prima-link';

const T0 = new Date('2026-11-05T10:00:00Z');

function setup() {
  let t = T0.getTime();
  const now = () => new Date(t);
  const dir = demoDirectory(T0); // Demo operator is Head Control until T0+30 min; Sample Head Control B from then.
  const hub = new Hub(dir, now);
  return { hub, dir, add: (min: number) => (t += min * 60_000) };
}

const cfg = { url: 'https://prima.example.invalid/api/integrations/cms/v1/events', directoryUrl: 'https://prima.example.invalid/d', key: 'k', secret: 's' };

describe('shift handover at the CMS desk', () => {
  it('the outgoing Head Control writes it with the open alarms; the incoming one takes it; the record goes to Prima', async () => {
    const { hub, add } = setup();
    hub.ingest(
      makeEvent({ id: 'ev-ho-1', kind: 'INTRUSION', companyId: 'co-jbk', siteId: 'site-jbk-plaza', deviceId: 'panel-plaza', source: 'sia-dc09', summary: 'Zone 3 intrusion', detail: { zone: 3 }, clipUrl: 'https://cms.internal/clip/1', occurredAt: T0.toISOString(), receivedAt: T0.toISOString() }),
    );
    // Only the rostered person writes it.
    assert.throws(() => hub.giveHandover('Sample Head Control B', 'nothing open'), HubError);
    assert.throws(() => hub.giveHandover('Demo operator', 'x'), /terbuka/);
    // The incoming Head Control cannot take it before it is written.
    add(5);
    assert.throws(() => hub.takeHandover('Sample Head Control B', true, 'checked the board'), /belum menulis/);
    const h = hub.giveHandover('Demo operator', 'Intrusion at Sample Plaza still open, OM on the way');
    assert.equal(h.outgoing!.openAlarms.length, 1);
    assert.throws(() => hub.giveHandover('Demo operator', 'again please'), /sudah ditulis/);
    // A Monitor Officer or someone else cannot take it.
    assert.throws(() => hub.takeHandover('Sample Monitor Officer C', true, 'checked the board'), HubError);
    const taken = hub.takeHandover('Sample Head Control B', false, 'Vault camera also down, not listed');
    assert.equal(taken.incoming!.agree, false);
    assert.equal(hub.handoversToPrima.length, 1);
    assert.throws(() => hub.takeHandover('Sample Head Control B', true, 'again please'), /sudah diambil/);

    let body: { handovers?: { id: string; outgoing: { openAlarms: Record<string, unknown>[] } | null }[] } | null = null;
    const r = await flush([...hub.toPrima], [], cfg, async (_u, init) => {
      body = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => ({ received: { events: 1, closedAlarms: 0, handovers: 1 }, refused: [] }) };
    }, newLinkState(), undefined, undefined, hub.handoversToPrima);
    assert.equal(r.error, undefined);
    assert.equal(hub.handoversToPrima.length, 0);
    const sent = JSON.stringify(body!.handovers);
    // No clip link and no device detail go to Prima.
    assert.ok(!sent.includes('clip') && !sent.includes('zone'));
    assert.deepEqual(Object.keys(body!.handovers![0].outgoing!.openAlarms[0]).sort(), ['id', 'kind', 'siteId', 'state', 'summary']);
  });

  it('a malformed or short answer from Prima keeps the handover queued; a refusal is retried then parked', async () => {
    const { hub, add } = setup();
    add(5);
    hub.giveHandover('Demo operator', 'nothing open');
    hub.takeHandover('Sample Head Control B', true, 'board checked, nothing open');
    const q = hub.handoversToPrima;
    const bad = await flush([], [], cfg, async () => ({ ok: true, status: 200, json: async () => ({ received: { events: 0, closedAlarms: 0 } }) }), newLinkState(), undefined, undefined, q);
    assert.match(bad.error!, /handover count/);
    assert.equal(q.length, 1);
    const state = newLinkState();
    for (let i = 0; i < 5; i++)
      await flush([], [], cfg, async () => ({ ok: true, status: 200, json: async () => ({ received: { events: 0, closedAlarms: 0, handovers: 1 }, refused: [{ list: 'handovers', id: q[0]?.id, reason: 'seat not on the roster' }] }) }), state, undefined, undefined, q);
    assert.equal(q.length, 0);
    assert.equal(state.parked[0].kind, 'handover');
  });

  it('nobody hands over to themselves, and without the roster from Prima the desk says so', () => {
    const dir = demoDirectory(T0);
    dir.desk = dir.desk!.map((s) => (s.id === 'cms-demo-hc-2' ? { ...s, staffName: 'Demo operator' } : s));
    let t = T0.getTime() + 10 * 60_000;
    const hub = new Hub(dir, () => new Date(t));
    hub.giveHandover('Demo operator', 'nothing open');
    t += 25 * 60_000;
    assert.throws(() => hub.takeHandover('Demo operator', true, 'checked the board'), /diri sendiri/);
    const { desk: _desk, ...old } = demoDirectory(T0);
    const noRoster = new Hub(old, () => T0);
    assert.throws(() => noRoster.giveHandover('Demo operator', 'nothing open'), /belum diterima/);
    assert.equal(noRoster.deskHandover().roster, false);
    assert.deepEqual(directoryProblems({ ...old, desk: [{ id: 'x', post: 'BOSS', start: T0.toISOString(), end: T0.toISOString(), staffName: null }] }).length, 2);
  });

  it('when the outgoing Head Control is not on the desk, the incoming one takes over without a written handover', () => {
    const dir = demoDirectory(T0);
    dir.desk = dir.desk!.map((s) => (s.staffName === 'Demo operator' ? { ...s, onDesk: false } : s));
    const hub = new Hub(dir, () => new Date(T0.getTime() + 35 * 60_000));
    const h = hub.takeHandover('Sample Head Control B', true, 'took over, previous seat empty');
    assert.equal(h.outgoing, null);
    assert.equal(hub.handoversToPrima.length, 1);
  });

  it('a handover survives a restart, still queued for Prima', () => {
    const { hub, add } = setup();
    add(5);
    hub.giveHandover('Demo operator', 'nothing open');
    hub.takeHandover('Sample Head Control B', true, 'board checked, nothing open');
    const again = Hub.restore(JSON.parse(JSON.stringify(hub.exportState())), [], () => new Date(T0.getTime() + 6 * 60_000));
    assert.equal(again.handoversToPrima.length, 1);
    assert.equal(again.handovers.length, 1);
    assert.throws(() => again.takeHandover('Sample Head Control B', true, 'board checked again'), /sudah diambil/);
  });
});
