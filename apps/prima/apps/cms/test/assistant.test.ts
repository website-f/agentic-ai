// CMS monitoring assistant (Fauzan, 5 Nov 2026). Sample data only; no device, Prima, Azure or outside service is used.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { makeEvent, type CmsEvent, type EventKind } from '../src/event';
import type { Directory } from '../src/directory';
import { demoDirectory } from '../src/demo';
import { Hub } from '../src/hub';
import { ASSISTANT_RULES, assess } from '../src/assistant';
import { GateLists } from '../src/adaptors/anpr';
import { handler, type ServerConfig } from '../src/server';

const T0 = new Date('2026-11-05T01:00:00Z');

function clock() {
  let t = T0.getTime();
  return { now: () => new Date(t), add: (min: number) => (t += min * 60_000), ms: () => t };
}

/** The demo directory plus three more sample sites of a second sample company, so group-wide patterns can be tested. */
function bigDirectory(): Directory {
  const d = demoDirectory(T0);
  d.companies.push({ id: 'co-sample', name: 'Sample Security Sdn Bhd', contacts: { company_manager: { name: 'Sample CM 2', phone: '+60 3-0000 0201' } } });
  for (const n of [1, 2, 3]) {
    d.sites.push({ id: `site-s${n}`, companyId: 'co-sample', name: `Sample Site ${n}`, sector: 'private', contacts: { site_supervisor: { name: `Sample Supervisor ${n}`, phone: `+60 3-0000 03${n}0` } } });
    d.devices.push({ id: `cam-s${n}`, siteId: `site-s${n}`, kind: 'camera', silentAfterMin: 10 });
    d.shifts.push({ id: `sh-s${n}`, siteId: `site-s${n}`, postName: 'Gate', guardId: `g-s${n}`, guardName: `Sample Guard S${n}`, start: new Date(T0.getTime() + 60 * 60_000).toISOString(), end: new Date(T0.getTime() + 13 * 60 * 60_000).toISOString() });
  }
  return d;
}

function ev(id: string, kind: EventKind, siteId: string, deviceId: string, at: Date, companyId = 'co-jbk'): CmsEvent {
  return makeEvent({ id, kind, companyId, siteId, deviceId, source: 'test', summary: `${kind} sample`, detail: {}, occurredAt: at.toISOString(), receivedAt: at.toISOString() });
}

function setup(d: Directory = demoDirectory(T0)) {
  const c = clock();
  const hub = new Hub(d, c.now);
  // Every device heard at the start, so only what a test does makes something go offline.
  for (const dev of d.devices) hub.heartbeat(dev.id, c.now());
  return { c, hub, view: () => assess(hub, c.ms()) };
}

describe('monitoring assistant: groups alarms that belong together', () => {
  it('joins a vault door alarm with the vault camera going offline into one critical vault finding at the top', () => {
    const { c, hub, view } = setup();
    c.add(5);
    hub.ingest(ev('e-gate', 'GATE_PLATE_UNKNOWN', 'site-jbk-plaza', 'anpr-gate-in', c.now()));
    c.add(6); // cam-vault-1 silent for 11 minutes, others heard
    for (const id of ['nvr-vault', 'panel-vault', 'cam-gate-1', 'anpr-gate-in', 'gate-main', 'panel-plaza', 'trk-cit-1']) hub.heartbeat(id, c.now());
    hub.tick();
    hub.ingest(ev('e-vault', 'VAULT_DOOR_UNMATCHED', 'site-jbk-vault', 'panel-vault', c.now()));
    const v = view();
    const top = v.findings[0];
    assert.equal(top.pattern, 'vault_risk');
    assert.equal(top.severity, 'critical');
    assert.equal(top.alarmIds.length, 2);
    assert.ok(top.reasons.some((r) => r.startsWith('Gabungan:') && r.includes('kamera atau perakam luar talian')));
    assert.ok(top.suggestions.some((s) => s.includes('penjaga bilik kebal')));
    // Each alarm is in one finding only; the gate alarm stays on its own.
    const ids = v.findings.flatMap((f) => f.alarmIds);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, hub.queue().length);
    assert.equal(v.findings.find((f) => f.title.startsWith('nombor plat tidak dikenali'))?.pattern, 'single');
  });

  it('joins an intrusion with a forced door at the same site, and keeps an intrusion elsewhere on its own', () => {
    const d = bigDirectory();
    d.devices.push({ id: 'panel-s1', siteId: 'site-s1', kind: 'alarm_panel', account: '9001', silentAfterMin: 30 });
    const { c, hub, view } = setup(d);
    hub.ingest(ev('e1', 'INTRUSION', 'site-jbk-plaza', 'panel-plaza', c.now()));
    c.add(3);
    hub.ingest(ev('e2', 'DOOR_FORCED', 'site-jbk-plaza', 'gate-main', c.now()));
    hub.ingest(ev('e3', 'INTRUSION', 'site-s1', 'panel-s1', c.now(), 'co-sample'));
    const v = view();
    assert.equal(v.findings[0].pattern, 'intrusion_confirmed');
    assert.deepEqual(v.findings[0].siteIds, ['site-jbk-plaza']);
    assert.equal(v.findings[1].pattern, 'single');
    assert.deepEqual(v.findings[1].siteIds, ['site-s1']);
    assert.ok(v.findings[0].score > v.findings[1].score);
  });

  it('says the post may be empty on a confirmed intrusion when the guard there is missing (review, 5 Nov)', () => {
    const { c, hub, view } = setup();
    c.add(16); // sh-1 (Main gate) started 30 minutes before T0: no clock-in, so a no-show is raised
    for (const dev of hub.directory.d.devices) hub.heartbeat(dev.id, c.now());
    hub.tick();
    hub.ingest(ev('e1', 'INTRUSION', 'site-jbk-plaza', 'panel-plaza', c.now()));
    hub.ingest(ev('e2', 'DOOR_FORCED', 'site-jbk-plaza', 'gate-main', c.now()));
    const top = view().findings[0];
    assert.equal(top.pattern, 'intrusion_confirmed');
    assert.ok(top.reasons.some((r) => r.startsWith('Pos mungkin kosong')));
    assert.ok(top.suggestions.some((s) => s.includes('pengganti')));
  });

  it('does not join alarms at the same site that are further apart than the window', () => {
    const { c, hub, view } = setup();
    hub.ingest(ev('e1', 'INTRUSION', 'site-jbk-plaza', 'panel-plaza', c.now()));
    c.add(ASSISTANT_RULES.sameSiteWindowMin + 1);
    hub.ingest(ev('e2', 'DOOR_FORCED', 'site-jbk-plaza', 'gate-main', c.now()));
    assert.deepEqual(view().findings.map((f) => f.pattern).sort(), ['single', 'single']);
  });

  it('reads two devices going silent together at one site as a likely power or network cut', () => {
    const { c, hub, view } = setup();
    c.add(11);
    for (const id of ['cam-vault-1', 'nvr-vault', 'panel-vault', 'anpr-gate-in', 'gate-main', 'panel-plaza', 'trk-cit-1']) hub.heartbeat(id, c.now());
    // Only cam-gate-1 is silent so far: one device is not a site cut.
    hub.tick();
    assert.equal(view().findings[0].pattern, 'single');
    c.add(31);
    for (const id of ['cam-vault-1', 'nvr-vault', 'panel-vault', 'trk-cit-1']) hub.heartbeat(id, c.now());
    hub.tick(); // anpr, gate and panel at the plaza now silent too (30 minute window), 31 minutes after the camera
    const f = view().findings.find((x) => x.pattern === 'site_dark');
    assert.ok(f, 'site_dark finding expected');
    assert.equal(f.severity, 'high');
    assert.equal(f.alarmIds.length, 3); // the three that went silent together; the camera 31 minutes earlier stays on its own
    assert.ok(f.suggestions.some((s) => s.includes('elektrik atau internet')));
  });

  it('reads the same alarm at many sites at once as one system fault, and still keeps every alarm in the queue', () => {
    const { c, hub, view } = setup(bigDirectory());
    c.add(60 + 16); // the three sample shifts are past their grace with no clock-in
    for (const dev of hub.directory.d.devices) hub.heartbeat(dev.id, c.now());
    hub.tick();
    const v = view();
    const f = v.findings.find((x) => x.pattern === 'system_wide');
    assert.ok(f, 'system_wide finding expected');
    assert.ok(f.siteIds.length >= ASSISTANT_RULES.wideMinSites);
    assert.ok(f.suggestions[0].includes('suapan kehadiran dan rondaan JA'));
    for (const id of f.alarmIds) assert.equal(hub.alarms.get(id)?.state, 'open');
    assert.equal(hub.queue().length, v.findings.reduce((n, x) => n + x.alarmIds.length, 0));
  });
});

describe('monitoring assistant: ranks with reasons and never decides', () => {
  it('ranks an unacknowledged alarm past its target higher and says why; someone acting moves it down but keeps it', () => {
    const { c, hub, view } = setup();
    const a = hub.ingest(ev('e1', 'GATE_PLATE_BLOCKED', 'site-jbk-plaza', 'anpr-gate-in', c.now())).alarm!;
    const s0 = view().findings[0].score;
    c.add(20);
    const late = view().findings[0];
    assert.ok(late.score > s0);
    assert.ok(late.reasons.some((r) => r.includes('melebihi sasaran')));
    hub.actioned(a.id, 'Op', 'Sample Site Supervisor');
    const acting = view().findings[0];
    assert.ok(acting.score < late.score);
    assert.equal(acting.allActioned, true);
    assert.ok(acting.reasons.some((r) => r.includes('Sample Site Supervisor')));
  });

  it('changes nothing in the hub: alarms, reminders and the audit stay exactly as they were', () => {
    const { c, hub, view } = setup();
    hub.ingest(ev('e1', 'INTRUSION', 'site-jbk-plaza', 'panel-plaza', c.now()));
    hub.ingest(ev('e2', 'DOOR_FORCED', 'site-jbk-plaza', 'gate-main', c.now()));
    c.add(30);
    hub.tick();
    const before = JSON.stringify({ alarms: [...hub.alarms.values()], n: hub.notifications, a: hub.audit, q: hub.toPrima.length });
    view();
    view();
    assert.equal(JSON.stringify({ alarms: [...hub.alarms.values()], n: hub.notifications, a: hub.audit, q: hub.toPrima.length }), before);
    assert.deepEqual(view().limits, { decides: false, commands: false, hidesAlarms: false, outsideService: false, thresholdsProposed: true });
  });

  it('suggests maintenance for a device with many false alarms but never lowers its new alarm', () => {
    const { c, hub, view } = setup();
    const fresh = () => view().findings[0].score;
    hub.ingest(ev('base', 'INTRUSION', 'site-jbk-plaza', 'panel-plaza', c.now()));
    const plain = fresh();
    hub.close([...hub.alarms.values()][0].id, 'Op', 'false', 'Sample: cat in zone');
    for (const n of [1, 2, 3]) {
      c.add(1);
      const a = hub.ingest(ev(`f${n}`, 'INTRUSION', 'site-jbk-plaza', 'panel-plaza', c.now())).alarm!;
      hub.close(a.id, 'Op', 'false', 'Sample: wind');
    }
    c.add(1);
    hub.ingest(ev('new', 'INTRUSION', 'site-jbk-plaza', 'panel-plaza', c.now()));
    const f = view().findings[0];
    assert.ok(f.suggestions.some((s) => s.includes('penyelenggaraan') && s.includes('sebenar')));
    assert.ok(f.score >= plain);
  });

  it('marks a gap (nobody to tell) as a reason and asks the company to fill the role', () => {
    const d = demoDirectory(T0);
    delete d.sites[1].contacts.gate_guard;
    delete d.sites[1].contacts.site_supervisor;
    delete d.companies[0].contacts.company_manager;
    const { c, hub, view } = setup(d);
    hub.ingest(ev('e1', 'GATE_PLATE_UNKNOWN', 'site-jbk-plaza', 'anpr-gate-in', c.now()));
    const f = view().findings[0];
    assert.ok(f.reasons.some((r) => r.includes('jurang')));
    assert.ok(f.suggestions.some((s) => s.includes('mengisi peranan')));
  });

  it('uses no words naming an AI tool on anything the operator reads', () => {
    const { c, hub, view } = setup(bigDirectory());
    hub.ingest(ev('e1', 'INTRUSION', 'site-jbk-plaza', 'panel-plaza', c.now()));
    c.add(80);
    hub.tick();
    const text = JSON.stringify(view());
    assert.doesNotMatch(text, /\b(AI|Claude|GPT|OpenAI|Arisha|LLM)\b/i);
  });
});

describe('monitoring assistant: watches the connected systems', () => {
  it('shows a system never heard from as unknown, never as good', () => {
    const c = clock();
    const hub = new Hub(demoDirectory(T0), c.now);
    const v = assess(hub, c.ms());
    for (const s of v.systems.filter((x) => x.devices.total)) assert.equal(s.state, 'unknown');
  });

  it('shows the JA feed as quiet during a running shift, and watcher-made no-shows never count as the feed being heard', () => {
    const { c, hub, view } = setup();
    hub.clockIn('sh-1', c.now().toISOString());
    c.add(31);
    for (const dev of hub.directory.d.devices) hub.heartbeat(dev.id, c.now());
    hub.tick(); // raises sh-2 no-show and the missed patrol, made by the hub itself
    const ja = view().systems.find((s) => s.system === 'ja_feed')!;
    assert.equal(ja.state, 'quiet');
    assert.ok(ja.note.includes('suapan'));
    hub.checkpoint('pr-1', c.now().toISOString());
    assert.equal(view().systems.find((s) => s.system === 'ja_feed')!.state, 'ok');
  });

  it('flags a system whose messages are being refused, and the Prima link when items wait', () => {
    const { c, hub, view } = setup();
    hub.refuse('sia-dc09', 'unknown account 9999');
    hub.ingest(ev('e1', 'INTRUSION', 'site-jbk-plaza', 'panel-plaza', c.now()));
    const v = view();
    const panels = v.systems.find((s) => s.system === 'alarm_panels')!;
    assert.equal(panels.state, 'attention');
    assert.equal(panels.refused24h, 1);
    assert.equal(v.systems.find((s) => s.system === 'prima')!.state, 'attention');
  });
});

describe('monitoring assistant: operator screen routes', () => {
  const OP = 'operator-key-for-tests-only-0001';
  const cfg: ServerConfig = { operators: new Map([[OP, 'Test Operator']]), gateway: { key: 'gw', secret: 'gw-secret' }, prima: { key: 'pr', secret: 'pr-secret' } };

  it('needs an operator key, and records feedback without changing any alarm', async () => {
    const hub = new Hub(demoDirectory(T0), () => T0);
    hub.ingest(ev('e1', 'INTRUSION', 'site-jbk-plaza', 'panel-plaza', T0));
    const srv = createServer((req, res) => void handler(cfg, { hub, lists: new GateLists(), routes: new Map() }, () => T0.getTime())(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const auth = { authorization: `Bearer ${OP}`, 'content-type': 'application/json' };
    try {
      assert.equal((await fetch(`${base}/api/assistant`)).status, 401);
      const v = (await (await fetch(`${base}/api/assistant`, { headers: auth })).json()) as { findings: { key: string }[] };
      assert.equal(v.findings.length, 1);
      const before = JSON.stringify([...hub.alarms.values()]);
      const post = (body: unknown, headers: Record<string, string> = auth) => fetch(`${base}/api/assistant/feedback`, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal((await post({ key: v.findings[0].key, useful: true }, { 'content-type': 'application/json' })).status, 401);
      assert.equal((await post({ key: v.findings[0].key })).status, 400);
      assert.equal((await post({ key: 'not a key', useful: false })).status, 400);
      assert.equal((await post({ key: v.findings[0].key, useful: false, note: 'Sample: grouped wrongly' })).status, 200);
      const last = hub.audit.at(-1)!;
      assert.equal(last.operator, 'Test Operator');
      assert.equal(last.action, 'assistant:not-useful');
      assert.ok(last.note?.startsWith(v.findings[0].key));
      assert.equal(JSON.stringify([...hub.alarms.values()]), before);
      // Still no command route of any kind.
      for (const p of ['/api/assistant/act', '/api/assistant/command', '/api/gates/gate-main/open'])
        assert.equal((await fetch(base + p, { method: 'POST', headers: auth, body: '{}' })).status, 404);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it('shows the assistant panel in Bahasa Melayu on the dashboard', async () => {
    const { PAGE } = await import('../src/dashboard');
    assert.match(PAGE, /Pembantu Pemantauan/);
    assert.match(PAGE, /Cadangan sahaja/);
    assert.match(PAGE, /Sistem bersambung/);
  });
});
