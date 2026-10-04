/**
 * The Guide's short videos (GUIDE_FLOWS in targets.ts), recorded with a visible cursor and
 * chapter marks, then transcoded to H.264 MP4 with a poster frame (Docker ffmpeg).
 * Called by capture.js; the flows that create data (add-company, hire-worker) change the
 * demo database only. Re-seed (refresh.js does) before recording hire-worker again.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const API_DIR = path.resolve(__dirname, "..", "..", "apps", "api");
const FFMPEG_IMAGE = process.env.FFMPEG_IMAGE || "jrottenberg/ffmpeg:6.1-alpine";

// A visible pointer and a ripple on every press, so viewers see where the clicks go.
const CURSOR_JS = `(() => {
  if (window.__demoCursor) return; window.__demoCursor = true;
  const mk = () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.style.cssText = 'position:fixed;left:-40px;top:-40px;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:none;';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-2.6 1.2-3.3-6.6L4 20z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const st = document.createElement('style');
    st.textContent = '@keyframes __rip{from{transform:translate(-50%,-50%) scale(.3);opacity:.55}to{transform:translate(-50%,-50%) scale(1.6);opacity:0}}';
    document.documentElement.appendChild(st);
    addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', e => {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:44px;height:44px;border-radius:50%;background:rgba(19,137,95,.45);border:2px solid rgba(19,137,95,.9);z-index:2147483646;pointer-events:none;animation:__rip .55s ease-out forwards';
      document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700);
    }, true);
  };
  if (document.documentElement) mk(); else addEventListener('DOMContentLoaded', mk);
})();`;

function ffmpeg(dir, argv, entry = null) {
  const docker = ["run", "--rm", "-v", `${dir}:/w`];
  if (entry) docker.push("--entrypoint", entry);
  return execFileSync("docker", [...docker, FFMPEG_IMAGE, ...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function python(script, args) {
  const env = {
    AGENTIC_DATABASE_URL: "postgresql+asyncpg://agentic:agentic_dev@localhost:8506/agentic_demo",
    AGENTIC_VALKEY_URL: "redis://localhost:8507/8",
    AGENTIC_EMBED_BACKEND: "hash",
    AGENTIC_TEMPORAL_TASK_QUEUE: "agentic-office",
    ...process.env,
  };
  return spawn("uv", ["run", "python", path.join(__dirname, script), ...args], { cwd: API_DIR, env, stdio: "ignore", windowsHide: true });
}

async function recordFlows(o) {
  const { browser, flows, OUT, WORK, SERVED, USERS, PASSWORD, newContext, login, track, settle, log, sleep, BASE } = o;
  const videos = {};
  const issues = [];
  const vdir = path.join(WORK, "video");
  fs.mkdirSync(vdir, { recursive: true });
  fs.mkdirSync(path.join(OUT, "videos"), { recursive: true });

  for (const flow of flows) {
    const spec = FLOWS[flow.id];
    if (!spec) {
      issues.push(`no recording script for flow ${flow.id}`);
      continue;
    }
    const mobile = spec.device === "mobile";
    const size = mobile ? { width: 393, height: 852 } : { width: 1280, height: 800 };
    const videoSize = mobile ? { width: 786, height: 1704 } : size;
    const ctx = await newContext(browser, mobile ? { ...o.MOBILE } : { viewport: size, deviceScaleFactor: 1 }, {
      recordVideo: { dir: vdir, size: videoSize },
    });
    await ctx.addInitScript(CURSOR_JS);
    await login(ctx, USERS[spec.user]);
    const page = await ctx.newPage();
    track(page);
    const t0 = Date.now();
    const chapters = [];
    let started = null;
    let mouse = { x: size.width / 2, y: size.height / 2 };
    const h = {
      page,
      sleep,
      settle: () => settle(page, { quiet: 500 }),
      chapter: (label) => chapters.push({ t: (Date.now() - t0) / 1000, label }),
      goto: async (route) => {
        await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
        await settle(page, { quiet: 500 });
        if (started === null) started = (Date.now() - t0) / 1000;
        await page.mouse.move(mouse.x, mouse.y);
      },
      point: async (loc) => {
        await loc.waitFor({ state: "visible", timeout: 15000 });
        await loc.scrollIntoViewIfNeeded();
        const b = await loc.boundingBox();
        const x = b.x + b.width / 2, y = b.y + b.height / 2;
        const steps = Math.max(8, Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 18));
        await page.mouse.move(x, y, { steps });
        mouse = { x, y };
        await sleep(220);
      },
      click: async (loc) => {
        await h.point(loc);
        await page.mouse.down();
        await sleep(90);
        await page.mouse.up();
        await sleep(350);
      },
      type: async (loc, text) => {
        await h.click(loc);
        await loc.pressSequentially(text, { delay: 32 });
        await sleep(300);
      },
      pick: async (label, option, typed = null) => {
        await h.click(page.getByRole("combobox", { name: label }).first());
        await sleep(400);
        if (typed) {
          // Long lists: type to jump (the select's own type-ahead), then choose.
          await page.keyboard.type(typed, { delay: 80 });
          await sleep(500);
          await page.keyboard.press("Enter");
          await sleep(400);
          return;
        }
        await h.click(page.getByRole("option", { name: option }).first());
      },
      scroll: async (dy) => {
        await page.mouse.wheel(0, dy);
        await sleep(700);
      },
      advance: (title, extra = []) => python("demo_advance.py", ["--title", title, ...extra]),
    };
    log(`recording ${flow.id}`);
    try {
      await spec.run(h);
      await sleep(1200);
    } catch (e) {
      issues.push(`video ${flow.id}: ${e.message.split("\n")[0]}`);
      log(`FAILED ${flow.id}: ${e.message.split("\n")[0]}`);
    }
    const video = page.video();
    await ctx.close();
    const raw = await video.path();
    const webm = path.join(vdir, `${flow.id}.webm`);
    fs.renameSync(raw, webm);
    const trim = Math.max(0, (started ?? 0) - 0.2);
    try {
      ffmpeg(vdir, ["-y", "-loglevel", "error", "-ss", trim.toFixed(2), "-i", `/w/${flow.id}.webm`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-crf", mobile ? "30" : "28", "-preset", "veryfast", "-r", "25", "-an", `/w/${flow.id}.mp4`]);
      const dur = parseFloat(ffmpeg(vdir, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `/w/${flow.id}.mp4`], "ffprobe").trim());
      const posterAt = Math.min(dur - 0.5, Math.max(1, (spec.posterAt ?? 0.55) * dur));
      ffmpeg(vdir, ["-y", "-loglevel", "error", "-ss", posterAt.toFixed(2), "-i", `/w/${flow.id}.mp4`, "-frames:v", "1", "-q:v", "3", `/w/${flow.id}-poster.jpg`]);
      fs.copyFileSync(path.join(vdir, `${flow.id}.mp4`), path.join(OUT, "videos", `${flow.id}.mp4`));
      execFileSync("uv", ["run", "python", path.join(__dirname, "encode_media.py"), writeJobs(vdir, flow.id, OUT)], { cwd: API_DIR, encoding: "utf8" });
      const shift = (t) => Math.max(0, Math.round((t - trim) * 10) / 10);
      videos[flow.id] = {
        src: `${SERVED}/videos/${flow.id}.mp4`,
        poster: `${SERVED}/videos/${flow.id}-poster.webp`,
        w: videoSize.width,
        h: videoSize.height,
        duration: Math.round(dur * 10) / 10,
        chapters: chapters.map((c) => ({ t: shift(c.t), label: c.label })),
        device: mobile ? "mobile" : "desktop",
      };
      const mb = fs.statSync(path.join(OUT, "videos", `${flow.id}.mp4`)).size / 1e6;
      log(`video ${flow.id}: ${videos[flow.id].duration}s, ${mb.toFixed(2)} MB, ${chapters.length} chapters`);
    } catch (e) {
      issues.push(`transcode ${flow.id}: ${String(e.stderr || e.message).split("\n")[0]}`);
    }
  }
  return { videos, issues };
}

function writeJobs(vdir, id, OUT) {
  const file = path.join(vdir, `${id}-poster-job.json`);
  fs.writeFileSync(file, JSON.stringify([{ src: path.join(vdir, `${id}-poster.jpg`), dst: path.join(OUT, "videos", `${id}-poster.webp`), quality: 80 }]));
  return file;
}

// ------------------------------------------------------------------ the flows

const g = (page, id) => page.locator(`[data-guide="${id}"]:visible`).first();

const FLOWS = {
  "create-agent": {
    device: "desktop",
    user: "owner",
    posterAt: 0.45,
    run: async (h) => {
      const { page } = h;
      await h.goto("/agents");
      h.chapter("Agents: your AI team, by department");
      await h.sleep(1500);
      await h.click(g(page, "agents.new"));
      await h.settle();
      h.chapter("Pick a starting point");
      await h.sleep(800);
      const card = page.locator("main button[aria-pressed]").filter({ hasText: /Accountant|Finance|Credit/ }).first();
      await h.click((await card.count()) ? card : page.locator("main button[aria-pressed]").first());
      await h.click(page.getByRole("button", { name: /^Next/ }));
      h.chapter("Choose its company and department");
      await h.click(page.locator("main fieldset button").filter({ hasText: /^Finance$/ }).first());
      await h.click(page.getByRole("button", { name: /^Next/ }));
      h.chapter("Give it a name and a job title");
      const name = page.getByLabel("Name", { exact: true });
      await name.fill("");
      await h.type(name, "Nur (Credit Control)");
      const role = page.getByLabel("Job title");
      await role.fill("");
      await h.type(role, "Credit Control Officer");
      await h.click(page.getByRole("button", { name: /^Next/ }));
      h.chapter("SOPs it follows");
      await h.sleep(1400);
      await h.click(page.getByRole("button", { name: /^Next/ }));
      h.chapter("What it may do, and what it must ask first");
      await h.sleep(1600);
      await h.click(page.getByRole("button", { name: /^Next/ }));
      h.chapter("Review and create");
      await h.sleep(1400);
      await h.click(page.getByRole("button", { name: /Create agent/ }));
      await page.waitForURL(/\/agents\/(?!new)/, { timeout: 15000 });
      await h.settle();
      h.chapter("The new agent joins the team");
      await h.sleep(2500);
    },
  },

  "give-task": {
    device: "desktop",
    user: "owner",
    posterAt: 0.75,
    run: async (h) => {
      const { page } = h;
      const title = "Cash summary for the MD: this week";
      await h.goto("/tasks");
      h.chapter("The task board");
      await h.sleep(1300);
      await h.click(g(page, "tasks.new"));
      h.chapter("Say what you need");
      const dlg = page.getByRole("dialog");
      await h.type(dlg.getByLabel("Title", { exact: true }), title);
      await h.type(dlg.getByLabel("Brief", { exact: true }), "Collections this week, what is still due this month and the payments coming up. One table, then the next step.");
      h.chapter("Pick the agent");
      await h.pick("Assign to", /Aisyah \(Finance\)/, "Aisyah");
      h.chapter("Create and start");
      await h.click(page.getByRole("button", { name: /Create and start|Create task/ }));
      await h.settle(); // the new task opens in its sheet by itself
      h.advance(title, ["--pace", "1.3"]);
      h.chapter("Follow the plan, live");
      await h.sleep(4500);
      const sheet = page.locator("[role=dialog]").first();
      await h.point(sheet.getByText("Plan", { exact: true }).first()).catch(() => {});
      await h.sleep(5500);
      h.chapter("The result waits for your review");
      await page.getByRole("button", { name: /Accept/ }).first().waitFor({ timeout: 20000 });
      await h.sleep(800);
      await h.scroll(250);
      await h.sleep(1500);
      await h.click(page.getByRole("button", { name: /Accept/ }).first());
      h.chapter("Accept it");
      await h.sleep(1800);
    },
  },

  approve: {
    device: "desktop",
    user: "owner",
    posterAt: 0.3,
    run: async (h) => {
      const { page } = h;
      const title = "Submit PO on supplier portal: stretch film 120 rolls";
      await h.goto("/approvals");
      h.chapter("Decisions waiting for you");
      await h.sleep(1500);
      const card = page.locator("article").filter({ hasText: title }).first();
      await h.point(card);
      h.chapter("Read what the agent wants to do, and why");
      await h.point(card.getByText(/Why:/).first());
      await h.sleep(1800);
      h.chapter("Approve once");
      await h.click(card.getByRole("button", { name: /Approve once/ }));
      h.advance(title, ["--finish-only", "--pace", "1.0"]);
      await h.settle();
      await h.sleep(1500);
      h.chapter("History keeps every decision");
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await h.sleep(400);
      await h.click(g(page, "approvals.history").getByText("History").first());
      await h.settle();
      await h.sleep(2000);
      h.chapter("The agent carries on and hands in the result");
      await h.goto("/tasks");
      await h.sleep(800);
      await h.click(page.locator("article, a, button, [role=button]").filter({ hasText: title }).first());
      await h.settle();
      await h.sleep(3000);
    },
  },

  "add-company": {
    device: "desktop",
    user: "owner",
    posterAt: 0.55,
    run: async (h) => {
      const { page } = h;
      await h.goto("/organization");
      h.chapter("Your companies");
      await h.sleep(1300);
      await h.click(g(page, "organization.add"));
      h.chapter("Name the company");
      await h.type(page.getByLabel("Company name"), "Permata Retail Sdn Bhd");
      await h.click(page.getByRole("button", { name: /Color #/ }).nth(3));
      h.chapter("Pick its industry: the AI team to match");
      await h.pick("Industry", /Trading/);
      await h.sleep(1800);
      const sw = page.getByRole("switch", { name: /ready-made AI team/ });
      if ((await sw.count()) && (await sw.getAttribute("aria-checked")) === "false") await h.click(sw);
      await h.scroll(300);
      await h.sleep(1200);
      h.chapter("Create it");
      await h.click(page.getByRole("button", { name: /Create branch/ }));
      await h.settle();
      await h.sleep(1500);
      h.chapter("Its AI team is ready, desk by desk");
      await h.goto("/office");
      await h.click(g(page, "office.branch").getByRole("button", { name: /Permata/ }));
      await h.settle();
      await h.sleep(3500);
    },
  },

  "hire-worker": {
    device: "mobile",
    user: "newStaff",
    posterAt: 0.85,
    run: async (h) => {
      const { page } = h;
      const next = () => page.getByRole("button", { name: /^(Next|Create|Continue)/ }).last();
      await h.goto("/welcome");
      h.chapter("Where you work (set by your manager)");
      await h.sleep(1500);
      await h.click(next());
      await h.settle();
      h.chapter("Meet your AI worker");
      await h.sleep(1200);
      const nm = page.getByLabel("Its name");
      if (await nm.count()) {
        await nm.fill("");
        await h.type(nm, "Wani's AI worker");
      }
      const job = page.getByLabel("Job title");
      if (await job.count()) {
        await job.fill("");
        await h.type(job, "Project Assistant (AI)");
      }
      await h.click(next());
      await h.settle();
      h.chapter("Give it a job");
      await h.sleep(800);
      const bp = page.getByRole("radiogroup", { name: "Role blueprint" }).getByText("Site Coordinator", { exact: true }).first();
      if (await bp.count()) await h.click(bp);
      const first = page.getByRole("switch", { name: /first task/ });
      if (await first.count()) {
        if ((await first.getAttribute("aria-checked")) === "false") await h.click(first);
        await h.type(page.getByLabel("Task", { exact: true }), "List this week's open RFIs");
      }
      await h.click(next());
      await h.settle();
      h.chapter("When it works and rests");
      await h.sleep(1800);
      await h.scroll(400);
      await h.click(next());
      await h.settle();
      h.chapter("The offer: check and hire");
      await h.sleep(1500);
      await h.scroll(500);
      await h.click(page.getByRole("button", { name: /^Hire/ }).last());
      await h.settle();
      h.advance("List this week's open RFIs", ["--pace", "1.4"]);
      await h.sleep(1500);
      const go = page.getByRole("button", { name: /at work|Go to|Open/ }).first();
      if (await go.count()) await h.click(go);
      await h.settle();
      h.chapter("Its first day: working on your task");
      await h.sleep(5000);
    },
  },

  "phone-tour": {
    device: "mobile",
    user: "owner",
    posterAt: 0.08,
    run: async (h) => {
      const { page } = h;
      const tab = (name) => page.locator("nav").getByRole("link", { name }).last();
      await h.goto("/");
      h.chapter("Command center: how the office is doing");
      await h.sleep(1500);
      await h.scroll(500);
      await h.scroll(-500);
      h.chapter("Approvals: decide from your phone");
      await h.click(tab(/Approvals/));
      await h.settle();
      await h.sleep(1500);
      await h.scroll(450);
      h.chapter("Tasks: the board, one column at a time");
      await h.click(tab(/Tasks/));
      await h.settle();
      await h.sleep(1200);
      const running = page.locator('[role="tablist"] button, [role="tablist"] [role="tab"]').filter({ hasText: /Running/ }).first();
      if (await running.count()) await h.click(running);
      await h.sleep(600);
      const card = page.locator("[data-guide='tasks.columns'] button:visible").filter({ hasText: /management report|Petty cash|valuation/ }).first();
      await h.click((await card.count()) ? card : g(page, "tasks.card"));
      await h.settle();
      await h.sleep(1500);
      await h.scroll(500);
      await h.sleep(1200);
      await page.keyboard.press("Escape");
      await h.sleep(600);
      h.chapter("Office floor: who is working");
      await h.click(tab(/Office/));
      await h.settle();
      await h.sleep(2500);
      h.chapter("Everything else is under More");
      await h.click(page.getByRole("button", { name: /More/ }).last());
      await h.sleep(2200);
    },
  },
};

module.exports = { recordFlows, FLOWS };
