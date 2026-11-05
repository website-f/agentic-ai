// The CMS event hub: takes every event in the one common format, opens alarms, watches devices, shifts and patrol
// rounds, works out who to tell and when, and keeps the operator's actions on record. The hub works in memory; its
// whole state can be saved and restored (exportState / restore) so a restart keeps open alarms, the outbox to Prima
// and the watchers (masterplan §193; the file store is in persist.ts).
import { newLinkState, type PrimaLinkState } from './prima-link';
import { makeEvent, problems, severityOf, stableId, type CmsEvent, type EventKind } from './event';
import { DirectoryIndex, type Directory, type Role } from './directory';
import { ROUTES, manualLadder, recipients, stepAt, type Recipient } from './routing';

export type AlarmState = 'open' | 'acknowledged' | 'actioned' | 'closed';

export interface Alarm {
  id: string;
  kind: EventKind;
  severity: CmsEvent['severity'];
  companyId: string;
  siteId: string;
  deviceId: string;
  summary: string;
  openedAt: string;
  state: AlarmState;
  eventIds: string[];
  /** How many times the same thing was reported while this alarm was open. */
  repeats: number;
  restoredAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  /** Who in the field is acting on it, as told to the operator. Repeats stop once someone acts. */
  actionBy: string | null;
  actionAt: string | null;
  outcome: 'real' | 'false' | null;
  closingNote: string | null;
  closedBy: string | null;
  closedAt: string | null;
  /** Roles told by the operator's own escalation above the Regional OM. */
  manualEscalations: Role[];
  /** System lines in the alarm's history, such as "CMS restarted at ...". */
  notes?: { at: string; text: string }[];
}

export interface Notification {
  id: string;
  alarmId: string;
  at: string;
  step: number;
  attempt: number;
  to: Recipient;
  message: string;
}

export interface Problem {
  at: string;
  alarmId: string;
  /** Roles the plan names but nobody fills at this site: a gap the company must fix. */
  missingRoles: Role[];
}

export interface AuditEntry {
  at: string;
  operator: string;
  action: string;
  alarmId?: string;
  note?: string;
  /** Running number, so the append-only audit journal never writes an entry twice. */
  seq?: number;
}

/** Everything the hub needs to carry on after a restart (masterplan §193). Plain JSON. */
export interface HubSnapshot {
  version: 1;
  savedAt: string;
  directory: Directory;
  events: CmsEvent[];
  alarms: Alarm[];
  notifications: Notification[];
  gaps: Problem[];
  refused: { at: string; source: string; reason: string }[];
  /** Event ids and alarm ids still to be sent to Prima, in order. */
  toPrima: string[];
  closedToPrima: string[];
  link: { attempts: [string, number][]; parked: PrimaLinkState['parked'] };
  lastSeen: [string, number][];
  offline: string[];
  clockIns: [string, string][];
  scans: [string, string][];
  raised: string[];
  sentKeys: string[];
}

/** PROPOSED response targets in minutes (owner to confirm, masterplan §195). */
export const KPI_TARGETS = {
  acknowledge: { critical: 2, high: 5, normal: 15, info: 15 },
  act: { critical: 10, high: 20, normal: 60, info: 60 },
} as const;

/** How long the saved state keeps finished records (the append-only audit journal keeps everything). */
export const KEEP = { days: 7, notifications: 2000, gaps: 1000, audit: 5000 } as const;

export interface KpiFigures {
  alarms: number;
  acknowledged: number;
  ackMedianMin: number | null;
  ackP90Min: number | null;
  ackOverTarget: number;
  actioned: number;
  actMedianMin: number | null;
  actP90Min: number | null;
  actOverTarget: number;
  closed: number;
  closeMedianMin: number | null;
  falseAlarms: number;
  falseRatePct: number | null;
  repeats: number;
  /** Not closed and not acknowledged, older than the acknowledge target now. */
  waitingOverTarget: number;
}

export interface Kpis {
  from: string;
  to: string;
  targets: typeof KPI_TARGETS;
  targetsProposed: true;
  all: KpiFigures;
  bySeverity: Record<'critical' | 'high' | 'normal', KpiFigures>;
  devices: { total: number; online: number; offline: number; unknown: number; unknownPct: number | null };
  gaps: number;
  toPrimaWaiting: number;
  primaParked: number;
  byCompany: { companyId: string; figures: KpiFigures; devices: { total: number; online: number; offline: number; unknown: number } }[];
}

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[i] * 10) / 10;
}

export class HubError extends Error {}

/** Malaysia time (UTC+8, no daylight saving) for words the operator and field staff read. */
export function myt(ms: number): string {
  return `${new Date(ms + 8 * 3_600_000).toISOString().slice(11, 16)} MYT`;
}

export class Hub {
  private dir: DirectoryIndex;
  private readonly events = new Map<string, CmsEvent>();
  readonly alarms = new Map<string, Alarm>();
  readonly notifications: Notification[] = [];
  readonly gaps: Problem[] = [];
  readonly audit: AuditEntry[] = [];
  /** Events waiting to be sent to Prima's signed endpoint. */
  readonly toPrima: CmsEvent[] = [];
  /** Closed alarms waiting to be sent to Prima. */
  readonly closedToPrima: Alarm[] = [];
  readonly refused: { at: string; source: string; reason: string }[] = [];
  /** Sending to Prima: one send at a time, retry counts, and items Prima kept refusing (never silently dropped). */
  readonly primaLink: PrimaLinkState = newLinkState();
  private readonly lastSeen = new Map<string, number>();
  private readonly offline = new Set<string>();
  private readonly clockIns = new Map<string, string>(); // shiftId -> time
  private readonly scans = new Map<string, string>(); // patrolRoundId -> time
  private readonly raised = new Set<string>(); // keys of watcher events already raised
  private readonly sentKeys = new Set<string>();
  private readonly startedAt: number;
  private auditSeq = 0;

  constructor(directory: Directory, private readonly now: () => Date = () => new Date()) {
    this.dir = new DirectoryIndex(directory);
    this.startedAt = this.now().getTime();
  }

  get directory(): DirectoryIndex {
    return this.dir;
  }

  /** A newer copy from Prima. Open alarms stay open. */
  replaceDirectory(d: Directory): void {
    this.dir = new DirectoryIndex(d);
  }

  refuse(source: string, reason: string): void {
    this.refused.push({ at: this.now().toISOString(), source, reason });
    if (this.refused.length > 1000) this.refused.shift();
  }

  /** Every audit entry goes through here: numbered, and only the newest KEEP.audit stay in memory (all are journalled). */
  private record(e: AuditEntry): void {
    this.audit.push({ ...e, seq: ++this.auditSeq });
    if (this.audit.length > KEEP.audit) this.audit.splice(0, this.audit.length - KEEP.audit);
  }

  /** Records that a device is alive. Coming back after an outage raises DEVICE_ONLINE. */
  heartbeat(deviceId: string, at = this.now()): void {
    if (!this.dir.devices.has(deviceId)) return;
    this.lastSeen.set(deviceId, at.getTime());
    if (this.offline.delete(deviceId)) {
      const dev = this.dir.devices.get(deviceId)!;
      const site = this.dir.sites.get(dev.siteId)!;
      this.ingest(
        makeEvent({
          id: stableId('online', deviceId, at.toISOString()),
          kind: 'DEVICE_ONLINE',
          companyId: site.companyId,
          siteId: site.id,
          deviceId,
          source: 'hub',
          summary: `${dev.kind} ${deviceId} back online at ${site.name}`,
          detail: {},
          occurredAt: at.toISOString(),
          receivedAt: at.toISOString(),
        }),
      );
    }
  }

  /** One event in. Returns the alarm it opened or joined, if any. Refused events are logged, never stored. */
  ingest(raw: CmsEvent): { stored: boolean; duplicate?: boolean; alarm?: Alarm; refused?: string[] } {
    const bad = problems(raw);
    // Severity comes from the kind, never from the sender: an INTRUSION marked "info" is still an intrusion.
    const e: CmsEvent = bad.length ? raw : { ...raw, severity: severityOf(raw.kind) };
    if (!bad.length && !this.dir.sites.has(e.siteId)) bad.push(`site ${e.siteId} not in the directory`);
    if (!bad.length && this.dir.sites.get(e.siteId)!.companyId !== e.companyId) bad.push('company does not own that site');
    // A device in the directory belongs to one site: an event naming it from another site is refused, so it can never
    // mark that other site's device online.
    const dev = bad.length ? undefined : this.dir.devices.get(e.deviceId);
    if (dev && dev.siteId !== e.siteId) bad.push(`device ${e.deviceId} belongs to another site`);
    if (bad.length) {
      this.refuse(e?.source ?? 'unknown', bad.join('; '));
      return { stored: false, refused: bad };
    }
    if (this.events.has(e.id)) return { stored: false, duplicate: true };
    this.events.set(e.id, e);
    if (this.dir.devices.has(e.deviceId)) this.lastSeen.set(e.deviceId, Math.max(this.lastSeen.get(e.deviceId) ?? 0, this.now().getTime()));
    if (e.severity !== 'info') this.toPrima.push(e);

    if (e.kind === 'ALARM_RESTORED' || e.kind === 'DEVICE_ONLINE') {
      for (const a of this.alarms.values())
        if (a.state !== 'closed' && a.siteId === e.siteId && a.deviceId === e.deviceId && !a.restoredAt) a.restoredAt = e.occurredAt;
      return { stored: true };
    }
    if (!ROUTES[e.kind]) return { stored: true };
    const same = [...this.alarms.values()].find((a) => a.state !== 'closed' && a.kind === e.kind && a.siteId === e.siteId && a.deviceId === e.deviceId);
    if (same) {
      same.eventIds.push(e.id);
      same.repeats += 1;
      return { stored: true, alarm: same };
    }
    const alarm: Alarm = {
      id: stableId('alarm', e.id),
      kind: e.kind,
      severity: e.severity,
      companyId: e.companyId,
      siteId: e.siteId,
      deviceId: e.deviceId,
      summary: e.summary,
      openedAt: this.now().toISOString(),
      state: 'open',
      eventIds: [e.id],
      repeats: 0,
      restoredAt: null,
      acknowledgedBy: null,
      acknowledgedAt: null,
      actionBy: null,
      actionAt: null,
      outcome: null,
      closingNote: null,
      closedBy: null,
      closedAt: null,
      manualEscalations: [],
    };
    this.alarms.set(alarm.id, alarm);
    this.notify(alarm, this.now());
    return { stored: true, alarm };
  }

  // ---- Guard attendance and patrols (JA app feed). CMS watches; the company acts. ----

  clockIn(shiftId: string, at: string): boolean {
    const sh = this.dir.d.shifts.find((s) => s.id === shiftId);
    if (!sh || Number.isNaN(Date.parse(at))) return false;
    if (!this.clockIns.has(shiftId)) this.clockIns.set(shiftId, at);
    const site = this.dir.sites.get(sh.siteId)!;
    this.ingest(
      makeEvent({
        id: stableId('clockin', shiftId),
        kind: 'GUARD_CLOCKED_IN',
        companyId: site.companyId,
        siteId: site.id,
        deviceId: 'ja-app',
        source: 'ja-feed',
        summary: `${sh.guardName} clocked in at ${sh.postName}`,
        detail: { shiftId, guardId: sh.guardId },
        occurredAt: at,
      }),
    );
    // A late clock-in answers the no-show: the alarm is marked actioned by the guard, and the operator still closes it.
    for (const a of this.alarms.values())
      if (a.kind === 'GUARD_NO_SHOW' && a.state !== 'closed' && a.eventIds.includes(stableId('noshow', shiftId)) && !a.actionBy) {
        a.actionBy = `${sh.guardName} (clocked in)`;
        a.actionAt = at;
        a.state = 'actioned';
      }
    return true;
  }

  checkpoint(roundId: string, at: string): boolean {
    const r = this.dir.d.patrolRounds.find((x) => x.id === roundId);
    if (!r || Number.isNaN(Date.parse(at))) return false;
    if (!this.scans.has(roundId)) this.scans.set(roundId, at);
    return true;
  }

  /** Runs the watchers and sends what is due. Call every minute. */
  tick(): void {
    const now = this.now();
    const t = now.getTime();
    const iso = now.toISOString();

    for (const dev of this.dir.d.devices) {
      const seen = this.lastSeen.get(dev.id) ?? this.startedAt;
      if (!this.offline.has(dev.id) && t - seen > dev.silentAfterMin * 60_000) {
        this.offline.add(dev.id);
        const site = this.dir.sites.get(dev.siteId)!;
        this.ingest(
          makeEvent({
            id: stableId('offline', dev.id, String(seen)),
            kind: 'DEVICE_OFFLINE',
            companyId: site.companyId,
            siteId: site.id,
            deviceId: dev.id,
            source: 'hub',
            summary: `${dev.kind} ${dev.id} silent for over ${dev.silentAfterMin} minutes at ${site.name}`,
            detail: { lastSeen: this.lastSeen.has(dev.id) ? new Date(seen).toISOString() : null },
            occurredAt: iso,
          }),
        );
      }
    }

    for (const sh of this.dir.d.shifts) {
      const site = this.dir.sites.get(sh.siteId);
      if (!site) continue;
      const grace = (site.clockInGraceMin ?? 15) * 60_000; // PROPOSED default 15 minutes
      if (t > Date.parse(sh.start) + grace && t < Date.parse(sh.end) && !this.clockIns.has(sh.id) && !this.raised.has(`noshow:${sh.id}`)) {
        this.raised.add(`noshow:${sh.id}`);
        this.ingest(
          makeEvent({
            id: stableId('noshow', sh.id),
            kind: 'GUARD_NO_SHOW',
            companyId: site.companyId,
            siteId: site.id,
            deviceId: `post:${sh.postName}`,
            source: 'ja-feed',
            summary: `${sh.guardName} not clocked in at ${sh.postName}, ${site.name}`,
            detail: { shiftId: sh.id, guardId: sh.guardId },
            occurredAt: iso,
          }),
        );
      }
    }

    for (const r of this.dir.d.patrolRounds) {
      const site = this.dir.sites.get(r.siteId);
      if (!site) continue;
      if (t > Date.parse(r.dueAt) + r.lateAfterMin * 60_000 && !this.scans.has(r.id) && !this.raised.has(`patrol:${r.id}`)) {
        this.raised.add(`patrol:${r.id}`);
        this.ingest(
          makeEvent({
            id: stableId('patrol', r.id),
            kind: 'PATROL_MISSED',
            companyId: site.companyId,
            siteId: site.id,
            deviceId: `checkpoint:${r.checkpointId}`,
            source: 'ja-feed',
            summary: `Checkpoint ${r.checkpointName} not scanned by ${myt(Date.parse(r.dueAt) + r.lateAfterMin * 60_000)} at ${site.name}`,
            detail: { roundId: r.id, guardId: r.guardId },
            occurredAt: iso,
          }),
        );
      }
    }

    for (const a of this.alarms.values()) if (a.state === 'open' || a.state === 'acknowledged') this.notify(a, now);
  }

  private notify(a: Alarm, now: Date): void {
    const plan = ROUTES[a.kind];
    if (!plan) return;
    const mins = (now.getTime() - Date.parse(a.openedAt)) / 60_000;
    const idx = stepAt(plan, mins);
    const step = plan.steps[idx];
    const attempt = Math.max(0, Math.floor((mins - step.atMin) / plan.repeatMin));
    const key = `${a.id}:${idx}:${attempt}`;
    if (this.sentKeys.has(key)) return;
    this.sentKeys.add(key);
    const { to, missing } = recipients(step, a.siteId, this.dir);
    if (missing.length) this.gaps.push({ at: now.toISOString(), alarmId: a.id, missingRoles: missing });
    for (const r of to)
      this.notifications.push({
        id: stableId('note', key, r.role),
        alarmId: a.id,
        at: now.toISOString(),
        step: idx,
        attempt,
        to: r,
        message: `CMS: ${a.summary}. ${plan.ask}${attempt ? ` (reminder ${attempt})` : ''}`,
      });
  }

  // ---- Operator actions. Every one is on record with who, when and why. ----

  private get(id: string): Alarm {
    const a = this.alarms.get(id);
    if (!a) throw new HubError('Alarm not found.');
    return a;
  }

  acknowledge(id: string, operator: string): Alarm {
    const a = this.get(id);
    if (a.state === 'closed') throw new HubError('Alarm already closed.');
    if (a.state === 'open') {
      a.state = 'acknowledged';
      a.acknowledgedBy = operator;
      a.acknowledgedAt = this.now().toISOString();
    }
    this.record({ at: this.now().toISOString(), operator, action: 'acknowledge', alarmId: id });
    return a;
  }

  /** The operator records who in the field is acting on it. Reminders stop. */
  actioned(id: string, operator: string, by: string): Alarm {
    const a = this.get(id);
    if (a.state === 'closed') throw new HubError('Alarm already closed.');
    if (!by.trim()) throw new HubError('Say who is acting on it.');
    a.state = 'actioned';
    a.actionBy = by.trim();
    a.actionAt = this.now().toISOString();
    a.acknowledgedBy ??= operator;
    a.acknowledgedAt ??= a.actionAt;
    this.record({ at: a.actionAt, operator, action: 'actioned', alarmId: id, note: a.actionBy });
    return a;
  }

  /** Real or false, always with a note. A real alarm is sent to Prima to open the company's own case. */
  close(id: string, operator: string, outcome: 'real' | 'false', note: string): Alarm {
    const a = this.get(id);
    if (a.state === 'closed') throw new HubError('Alarm already closed.');
    if (outcome !== 'real' && outcome !== 'false') throw new HubError('Outcome must be real or false.');
    if (!note.trim()) throw new HubError('A note is required to close an alarm.');
    a.state = 'closed';
    a.outcome = outcome;
    a.closingNote = note.trim();
    a.closedBy = operator;
    a.closedAt = this.now().toISOString();
    this.record({ at: a.closedAt, operator, action: `close:${outcome}`, alarmId: id, note: a.closingNote });
    this.closedToPrima.push(a);
    return a;
  }

  /** Above the Regional OM, only when the operator chooses, with a reason: OGM or Operations Director, then COO, then CEO. */
  escalate(id: string, operator: string, reason: string): Role {
    const a = this.get(id);
    if (a.state === 'closed') throw new HubError('Alarm already closed.');
    if (!reason.trim()) throw new HubError('A reason is required to escalate.');
    const site = this.dir.sites.get(a.siteId)!;
    const next = manualLadder(site.sector).find((r) => !a.manualEscalations.includes(r));
    if (!next) throw new HubError('Already escalated to the CEO.');
    a.manualEscalations.push(next);
    const now = this.now();
    const c = this.dir.contact(a.siteId, next);
    if (c)
      this.notifications.push({
        id: stableId('esc', a.id, next),
        alarmId: a.id,
        at: now.toISOString(),
        step: -1,
        attempt: 0,
        to: { role: next, ...c },
        message: `CMS escalation: ${a.summary}. Reason: ${reason.trim()}`,
      });
    else this.gaps.push({ at: now.toISOString(), alarmId: a.id, missingRoles: [next] });
    this.record({ at: now.toISOString(), operator, action: `escalate:${next}`, alarmId: id, note: reason.trim() });
    return next;
  }

  /** The alarm queue: open ones first, most severe first, oldest first within a severity. */
  queue(): Alarm[] {
    const rank = { critical: 0, high: 1, normal: 2, info: 3 } as const;
    const st = { open: 0, acknowledged: 1, actioned: 2, closed: 3 } as const;
    return [...this.alarms.values()]
      .filter((a) => a.state !== 'closed')
      .sort((x, y) => st[x.state] - st[y.state] || rank[x.severity] - rank[y.severity] || Date.parse(x.openedAt) - Date.parse(y.openedAt));
  }

  /**
   * The device status sent to Prima as evidence: online only when heard within the device's silent window (and not in
   * the future), offline when the hub raised DEVICE_OFFLINE, otherwise unknown.
   */
  statusForPrima(): { at: string; devices: { deviceId: string; state: 'online' | 'offline' | 'unknown' }[] } {
    const t = this.now().getTime();
    return {
      at: new Date(t).toISOString(),
      devices: this.dir.d.devices.map((d) => {
        const seen = this.lastSeen.get(d.id);
        const fresh = seen !== undefined && seen <= t && t - seen <= d.silentAfterMin * 60_000;
        return { deviceId: d.id, state: this.offline.has(d.id) ? 'offline' : fresh ? 'online' : 'unknown' };
      }),
    };
  }

  /** Never heard from = unknown, never green (masterplan V15: UNKNOWN is not green). */
  deviceHealth(): { deviceId: string; siteId: string; kind: string; state: 'online' | 'offline' | 'unknown'; lastSeen: string | null }[] {
    return this.dir.d.devices.map((d) => ({
      deviceId: d.id,
      siteId: d.siteId,
      kind: d.kind,
      state: this.offline.has(d.id) ? 'offline' : this.lastSeen.has(d.id) ? 'online' : 'unknown',
      lastSeen: this.lastSeen.has(d.id) ? new Date(this.lastSeen.get(d.id)!).toISOString() : null,
    }));
  }

  /** A site is live only when every camera and recorder on it is online (masterplan V13, CMS rule 25 Oct 2026). */
  siteLive(siteId: string): boolean {
    const vids = this.dir.d.devices.filter((d) => d.siteId === siteId && (d.kind === 'camera' || d.kind === 'recorder'));
    return vids.length > 0 && vids.every((d) => this.lastSeen.has(d.id) && !this.offline.has(d.id));
  }

  recentEvents(limit = 100): CmsEvent[] {
    return [...this.events.values()].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)).slice(0, limit);
  }

  // ---- Saving and restarting (masterplan §193). ----

  /** Drops finished records past the keep period. Open alarms, their events and anything still to send stay. */
  compact(): void {
    const cutoff = this.now().getTime() - KEEP.days * 86_400_000;
    const outbox = new Set(this.closedToPrima.map((a) => a.id));
    for (const [id, a] of this.alarms)
      if (a.state === 'closed' && a.closedAt && Date.parse(a.closedAt) < cutoff && !outbox.has(id)) this.alarms.delete(id);
    const keepEvents = new Set(this.toPrima.map((e) => e.id));
    for (const a of this.alarms.values()) for (const id of a.eventIds) keepEvents.add(id);
    for (const [id, e] of this.events) if (Date.parse(e.receivedAt) < cutoff && !keepEvents.has(id)) this.events.delete(id);
    if (this.notifications.length > KEEP.notifications) this.notifications.splice(0, this.notifications.length - KEEP.notifications);
    if (this.gaps.length > KEEP.gaps) this.gaps.splice(0, this.gaps.length - KEEP.gaps);
    for (const k of this.sentKeys) if (!this.alarms.has(k.slice(0, k.indexOf(':')))) this.sentKeys.delete(k);
    // Watcher keys are dropped only once the shift or round has left the directory, so nothing is raised twice.
    const shifts = new Set(this.dir.d.shifts.map((x) => x.id));
    const rounds = new Set(this.dir.d.patrolRounds.map((x) => x.id));
    for (const k of this.clockIns.keys()) if (!shifts.has(k)) this.clockIns.delete(k);
    for (const k of this.scans.keys()) if (!rounds.has(k)) this.scans.delete(k);
    for (const k of this.raised) {
      const [what, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      if ((what === 'noshow' && !shifts.has(id)) || (what === 'patrol' && !rounds.has(id))) this.raised.delete(k);
    }
  }

  /** The whole working state as plain JSON. The audit trail is not in it: it goes to its own append-only journal. */
  exportState(): HubSnapshot {
    this.compact();
    return {
      version: 1,
      savedAt: this.now().toISOString(),
      directory: this.dir.d,
      events: [...this.events.values()],
      alarms: [...this.alarms.values()],
      notifications: this.notifications,
      gaps: this.gaps,
      refused: this.refused,
      toPrima: this.toPrima.map((e) => e.id),
      closedToPrima: this.closedToPrima.map((a) => a.id),
      link: { attempts: [...this.primaLink.attempts], parked: this.primaLink.parked },
      lastSeen: [...this.lastSeen],
      offline: [...this.offline],
      clockIns: [...this.clockIns],
      scans: [...this.scans],
      raised: [...this.raised],
      sentKeys: [...this.sentKeys],
    };
  }

  /**
   * Starts a hub from a saved state after a restart. Open alarms stay open with a "CMS restarted" line; a reminder that
   * fell due while CMS was down is sent once on the next tick (never once per missed repeat); a device whose last
   * heartbeat is older than its silent window shows Unknown, never online, and its window runs again from the restart.
   */
  static restore(snap: HubSnapshot, journal: AuditEntry[], now: () => Date = () => new Date()): Hub {
    if (!snap || snap.version !== 1 || !snap.directory || !Array.isArray(snap.alarms) || !Array.isArray(snap.events))
      throw new Error('Saved CMS state is not readable (version 1 expected). Not starting over it.');
    const hub = new Hub(snap.directory, now);
    for (const e of snap.events) hub.events.set(e.id, e);
    for (const a of snap.alarms) hub.alarms.set(a.id, a);
    hub.notifications.push(...snap.notifications);
    hub.gaps.push(...snap.gaps);
    hub.refused.push(...snap.refused);
    for (const id of snap.toPrima) {
      const e = hub.events.get(id);
      if (e) hub.toPrima.push(e);
    }
    for (const id of snap.closedToPrima) {
      const a = hub.alarms.get(id);
      if (a) hub.closedToPrima.push(a);
    }
    for (const [k, n] of snap.link.attempts) hub.primaLink.attempts.set(k, n);
    hub.primaLink.parked.push(...snap.link.parked);
    for (const id of snap.offline) hub.offline.add(id);
    const t = hub.startedAt;
    for (const [id, seen] of snap.lastSeen) {
      const dev = hub.dir.devices.get(id);
      if (!dev) continue;
      // Unknown until heard again: too old, or in the future (never trust a time ahead of the restart).
      if (!hub.offline.has(id) && (seen > t || t - seen > dev.silentAfterMin * 60_000)) continue;
      hub.lastSeen.set(id, seen);
    }
    for (const [k, v] of snap.clockIns) hub.clockIns.set(k, v);
    for (const [k, v] of snap.scans) hub.scans.set(k, v);
    for (const k of snap.raised) hub.raised.add(k);
    for (const k of snap.sentKeys) hub.sentKeys.add(k);
    hub.audit.push(...journal.slice(-KEEP.audit));
    hub.auditSeq = journal.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
    const at = new Date(t).toISOString();
    const text = `CMS restarted at ${myt(t)} (last saved ${myt(Date.parse(snap.savedAt))}). Reminders due while it was down are sent once now.`;
    for (const a of hub.alarms.values()) if (a.state !== 'closed') (a.notes ??= []).push({ at, text });
    hub.record({ at, operator: 'system', action: 'restart', note: `last saved ${snap.savedAt}` });
    return hub;
  }

  // ---- Coverage and response KPIs (masterplan §195). Targets are PROPOSED until the owner confirms them. ----

  kpis(opts: { from?: string; to?: string } = {}): Kpis {
    const nowMs = this.now().getTime();
    const to = opts.to ? Date.parse(opts.to) : nowMs;
    const from = opts.from ? Date.parse(opts.from) : to - 24 * 3_600_000;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw new HubError('Give a valid period (from before to).');
    const inWindow = [...this.alarms.values()].filter((a) => {
      const o = Date.parse(a.openedAt);
      return o >= from && o <= to;
    });
    const mins = (a: string, b: string | null) => (b ? (Date.parse(b) - Date.parse(a)) / 60_000 : null);
    const figures = (list: Alarm[]): KpiFigures => {
      const ack: number[] = [];
      const act: number[] = [];
      const close: number[] = [];
      let ackOver = 0;
      let actOver = 0;
      let waiting = 0;
      let falseN = 0;
      let repeats = 0;
      for (const a of list) {
        const sev = a.severity;
        const k = mins(a.openedAt, a.acknowledgedAt);
        if (k !== null) {
          ack.push(k);
          if (k > KPI_TARGETS.acknowledge[sev]) ackOver++;
        } else if (a.state !== 'closed' && (nowMs - Date.parse(a.openedAt)) / 60_000 > KPI_TARGETS.acknowledge[sev]) waiting++;
        const c = mins(a.openedAt, a.actionAt);
        if (c !== null) {
          act.push(c);
          if (c > KPI_TARGETS.act[sev]) actOver++;
        }
        const z = mins(a.openedAt, a.closedAt);
        if (z !== null) close.push(z);
        if (a.state === 'closed' && a.outcome === 'false') falseN++;
        repeats += a.repeats;
      }
      for (const l of [ack, act, close]) l.sort((x, y) => x - y);
      const closedN = list.filter((a) => a.state === 'closed').length;
      return {
        alarms: list.length,
        acknowledged: ack.length,
        ackMedianMin: pct(ack, 50),
        ackP90Min: pct(ack, 90),
        ackOverTarget: ackOver,
        actioned: act.length,
        actMedianMin: pct(act, 50),
        actP90Min: pct(act, 90),
        actOverTarget: actOver,
        closed: closedN,
        closeMedianMin: pct(close, 50),
        falseAlarms: falseN,
        falseRatePct: closedN ? Math.round((falseN / closedN) * 1000) / 10 : null,
        repeats,
        waitingOverTarget: waiting,
      };
    };
    const health = this.deviceHealth();
    const count = (h: typeof health) => ({
      total: h.length,
      online: h.filter((d) => d.state === 'online').length,
      offline: h.filter((d) => d.state === 'offline').length,
      unknown: h.filter((d) => d.state === 'unknown').length,
    });
    const dev = count(health);
    const siteCompany = (siteId: string) => this.dir.sites.get(siteId)?.companyId ?? '';
    const companies = [...new Set([...inWindow.map((a) => a.companyId), ...health.map((d) => siteCompany(d.siteId))].filter(Boolean))].sort();
    return {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      targets: KPI_TARGETS,
      targetsProposed: true,
      all: figures(inWindow),
      bySeverity: {
        critical: figures(inWindow.filter((a) => a.severity === 'critical')),
        high: figures(inWindow.filter((a) => a.severity === 'high')),
        normal: figures(inWindow.filter((a) => a.severity === 'normal' || a.severity === 'info')),
      },
      devices: { ...dev, unknownPct: dev.total ? Math.round((dev.unknown / dev.total) * 1000) / 10 : null },
      gaps: this.gaps.filter((g) => {
        const x = Date.parse(g.at);
        return x >= from && x <= to;
      }).length,
      toPrimaWaiting: this.toPrima.length + this.closedToPrima.length,
      primaParked: this.primaLink.parked.length,
      byCompany: companies.map((c) => ({
        companyId: c,
        figures: figures(inWindow.filter((a) => a.companyId === c)),
        devices: count(health.filter((d) => siteCompany(d.siteId) === c)),
      })),
    };
  }
}
