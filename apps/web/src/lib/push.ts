/** Phone and desktop notifications (Web Push) and the install prompt. */
import { t } from "@/i18n";

import { api } from "./api";

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushState(): Promise<PushState> {
  // iPhone only allows notifications for apps added to the Home Screen (iOS 16.4+).
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? "Android" : isIOS() ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Linux";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}${isStandalone() ? " (app)" : ""}`;
}

/** Must run from a tap: browsers only ask for permission after a user gesture. */
export async function enablePush(): Promise<void> {
  if (!supported()) throw new Error(t("This browser cannot show notifications."));
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(t("Notifications were not allowed. Change it in the browser's site settings."));
  const reg = (await registration()) ?? (await navigator.serviceWorker.ready);
  const { public_key } = await api<{ public_key: string }>("/api/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(public_key) });
  await api("/api/push/subscribe", "POST", { ...sub.toJSON(), label: deviceLabel() });
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api("/api/push/unsubscribe", "POST", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}

/** Sign-out: this device stops getting the person's notifications (the server forgets the
 * subscription, then the browser drops it). Never throws; hands back the endpoint it dropped. */
export async function dropPushOnSignOut(): Promise<string | null> {
  try {
    const sub = await (await registration())?.pushManager?.getSubscription();
    if (!sub) return null;
    const endpoint = sub.endpoint;
    await api("/api/push/unsubscribe", "POST", { endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => false);
    return endpoint;
  } catch {
    return null;
  }
}

/** On every start: re-send the current subscription (the browser may have rotated it). */
export async function syncPush(): Promise<void> {
  try {
    if (!supported() || Notification.permission !== "granted") return;
    const sub = await (await registration())?.pushManager.getSubscription();
    if (sub) await api("/api/push/subscribe", "POST", { ...sub.toJSON(), label: deviceLabel() });
  } catch {
    /* offline or signed out: try next time */
  }
}

/** The red number on the app icon (installed apps that support it). */
export function setBadge(count: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    /* not supported */
  }
}

// ---------------------------------------------------------------- install prompt (Chromium)

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });
}

export function canInstall(): boolean {
  return deferred !== null;
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function install(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  listeners.forEach((fn) => fn());
  return outcome === "accepted";
}
