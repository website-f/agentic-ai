import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, installHeldGuard, isHeld } from "./api";
import { oneTimePassword } from "./held";

describe("P125 a change held for approval", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ends as a held_for_approval notice, never as done, and skips the red toast", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ held: true, request_id: "hc_1", summary: "Add member Ali (ali@example.com) as Staff" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    const info = vi.spyOn(toast, "info");
    const error = vi.fn(() => "x");
    toast.error = error as unknown as typeof toast.error;
    installHeldGuard();
    let caught: unknown = null;
    try {
      await api("/api/members", "POST", { email: "ali@example.com" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(isHeld(caught)).toBe(true);
    const message = (caught as ApiError).message;
    expect(message).toContain("Add member Ali");
    expect(info).toHaveBeenCalledWith(message, expect.objectContaining({ id: "held-hc_1" }));
    // A screen's usual error toast for it is not shown; another error still is.
    toast.error(message);
    expect(error).not.toHaveBeenCalled();
    toast.error("Something else failed");
    expect(error).toHaveBeenCalledWith("Something else failed", undefined);
  });

  it("a plain 202 is still an answer", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ queued: 3 }), { status: 202 }));
    await expect(api<{ queued: number }>("/api/members/signin-emails/bulk", "POST", {})).resolves.toEqual({ queued: 3 });
  });

  it("finds a one-time password in the approved run's answer", () => {
    expect(oneTimePassword({ temp_password: "abc123XYZ" })).toBe("abc123XYZ");
    expect(oneTimePassword({ member: {} })).toBeNull();
    expect(oneTimePassword(null)).toBeNull();
  });
});
