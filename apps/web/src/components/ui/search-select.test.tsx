/** P98: the searchable selects: type to filter, keyboard, chips, pick all shown, the action row,
 * and the bottom sheet on a phone. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { filterOptions, MultiSelect, SearchSelect, type PickOption } from "./search-select";

const BRANCHES: PickOption[] = [
  { value: "br_a", label: "Alpha Sdn Bhd", hint: "Kuala Lumpur" },
  { value: "br_b", label: "Beta Bhd", hint: "Johor" },
  { value: "br_c", label: "Cahaya Bhd", hint: "Pulau Pinang", keywords: ["penang"] },
  { value: "br_d", label: "Délima Bhd", hint: "Sabah" },
];

let phone = false;
beforeEach(() => {
  phone = false;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: phone && q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function One({ onAdd }: { onAdd?: (typed: string) => void }) {
  const [v, setV] = useState("");
  return (
    <>
      <SearchSelect label="Department" value={v} onValueChange={setV} options={BRANCHES} placeholder="Pick a department"
        action={onAdd ? { label: "+ New department", onSelect: onAdd } : undefined} />
      <output data-testid="one">{v}</output>
    </>
  );
}

function Many({ start = [] as string[], locked }: { start?: string[]; locked?: Record<string, string> }) {
  const [v, setV] = useState<string[]>(start);
  return (
    <>
      <MultiSelect label="Branches" value={v} onValueChange={setV} options={BRANCHES} locked={locked} />
      <output data-testid="many">{v.join(",")}</output>
    </>
  );
}

describe("filterOptions", () => {
  it("matches every word in the label, hint or keywords, ignoring case and accents", () => {
    expect(filterOptions(BRANCHES, "bhd jo").map((o) => o.value)).toEqual(["br_b"]);
    expect(filterOptions(BRANCHES, "PENANG").map((o) => o.value)).toEqual(["br_c"]);
    expect(filterOptions(BRANCHES, "delima").map((o) => o.value)).toEqual(["br_d"]);
    expect(filterOptions(BRANCHES, "  ")).toHaveLength(4);
  });
});

describe("SearchSelect", { timeout: 20_000 }, () => {
  it("opens, filters as you type and picks with the keyboard", async () => {
    render(<One />);
    const button = screen.getByRole("button", { name: "Department" });
    expect(button).toHaveTextContent("Pick a department");
    expect(button).toHaveAttribute("aria-haspopup", "listbox");
    fireEvent.click(button);
    const search = await screen.findByRole("combobox");
    fireEvent.change(search, { target: { value: "cahaya" } });
    expect(screen.queryByRole("option", { name: /Alpha/ })).toBeNull();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByTestId("one")).toHaveTextContent("br_c");
    expect(screen.queryByRole("combobox")).toBeNull(); // closed after picking
    expect(screen.getByRole("button", { name: "Department" })).toHaveTextContent("Cahaya Bhd");
  });

  it("says when nothing matches and keeps the action row, which gets what was typed", async () => {
    const onAdd = vi.fn();
    render(<One onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "Department" }));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "Procurement" } });
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /New department/ }));
    expect(onAdd).toHaveBeenCalledWith("Procurement");
  });

  it("opens on a typed letter, starting the search with it", async () => {
    render(<One />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Department" }), { key: "b" });
    const search = await screen.findByRole("combobox");
    expect(search).toHaveValue("b");
  });
});

describe("MultiSelect", { timeout: 20_000 }, () => {
  it("ticks many, shows chips, removes one by its chip and clears", async () => {
    render(<Many />);
    const group = screen.getByRole("group", { name: "Branches" });
    fireEvent.click(within(group).getByRole("button", { name: "Branches" }));
    fireEvent.click(await screen.findByRole("option", { name: /Alpha/ }));
    fireEvent.click(screen.getByRole("option", { name: /Beta/ }));
    expect(screen.getByRole("option", { name: /Beta/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("2 picked")).toBeInTheDocument();
    expect(screen.getByTestId("many")).toHaveTextContent("br_a,br_b");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove Alpha Sdn Bhd" }));
    expect(screen.getByTestId("many")).toHaveTextContent(/^br_b$/);
  });

  it("picks all the shown ones after a search, and unpicks them again", async () => {
    render(<Many start={["br_a"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Branches: 1 picked. Change" }));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "bhd" } });
    fireEvent.click(screen.getByRole("button", { name: "Pick these 4" }));
    expect(screen.getByTestId("many")).toHaveTextContent("br_a,br_b,br_c,br_d");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "johor" } });
    fireEvent.click(screen.getByRole("button", { name: "Unpick these" }));
    expect(screen.getByTestId("many")).toHaveTextContent(/^br_a,br_c,br_d$/);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("many").textContent).toBe("");
  });

  it("keeps a locked value (no remove button, Clear leaves it)", async () => {
    render(<Many start={["br_a", "br_b"]} locked={{ br_a: "Their department's company" }} />);
    expect(screen.queryByRole("button", { name: "Remove Alpha Sdn Bhd" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Branches: 2 picked. Change" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("many")).toHaveTextContent(/^br_a$/);
  });

  it("opens as a bottom sheet on a phone", async () => {
    phone = true;
    render(<Many />);
    fireEvent.click(screen.getByRole("button", { name: "Branches" }));
    const sheet = await screen.findByTestId("pick-sheet");
    expect(within(sheet).getByRole("heading", { name: "Branches" })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("option", { name: /Cahaya/ }));
    expect(screen.getByTestId("many")).toHaveTextContent("br_c");
  });
});
