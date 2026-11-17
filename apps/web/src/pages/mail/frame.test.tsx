/** P109b the Microsoft 365 workspace full screen: its own Back (and Esc), its own tabs on top
 * (wide) and at the bottom (phone), arrow keys between tabs, and the counts on them. */
import { EnvelopeSimpleIcon, MicrosoftTeamsLogoIcon, SealCheckIcon } from "@phosphor-icons/react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { M365Frame, type FrameTab } from "./frame";

type App = "mail" | "teams" | "approvals";
const TABS: FrameTab<App>[] = [
  { value: "mail", label: "Outlook", icon: EnvelopeSimpleIcon, count: 7 },
  { value: "teams", label: "Teams", icon: MicrosoftTeamsLogoIcon, count: 0 },
  { value: "approvals", label: "Approvals", icon: SealCheckIcon, count: null },
];

function Harness({ onBack }: { onBack: () => void }) {
  const [app, setApp] = useState<App>("mail");
  return (
    <M365Frame title="Microsoft 365" tabs={TABS} value={app} onChange={setApp} onBack={onBack} actions={<button type="button">New Teams meeting</button>}>
      <p>Showing {app}</p>
    </M365Frame>
  );
}

afterEach(() => cleanup());

describe("the full-screen Microsoft 365 workspace", () => {
  it("has its own Back, title and actions, without the office's menu", () => {
    const onBack = vi.fn();
    const { container } = render(<Harness onBack={onBack} />);
    expect(container.querySelector("[data-m365-frame]")?.className).toContain("fixed inset-0");
    expect(screen.getByRole("heading", { name: "Microsoft 365" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Teams meeting" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("does not go back on Esc while a dialog is open or someone is typing", () => {
    const onBack = vi.fn();
    render(<><Harness onBack={onBack} /><div role="dialog">open</div></>);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("shows the tabs on top and at the bottom (phone), with counts, and moves with the arrow keys", () => {
    render(<Harness onBack={() => {}} />);
    const lists = screen.getAllByRole("tablist", { name: "Microsoft 365" });
    expect(lists).toHaveLength(2);
    const [top, bottom] = lists as [HTMLElement, HTMLElement];
    expect(bottom.closest("nav")?.className).toContain("md:hidden");
    expect(within(top).getByRole("tab", { name: "Outlook, 7 new" })).toHaveAttribute("aria-selected", "true");
    expect(within(top).getByRole("tab", { name: "Teams" })).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(within(top).getByRole("tab", { name: "Outlook, 7 new" }), { key: "ArrowRight" });
    expect(screen.getByText("Showing teams")).toBeInTheDocument();
    expect(within(top).getByRole("tab", { name: "Teams" })).toHaveFocus();
    fireEvent.keyDown(within(top).getByRole("tab", { name: "Teams" }), { key: "End" });
    expect(screen.getByText("Showing approvals")).toBeInTheDocument();
    fireEvent.click(within(bottom).getByRole("tab", { name: "Outlook, 7 new" }));
    expect(screen.getByText("Showing mail")).toBeInTheDocument();
  });
});
