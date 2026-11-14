/**
 * P104: writes the app's id and name from app.json (the one place to change them) into the
 * Android and iOS projects. `npm run sync` runs it; it changes nothing when they already match.
 * The Android code's own package (namespace, MainActivity) stays as it is: only the store id moves.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const { appId, appName } = JSON.parse(readFileSync(join(here, "app.json"), "utf8"));
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appId)) throw new Error(`app.json appId is not a valid id: ${appId}`);
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function edit(rel, change) {
  const file = join(here, rel);
  if (!existsSync(file)) return console.log(`(skipped, not there) ${rel}`);
  const before = readFileSync(file, "utf8");
  const after = change(before);
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`updated ${rel}`);
  }
}

edit("android/app/build.gradle", (s) => s.replace(/applicationId "[^"]*"/, `applicationId "${appId}"`));
edit("android/app/src/main/res/values/strings.xml", (s) =>
  s
    .replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${xml(appName)}$2`)
    .replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${xml(appName)}$2`)
    .replace(/(<string name="package_name">)[^<]*(<\/string>)/, `$1${appId}$2`)
    .replace(/(<string name="custom_url_scheme">)[^<]*(<\/string>)/, `$1${appId}$2`),
);
edit("ios/App/App.xcodeproj/project.pbxproj", (s) => s.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]*;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${appId};`));
edit("ios/App/App/Info.plist", (s) => s.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${xml(appName)}$2`));
console.log(`app id ${appId}, name "${appName}"`);
