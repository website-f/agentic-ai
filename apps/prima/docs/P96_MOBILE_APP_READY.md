# P96: Prima phone first and ready for the Android and iOS app

Fitri, 10 Nov 2026: "make this Prima app super mobile friendly ... because we will export it to APK and iOS later."

Status: built and checked in the demo build (headless Edge, synthetic data). Not deployed. No server, database or
permission change. The Android and iOS apps themselves are not built yet: the steps are at the end.

## How it was checked

Every screen in the menu of six people was opened in the demo build (`npx vite build --mode demo`), in Bahasa Melayu
(the default screen language, and the longest words), at 360, 390 and 414 px wide (phones) and at 1366 px (a laptop):
the CEO (persona 0, 77 screens), the Chief of Staff and HR Director (12, 74), the COO (9, 76), Finance Team Leader 1
(20, 32), a site officer (66, 19) and a guard (82, 4). The script measured on each screen: sideways page scroll,
elements past the right edge, tables wider than the screen, controls under 44 px, typing fields under 16 px (an iPhone
zooms in on those), text cut off without "...", and fixed bars covering the end of the page. The source was searched for
hover-only actions, `100vh`, `window.open` and `window.print`, and every sheet and dialog was listed.

## What was found (before) and what was done

| Found (before) | Fix (where) |
| --- | --- |
| Controls under 44 px on every screen: 3,276 on the CEO's 77 screens at 390 px, mostly small buttons (`.btn-sm`, 32-34 px), the app bar's Back (40 px) and name, pick-lists, segmented choices, folded sections, tick boxes. | `styles/mobile.css`: on phones and touch screens every button, small button, pick-list, tab, chip button, folded-section title and tick-box line is at least 44 px; icon-only buttons are at least 44 px wide. Computers with a mouse keep the compact sizes. |
| Home at 360 px scrolled sideways by 7 px: a long button label ("Open a company...") did not wrap. | Buttons on phones wrap their words inside the button (buttons inside tables keep one line and scroll with the table). |
| Tables wider than the phone: 100 tables on 13 of the CEO's screens at 390 px: they scrolled sideways inside their card (first column held). | `mobile.ts` + `mobile.css`: a list table (3 to 12 columns, one plain header row, no merged cells) becomes one card per row on a phone: the first cell is the card's title, each other cell shows its column name above its value. Grids of days or months (roster, attendance sheet, weekly and monthly figures), tables with merged cells and any table marked `data-phone="scroll"` keep sideways scrolling with the first column in view. The labels follow the screen language. |
| The Android back button (and the iPhone's swipe back) left the screen while a drawer, sheet, pick-list or camera was open. | `back-close.ts`: each open drawer (`ui.tsx` Drawer), the More and Apps sheets, the app switcher, the alerts panel, Arisha, the phone pick-list sheet, the face check cameras and the item scanner (camera and typed ID) adds one history entry; Back closes the top one only and the screen stays. Closing with its own button takes the entry off again. `App.tsx` ignores a Back that closed a sheet. |
| `100vh` heights are taller than the visible screen on a phone (address bar, keyboard in an app). | `dvh` for the side menu, split lists, the confidentiality card, the alerts panel and the phone drawer (the `vh` line stays for older browsers). |
| The top bar stuck below the notch with page content visible above it (`viewport-fit=cover`, translucent status bar). | The top bar sits at the very top with padding for the notch; sign-in and the confidentiality notice keep clear of the notch and the home bar. |
| The bottom tabs and Arisha's button sat on top of the keyboard while typing. | `mobile.ts` marks `<html data-typing>` while a text field has the focus on a phone; the bottom bars step aside and the field is scrolled to the middle once the keyboard is up. The viewport asks the browser to resize the page for the keyboard (`interactive-widget=resizes-content`). |
| Hover-only: the arrow on Home's lists showed on mouse hover only; the attendance trend charts showed a month's figure on mouse hover only. | The arrow always shows on touch screens; a tap on a month shows its figure. |
| `window.print()` and `window.open()` do nothing inside an app WebView (Finance board print, Websites print, client report print, sale papers, label sheet). | `native.ts`: in a browser they print or open as before; inside the app (or when the browser blocks the new window) the page or file is saved instead, with a plain message. |
| Camera and location help told a person in our own app to "open it in Chrome" (the WebView looks like WhatsApp's in-app browser). | `checkin-permissions.ts`: the app wrapper adds `PrimaApp/` to the browser name; then the help shows "Prima app on Android / iPhone" steps (phone Settings > Apps > Prima), never "open it in Chrome". |
| Install: one SVG icon marked "any maskable", no maskable PNG, no 180 px Apple icon, no `id`/`scope`. | `public/manifest.webmanifest` with `id`, `scope`, `lang`, maskable 192/512 PNGs (`icon-maskable-*.png`, the mark inside the safe zone) and `apple-touch-icon-180.png`. |

Typing fields were already 16 px on phones (no zoom), sheets already scrolled inside themselves, and the bottom tabs
already kept clear of the home bar.

After the fixes the same sweep was run again on the same six people and screens (final demo build). The last few
controls it still found (period and filter buttons on the leadership and report screens, the alerts count button) were
fixed and those screens rechecked: none left. The swipe strips' edge fades on touch screens are not counted: they are
decoration there (`pointer-events: none`), the strip is swiped.

| Person | Screens | Controls under 44 px at 390 px: before | after the full re-run | after the last fix | Tables wider than the phone (screens): before | after | Sideways page scroll at 360-414 px: before | after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CEO (0) | 77 | 3,276 | 7 | 0 | 13 (100 tables) | 5 | 1 | 0 |
| CoS / HR Director (12) | 74 | 2,527 | 11 | 0 | 13 (97 tables) | 5 | 1 | 0 |
| COO (9) | 76 | 2,520 | 14 | 0 (same buttons) | 12 (97 tables) | 5 | 1 | 0 |
| Finance Team Leader 1 (20) | 32 | 369 | 4 | 0 (same buttons) | 2 (5 tables) | 0 | 0 | 0 |
| Site officer (66) | 19 | 606 | 0 | 0 | 3 (3 tables) | 2 | 0 | 0 |
| Guard (82) | 4 | 17 | 0 | 0 | 0 | 0 | 0 | 0 |

The tables still wider than a phone are grids kept on purpose (sideways scroll, first column held): the roster, the
attendance sheet, shifts by day on Operations, monthly figures on Commercial and the IT team's workload grid. No screen
changed at 1366 px (the same checks found nothing there before or after), and no page error was raised.

Also checked in the browser (Edge, 390 px, CEO): Back with the More sheet open closes it and stays on People; Back with a
person's record drawer open closes it and stays on People; closing the drawer with its own button leaves no extra Back
step; focusing a search field marks the page as typing and hides the bottom tabs, which come back on leaving the field.

## Rules for new screens

- Use the kit's buttons and controls; on a phone they are 44 px high by themselves. A custom clickable thing needs
  `min-height: 44px` (and `min-width` if it is only an icon).
- A list table (3 to 12 columns) needs one plain header row; on a phone it becomes cards. A grid of days or months, or anything that must
  stay a table, gets `data-phone="scroll"` on the table or its wrapper.
- Any new sheet, drawer or full-screen dialog calls `useBackClose(open, close)` (`back-close.ts`), or uses `Drawer`.
- Never rely on hover. Never use `100vh` alone. Never call `window.print()` or `window.open()` directly: use
  `printPage`, `printHtml` or `openBlob` (`native.ts`).

## Wrapping Prima as the Android and iOS app (Capacitor)

Prima stays one web app; the phone apps are a thin shell around the same site, so a deploy updates every phone at once
and the server keeps every check. Capacitor (Ionic, MIT licence) is the shell. Nothing below has been run yet; it needs
a Mac with Xcode for iOS, Android Studio for Android, and the store accounts.

1. In a new folder outside this repository (`prima-mobile/`): `npm init -y`, then `npm i @capacitor/core @capacitor/cli
   @capacitor/android @capacitor/ios` and `npx cap init "Prima" "com.pwvsb.prima" --web-dir www`.
2. `capacitor.config.json`: load the live site rather than a copy, so the app is always the deployed Prima, and mark
   the app in the browser name so Prima knows it is inside its own app:

   ```json
   {
     "appId": "com.pwvsb.prima",
     "appName": "Prima",
     "webDir": "www",
     "server": { "url": "https://agent.oriondesk.space/prima/", "androidScheme": "https", "allowNavigation": ["agent.oriondesk.space", "login.microsoftonline.com"] },
     "appendUserAgent": "PrimaApp/1.0",
     "android": { "allowMixedContent": false },
     "ios": { "contentInset": "never" }
   }
   ```

   `www/index.html` only needs a "Loading Prima..." page for the first start offline.
3. `npx cap add android` and `npx cap add ios`.
4. Permissions (the app asks the phone; Prima's own screens then work as in Chrome or Safari):
   - Android `AndroidManifest.xml`: `CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, and
     `<uses-feature android:name="android.hardware.camera" android:required="false" />`. The WebView must grant the
     page's camera and location requests: Capacitor's Bridge WebChromeClient does this once the app holds the permission.
   - iOS `Info.plist`: `NSCameraUsageDescription` ("Prima uses the camera for the face check at clock-in and to scan item
     labels."), `NSLocationWhenInUseUsageDescription` ("Prima checks you are at your site when you clock in.").
5. Back button: nothing to add. Capacitor sends Android's back button to the WebView's history; Prima closes the open
   sheet first (`back-close.ts`), then goes back a screen.
6. Downloads and printing: install `@capacitor/filesystem` and `@capacitor/share`, and in the shell listen for blob
   downloads (Android `DownloadListener`, iOS `WKDownloadDelegate`) to save into Files and offer Share. Prima already
   saves instead of printing when it sees `PrimaApp/` (`native.ts`).
7. Sign-in: Microsoft sign-in opens in the app's WebView on the same site (`allowNavigation` above). Emailed sign-in
   codes work as on the web.
8. Icons and splash: `npx @capacitor/assets generate` from `apps/prima/apps/web/public/icon-maskable-512.png`
   (background #13895f).
9. Status bar: `@capacitor/status-bar`, overlay on, style dark text on light theme; Prima pads the top bar for the notch.
10. Build: `npx cap sync`, then Android Studio > Build > Generate Signed Bundle (AAB for Play) and Xcode > Archive (App
    Store / TestFlight). Test on a real phone: sign in, clock in with the face check and location, scan an item label,
    open and close drawers with the back button, type in a drawer with the keyboard up, print a Finance board (saved as
    a file).

Gates that stay: the store listings, the privacy policy page, the app signing keys and who holds them, and the
decision to publish are for Fitri and the CEO.
