/** P96: what an app store wrapper (Capacitor) and an installed web app rely on is in place. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..");
const read = (p: string) => readFileSync(join(WEB, p), "utf8");

describe("app shell readiness", () => {
  it("index.html lets the app draw under a notch and the keyboard resize the page", () => {
    const html = read("index.html");
    const viewport = /<meta name="viewport" content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(viewport).toContain("viewport-fit=cover");
    expect(viewport).toContain("interactive-widget=resizes-content");
    expect(viewport).not.toMatch(/user-scalable=no|maximum-scale/); // people may still zoom
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon"');
  });

  it("the web manifest is complete and every icon it names exists", () => {
    const m = JSON.parse(read("public/manifest.webmanifest")) as {
      name: string; short_name: string; id: string; start_url: string; scope: string; display: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };
    expect(m.name).toBeTruthy();
    expect(m.short_name.length).toBeLessThanOrEqual(12); // fits under a home-screen icon
    expect([m.id, m.start_url, m.scope]).toEqual(["/", "/", "/"]);
    expect(m.display).toBe("standalone");
    const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose ?? "any"}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    for (const i of m.icons) expect(existsSync(join(WEB, "public", i.src))).toBe(true);
    expect(existsSync(join(WEB, "public/icons/apple-touch-icon.png"))).toBe(true);
  });

  it("the shell pads for the notch and the home bar, and uses dvh, not vh", () => {
    const shell = read("src/components/shell.tsx");
    expect(shell).toContain("h-[calc(3.5rem+env(safe-area-inset-top))]");
    expect(shell).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(shell).toContain("min-h-dvh");
    expect(shell).not.toMatch(/\b100vh\b|h-screen/);
  });
});
