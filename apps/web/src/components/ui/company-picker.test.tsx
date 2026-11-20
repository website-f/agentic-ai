/** P111: one company picker everywhere: search, several at once (chips), a list filter that
 * reads "All companies" / the one picked / "N picked", and one company with search; plus the
 * table filter that holds several values. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompanyPicker, companyOptions } from "./company-picker";
import { filterValues, TableFilter, type TableControl, type TableState, TABLE_DEFAULTS } from "./data-table";

const COMPANIES = [
  { id: "br_a", name: "ALPHA SDN BHD", slug: "alpha" },
  { id: "br_b", name: "BETA BHD", slug: "beta" },
  { id: "br_c", name: "CAHAYA BHD", slug: "penang-cahaya" },
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

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function Many() {
  const [v, setV] = useState<string[]>([]);
  return (
    <>
      <CompanyPicker multiple label="Companies" companies={COMPANIES} value={v} onValueChange={setV} />
      <output data-testid="v">{v.join(",")}</output>
    </>
  );
}

function AsFilter() {
  const [v, setV] = useState<string[]>([]);
  return (
    <>
      <CompanyPicker multiple filter label="Company" companies={COMPANIES} value={v} onValueChange={setV} allLabel="All companies" />
      <output data-testid="v">{v.join(",")}</output>
    </>
  );
}

function One() {
  const [v, setV] = useState("any");
  return (
    <>
      <CompanyPicker label="Company" companies={COMPANIES} before={[{ value: "any", label: "Any company" }]} value={v} onValueChange={setV} />
      <output data-testid="v">{v}</output>
    </>
  );
}

const out = () => screen.getByTestId("v").textContent;

describe("companyOptions", () => {
  it("lists each company by name and finds it by its short name", () => {
    expect(companyOptions(COMPANIES)[2]).toEqual({ value: "br_c", label: "CAHAYA BHD", keywords: ["penang-cahaya"] });
  });
});

describe("CompanyPicker", { timeout: 20_000 }, () => {
  it("several: searches, ticks with Enter, shows chips, removes one, picks all and clears", () => {
    wrap(<Many />);
    fireEvent.click(screen.getByRole("button", { name: "Companies" }));
    const search = screen.getByPlaceholderText("Search companies");
    fireEvent.change(search, { target: { value: "penang" } }); // the slug finds it
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["CAHAYA BHD"]);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(out()).toBe("br_c");
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all (3)" }));
    expect(out()).toBe("br_c,br_a,br_b");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const group = screen.getByRole("group", { name: "Companies" });
    expect(within(group).getByText("ALPHA SDN BHD")).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: "Remove BETA BHD" }));
    expect(out()).toBe("br_c,br_a");
    fireEvent.click(within(group).getByRole("button", { name: /Companies: 2 picked/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(out()).toBe("");
  });

  it("as a filter: reads All companies, the one picked, then a count", () => {
    wrap(<AsFilter />);
    const button = () => screen.getByRole("button", { name: /^Company: / });
    expect(button()).toHaveTextContent("All companies");
    fireEvent.click(button());
    fireEvent.click(screen.getByRole("option", { name: /BETA BHD/ }));
    expect(out()).toBe("br_b");
    fireEvent.click(screen.getByRole("option", { name: /ALPHA SDN BHD/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(button()).toHaveTextContent("2 picked");
    fireEvent.click(button());
    fireEvent.click(screen.getByRole("option", { name: /BETA BHD/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(button()).toHaveTextContent("ALPHA SDN BHD");
  });

  it("one company: a typed letter opens the search, Enter picks and closes", () => {
    wrap(<One />);
    const trigger = screen.getByRole("button", { name: "Company" });
    expect(trigger).toHaveTextContent("Any company");
    fireEvent.keyDown(trigger, { key: "b" });
    const search = screen.getByPlaceholderText("Search companies");
    expect(search).toHaveValue("b");
    fireEvent.change(search, { target: { value: "beta" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(out()).toBe("br_b");
    expect(screen.queryByPlaceholderText("Search companies")).toBeNull();
  });

  it("opens as a bottom sheet on a phone", () => {
    phone = true;
    wrap(<Many />);
    fireEvent.click(screen.getByRole("button", { name: "Companies" }));
    expect(screen.getByTestId("pick-sheet")).toBeInTheDocument();
  });

  it("says so when no company matches", () => {
    wrap(<One />);
    fireEvent.click(screen.getByRole("button", { name: "Company" }));
    fireEvent.change(screen.getByPlaceholderText("Search companies"), { target: { value: "zeta" } });
    expect(screen.getByText("No company matches.")).toBeInTheDocument();
  });
});

describe("TableFilter multiple", { timeout: 20_000 }, () => {
  function Table() {
    const [state, setState] = useState<TableState>(TABLE_DEFAULTS);
    const control: TableControl = { state, set: (c) => setState((s) => ({ ...s, ...c, f: { ...s.f, ...(c.f ?? {}) } })) };
    const [picked] = filterValues(control, "company");
    return (
      <>
        <TableFilter control={control} id="company" label="Company" allLabel="All companies" multiple
          options={COMPANIES.map((b) => ({ value: b.id, label: b.name }))} />
        <output data-testid="v">{state.f.company ?? ""}|{picked.length}</output>
      </>
    );
  }

  it("keeps several companies as one value and reads them back", () => {
    wrap(<Table />);
    fireEvent.click(screen.getByRole("button", { name: /^Company: All companies/ }));
    fireEvent.click(screen.getByRole("option", { name: /ALPHA SDN BHD/ }));
    fireEvent.click(screen.getByRole("option", { name: /CAHAYA BHD/ }));
    expect(out()).toBe("br_a,br_c|2");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(out()).toBe("|0");
  });
});
