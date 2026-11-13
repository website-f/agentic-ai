/** P102: a draft waiting for approval says in plain words what Send does (never a tool's code
 * name), shows the whole text, and sends only when the person presses Send. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EmailDraft } from "@/lib/assistants";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));

const calls: { url: string; method?: string; body?: unknown }[] = [];
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: vi.fn(async (url: string, method?: string, body?: unknown) => {
    calls.push({ url, method, body });
    return {};
  }),
}));

// jsdom has no matchMedia (the discard dialog asks whether this is a phone).
window.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const { DraftCard, draftTitle } = await import("./index");

const base: EmailDraft = {
  id: "ed_1", status: "pending", to: "ali@client.example.com", cc: "", subject: "Quote", body: "Hello Ali,\nThe quote is attached.",
  original_from: "", original_snippet: "", is_reply: false, agent_id: "a1", agent_name: "Boss Twin", error: null,
  created_at: new Date().toISOString(), decided_at: null, provider: "microsoft", mailbox_kind: "personal", mailbox_label: "boss@x.com",
};

function show(d: EmailDraft) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><DraftCard d={d} /></QueryClientProvider>);
}

const t = (s: string, v?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v?.[k] ?? ""));

afterEach(() => { cleanup(); calls.length = 0; });

describe("drafts to approve", () => {
  it("titles say what Send does", () => {
    expect(draftTitle(base, t)).toBe("Send email to ali@client.example.com: Quote");
    expect(draftTitle({ ...base, is_reply: true, kind: "reply", subject: "RE: Quote" }, t)).toBe("Reply to ali@client.example.com: RE: Quote");
    expect(draftTitle({ ...base, is_reply: true, subject: "FW: Quote" }, t)).toBe("Forward to ali@client.example.com: FW: Quote");
    expect(draftTitle({ ...base, provider: "teams", is_reply: true, subject: "Siti Aminah", to: "Siti Aminah" }, t)).toBe("Reply to Siti Aminah in Teams");
    expect(draftTitle({ ...base, provider: "teams", subject: "ali@maju.com", to: "ali@maju.com" }, t)).toBe("Teams message to ali@maju.com");
  });

  it("an email: the whole text, the subject, and Send", async () => {
    show(base);
    expect(screen.getByRole("heading", { name: "Send email to ali@client.example.com: Quote" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email body")).toHaveValue("Hello Ali,\nThe quote is attached.");
    expect(screen.getByLabelText("Subject")).toHaveValue("Quote");
    expect(screen.queryByText(/outlook_draft/)).toBeNull();
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() => expect(calls).toEqual([{ url: "/api/email-drafts/ed_1/send", method: "POST", body: undefined }]));
  });

  it("a Teams reply: who it answers, the last message, the whole text, Send in Teams", async () => {
    show({ ...base, provider: "teams", kind: "teams", is_reply: true, subject: "Siti Aminah", to: "Siti Aminah", body: "Yes, by 5pm.",
      original_from: "Siti Aminah", original_snippet: "Tender pack today?" });
    expect(screen.getByRole("heading", { name: "Reply to Siti Aminah in Teams" })).toBeInTheDocument();
    expect(screen.getByText("Last message from Siti Aminah")).toBeInTheDocument();
    expect(screen.getByText("Tender pack today?")).toBeInTheDocument();
    expect(screen.queryByLabelText("Subject")).toBeNull();
    const box = screen.getByLabelText("Teams message");
    fireEvent.change(box, { target: { value: "Yes, by 4pm." } });
    fireEvent.click(screen.getByRole("button", { name: /Save and send/ }));
    await waitFor(() => expect(calls.map((c) => [c.url, c.method])).toEqual([["/api/email-drafts/ed_1", "PATCH"], ["/api/email-drafts/ed_1/send", "POST"]]));
    expect(calls[0]!.body).toEqual({ body: "Yes, by 4pm." });
  });
});
