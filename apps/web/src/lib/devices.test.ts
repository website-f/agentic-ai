import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activityError,
  activityKind,
  activityTarget,
  activityTime,
  countdown,
  createLinkCode,
  defaultFolders,
  detectOs,
  deviceKeys,
  devicesSummary,
  bytes,
  folderName,
  keyOf,
  remoteBlock,
  folderProblem,
  isMyOwnAi,
  linkStatus,
  listDevices,
  normalizeFolder,
  pathOs,
  prettyCode,
  secondsLeft,
  unlinkDevice,
  updateDevice,
} from "./devices";

describe("folder paths", () => {
  it("tells Windows from Mac paths", () => {
    expect(pathOs("C:\\Users\\aina\\Documents")).toBe("windows");
    expect(pathOs("d:/Work")).toBe("windows");
    expect(pathOs("/Users/aina/Documents")).toBe("mac");
    expect(pathOs("Documents")).toBeNull();
    expect(pathOs("~/Documents")).toBeNull();
  });

  it("tidies pasted paths", () => {
    expect(normalizeFolder('  "C:\\Users\\aina\\Documents\\"  ')).toBe("C:\\Users\\aina\\Documents");
    expect(normalizeFolder("c:/Users/aina//Desktop/")).toBe("C:\\Users\\aina\\Desktop");
    expect(normalizeFolder("/Users/aina//Downloads/")).toBe("/Users/aina/Downloads");
    expect(normalizeFolder("~/Projects", "/Users/aina")).toBe("/Users/aina/Projects");
    expect(normalizeFolder("~\\Projects", "C:\\Users\\aina")).toBe("C:\\Users\\aina\\Projects");
    expect(normalizeFolder("C:\\")).toBe("C:\\");
  });

  it("accepts absolute folders for the computer's own system", () => {
    expect(folderProblem("C:\\Users\\aina\\Documents", "windows")).toBeNull();
    expect(folderProblem("D:\\Projects", "windows")).toBeNull();
    expect(folderProblem("/Users/aina/Documents", "mac")).toBeNull();
    expect(folderProblem("/Volumes/Backup", "mac")).toBeNull();
    expect(folderProblem("/Users/aina/Documents", null)).toBeNull();
  });

  it("refuses what cannot be a folder to share", () => {
    expect(folderProblem("", "windows")).toBe("empty");
    expect(folderProblem("Documents", "windows")).toBe("not_absolute");
    expect(folderProblem("/etc", "mac")).toBe("not_absolute");
    expect(folderProblem("/Users/aina/Documents", "windows")).toBe("wrong_os");
    expect(folderProblem("C:\\Users\\aina", "mac")).toBe("wrong_os");
    expect(folderProblem("C:\\", "windows")).toBe("too_wide");
    expect(folderProblem("/Users", "mac")).toBe("too_wide");
    expect(folderProblem("C:\\Users\\aina\\..\\bob", "windows")).toBe("dots");
    expect(folderProblem("/Users/aina/.ssh", "mac")).toBe("blocked");
    expect(folderProblem("C:\\Users\\aina\\.aws\\cli", "windows")).toBe("blocked");
    expect(folderProblem("C:\\Users\\aina\\AppData\\Local\\Google\\Chrome\\User Data", "windows")).toBe("blocked");
  });

  it("spots a folder that is already there (Windows ignores case)", () => {
    expect(folderProblem("C:\\users\\AINA\\documents", "windows", ["C:\\Users\\aina\\Documents"])).toBe("duplicate");
    expect(folderProblem("/Users/aina/documents", "mac", ["/Users/aina/Documents"])).toBeNull();
  });

  it("offers Documents, Desktop and Downloads as the PC reported them", () => {
    expect(defaultFolders({ os: "windows", folders: [], home: "C:\\Users\\aina", default_folders: null })).toEqual([
      "C:\\Users\\aina\\Documents", "C:\\Users\\aina\\Desktop", "C:\\Users\\aina\\Downloads",
    ]);
    expect(defaultFolders({ os: "mac", folders: ["/Users/aina/Desktop"], home: null })).toEqual([
      "/Users/aina/Documents", "/Users/aina/Desktop", "/Users/aina/Downloads",
    ]);
    expect(defaultFolders({ os: "mac", folders: [], home: null, default_folders: ["/Users/a/Docs"] })).toEqual(["/Users/a/Docs"]);
    expect(defaultFolders({ os: "windows", folders: ["D:\\Work"], home: null })).toEqual([]);
    expect(folderName("C:\\Users\\aina\\Documents")).toBe("Documents");
    expect(folderName("/Users/aina/Downloads/")).toBe("Downloads");
  });
});

describe("the visitor's system", () => {
  it("prefers client hints", () => {
    expect(detectOs({ userAgentData: { platform: "Windows" }, userAgent: "x" })).toBe("windows");
    expect(detectOs({ userAgentData: { platform: "macOS" } })).toBe("mac");
    expect(detectOs({ userAgentData: { platform: "Android" } })).toBe("other");
  });

  it("falls back to the user agent", () => {
    expect(detectOs({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" })).toBe("windows");
    expect(detectOs({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15" })).toBe("mac");
    expect(detectOs({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe("other");
    expect(detectOs({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe("linux");
    expect(detectOs({ userAgentData: { platform: "Linux" } })).toBe("linux");
    expect(detectOs({})).toBe("other");
  });
});

describe("remote (P42)", () => {
  it("knows why a remote level is not ready", () => {
    expect(remoteBlock({ remote_pc: "off", remote_allowed: "off" }, "view")).toBe("pc");
    expect(remoteBlock({ remote_pc: "view", remote_allowed: "off" }, "view")).toBe("web");
    expect(remoteBlock({ remote_pc: "view", remote_allowed: "view" }, "view")).toBeNull();
    expect(remoteBlock({ remote_pc: "view", remote_allowed: "view" }, "control")).toBe("pc");
    expect(remoteBlock({ remote_pc: "control", remote_allowed: "view" }, "control")).toBe("web");
    expect(remoteBlock({ remote_pc: "control", remote_allowed: "control" }, "control")).toBeNull();
  });

  it("turns a browser key press into one key, a combination, typed text, or nothing", () => {
    const base = { ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };
    expect(keyOf({ ...base, key: "a" })).toEqual({ text: "a" });
    expect(keyOf({ ...base, key: "Enter" })).toEqual({ key: "enter" });
    expect(keyOf({ ...base, ctrlKey: true, key: "c" })).toEqual({ key: "ctrl+c" });
    expect(keyOf({ ...base, ctrlKey: true, shiftKey: true, key: "T" })).toEqual({ key: "ctrl+shift+t" });
    expect(keyOf({ ...base, shiftKey: true, key: "Tab" })).toEqual({ key: "shift+tab" });
    expect(keyOf({ ...base, metaKey: true, key: "c" })).toEqual({ key: "cmd+c" });
    // A character typed with Shift is just that character, not shift+x.
    expect(keyOf({ ...base, shiftKey: true, key: "A" })).toEqual({ text: "A" });
    // A modifier on its own: nothing to send.
    expect(keyOf({ ...base, key: "Shift" })).toBeNull();
    expect(keyOf({ ...base, ctrlKey: true, key: "Control" })).toBeNull();
  });

  it("names the person's own remote actions", () => {
    expect(activityKind("screen")).toBe("screen");
    expect(activityKind("control")).toBe("control");
    expect(activityKind("download")).toBe("download");
    expect(activityKind("remote")).toBe("settings");
  });

  it("shows byte sizes", () => {
    expect(bytes(512)).toBe("1 KB");
    expect(bytes(12 * 1024)).toBe("12 KB");
    expect(bytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(bytes(3 * 1024 ** 3)).toBe("3.0 GB");
    expect(bytes(null)).toBe("1 KB");
  });
});

describe("folders on Linux", () => {
  it("accepts a Linux home or mounted disk, and rejects the wrong shape", () => {
    expect(folderProblem("/home/aina/Documents", "linux")).toBeNull();
    expect(folderProblem("/mnt/data/projects", "linux")).toBeNull();
    expect(folderProblem("/media/aina/USB/work", "linux")).toBeNull();
    expect(folderProblem("/home", "linux")).toBe("too_wide");
    expect(folderProblem("/etc/secret", "linux")).toBe("not_absolute");
    expect(folderProblem("C:\\Users\\aina", "linux")).toBe("wrong_os");
    expect(folderProblem("/home/aina/.ssh", "linux")).toBe("blocked");
  });
});

describe("link code and activity helpers", () => {
  it("counts down to the code's expiry", () => {
    const now = Date.parse("2026-10-07T10:00:00Z");
    expect(secondsLeft("2026-10-07T10:10:00Z", now)).toBe(600);
    expect(secondsLeft("2026-10-07T09:59:00Z", now)).toBe(0);
    expect(secondsLeft("not a date", now)).toBe(0);
    expect(countdown(600)).toBe("10:00");
    expect(countdown(65)).toBe("1:05");
    expect(countdown(-3)).toBe("0:00");
    expect(prettyCode("ABCD2345")).toBe("ABCD-2345");
  });

  it("names each kind of activity", () => {
    expect(activityKind("files.search")).toBe("search");
    expect(activityKind("files.list")).toBe("list");
    expect(activityKind("files.upload")).toBe("copy");
    expect(activityKind("files.save")).toBe("save");
    expect(activityKind("browser.open")).toBe("browse");
    expect(activityKind("paused")).toBe("settings");
    expect(activityKind("system.info")).toBe("other");
    expect(activityTarget({ query: "invoice march" })).toBe("“invoice march”");
    expect(activityTarget({ path: "/Users/a/x.pdf", query: "x" })).toBe("/Users/a/x.pdf");
    // The server's own shape: places and queries in `detail`.
    expect(activityKind("upload")).toBe("copy");
    expect(activityKind("read")).toBe("read");
    expect(activityKind("browser_open")).toBe("browse");
    expect(activityKind("resume")).toBe("settings");
    expect(activityKind("info")).toBe("other");
    expect(activityTarget({ detail: { query: "invoice", folder: "/Users/a/Documents", found: 3 } })).toBe("“invoice” · /Users/a/Documents");
    expect(activityTarget({ detail: { path: "/Users/a/x.pdf", size: 10 } })).toBe("/Users/a/x.pdf");
    expect(activityTarget({ detail: { start_url: "https://example.com" } })).toBe("https://example.com");
    expect(activityError({ detail: { error: "not_allowed" } })).toBe("not_allowed");
    expect(activityError({})).toBe("failed");
    expect(activityTime({ ts: "2026-10-07T10:00:00Z" })).toBe("2026-10-07T10:00:00Z");
  });

  it("summarises the computers", () => {
    expect(devicesSummary([{ online: true, paused: false }, { online: false, paused: true }])).toEqual({ count: 2, online: 1, paused: 1 });
  });

  it("only lets the person's own twin or private assistant use their computer", () => {
    expect(isMyOwnAi({ owner_user_id: "u1", is_twin: true }, "u1")).toBe(true);
    expect(isMyOwnAi({ owner_user_id: "u1", private: true }, "u1")).toBe(true);
    expect(isMyOwnAi({ owner_user_id: "u1", is_twin: false, private: false }, "u1")).toBe(false);
    expect(isMyOwnAi({ owner_user_id: "u2", is_twin: true }, "u1")).toBe(false);
    expect(isMyOwnAi(null, "u1")).toBe(false);
  });
});

describe("the devices API", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(body: unknown, status = 200) {
    const fetch = vi.fn().mockResolvedValue(
      status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("lists devices, bare or wrapped", async () => {
    const d = { id: "dv_1", name: "Aina's laptop", os: "windows", online: true, paused: false, folders: [], browsers: [], version: "0.1.0", last_seen_at: null };
    let fetch = stub([d]);
    expect(await listDevices()).toEqual([d]);
    expect(fetch.mock.calls[0]![0]).toBe("/api/devices");
    fetch = stub({ items: [d] });
    expect(await listDevices()).toEqual([d]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("asks for a link code and polls it", async () => {
    let fetch = stub({ code: "ABCD2345", expires_at: "2026-10-07T10:10:00Z", install: { windows: "irm x | iex", mac: "curl x | sh" }, downloads: { windows: "/w", mac: "/m" } });
    const code = await createLinkCode();
    expect(code.code).toBe("ABCD2345");
    expect(fetch.mock.calls[0]![0]).toBe("/api/devices/link-code");
    expect((fetch.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    fetch = stub({ claimed: false, expired: false, device_id: null, expires_at: "2026-10-07T10:10:00Z" });
    expect((await linkStatus("ABCD2345")).status).toBe("pending");
    expect(fetch.mock.calls[0]![0]).toBe("/api/devices/link-code/ABCD2345/status");
    stub({ claimed: true, expired: false, device_id: "dv_1" });
    expect(await linkStatus("ABCD2345")).toEqual({ status: "claimed", device_id: "dv_1", device_name: null });
    stub({ claimed: false, expired: true, device_id: null });
    expect((await linkStatus("ABCD2345")).status).toBe("expired");
  });

  it("changes and unlinks a device", async () => {
    let fetch = stub({ id: "dv_1" });
    await updateDevice("dv_1", { paused: true, folders: ["C:\\Users\\a\\Documents"] });
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(fetch.mock.calls[0]![0]).toBe("/api/devices/dv_1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ paused: true, folders: ["C:\\Users\\a\\Documents"] });
    fetch = stub(null, 204);
    await unlinkDevice("dv_1");
    expect((fetch.mock.calls[0]![1] as RequestInit).method).toBe("DELETE");
    expect(deviceKeys.link("X")[0]).toBe(deviceKeys.all[0]); // device.status refreshes the link poll too
  });
});
