import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The app's id, name and server come from app.json (the one place to change them; then run
 * `npm run sync`, which also writes them into the Android and iOS projects). */
const app = JSON.parse(readFileSync(join(process.cwd(), "app.json"), "utf8")) as { appId: string; appName: string };

const config: CapacitorConfig = {
  appId: app.appId,
  appName: app.appName,
  // The office (/) and Prima (/prima/) as the server serves them, built by scripts/build-web.mjs.
  webDir: "www",
  // Android: the page runs at https://localhost (iOS: capacitor://localhost). Only data goes to the
  // server; any other site opens in the phone's browser (no allowNavigation list on purpose).
  server: { androidScheme: "https" },
  android: { allowMixedContent: false },
  ios: { contentInset: "never" },
};

export default config;
