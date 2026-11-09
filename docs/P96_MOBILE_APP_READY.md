# P96: the Agentic Office web, ready to become a phone app

Fitri (10 Nov 2026): "make it super mobile friendly ... because we will export it to APK and iOS later."

This note says what the office web (`apps/web`) now does on phones, how it was checked, and the
exact steps to wrap it as an Android and iOS app with Capacitor later. Prima (`apps/prima`) has its
own pass and is not covered here.

## 1. What changed (P96)

### Shared kit and shell (every page gets it)

| Area | Before | Now |
| --- | --- | --- |
| Back button | Android Back / a back swipe left the page even with a sheet open | `lib/back-close.ts`: opening a dialog, side sheet, date or time picker, or the More page list adds one history entry at the same address. Back closes the top sheet first; closing it any other way takes the entry off again. The router never sees these entries (pushed with the browser's own `pushState`, the pops are stopped before the router's listener), so nothing reloads. Touch screens only: with a mouse, Back still means "previous page". |
| Close button on phone sheets | Phone bottom sheets (`ResponsiveDialog`, `SideSheet`) had no X; only a drag or a tap outside closed them (no Back key on iOS) | A 44 px X in each phone sheet header. The desktop X grows to 44 px on touch screens. |
| Tap targets | Kit `sm` and `icon-sm` buttons are 32 px; header icons 32 px; many bare icon buttons 24-32 px | On touch screens (`pointer: coarse`) every kit button and every bare icon button sized 5-9 (or `h-6`..`h-9`) gets an invisible 44 x 44 px touch area (`::after`), without changing how it looks. Menu, list-box and palette rows are at least 44 px high. Controls that draw their own `::after` (tab underlines) are left alone. |
| Long button labels | `Button` is `whitespace-nowrap`: "Always allow for <long agent name>" ran off a 360 px screen | `Button` is never wider than its row; its text sits in one span that ends in "..." (icons stay whole). |
| Header | Fixed 3.5rem with the status-bar inset taken out of it (a notch squeezed it) | The header grows by `env(safe-area-inset-top)`; the sides keep clear of a landscape notch; the theme switch moved into the account menu on phones so the company name has room. |
| Safe areas | Bottom tab bar padded for the home bar only | Tab bar pads left/right too; the shell pads for a landscape notch on tablets; sign-in pages pad top and bottom; the Office floor's height subtracts the top inset. |
| Keyboard | Chrome on Android laid the keyboard over the page | `interactive-widget=resizes-content` in the viewport: the keyboard shrinks the page and `100dvh`, so bottom sheets and Save buttons stay above it (the tab bar already hides while typing). |
| Slow networks | Opening a page on a slow connection showed nothing until it arrived | `components/nav-progress.tsx`: a thin bar under the status bar after 250 ms of loading. (Offline already had `OfflineBanner` and the root error page.) |
| New windows and downloads | `window.open(..., "noopener")` (always returns null, and a WebView has no windows); `location.href = download`; blob downloads with `a.download` (a WebView cannot save those) | `lib/native.ts`: `openUrl` (new tab in a browser; a blocked popup opens in place; in the phone app other sites go to the system browser), `startDownload` / `downloadUrl` / `saveFile` (a normal download in a browser; in the phone app the file is fetched with the session and handed to the share sheet). Used by the document editor (Open PDF, Download PDF/Word/Excel), packs, the file browser, CSV exports, member import templates, PC file downloads and the two-step recovery codes. In the phone app, links with `target="_blank"` or `download` go the same way automatically. |
| Native shell marker | none | `html.native-app` (+ `native-android` / `native-ios`) when running inside Capacitor; CSS turns off the page bounce / pull-to-refresh there, as it already did for the installed web app. In a browser nothing changes. |

Already in place before P96 (checked, kept): `viewport-fit=cover`, `100dvh`/`h-dvh` everywhere
(no `100vh`), a bottom tab bar with More on phones (P92 staff variant), inputs at 16 px on touch
screens (no iOS zoom), `inputmode`/`autocomplete` on the email, phone, number, money, URL, code
and password fields, our own touch-friendly date and time pickers (bottom sheets on phones),
`overscroll-contain` on inner scroll areas, the offline banner, the service worker, the web
manifest (name, short name, id/start_url/scope `/`, standalone, 192/512/maskable icons,
apple-touch-icon, shortcuts) and web push.

### How it was checked

* `apps/web` built and served by Playwright (Edge, headless) from disk, with `/api` sent to a demo
  API on a throwaway database (`deploy/docs-capture/seed_demo.py`, fictional data) plus long
  synthetic names (a 72-character company, a 52-character agent, a 160-character task).
* Every route in `nav.ts` / `router.tsx` (66) at 360, 390, 414 px (phone, touch, 2x) and
  1366 px: screenshot, page sideways scroll, elements past the right edge, touch targets under
  44 px, inputs under 16 px, page errors. Before and after numbers are in the P96 report.
* Unit tests: `lib/back-close.test.ts`, `lib/native.test.ts`, `components/ui/mobile-kit.test.tsx`,
  `components/nav-progress.test.tsx`, `app-ready.test.ts` (manifest, icons, viewport, shell).

### Left as is, on purpose

* Long lists and tables (AI use and limits, members, activity, ...) are being replaced by the
  phone-friendly `DataTable` in P96 by another engineer; only the page frames were touched here.
* The Office floor map and the workflow board are canvases with their own pan and pinch.
* Hover-only actions: none found that a phone needs; actions shown on hover on desktop rows are
  also in each row's menu or detail sheet.

## 2. Wrapping it with Capacitor (later)

Nothing below is installed yet (no new packages in P96). Use Capacitor 7 or newer.

### 2.1 Which mode

Load the live office in the WebView (`server.url`), do not bundle the web build into the app:

* The office signs in with a same-site session cookie and a CSRF cookie, and every API call is
  same-origin (`/api/...`). A bundled app runs at `capacitor://localhost` / `https://localhost`,
  which would make every call cross-origin and the cookies third-party: that needs token auth and
  CORS on the server. Loading `https://agent.oriondesk.space` keeps everything as it is.
* Updates ship with the web (the service worker already updates itself); the store app only
  changes when native plugins change.
* Apple guideline 4.2 (minimum functionality): the app must be more than a website. Push
  notifications, the share sheet for files, the camera for receipts and attendance, and biometric
  unlock (optional) are the native parts that make the case.

### 2.2 Project setup

```bash
mkdir mobile && cd mobile           # a new folder next to apps/web, its own package.json
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios \
      @capacitor/app @capacitor/browser @capacitor/filesystem @capacitor/share \
      @capacitor/push-notifications @capacitor/status-bar @capacitor/splash-screen
npx cap init "Agentic Office" my.oriondesk.agentic --web-dir www
mkdir www && echo '<!doctype html><title>Agentic Office</title>' > www/index.html  # offline fallback page
```

`capacitor.config.ts`:

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "my.oriondesk.agentic",
  appName: "Agentic Office",
  webDir: "www",
  server: {
    url: "https://agent.oriondesk.space",
    // Only our own site opens inside the app; every other address opens in the system browser.
    allowNavigation: ["agent.oriondesk.space"],
    errorPath: "index.html",
  },
  android: { allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: false },
  ios: { contentInset: "never", limitsNavigationsToAppBoundDomains: true },
  plugins: {
    StatusBar: { overlaysWebView: true, style: "DEFAULT" }, // the shell pads by env(safe-area-inset-top)
    SplashScreen: { launchAutoHide: true, launchShowDuration: 600, backgroundColor: "#0d1210" },
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};
export default config;
```

Then `npx cap add android`, `npx cap add ios`, `npx cap sync`.

* iOS `ios/App/App/Info.plist`: `WKAppBoundDomains` = `agent.oriondesk.space`;
  `NSCameraUsageDescription` ("Take photos of receipts and documents"),
  `NSPhotoLibraryUsageDescription`, `NSMicrophoneUsageDescription` (voice input on chat and the
  task composer uses the microphone).
* Android `AndroidManifest.xml`: `CAMERA`, `RECORD_AUDIO`, `POST_NOTIFICATIONS` (Android 13+);
  `android:windowSoftInputMode="adjustResize"` on the main activity (the default in Capacitor).
* Edge to edge (Android 15 forces it for targetSdk 35): keep `StatusBar.overlaysWebView: true`;
  the header, tab bar and sheets already pad by `env(safe-area-inset-*)`. On Android WebView
  versions that do not report the insets yet, add `@capacitor-community/safe-area` (it sets
  `--safe-area-inset-*`) or set `android.adjustMarginsForEdgeToEdge: "auto"` (Capacitor 7.1+).

### 2.3 What the web side already does inside the app

`lib/native.ts` checks `window.Capacitor.isNativePlatform()`; nothing is needed in the web code
once the plugins above are installed:

* `html.native-app`: no page bounce; Back closes sheets (Capacitor's default Android back
  handler goes back in WebView history; our sheet entries are part of it).
* Links with `target="_blank"` and `openUrl(...)`: other sites open in the system browser
  (`@capacitor/browser`: Custom Tabs / SFSafariViewController). Files from our own `/api/...`
  are fetched with the session and saved.
* Downloads and generated files (`saveFile`, `startDownload`, `a[download]`): written to the
  cache with `@capacitor/filesystem` and handed to `@capacitor/share` (Save to Files, WhatsApp,
  Drive, open in a PDF viewer). Without those plugins it falls back to the Web Share API, then
  to a normal download.
* File inputs (`<input type="file">`, receipts accept `image/*`): Capacitor's WebView shows the
  system picker with Camera, Photos and Files. Nothing to add.

### 2.4 Android back button at the root

Capacitor's default: Back goes back in WebView history and closes the app when there is none.
To make Back from the home screen minimise instead of closing (feels native), add to the
`www`-independent bootstrap (a tiny script the live site loads only inside the app, or a
`MainActivity` override):

```ts
import { App } from "@capacitor/app";
App.addListener("backButton", ({ canGoBack }) => (canGoBack ? window.history.back() : App.minimizeApp()));
```

### 2.5 Deep links (open a task or approval from a message)

* Android App Links: host `https://agent.oriondesk.space/.well-known/assetlinks.json` (package
  `my.oriondesk.agentic` + the release key's SHA-256) and an intent filter with
  `android:autoVerify="true"` for `https://agent.oriondesk.space` paths `/approve`, `/tasks`,
  `/chat`, `/approvals`, `/workspace`, `/login`.
* iOS Universal Links: host `https://agent.oriondesk.space/.well-known/apple-app-site-association`
  (`applinks.details[].appIDs = ["<TEAMID>.my.oriondesk.agentic"]`, the same paths) and the
  Associated Domains entitlement `applinks:agent.oriondesk.space`.
* In the app: `App.addListener("appUrlOpen", ({ url }) => { const u = new URL(url); window.location.assign(u.pathname + u.search + u.hash); })`.
* The server must serve both `.well-known` files with `content-type: application/json` and no
  redirect (Caddy/nginx route). The links already sent in emails, Telegram and push
  (`/approve/<id>`, `/tasks?task=<id>`) then open the app.

### 2.6 Microsoft sign-in inside the app

Today "Sign in with Microsoft" does `POST /api/auth/microsoft/start` and sends the page to
Microsoft; Microsoft comes back to `/api/integrations/microsoft/callback`, which sets the session
cookie and lands on `/login?sso=done`. Inside a WebView this mostly works for a password sign-in,
but Microsoft discourages embedded web views: Conditional Access device checks, passkeys,
"Approve in Microsoft Authenticator" and an existing browser session do not work there (Google
blocks embedded sign-in outright, `disallowed_useragent`). Do it like a native app:

1. In the app, open `start`'s URL with `Browser.open({ url })` (system browser), not in the WebView.
2. Server change (small, not built yet): when the start request says `client=app`, the callback
   does not set the cookie in the system browser; it makes a one-time code (60 s, single use,
   bound to the user and the start request's state) and redirects to
   `https://agent.oriondesk.space/app/sso-return?code=<code>` (an App Link / Universal Link).
3. The OS hands that link to the app (`appUrlOpen`, 2.5); the app closes the browser
   (`Browser.close()`) and the WebView posts the code to a new `POST /api/auth/sso/redeem`, which
   sets the session cookie in the WebView and answers like `/login?sso=done` (two-step code next
   if needed).
4. Keep the redirect URI already registered in Entra; no new one is needed because the callback
   path does not change. Password sign-in and the emailed sign-in code work unchanged.

### 2.7 Push notifications

The office sends Web Push today (`agentic/channels/webpush.py`, VAPID; `/api/channels/push/*`).
A WebView has no Web Push. For the app:

1. Firebase project: add the Android app (`google-services.json` into `android/app/`), and an APNs
   key (.p8) uploaded to Firebase for iOS (or send to APNs directly). Enable Push Notifications
   and Background Modes > Remote notifications in Xcode.
2. In the app: `PushNotifications.requestPermissions()`, `register()`, and on `registration`
   send `{ token, platform }` to a new `POST /api/channels/push/native` (server change, not
   built yet: store it next to `PushSubscription` with kind `fcm`/`apns`).
3. Server: where `webpush.send` is called, also send to the person's native tokens with the FCM
   HTTP v1 API (service account JSON in the vault, never in the repo). Same payload: title, body,
   `url` to open, and the approval actions.
4. In the app: `pushNotificationActionPerformed` opens `notification.data.url` in the WebView;
   `setBadge` (already in `lib/push.ts` for the installed web app) is matched with
   `@capawesome/capacitor-badge` if wanted.
5. Done in P96: inside the app `lib/push.ts` reports browser push as unsupported and counts the
   app as installed, so the Channels page and the install card never offer "Add to Home Screen"
   or browser push there. When native push exists, show its own switch on that page instead.

### 2.8 File downloads and uploads

* Downloads: done (2.3). If a server answer must open straight in a viewer, add
  `@capacitor-community/file-opener` and call it after `Filesystem.writeFile` in
  `lib/native.ts:saveFile` (one place).
* Uploads: `<input type="file">` works; very large uploads (> 100 MB) in a WebView are limited
  by memory: keep the server's chunked upload for big files.
* The PC app download (`AgenticOfficePC.exe`) is for Windows: hide that card when
  `isNativeApp()` if store review asks.

### 2.9 Store checklist

* App icons: from `apps/web/public/icons/icon-512.png` and `icon-maskable-512.png` with
  `npx @capacitor/assets generate` (adaptive icon background `#0d1210`).
* Privacy: the data-safety (Play) and privacy nutrition (App Store) forms list account data,
  files people upload, and diagnostics; no ads, no tracking. Link the office privacy page.
* Test on a small Android (360 x 800), an iPhone SE (375 x 667) and a notched iPhone, portrait
  and landscape: sign-in, Microsoft sign-in (2.6), approve from a push, Back closing a sheet,
  upload a receipt from the camera, download a PDF and share it, offline banner.
