/** P92: the sign-in page's "Email me a sign-in password", the owner's Sign-in emails settings,
 * and the Members page bar. The API is a stubbed fetch; synthetic data only. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bulkMinutesLeft, plausibleAddress, rbacScript, type BulkJob, type SystemMail } from "@/lib/signin-emails";

import { EmailSignInForm, SignInEmailsBar, SignInEmailsSection } from "./sign-in-emails";

type Call = { path: string; method: string; body: unknown };

function stubApi(answer: (path: string, method: string, body: unknown) => [number, unknown]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method, body });
      const [status, data] = answer(path, method, body);
      return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const SAVED: SystemMail = {
  enabled: false,
  address: "",
  from_name: "No Reply",
  first_login: true,
  forgot_password: true,
  microsoft_app: true,
  problem: "Sign-in emails are not set up yet. An owner sets the sender in Settings > Sign-in emails.",
  setup_doc: "docs/SYSTEM_EMAIL_SETUP.md",
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Email me a sign-in password", () => {
  it("checks the address before asking", async () => {
    const calls = stubApi(() => [202, { ok: true }]);
    wrap(<EmailSignInForm onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /Email me a sign-in password/ }));
    expect(await screen.findByText("Type your full work email address.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("sends the email and always answers the same way", async () => {
    const calls = stubApi(() => [202, { ok: true }]);
    const back = vi.fn();
    wrap(<EmailSignInForm initialEmail=" new.person@example.com " onBack={back} />);
    fireEvent.click(screen.getByRole("button", { name: /Email me a sign-in password/ }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "If new.person@example.com belongs to someone in the office, a temporary password is on its way.",
    );
    expect(calls).toEqual([{ path: "/api/auth/email-signin", method: "POST", body: { email: "new.person@example.com" } }]);
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(back).toHaveBeenCalled();
  });
});

describe("Settings > Sign-in emails", () => {
  it("saves the sender and sends a test", async () => {
    let saved = { ...SAVED };
    const calls = stubApi((path, method, body) => {
      if (path === "/api/settings/system-mail" && method === "PUT") {
        saved = { ...saved, ...(body as object), problem: null };
        return [200, saved];
      }
      if (path === "/api/settings/system-mail/test") return [200, { ok: true, to: "owner@example.com" }];
      return [200, saved];
    });
    wrap(<SignInEmailsSection />);
    const address = await screen.findByLabelText("Sender address");
    expect(screen.getByText(SAVED.problem!)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(screen.getByRole("button", { name: /Send a test email to me/ })).toBeDisabled();

    fireEvent.change(address, { target: { value: "noreply@example" } });
    expect(screen.getByText("Type the full email address of the mailbox, like noreply@yourcompany.com.")).toBeInTheDocument();
    expect(save).toBeDisabled();

    fireEvent.change(address, { target: { value: "noreply@example.com" } });
    fireEvent.click(screen.getByRole("switch", { name: "Send sign-in emails" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
      enabled: true, address: "noreply@example.com", from_name: "No Reply", first_login: true, forgot_password: true,
    });

    const test = await screen.findByRole("button", { name: /Send a test email to me/ });
    await waitFor(() => expect(test).toBeEnabled());
    fireEvent.click(test);
    expect(await screen.findByText(/Test email sent to owner@example.com/)).toBeInTheDocument();
    expect(screen.getByText("How to set this up")).toBeInTheDocument();
  });

  it("shows Microsoft's refusal in plain words", async () => {
    const ready = { ...SAVED, enabled: true, address: "noreply@example.com", problem: null };
    stubApi((path) =>
      path.endsWith("/test")
        ? [502, { code: "send_denied", message: "The office's Microsoft app is not allowed to send mail as noreply@example.com yet." }]
        : [200, ready],
    );
    wrap(<SignInEmailsSection />);
    fireEvent.click(await screen.findByRole("button", { name: /Send a test email to me/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not allowed to send mail as noreply@example.com");
  });
});

describe("Members: sign-in emails bar", () => {
  it("warns when emails cannot go out, with a link for owners", async () => {
    stubApi(() => [200, { sender_ready: false, problem: "Sign-in emails are not set up yet.", never_signed_in: 4, job: null }]);
    wrap(<SignInEmailsBar isOwner />);
    expect(await screen.findByText("Sign-in emails are off")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up sign-in emails" })).toHaveAttribute("href", "/settings#sign-in-emails");
  });

  it("offers the bulk send and shows how far it got", async () => {
    const job: BulkJob = {
      state: "running", total: 10, sent: 3, failed: 1, skipped: 1, skipped_disabled: 1, skipped_no_email: 0,
      skipped_recent: 0, skipped_signed_in: 0, error: null, started_at: null, finished_at: null,
    };
    stubApi(() => [200, { sender_ready: true, problem: null, never_signed_in: 12, job }]);
    wrap(<SignInEmailsBar isOwner={false} />);
    expect(await screen.findByText("12 people have not signed in yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Email sign-in passwords to everyone/ })).toBeDisabled();
    expect(screen.getByText(/Sending sign-in emails: 5 of 10/)).toBeInTheDocument();
  });
});

describe("helpers", () => {
  it("fills the PowerShell with the sender and checks addresses", () => {
    const ps = rbacScript("noreply@example.com");
    expect(ps).toContain("PrimarySmtpAddress -eq 'noreply@example.com'");
    expect(ps).toContain('-Role "Application Mail.Send"');
    expect(ps).toContain("Test-ServicePrincipalAuthorization");
    expect(plausibleAddress("a@b.co")).toBe(true);
    expect(plausibleAddress("a@b")).toBe(false);
    const job = { total: 48, sent: 0, failed: 0, skipped: 0 } as BulkJob;
    expect(bulkMinutesLeft(job)).toBe(2);
  });
});
