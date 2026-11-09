/** P92: the card shown before ePerolehan work starts, and the 3-step link wizard. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pcReady, pcSiteOf, pcTone, type MyPcStatus } from "@/lib/my-pc";

const devices = vi.hoisted(() => ({ os: "windows" as string, status: "pending" as string, expires: 600 }));
const asked = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/lib/devices", async (orig) => {
  const real = await orig<typeof import("@/lib/devices")>();
  return {
    ...real,
    detectOs: () => devices.os,
    createLinkCode: vi.fn(async () => ({
      code: "ABCD2345",
      expires_at: new Date(Date.now() + devices.expires * 1000).toISOString(),
      install: { windows: "irm x | iex", mac: "curl x | sh" },
      downloads: null,
      exe: { off: "/api/install/ABCD2345/exe", control: "/api/install/ABCD2345/exe/control" },
    })),
    linkStatus: vi.fn(async () => ({ status: devices.status, device_id: devices.status === "claimed" ? "dv_1" : null, device_name: "Aina Laptop" })),
    listDevices: vi.fn(async () => []),
  };
});

vi.mock("@/lib/my-pc", async (orig) => {
  const real = await orig<typeof import("@/lib/my-pc")>();
  return {
    ...real,
    askMyPc: vi.fn(async (site: string) => {
      asked.calls.push(site);
      return { asked: true, online: true, device: { id: "dv_1", name: "Aina Laptop" } };
    }),
  };
});

// Imported after the mocks.
const { PcCard } = await import("./my-pc-status");
const { LinkDialog } = await import("@/pages/computers/link-dialog");

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const base: MyPcStatus = {
  state: "ready", needed: true, site: "eperolehan.gov.my",
  device: { id: "dv_1", name: "Aina Laptop", last_seen_at: new Date().toISOString(), version: "0.5.1" }, next: "",
};

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  devices.os = "windows";
  devices.status = "pending";
  devices.expires = 600;
  asked.calls = [];
});
afterEach(() => cleanup());

describe("which work needs the person's own computer", () => {
  it("is ePerolehan, by its real address only", () => {
    expect(pcSiteOf("https://www.eperolehan.gov.my/tender")).toBe("eperolehan.gov.my");
    expect(pcSiteOf("eperolehan.gov.my")).toBe("eperolehan.gov.my");
    expect(pcSiteOf("https://eperolehan.gov.my.evil.example/")).toBeNull();
    expect(pcSiteOf("https://xeperolehan.gov.my/")).toBeNull();
    expect(pcSiteOf("https://example.com/")).toBeNull();
    expect(pcSiteOf("")).toBeNull();
  });
  it("may start only when ready, or when no computer is needed", () => {
    expect(pcReady({ ...base, state: "ready" })).toBe(true);
    expect(pcReady({ ...base, state: "offline" })).toBe(false);
    expect(pcReady({ ...base, state: "not_linked", needed: false })).toBe(true);
    expect(pcReady(undefined)).toBe(false);
    expect([pcTone("ready"), pcTone("offline"), pcTone("not_allowed"), pcTone("not_linked")]).toEqual(["ok", "warn", "warn", "bad"]);
  });
});

describe("the status card", () => {
  it("green: the computer by name, nothing to press", () => {
    wrap(<PcCard s={base} onCheck={() => {}} onLink={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Your computer Aina Laptop is ready");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("amber offline: turn it on, and Check again", () => {
    const onCheck = vi.fn();
    wrap(<PcCard s={{ ...base, state: "offline" }} onCheck={onCheck} onLink={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Turn on your computer and open Agentic Office PC");
    fireEvent.click(screen.getByRole("button", { name: /Check again/ }));
    expect(onCheck).toHaveBeenCalled();
  });

  it("amber not allowed: press Allow, and the request can be sent again", async () => {
    wrap(<PcCard s={{ ...base, state: "not_allowed" }} onCheck={() => {}} onLink={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Press Allow on your computer");
    expect(screen.getByText(/We sent the request to Aina Laptop/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Send the request again/ }));
    await waitFor(() => expect(asked.calls).toEqual(["eperolehan.gov.my"]));
  });

  it("amber older app and paused: what to do about each", () => {
    const onLink = vi.fn();
    const { unmount } = wrap(<PcCard s={{ ...base, state: "needs_update" }} onCheck={() => {}} onLink={onLink} />);
    fireEvent.click(screen.getByRole("button", { name: /Get the new app/ }));
    expect(onLink).toHaveBeenCalled();
    unmount();
    wrap(<PcCard s={{ ...base, state: "paused" }} onCheck={() => {}} onLink={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Your computer Aina Laptop is paused");
    expect(screen.getByRole("link", { name: /Open My computers/ })).toHaveAttribute("href", "/computers");
  });

  it("red not linked: one big button that opens the link wizard", () => {
    const onLink = vi.fn();
    wrap(<PcCard s={{ ...base, state: "not_linked", device: null }} onCheck={() => {}} onLink={onLink} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Link your computer first — about 2 minutes");
    expect(document.querySelector("[data-state=not_linked]")).toHaveClass("border-danger/40");
    fireEvent.click(screen.getByRole("button", { name: /Link my computer/ }));
    expect(onLink).toHaveBeenCalled();
  });
});

describe("the link wizard", () => {
  it("Download, Open the file, Waiting, then Linked: press Allow (asked for by itself)", async () => {
    wrap(<LinkDialog allowSite="eperolehan.gov.my" onClose={() => {}} onLinked={() => {}} />);
    const download = await screen.findByRole("link", { name: /Download for Windows/ });
    expect(download).toHaveAttribute("href", "/api/install/ABCD2345/exe");
    expect(screen.getByRole("switch", { name: /Let my ePerolehan work run on this computer/ })).toBeChecked();
    fireEvent.click(download);
    await screen.findByText("2. Open the file you downloaded", undefined, { timeout: 2000 });
    expect(screen.getByText("1. Click More info")).toBeInTheDocument();
    expect(screen.getByText("2. Click Run anyway")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I opened it" }));
    expect(screen.getByText("3. Waiting for your computer…")).toBeInTheDocument();
    devices.status = "claimed"; // the computer claims the code: seen on the next poll (3 s)
    await waitFor(() => expect(screen.getAllByText("Linked! Now press Allow on your computer").length).toBeGreaterThan(0), { timeout: 5000 });
    expect(asked.calls).toEqual(["eperolehan.gov.my"]);
  });

  it("on a phone: open the same page on the Windows computer, the address and the code big", async () => {
    devices.os = "other";
    wrap(<LinkDialog onClose={() => {}} onLinked={() => {}} />);
    expect(await screen.findByText(/You are on a phone/)).toBeInTheDocument();
    expect(screen.getByText(`${window.location.host}/computers`)).toBeInTheDocument();
    expect(await screen.findByText("ABCD-2345")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /I am on my computer now/ }));
    expect(await screen.findByText("1. Download the Agentic Office PC app")).toBeInTheDocument();
  });

  it("an expired code says so plainly and gets a new one", async () => {
    devices.expires = -5;
    wrap(<LinkDialog onClose={() => {}} onLinked={() => {}} />);
    expect(await screen.findByText("This code has expired.")).toBeInTheDocument();
    devices.expires = 600;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Get a new code/ }));
    });
    expect(await screen.findByRole("link", { name: /Download for Windows/ })).toBeInTheDocument();
  });
});
