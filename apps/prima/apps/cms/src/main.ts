// Starts the CMS app. Production needs: CMS_SIGNIN_SECRET (operators sign in with Microsoft through Prima, E7; the
// operator keys CMS_OPERATOR_KEYS only with CMS_BREAK_GLASS=true), CMS_GATEWAY_KEY/SECRET, PRIMA_TO_CMS_KEY/SECRET, a state
// folder CMS_STATE_DIR (a persistent volume; masterplan §193) and a directory from Prima (CMS_DIRECTORY_FILE, the copy
// in the saved state, or Prima's signed push). CMS_DEMO=true runs with sample data and one-time random keys printed to
// the console, for a local look only; it saves state only when CMS_STATE_DIR is also set.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { directoryProblems, emptyDirectory, type Directory } from './directory';
import { demoDirectory } from './demo';
import { localModelConfig } from './local-model';
import { signInFromEnv } from './signin';
import { Hub } from './hub';
import { GateLists } from './adaptors/anpr';
import type { Route } from './adaptors/tracker';
import { configFromEnv, startDc09, startHttp, type ServerConfig } from './server';
import { STATUS_EVERY_MIN, flush, primaConfig, pullDirectory } from './prima-link';
import { StateStore } from './persist';

function load(): { dir: Directory; cfg: ServerConfig; demo: boolean } {
  const demo = process.env.CMS_DEMO === 'true';
  if (demo) {
    const k = () => randomBytes(18).toString('base64url');
    const op = k();
    console.log(`CMS demo mode. Sample data only. Operator key for this run: ${op}`);
    // The demo keeps a one-time key for a local look; with CMS_SIGNIN_SECRET set it also takes Prima's tickets.
    return { dir: demoDirectory(), demo, cfg: { operators: new Map([[op, 'Demo operator']]), signin: signInFromEnv(process.env, true), gateway: { key: k(), secret: k() }, prima: { key: k(), secret: k() }, localModel: localModelConfig() } };
  }
  const cfg = configFromEnv();
  let dir = emptyDirectory();
  if (process.env.CMS_DIRECTORY_FILE) {
    const d = JSON.parse(readFileSync(process.env.CMS_DIRECTORY_FILE, 'utf8'));
    const bad = directoryProblems(d);
    if (bad.length) throw new Error(`Directory refused: ${bad.slice(0, 5).join('; ')}`);
    dir = d;
  }
  return { dir, cfg, demo };
}

const { dir, cfg, demo } = load();
if (!demo && !process.env.CMS_STATE_DIR) throw new Error('CMS_STATE_DIR is not set: without it a restart loses open alarms and the outbox to Prima.');
const store = process.env.CMS_STATE_DIR ? new StateStore(process.env.CMS_STATE_DIR) : null;
store?.lock();
const restored = store?.load() ?? null;
const hub = restored?.hub ?? new Hub(dir);
// A directory file given at start wins over the copy held in the saved state; Prima's next push or pull replaces both.
if (restored && process.env.CMS_DIRECTORY_FILE) hub.replaceDirectory(dir);
const lists = new GateLists();
const routes = new Map<string, Route>();
if (restored) {
  lists.setVehicles(restored.app.vehicles);
  lists.setVisitors(restored.app.visitors);
  for (const r of restored.app.routes) routes.set(r.trackerId, r);
  console.log(`CMS state restored from ${store!.dir}: ${hub.queue().length} open alarm(s), ${hub.toPrima.length + hub.closedToPrima.length} item(s) to send to Prima.`);
}
const persist = store ? () => store.save(hub, { ...lists.exportLists(), routes: [...routes.values()] }) : undefined;
const saveQuietly = () => {
  try {
    persist?.();
  } catch (e) {
    console.error(`CMS state not saved: ${e instanceof Error ? e.message : e} (the next save keeps everything)`);
  }
};
const state = { hub, lists, routes, persist };
const port = Number(process.env.PORT ?? 8080);
startHttp(cfg, state, port);
if (process.env.CMS_DC09_PORT) startDc09(hub, Number(process.env.CMS_DC09_PORT), persist);
setInterval(() => {
  hub.tick();
  saveQuietly();
}, 15_000);
saveQuietly();
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    saveQuietly();
    store?.unlock();
    process.exit(0);
  });

const prima = primaConfig();
if (prima) {
  setInterval(() => {
    void flush(hub.toPrima, hub.closedToPrima, prima, fetch, hub.primaLink, undefined, undefined, hub.handoversToPrima).then((r) => {
      saveQuietly();
      if (r.error) console.error(`Prima link: ${r.error} (kept for the next try)`);
      if (r.refused) console.error(`Prima link: ${r.refused} item(s) refused by Prima (kept for the next try)`);
    });
  }, 30_000);
  // Device status every STATUS_EVERY_MIN minutes, so Prima can tell covered time from Unknown time.
  setInterval(() => {
    void flush(hub.toPrima, hub.closedToPrima, prima, fetch, hub.primaLink, undefined, () => hub.statusForPrima(), hub.handoversToPrima).then((r) => {
      saveQuietly();
      if (r.error) console.error(`Prima link (status): ${r.error}`);
    });
  }, STATUS_EVERY_MIN * 60_000);
  // The directory from Prima on start and every 10 minutes (Prima can also push it to /ingest/directory).
  const pull = () =>
    void pullDirectory(prima).then((r) => {
      if (r.directory) {
        hub.replaceDirectory(r.directory);
        saveQuietly();
      }
      else console.error(`Prima directory: ${r.error} (keeping the copy already held)`);
    });
  pull();
  setInterval(pull, 10 * 60_000);
}
console.log(`CMS app on port ${port}${prima ? '' : ' (Prima link off: PRIMA_EVENTS_URL not set)'}`);
