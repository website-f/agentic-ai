/** P92: the Members page dialog that corrects a name or email. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Member } from "@/lib/types";

import { MemberIdentityDialog } from "./member-identity";

const SITI: Member = {
  user_id: "us_1", email: "siti.typo@example.com", name: "Siti", role: "hr", is_active: true, must_change_password: true,
  last_login_at: null, joined_at: "2026-11-09T00:00:00Z", microsoft: true,
};
let sent: { path: string; method?: string; body: unknown }[] = [];

beforeEach(() => {
  sent = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ path: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ ...SITI, email: "siti@example.com", name: "Siti Aminah" }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Change name or email", () => {
  it("says they will sign in again when the email changes, and sends only what changed", async () => {
    const closed = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}><MemberIdentityDialog member={SITI} open onOpenChange={closed} /></QueryClientProvider>);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(screen.queryByTestId("email-note")).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Siti Aminah" } });
    expect(screen.queryByTestId("email-note")).toBeNull();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "siti@example.com" } });
    expect(screen.getByTestId("email-note")).toHaveTextContent("They will need to sign in again. With Microsoft, they will be linked to the account of the new email");
    fireEvent.click(save);
    await waitFor(() => expect(closed).toHaveBeenCalledWith(false));
    expect(sent).toEqual([{ path: "/api/members/us_1", method: "PATCH", body: { name: "Siti Aminah", email: "siti@example.com" } }]);
  });
});
