/** P144: Library access given on a member's page (units, companies), and the units in the
 * company search of the Library. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "@/i18n";
import { pickedUnit, unitOptions, type LibraryUnit } from "@/lib/library-units";
import type { Member } from "@/lib/types";

import { LibraryAccessFields, libraryChanges, libraryOf, librarySummary, type LibraryValue } from "./members-access";

const m = (extra: Partial<Member> = {}): Member => ({
  user_id: "u_az", email: "azizan@example.com", name: "Azizan", role: "staff", is_active: true, must_change_password: false, last_login_at: null,
  joined_at: "2026-11-01T00:00:00Z", ...extra,
});
const UNITS = [
  { key: "hr" as const, label: "Unit HR" },
  { key: "audit" as const, label: "Unit Audit" },
  { key: "finance" as const, label: "Unit Kewangan" },
];
const COMPANIES = [{ id: "br_gw", name: "GOODWILL EMPIRE SDN BHD" }, { id: "br_maju", name: "MAJU SDN BHD" }];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("what is given", () => {
  it("sends the grant whole, and null when nothing is left", () => {
    const before = libraryOf(m());
    expect(libraryChanges(before, before)).toBeNull();
    const all: LibraryValue = { ...before, grants: { units: "all", companies: [], departments: [] } };
    expect(libraryChanges(before, all)).toEqual({ grants: { units: "all", companies: [], departments: [] } });
    const had = libraryOf(m({ library_grants: { units: ["hr"], companies: ["br_maju"], departments: [] } }));
    expect(libraryChanges(had, { ...had, grants: { units: [], companies: [], departments: [] } })).toEqual({ grants: null });
    // The same ids in another order: no change.
    const two = libraryOf(m({ library_grants: { units: ["hr", "finance"], companies: [], departments: [] } }));
    expect(libraryChanges(two, { ...two, grants: { units: ["finance", "hr"], companies: [], departments: [] } })).toBeNull();
  });

  it("says in one line what they read", () => {
    const v: LibraryValue = { scope: "company", forOthers: false, grants: { units: ["hr", "finance"], companies: "all", departments: [] } };
    expect(librarySummary(v, UNITS, COMPANIES, t)).toBe("They read: their whole company · Unit HR, Unit Kewangan · all companies.");
    expect(librarySummary({ scope: "department", forOthers: false }, UNITS, COMPANIES, t)).toBe("They read: their own department.");
  });

  it("ticks units one by one or all at once", () => {
    function F() {
      const [v, setV] = useState<LibraryValue>(libraryOf(m()));
      return <>
        <LibraryAccessFields value={v} onChange={setV} role="staff" give={{ units: UNITS, companies: COMPANIES, every: true }} />
        <output data-testid="v">{JSON.stringify(v.grants ?? null)}</output>
      </>;
    }
    render(<QueryClientProvider client={new QueryClient()}><F /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("checkbox", { name: "Unit HR" }));
    expect(JSON.parse(screen.getByTestId("v").textContent!).units).toEqual(["hr"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Unit Audit" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Unit Kewangan" }));
    expect(JSON.parse(screen.getByTestId("v").textContent!).units).toBe("all");
    expect(screen.getByRole("checkbox", { name: "All units" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "All companies" }));
    expect(JSON.parse(screen.getByTestId("v").textContent!).companies).toBe("all");
    expect(screen.getByText(/They read: their whole company · all units · all companies/)).toBeInTheDocument();
  });
});

describe("units in the company search", () => {
  it("lists each unit with its company and reads the pick back", () => {
    const units: LibraryUnit[] = [{
      key: "finance", label: "Unit Kewangan", department_id: "dp_f", department_name: "Finance", branch_id: "br_pw",
      branch_name: "PW VENTURE SDN BHD (PWVSB)", files: 3, can_upload: true,
    }];
    const [o] = unitOptions(units, t);
    expect(o).toMatchObject({ value: "unit:finance", label: "Unit Kewangan · PW VENTURE SDN BHD (PWVSB)", group: "Units" });
    expect(o!.keywords).toContain("Finance");
    expect(pickedUnit(o!.value)).toBe("finance");
    expect(pickedUnit("br_maju")).toBeNull();
  });
});
