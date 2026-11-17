/** P111: a new Teams conversation's people: search the office (with company and department)
 * and Outlook, or type a new email; several as chips, keyboard friendly. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Invitee } from "@/lib/m365";

import { addressesIn, RecipientPicker } from "./recipients";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let asked: string[] = [];

beforeEach(() => {
  asked = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://office.test");
    if (url.pathname === "/api/m365/people") {
      const q = url.searchParams.get("q") ?? "";
      asked.push(q);
      return json(q.startsWith("fa") ? [
        { name: "Faiz Rahman", email: "faiz@maju.example.com", source: "office", company: "MAJU SDN BHD", department: "Operations" },
        { name: "Fazira Ali", email: "fazira@client.example.com", source: "outlook" },
      ] : []);
    }
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Picker() {
  const [v, setV] = useState<Invitee[]>([]);
  return (
    <>
      <RecipientPicker label="To" value={v} onChange={setV} />
      <output data-testid="v">{v.map((p) => p.email).join(",")}</output>
    </>
  );
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><Picker /></QueryClientProvider>);
  return screen.getByRole("combobox", { name: "To" });
}
const out = () => screen.getByTestId("v").textContent;

describe("addressesIn", () => {
  it("finds every address in pasted text, once, lower case", () => {
    expect(addressesIn("Ali <Ali@X.my>; siti@x.my, ali@x.my nope")).toEqual(["ali@x.my", "siti@x.my"]);
  });
});

describe("RecipientPicker", { timeout: 20_000 }, () => {
  it("searches by name and shows company and department; arrows and Enter add", async () => {
    const box = setup();
    fireEvent.change(box, { target: { value: "fa" } });
    await waitFor(() => expect(screen.getByText("Faiz Rahman")).toBeInTheDocument());
    expect(screen.getByText("MAJU SDN BHD · Operations")).toBeInTheDocument();
    expect(asked).toContain("fa");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(out()).toBe("fazira@client.example.com");
    expect(box).toHaveValue("");
  });

  it("adds a new email (Enter or a comma), takes the last chip off with Backspace", async () => {
    const box = setup();
    fireEvent.change(box, { target: { value: "new.person@vendor.example.com" } });
    await waitFor(() => expect(screen.getByText("Add new.person@vendor.example.com")).toBeInTheDocument());
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.change(box, { target: { value: "Second@Vendor.example.com" } });
    fireEvent.keyDown(box, { key: "," });
    expect(out()).toBe("new.person@vendor.example.com,second@vendor.example.com");
    fireEvent.keyDown(box, { key: "Backspace" });
    expect(out()).toBe("new.person@vendor.example.com");
    fireEvent.click(screen.getByRole("button", { name: "Remove new.person@vendor.example.com" }));
    expect(out()).toBe("");
  });

  it("adds every address in a pasted list, never twice", () => {
    const box = setup();
    act(() => {
      fireEvent.paste(box, { clipboardData: { getData: () => "a@x.my; b@x.my, a@x.my" } });
    });
    expect(out()).toBe("a@x.my,b@x.my");
  });

  it("is not fooled by text that is not an email", async () => {
    const box = setup();
    fireEvent.change(box, { target: { value: "zz" } });
    await waitFor(() => expect(screen.getByText("No one found. Type their full email.")).toBeInTheDocument());
    fireEvent.keyDown(box, { key: "Enter" });
    expect(out()).toBe("");
  });
});
