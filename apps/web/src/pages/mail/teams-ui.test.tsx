import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { allEmails, backupPercent, byDay, mailDocument, prefixed, splitAddresses, type BackupJob, type TeamsMsg } from "@/lib/m365";

import { Conversation } from "./teams-ui";

const msg = (over: Partial<TeamsMsg>): TeamsMsg => ({
  id: "1", at: "2026-11-16T03:00:00Z", kind: "message", from: "Siti Aminah", from_id: "u-siti", mine: false,
  html: "<p>Hello</p>", text: "Hello", subject: null, deleted: false, edited: false, importance: null,
  reactions: [], files: [], quotes: [], mentions: [], mentions_me: false, url: null, ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("Teams-style conversation", () => {
  it("puts my messages on the right, shows names once per run, system lines and mentions", () => {
    const { container } = render(
      <Conversation messages={[
        msg({ id: "0", kind: "system", from_id: "", text: "Boss One added Siti Aminah", html: "" }),
        msg({ id: "1", html: '<p><span data-mention="1">Boss</span> can you check?</p>', mentions_me: true }),
        msg({ id: "2", at: "2026-11-16T03:01:00Z", html: "<p>Today please</p>" }),
        msg({ id: "3", at: "2026-11-16T03:02:00Z", mine: true, from: "Boss One", from_id: "me", html: "<p>On it</p>",
              reactions: [{ emoji: "👍", count: 2, mine: false }] }),
        msg({ id: "4", at: "2026-11-16T03:03:00Z", deleted: true, html: "" }),
      ]} />,
    );
    expect(screen.getByText("Boss One added Siti Aminah")).toBeTruthy();
    // Once for her first two messages (one run), again after my reply.
    expect(screen.getAllByText("Siti Aminah", { selector: "b" })).toHaveLength(2);
    const mine = screen.getByText("On it").closest("li")!;
    expect(mine.className).toContain("justify-end");
    expect(container.querySelector("[data-mention]")?.textContent).toBe("Boss");
    expect(screen.getByText("This message was deleted.")).toBeTruthy();
    expect(screen.getByLabelText("Reactions").textContent).toContain("2");
  });
});

describe("m365 helpers", () => {
  it("groups messages by day and starts a new run on a new sender", () => {
    const g = byDay([msg({ id: "a" }), msg({ id: "b", at: "2026-11-16T03:01:00Z" }), msg({ id: "c", from_id: "me", at: "2026-11-16T03:02:00Z" }),
      msg({ id: "d", at: "2026-11-18T03:00:00Z" })]);
    expect(g).toHaveLength(2);
    expect(g[0]!.items.map((i) => i.first)).toEqual([true, false, true]);
  });

  it("reads addresses and subjects", () => {
    expect(splitAddresses("a@x.com, b@y.com; <c@z.com>")).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
    expect(allEmails(["a@x.com", "nope"])).toBe(false);
    expect(prefixed("RE:", "RE: Tender")).toBe("RE: Tender");
    expect(prefixed("FW:", "Tender")).toBe("FW: Tender");
  });

  it("frames an email without scripts and without outside pictures until asked", () => {
    const doc = mailDocument("<p>Hi</p>", "", { images: false, dark: false });
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("img-src data: ;");
    expect(mailDocument("", "a < b", { images: true, dark: true })).toContain("a &lt; b");
    expect(mailDocument("<p>x</p>", "", { images: true, dark: false })).toContain("img-src data: https: http:");
  });

  it("shows backup progress", () => {
    const job = { status: "running", messages_seen: 25, messages_total: 100 } as BackupJob;
    expect(backupPercent(job)).toBe(25);
    expect(backupPercent({ ...job, messages_total: 0 })).toBeNull();
    expect(backupPercent({ ...job, status: "done" })).toBe(100);
  });
});
