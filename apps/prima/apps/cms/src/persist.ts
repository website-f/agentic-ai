// Durable state for the CMS app on its own disk (masterplan §193). No database, cloud service or provider: a folder
// given by CMS_STATE_DIR (a mounted volume in hosting) holds three files.
// - state.json: the hub's whole working state, replaced atomically (write a temporary file, flush it to disk, rename).
// - audit.jsonl: operator and system actions, one line each, only ever appended to. Never rewritten or trimmed.
// - hub.lock: the process id of the one hub allowed to run on this folder, so two hubs never send the same reminders.
// A feed call or operator action is answered 2xx only after its change is saved (server.ts), so a restart loses nothing
// that was acknowledged. An unreadable state file stops the start instead of starting empty over it.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { Hub, type AuditEntry, type HubSnapshot } from './hub';
import type { Vehicle, Visitor } from './adaptors/anpr';
import type { Route } from './adaptors/tracker';

/** What the app holds beside the hub: gate lists and tracker routes, so a restart does not wrongly flag every plate. */
export interface AppExtras {
  vehicles: Vehicle[];
  visitors: Visitor[];
  routes: Route[];
}

export class StateStore {
  readonly statePath: string;
  readonly auditPath: string;
  readonly lockPath: string;
  private journalled = 0;
  private locked = false;

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.statePath = join(dir, 'state.json');
    this.auditPath = join(dir, 'audit.jsonl');
    this.lockPath = join(dir, 'hub.lock');
  }

  /** Takes the folder for this process. Refuses while another live process holds it; takes over a lock left by a dead one. */
  lock(pid = process.pid, alive: (pid: number) => boolean = isAlive): void {
    for (let tries = 0; tries < 2; tries++) {
      try {
        const fd = openSync(this.lockPath, 'wx', 0o600);
        writeSync(fd, String(pid));
        fsyncSync(fd);
        closeSync(fd);
        this.locked = true;
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const held = Number(readFileSync(this.lockPath, 'utf8').trim());
        if (Number.isInteger(held) && held > 0 && held !== pid && alive(held))
          throw new Error(`Another CMS hub (process ${held}) is using ${this.dir}. Only one may run on a state folder.`);
        unlinkSync(this.lockPath); // left by a process that has stopped
      }
    }
    throw new Error(`Could not take the lock on ${this.dir}.`);
  }

  unlock(): void {
    if (!this.locked) return;
    this.locked = false;
    try {
      unlinkSync(this.lockPath);
    } catch {
      /* already gone */
    }
  }

  /** The audit journal, oldest first. A line cut short by a crash mid-write is skipped. */
  readJournal(): AuditEntry[] {
    if (!existsSync(this.auditPath)) return [];
    const out: AuditEntry[] = [];
    for (const line of readFileSync(this.auditPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as AuditEntry);
      } catch {
        /* torn last line */
      }
    }
    return out;
  }

  /** The saved hub, or null when there is no saved state yet (first start). */
  load(now?: () => Date): { hub: Hub; app: AppExtras } | null {
    const journal = this.readJournal();
    this.journalled = journal.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
    if (!existsSync(this.statePath)) return null;
    let snap: HubSnapshot & { app?: AppExtras };
    try {
      snap = JSON.parse(readFileSync(this.statePath, 'utf8')) as HubSnapshot & { app?: AppExtras };
    } catch {
      throw new Error(`Saved CMS state at ${this.statePath} is not readable. Not starting over it; move it aside only after checking.`);
    }
    const app = snap.app ?? { vehicles: [], visitors: [], routes: [] };
    return { hub: Hub.restore(snap, journal, now), app };
  }

  /** Saves now: new audit entries are appended first, then the state file is replaced in one step. Throws on failure. */
  save(hub: Hub, app?: AppExtras): void {
    const fresh = hub.audit.filter((e) => (e.seq ?? 0) > this.journalled);
    if (fresh.length) {
      const fd = openSync(this.auditPath, 'a', 0o600);
      try {
        // A torn last line from an earlier crash must not swallow the first new entry.
        const lead = existsSync(this.auditPath) && endsWithoutNewline(this.auditPath) ? '\n' : '';
        writeSync(fd, lead + fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.journalled = fresh[fresh.length - 1].seq ?? this.journalled;
    }
    const tmp = `${this.statePath}.tmp`;
    const fd = openSync(tmp, 'w', 0o600);
    try {
      writeSync(fd, JSON.stringify({ ...hub.exportState(), app }));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.statePath);
    try {
      const d = openSync(this.dir, 'r');
      fsyncSync(d);
      closeSync(d);
    } catch {
      /* some file systems do not allow syncing a folder */
    }
  }
}

function endsWithoutNewline(path: string): boolean {
  const s = readFileSync(path);
  return s.length > 0 && s[s.length - 1] !== 0x0a;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
