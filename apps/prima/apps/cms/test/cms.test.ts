// CMS Command Centre app, first version. Sample data only; no device, Prima or Azure connection is used.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { makeEvent, sign, verify, type CmsEvent } from '../src/event';
import { DirectoryIndex, directoryProblems, type Directory } from '../src/directory';
import { demoDirectory } from '../src/demo';
import { Hub, HubError, KEEP, type Alarm } from '../src/hub';
import { StateStore } from '../src/persist';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESCALATE_AFTER_MIN, ROUTES } from '../src/routing';
import { crc16, frame, handleFrame, parseFrame } from '../src/adaptors/sia-dc09';
import { GateLists, decide, normalisePlate, plateEvent, readFromJson, PROFILES } from '../src/adaptors/anpr';
import { driverHours, fixEvents } from '../src/adaptors/tracker';
import { MAX_REFUSALS, flush, newLinkState, primaConfig, pullDirectory, signedRequest } from '../src/prima-link';
import { handler, MAX_BODY, type ServerConfig } from '../src/server';
import { createServer } from 'node:http';

const T0 = new Date('2026-11-03T01:00:00Z');

function clock(start = T0) {
  let t = start.getTime();
  return { now: () => new Date(t), add: (min: number) => (t += min * 60_000), ms: () => t };
}

function setup() {
  const c = clock();
  const dir = demoDirectory(T0);
  const hub = new Hub(dir, c.now);
  return { c, dir, hub, idx: new DirectoryIndex(dir) };
}

function intrusion(n = 1, at = T0): CmsEvent {
  return makeEvent({
    id: `ev-${n}`,
    kind: 'INTRUSION',
    companyId: 'co-jbk',
    siteId: 'site-jbk-plaza',
    deviceId: 'panel-plaza',
    source: 'test',
    summary: 'Burglary, zone 015, Sample Plaza',
    detail: { zone: '015' },
    occurredAt: at.toISOString(),
    receivedAt: at.toISOString(),
  });
}

describe('directory from Prima', () => {
  it('accepts the sample directory and refuses broken links and a reused alarm account', () => {
    assert.deepEqual(directoryProblems(demoDirectory(T0)), []);
    const d = demoDirectory(T0);
    d.devices.push({ id: 'x', siteId: 'nowhere', kind: 'camera', silentAfterMin: 5 });
    d.devices.push({ id: 'panel-2', siteId: 'site-jbk-plaza', kind: 'alarm_panel', account: '1234', silentAfterMin: 5 });
    const bad = directoryProblems(d);
    assert.ok(bad.some((b) => b.includes('site nowhere')));
    assert.ok(bad.some((b) => b.includes('alarm account 1234')));
  });

  it('finds the person for a role at the site, then the company, then the group', () => {
    const { idx } = setup();
    assert.equal(idx.contact('site-jbk-plaza', 'site_supervisor')?.name, 'Sample Site Supervisor');
    assert.equal(idx.contact('site-jbk-plaza', 'operations_manager')?.name, 'Sample OM');
    assert.equal(idx.contact('site-jbk-plaza', 'coo')?.name, 'Sample COO');
    assert.equal(idx.contact('site-jbk-vault', 'site_supervisor'), null);
  });
});

describe('signing (same scheme as the JA feed)', () => {
  it('accepts a good signature and refuses a changed body, a wrong key and an old time stamp', () => {
    const body = '{"a":1}';
    const h = sign(body, 'k', 's', T0.getTime());
    assert.equal(verify(h as unknown as Record<string, unknown>, body, 'k', 's', T0.getTime()), true);
    assert.equal(verify(h as unknown as Record<string, unknown>, '{"a":2}', 'k', 's', T0.getTime()), false);
    assert.equal(verify(h as unknown as Record<string, unknown>, body, 'other', 's', T0.getTime()), false);
    assert.equal(verify(h as unknown as Record<string, unknown>, body, 'k', 's', T0.getTime() + 6 * 60_000), false);
    assert.equal(verify(h as unknown as Record<string, unknown>, body, undefined, undefined, T0.getTime()), false);
  });
});

describe('alarm panels: SIA DC-09 with Contact ID', () => {
  const body = (seq: string, acct: string, data: string) => `"ADM-CID"${seq}R0L0#${acct}[#${acct}|${data}]_01:00:00,11-03-2026`;

  it('uses CRC-16/ARC (check value of 123456789 is BB3D)', () => {
    assert.equal(crc16('123456789'), 0xbb3d);
  });

  it('turns a burglary into an INTRUSION event and acknowledges the panel', () => {
    const { idx } = setup();
    const out = handleFrame(frame(body('0001', '5678', '1130 01 015')), idx, T0);
    assert.equal(out.event?.kind, 'INTRUSION');
    assert.equal(out.event?.siteId, 'site-jbk-plaza');
    assert.equal(out.event?.occurredAt, '2026-11-03T01:00:00Z');
    assert.equal(out.deviceId, 'panel-plaza');
    const reply = parseFrame(out.reply);
    assert.ok(reply.ok && reply.msg.id === 'ACK' && reply.msg.seq === '0001' && reply.msg.account === '5678');
  });

  it('reads panic, fire, tamper and restore codes', () => {
    const { idx } = setup();
    assert.equal(handleFrame(frame(body('0002', '5678', '1120 01 001')), idx, T0).event?.kind, 'PANIC');
    assert.equal(handleFrame(frame(body('0003', '5678', '1110 01 002')), idx, T0).event?.kind, 'FIRE');
    assert.equal(handleFrame(frame(body('0004', '5678', '1137 01 000')), idx, T0).event?.kind, 'TAMPER');
    assert.equal(handleFrame(frame(body('0005', '5678', '3130 01 015')), idx, T0).event?.kind, 'ALARM_RESTORED');
  });

  it('sends NAK for a bad CRC, and refuses unknown accounts and encrypted frames without dropping them silently', () => {
    const { idx } = setup();
    const good = frame(body('0006', '5678', '1130 01 015'));
    const broken = good.slice(0, 1) + (good[1] === 'A' ? 'B' : 'A') + good.slice(2);
    const bad = handleFrame(broken, idx, T0);
    assert.equal(bad.event, null);
    assert.match(bad.refused!, /CRC/);
    assert.ok(bad.reply.includes('"NAK"'));
    const unknown = handleFrame(frame(body('0007', '9999', '1130 01 015')), idx, T0);
    assert.match(unknown.refused!, /not in the directory/);
    assert.ok(unknown.reply.includes('"ACK"'));
    const enc = handleFrame(frame('"*ADM-CID"0008R0L0#5678[ABCDEF]'), idx, T0);
    assert.match(enc.refused!, /encrypted/);
  });

  it('treats a link test (NULL) as a heartbeat only', () => {
    const { idx } = setup();
    const out = handleFrame(frame('"NULL"0009R0L0#1234[]'), idx, T0);
    assert.equal(out.event, null);
    assert.equal(out.deviceId, 'panel-vault');
    assert.equal(out.refused, undefined);
  });

  it('gives the same event id when the panel resends the same frame', () => {
    const { idx } = setup();
    const f = frame(body('0010', '5678', '1130 01 015'));
    assert.equal(handleFrame(f, idx, T0).event?.id, handleFrame(f, idx, new Date(T0.getTime() + 5000)).event?.id);
  });
});

describe('barrier gates: ANPR checked against the visitor and vehicle systems', () => {
  function lists() {
    const l = new GateLists();
    l.setVehicles([
      { plate: 'WXX 1234', siteIds: ['site-jbk-plaza'], status: 'registered', owner: 'Tenant A' },
      { plate: 'BAD 1', siteIds: [], status: 'blocked', owner: 'Unknown', reason: 'Banned after an incident' },
    ]);
    l.setVisitors([{ id: 'v-1', siteId: 'site-jbk-plaza', name: 'Sample Visitor', host: 'Level 3 office', plate: 'VBN-55', from: '2026-11-03T00:00:00Z', to: '2026-11-03T04:00:00Z' }]);
    return l;
  }
  const read = (plate: string, confidence = 0.95, at = '2026-11-03T01:00:00Z') => ({ cameraId: 'anpr-gate-in', plate, confidence, at });

  it('normalises plates written with spaces or dashes', () => {
    assert.equal(normalisePlate('wxx 1234'), 'WXX1234');
    assert.equal(normalisePlate('VBN-55'), 'VBN55');
  });

  it('flags a blocked plate even on a low-confidence read', () => {
    assert.equal(decide(read('BAD1', 0.5), 'site-jbk-plaza', lists()).verdict, 'blocked');
  });

  it('allows a registered vehicle, matches an expected visitor in the window, and flags the rest', () => {
    const l = lists();
    assert.equal(decide(read('WXX1234'), 'site-jbk-plaza', l).verdict, 'registered');
    assert.equal(decide(read('WXX1234'), 'site-jbk-vault', l).verdict, 'unknown');
    assert.equal(decide(read('VBN 55'), 'site-jbk-plaza', l).verdict, 'visitor');
    assert.equal(decide(read('VBN55', 0.95, '2026-11-03T05:00:00Z'), 'site-jbk-plaza', l).verdict, 'unknown');
    assert.equal(decide(read('ZZZ9'), 'site-jbk-plaza', l).verdict, 'unknown');
    assert.equal(decide(read('WXX1234', 0.6), 'site-jbk-plaza', l).verdict, 'unclear');
  });

  it('makes the right event and refuses a camera that is not in the directory', () => {
    const { idx } = setup();
    const l = lists();
    const e = plateEvent(read('BAD1'), idx, l);
    assert.ok(!('refused' in e) && e.kind === 'GATE_PLATE_BLOCKED' && e.severity === 'high');
    const v = plateEvent(read('VBN55'), idx, l);
    assert.ok(!('refused' in v) && v.kind === 'GATE_VISITOR_ARRIVED');
    assert.ok('refused' in plateEvent({ ...read('X'), cameraId: 'cam-gate-1' }, idx, l));
  });

  it('maps a brand JSON push through its profile, including 0 to 100 confidence', () => {
    const r = readFromJson({ plate: 'ABC1', confidence: 87, time: '2026-11-03T01:00:00Z', cameraId: 'anpr-gate-in' }, { ...PROFILES.generic, confidenceScale: 100 });
    assert.ok(!('refused' in r) && Math.abs(r.confidence - 0.87) < 1e-9);
    assert.ok('refused' in readFromJson({ plate: 'ABC1' }, PROFILES.generic));
  });
});

describe('vehicle trackers and JPJ driver hours', () => {
  const fix = (o: Partial<Parameters<typeof fixEvents>[0]> = {}) => ({ trackerId: 'trk-cit-1', at: '2026-11-03T01:00:00Z', lat: 3.1, lon: 101.6, speedKmh: 60, ignition: true, panic: false, ...o });
  const route = { trackerId: 'trk-cit-1', points: [{ lat: 3.1, lon: 101.6 }, { lat: 3.1, lon: 101.7 }], toleranceM: 500 };

  it('raises panic, speeding and off-route, and nothing on a normal fix on the route', () => {
    const { idx } = setup();
    const kinds = (o: Partial<ReturnType<typeof fix>>) => {
      const r = fixEvents(fix(o), idx, route);
      return 'refused' in r ? ['refused'] : r.map((e) => e.kind);
    };
    assert.deepEqual(kinds({ lon: 101.65 }), []);
    assert.deepEqual(kinds({ panic: true }), ['VEHICLE_PANIC']);
    assert.deepEqual(kinds({ speedKmh: 120 }), ['VEHICLE_SPEEDING']);
    assert.deepEqual(kinds({ lat: 3.2 }), ['VEHICLE_OFF_ROUTE']);
    assert.deepEqual(kinds({ trackerId: 'cam-gate-1' }), ['refused']);
  });

  it('checks 8 hours a day and a 30 minute break after 4 hours', () => {
    const d = (s: string, e: string) => ({ driverId: 'd', start: `2026-11-03T${s}:00Z`, end: `2026-11-03T${e}:00Z` });
    assert.deepEqual(driverHours([d('00:00', '04:00'), d('04:30', '08:30')]), { drivingMin: 480, longestRunMin: 240, overDay: false, noBreak: false });
    assert.equal(driverHours([d('00:00', '04:00'), d('04:20', '05:00')]).noBreak, true);
    assert.equal(driverHours([d('00:00', '04:00'), d('04:30', '08:30'), d('09:00', '09:30')]).overDay, true);
  });
});

describe('the event hub: who CMS tells, and when', () => {
  it('opens an alarm and tells the site post and the company on-call person straight away', () => {
    const { hub } = setup();
    const r = hub.ingest(intrusion());
    assert.ok(r.alarm);
    assert.deepEqual(hub.notifications.map((n) => n.to.role).sort(), ['company_oncall', 'site_post']);
    assert.match(hub.notifications[0].message, /SOP/);
  });

  it('repeats every 5 minutes, moves up to the OM and then the Regional OM, and stops once someone acts', () => {
    const { hub, c } = setup();
    const { alarm } = hub.ingest(intrusion());
    c.add(5);
    hub.tick();
    assert.equal(hub.notifications.filter((n) => n.attempt === 1).length, 2);
    c.add(ESCALATE_AFTER_MIN - 5);
    hub.tick();
    assert.ok(hub.notifications.some((n) => n.to.role === 'operations_manager'));
    c.add(ESCALATE_AFTER_MIN);
    hub.tick();
    assert.ok(hub.notifications.some((n) => n.to.role === 'regional_om'));
    hub.actioned(alarm!.id, 'op1', 'Sample OM going to site');
    const mine = () => hub.notifications.filter((n) => n.alarmId === alarm!.id).length;
    const before = mine();
    c.add(30);
    hub.tick();
    assert.equal(mine(), before);
    // Nothing goes above the Regional OM by itself.
    assert.ok(!hub.notifications.some((n) => n.alarmId === alarm!.id && ['operations_director', 'ogm', 'coo', 'ceo'].includes(n.to.role)));
  });

  it('acknowledging alone does not stop the reminders; only someone acting does', () => {
    const { hub, c } = setup();
    const { alarm } = hub.ingest(intrusion());
    hub.acknowledge(alarm!.id, 'op1');
    c.add(5);
    hub.tick();
    assert.ok(hub.notifications.some((n) => n.attempt === 1));
  });

  it('ignores a resent event, and joins a repeat of the same thing to the open alarm', () => {
    const { hub } = setup();
    hub.ingest(intrusion(1));
    assert.equal(hub.ingest(intrusion(1)).duplicate, true);
    const r = hub.ingest(intrusion(2));
    assert.equal(r.alarm?.repeats, 1);
    assert.equal(hub.queue().length, 1);
  });

  it('closes only with real or false and a note, and queues the closed alarm for Prima', () => {
    const { hub } = setup();
    const { alarm } = hub.ingest(intrusion());
    assert.throws(() => hub.close(alarm!.id, 'op1', 'false', '  '), HubError);
    assert.throws(() => hub.close(alarm!.id, 'op1', 'maybe' as 'real', 'x'), HubError);
    hub.close(alarm!.id, 'op1', 'false', 'Cleaner opened the back door; seen on camera');
    assert.equal(hub.queue().length, 0);
    assert.equal(hub.closedToPrima.length, 1);
    assert.throws(() => hub.close(alarm!.id, 'op1', 'real', 'again'), HubError);
    assert.ok(hub.audit.some((a) => a.action === 'close:false' && a.operator === 'op1'));
  });

  it('escalates above the Regional OM only by the operator, with a reason: Operations Director (private), COO, CEO', () => {
    const { hub } = setup();
    const { alarm } = hub.ingest(intrusion());
    assert.throws(() => hub.escalate(alarm!.id, 'op1', ''), HubError);
    assert.equal(hub.escalate(alarm!.id, 'op1', 'No answer from the ROM for 40 minutes'), 'operations_director');
    assert.equal(hub.escalate(alarm!.id, 'op1', 'Still no response'), 'coo');
    assert.equal(hub.escalate(alarm!.id, 'op1', 'Serious'), 'ceo');
    assert.throws(() => hub.escalate(alarm!.id, 'op1', 'more'), /CEO/);
  });

  it('sends a government site to the OGM, not the Operations Director', () => {
    const dir = demoDirectory(T0);
    dir.sites[1].sector = 'government';
    const hub = new Hub(dir, () => T0);
    const { alarm } = hub.ingest(intrusion());
    assert.equal(hub.escalate(alarm!.id, 'op1', 'No answer'), 'ogm');
  });

  it('records a gap when nobody is set for a role, instead of skipping it silently', () => {
    const dir = demoDirectory(T0);
    delete dir.sites[1].contacts.site_post;
    const hub = new Hub(dir, () => T0);
    hub.ingest(intrusion());
    assert.deepEqual(hub.gaps[0].missingRoles, ['site_post']);
  });

  it('refuses an event for a site the directory does not know, or for the wrong company', () => {
    const { hub } = setup();
    assert.ok(hub.ingest({ ...intrusion(), siteId: 'site-x' }).refused);
    assert.ok(hub.ingest({ ...intrusion(3), companyId: 'co-other' }).refused);
    assert.equal(hub.refused.length, 2);
    assert.equal(hub.alarms.size, 0);
  });

  it('keeps information events out of the alarm queue and out of the Prima queue', () => {
    const { hub } = setup();
    hub.ingest(makeEvent({ id: 'i1', kind: 'GATE_PLATE_ALLOWED', companyId: 'co-jbk', siteId: 'site-jbk-plaza', deviceId: 'anpr-gate-in', source: 't', summary: 'ok', detail: {} }));
    assert.equal(hub.alarms.size, 0);
    assert.equal(hub.toPrima.length, 0);
  });

  it('has a route for every alarm kind it opens', () => {
    for (const plan of Object.values(ROUTES)) assert.ok(plan!.steps.length > 0 && plan!.steps[0].atMin === 0 && plan!.repeatMin > 0);
  });
});

describe('guard attendance and patrols (watched 24/7, Fauzan 2 Nov 2026)', () => {
  it('raises a no-show after the grace, tells the site supervisor every 5 minutes, and a late clock-in marks it acted on', () => {
    const { hub, c } = setup();
    // sh-1 started 30 minutes before T0, grace 15: due already. sh-2 started 5 minutes before: not yet.
    hub.tick();
    const noShows = [...hub.alarms.values()].filter((a) => a.kind === 'GUARD_NO_SHOW');
    assert.equal(noShows.length, 1);
    assert.ok(hub.notifications.some((n) => n.to.role === 'site_supervisor'));
    c.add(5);
    hub.tick();
    assert.ok(hub.notifications.some((n) => n.to.role === 'site_supervisor' && n.attempt === 1));
    assert.equal(hub.clockIn('sh-1', c.now().toISOString()), true);
    assert.equal(noShows[0].state, 'actioned');
    assert.match(noShows[0].actionBy!, /clocked in/);
  });

  it('falls back to the Company Manager when the site has no supervisor', () => {
    const dir = demoDirectory(T0);
    delete dir.sites[1].contacts.site_supervisor;
    const hub = new Hub(dir, () => T0);
    hub.tick();
    assert.ok(hub.notifications.some((n) => n.to.role === 'company_manager'));
  });

  it('does not raise a no-show for a guard who clocked in on time', () => {
    const { hub, c } = setup();
    hub.clockIn('sh-1', new Date(T0.getTime() - 25 * 60_000).toISOString());
    c.add(15);
    hub.tick();
    const kinds = [...hub.alarms.values()].map((a) => a.kind);
    assert.equal(kinds.filter((k) => k === 'GUARD_NO_SHOW').length, 1); // only sh-2, now past its grace
  });

  it('raises a missed patrol checkpoint and tells the guard first, then the patrolling officer', () => {
    const { hub, c } = setup();
    hub.tick();
    const missed = [...hub.alarms.values()].find((a) => a.kind === 'PATROL_MISSED');
    assert.match(missed!.summary, /by \d\d:\d\d MYT/);
    c.add(ESCALATE_AFTER_MIN);
    hub.tick();
    assert.ok(hub.notifications.some((n) => n.to.role === 'patrolling_officer'));
  });

  it('does not raise a missed patrol when the checkpoint was scanned', () => {
    const { hub } = setup();
    hub.checkpoint('pr-1', new Date(T0.getTime() - 20 * 60_000).toISOString());
    hub.tick();
    assert.ok(![...hub.alarms.values()].some((a) => a.kind === 'PATROL_MISSED'));
  });
});

describe('device health', () => {
  it('raises offline after the silence limit, back online on a heartbeat, and a site is live only with all video online', () => {
    const { hub, c } = setup();
    hub.heartbeat('cam-gate-1');
    assert.equal(hub.siteLive('site-jbk-plaza'), true);
    assert.equal(hub.siteLive('site-jbk-vault'), false); // never heard from
    assert.equal(hub.deviceHealth().find((d) => d.deviceId === 'cam-vault-1')?.state, 'unknown');
    c.add(11);
    hub.tick();
    const off = [...hub.alarms.values()].find((a) => a.kind === 'DEVICE_OFFLINE' && a.deviceId === 'cam-gate-1');
    assert.ok(off);
    assert.equal(hub.siteLive('site-jbk-plaza'), false);
    hub.heartbeat('cam-gate-1');
    assert.equal(hub.siteLive('site-jbk-plaza'), true);
    assert.ok(off!.restoredAt);
    assert.equal(off!.state, 'open'); // the operator still closes it with a note
  });
});

describe('link to Prima', () => {
  it('signs the batch so Prima can check it, keeps it on failure and clears it on success', async () => {
    const cfg = { url: 'https://prima.example.invalid/api/integrations/cms/v1/events', directoryUrl: 'https://prima.example.invalid/api/integrations/cms/v1/directory', key: 'k', secret: 's' };
    const q = [intrusion()];
    const req = signedRequest({ events: q, closedAlarms: [] }, cfg, T0.getTime());
    assert.equal(verify(req.init.headers, req.init.body, 'k', 's', T0.getTime()), true);
    const failed = await flush(q, [], cfg, async () => ({ ok: false, status: 503 }));
    assert.match(failed.error!, /503/);
    assert.equal(q.length, 1);
    const thrown = await flush(q, [], cfg, async () => {
      throw new Error('network down');
    });
    assert.match(thrown.error!, /network/);
    assert.equal(q.length, 1);
    const ok = await flush(q, [], cfg, async () => ({ ok: true, status: 200, json: async () => ({ received: { events: 1, closedAlarms: 0 }, refused: [] }) }));
    assert.equal(ok.sent, 1);
    assert.equal(q.length, 0);
  });

  it('sends the device status to Prima with nothing else queued: online only while heard within the silent window (Arisha main, 3 Nov)', async () => {
    const { c, hub } = setup();
    // Never heard from: unknown, never online.
    assert.ok(hub.statusForPrima().devices.every((d) => d.state === 'unknown'));
    hub.heartbeat('cam-vault-1');
    assert.equal(hub.statusForPrima().devices.find((d) => d.deviceId === 'cam-vault-1')!.state, 'online');
    c.add(11); // past its 10 minute silent window, before the watchdog tick: no longer evidence of up
    assert.equal(hub.statusForPrima().devices.find((d) => d.deviceId === 'cam-vault-1')!.state, 'unknown');
    hub.tick();
    assert.equal(hub.statusForPrima().devices.find((d) => d.deviceId === 'cam-vault-1')!.state, 'offline');
    const cfg = { url: 'https://prima.example.invalid/api/integrations/cms/v1/events', directoryUrl: 'https://prima.example.invalid/d', key: 'k', secret: 's' };
    let body: { events: unknown[]; status?: { at: string; devices: unknown[] } } | null = null;
    const r = await flush([], [], cfg, async (_u, init) => {
      body = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => ({ received: { events: 0, closedAlarms: 0 }, refused: [] }) };
    }, newLinkState(), c.now, () => hub.statusForPrima());
    assert.equal(r.error, undefined);
    assert.ok(body!.status!.devices.length > 0);
    assert.equal(body!.events.length, 0);
    // Without a status and with nothing queued, nothing is sent.
    let calls = 0;
    await flush([], [], cfg, async () => (calls++, { ok: true, status: 200 }));
    assert.equal(calls, 0);
  });

  it('pulls the directory signed, takes a good one and refuses a bad one without dropping the copy held', async () => {
    const cfg = primaConfig({ PRIMA_EVENTS_URL: 'https://prima.example.invalid/api/integrations/cms/v1/events', CMS_TO_PRIMA_KEY: 'k', CMS_TO_PRIMA_SECRET: 's' })!;
    assert.equal(cfg.directoryUrl, 'https://prima.example.invalid/api/integrations/cms/v1/directory');
    assert.throws(() => primaConfig({ PRIMA_EVENTS_URL: 'https://x.invalid/e', PRIMA_DIRECTORY_URL: 'http://x.invalid/d', CMS_TO_PRIMA_KEY: 'k', CMS_TO_PRIMA_SECRET: 's' }));
    let seen: RequestInit | undefined;
    const good = await pullDirectory(cfg, async (url, init) => {
      assert.equal(url, cfg.directoryUrl);
      seen = init;
      return { ok: true, status: 200, json: async () => demoDirectory(T0) };
    }, T0.getTime());
    assert.ok(good.directory);
    assert.equal(verify(seen!.headers as Record<string, string>, String(seen!.body), 'k', 's', T0.getTime()), true);
    const bad = await pullDirectory(cfg, async () => ({ ok: true, status: 200, json: async () => ({ asOf: 'never' }) }), T0.getTime());
    assert.match(bad.error!, /refused/);
    const down = await pullDirectory(cfg, async () => ({ ok: false, status: 401, json: async () => ({}) }), T0.getTime());
    assert.match(down.error!, /401/);
  });
});

describe('Arisha review fixes (2 Nov 2026)', () => {
  const cfg = { url: 'https://prima.example.invalid/api/integrations/cms/v1/events', directoryUrl: 'https://prima.example.invalid/api/integrations/cms/v1/directory', key: 'k', secret: 's' };

  it('defect 1: overlapping sends never drop an event queued while a send is running', async () => {
    const state = newLinkState();
    const q = [intrusion(1)];
    let release!: () => void;
    const slow = () => new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((r) => (release = () => r({ ok: true, status: 200, json: async () => ({ received: { events: 1, closedAlarms: 0 }, refused: [] }) })));
    const first = flush(q, [], cfg, slow, state);
    // While the first send is out: a new event arrives and a second flush is attempted.
    q.push(intrusion(2));
    const second = await flush(q, [], cfg, async () => ({ ok: true, status: 200, json: async () => ({ received: { events: 2, closedAlarms: 0 } }) }), state);
    assert.equal(second.busy, true);
    release();
    assert.equal((await first).sent, 1);
    assert.deepEqual(q.map((e) => e.id), ['ev-2']);
    // Regression: the next send takes the new one.
    assert.equal((await flush(q, [], cfg, async () => ({ ok: true, status: 200, json: async () => ({ received: { events: 1, closedAlarms: 0 } }) }), state)).sent, 1);
    assert.equal(q.length, 0);
  });

  it('defect 2: an event naming another site’s device is refused and does not mark that device online', () => {
    const { hub } = setup();
    const e = makeEvent({ id: 'ev-cross', kind: 'INTRUSION', companyId: 'co-jbk', siteId: 'site-jbk-plaza', deviceId: 'panel-vault', source: 'test', summary: 'x', detail: {} });
    const r = hub.ingest(e);
    assert.equal(r.stored, false);
    assert.match(r.refused!.join(), /another site/);
    assert.equal(hub.deviceHealth().find((d) => d.deviceId === 'panel-vault')!.state, 'unknown');
    assert.equal(hub.toPrima.length, 0);
    // Regression: the same device from its own site is fine.
    assert.equal(hub.ingest({ ...e, id: 'ev-own', siteId: 'site-jbk-vault' }).stored, true);
    assert.equal(hub.deviceHealth().find((d) => d.deviceId === 'panel-vault')!.state, 'online');
  });

  it('defect 3: severity comes from the kind, so an INTRUSION sent as "info" still goes to Prima and opens an alarm', () => {
    const { hub } = setup();
    const r = hub.ingest({ ...intrusion(7), severity: 'info' });
    assert.equal(r.stored, true);
    assert.ok(r.alarm);
    assert.equal(r.alarm!.severity, 'critical');
    assert.deepEqual(hub.toPrima.map((e) => [e.id, e.severity]), [['ev-7', 'critical']]);
  });

  it('defect 4: an item Prima refuses on a 2xx is kept and retried, then parked for the operator, never silently dropped', async () => {
    const state = newLinkState();
    const q = [intrusion(1), intrusion(2)];
    const refuseFirst = async () => ({ ok: true, status: 200, json: async () => ({ received: { events: q.length, closedAlarms: 0 }, refused: [{ list: 'events', id: 'ev-1', index: 0, reason: 'site not known for that company' }] }) });
    const r = await flush(q, [], cfg, refuseFirst, state);
    assert.deepEqual({ sent: r.sent, refused: r.refused }, { sent: 1, refused: 1 });
    assert.deepEqual(q.map((e) => e.id), ['ev-1']);
    for (let i = 2; i < MAX_REFUSALS; i++) await flush(q, [], cfg, refuseFirst, state);
    assert.deepEqual(q.map((e) => e.id), ['ev-1']);
    const last = await flush(q, [], cfg, refuseFirst, state);
    assert.equal(last.parked, 1);
    assert.equal(q.length, 0);
    assert.deepEqual(state.parked.map((p) => [p.id, p.attempts]), [['ev-1', MAX_REFUSALS]]);
    // An older answer that names only the index still keeps the right item.
    const q2 = [intrusion(3), intrusion(4)];
    await flush(q2, [], cfg, async () => ({ ok: true, status: 200, json: async () => ({ received: { events: 2, closedAlarms: 0 }, refused: [{ list: 'events', index: 1, reason: 'x' }] }) }), state);
    assert.deepEqual(q2.map((e) => e.id), ['ev-4']);
  });

  it('round 2: a 2xx that is not a valid acknowledgement never clears the queue, and a good one afterwards does', async () => {
    const state = newLinkState();
    const q = [intrusion(5), intrusion(6)];
    const closedQ: Alarm[] = [];
    const answer = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body });
    const bad: [string, unknown][] = [
      ['no body', null],
      ['empty object', {}],
      ['a bare refused list', { refused: [] }],
      ['counts that differ', { received: { events: 1, closedAlarms: 0 }, refused: [] }],
      ['counts as text', { received: { events: '2', closedAlarms: '0' } }],
      ['refused not a list', { received: { events: 2, closedAlarms: 0 }, refused: 'none' }],
      ['a refusal naming no list', { received: { events: 2, closedAlarms: 0 }, refused: [{ id: 'ev-5', reason: 'x' }] }],
      ['a refusal naming an item never sent', { received: { events: 2, closedAlarms: 0 }, refused: [{ list: 'events', id: 'ev-99', reason: 'x' }] }],
      ['id and index that disagree', { received: { events: 2, closedAlarms: 0 }, refused: [{ list: 'events', id: 'ev-5', index: 1, reason: 'x' }] }],
    ];
    for (const [why, body] of bad) {
      const r = await flush(q, closedQ, cfg, answer(body), state);
      assert.equal(r.sent, 0, why);
      assert.match(r.error ?? '', /not a valid acknowledgement/, why);
      assert.deepEqual(q.map((e) => e.id), ['ev-5', 'ev-6'], why);
    }
    // A body that cannot be read at all is kept too.
    const unreadable = await flush(q, closedQ, cfg, async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }), state);
    assert.equal(unreadable.sent, 0);
    assert.equal(q.length, 2);
    // Nothing above counted as a refusal, so nothing was parked.
    assert.equal(state.parked.length, 0);
    const good = await flush(q, closedQ, cfg, answer({ received: { events: 2, closedAlarms: 0 }, refused: [] }), state);
    assert.equal(good.sent, 2);
    assert.equal(q.length, 0);
  });
});

describe('HTTP server', () => {
  const OP = 'operator-key-for-tests-only-0001';
  const cfg: ServerConfig = { operators: new Map([[OP, 'Test Operator']]), gateway: { key: 'gw', secret: 'gw-secret' }, prima: { key: 'pr', secret: 'pr-secret' } };

  async function serve() {
    const dir: Directory = demoDirectory(T0);
    const hub = new Hub(dir, () => T0);
    const state = { hub, lists: new GateLists(), routes: new Map() };
    const srv = createServer((req, res) => void handler(cfg, state, () => T0.getTime())(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown, who?: { key: string; secret: string }, headers: Record<string, string> = {}) => {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      const signed = who ? sign(text, who.key, who.secret, T0.getTime()) : {};
      return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...signed, ...headers }, body: text });
    };
    return { hub, base, post, close: () => new Promise<void>((r) => srv.close(() => r())) };
  }

  it('refuses unsigned feeds and takes signed ones', async () => {
    const s = await serve();
    try {
      assert.equal((await s.post('/ingest/events', { events: [intrusion()] })).status, 401);
      assert.equal((await s.post('/ingest/events', { events: [intrusion()] }, { key: 'gw', secret: 'wrong' })).status, 401);
      const ok = await s.post('/ingest/events', { events: [intrusion()] }, cfg.gateway);
      assert.equal(ok.status, 200);
      assert.equal(((await ok.json()) as { stored: number }).stored, 1);
      assert.equal(s.hub.alarms.size, 1);
    } finally {
      await s.close();
    }
  });

  it('takes the directory only from Prima, never from a site gateway', async () => {
    const s = await serve();
    try {
      const d = demoDirectory(T0);
      assert.equal((await s.post('/ingest/directory', d, cfg.gateway)).status, 401);
      assert.equal((await s.post('/ingest/directory', d, cfg.prima)).status, 200);
      d.sites[0].companyId = 'co-missing';
      assert.equal((await s.post('/ingest/directory', d, cfg.prima)).status, 400);
    } finally {
      await s.close();
    }
  });

  it('needs an operator key for the dashboard data and alarm actions, and records the operator', async () => {
    const s = await serve();
    try {
      await s.post('/ingest/events', { events: [intrusion()] }, cfg.gateway);
      assert.equal((await fetch(`${s.base}/api/state`)).status, 401);
      assert.equal((await fetch(`${s.base}/api/state`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
      const st = (await (await fetch(`${s.base}/api/state`, { headers: { authorization: `Bearer ${OP}` } })).json()) as { queue: { id: string }[] };
      assert.equal(st.queue.length, 1);
      const id = st.queue[0].id;
      const auth = { authorization: `Bearer ${OP}` };
      assert.equal((await s.post(`/api/alarms/${id}/close`, { outcome: 'real' }, undefined, auth)).status, 400);
      assert.equal((await s.post(`/api/alarms/${id}/close`, { outcome: 'real', note: 'Intruder seen; police called by the company' }, undefined, auth)).status, 200);
      assert.equal(s.hub.audit.at(-1)?.operator, 'Test Operator');
    } finally {
      await s.close();
    }
  });

  it('has no route to open a gate or arm a panel', async () => {
    const s = await serve();
    try {
      const auth = { authorization: `Bearer ${OP}` };
      for (const p of ['/api/gates/gate-main/open', '/api/commands', '/api/panels/panel-plaza/disarm']) assert.equal((await s.post(p, {}, undefined, auth)).status, 404);
    } finally {
      await s.close();
    }
  });

  it('reads an ANPR push through the brand profile and refuses oversize bodies', async () => {
    const s = await serve();
    try {
      const r = await s.post('/ingest/anpr/generic', { plate: 'ZZZ 9', confidence: 0.9, time: T0.toISOString(), cameraId: 'anpr-gate-in' }, cfg.gateway);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { verdict: 'unknown', kind: 'GATE_PLATE_UNKNOWN' });
      assert.equal((await s.post('/ingest/anpr/nobrand', { plate: 'A' }, cfg.gateway)).status, 404);
      const big = JSON.stringify({ events: [], pad: 'x'.repeat(MAX_BODY) });
      const res = await s.post('/ingest/events', big, cfg.gateway).catch(() => null);
      assert.ok(res === null || res.status === 413);
    } finally {
      await s.close();
    }
  });

  it('serves the dashboard with a strict content security policy', async () => {
    const s = await serve();
    try {
      const r = await fetch(`${s.base}/`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'/);
      assert.ok(!(await r.text()).includes('<script>'));
    } finally {
      await s.close();
    }
  });
});

describe('resilience: saved state and restart (masterplan §193)', () => {
  const fresh = () => mkdtempSync(join(tmpdir(), 'cms-state-'));

  it('keeps an open alarm and its history across a restart, with a restart line, and does not raise a duplicate again', () => {
    const dir = fresh();
    try {
      const c = clock();
      const store = new StateStore(dir);
      const hub = new Hub(demoDirectory(T0), c.now);
      const { alarm } = hub.ingest(intrusion());
      hub.acknowledge(alarm!.id, 'Sample Operator');
      store.save(hub);
      c.add(3);
      const back = new StateStore(dir).load(c.now)!.hub;
      const a = back.alarms.get(alarm!.id)!;
      assert.equal(a.state, 'acknowledged');
      assert.equal(a.acknowledgedBy, 'Sample Operator');
      assert.match(a.notes!.at(-1)!.text, /CMS restarted at/);
      assert.deepEqual(back.audit.map((e) => e.action), ['acknowledge', 'restart']);
      assert.equal(back.notifications.length, hub.notifications.length);
      const again = back.ingest(intrusion());
      assert.equal(again.duplicate, true);
      assert.equal(back.alarms.size, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends a reminder that fell due while CMS was down once, not once per missed repeat', () => {
    const dir = fresh();
    try {
      const c = clock();
      const hub = new Hub(demoDirectory(T0), c.now);
      const { alarm } = hub.ingest(intrusion());
      new StateStore(dir).save(hub);
      c.add(17); // three 5-minute repeats missed
      const back = new StateStore(dir).load(c.now)!.hub;
      const before = back.notifications.length;
      back.tick();
      back.tick();
      const fired = back.notifications.slice(before).filter((n) => n.alarmId === alarm!.id);
      assert.ok(fired.length > 0);
      assert.equal(new Set(fired.map((n) => `${n.step}:${n.attempt}`)).size, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows a device whose heartbeat went stale while CMS was down as unknown, never online, and times it from the restart', () => {
    const dir = fresh();
    try {
      const c = clock();
      const hub = new Hub(demoDirectory(T0), c.now);
      hub.heartbeat('cam-gate-1', c.now()); // silent after 10 minutes
      hub.heartbeat('panel-plaza', c.now()); // silent after 30 minutes
      new StateStore(dir).save(hub);
      c.add(20);
      const back = new StateStore(dir).load(c.now)!.hub;
      const state = (id: string) => back.deviceHealth().find((d) => d.deviceId === id)!.state;
      assert.equal(state('cam-gate-1'), 'unknown');
      assert.equal(state('panel-plaza'), 'online');
      c.add(9);
      back.tick();
      assert.equal(state('cam-gate-1'), 'unknown');
      c.add(2);
      back.tick();
      assert.equal(state('cam-gate-1'), 'offline');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows a device whose saved heartbeat is in the future as unknown after a restart, never online', () => {
    const dir = fresh();
    try {
      const c = clock();
      const hub = new Hub(demoDirectory(T0), c.now);
      hub.heartbeat('cam-gate-1', new Date(T0.getTime() + 365 * 86_400_000));
      new StateStore(dir).save(hub);
      const back = new StateStore(dir).load(c.now)!.hub;
      assert.equal(back.deviceHealth().find((d) => d.deviceId === 'cam-gate-1')!.state, 'unknown');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the outbox to Prima and its retry counts, and sends it once after the restart', async () => {
    const dir = fresh();
    try {
      const c = clock();
      const hub = new Hub(demoDirectory(T0), c.now);
      const { alarm } = hub.ingest(intrusion());
      hub.close(alarm!.id, 'Sample Operator', 'false', 'Cat on the sensor, checked on camera');
      hub.primaLink.attempts.set('event:x', 2);
      new StateStore(dir).save(hub);
      const back = new StateStore(dir).load(c.now)!.hub;
      assert.equal(back.toPrima.length, 1);
      assert.equal(back.closedToPrima.length, 1);
      assert.equal(back.closedToPrima[0], back.alarms.get(alarm!.id), 'the outbox points at the restored alarm');
      assert.equal(back.primaLink.attempts.get('event:x'), 2);
      const cfg = { url: 'https://prima.example/api/integrations/cms/v1/events', directoryUrl: 'https://prima.example/d', key: 'k', secret: 's' };
      let calls = 0;
      const ack = async (_u: string, init: RequestInit) => {
        calls++;
        const b = JSON.parse(String(init.body));
        return { ok: true, status: 200, json: async () => ({ received: { events: b.events.length, closedAlarms: b.closedAlarms.length }, refused: [] }) };
      };
      await flush(back.toPrima, back.closedToPrima, cfg, ack, back.primaLink);
      await flush(back.toPrima, back.closedToPrima, cfg, ack, back.primaLink);
      assert.equal(calls, 1);
      const store = new StateStore(dir);
      store.load(c.now);
      store.save(back);
      const third = new StateStore(dir).load(c.now)!.hub;
      assert.equal(third.toPrima.length + third.closedToPrima.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not raise a no-show again after a restart', () => {
    const dir = fresh();
    try {
      const c = clock();
      const hub = new Hub(demoDirectory(T0), c.now);
      c.add(16);
      hub.tick();
      const noShows = (h: Hub) => [...h.alarms.values()].filter((a) => a.kind === 'GUARD_NO_SHOW').length;
      const n = noShows(hub);
      assert.ok(n >= 1);
      new StateStore(dir).save(hub);
      c.add(1);
      const back = new StateStore(dir).load(c.now)!.hub;
      back.tick();
      assert.equal(noShows(back), n);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('only appends to the audit journal, never rewrites it, and survives a line torn by a crash', () => {
    const dir = fresh();
    try {
      const c = clock();
      const store = new StateStore(dir);
      const hub = new Hub(demoDirectory(T0), c.now);
      const { alarm } = hub.ingest(intrusion());
      hub.acknowledge(alarm!.id, 'Op A');
      store.save(hub);
      store.save(hub); // nothing new: nothing written twice
      const first = readFileSync(store.auditPath, 'utf8');
      assert.equal(first.trim().split('\n').length, 1);
      hub.escalate(alarm!.id, 'Op A', 'No answer from the Regional OM');
      store.save(hub);
      const second = readFileSync(store.auditPath, 'utf8');
      assert.ok(second.startsWith(first));
      assert.equal(second.trim().split('\n').length, 2);
      appendFileSync(store.auditPath, '{"at":"2026-11-03T01:00:00Z","oper'); // torn line
      hub.close(alarm!.id, 'Op A', 'real', 'Intruder seen; the company opened a case');
      store.save(hub);
      const back = new StateStore(dir);
      const journal = back.readJournal();
      assert.deepEqual(journal.map((e) => e.action), ['acknowledge', 'escalate:operations_director', 'close:real']);
      assert.deepEqual(journal.map((e) => e.seq), [1, 2, 3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets only one hub run on a state folder, and takes over a lock left by a stopped one', () => {
    const dir = fresh();
    try {
      const a = new StateStore(dir);
      a.lock(1111, () => true);
      assert.throws(() => new StateStore(dir).lock(2222, () => true), /Another CMS hub \(process 1111\)/);
      new StateStore(dir).lock(3333, () => false); // 1111 has stopped
      assert.equal(readFileSync(join(dir, 'hub.lock'), 'utf8'), '3333');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to start over a state file it cannot read, instead of starting empty', () => {
    const dir = fresh();
    try {
      writeFileSync(join(dir, 'state.json'), '{"version":1,"alarms":[');
      assert.throws(() => new StateStore(dir).load(), /not readable/);
      writeFileSync(join(dir, 'state.json'), '{"version":9}');
      assert.throws(() => new StateStore(dir).load(), /not readable/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops closed alarms after the keep period unless they are still waiting to go to Prima', () => {
    const c = clock();
    const hub = new Hub(demoDirectory(T0), c.now);
    const { alarm } = hub.ingest(intrusion());
    hub.close(alarm!.id, 'Op', 'false', 'Checked on camera, nobody there');
    c.add(KEEP.days * 1440 + 1);
    hub.compact();
    assert.ok(hub.alarms.has(alarm!.id), 'still in the outbox');
    hub.closedToPrima.length = 0;
    hub.toPrima.length = 0;
    hub.compact();
    assert.ok(!hub.alarms.has(alarm!.id));
    assert.equal(hub.recentEvents().length, 0);
  });

  it('answers a change 2xx only after it is saved, and 503 when the save fails', async () => {
    const OP = 'operator-key-for-tests-only-0001';
    const cfg: ServerConfig = { operators: new Map([[OP, 'Test Operator']]), gateway: { key: 'gw', secret: 'gw-secret' }, prima: { key: 'pr', secret: 'pr-secret' } };
    const hub = new Hub(demoDirectory(T0), () => T0);
    let saves = 0;
    let fail = false;
    const state = {
      hub,
      lists: new GateLists(),
      routes: new Map(),
      persist: () => {
        if (fail) throw new Error('disk full');
        saves++;
      },
    };
    const srv = createServer((req, res) => void handler(cfg, state, () => T0.getTime())(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown) => {
      const text = JSON.stringify(body);
      return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...sign(text, 'gw', 'gw-secret', T0.getTime()) }, body: text });
    };
    try {
      assert.equal((await post('/ingest/events', { events: [intrusion(1)] })).status, 200);
      assert.equal(saves, 1);
      fail = true;
      const r = await post('/ingest/events', { events: [intrusion(2)] });
      assert.equal(r.status, 503);
      assert.match(((await r.json()) as { error: string }).error, /could not save/);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

describe('coverage and response KPIs (masterplan §195)', () => {
  it('measures time to acknowledge and act against the proposed targets, waiting alarms, false alarms and unknown devices', () => {
    const c = clock();
    const hub = new Hub(demoDirectory(T0), c.now);
    const a1 = hub.ingest(intrusion(1)).alarm!; // INTRUSION is critical: acknowledge target 2 minutes
    c.add(1);
    hub.acknowledge(a1.id, 'Op');
    c.add(4);
    hub.actioned(a1.id, 'Op', 'Sample OM going to site');
    hub.close(a1.id, 'Op', 'false', 'Cat on the sensor');
    const a2 = hub.ingest({ ...intrusion(2), siteId: 'site-jbk-vault', deviceId: 'panel-vault' }).alarm!;
    c.add(3);
    hub.acknowledge(a2.id, 'Op'); // 3 minutes: over the 2-minute target
    hub.ingest({ ...intrusion(3), siteId: 'site-jbk-plaza', deviceId: 'cam-gate-1' });
    c.add(5); // the third waits 5 minutes unacknowledged
    hub.heartbeat('cam-gate-1', c.now());
    const k = hub.kpis();
    assert.equal(k.targetsProposed, true);
    assert.equal(k.all.alarms, 3);
    assert.equal(k.all.acknowledged, 2);
    assert.equal(k.all.ackMedianMin, 1);
    assert.equal(k.all.ackP90Min, 3);
    assert.equal(k.all.ackOverTarget, 1);
    assert.equal(k.all.waitingOverTarget, 1);
    assert.equal(k.all.actMedianMin, 5);
    assert.equal(k.all.falseRatePct, 100);
    assert.equal(k.bySeverity.critical.alarms, 3);
    assert.equal(k.devices.total, 8);
    assert.equal(k.devices.online, 3); // the three devices heard from
    assert.equal(k.devices.unknown, 5);
    assert.equal(k.byCompany[0].companyId, 'co-jbk');
    assert.equal(k.byCompany[0].devices.unknown, 5);
    assert.throws(() => hub.kpis({ from: 'not a date' }), HubError);
    const old = hub.kpis({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' });
    assert.equal(old.all.alarms, 0);
    assert.equal(old.all.ackMedianMin, null);
  });

  it('serves the KPIs to operators only', async () => {
    const OP = 'operator-key-for-tests-only-0001';
    const cfg: ServerConfig = { operators: new Map([[OP, 'Test Operator']]), gateway: { key: 'gw', secret: 'gw-secret' }, prima: { key: 'pr', secret: 'pr-secret' } };
    const state = { hub: new Hub(demoDirectory(T0), () => T0), lists: new GateLists(), routes: new Map() };
    const srv = createServer((req, res) => void handler(cfg, state, () => T0.getTime())(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      assert.equal((await fetch(`${base}/api/kpis`)).status, 401);
      const ok = await fetch(`${base}/api/kpis`, { headers: { authorization: `Bearer ${OP}` } });
      assert.equal(ok.status, 200);
      assert.equal(((await ok.json()) as { targetsProposed: boolean }).targetsProposed, true);
      assert.equal((await fetch(`${base}/api/kpis?from=x`, { headers: { authorization: `Bearer ${OP}` } })).status, 400);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
