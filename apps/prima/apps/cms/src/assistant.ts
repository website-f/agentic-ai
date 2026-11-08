// The CMS monitoring assistant (Fauzan, 5 Nov 2026: "AI system track all alert from all system it connected ... an AI
// command center monitoring agent").
//
// What it does, every time the operator screen refreshes:
//   1. Watches every open alarm from every connected system (panels, CCTV, gates and ANPR, trackers, the JA feed).
//   2. Groups alarms that belong together (same site and time, or the same fault across many sites) into one finding.
//   3. Ranks the findings, most urgent first, and says why in plain words.
//   4. Suggests next steps for the operator.
//   5. Watches the connected systems themselves: a system that has gone quiet, or is sending messages CMS refuses.
//
// What it never does (CMS watches and tells; the company decides and acts, masterplan V13):
//   - it never acknowledges, actions, closes or escalates an alarm, never hides or lowers an alarm, and never tells anyone
//     in the field: every alarm still follows "Who CMS tells" and stays in the queue;
//   - it has no route to a device: no gate, panel, door or camera command exists anywhere in the CMS app;
//   - it is rule-based and works without any outside service. Each rule is written below with its reason, so a reviewer
//     can check exactly why a finding is ranked where it is. Thresholds are PROPOSED until Arms Control confirms them.
//
// It reads only what the hub already holds. It sends nothing outside the CMS app.
import type { Alarm, Hub, Notification } from './hub';
import { KPI_TARGETS, myt } from './hub';
import type { CmsEvent, EventKind, Severity } from './event';
import { stableId } from './event';
import type { Device } from './directory';

/** PROPOSED thresholds (Arms Control to confirm). Minutes unless named otherwise. */
export const ASSISTANT_RULES = {
  /** Alarms at one site this close in time are looked at together. */
  sameSiteWindowMin: 30,
  /** Two or more devices going offline at one site this close together look like one power or network cut. */
  siteDarkWindowMin: 10,
  siteDarkMinDevices: 2,
  /** The same kind of alarm at this many sites this close together looks like one system fault, not many site problems. */
  wideWindowMin: 15,
  wideMinSites: 3,
  /** A connected system with nothing heard for this long, while it has devices or shifts to watch, shows as quiet. */
  quietAfterMin: 30,
  /** A device with this many false alarms in the last 7 days gets a maintenance suggestion (its alarms are never lowered). */
  noisyFalseAlarms: 3,
} as const;

export type PatternId = 'vault_risk' | 'cit_panic_route' | 'intrusion_confirmed' | 'post_empty_alarm' | 'site_dark' | 'system_wide' | 'single';

export interface Finding {
  /** Stable while the same alarms are grouped the same way: pattern + the alarm ids. */
  key: string;
  pattern: PatternId;
  /** Short headline for the operator (BM). */
  title: string;
  severity: Severity;
  score: number;
  /** Why it is ranked here, one line per reason (BM). */
  reasons: string[];
  /** Suggested next steps for the operator (BM). Suggestions only: the operator and the company decide. */
  suggestions: string[];
  companyIds: string[];
  siteIds: string[];
  siteNames: string[];
  alarmIds: string[];
  firstOpenedAt: string;
  /** True once someone in the field is acting on every alarm in it. */
  allActioned: boolean;
}

export type SystemState = 'ok' | 'attention' | 'quiet' | 'unknown';

export interface SystemWatch {
  system: string;
  label: string;
  devices: { total: number; online: number; offline: number; unknown: number };
  events24h: number;
  refused24h: number;
  lastHeard: string | null;
  state: SystemState;
  /** Plain words on the state (BM). */
  note: string;
}

export interface AssistantView {
  at: string;
  findings: Finding[];
  systems: SystemWatch[];
  /** Plain statement of the limits, shown on the screen. */
  limits: { decides: false; commands: false; hidesAlarms: false; outsideService: false; thresholdsProposed: true };
}

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, normal: 2, info: 3 };
const SEV_BASE: Record<Severity, number> = { critical: 100, high: 60, normal: 30, info: 10 };
const higher = (a: Severity, b: Severity): Severity => (SEV_RANK[a] <= SEV_RANK[b] ? a : b);
const VAULT_KINDS: EventKind[] = ['VAULT_DOOR_UNMATCHED', 'VAULT_WATCH_MISSED', 'FIREARM_OVERDUE'];
const BREAK_IN_KINDS: EventKind[] = ['INTRUSION', 'DOOR_FORCED', 'TAMPER'];
const VIDEO: Device['kind'][] = ['camera', 'recorder'];

/** Connected systems by device kind, as the operator knows them. */
const SYSTEMS: { system: string; label: string; kinds: Device['kind'][]; sources: string[] }[] = [
  { system: 'alarm_panels', label: 'Panel penggera', kinds: ['alarm_panel'], sources: ['sia-dc09'] },
  { system: 'cctv', label: 'CCTV dan perakam', kinds: ['camera', 'recorder'], sources: [] },
  { system: 'gates', label: 'Pagar dan ANPR', kinds: ['gate', 'anpr'], sources: ['anpr'] },
  { system: 'access', label: 'Pintu, bilik kebal dan RFID', kinds: ['door', 'vault_sensor', 'rfid_reader'], sources: [] },
  { system: 'trackers', label: 'Penjejak kenderaan', kinds: ['tracker'], sources: ['tracker'] },
  { system: 'gateways', label: 'Gerbang tapak', kinds: ['gateway'], sources: [] },
];

const KIND_BM: Partial<Record<EventKind, string>> = {
  INTRUSION: 'pencerobohan',
  PANIC: 'butang panik',
  FIRE: 'kebakaran',
  TAMPER: 'peranti diusik',
  DOOR_FORCED: 'pintu dipecah',
  DOOR_HELD_OPEN: 'pintu terbuka lama',
  VAULT_DOOR_UNMATCHED: 'pintu bilik kebal tanpa transaksi',
  VAULT_WATCH_MISSED: 'semakan bilik kebal terlepas',
  FIREARM_OVERDUE: 'senjata api lewat dipulangkan',
  GATE_PLATE_UNKNOWN: 'nombor plat tidak dikenali',
  GATE_PLATE_BLOCKED: 'nombor plat disekat',
  GUARD_NO_SHOW: 'pengawal tidak hadir',
  GUARD_LEFT_POST: 'pengawal tinggalkan pos',
  PATROL_MISSED: 'rondaan terlepas',
  VEHICLE_PANIC: 'panik kenderaan CIT',
  VEHICLE_OFF_ROUTE: 'kenderaan keluar laluan',
  VEHICLE_SPEEDING: 'kenderaan memandu laju',
  DRIVER_OVER_HOURS: 'pemandu melebihi jam',
  DEVICE_OFFLINE: 'peranti luar talian',
};
export const kindBm = (k: EventKind): string => KIND_BM[k] ?? k;

interface Group {
  pattern: PatternId;
  alarms: Alarm[];
  boost: number;
  title: string;
  why: string;
  steps: string[];
  severity?: Severity;
}

const mins = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 60_000;

/** Finds alarms of the wanted kinds that sit within the window of a given alarm at the same site. */
function near(alarms: Alarm[], a: Alarm, kinds: EventKind[], windowMin: number): Alarm[] {
  return alarms.filter((x) => x !== a && x.siteId === a.siteId && kinds.includes(x.kind) && mins(x.openedAt, a.openedAt) <= windowMin);
}

export function assess(hub: Hub, nowMs: number): AssistantView {
  const R = ASSISTANT_RULES;
  const dir = hub.directory;
  const open = [...hub.alarms.values()].filter((a) => a.state !== 'closed');
  const deviceKind = (id: string) => dir.devices.get(id)?.kind;
  const siteName = (id: string) => dir.sites.get(id)?.name ?? id;

  // ---- 1. Group alarms that belong together. Strongest pattern first; each alarm joins one finding only. ----
  const candidates: Group[] = [];
  for (const a of open) {
    // Vault: a vault or firearm alarm while the vault's video is down or something is breaking in at the same site.
    if (VAULT_KINDS.includes(a.kind)) {
      const videoDown = open.filter((x) => x.siteId === a.siteId && x.kind === 'DEVICE_OFFLINE' && VIDEO.includes(deviceKind(x.deviceId)!));
      const breakIn = near(open, a, BREAK_IN_KINDS, R.sameSiteWindowMin);
      if (videoDown.length || breakIn.length)
        candidates.push({
          pattern: 'vault_risk',
          alarms: [a, ...videoDown, ...breakIn],
          boost: 60,
          severity: 'critical',
          title: `Risiko bilik kebal di ${siteName(a.siteId)}`,
          why: `${kindBm(a.kind)} berlaku bersama ${[...videoDown.map(() => 'kamera atau perakam luar talian'), ...breakIn.map((x) => kindBm(x.kind))].filter((v, i, l) => l.indexOf(v) === i).join(' dan ')} di tapak yang sama`,
          steps: [
            'Hubungi penjaga bilik kebal dan pemegang lesen A sekarang; minta kiraan senjata api.',
            'Buka rakaman bilik kebal di platform video dan semak siapa berada di pintu.',
            'Pastikan Kawalan Senjata sudah dimaklumkan. Naikkan kepada COO hanya jika perlu, dengan sebab.',
          ],
        });
    }
    // CIT: a panic and an off-route from the same vehicle.
    if (a.kind === 'VEHICLE_PANIC') {
      const off = open.filter((x) => x.deviceId === a.deviceId && x.kind === 'VEHICLE_OFF_ROUTE' && mins(x.openedAt, a.openedAt) <= R.sameSiteWindowMin);
      if (off.length)
        candidates.push({
          pattern: 'cit_panic_route',
          alarms: [a, ...off],
          boost: 60,
          severity: 'critical',
          title: `Kenderaan CIT ${a.deviceId}: panik dan keluar laluan`,
          why: 'butang panik ditekan dan kenderaan yang sama keluar dari laluan',
          steps: [
            'Hubungi ketua krew sekarang; ikut SOP CIT.',
            'Catat lokasi terakhir penjejak dan maklumkan Ketua Pengangkutan serta Kawalan Senjata.',
            'Syarikat memutuskan sama ada polis perlu dipanggil.',
          ],
        });
    }
    // Break-in: an intrusion with a forced door, tamper or blocked plate at the same site and time.
    if (a.kind === 'INTRUSION') {
      const more = near(open, a, ['DOOR_FORCED', 'TAMPER', 'GATE_PLATE_BLOCKED'], R.sameSiteWindowMin);
      if (more.length)
        candidates.push({
          pattern: 'intrusion_confirmed',
          alarms: [a, ...more],
          boost: 40,
          severity: 'critical',
          title: `Pencerobohan disokong lebih dari satu sistem di ${siteName(a.siteId)}`,
          why: `pencerobohan berlaku bersama ${more.map((x) => kindBm(x.kind)).filter((v, i, l) => l.indexOf(v) === i).join(' dan ')}`,
          steps: [
            'Semak kamera berhampiran zon penggera di platform video.',
            'Hubungi pos tapak dan pegawai bertugas syarikat; jangan minta pengawal bertindak seorang diri.',
          ],
        });
    }
    // Empty post: a guard missing while a serious alarm is open at the same site.
    if (a.kind === 'GUARD_NO_SHOW' || a.kind === 'GUARD_LEFT_POST') {
      const serious = open.filter((x) => x !== a && x.siteId === a.siteId && (x.severity === 'critical' || x.severity === 'high') && x.kind !== 'GUARD_NO_SHOW' && x.kind !== 'GUARD_LEFT_POST');
      if (serious.length)
        candidates.push({
          pattern: 'post_empty_alarm',
          alarms: [...serious, a],
          boost: 35,
          title: `Pos mungkin kosong semasa penggera di ${siteName(a.siteId)}`,
          why: `${kindBm(a.kind)} semasa ${serious.map((x) => kindBm(x.kind)).filter((v, i, l) => l.indexOf(v) === i).join(' dan ')} masih terbuka`,
          steps: [
            'Minta OM atau pegawai peronda menghantar pengganti atau peronda ke tapak.',
            'Semak kamera tapak untuk melihat sama ada pos dijaga.',
          ],
        });
    }
  }
  // Site dark: several devices at one site went offline together, so it is probably power or network, not each device.
  const offlineBySite = new Map<string, Alarm[]>();
  for (const a of open) if (a.kind === 'DEVICE_OFFLINE') offlineBySite.set(a.siteId, [...(offlineBySite.get(a.siteId) ?? []), a]);
  for (const [siteId, list] of offlineBySite) {
    const sorted = [...list].sort((x, y) => Date.parse(x.openedAt) - Date.parse(y.openedAt));
    // The largest set that went silent within the window of each other (sliding from each one in turn).
    let together: Alarm[] = [];
    for (const start of sorted) {
      const set = sorted.filter((x) => Date.parse(x.openedAt) >= Date.parse(start.openedAt) && mins(x.openedAt, start.openedAt) <= R.siteDarkWindowMin);
      if (set.length > together.length) together = set;
    }
    if (together.length >= R.siteDarkMinDevices)
      candidates.push({
        pattern: 'site_dark',
        alarms: together,
        boost: 25,
        severity: 'high',
        title: `${together.length} peranti luar talian serentak di ${siteName(siteId)}`,
        why: 'beberapa peranti senyap dalam masa yang sama: mungkin bekalan elektrik atau rangkaian tapak terputus, bukan setiap peranti rosak',
        steps: [
          'Telefon pos tapak: tanya sama ada elektrik atau internet terputus.',
          'Minta IT menyemak gerbang tapak dan talian internet.',
          'Tapak tidak dikira dipantau sehingga video kembali dalam talian.',
        ],
      });
  }
  // System-wide: the same kind at many sites in a short time usually means one system (a feed or a gateway) is at fault.
  for (const kind of ['GUARD_NO_SHOW', 'DEVICE_OFFLINE', 'PATROL_MISSED'] as EventKind[]) {
    const list = open.filter((a) => a.kind === kind).sort((x, y) => Date.parse(x.openedAt) - Date.parse(y.openedAt));
    for (let i = 0; i < list.length; i++) {
      const burst = list.filter((x) => Date.parse(x.openedAt) >= Date.parse(list[i].openedAt) && mins(x.openedAt, list[i].openedAt) <= R.wideWindowMin);
      const sites = new Set(burst.map((x) => x.siteId));
      if (sites.size >= R.wideMinSites) {
        candidates.push({
          pattern: 'system_wide',
          alarms: burst,
          boost: 30,
          title: `${kindBm(kind)} di ${sites.size} tapak serentak`,
          why: `banyak tapak menunjukkan ${kindBm(kind)} dalam ${R.wideWindowMin} minit: semak sistem sumbernya dahulu`,
          steps: [
            kind === 'DEVICE_OFFLINE' ? 'Semak sambungan internet bilik kawalan CMS dan pelayan gerbang sebelum menghubungi setiap tapak.' : 'Semak sama ada suapan kehadiran dan rondaan JA masih menghantar data (lihat "Sistem bersambung").',
            'Hubungi dua atau tiga tapak untuk mengesahkan keadaan sebenar.',
            'Setiap penggera kekal dalam senarai dan diuruskan seperti biasa.',
          ],
        });
        break;
      }
    }
  }

  const used = new Set<string>();
  const groups: Group[] = [];
  for (const g of candidates.sort((x, y) => y.boost - x.boost)) {
    const fresh = g.alarms.filter((a, i, l) => !used.has(a.id) && l.indexOf(a) === i);
    // A group stands only if it still holds the alarm that started it plus at least one more.
    if (fresh.length < 2 || fresh[0] !== g.alarms[0]) continue;
    for (const a of fresh) used.add(a.id);
    groups.push({ ...g, alarms: fresh });
  }
  for (const a of open)
    if (!used.has(a.id))
      groups.push({ pattern: 'single', alarms: [a], boost: 0, title: `${kindBm(a.kind)} di ${siteName(a.siteId)}`, why: '', steps: [] });

  // ---- 2. Rank. Every point added is written as a reason. Nothing lowers an alarm except someone already acting. ----
  const gapAlarms = new Set(hub.gaps.map((g) => g.alarmId));
  const lastNotice = new Map<string, Notification>();
  for (const n of hub.notifications) lastNotice.set(n.alarmId, n);
  const falseByDevice = new Map<string, number>();
  const weekAgo = nowMs - 7 * 86_400_000;
  for (const a of hub.alarms.values())
    if (a.state === 'closed' && a.outcome === 'false' && a.closedAt && Date.parse(a.closedAt) >= weekAgo)
      falseByDevice.set(a.deviceId, (falseByDevice.get(a.deviceId) ?? 0) + 1);

  const findings: Finding[] = groups.map((g) => {
    const reasons: string[] = [];
    const sev = g.alarms.reduce<Severity>((s, a) => higher(s, a.severity), g.severity ?? 'info');
    let score = SEV_BASE[sev];
    reasons.push(`Tahap ${sev === 'critical' ? 'kritikal' : sev === 'high' ? 'tinggi' : sev === 'normal' ? 'biasa' : 'maklumat'}`);
    if (g.boost) {
      score += g.boost;
      reasons.push(`Gabungan: ${g.why}`);
    }
    const first = g.alarms.reduce((m, a) => (Date.parse(a.openedAt) < Date.parse(m) ? a.openedAt : m), g.alarms[0].openedAt);
    const waitingAck = g.alarms.filter((a) => a.state === 'open');
    if (waitingAck.length) {
      const over = Math.max(...waitingAck.map((a) => (nowMs - Date.parse(a.openedAt)) / 60_000 - KPI_TARGETS.acknowledge[a.severity]));
      if (over > 0) {
        score += Math.min(40, Math.round(over * 2));
        reasons.push(`Belum diakui, ${Math.round(over)} minit melebihi sasaran`);
      } else reasons.push('Belum diakui');
    }
    const notActing = g.alarms.filter((a) => a.state !== 'actioned');
    const actOver = notActing.filter((a) => (nowMs - Date.parse(a.openedAt)) / 60_000 > KPI_TARGETS.act[a.severity]);
    if (actOver.length) {
      score += 15;
      reasons.push('Belum ada sesiapa bertindak dalam masa sasaran');
    }
    const repeats = g.alarms.reduce((n, a) => n + a.repeats, 0);
    if (repeats) {
      score += Math.min(15, repeats * 3);
      reasons.push(`Dilaporkan semula ${repeats} kali`);
    }
    if (g.alarms.some((a) => gapAlarms.has(a.id))) {
      score += 10;
      reasons.push('Ada peranan tanpa orang untuk dimaklumkan (jurang)');
    }
    // A serious alarm while the guard for that site is missing: said on the finding even when the missing-guard alarm
    // sits in its own finding (each alarm joins one finding only).
    if (g.pattern !== 'post_empty_alarm' && (sev === 'critical' || sev === 'high')) {
      const sites = new Set(g.alarms.map((a) => a.siteId));
      const missing = open.filter((x) => (x.kind === 'GUARD_NO_SHOW' || x.kind === 'GUARD_LEFT_POST') && sites.has(x.siteId) && !g.alarms.includes(x));
      if (missing.length) {
        score += 15;
        reasons.push(`Pos mungkin kosong: ${missing.map((x) => kindBm(x.kind)).filter((v, i, l) => l.indexOf(v) === i).join(' dan ')} di tapak yang sama`);
        g.steps = [...g.steps, 'Minta OM atau pegawai peronda menghantar pengganti atau peronda ke tapak.'];
      }
    }
    if (g.alarms.some((a) => a.restoredAt)) reasons.push('Sistem melaporkan keadaan pulih; masih perlu disahkan dan ditutup dengan nota');
    const allActioned = g.alarms.every((a) => a.state === 'actioned');
    if (allActioned) {
      score = Math.max(0, score - 40);
      reasons.push(`Sudah ada yang bertindak (${[...new Set(g.alarms.map((a) => a.actionBy))].join(', ')}): diletak lebih rendah, masih perlu ditutup`);
    }

    const steps = [...g.steps];
    if (g.pattern === 'single') {
      const a = g.alarms[0];
      if (a.state === 'open') steps.push('Akui penggera ini.');
      const n = lastNotice.get(a.id);
      if (n) steps.push(`Telefon ${n.to.name} (${n.to.role.replace(/_/g, ' ')}) jika belum menjawab.`);
      if (VIDEO.includes(deviceKind(a.deviceId)!) || a.kind === 'DEVICE_OFFLINE') steps.push('Semak sama ada peranti lain di tapak ini masih dalam talian.');
      else steps.push('Semak rakaman kamera berhampiran di platform video.');
    }
    if (!allActioned && g.alarms.some((a) => a.state !== 'actioned')) steps.push('Catat siapa di lapangan yang bertindak; peringatan berhenti hanya selepas itu.');
    if (g.alarms.some((a) => gapAlarms.has(a.id))) steps.push('Beritahu syarikat untuk mengisi peranan yang kosong dalam Prima.');
    for (const a of g.alarms) {
      const f = falseByDevice.get(a.deviceId) ?? 0;
      if (f >= R.noisyFalseAlarms) steps.push(`${a.deviceId} mencatat ${f} penggera palsu dalam 7 hari: cadangkan penyelenggaraan. Penggera ini tetap dilayan sebagai sebenar sehingga disahkan.`);
    }

    const ids = g.alarms.map((a) => a.id).sort();
    return {
      key: `${g.pattern}:${stableId(...ids).slice(0, 16)}`,
      pattern: g.pattern,
      title: g.title,
      severity: sev,
      score,
      reasons,
      suggestions: [...new Set(steps)],
      companyIds: [...new Set(g.alarms.map((a) => a.companyId))].sort(),
      siteIds: [...new Set(g.alarms.map((a) => a.siteId))].sort(),
      siteNames: [...new Set(g.alarms.map((a) => siteName(a.siteId)))].sort(),
      alarmIds: g.alarms.map((a) => a.id),
      firstOpenedAt: first,
      allActioned,
    };
  });
  findings.sort((x, y) => y.score - x.score || SEV_RANK[x.severity] - SEV_RANK[y.severity] || Date.parse(x.firstOpenedAt) - Date.parse(y.firstOpenedAt));

  return { at: new Date(nowMs).toISOString(), findings, systems: watchSystems(hub, nowMs), limits: { decides: false, commands: false, hidesAlarms: false, outsideService: false, thresholdsProposed: true } };
}

/** Watches the connected systems themselves. A system never heard from is unknown, never green (masterplan V15). */
function watchSystems(hub: Hub, nowMs: number): SystemWatch[] {
  const R = ASSISTANT_RULES;
  const health = hub.deviceHealth();
  const dir = hub.directory;
  const dayAgo = nowMs - 86_400_000;
  const events: CmsEvent[] = [...hub.allEvents()].filter((e) => Date.parse(e.receivedAt) >= dayAgo && e.source !== 'hub');
  const refused = hub.refused.filter((r) => Date.parse(r.at) >= dayAgo);
  const heard = hub.lastHeard();
  const iso = (ms: number | undefined) => (ms === undefined ? null : new Date(ms).toISOString());

  const out: SystemWatch[] = [];
  for (const s of SYSTEMS) {
    const devs = health.filter((d) => s.kinds.includes(d.kind as Device['kind']));
    if (!devs.length) continue;
    const ids = new Set(devs.map((d) => d.deviceId));
    const devices = {
      total: devs.length,
      online: devs.filter((d) => d.state === 'online').length,
      offline: devs.filter((d) => d.state === 'offline').length,
      unknown: devs.filter((d) => d.state === 'unknown').length,
    };
    const seen = devs.map((d) => (d.lastSeen ? Date.parse(d.lastSeen) : 0)).concat(s.sources.map((x) => heard.get(x) ?? 0));
    const last = Math.max(0, ...seen);
    const ev = events.filter((e) => ids.has(e.deviceId)).length;
    const ref = refused.filter((r) => s.sources.some((x) => r.source === x || r.source.startsWith(`${x}-`))).length;
    let state: SystemState;
    let note: string;
    if (devices.unknown === devices.total) {
      state = 'unknown';
      note = 'Belum pernah didengar sejak CMS bermula. Tidak dikira dipantau.';
    } else if (last && nowMs - last > R.quietAfterMin * 60_000) {
      state = 'quiet';
      note = `Senyap sejak ${myt(last)}. Semak sambungan sistem ini.`;
    } else if (devices.offline || devices.unknown || ref) {
      state = 'attention';
      note = [devices.offline ? `${devices.offline} luar talian` : '', devices.unknown ? `${devices.unknown} belum didengar` : '', ref ? `${ref} mesej ditolak dalam 24 jam` : ''].filter(Boolean).join(', ') + '.';
    } else {
      state = 'ok';
      note = 'Semua peranti didengar dalam tempoh senyap masing-masing.';
    }
    out.push({ system: s.system, label: s.label, devices, events24h: ev, refused24h: ref, lastHeard: last ? iso(last) : null, state, note });
  }

  // The JA attendance and patrol feed: watched while any shift is running.
  const shiftOn = dir.d.shifts.some((sh) => Date.parse(sh.start) <= nowMs && nowMs < Date.parse(sh.end));
  if (dir.d.shifts.length || dir.d.patrolRounds.length) {
    const last = heard.get('ja-feed');
    const ev = events.filter((e) => e.source === 'ja-feed').length;
    const ref = refused.filter((r) => r.source === 'ja-feed').length;
    let state: SystemState;
    let note: string;
    if (last === undefined) {
      state = shiftOn ? 'unknown' : 'ok';
      note = shiftOn ? 'Tiada data kehadiran atau rondaan sejak CMS bermula walaupun syif sedang berjalan.' : 'Tiada syif sedang berjalan.';
    } else if (shiftOn && nowMs - last > R.quietAfterMin * 60_000) {
      state = 'quiet';
      note = `Senyap sejak ${myt(last)} walaupun syif sedang berjalan. Ketidakhadiran mungkin disebabkan suapan, bukan pengawal.`;
    } else if (ref) {
      state = 'attention';
      note = `${ref} mesej ditolak dalam 24 jam.`;
    } else {
      state = 'ok';
      note = `Terakhir didengar ${myt(last)}.`;
    }
    out.push({ system: 'ja_feed', label: 'Kehadiran dan rondaan (JA)', devices: { total: 0, online: 0, offline: 0, unknown: 0 }, events24h: ev, refused24h: ref, lastHeard: iso(last), state, note });
  }

  // Prima link: what is waiting to go and what Prima did not accept.
  const waiting = hub.toPrima.length + hub.closedToPrima.length;
  const parked = hub.primaLink.parked.length;
  out.push({
    system: 'prima',
    label: 'Pautan ke Prima',
    devices: { total: 0, online: 0, offline: 0, unknown: 0 },
    events24h: 0,
    refused24h: parked,
    lastHeard: null,
    state: parked || waiting ? 'attention' : 'ok',
    note: parked ? `${parked} item tidak diterima Prima; disimpan dan dicuba semula.` : waiting ? `${waiting} item menunggu untuk dihantar.` : 'Tiada item menunggu.',
  });
  const order: Record<SystemState, number> = { quiet: 0, unknown: 1, attention: 2, ok: 3 };
  return out.sort((a, b) => order[a.state] - order[b.state]);
}
