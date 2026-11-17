/** P109b "New Teams meeting" with AI: the AI fills the form, the person settles anyone it was
 * unsure about, nothing is sent until "Create and send invitations", then the join link (with
 * Copy) and where the meeting stands in Prima ("Add to Prima" when Prima said no). */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readyPeople, type MeetingDraft, type TeamsMeeting } from "@/lib/m365";

import { MeetingComposer } from "./meeting";

vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});
vi.mock("@/components/voice-input", () => ({ VoiceInput: () => null }));

const JOIN = "https://teams.microsoft.com/l/meetup-join/abc";
const DRAFT: MeetingDraft = {
  title: "D WAY roster",
  start: "2026-11-18T07:00:00.000Z",
  end: "2026-11-18T07:45:00.000Z",
  minutes: 45,
  attendees: [
    { name: "Faiz Rahman", email: "faiz@maju.example.com", status: "ok", options: [] },
    { name: "Nabilah", email: "", status: "choose", options: [
      { name: "Nabilah Omar", email: "nabilah@maju.example.com", source: "office" },
      { name: "Nabilah Aziz", email: "aziz@client.example.com", source: "outlook" },
    ] },
    { name: "Hafiz", email: "", status: "unknown", options: [] },
  ],
  agenda: "December roster\nStandby guards",
  kind: "operations",
  time_zone: "Asia/Kuala_Lumpur",
};

const made = (prima: TeamsMeeting["prima"]): TeamsMeeting => ({
  id: "tm1", event_id: "ev1", title: "D WAY roster", start: DRAFT.start, end: DRAFT.end,
  attendees: [{ name: "Faiz Rahman", email: "faiz@maju.example.com" }], agenda: DRAFT.agenda,
  join_url: JOIN, web_link: "https://outlook/ev1", kind: "operations", cancelled: false, prima,
});

let calls: { method: string; path: string; body: unknown }[] = [];
let primaAnswer: TeamsMeeting["prima"] = { status: "added", meeting_id: "mt-1", reason: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  primaAnswer = { status: "added", meeting_id: "mt-1", reason: null };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname === "/api/m365/summary") return json({ configured: true, connected: true, prima: true });
    if (url.pathname === "/api/m365/meetings/draft") return json(DRAFT);
    if (url.pathname === "/api/m365/meetings" && method === "POST") return json(made(primaAnswer), 201);
    if (url.pathname === "/api/m365/meetings/prima") return json(made({ status: "added", meeting_id: "mt-1", reason: null }));
    if (url.pathname === "/api/m365/people") return json([]);
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MeetingComposer start={{}} onClose={onClose} /></QueryClientProvider>);
  return { onClose };
}

async function fillWithAi() {
  fireEvent.change(await screen.findByPlaceholderText(/Meeting with Faiz and Nabilah/), {
    target: { value: "Meeting with Faiz and Nabilah tomorrow 3pm about the D WAY roster, 45 min, send agenda" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Fill in with AI/ }));
  await screen.findByDisplayValue("D WAY roster");
}

describe("New Teams meeting", { timeout: 30_000 }, () => {
  it("fills the form with AI and sends nothing until the person settles everyone and presses Create", async () => {
    show();
    await fillWithAi();
    expect(screen.getByDisplayValue(/December roster/)).toBeInTheDocument();
    const people = screen.getByRole("list", { name: "People to invite" });
    expect(within(people).getByText("Faiz Rahman")).toBeInTheDocument();
    expect(within(people).getByText("Which Nabilah?")).toBeInTheDocument();
    expect(within(people).getByText("No address found for Hafiz")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: /Create and send invitations/ });
    expect(create).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Pick or type an address for: Nabilah, Hafiz");

    fireEvent.click(within(people).getByRole("button", { name: /Nabilah Omar/ }));
    fireEvent.change(within(people).getByPlaceholderText("Email for Hafiz"), { target: { value: "hafiz@maju.example.com" } });
    fireEvent.click(within(people).getByRole("button", { name: "Use" }));
    await waitFor(() => expect(create).toBeEnabled());
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/api/m365/meetings/draft"]);

    fireEvent.click(create);
    await screen.findByText("Meeting created. Invitations sent.");
    const post = calls.find((c) => c.method === "POST" && c.path === "/api/m365/meetings")!;
    expect(post.body).toMatchObject({
      title: "D WAY roster",
      start: DRAFT.start,
      end: DRAFT.end,
      agenda: "December roster\nStandby guards",
      kind: "operations",
      prima: true,
      attendees: [
        { name: "Faiz Rahman", email: "faiz@maju.example.com" },
        { name: "Nabilah Omar", email: "nabilah@maju.example.com" },
        { name: "Hafiz", email: "hafiz@maju.example.com" },
      ],
    });
    expect(screen.getByDisplayValue(JOIN)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByText("Recorded in Prima Meetings.")).toBeInTheDocument();
  });

  it("says why Prima did not take it and adds it again on request", async () => {
    primaAnswer = { status: "failed", meeting_id: null, reason: "You may not view (meeting)" };
    show();
    await fillWithAi();
    const people = screen.getByRole("list", { name: "People to invite" });
    fireEvent.click(within(people).getByRole("button", { name: "Remove Nabilah" }));
    fireEvent.click(within(people).getByRole("button", { name: "Remove Hafiz" }));
    fireEvent.click(await screen.findByRole("button", { name: /Create and send invitations/ }));
    expect(await screen.findByText("Not added to Prima: You may not view (meeting)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to Prima" }));
    await screen.findByText("Recorded in Prima Meetings.");
    expect(calls.find((c) => c.path === "/api/m365/meetings/prima")!.body).toEqual({ event_id: "ev1" });
  });

  it("adds someone typed by address, and never the same person twice", () => {
    expect(readyPeople([
      { name: "A", email: "A@x.my", status: "ok", options: [] },
      { name: "A again", email: "a@x.my", status: "ok", options: [] },
      { name: "B", email: "", status: "unknown", options: [] },
    ])).toEqual({ ok: [{ name: "A", email: "a@x.my" }], missing: [{ name: "B", email: "", status: "unknown", options: [] }] });
  });
});
