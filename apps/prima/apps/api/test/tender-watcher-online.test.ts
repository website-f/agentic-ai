// The tender watcher's reader (AH11): robots file first, https only, public addresses only, same-site redirects only.
// A fake page getter stands in for the web; synthetic pages only, no network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicAddress, readSite, tenderWatcherOn, type PageGet } from "../src/tender-watcher-online";

const PAGE = "https://buyer.example.gov.my/tender";
const HTML = "<table><tr><td>Perkhidmatan Kawalan Keselamatan (mock) BEX/T/2026/1, tutup 15/12/2026</td></tr></table>";
const noWait = async () => {};

function site(pages: Record<string, { status: number; type?: string; body?: string; location?: string }>): { get: PageGet; asked: string[] } {
  const asked: string[] = [];
  const get: PageGet = async (url) => {
    asked.push(url);
    const p = pages[url];
    if (!p) return { status: 404, type: "text/html", body: "", location: null };
    return { status: p.status, type: p.type ?? "text/html; charset=utf-8", body: p.body ?? "", location: p.location ?? null };
  };
  return { get, asked };
}

describe("tender watcher reader", () => {
  it("is off unless switched on", () => {
    assert.equal(tenderWatcherOn({}), false);
    assert.equal(tenderWatcherOn({ TENDER_WATCHER_ENABLED: "yes" }), false);
    assert.equal(tenderWatcherOn({ TENDER_WATCHER_ENABLED: "true" }), true);
  });

  it("reads a page the robots file allows and lists its guarding notices", async () => {
    const s = site({ [PAGE]: { status: 200, body: HTML } });
    const r = await readSite([PAGE], s.get, noWait);
    assert.deepEqual(s.asked, ["https://buyer.example.gov.my/robots.txt", PAGE]);
    assert.equal(r.pages[0].outcome, "READ");
    assert.equal(r.finds.length, 1);
    assert.equal(r.finds[0].closesOn, "2026-12-15");
  });

  it("leaves a page the robots file forbids, or when the robots file cannot be read", async () => {
    const no = site({ "https://buyer.example.gov.my/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /tender" }, [PAGE]: { status: 200, body: HTML } });
    const r1 = await readSite([PAGE], no.get, noWait);
    assert.equal(r1.pages[0].outcome, "NOT_ALLOWED");
    assert.ok(!no.asked.includes(PAGE));
    const broken = site({ "https://buyer.example.gov.my/robots.txt": { status: 503 }, [PAGE]: { status: 200, body: HTML } });
    const r2 = await readSite([PAGE], broken.get, noWait);
    assert.equal(r2.pages[0].outcome, "NOT_ALLOWED");
    assert.ok(!broken.asked.includes(PAGE));
  });

  it("follows a redirect only within the same site, and skips files that are not web pages", async () => {
    const away = site({ [PAGE]: { status: 302, location: "https://other.example.com/x" } });
    assert.equal((await readSite([PAGE], away.get, noWait)).pages[0].note, "moved to another site");
    const moved = site({ [PAGE]: { status: 301, location: "/tender/list" }, "https://buyer.example.gov.my/tender/list": { status: 200, body: HTML } });
    assert.equal((await readSite([PAGE], moved.get, noWait)).pages[0].outcome, "READ");
    const pdf = site({ [PAGE]: { status: 200, type: "application/pdf", body: "%PDF" } });
    assert.equal((await readSite([PAGE], pdf.get, noWait)).pages[0].outcome, "NOT_HTML");
    const down = site({ [PAGE]: { status: 500 } });
    assert.equal((await readSite([PAGE], down.get, noWait)).pages[0].note, "HTTP 500");
  });

  it("waits between requests to a site", async () => {
    const waits: number[] = [];
    const s = site({ [PAGE]: { status: 200, body: HTML }, [`${PAGE}/2`]: { status: 200, body: HTML } });
    await readSite([PAGE, `${PAGE}/2`], s.get, async (ms) => void waits.push(ms));
    assert.equal(waits.length, 2);
    assert.ok(waits.every((w) => w >= 5000));
  });

  it("never contacts a private or local address", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])
      assert.equal(publicAddress(ip), false, ip);
    for (const ip of ["8.8.8.8", "203.106.1.1", "2404:6800:4001::1"]) assert.equal(publicAddress(ip), true, ip);
  });
});
