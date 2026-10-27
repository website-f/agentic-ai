/** P31: a person's own computers (the PC agent). Linking, the devices list and its settings,
 * and the small pure helpers the page and the task composer share (folder paths, the
 * visitor's OS, the link-code countdown, "is this my own AI"). See docs/PC-AGENT.md. */
import { queryOptions } from "@tanstack/react-query";

import { t } from "@/i18n";

import { ApiError, api, langHeader } from "./api";

export type DeviceOs = "windows" | "mac" | "linux";

/** P42: seeing and using the computer from the web. Both locks must allow a level: the one
 * set ON the computer (`agentic-pc remote ...`) and the one set here, with the password. */
export type RemoteLevel = "off" | "view" | "control";

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
  /** What the computer itself allows (`agentic-pc remote ...`). */
  remote_pc?: RemoteLevel;
  /** What the person allowed here, with their password. */
  remote_allowed?: RemoteLevel;
  /** The lower of the two: what works now. */
  remote?: RemoteLevel;
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
  install: { windows: string; mac: string; linux?: string };
  /** P42: the same lines that also allow seeing and using the computer from the web. */
  install_control?: { windows: string; mac: string; linux?: string };
  /** The desktop app builds; null until one is published (then only the one-line install). */
  downloads: { windows: string; mac: string } | null;
  /** P52: the Windows program with this code inside (double-click: installs, links, starts with
   * Windows); `control` also allows seeing and using it from the web. Null without a build. */
  exe?: { off: string; control: string } | null;
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
  one: (id: string) => ["devices", "one", id] as const,
  health: (id: string) => ["devices", "health", id] as const,
  files: (id: string, path: string, q: string) => ["devices", "files", id, path, q] as const,
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
/** One computer by id (the caller's own, or — for a manager — a company computer, P53). */
export const deviceQuery = (id: string) =>
  queryOptions({ queryKey: deviceKeys.one(id), queryFn: () => api<Device>(`/api/devices/${encodeURIComponent(id)}`), enabled: !!id });
export const updateDevice = (id: string, patch: DevicePatch) => api<Device>(`/api/devices/${encodeURIComponent(id)}`, "PATCH", patch);
export const unlinkDevice = (id: string) => api<void>(`/api/devices/${encodeURIComponent(id)}`, "DELETE");
export const deviceActivity = async (id: string) =>
  listOf(await api<DeviceActivity[] | { items?: DeviceActivity[] }>(`/api/devices/${encodeURIComponent(id)}/activity`));

// ---------------------------------------------------------------- from the web, while away (P42)

export interface DeviceHealth {
  os: string;
  os_version?: string;
  hostname?: string;
  version?: string;
  uptime_s?: number;
  cpu?: { model?: string; cores?: number; busy_pct?: number | null; load?: number[] | null };
  memory?: { total: number; free: number };
  disks?: { path: string; total: number; free: number }[];
  user?: string;
  paused?: boolean;
  remote?: RemoteLevel;
}

export interface DeviceFile {
  path: string;
  name: string;
  is_dir?: boolean;
  size?: number;
  modified?: string;
}

export interface DeviceFiles {
  folder?: string;
  folders?: string[];
  items: DeviceFile[];
  truncated?: boolean;
}

const dev = (id: string) => `/api/devices/${encodeURIComponent(id)}`;

export const deviceHealth = (id: string) => api<DeviceHealth>(`${dev(id)}/health`);
export const deviceFiles = (id: string, path: string, q: string) => {
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  else if (path) qs.set("path", path);
  const query = qs.toString();
  return api<DeviceFiles>(`${dev(id)}/files${query ? `?${query}` : ""}`);
};
export const setRemote = (id: string, level: RemoteLevel, password = "") => api<Device>(`${dev(id)}/remote`, "PUT", { level, password });

export type InputBody =
  | { kind: "mouse"; x: number; y: number; action: "move" | "click" | "double" | "right" | "scroll"; dy?: number }
  | { kind: "key"; text?: string; key?: string };
export const sendInput = (id: string, body: InputBody) => api<{ done: boolean }>(`${dev(id)}/input`, "POST", body);

async function failure(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  return new ApiError(res.status, data?.code ?? "http_error", data?.message ?? t("Request failed ({status}).", { status: res.status }));
}

/** One picture of the screen, and the real screen's size. */
export async function screenFrame(id: string, width: number, quality: number, signal?: AbortSignal): Promise<{ blob: Blob; w: number; h: number }> {
  let res: Response;
  try {
    res = await fetch(`${dev(id)}/screen?w=${width}&q=${quality}`, { credentials: "same-origin", headers: langHeader(), signal, cache: "no-store" });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError(0, "network", t("Could not reach the server. Check that the stack is running."));
  }
  if (!res.ok) throw await failure(res);
  return { blob: await res.blob(), w: Number(res.headers.get("x-screen-width")) || 0, h: Number(res.headers.get("x-screen-height")) || 0 };
}

/** A file from the computer, saved by the browser. */
export async function downloadFromDevice(id: string, path: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${dev(id)}/files/download?path=${encodeURIComponent(path)}`, { credentials: "same-origin", headers: langHeader() });
  } catch {
    throw new ApiError(0, "network", t("Could not reach the server. Check that the stack is running."));
  }
  if (!res.ok) throw await failure(res);
  const m = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = m ? decodeURIComponent(m[1]!) : (path.split(/[\\/]/).pop() || "file");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 1.2 GB, 640 MB, 12 KB. */
export function bytes(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)} GB`;
  if (v >= 1024 ** 2) return `${Math.round(v / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(v / 1024))} KB`;
}

/** Why a remote level does not work yet: "pc" (allow it on the computer), "web" (allow it
 * here), or null (it works). */
export function remoteBlock(d: Pick<Device, "remote_pc" | "remote_allowed">, want: Exclude<RemoteLevel, "off">): "pc" | "web" | null {
  const order: RemoteLevel[] = ["off", "view", "control"];
  const rank = (l: RemoteLevel | undefined) => order.indexOf(l ?? "off");
  if (rank(d.remote_pc) < rank(want)) return "pc";
  if (rank(d.remote_allowed) < rank(want)) return "web";
  return null;
}

const NAMED_KEYS: Record<string, string> = {
  Enter: "enter", Tab: "tab", Escape: "esc", Backspace: "backspace", Delete: "delete",
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown",
};

/** The browser's key press as what the computer takes: one named key or combination
 * ("ctrl+c", "shift+tab", "enter"), a character to type, or null (Shift on its own...). */
export function keyOf(e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }): { key: string } | { text: string } | null {
  const mods = [e.ctrlKey && "ctrl", e.altKey && "alt", e.metaKey && "cmd"].filter((m): m is string => !!m);
  let name = NAMED_KEYS[e.key] ?? (/^F([1-9]|1[0-2])$/.test(e.key) ? e.key.toLowerCase() : null);
  if (!name && e.key.length === 1 && mods.length) name = /^[a-z0-9]$/i.test(e.key) ? e.key.toLowerCase() : null;
  if (name) return { key: [...mods, ...(e.shiftKey && (mods.length || e.key.length > 1) ? ["shift"] : []), name].join("+") };
  if (e.key.length === 1 && !mods.length) return { text: e.key };
  return null;
}

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

/** Which install command to show first: the visitor's own system. Phones: "other". */
export function detectOs(nav: NavigatorLike | undefined = typeof navigator === "undefined" ? undefined : (navigator as NavigatorLike)): DeviceOs | "other" {
  if (!nav) return "other";
  const hint = (nav.userAgentData?.platform ?? "").toLowerCase();
  if (hint) {
    if (hint.includes("win")) return "windows";
    if (hint.includes("mac")) return "mac";
    if (hint.includes("linux") || hint.includes("chrome os")) return "linux";
    return "other";
  }
  const ua = `${nav.userAgent ?? ""} ${nav.platform ?? ""}`;
  if (/Windows|Win32|Win64/i.test(ua)) return "windows";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return "other";
  if (/Macintosh|Mac OS X|MacIntel/i.test(ua)) return "mac";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
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
  if (os && kind !== (os === "linux" ? "mac" : os)) return "wrong_os"; // "mac" here: any /path
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.some((s) => s === ".." || s === ".")) return "dots";
  if (kind === "windows") {
    if (parts.length < 2) return "too_wide"; // a whole drive (C:\)
  } else {
    // A Mac: inside the person's own folder (/Users/name/…) or an external disk (/Volumes/name).
    // Linux: /home/name/…, or a mounted disk (/mnt/x, /media/name/x).
    const top = parts[0] ?? "";
    const tops = os === "linux" ? ["home", "mnt", "media"] : os === "mac" ? ["Users", "Volumes"] : ["Users", "Volumes", "home", "mnt", "media"];
    if (!tops.includes(top)) return "not_absolute";
    if (parts.length < 2 || (top === "Users" && parts[1] === "Shared" && parts.length < 3) || (top === "media" && parts.length < 3)) return "too_wide";
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

export type ActivityKind = "search" | "list" | "read" | "copy" | "save" | "download" | "browse" | "screen" | "control" | "settings" | "other";

/** What kind of thing an activity row is, for its icon. */
export function activityKind(kind: string): ActivityKind {
  const k = kind.toLowerCase();
  // P42: the person themselves, from the web
  if (k === "download") return "download";
  if (k === "screen") return "screen";
  if (k === "control") return "control";
  if (k === "remote") return "settings";
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

// ---------------------------------------------------------------- the owner's view (P53)

/** A linked company computer as the owner sees it on the Staff computers page. */
export interface StaffComputer extends Device {
  person: { id: string; name: string; email: string; role: string };
  company: string;
  branch_id?: string | null;
}

export interface BackupSettings {
  enabled: boolean;
  target_id: string;
  every_hours: number;
  targets: { id: string; name: string; kind: string }[];
}

export const orgComputersQuery = (q = "") =>
  queryOptions({
    queryKey: ["org", "computers", q] as const,
    queryFn: () => api<{ computers: StaffComputer[]; can_backup: boolean }>(`/api/org/computers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    refetchInterval: 30_000,
  });

export const backupSettingsQuery = queryOptions({
  queryKey: ["org", "computers", "backup"] as const,
  queryFn: () => api<BackupSettings>("/api/org/computers/backup"),
});

export const setBackup = (body: { enabled: boolean; target_id: string; every_hours: number }) =>
  api<BackupSettings>("/api/org/computers/backup", "PUT", body);
