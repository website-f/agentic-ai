/**
 * P104: runs the Android build (android/gradlew) with JDK 21 and the Android SDK, found without
 * any system-wide setting: JAVA_HOME when it is a JDK 21, else a JDK 21 unpacked under
 * %LOCALAPPDATA%\Programs\Microsoft or installed under Program Files\Microsoft (Microsoft OpenJDK).
 * ANDROID_HOME defaults to %LOCALAPPDATA%\Android\Sdk (Android Studio's place).
 *   node scripts/gradle.mjs assembleDebug
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const win = process.platform === "win32";

const isJdk21 = (home) => {
  try {
    return /JAVA_VERSION="21[."]/.test(readFileSync(join(home, "release"), "utf8"));
  } catch {
    return false;
  }
};
function findJdk() {
  if (process.env.JAVA_HOME && isJdk21(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  const roots = [join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft"), "C:\Program Files\Microsoft"];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const hit = readdirSync(root).filter((n) => n.startsWith("jdk-21")).sort().pop();
    if (hit && isJdk21(join(root, hit))) return join(root, hit);
  }
  console.warn("No JDK 21 found: using JAVA_HOME as it is (Gradle 8.14 does not run on JDK 25).");
  return process.env.JAVA_HOME;
}

const env = { ...process.env };
const jdk = findJdk();
if (jdk) env.JAVA_HOME = jdk;
if (!env.ANDROID_HOME && process.env.LOCALAPPDATA) env.ANDROID_HOME = join(process.env.LOCALAPPDATA, "Android", "Sdk");
console.log(`JAVA_HOME=${env.JAVA_HOME}\nANDROID_HOME=${env.ANDROID_HOME}`);
const android = join(here, "android");
const tasks = process.argv.slice(2).length ? process.argv.slice(2) : ["assembleDebug"];
if (win) execFileSync("cmd.exe", ["/d", "/c", ".\\gradlew.bat", ...tasks], { cwd: android, env, stdio: "inherit" });
else execFileSync("./gradlew", tasks, { cwd: android, env, stdio: "inherit" });
