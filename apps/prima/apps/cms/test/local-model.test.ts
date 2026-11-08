// CMS in-house model and what Prima receives (Fauzan, 5 Nov 2026). Sample data only; no model server, Prima or cloud is called.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { makeEvent, type CmsEvent } from '../src/event';
import { demoDirectory } from '../src/demo';
import { Hub } from '../src/hub';
import { assess } from '../src/assistant';
import { briefingPrompt, localModelConfig, shiftBriefing, type LocalModelConfig } from '../src/local-model';
import { flush, recordForPrima } from '../src/prima-link';
import { GateLists } from '../src/adaptors/anpr';
import { handler, type ServerConfig } from '../src/server';

const T0 = new Date('2026-11-05T02:00:00Z');
const CFG: LocalModelConfig = { url: 'http://10.0.0.5:8080', model: 'sample-model', timeoutMs: 1000 };

function busyHub() {
  const hub = new Hub(demoDirectory(T0), () => T0);
  const e = (id: string, kind: CmsEvent['kind'], deviceId: string) =>
    makeEvent({
      id,
      kind,
      companyId: 'co-jbk',
      siteId: 'site-jbk-plaza',
      deviceId,
      source: 'test',
      summary: `${kind} sample`,
      clipUrl: 'https://recorder.plaza.internal/clip/123',
      detail: { zone: '015', plate: 'WXX1234' },
      occurredAt: T0.toISOString(),
      receivedAt: T0.toISOString(),
    });
  hub.ingest(e('e1', 'INTRUSION', 'panel-plaza'));
  hub.ingest(e('e2', 'DOOR_FORCED', 'gate-main'));
  const g = hub.ingest(e('e3', 'GATE_PLATE_UNKNOWN', 'anpr-gate-in')).alarm!;
  hub.actioned(g.id, 'Op', 'Sample Person Acting');
  return hub;
}

describe('in-house model: where it may run', () => {
  it('is off unless both the address and the model name are set', () => {
    assert.equal(localModelConfig({}), null);
    assert.equal(localModelConfig({ CMS_LOCAL_MODEL_URL: 'http://10.0.0.5:8080' }), null);
  });

  it('accepts only private, in-house addresses and refuses any public or cloud service', () => {
    for (const ok of ['http://localhost:11434', 'http://127.0.0.1:8080', 'http://10.1.2.3:8000', 'http://172.20.0.4', 'https://192.168.1.50:8443', 'http://cms-llm.internal:8080', 'http://llm.cms.lan'])
      assert.ok(localModelConfig({ CMS_LOCAL_MODEL_URL: ok, CMS_LOCAL_MODEL_NAME: 'm' }), ok);
    for (const bad of ['https://api.openai.com', 'https://sample.openai.azure.com', 'https://8.8.8.8', 'http://172.32.0.1', 'https://example.com', 'ftp://10.0.0.1', 'http://user:pass@10.0.0.1'])
      assert.throws(() => localModelConfig({ CMS_LOCAL_MODEL_URL: bad, CMS_LOCAL_MODEL_NAME: 'm' }), Error, bad);
  });
});

describe('in-house model: what it is sent and what comes back', () => {
  it('is sent only the screen findings: no phone numbers, no names of people acting, no clip links, no device details', () => {
    const hub = busyHub();
    const p = briefingPrompt(assess(hub, T0.getTime()), T0.getTime());
    const all = p.system + p.user;
    assert.doesNotMatch(all, /\+60|0000 \d{4}/);
    assert.doesNotMatch(all, /Sample Person Acting/);
    assert.doesNotMatch(all, /recorder\.plaza|clip|WXX1234|zone/i);
    assert.match(p.user, /intrusion_confirmed/);
  });

  it('gives "off" with no model, and the briefing text when the in-house server answers, as plain text', async () => {
    const view = assess(busyHub(), T0.getTime());
    assert.deepEqual(await shiftBriefing(view, null, T0.getTime()), { state: 'off' });
    let calledUrl = '';
    let sentBody = '';
    let sentInit: RequestInit | undefined;
    const b = await shiftBriefing(view, CFG, T0.getTime(), async (url, init) => {
      calledUrl = url;
      sentInit = init;
      sentBody = String(init.body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '<b>1.</b> Pencerobohan di Sample Plaza.\nOperator dan syarikat memutuskan tindakan.' } }] }) };
    });
    assert.equal(calledUrl, 'http://10.0.0.5:8080/v1/chat/completions');
    assert.equal(sentInit?.redirect, 'error'); // never follows a redirect elsewhere
    assert.equal(JSON.parse(sentBody).model, 'sample-model');
    assert.equal(b.state, 'ok');
    assert.ok(b.state === 'ok' && !b.text.includes('<b>') && b.text.startsWith('1.'));
  });

  it('fails safely (rules carry on) on an error answer, an empty answer, a dead server or no answer in time', async () => {
    const view = assess(busyHub(), T0.getTime());
    assert.equal((await shiftBriefing(view, CFG, T0.getTime(), async () => ({ ok: false, status: 500, json: async () => ({}) }))).state, 'failed');
    assert.equal((await shiftBriefing(view, CFG, T0.getTime(), async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }))).state, 'failed');
    assert.equal(
      (
        await shiftBriefing(view, CFG, T0.getTime(), async () => {
          throw new Error('ECONNREFUSED');
        })
      ).state,
      'failed',
    );
    const slow = await shiftBriefing(view, { ...CFG, timeoutMs: 1000 }, T0.getTime(), (_url, init) =>
      new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    assert.deepEqual(slow, { state: 'failed', reason: 'Model dalaman tidak menjawab dalam masa.' });
  });

  it('serves the briefing to signed-in operators only, asks the model once a minute at most, and never changes an alarm', async () => {
    const OP = 'operator-key-for-tests-only-0001';
    const hub = busyHub();
    let calls = 0;
    const cfg: ServerConfig = {
      operators: new Map([[OP, 'Test Operator']]),
      gateway: { key: 'gw', secret: 'gw-secret' },
      prima: { key: 'pr', secret: 'pr-secret' },
      localModel: CFG,
      modelFetch: async () => {
        calls++;
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Ringkasan sampel.' } }] }) };
      },
    };
    const state = { hub, lists: new GateLists(), routes: new Map() };
    const srv = createServer((req, res) => void handler(cfg, state, () => T0.getTime())(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const before = JSON.stringify([...hub.alarms.values()]);
      assert.equal((await fetch(`${base}/api/assistant/briefing`)).status, 401);
      const b = (await (await fetch(`${base}/api/assistant/briefing`, { headers: { authorization: `Bearer ${OP}` } })).json()) as { state: string; text: string };
      assert.deepEqual([b.state, b.text], ['ok', 'Ringkasan sampel.']);
      // Several operators pressing at once, or again within a minute, ask the model server once.
      await Promise.all([1, 2, 3].map(() => fetch(`${base}/api/assistant/briefing`, { headers: { authorization: `Bearer ${OP}` } })));
      assert.equal(calls, 1);
      assert.equal(JSON.stringify([...hub.alarms.values()]), before);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

describe('what Prima receives: the company record, never video', () => {
  it('sends Prima what happened without the clip link or raw device details, and says a clip is held in CMS', async () => {
    const hub = busyHub();
    const ev = hub.toPrima[0];
    assert.ok(ev.clipUrl && Object.keys(ev.detail).length);
    const r = recordForPrima(ev);
    assert.equal(r.clipHeldInCms, true);
    assert.equal('clipUrl' in r, false);
    assert.equal('detail' in r, false);
    let body = '';
    const cfg = { url: 'https://prima.example.invalid/api/integrations/cms/v1/events', directoryUrl: 'https://prima.example.invalid/api/integrations/cms/v1/directory', key: 'k', secret: 's' };
    await flush(hub.toPrima, [], cfg, async (_u, init) => {
      body = String(init.body);
      return { ok: false, status: 503 };
    });
    assert.ok(body.length > 0);
    assert.doesNotMatch(body, /clipUrl|recorder\.plaza|"detail"|WXX1234/);
    assert.match(body, /"clipHeldInCms":true/);
  });
});
