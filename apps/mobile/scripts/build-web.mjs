/**
 * P104: builds the app's screens into www/, laid out exactly as the server serves them
 * (deploy/web.Dockerfile + deploy/nginx/web.conf): the office at /, Prima at /prima/ (office mode).
 *
 * Left out (the server serves them; the app fetches them the first time they are needed, see
 * src/bridge.ts): the guide's videos and screenshots, Prima's receipt reader (ocr/) and face
 * models (face-models/), and Prima's no-sign-in preview. Service workers are not used in the app.
 *
 *   node scripts/build-web.mjs            (from apps/mobile; needs apps/web and apps/prima installed)
 *   SKIP_WEB_BUILD=1 node scripts/...     (reuse build/office and build/prima from the last run)
 *   MOBILE_SERVER=http://localhost:8519 ... (a test build against a local API; never for release)
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(dirname(fileURLToPath(import.meta.url))); // apps/mobile
const repo = join(here, "..", "..");
const office = join(repo, "apps", "web");
const primaRoot = join(repo, "apps", "prima");
const primaWeb = join(primaRoot, "apps", "web");
const out = join(here, "build");
const www = join(here, "www");
const app = JSON.parse(readFileSync(join(here, "app.json"), "utf8"));
const server = process.env.MOBILE_SERVER || app.server;
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(server) && !/^http:\/\/localhost(:\d+)?$/.test(server))
  throw new Error(`The server must be https://... (or http://localhost:port for a local test): ${server}`);

/** Runs a project's own Vite (node + its script: no shell, so the path's spaces are safe). */
function vite(project, args, env = {}, root = project) {
  console.log(`> ${relative(repo, project)}: vite ${args.join(" ")}`);
  const own = join(project, "node_modules", "vite", "bin", "vite.js");
  const bin = existsSync(own) ? own : join(root, "node_modules", "vite", "bin", "vite.js");
  execFileSync(process.execPath, [bin, ...args], { cwd: project, stdio: "inherit", env: { ...process.env, ...env } });
}

// ---------------------------------------------------------------- 1. build both web apps
if (!process.env.SKIP_WEB_BUILD) {
  rmSync(out, { recursive: true, force: true });
  vite(office, ["build", "--outDir", join(out, "office"), "--emptyOutDir"]);
  // The feedback widget (/feedback-widget.js), as `pnpm --filter web build` makes it.
  vite(office, ["build", "-c", "vite.widget.config.ts", "--outDir", join(out, "office")]);
  // Prima for the office, as deploy/web.Dockerfile builds it (its API through /api/prima).
  vite(primaWeb, ["build", "--outDir", join(out, "prima"), "--emptyOutDir"], {
    PRIMA_BASE: "/prima/",
    VITE_ALLOW_SAME_ORIGIN_API: "true",
    VITE_API_URL: "/api/prima",
    VITE_OFFICE: "true",
  }, primaRoot); // else Prima's root packages (npm workspaces)
}

// ---------------------------------------------------------------- 2. lay them out like the server
const officeSkip = [/^guide-media[\\/](videos|shots)([\\/]|$)/, /^sw\.js$/, /\.map$/];
const primaSkip = [/^ocr([\\/]|$)/, /^face-models([\\/]|$)/, /^sw\.js$/, /\.map$/];
const copy = (from, to, skip) =>
  cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const rel = relative(from, src);
      return !rel || !skip.some((r) => r.test(rel));
    },
  });

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
copy(join(out, "office"), www, officeSkip);
copy(join(out, "prima"), join(www, "prima"), primaSkip);

// ---------------------------------------------------------------- 3. the bridge, first in each page
await build({
  entryPoints: [join(here, "src", "bridge.ts")],
  bundle: true,
  format: "iife",
  target: ["chrome100", "safari15"],
  minify: true,
  legalComments: "none",
  define: { __SERVER__: JSON.stringify(server) },
  outfile: join(www, "mobile-bridge.js"),
});
for (const page of [join(www, "index.html"), join(www, "prima", "index.html")]) {
  const html = readFileSync(page, "utf8");
  if (!/<head>/i.test(html)) throw new Error(`No <head> in ${page}`);
  writeFileSync(page, html.replace(/<head>/i, '<head>\n    <script src="/mobile-bridge.js"></script>'));
}

// ---------------------------------------------------------------- 4. sizes
function size(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    total += s.isDirectory() ? size(p) : s.size;
  }
  return total;
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`server: ${server}`);
console.log(`www: ${mb(size(www))} (office ${mb(size(www) - size(join(www, "prima")))}, Prima ${mb(size(join(www, "prima")))})`);
if (!existsSync(join(www, "prima", "index.html"))) throw new Error("Prima's page is missing");
