/** P96: the shared kit on a phone: buttons never run off the screen and have a finger-sized
 * touch area; sheets and dialogs have a close button and close on the phone's Back. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetBackCloseForTests } from "@/lib/back-close";

import { Button, buttonLabel } from "./button";
import { ResponsiveDialog } from "./dialog";
import { SideSheet } from "./side-sheet";

function phone(on: boolean) {
  // A phone: narrow and a touch screen.
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: on && (q.includes("max-width: 767px") || q.includes("pointer: coarse")),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

afterEach(cleanup);

const tick = () => act(() => new Promise((r) => setTimeout(r, 40)));

describe("Button on a phone", () => {
  it("puts its text in one span that can shrink to an ellipsis, icons stay whole", () => {
    render(
      <Button>
        <svg data-testid="icon" /> Always allow for {"Pembantu Perolehan Kerajaan dan Tender Elektronik"}
      </Button>,
    );
    const btn = screen.getByRole("button", { name: /Always allow for Pembantu/ });
    expect(btn.className).toContain("max-w-full");
    expect(btn.className).toContain("hit");
    const label = btn.querySelector("span.text-ellipsis");
    expect(label?.textContent).toBe("Always allow for Pembantu Perolehan Kerajaan dan Tender Elektronik");
    expect(label?.className).toContain("min-w-0");
    expect(screen.getByTestId("icon").parentElement).toBe(btn);
  });

  it("leaves children with no text alone", () => {
    const icon = <svg data-testid="only" />;
    expect(buttonLabel(icon)).toBe(icon);
    render(<Button aria-label="Close">{icon}</Button>);
    expect(screen.getByRole("button", { name: "Close" }).querySelector("span")).toBeNull();
  });

  it("keeps numbers and words in one run", () => {
    render(<Button>Approve {3} now</Button>);
    expect(screen.getByRole("button").querySelectorAll("span.text-ellipsis")).toHaveLength(1);
    expect(screen.getByRole("button").textContent).toBe("Approve 3 now");
  });

  it("a button made to wrap keeps wrapping (the label inherits white-space)", () => {
    render(<Button className="h-auto whitespace-normal">A long choice that should wrap onto two lines</Button>);
    const label = screen.getByRole("button").querySelector("span");
    expect(label?.className).not.toMatch(/whitespace-nowrap|truncate/);
    expect(screen.getByRole("button").className).toContain("whitespace-normal");
  });
});

describe("sheets and dialogs on a phone", () => {
  beforeEach(() => {
    phone(true);
    resetBackCloseForTests();
    window.history.replaceState({ __TSR_index: 0 }, "");
    fireEvent.pointerDown(document.body); // the tap that opens the sheet
  });
  afterEach(() => {
    phone(false);
    resetBackCloseForTests();
  });

  it("a dialog sheet has a finger-sized close button", () => {
    const onOpenChange = vi.fn();
    render(
      <ResponsiveDialog open onOpenChange={onOpenChange} title="Add a member">
        <p>Body</p>
      </ResponsiveDialog>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain("size-11");
    fireEvent.click(close);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("the phone's Back closes an open dialog", async () => {
    const onOpenChange = vi.fn();
    render(
      <ResponsiveDialog open onOpenChange={onOpenChange} title="Add a member">
        <p>Body</p>
      </ResponsiveDialog>,
    );
    expect((window.history.state as { __sheets?: string[] }).__sheets).toHaveLength(1);
    act(() => window.history.back());
    await tick();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closing a side sheet with its X takes the Back entry off again", async () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <SideSheet open={open} onOpenChange={setOpen} title="Task detail">
          <p>Detail</p>
        </SideSheet>
      );
    }
    render(<Host />);
    expect((window.history.state as { __sheets?: string[] }).__sheets).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await tick();
    expect((window.history.state as { __sheets?: string[] } | null)?.__sheets ?? []).toEqual([]);
  });

  it("a sheet the address opened (?task=...) is left to the router's Back", () => {
    window.history.pushState({ __TSR_index: 1 }, "", "?task=t1"); // the tap changed the address
    render(
      <SideSheet open onOpenChange={() => {}} title="Task detail">
        <p>Detail</p>
      </SideSheet>,
    );
    expect((window.history.state as { __sheets?: string[] } | null)?.__sheets ?? []).toEqual([]);
  });

  it("with a mouse, Back is left to the page (no extra history entry)", () => {
    phone(false);
    render(
      <ResponsiveDialog open onOpenChange={() => {}} title="Add a member">
        <p>Body</p>
      </ResponsiveDialog>,
    );
    expect((window.history.state as { __sheets?: string[] } | null)?.__sheets ?? []).toEqual([]);
  });
});
