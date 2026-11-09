/** P92: staff pages on a phone: report tables as cards, and Prima's Microsoft step with the
 * screen (#clock) carried through. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { primaScreen } from "@/lib/prima-screen";
import { ConnectMicrosoft } from "@/pages/prima";
import { DataTable } from "@/pages/reports";

const TABLE = {
  title: "Claims",
  columns: ["Date", "Claimant", "What it was for", "Amount (RM)"],
  rows: [
    ["2026-10-01", "Guard One", "Transport to the site for the night shift", 12.5],
    ["2026-10-02", "Guard Two", "Meal allowance", 8],
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("report tables on a phone", () => {
  it("shows each row as a card of label and value, and keeps the table for wider screens", () => {
    const { container } = render(<DataTable reportId="rp_1" table={TABLE} n={0} />);
    const cards = screen.getByTestId("report-cards");
    expect(cards.className).toContain("md:hidden");
    const items = within(cards).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Claimant")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Guard One")).toBeInTheDocument();
    expect(within(items[0]!).getByText("12.5")).toBeInTheDocument();
    const table = container.querySelector("table");
    expect(table?.parentElement?.className).toContain("max-md:hidden");
  });
});

describe("Prima's screen in the address", () => {
  it("passes plain screen names on and nothing else", () => {
    expect(primaScreen("#clock")).toBe("#clock");
    expect(primaScreen("#@hr")).toBe("#@hr");
    expect(primaScreen("")).toBe("");
    expect(primaScreen("#clock?x=1")).toBe("");
    expect(primaScreen("#javascript:alert(1)")).toBe("");
    expect(primaScreen("#" + "a".repeat(60))).toBe("");
  });
});

describe("Connect Microsoft on a phone", () => {
  it("says what to do in three steps, with a full-width button, and comes back to the clock", async () => {
    window.location.hash = "#clock";
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify({ url: "#signed-in" }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ConnectMicrosoft email="staff@example.com" />
      </QueryClientProvider>,
    );
    const card = screen.getByTestId("prima-connect");
    expect(within(card).getAllByRole("listitem")).toHaveLength(3);
    const button = within(card).getByRole("button", { name: /Connect Microsoft/ });
    expect(button.className).toContain("w-full");
    fireEvent.click(button);
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/auth/microsoft/start"))).toBe(true));
    const start = calls.find((c) => c.url.includes("/api/auth/microsoft/start"));
    expect(start?.body).toMatchObject({ email: "staff@example.com", next: "/prima#clock" });
  });
});
