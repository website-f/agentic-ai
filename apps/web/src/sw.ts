/// <reference lib="webworker" />
// Service worker (built by vite-plugin-pwa injectManifest). P0: offline app shell.
// P6 adds push, notificationclick (approve/deny) and pushsubscriptionchange here.
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

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
