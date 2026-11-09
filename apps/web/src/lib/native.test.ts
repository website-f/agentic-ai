import { afterEach, describe, expect, it, vi } from "vitest";

import { isStandalone, pushState } from "./push";
import { downloadUrl, fileNameFrom, installNativeLinks, isNativeApp, markNativeApp, openUrl, saveFile, startDownload } from "./native";

type Win = Window & { Capacitor?: unknown };

function asNative(plugins: Record<string, unknown> = {}) {
  (window as Win).Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: plugins };
}

afterEach(() => {
  delete (window as Win).Capacitor;
  document.documentElement.className = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("native (P96: ready for the phone app wrapper)", () => {
  it("is a browser unless Capacitor says it is native", () => {
    expect(isNativeApp()).toBe(false);
    markNativeApp();
    expect(document.documentElement.classList.contains("native-app")).toBe(false);
    asNative();
    expect(isNativeApp()).toBe(true);
    markNativeApp();
    expect(document.documentElement.classList.contains("native-app")).toBe(true);
    expect(document.documentElement.classList.contains("native-android")).toBe(true);
  });

  it("reads the file name a download asks for", () => {
    expect(fileNameFrom('attachment; filename="Report 2026.pdf"', "x")).toBe("Report 2026.pdf");
    expect(fileNameFrom("attachment; filename*=UTF-8''Laporan%20Bulanan.xlsx", "x")).toBe("Laporan Bulanan.xlsx");
    expect(fileNameFrom(null, "fallback.csv")).toBe("fallback.csv");
  });

  it("browser: opens a new tab and cuts the opener; a blocked popup opens in place", () => {
    const tab = { opener: {} as unknown };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    openUrl("/api/files/f1/content");
    expect(open).toHaveBeenCalledWith(`${window.location.origin}/api/files/f1/content`, "_blank");
    expect(tab.opener).toBeNull();

    open.mockReturnValue(null);
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign, origin: window.location.origin, href: window.location.href } as Location);
    openUrl("https://example.com/page");
    expect(assign).toHaveBeenCalledWith("https://example.com/page");
  });

  it("phone app: other sites open in the system browser (Browser plugin), never a popup", () => {
    const browserOpen = vi.fn().mockResolvedValue(undefined);
    asNative({ Browser: { open: browserOpen } });
    const open = vi.spyOn(window, "open");
    openUrl("https://login.microsoftonline.com/x");
    expect(browserOpen).toHaveBeenCalledWith({ url: "https://login.microsoftonline.com/x" });
    expect(open).not.toHaveBeenCalled();
  });

  it("browser: saveFile is a normal download", async () => {
    const created = vi.fn().mockReturnValue("blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await saveFile(new Blob(["a,b"]), "list.csv");
    expect(created).toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    const a = click.mock.contexts[0] as HTMLAnchorElement;
    expect(a.download).toBe("list.csv");
  });

  it("phone app: saveFile writes the file and opens the share sheet", async () => {
    const writeFile = vi.fn().mockResolvedValue({ uri: "file:///cache/list.csv" });
    const share = vi.fn().mockResolvedValue(undefined);
    asNative({ Filesystem: { writeFile }, Share: { share } });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await saveFile(new Blob(["a,b"], { type: "text/csv" }), "list.csv");
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: "list.csv", directory: "CACHE", data: btoa("a,b") }));
    expect(share).toHaveBeenCalledWith({ title: "list.csv", files: ["file:///cache/list.csv"] });
    expect(click).not.toHaveBeenCalled();
  });

  it("phone app: a download fetches with the session and saves under the server's name", async () => {
    const writeFile = vi.fn().mockResolvedValue({ uri: "file:///cache/a.pdf" });
    const share = vi.fn().mockResolvedValue(undefined);
    asNative({ Filesystem: { writeFile }, Share: { share } });
    const fetchMock = vi.fn().mockResolvedValue(new Response("pdf", { headers: { "content-disposition": 'attachment; filename="Quote Q-12.pdf"' } }));
    vi.stubGlobal("fetch", fetchMock);
    startDownload("/api/documents/d1/export.pdf");
    await vi.waitFor(() => expect(share).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/documents/d1/export.pdf", { credentials: "same-origin" });
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: "Quote Q-12.pdf" }));
  });

  it("downloadUrl reports a failed answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
    await expect(downloadUrl("/api/files/f1/content")).rejects.toThrow("403");
  });

  it("phone app: target=_blank links go through openUrl", () => {
    const browserOpen = vi.fn().mockResolvedValue(undefined);
    asNative({ Browser: { open: browserOpen } });
    installNativeLinks();
    const a = document.createElement("a");
    a.href = "https://t.me/BotFather";
    a.target = "_blank";
    a.textContent = "BotFather";
    document.body.appendChild(a);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(browserOpen).toHaveBeenCalledWith({ url: "https://t.me/BotFather" });
    a.remove();
  });

  it("phone app: counts as installed and leaves notifications to native push", async () => {
    asNative();
    expect(isStandalone()).toBe(true);
    expect(await pushState()).toBe("unsupported");
  });
});
