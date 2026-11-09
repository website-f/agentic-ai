/** P92: the Lessons view and the "Noted for next time" note: who may edit, forget and undo,
 * the daily digest, and that Undo calls the server. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LessonNote } from "@/components/lesson-note";
import type { Lesson, LessonDigest, LessonList } from "@/lib/lessons";

import { AgentLessons, LessonsView } from "./lessons";

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: "fa_1", text: "Write the brand and model in Catatan.", topic: "eperolehan", topic_label: "ePerolehan",
    when: null, do: null, dont: "leave only Ya", field: "Catatan", example: null,
    agent_id: "ag_1", agent_name: "Tina", private: false, via: "send_back",
    taught_by: "user:u1", taught_by_name: "Owner One", taught_at: new Date().toISOString(), taught: 1,
    uses: 3, last_used_at: new Date().toISOString(), task_id: null, folded_into: null,
    state: "active", end_reason: null, ended_at: null, superseded_by: null, can_edit: false, can_undo: false,
    ...over,
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function server(list: LessonList, digest?: LessonDigest) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if (path.startsWith("/api/learning/digest")) {
      return json(digest ?? { day: "2026-11-09", previous: "2026-11-08", next: null, lessons: [], repeated: [], skills: [], folds: [], totals: { lessons: 0, replaced: 0, repeated: 0, skills: 0 } });
    }
    if (path.endsWith("/undo") && init?.method === "POST") return json({ lesson: { ...list.items[0], state: "ended" }, restored: null });
    if (path.startsWith("/api/lessons")) return json(list);
    return json({});
  });
}

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  // ResponsiveDialog and friends ask whether this is a phone.
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Lessons view", () => {
  it("shows who taught each lesson and when it was used; staff get no Edit or Forget", async () => {
    vi.stubGlobal("fetch", server({ items: [lesson({ can_undo: true })], topics: [{ key: "eperolehan", label: "ePerolehan", count: 1 }], agents: [{ id: "ag_1", name: "Tina", count: 1 }], can_edit: false }));
    render(wrap(<LessonsView />));
    expect(await screen.findByText("Write the brand and model in Catatan.")).toBeInTheDocument();
    expect(screen.getByText(/taught by Owner One/)).toBeInTheDocument();
    expect(screen.getByText(/used 3×/)).toBeInTheDocument();
    expect(screen.getByText("leave only Ya")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Forget/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Undo/ })).toBeInTheDocument();
    expect(await screen.findByText("Getting smarter every day")).toBeInTheDocument();
  });

  it("owners and admins can edit and forget", async () => {
    vi.stubGlobal("fetch", server({ items: [lesson({ can_edit: true, can_undo: true })], topics: [], agents: [], can_edit: true }));
    render(wrap(<LessonsView />));
    expect(await screen.findByRole("button", { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Forget/ })).toBeInTheDocument();
  });

  it("the digest lists the day's lessons and repeated mistakes", async () => {
    const repeated = lesson({ id: "fa_2", text: "Download every tender document first.", taught: 2 });
    vi.stubGlobal("fetch", server({ items: [], topics: [], agents: [], can_edit: false }, {
      day: "2026-11-09", previous: "2026-11-08", next: null, lessons: [lesson()], repeated: [repeated],
      skills: [{ skill_id: "sk_1", name: "eperolehan-tender", version: 2, note: null, auto: true, at: "2026-11-09T01:00:00Z" }],
      folds: [], totals: { lessons: 1, replaced: 0, repeated: 1, skills: 1 },
    }));
    render(wrap(<LessonsView />));
    expect(await screen.findByText("Download every tender document first.")).toBeInTheDocument();
    expect(screen.getByText("taught 2 times")).toBeInTheDocument();
    expect(screen.getByText("eperolehan-tender")).toBeInTheDocument();
    expect(screen.getByText("No lessons yet")).toBeInTheDocument();
  });

  it("an agent's page lists what people taught it", async () => {
    const fetch = server({ items: [lesson()], topics: [], agents: [], can_edit: false });
    vi.stubGlobal("fetch", fetch);
    render(wrap(<AgentLessons agentId="ag_1" name="Tina" />));
    expect(await screen.findByText("Write the brand and model in Catatan.")).toBeInTheDocument();
    expect(fetch.mock.calls.some(([p]) => String(p).includes("agent_id=ag_1"))).toBe(true);
  });
});

describe("Noted for next time", () => {
  it("shows the lesson and Undo takes it back on the server", async () => {
    const fetch = server({ items: [lesson()], topics: [], agents: [], can_edit: false });
    vi.stubGlobal("fetch", fetch);
    render(wrap(<LessonNote lesson={{ lesson_id: "fa_1", text: "Write the brand and model in Catatan." }} />));
    expect(screen.getByText("Noted for next time:")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(screen.getByText("Taken back:")).toBeInTheDocument());
    expect(fetch.mock.calls.some(([p, i]) => String(p) === "/api/lessons/fa_1/undo" && (i as RequestInit | undefined)?.method === "POST")).toBe(true);
  });
});
