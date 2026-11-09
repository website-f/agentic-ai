/** P96: the same web app, ready to run inside a phone app wrapper (Capacitor, see
 * docs/P96_MOBILE_APP_READY.md). In a normal browser nothing here changes behaviour; inside the
 * wrapper, links that would open a new window, file downloads and blob saves go through the
 * wrapper's plugins (when they are installed) instead of failing silently in the WebView. */
import { toast } from "sonner";

import { t } from "@/i18n";

import { errorMessage } from "./api";

interface CapacitorPlugin {
  [method: string]: ((opts?: unknown) => Promise<unknown>) | undefined;
}
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, CapacitorPlugin | undefined>;
}

function cap(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True inside the phone app wrapper (Android or iOS), false in any browser. */
export function isNativeApp(): boolean {
  try {
    return !!cap()?.isNativePlatform?.();
  } catch {
    return false;
  }
}

function plugin(name: string): CapacitorPlugin | undefined {
  return isNativeApp() ? cap()?.Plugins?.[name] : undefined;
}

/** html.native-app (and native-android / native-ios): CSS turns off the page bounce there. */
export function markNativeApp(): void {
  if (!isNativeApp()) return;
  const root = document.documentElement;
  root.classList.add("native-app");
  const p = cap()?.getPlatform?.();
  if (p) root.classList.add(`native-${p}`);
}

const failed = (e: unknown) => toast.error(errorMessage(e));

const sameOrigin = (url: URL) => url.origin === window.location.origin;

/** Open a page in a new tab (browser) or the system browser (phone app). A blocked popup, or a
 * WebView with no windows, opens it in place instead of doing nothing. */
export function openUrl(href: string): void {
  const url = new URL(href, window.location.href);
  const browser = plugin("Browser");
  if (browser?.open && !sameOrigin(url)) {
    void browser.open({ url: url.href });
    return;
  }
  if (isNativeApp() && sameOrigin(url)) {
    // The system browser does not carry this app's sign-in: files are saved, pages open here.
    if (url.pathname.startsWith("/api/")) void downloadUrl(url.href).catch(failed);
    else window.location.assign(url.href);
    return;
  }
  // No "noopener" feature: with it window.open always returns null and a blocked popup could
  // not be told apart. The opener is cut by hand instead.
  const w = window.open(url.href, "_blank");
  if (w) {
    try {
      w.opener = null;
    } catch {
      /* cross-origin: nothing to cut */
    }
    return;
  }
  window.location.assign(url.href);
}

/** The file name a download answer asks for (Content-Disposition), if any. */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1]!.trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through to the plain name */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1]!.trim() : fallback;
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Save a file the app made (a CSV, recovery codes, a download): the browser's download in a
 * browser; in the phone app the share sheet (save to Files, send, open with), through the
 * Filesystem and Share plugins, else the Web Share API. */
export async function saveFile(blob: Blob, name: string): Promise<void> {
  if (isNativeApp()) {
    const fsys = plugin("Filesystem");
    const share = plugin("Share");
    if (fsys?.writeFile && share?.share) {
      const res = (await fsys.writeFile({ path: name, data: await base64(blob), directory: "CACHE" })) as { uri?: string };
      if (res?.uri) {
        await share.share({ title: name, files: [res.uri] });
        return;
      }
    }
    const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
      }
    }
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  a.dataset.nativeSkip = ""; // the phone app's link handler leaves this one to the WebView
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

/** Fetch a file from this server with the session and save it (see saveFile). */
export async function downloadUrl(href: string, fallbackName = "download"): Promise<void> {
  const res = await fetch(href, { credentials: "same-origin" });
  if (!res.ok) throw new Error(t("Request failed ({status}).", { status: res.status }));
  const name = fileNameFrom(res.headers.get("content-disposition"), new URL(href, window.location.href).pathname.split("/").pop() || fallbackName);
  await saveFile(await res.blob(), name);
}

/** A download from this server (the answer says "attachment"): in a browser the page stays and
 * the file downloads; in the phone app it is fetched and saved through saveFile. */
export function startDownload(href: string): void {
  if (isNativeApp()) void downloadUrl(href).catch(failed);
  else window.location.href = href;
}

/** In the phone app only: links that open a new window or download a file go through openUrl /
 * downloadUrl (a WebView ignores target="_blank" and cannot save a download by itself). */
export function installNativeLinks(): void {
  if (!isNativeApp()) return;
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("data-native-skip")) return;
      const url = new URL(a.href, window.location.href);
      if (a.hasAttribute("download") && sameOrigin(url)) {
        e.preventDefault();
        void downloadUrl(url.href, a.getAttribute("download") || undefined).catch(failed);
      } else if (a.target === "_blank") {
        e.preventDefault();
        openUrl(url.href);
      }
    },
    true,
  );
}
