// P81: the server-side Nominatim queue (geocode.ts). A mocked fetch and a fake clock: no network, no waiting.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Geocoder, GeocodeBusy, GeocodeOff, geocoderFromEnv, reverseKey, searchKey } from '../src/geocode';

function harness(over: { ok?: boolean; body?: (url: string) => unknown; maxQueue?: number } = {}) {
  let clock = 1_000_000;
  const calls: { url: string; at: number; ua: string }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), at: clock, ua: String((init?.headers as Record<string, string>)['User-Agent']) });
    const body = over.body ? over.body(String(url)) : String(url).includes('/reverse') ? { display_name: 'Jalan Ampang, Kuala Lumpur' } : [{ display_name: 'Menara X, Kuala Lumpur', lat: '3.15', lon: '101.71', type: 'building' }];
    return { ok: over.ok !== false, json: async () => body } as Response;
  }) as typeof fetch;
  const g = new Geocoder({
    fetch: fetchFn,
    contact: 'it@example.test',
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    maxQueue: over.maxQueue,
  });
  return { g, calls, tick: (ms: number) => (clock += ms) };
}

describe('Address lookup through Nominatim', () => {
  it('identifies the app and contact, asks Malaysia only, and parses results', async () => {
    const { g, calls } = harness();
    const r = await g.search('  Menara   X ');
    assert.deepEqual(r, [{ label: 'Menara X, Kuala Lumpur', lat: 3.15, lng: 101.71, kind: 'building' }]);
    assert.match(calls[0].ua, /^PrimaSecure\/1\.0 .*it@example\.test/);
    assert.match(calls[0].url, /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
    assert.match(calls[0].url, /q=Menara\+X&/);
    assert.match(calls[0].url, /countrycodes=my/);
    assert.match(calls[0].url, /email=it%40example\.test/);
    assert.equal(await g.reverse(3.15791, 101.71234), 'Jalan Ampang, Kuala Lumpur');
    assert.match(calls[1].url, /lat=3\.1579&lon=101\.7123/);
    // Too short to search: no request at all.
    assert.deepEqual(await g.search('ab'), []);
    assert.equal(calls.length, 2);
  });

  it('waits a second between requests by default, across different questions', async () => {
    const slept: number[] = [];
    let clock = 0;
    const g2 = new Geocoder({ fetch: (async () => ({ ok: true, json: async () => ({ display_name: 'x' }) })) as unknown as typeof fetch, now: () => clock, sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    } });
    await Promise.all([g2.reverse(3.1, 101.1), g2.reverse(3.2, 101.2), g2.search('Kuantan'), g2.reverse(3.3, 101.3)]);
    assert.deepEqual(slept, [1_000, 1_000, 1_000]);
  });

  it('starts requests at least the set interval apart in real time', async () => {
    const at: number[] = [];
    const g = new Geocoder({ minIntervalMs: 60, fetch: (async () => (at.push(Date.now()), { ok: true, json: async () => ({ display_name: 'x' }) })) as unknown as typeof fetch });
    await Promise.all([g.reverse(3.1, 101.1), g.reverse(3.2, 101.2), g.search('Kuantan'), g.reverse(3.3, 101.3)]);
    assert.equal(at.length, 4);
    for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 55, `request ${i} came ${at[i] - at[i - 1]} ms after the one before`);
  });

  it('asks the same question once: concurrent askers share it, later askers get the cache', async () => {
    const { g, calls, tick } = harness();
    const [a, b] = await Promise.all([g.reverse(3.15791, 101.71234), g.reverse(3.15793, 101.71231)]);
    assert.equal(a, b);
    assert.equal(calls.length, 1);
    tick(60_000);
    await g.reverse(3.1579, 101.7123);
    await g.search('kuantan');
    await g.search('  KUANTAN ');
    assert.equal(calls.length, 2);
    assert.equal(g.stats.cached, 2);
    assert.equal(reverseKey(3.15791, 101.71234), reverseKey(3.15794, 101.71226));
    assert.equal(searchKey('A  b'), searchKey(' a B'));
    // A week later the answer is asked again.
    tick(8 * 24 * 3_600_000);
    await g.reverse(3.1579, 101.7123);
    assert.equal(calls.length, 3);
  });

  it('refuses a long queue instead of growing it, and never throws from the address lookup', async () => {
    const { g, calls } = harness({ maxQueue: 2 });
    const searches = Promise.allSettled([g.search('one place'), g.search('two place'), g.search('three place')]);
    const r = await searches;
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 2);
    const refused = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    assert.ok(refused.reason instanceof GeocodeBusy);
    assert.equal(calls.length, 2);
    assert.equal(g.stats.refused, 1);
  });

  it('treats a failed lookup as no address, remembered only briefly', async () => {
    const { g, calls, tick } = harness({ ok: false });
    assert.equal(await g.reverse(3.5, 101.5), null);
    assert.equal(await g.reverse(3.5, 101.5), null);
    assert.equal(calls.length, 1);
    tick(61_000);
    assert.equal(await g.reverse(3.5, 101.5), null);
    assert.equal(calls.length, 2);
  });

  it('can be switched off, and then sends nothing', async () => {
    let sent = 0;
    const g = new Geocoder({ enabled: false, fetch: (async () => (sent++, { ok: true, json: async () => [] })) as unknown as typeof fetch });
    await assert.rejects(g.search('Kuantan'), GeocodeOff);
    assert.equal(await g.reverse(3, 101), null);
    assert.equal(sent, 0);
    assert.equal(geocoderFromEnv({ GEOCODE_ENABLED: 'false' } as NodeJS.ProcessEnv).enabled, false);
    assert.equal(geocoderFromEnv({} as NodeJS.ProcessEnv).enabled, true);
  });
});
