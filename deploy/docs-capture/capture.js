/**
 * Screenshots, highlight boxes and videos for the in-app User Guide and Presentation.
 *
 * Reads GUIDE_PAGES / GUIDE_FLOWS from apps/web/src/guide/targets.ts, signs in to the demo
 * office (seed_demo.py), and writes apps/web/public/guide-media/{shots,videos,manifest.json}
 * in the shape of apps/web/src/guide/manifest.ts. See README.md for the full sequence.
 *
 *   NODE_PATH=<a node_modules with playwright> node deploy/docs-capture/capture.js
 *     [--base=http://127.0.0.1:8622] [--only=agents,tasks] [--shots-only] [--videos-only]
 *     [--flows=create-agent,approve] [--debug-boxes]
 *
 * --debug-boxes also writes copies with the boxes drawn to deploy/docs-capture/.work/debug/
 * (never shipped).
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const WEB = path.join(ROOT, "apps", "web");
const API_DIR = path.join(ROOT, "apps", "api");
const OUT = path.join(WEB, "public", "guide-media");
const WORK = path.join(__dirname, ".work");
const SERVED = "/guide-media";

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
};
const BASE = arg("base", process.env.CAPTURE_BASE || "http://127.0.0.1:8622");
const ONLY = arg("only", "") ? String(arg("only")).split(",") : null;
const FLOWS = arg("flows", "") ? String(arg("flows")).split(",") : null;
const SHOTS = !arg("videos-only", false);
const VIDEOS = !arg("shots-only", false);
const DEBUG = !!arg("debug-boxes", false);
const CHROME = process.env.CAPTURE_CHROME || "C:/Users/admin/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const PASSWORD = "demo-office-2026";
const USERS = { owner: "owner@demo.example", staff: "farid@demo.example", newStaff: "wani@demo.example", manager: "suresh@demo.example" };

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const MOBILE = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};
const MOBILE_MAX_SCREENS = 2.5; // cap full-page phone shots so files stay small

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Freeze motion, hide the caret and scrollbars: screenshots that look the same every run.
const STILL_CSS = `
*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent !important; }
html { scrollbar-width: none !important; }
::-webkit-scrollbar { display: none !important; }
[data-sonner-toaster] { display: none !important; }
`;

// ------------------------------------------------------------------ browser helpers

/** The browser's clock zone. Malaysia, unless it is night there: then a zone where it is
 * late morning, so greetings and clock times in the shots read like a working day. */
function captureZone() {
  if (process.env.CAPTURE_TZ) return process.env.CAPTURE_TZ;
  const utcH = new Date().getUTCHours();
  const myH = (utcH + 8) % 24;
  if (myH >= 8 && myH <= 18) return "Asia/Kuala_Lumpur";
  let off = 11 - utcH; // hours east of UTC that make it 11:00
  if (off > 14) off -= 24;
  if (off < -12) off += 24;
  return off === 0 ? "UTC" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
}
const ZONE = captureZone();

async function newContext(browser, device, extra = {}) {
  // A documentation-range address, so sign-ins in Activity do not read "127.0.0.1".
  const ctx = await browser.newContext({ ...device, colorScheme: "light", locale: "en-MY", timezoneId: ZONE, extraHTTPHeaders: { "X-Forwarded-For": "203.0.113.24" }, ...extra });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("agentic.theme", "light");
    } catch {}
  });
  return ctx;
}

async function login(ctx, email) {
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD } });
  if (!r.ok()) throw new Error(`login ${email}: ${r.status()} ${await r.text()}`);
}

/** Track API calls in flight (not the live event stream) so we know when a page settled. */
function track(page) {
  const inflight = new Set();
  const errors = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/") && !u.includes("/api/events")) inflight.add(r);
  });
  const done = (r) => inflight.delete(r);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/") && r.status() >= 400 && !u.includes("/api/events")) errors.push(`${r.status()} ${r.request().method()} ${u.replace(BASE, "")}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page._inflight = inflight;
  page._errors = errors;
}

async function settle(page, { quiet = 700, timeout = 20000 } = {}) {
  await page.waitForLoadState("domcontentloaded");
  await page.addStyleTag({ content: STILL_CSS }).catch(() => {});
  const end = Date.now() + timeout;
  let calmSince = 0;
  while (Date.now() < end) {
    const busy =
      page._inflight.size > 0 ||
      (await page
        .evaluate(() => {
          const sk = [...document.querySelectorAll(".animate-pulse.bg-surface-2, [aria-busy='true']")].some((e) => e.getClientRects().length > 0);
          const spinner = [...document.querySelectorAll("button [class*='animate-spin']")].some((e) => e.getClientRects().length > 0);
          return sk || spinner || document.readyState !== "complete";
        })
        .catch(() => true));
    if (busy) calmSince = 0;
    else if (!calmSince) calmSince = Date.now();
    else if (Date.now() - calmSince >= quiet) break;
    await sleep(120);
  }
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await sleep(250);
}

async function goto(page, route) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await settle(page);
}

async function clickGuide(page, id, { inner = null } = {}) {
  const host = page.locator(`[data-guide="${id}"]:visible`).first();
  await host.waitFor({ state: "visible", timeout: 10000 });
  const el = inner ? host.locator(inner).first() : host;
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await settle(page);
}

/** Boxes of the given targets, in CSS px of the viewport (the screenshot is the viewport).
 * A target hidden under a sheet or dialog is left out: sample points must hit it. */
async function measure(page, ids) {
  return page.evaluate((ids) => {
    const out = [];
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const id of ids) {
      for (const el of document.querySelectorAll(`[data-guide="${id}"]`)) {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.width < 4 || r.height < 4 || st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) continue;
        const pts = [[0.5, 0.5], [0.2, 0.25], [0.8, 0.25], [0.2, 0.75], [0.8, 0.75]]
          .map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy])
          .filter(([x, y]) => x >= 0 && y >= 0 && x < vw && y < vh);
        if (!pts.length) continue;
        const hits = pts.filter(([x, y]) => {
          const h = document.elementFromPoint(x, y);
          return h && (h === el || el.contains(h) || h.contains(el));
        }).length;
        if (hits / pts.length < 0.5) continue;
        out.push({ id, x: r.left, y: r.top, w: r.width, h: r.height });
        break;
      }
    }
    return out;
  }, ids);
}

/** Height (CSS px) the shot should have: phones show more of the page (capped), desktops
 * grow only as far as the lowest target needs. Never taller while a sheet/dialog is open. */
async function shotHeight(page, device, ids, isMobile) {
  const info = await page.evaluate((ids) => {
    const dialog = [...document.querySelectorAll("[role=dialog], [aria-modal=true]")].some((e) => e.getClientRects().length > 0);
    let lowest = 0;
    for (const id of ids) {
      const el = [...document.querySelectorAll(`[data-guide="${id}"]`)].find((e) => e.getClientRects().length > 0);
      if (el) lowest = Math.max(lowest, el.getBoundingClientRect().bottom + window.scrollY);
    }
    return { dialog, lowest, doc: document.documentElement.scrollHeight };
  }, ids);
  const vh = device.viewport.height;
  if (info.dialog || info.doc <= vh + 8) return vh;
  if (isMobile) return Math.min(info.doc, Math.round(vh * MOBILE_MAX_SCREENS));
  if (info.lowest <= vh) return vh;
  return Math.min(info.doc, Math.ceil(info.lowest + 40), vh * 2);
}

function toFractions(raw, cssW, cssH) {
  const out = [];
  for (const b of raw) {
    const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
    const x1 = Math.min(cssW, b.x + b.w), y1 = Math.min(cssH, b.y + b.h);
    if (x1 - x0 < 4 || y1 - y0 < 4) continue;
    const shown = ((x1 - x0) * (y1 - y0)) / (b.w * b.h);
    if (shown < 0.25) continue; // mostly off the image: not worth pointing at
    const r = (v) => Math.round(v * 10000) / 10000;
    out.push({ id: b.id, x: r(x0 / cssW), y: r(y0 / cssH), w: r((x1 - x0) / cssW), h: r((y1 - y0) / cssH) });
  }
  return out;
}

// ------------------------------------------------------------------ pages and states

/** How to reach each extra state (GuideState.key) from the page as it opens. */
const STATES = {
  "my-worker:welcome": async (page) => goto(page, "/welcome"),
  "office:agent": async (page) => {
    const nav = page.locator('nav[aria-label="People in the office"] button');
    await nav.first().waitFor({ timeout: 10000 });
    const working = nav.filter({ hasText: /working/i });
    await ((await working.count()) ? working.first() : nav.first()).click();
    await settle(page);
  },
  "agents:new": async (page) => {
    await clickGuide(page, "agents.new");
    await page.waitForURL(/\/agents\/new/);
    await settle(page);
  },
  "agents:detail": async (page) => {
    await clickGuide(page, "agents.card");
    await settle(page);
  },
  "tasks:new": async (page) => clickGuide(page, "tasks.new"),
  "tasks:sheet": async (page) => {
    // A task with a plan, a self-check and a result: the "In review" column.
    const tab = page.locator('[role="tablist"] button:visible, [role="tablist"] [role="tab"]:visible').filter({ hasText: /In review/ }).first();
    if (await tab.count()) {
      await tab.click();
      await settle(page);
    }
    const card = page.locator("[data-guide='tasks.columns'] button:visible").filter({ hasText: "Reconcile fuel card" }).first();
    if (await card.count()) {
      await card.click();
      await settle(page);
    } else await clickGuide(page, "tasks.card");
  },
  "chat:conversation": async (page) => {
    const list = page.locator('[data-guide="chat.agents"]:visible').first();
    await list.waitFor();
    const item = list.locator("a, button").filter({ hasText: /Aisyah/ }).first();
    await ((await item.count()) ? item : list.locator("a, button").first()).click();
    await settle(page);
    // Open the earlier conversation instead of a blank new one.
    const pick = page.getByRole("combobox").filter({ hasText: /New conversation/ }).first();
    if (await pick.count()) {
      await pick.click();
      const opt = page.getByRole("option").filter({ hasText: /Cash position/ }).first();
      if (await opt.count()) await opt.click();
      else await page.keyboard.press("Escape");
      await settle(page);
    }
  },
  "files:sheet": async (page) => {
    const list = page.locator('[data-guide="files.list"]:visible').first();
    await list.waitFor();
    const item = list.locator("a, button, [role=button]").filter({ hasText: /Price list|price list/ }).first();
    await ((await item.count()) ? item : list.locator("a, button, [role=button]").first()).click();
    await settle(page);
  },
  "documents:editor": async (page) => {
    const list = page.locator('[data-guide="documents.list"]:visible').first();
    await list.waitFor();
    const item = list.locator("a, button, [role=button]").filter({ hasText: /Mega Mart/ }).first();
    await ((await item.count()) ? item : list.locator("a, button").first()).click();
    await settle(page);
  },
  "skills:sheet": async (page) => {
    const list = page.locator('[data-guide="skills.list"]:visible').first();
    await list.waitFor();
    const item = list.locator("a, button, [role=button], li").filter({ hasText: "supplier-po-follow-up" }).first();
    await ((await item.count()) ? item : list.locator("a, button").first()).click();
    await settle(page);
  },
  "workflows:editor": async (page) => {
    const list = page.locator('[data-guide="workflows.list"]:visible').first();
    await list.waitFor();
    const item = list.locator("a, button").filter({ hasText: "Customer order to delivery" }).first();
    await ((await item.count()) ? item : list.locator("a, button").first()).click();
    await settle(page);
    await sleep(600);
  },
  "organization:new": async (page) => clickGuide(page, "organization.add"),
  "impact:roi": async (page) => {
    // Far down the page: the shot is the window scrolled to the calculator.
    const roi = page.locator('[data-guide="impact.roi"]:visible').first();
    await roi.waitFor({ timeout: 10000 });
    await roi.evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72 }));
    await sleep(300);
    page._keepScroll = true;
  },
};

// The AI briefing needs a real model; the demo's provider keys are fake, so the capture
// answers that one call with a briefing written from the demo numbers.
const BRIEFING = [
  "- **Nusantara Logistics** carries most of the work (dispatch, collections and quotations); nothing failed this week.",
  "- **5 decisions are waiting on people**, 3 of them in Nusantara: the stretch-film PO on the supplier portal is the most urgent.",
  "- **Harmoni Engineering** leads on site-progress work; Kuantan drainage is 3% behind after rain and a Saturday shift is proposed.",
  "- AI spend stays under US$1 for the week; Nusantara's finance work is the largest share.",
  "- Next: decide the 5 approvals today, then review the Mega Mart quotation before it goes out.",
].join("\n");

/** Extra touches before the shot of a page or state. */
const PREPARE = {
  overview: async (page) => {
    await page.route("**/api/overview/summary**", (route) =>
      route.fulfill({ json: { text: BRIEFING, model: "gpt-4.1-mini", cached: true, generated_at: new Date(Date.now() - 6 * 60000).toISOString() } }),
    );
    const btn = page.locator('[data-guide="overview.briefing"] button:visible').first();
    if (await btn.count()) {
      await btn.click();
      await settle(page);
    }
  },
};

/** Who signs in for a page or state. */
function userFor(pageId, stateKey) {
  if (pageId === "my-worker") return stateKey === "welcome" ? "newStaff" : "staff";
  return "owner";
}

async function captureShots(browser, pages) {
  const shots = {};
  const jobs = [];
  const issues = [];
  fs.mkdirSync(path.join(WORK, "png"), { recursive: true });
  for (const [deviceName, device] of [["desktop", DESKTOP], ["mobile", MOBILE]]) {
    const contexts = {};
    const ctxFor = async (who) => {
      if (!contexts[who]) {
        contexts[who] = await newContext(browser, device);
        await login(contexts[who], USERS[who]);
      }
      return contexts[who];
    };
    for (const p of pages) {
      const variants = [{ key: p.id, state: null }, ...p.states.map((s) => ({ key: `${p.id}:${s.key}`, state: s.key }))];
      for (const v of variants) {
        const ctx = await ctxFor(userFor(p.id, v.state));
        const page = await ctx.newPage();
        track(page);
        try {
          if (!(v.state === "welcome")) await goto(page, p.route);
          if (v.state) {
            const fn = STATES[v.key];
            if (!fn) throw new Error(`no recipe for state ${v.key}`);
            await fn(page);
          }
          if (PREPARE[v.key]) await PREPARE[v.key](page);
          await page.mouse.move(0, 0);
          const vw = device.viewport.width;
          const ids = p.targets.map((t) => t.id);
          if (!page._keepScroll) await page.evaluate(() => window.scrollTo(0, 0));
          // A taller window instead of a full-page shot, so fixed bars sit where they belong.
          const cssH = page._keepScroll ? device.viewport.height : await shotHeight(page, device, ids, deviceName === "mobile");
          if (cssH !== device.viewport.height) {
            await page.setViewportSize({ width: vw, height: cssH });
            await settle(page, { quiet: 400 });
          }
          if (!page._keepScroll) await page.evaluate(() => window.scrollTo(0, 0));
          await sleep(150);
          const raw = await measure(page, ids);
          const boxes = toFractions(raw, vw, cssH);
          const name = `${v.key.replace(":", "-")}-${deviceName}`;
          const png = path.join(WORK, "png", `${name}.png`);
          await page.screenshot({ path: png, animations: "disabled" });
          const scale = device.deviceScaleFactor;
          shots[v.key] = shots[v.key] || {};
          shots[v.key][deviceName] = { src: `${SERVED}/shots/${name}.webp`, w: vw * scale, h: cssH * scale, boxes };
          jobs.push({ src: png, dst: path.join(OUT, "shots", `${name}.webp`), name, boxes, w: vw * scale, h: cssH * scale });
          const missing = ids.filter((id) => !boxes.some((b) => b.id === id));
          const errs = page._errors.filter((e) => !/\/api\/(overview\/summary)/.test(e));
          const toastErr = await page.locator("[data-sonner-toast][data-type=error]").count().catch(() => 0);
          if (errs.length || toastErr) issues.push(`${name}: ${errs.join("; ")}${toastErr ? " [error toast]" : ""}`);
          log(`shot ${name} (${boxes.length}/${ids.length} boxes${missing.length ? `, not on image: ${missing.join(", ")}` : ""})`);
        } catch (e) {
          issues.push(`${v.key} ${deviceName}: ${e.message.split("\n")[0]}`);
          log(`FAILED ${v.key} ${deviceName}: ${e.message.split("\n")[0]}`);
        } finally {
          await page.close();
        }
      }
    }
    for (const c of Object.values(contexts)) await c.close();
  }
  return { shots, jobs, issues };
}

// ------------------------------------------------------------------ encoding and manifest

function runPython(script, argsList) {
  const env = {
    AGENTIC_DATABASE_URL: "postgresql+asyncpg://agentic:agentic_dev@localhost:8506/agentic_demo",
    AGENTIC_VALKEY_URL: "redis://localhost:8507/8",
    AGENTIC_EMBED_BACKEND: "hash",
    AGENTIC_TEMPORAL_TASK_QUEUE: "agentic-office",
    ...process.env,
  };
  return execFileSync("uv", ["run", "python", path.join(__dirname, script), ...argsList], { cwd: API_DIR, encoding: "utf8", env });
}

function encodeShots(jobs) {
  const file = path.join(WORK, "encode-jobs.json");
  fs.writeFileSync(file, JSON.stringify(jobs.map(({ src, dst }) => ({ src, dst }))));
  const res = JSON.parse(runPython("encode_media.py", [file]).trim().split("\n").pop());
  log(`encoded ${res.files} shots, ${(res.bytes / 1e6).toFixed(1)} MB`);
  if (DEBUG) {
    const dbg = path.join(WORK, "debug-jobs.json");
    fs.writeFileSync(dbg, JSON.stringify(jobs.map(({ src, name, boxes, w, h }) => ({ src, dst: path.join(WORK, "debug", `${name}.jpg`), boxes, w, h }))));
    runPython("draw_boxes.py", [dbg]);
    log(`debug copies in ${path.join(WORK, "debug")}`);
  }
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  } catch {
    return { generated_at: "", source: "", shots: {}, videos: {} };
  }
}

function writeManifest(m) {
  m.generated_at = new Date().toISOString();
  m.source = "Sample companies (demo data)";
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(m, null, 1));
}

/** Pictures of two fictional websites, loaded as two agents' live browser screens. */
async function renderFrames(browser) {
  const dir = path.join(WORK, "frames");
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  for (const f of fs.readdirSync(path.join(__dirname, "frames")).filter((n) => n.endsWith(".html"))) {
    await page.goto("file:///" + path.join(__dirname, "frames", f).replace(/\\/g, "/"));
    await page.screenshot({ path: path.join(dir, f.replace(".html", ".jpg")), type: "jpeg", quality: 80 });
  }
  await ctx.close();
  log(runPython("demo_frames.py", [dir]).trim().replace(/\n/g, "; "));
}

// ------------------------------------------------------------------ main

async function main() {
  const targets = await import(path.join(WEB, "src", "guide", "targets.ts").replace(/\\/g, "/").replace(/^([A-Z]):/, "file:///$1:"));
  const pages = targets.GUIDE_PAGES.filter((p) => !ONLY || ONLY.includes(p.id));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const manifest = readManifest();
  const issues = [];
  log(`browser clock zone: ${ZONE}`);
  try {
    await renderFrames(browser);
    if (SHOTS) {
      const r = await captureShots(browser, pages);
      encodeShots(r.jobs);
      if (!ONLY) manifest.shots = {};
      Object.assign(manifest.shots, r.shots);
      issues.push(...r.issues);
      writeManifest(manifest);
    }
    if (VIDEOS) {
      const { recordFlows } = require("./flows.js");
      const flows = targets.GUIDE_FLOWS.filter((f) => !FLOWS || FLOWS.includes(f.id));
      const vids = await recordFlows({ browser, flows, BASE, OUT, WORK, SERVED, USERS, PASSWORD, newContext, login, track, settle, goto, log, sleep, DESKTOP, MOBILE });
      Object.assign(manifest.videos, vids.videos);
      issues.push(...vids.issues);
      writeManifest(manifest);
    }
  } finally {
    await browser.close();
  }
  if (issues.length) {
    console.log("\nThings to look at:");
    for (const i of issues) console.log(" -", i);
  }
  log("manifest:", path.join(OUT, "manifest.json"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
