// P123: the feedback widget inside Prima: on its own, and inside the office's own page; never in the preview or
// inside another site's page.
import { describe, expect, it } from "vitest";

import { widgetUnwelcome } from "./prima";

const win = (path: string, top: unknown, origin = "https://agent.example.com") => {
  const self: Record<string, unknown> = { location: { pathname: path, origin } };
  self.self = self;
  self.top = top === "self" ? self : top;
  return self as unknown as Window;
};

describe("widgetUnwelcome", () => {
  it("welcomes Prima on its own and inside the office's own page", () => {
    expect(widgetUnwelcome(win("/prima/", "self"))).toBe(false);
    expect(widgetUnwelcome(win("/prima/", { location: { origin: "https://agent.example.com" } }))).toBe(false);
  });
  it("stays away from the preview and from another site's page", () => {
    expect(widgetUnwelcome(win("/prima/demo/", "self"))).toBe(true);
    expect(widgetUnwelcome(win("/prima/", { location: { origin: "https://elsewhere.example.com" } }))).toBe(true);
    const crossSite = { get location(): never { throw new Error("blocked"); } };
    expect(widgetUnwelcome(win("/prima/", crossSite))).toBe(true);
  });
});
