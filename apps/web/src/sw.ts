/// <reference lib="webworker" />
// Service worker (built by vite-plugin-pwa injectManifest): offline app shell (P0),
// push notifications with Approve / Deny buttons (P6).
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// A new version takes over at once; the page decides when to reload (main.tsx → lib/unsaved.ts
// applyUpdate): never under an editor with unsaved changes.
self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Client-side routes load the cached shell; API calls always go to the network.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//, /^\/readyz/, /^\/healthz/],
  }),
);

// ---------------------------------------------------------------- P6: push notifications

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  approval_id?: string;
  question?: boolean;
  token?: string;
  badge?: number;
}

type NavigatorWithBadge = WorkerNavigator & { setAppBadge?: (n?: number) => Promise<void> };

self.addEventListener("push", (event) => {
  let p: PushPayload;
  try {
    p = event.data?.json() as PushPayload;
  } catch {
    p = { title: "Agentic Office", body: event.data?.text() ?? "" };
  }
  // Approve / Deny buttons where the platform supports them (Android, desktop Chromium).
  // iPhone shows no buttons; tapping opens the one-screen approve page instead.
  const actions = p.approval_id && !p.question && p.token
    ? [{ action: "approve", title: "Approve" }, { action: "deny", title: "Deny" }]
    : [];
  const nav = self.navigator as NavigatorWithBadge;
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(p.title, {
        body: p.body,
        tag: p.tag,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: p.url ?? "/approvals", token: p.token, approval_id: p.approval_id },
        requireInteraction: !!p.approval_id,
        // `actions` is not in every TypeScript lib yet.
        ...({ actions } as object),
      }),
      typeof p.badge === "number" && nav.setAppBadge ? nav.setAppBadge(p.badge).catch(() => undefined) : Promise.resolve(),
    ]),
  );
});

async function openUrl(url: string): Promise<void> {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of all) {
    if ("focus" in c) {
      await (c as WindowClient).navigate(url).catch(() => undefined);
      await (c as WindowClient).focus();
      return;
    }
  }
  await self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  const data = (event.notification.data ?? {}) as { url?: string; token?: string };
  event.notification.close();
  const url = data.url ?? "/approvals";
  if ((event.action === "approve" || event.action === "deny") && data.token) {
    event.waitUntil(
      (async () => {
        try {
          // No session needed: the single-use token in the notification is the proof.
          const r = await fetch("/api/push/act", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: data.token, decision: event.action }),
          });
          const body = (await r.json().catch(() => ({}))) as { message?: string };
          if (!r.ok) throw new Error(body.message ?? "failed");
          await self.registration.showNotification(event.action === "approve" ? "Approved" : "Denied", {
            body: "The agent continues now.",
            icon: "/icons/icon-192.png",
            tag: "decision",
          });
        } catch {
          await openUrl(url); // expired or offline: decide in the app instead
        }
      })(),
    );
    return;
  }
  event.waitUntil(openUrl(url));
});

// A rotated subscription is re-sent by the app on its next start (lib/push.ts syncPush):
// the service worker cannot read the CSRF cookie the API asks for.
