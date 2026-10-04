import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { cn, greeting, initials, timeAgo } from "./utils";

describe("utils", () => {
  it("initials takes first and last word", () => {
    expect(initials("Siti Nur Aisyah")).toBe("SA");
    expect(initials("ahmad")).toBe("A");
    expect(initials("   ")).toBe("?");
    expect(initials("Aisyah (Finance)")).toBe("AF");
    expect(initials("Joanne (Customer Service)")).toBe("JC");
    expect(initials("Rafi #2")).toBe("R2");
    expect(initials("Dr. Lim")).toBe("DL");
  });

  it("timeAgo handles never, just now and past times", () => {
    const now = Date.parse("2026-10-01T10:00:00Z");
    expect(timeAgo(null, now)).toBe("Never");
    expect(timeAgo("2026-10-01T09:59:40Z", now)).toBe("Just now");
    expect(timeAgo("2026-10-01T07:00:00Z", now)).toMatch(/3 hours ago/);
  });

  it("greeting follows the clock", () => {
    expect(greeting(new Date(2026, 9, 1, 8))).toBe("Good morning");
    expect(greeting(new Date(2026, 9, 1, 14))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 9, 1, 21))).toBe("Good evening");
  });

  it("cn merges conflicting tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("ApiError keeps code and field errors", () => {
    const e = new ApiError(422, "validation_failed", "Fix fields", { email: "Invalid" });
    expect(e.code).toBe("validation_failed");
    expect(e.fields.email).toBe("Invalid");
  });
});
