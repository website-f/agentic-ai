/** P94: My computers offers a newer Agentic Office PC; nothing updates by itself. */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Device } from "@/lib/devices";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const { UpdateNotice } = await import("./device-card");

const pc: Device = {
  id: "dv_1", name: "Work laptop", os: "windows", version: "0.5.1", online: true, last_seen_at: null, paused: false,
  folders: [], browsers: [], latest_version: "0.5.2", update_available: true,
};

afterEach(() => cleanup());

describe("Update available", () => {
  it("Windows: one click downloads the new program", () => {
    render(<UpdateNotice device={pc} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Update available");
    expect(screen.getByText(/Agentic Office PC 0.5.2 is ready \(this computer has 0.5.1\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download the update/ })).toHaveAttribute("href", "/api/install/update/exe");
  });

  it("Mac and Linux: the install line again, no download button", () => {
    render(<UpdateNotice device={{ ...pc, os: "mac" }} />);
    expect(screen.getByText(/run the install line again/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
