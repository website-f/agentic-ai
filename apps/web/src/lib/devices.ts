/** P31: a person's own computers (the PC agent). Linking, the devices list and its settings,
 * and the small pure helpers the page and the task composer share (folder paths, the
 * visitor's OS, the link-code countdown, "is this my own AI"). See docs/PC-AGENT.md. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

export type DeviceOs = "windows" | "mac";

/** One linked computer, as GET /api/devices lists it. */
export interface Device {
  id: string;
  name: string;
  os: DeviceOs;
  os_version?: string | null;
  arch?: string | null;
  hostname?: string | null;
  /** The PC agent's version. */
  version: string | null;
  /** Connected right now (the socket is open). */
  online: boolean;
  last_seen_at: string | null;
  paused: boolean;
  /** The folders the AI may look in (the server's settings are the truth). */
  folders: string[];
  /** The PC's own Documents / Desktop / Downloads, as it reported them (for "add back"). */
  default_folders?: string[] | null;
  /** The person's home folder on the PC (system.info). */
  home?: string | null;
  /** Browsers the AI can drive on it: "chrome", "edge". */
  browsers: string[];
  created_at?: string;
}

/** One thing the AI did on a PC (device_activity). */
export interface DeviceActivity {
  id: string | number;
  /** What it was: search, list, upload, save, browser_open, browser_close, info, pause, resume, unlink. */
  kind: string;
  /** Places, queries and counts (never contents): query, folder, path, name, start_url,
   * saved_to, found, size, browser, error. */
  detail?: Record<string, unknown> | null;
  agent_id?: string | null;
  agent_name?: string | null;
  task_id?: string | null;
  task_title?: string | null;
  ok: boolean;
  ts?: string;
  created_at?: string;
  // Flat forms, should the server send them so.
  path?: string | null;
  url?: string | null;
  query?: string | null;
  error?: string | null;
}

export interface LinkCode {
  code: string;
  expires_at: string;
  install: { windows: string; mac: string };
  /** The desktop app builds; null until one is published (then only the one-line install). */
  downloads: { windows: string; mac: string } | null;
}

export interface LinkStatus {
  status: "pending" | "claimed" | "expired";
  device_id?: string | null;
  device_name?: string | null;
}

/** The server answers {claimed, expired, device_id}; the page reads one status. */
type LinkStatusWire = Partial<LinkStatus> & { claimed?: boolean; expired?: boolean; name?: string | null };

export function toLinkStatus(r: LinkStatusWire | null | undefined): LinkStatus {
  const status = r?.status ?? (r?.claimed ? "claimed" : r?.expired ? "expired" : "pending");
  return { status, device_id: r?.device_id ?? null, device_name: r?.device_name ?? r?.name ?? null };
}

export interface DevicePatch {
  name?: string;
  paused?: boolean;
  folders?: string[];
}

export const deviceKeys = {
  all: ["devices"] as const,
  list: ["devices", "list"] as const,
  activity: (id: string) => ["devices", "activity", id] as const,
  link: (code: string) => ["devices", "link", code] as const,
};

/** The list may come bare or wrapped ({items}); either way, an array. */
function listOf<T>(r: T[] | { items?: T[]; devices?: T[] } | null | undefined): T[] {
  if (Array.isArray(r)) return r;
  return r?.items ?? r?.devices ?? [];
}

export const listDevices = async () => listOf(await api<Device[] | { items?: Device[] }>("/api/devices"));
export const createLinkCode = () => api<LinkCode>("/api/devices/link-code", "POST", {});
export const linkStatus = async (code: string) =>
  toLinkStatus(await api<LinkStatusWire>(`/api/devices/link-code/${encodeURIComponent(code)}/status`));
export const updateDevice = (id: string, patch: DevicePatch) => api<Device>(`/api/devices/${encodeURIComponent(id)}`, "PATCH", patch);
export const unlinkDevice = (id: string) => api<void>(`/api/devices/${encodeURIComponent(id)}`, "DELETE");
export const deviceActivity = async (id: string) =>
  listOf(await api<DeviceActivity[] | { items?: DeviceActivity[] }>(`/api/devices/${encodeURIComponent(id)}/activity`));

/** The person's computers. Live via `device.status` (lib/live.ts), and every 30 s besides. */
export const devicesQuery = queryOptions({
  queryKey: deviceKeys.list,
  queryFn: listDevices,
  refetchInterval: 30_000,
  staleTime: 10_000,
  retry: false,
});

export const activityQuery = (id: string) =>
  queryOptions({ queryKey: deviceKeys.activity(id), queryFn: () => deviceActivity(id), staleTime: 10_000 });

// ---------------------------------------------------------------- whose AI may use it

/** Only the person's OWN AI may use their PC: their twin, or their private assistant. */
export function isMyOwnAi(
  agent: { owner_user_id?: string | null; is_twin?: boolean; private?: boolean } | null | undefined,
  userId: string | null | undefined,
): boolean {
  return !!agent && !!userId && agent.owner_user_id === userId && (!!agent.is_twin || !!agent.private);
}

// ---------------------------------------------------------------- the visitor's computer

interface NavigatorLike {
  userAgentData?: { platform?: string } | null;
  userAgent?: string;
  platform?: string;
}

/** Which install command to show first: the visitor's own system. Phones and Linux: "other". */
export function detectOs(nav: NavigatorLike | undefined = typeof navigator === "undefined" ? undefined : (navigator as NavigatorLike)): DeviceOs | "other" {
  if (!nav) return "other";
  const hint = (nav.userAgentData?.platform ?? "").toLowerCase();
  if (hint) {
    if (hint.includes("win")) return "windows";
    if (hint.includes("mac")) return "mac";
    return "other";
  }
  const ua = `${nav.userAgent ?? ""} ${nav.platform ?? ""}`;
  if (/Windows|Win32|Win64/i.test(ua)) return "windows";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return "other";
  if (/Macintosh|Mac OS X|MacIntel/i.test(ua)) return "mac";
  return "other";
}

// ---------------------------------------------------------------- folders

/** The system a path is written for: `C:\…` is Windows, `/…` is a Mac. */
export function pathOs(path: string): DeviceOs | null {
  if (/^[A-Za-z]:[\\/]/.test(path)) return "windows";
  if (path.startsWith("/")) return "mac";
  return null;
}

/** Tidy what was typed or pasted: quotes ("Copy as path" adds them), slashes, a trailing
 * separator, a leading ~ (when the home folder is known). */
export function normalizeFolder(raw: string, home?: string | null): string {
  let p = raw.trim().replace(/^["']+|["']+$/g, "").trim();
  if (home && (p === "~" || p.startsWith("~/") || p.startsWith("~\\"))) {
    const sep = pathOs(home) === "windows" ? "\\" : "/";
    p = home.replace(/[\\/]+$/, "") + (p.length > 1 ? sep + p.slice(2) : "");
  }
  if (pathOs(p) === "windows") {
    p = p[0]!.toUpperCase() + p.slice(1).replace(/\//g, "\\").replace(/\\{2,}/g, "\\");
    if (p.length > 3) p = p.replace(/\\+$/, "");
  } else if (p.startsWith("/")) {
    p = p.replace(/\/{2,}/g, "/");
    if (p.length > 1) p = p.replace(/\/+$/, "");
  }
  return p;
}

/** Never reachable, whatever the folders (the server and the PC refuse them too). */
const BLOCKED_PARTS = [".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", "keychains", "user data", "1password", "bitwarden"];

export type FolderProblem = "empty" | "not_absolute" | "wrong_os" | "too_wide" | "dots" | "blocked" | "duplicate";

/** Why a folder cannot be added (null = fine). `path` should be normalized first. */
export function folderProblem(path: string, os: DeviceOs | null, existing: readonly string[] = []): FolderProblem | null {
  if (!path.trim()) return "empty";
  const kind = pathOs(path);
  if (!kind) return "not_absolute";
  if (os && kind !== os) return "wrong_os";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.some((s) => s === ".." || s === ".")) return "dots";
  if (kind === "windows") {
    if (parts.length < 2) return "too_wide"; // a whole drive (C:\)
  } else {
    // A Mac: inside the person's own folder (/Users/name/…) or an external disk (/Volumes/name).
    const top = parts[0];
    if (top !== "Users" && top !== "Volumes") return "not_absolute";
    if (parts.length < 2 || (top === "Users" && parts[1] === "Shared" && parts.length < 3)) return "too_wide";
  }
  if (parts.some((s) => BLOCKED_PARTS.includes(s.toLowerCase()))) return "blocked";
  const key = (p: string) => (kind === "windows" ? p.toLowerCase() : p);
  if (existing.some((e) => key(e) === key(path))) return "duplicate";
  return null;
}

const DEFAULT_NAMES = ["Documents", "Desktop", "Downloads"] as const;

/** Documents, Desktop and Downloads as the PC reported them: from the device's own list,
 * else built from its home folder, else read off the folders it already has. */
export function defaultFolders(device: Pick<Device, "os" | "folders" | "home" | "default_folders">): string[] {
  if (device.default_folders?.length) return [...device.default_folders];
  const sep = device.os === "windows" ? "\\" : "/";
  let home = device.home?.replace(/[\\/]+$/, "") || null;
  if (!home) {
    for (const f of device.folders) {
      const m = /^(.*)[\\/](Documents|Desktop|Downloads)$/i.exec(f);
      if (m?.[1]) {
        home = m[1];
        break;
      }
    }
  }
  return home ? DEFAULT_NAMES.map((n) => `${home}${sep}${n}`) : [];
}

/** The last part of a folder path, for compact chips. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

// ---------------------------------------------------------------- the link code

/** Whole seconds until a code expires (never below 0). */
export function secondsLeft(expiresAt: string, now: number = Date.now()): number {
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** 9:05, 0:42. */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The code, easier to read aloud and type: ABCD-EFGH (the dash is only for show). */
export function prettyCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

// ---------------------------------------------------------------- activity

export type ActivityKind = "search" | "list" | "read" | "copy" | "save" | "browse" | "settings" | "other";

/** What kind of thing an activity row is, for its icon. */
export function activityKind(kind: string): ActivityKind {
  const k = kind.toLowerCase();
  if (k.includes("search") || k.includes("find")) return "search";
  if (k.includes("list")) return "list";
  if (k.includes("upload") || k.includes("workspace")) return "copy";
  if (k.includes("read")) return "read";
  if (k.includes("save") || k.includes("download") || k.includes("write")) return "save";
  if (k.includes("browser") || k.includes("browse") || k.includes("cdp")) return "browse";
  if (k.includes("pause") || k.includes("resume") || k.includes("folder") || k.includes("settings") || k.includes("link")) return "settings";
  return "other";
}

const text = (v: unknown) => (typeof v === "string" && v ? v : "");

/** What the row was about: the file, where it was saved, the page, the search words or the folder. */
export function activityTarget(a: Pick<DeviceActivity, "path" | "url" | "query" | "detail">): string {
  const d = a.detail ?? {};
  const path = text(a.path) || text(d.path) || text(d.saved_to);
  const url = text(a.url) || text(d.start_url) || text(d.url);
  const query = text(a.query) || text(d.query);
  if (path || url) return path || url;
  if (query) {
    const folder = text(d.folder);
    return folder ? `“${query}” · ${folder}` : `“${query}”`;
  }
  return text(d.folder) || text(d.name);
}

/** The error code of a failed row (top level or in its detail). */
export function activityError(a: Pick<DeviceActivity, "error" | "detail">): string {
  return text(a.error) || text(a.detail?.error) || "failed";
}

/** When it happened. */
export function activityTime(a: Pick<DeviceActivity, "ts" | "created_at">): string | null {
  return a.ts ?? a.created_at ?? null;
}

/** "Linked to 1 computer · online": how many, and whether any is on now. */
export function devicesSummary(devices: readonly Pick<Device, "online" | "paused">[]): { count: number; online: number; paused: number } {
  return {
    count: devices.length,
    online: devices.filter((d) => d.online).length,
    paused: devices.filter((d) => d.paused).length,
  };
}
