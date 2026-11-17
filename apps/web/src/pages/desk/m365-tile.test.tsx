/** P109b the Microsoft 365 tile on My workspace: what waits (unread mail, the next meeting with
 * Join, unread chats, approvals only when turned on), opening the full-screen workspace with a
 * way back here, and "Connect Microsoft" before the person has connected. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { M365Summary } from "@/lib/m365";

import { M365Tile } from "./m365-tile";

const BASE: M365Summary = {
  configured: true, connected: true, status: "connected", address: "boss@maju.example.com",
  unread_mail: 7, unread_chats: 2, approvals_pending: null, prima: true,
  next_meeting: {
    id: "e1", subject: "Roster check", start: "2030-01-07T02:00:00Z", end: "2030-01-07T03:00:00Z", all_day: false, cancelled: false,
    location: "", organizer: { name: "Siti", address: "siti@x.my" }, attendees: [], show_as: "busy",
    join_url: "https://teams.microsoft.com/l/meetup-join/abc", web_link: null, preview: "",
  },
};

function show(s: M365Summary) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["mail", "m365", "summary"], s);
  const root = createRootRoute({ component: M365Tile });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/workspace"] }) });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => cleanup());

describe("the Microsoft 365 tile", () => {
  it("shows what waits and opens the full-screen workspace with a way back", async () => {
    show(BASE);
    const mail = await screen.findByRole("link", { name: /Unread mail/ });
    expect(mail).toHaveTextContent("7");
    expect(mail.getAttribute("href")).toBe("/m365?from=%2Fworkspace");
    expect(screen.getByRole("link", { name: /Unread chats/ }).getAttribute("href")).toContain("app=teams");
    expect(screen.queryByText("Approvals waiting")).not.toBeInTheDocument(); // not turned on
    expect(screen.getByText("Roster check")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Join/ })).toHaveAttribute("href", BASE.next_meeting!.join_url);
    expect(screen.getByRole("link", { name: /New Teams meeting/ }).getAttribute("href")).toContain("new=meeting");
    expect(screen.getByRole("link", { name: /Open full screen/ })).toBeInTheDocument();
  });

  it("offers Connect Microsoft before the person connected", async () => {
    show({ ...BASE, connected: false, status: "none", unread_mail: null, unread_chats: null, next_meeting: null });
    expect(await screen.findByRole("button", { name: "Connect Microsoft" })).toBeInTheDocument();
    expect(screen.queryByText("Unread mail")).not.toBeInTheDocument();
  });

  it("shows approvals waiting once they are turned on", async () => {
    show({ ...BASE, approvals_pending: 3 });
    expect(await screen.findByRole("link", { name: /Approvals waiting/ })).toHaveTextContent("3");
  });
});
