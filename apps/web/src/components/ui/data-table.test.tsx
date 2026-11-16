/** P96: the shared data table: search, sort, pages, ticks, states, phone cards, the address. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  changeState,
  clientRows,
  csvCell,
  csvName,
  DataTable,
  eachRow,
  pageNumbers,
  pageRange,
  parseSort,
  readTableState,
  RowMenu,
  toCsv,
  TABLE_DEFAULTS,
  TableFilter,
  tableParams,
  useLocalTableState,
  useTableState,
  writeTableState,
  type Column,
  type TableState,
} from "./data-table";

const saved = vi.hoisted(() => [] as { blob: Blob; name: string }[]);
vi.mock("@/lib/native", () => ({ saveFile: async (blob: Blob, name: string) => void saved.push({ blob, name }) }));

/** A Blob's text (jsdom's Blob may not have .text()). */
function blobText(b: Blob): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(b);
  });
}

/** Opens a Radix menu in jsdom. */
function openMenu(name: string) {
  const trigger = screen.getByRole("button", { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return screen.getByRole("menu");
}

interface Person {
  id: string;
  name: string;
  used: number;
  team: string;
}

const PEOPLE: Person[] = Array.from({ length: 30 }, (_, i) => ({
  id: `u${i}`,
  name: `Person ${String(i).padStart(2, "0")}`,
  used: (i * 7) % 30,
  team: i % 2 ? "North" : "South",
}));

const COLUMNS: Column<Person>[] = [
  { id: "name", header: "Name", sortValue: (p) => p.name, card: "title", cell: (p) => p.name },
  { id: "used", header: "Used", sortValue: (p) => p.used, kind: "number", align: "right", cell: (p) => String(p.used) },
  { id: "team", header: "Team", sortValue: (p) => p.team, hideBelow: "lg", cell: (p) => p.team },
];

function phone(on: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} }));
}

function Local(props: Partial<Parameters<typeof DataTable<Person>>[0]> & { initial?: Partial<TableState> }) {
  const control = useLocalTableState({ size: 10, ...props.initial });
  return <DataTable<Person> label="People" columns={COLUMNS} rows={PEOPLE} rowId={(p) => p.id} rowLabel={(p) => p.name} control={control}
    searchText={(p) => `${p.name} ${p.team}`} {...props} />;
}

beforeEach(() => phone(false));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the state and its helpers", () => {
  it("reads and writes the address, leaving defaults out", () => {
    const d = { ...TABLE_DEFAULTS, size: 25 };
    const s = readTableState({ q: "ann", page: "3", size: 50, sort: "-used", role: "staff", other: 1 }, d, "", ["role"]);
    expect(s).toEqual({ q: "ann", page: 3, size: 50, sort: "used", dir: "desc", f: { role: "staff" } });
    expect(readTableState({ page: "x", size: -2 }, d)).toMatchObject({ page: 1, size: 25 });
    expect(readTableState({ q: "ann", page: 2 }, d)).toMatchObject({ q: "ann", page: 2, sort: "", dir: "asc" }); // no sort in the address
    const out = writeTableState({ other: 1, page: 4 }, { ...d, q: " bob ", sort: "name", dir: "asc", f: { role: "" } }, d);
    expect(out).toEqual({ other: 1, q: "bob", sort: "name" });
    expect(writeTableState({}, { ...d, page: 2, f: { role: "hr" } }, d, "r_")).toEqual({ r_page: 2, r_role: "hr" });
    expect(parseSort("-x", d)).toEqual({ sort: "x", dir: "desc" });
    expect(tableParams({ ...d, q: "a", page: 2, sort: "used", dir: "desc", f: { role: "hr", branch: "" } }))
      .toEqual({ q: "a", page: "2", size: "25", sort: "-used", role: "hr" });
  });

  it("goes back to page 1 on anything but a page change", () => {
    const s = { ...TABLE_DEFAULTS, page: 5 };
    expect(changeState(s, { q: "x" }).page).toBe(1);
    expect(changeState(s, { f: { role: "hr" } })).toMatchObject({ page: 1, f: { role: "hr" } });
    expect(changeState(s, { page: 6 }).page).toBe(6);
  });

  it("searches every word, sorts with blanks last, and pages", () => {
    const st = { ...TABLE_DEFAULTS, size: 10 };
    const text = (p: Person) => `${p.name} ${p.team}`;
    expect(clientRows(PEOPLE, COLUMNS, { ...st, q: "south 2" }, text).total).toBe(7); // 02 12 20 22 24 26 28
    expect(clientRows(PEOPLE, COLUMNS, { ...st, q: "north 03" }).rows.map((p) => p.id)).toEqual(["u3"]);
    const desc = clientRows(PEOPLE, COLUMNS, { ...st, sort: "used", dir: "desc" }).rows.map((p) => p.used);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    const withBlank = [...PEOPLE, { id: "z", name: "", used: 1, team: "" }];
    for (const dir of ["asc", "desc"] as const) {
      const all = clientRows(withBlank, COLUMNS, { ...st, size: 100, sort: "name", dir }).rows;
      expect(all[all.length - 1]!.id).toBe("z");
    }
    expect(clientRows(PEOPLE, COLUMNS, { ...st, page: 9 }).rows[0]!.id).toBe("u20"); // past the end: the last page
    expect(pageRange(2, 10, 25)).toEqual({ pages: 3, page: 2, from: 11, to: 20 });
    expect(pageRange(1, 10, 0)).toMatchObject({ from: 0, to: 0, pages: 1 });
  });
});

describe("the table on a desktop", () => {
  it("is a real table with a caption, sorts by its headings and says so", () => {
    render(<Local />);
    const table = screen.getByRole("table", { name: "People" });
    expect(within(table).getAllByRole("row")).toHaveLength(11); // heading + 10
    const used = screen.getByRole("columnheader", { name: /Used/ });
    expect(used).not.toHaveAttribute("aria-sort");
    fireEvent.click(within(used).getByRole("button"));
    expect(used).toHaveAttribute("aria-sort", "descending"); // numbers start largest first
    const first = within(table).getAllByRole("row")[1]!;
    expect(within(first).getByText("29")).toBeInTheDocument();
    fireEvent.click(within(used).getByRole("button"));
    expect(used).toHaveAttribute("aria-sort", "ascending");
    // A narrower desktop drops the Team column, a wide one shows it.
    expect(screen.getByRole("columnheader", { name: /Team/ }).className).toContain("hidden lg:table-cell");
  });

  it("finds rows once typing settles and pages through the rest", async () => {
    vi.useFakeTimers();
    render(<Local />);
    expect(screen.getByText("Showing 1 to 10 of 30")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Showing 11 to 20 of 30")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "south 2" } });
    expect(screen.getAllByRole("row")).toHaveLength(11); // not yet
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(screen.getAllByRole("row")).toHaveLength(8); // 02 12 20 22 24 26 28, back on page 1
    expect(screen.queryByRole("navigation")).toBeNull(); // they fit one page
    expect(screen.getByText("7 rows")).toBeInTheDocument(); // read out to screen readers
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nobody" } });
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(screen.getByText("Nothing matches “nobody”.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" })[1]!); // the empty state's, beside the box's own
    expect(screen.getAllByRole("row")).toHaveLength(11);
    expect(screen.getByRole("searchbox")).toHaveValue(""); // the box follows
  });

  it("changes the page size", () => {
    render(<Local initial={{ size: 25 }} />);
    expect(screen.getAllByRole("row")).toHaveLength(26);
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveTextContent("25 a page");
  });

  it("ticks one row or the whole page, and shows the bulk bar", () => {
    function Ticks() {
      const [sel, setSel] = useState<Set<string>>(new Set());
      return <Local selection={{ selected: sel, onChange: setSel, canSelect: (p) => p.id !== "u0" }} bulk={(s) => <span>bulk {s.size}</span>} />;
    }
    render(<Ticks />);
    expect(screen.queryByRole("checkbox", { name: "Select Person 00" })).toBeNull(); // not selectable
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Person 01" }));
    expect(screen.getByText("bulk 1")).toBeInTheDocument();
    const all = screen.getByRole("checkbox", { name: "Select every row on this page" }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    fireEvent.click(all);
    expect(screen.getByText("bulk 9")).toBeInTheDocument();
    fireEvent.click(all);
    expect(screen.queryByText(/^bulk/)).toBeNull();
  });

  it("opens a row by its name button or a click, but not from its actions", () => {
    const onOpen = vi.fn();
    const act1 = vi.fn();
    render(<Local onOpen={onOpen} actions={(p) => <button type="button" onClick={() => act1(p.id)}>Edit {p.name}</button>} />);
    fireEvent.click(screen.getByRole("button", { name: "Person 00" }));
    expect(onOpen).toHaveBeenLastCalledWith(PEOPLE[0]);
    fireEvent.click(screen.getAllByRole("cell", { name: "South" })[0]!);
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Edit Person 01" }));
    expect(act1).toHaveBeenCalledWith("u1");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("shows loading, an error with a retry, and the list's own empty state", () => {
    const retry = vi.fn();
    const { rerender } = render(<Local loading rows={[]} />);
    expect(screen.getByLabelText("Loading")).toHaveAttribute("aria-busy", "true");
    rerender(<Local rows={[]} error={new Error("down")} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this list. down");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
    rerender(<Local rows={[]} empty={<p>Nobody yet</p>} />);
    expect(screen.getByText("Nobody yet")).toBeInTheDocument();
  });

  it("takes one page from the server and its total", () => {
    render(<Local mode="server" rows={PEOPLE.slice(0, 10)} total={240} />);
    expect(screen.getByText("Showing 1 to 10 of 240")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 24")).toBeInTheDocument();
    // Server mode sorts only the columns the API allows.
    expect(within(screen.getByRole("columnheader", { name: "Used" })).queryByRole("button")).toBeNull();
  });
});

describe("P107: numbered pages, filter chips, row menus", () => {
  it("lists the pages to show, with gaps", () => {
    expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(1, 12)).toEqual([1, 2, 3, 4, 5, "…", 12]);
    expect(pageNumbers(6, 12)).toEqual([1, "…", 5, 6, 7, "…", 12]);
    expect(pageNumbers(4, 12)).toEqual([1, 2, 3, 4, 5, "…", 12]); // a gap of one page shows it
    expect(pageNumbers(12, 12)).toEqual([1, "…", 8, 9, 10, 11, 12]);
  });

  it("jumps to a numbered page and marks the current one", () => {
    render(<Local />);
    const nav = screen.getByRole("navigation", { name: "Pages of People" });
    expect(within(nav).getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(nav).getByRole("button", { name: "Page 3" }));
    expect(screen.getByText("Showing 21 to 30 of 30")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("filters with a chip select and clears every filter at once", () => {
    function Filtered() {
      const control = useLocalTableState({ size: 10, f: { team: "North" } });
      const rows = PEOPLE.filter((p) => !control.state.f.team || p.team === control.state.f.team);
      return <DataTable<Person> label="People" columns={COLUMNS} rows={rows} rowId={(p) => p.id} control={control}
        filters={<TableFilter control={control} id="team" label="Team" allLabel="All teams" options={[{ value: "North", label: "North" }, { value: "South", label: "South" }]} />} />;
    }
    render(<Filtered />);
    expect(screen.getByRole("combobox", { name: "Team" })).toHaveTextContent("North");
    expect(screen.getByText("Showing 1 to 10 of 15")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("combobox", { name: "Team" })).toHaveTextContent("All teams");
    expect(screen.getByText("Showing 1 to 10 of 30")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("says when filters leave nothing, with a way back", () => {
    render(<Local rows={[]} initial={{ f: { team: "East" } }} filters={<span>chips</span>} empty={<p>Nobody yet</p>} />);
    expect(screen.getByText("Nothing matches these filters.")).toBeInTheDocument();
    expect(screen.queryByText("Nobody yet")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(2); // the toolbar's and the empty state's
  });

  it("gives a row a ⋯ menu, and a click inside a dialog an action opened is not a row click", () => {
    const onOpen = vi.fn();
    render(<Local onOpen={onOpen} actions={(p) => (
      <>
        <RowMenu label={`Options for ${p.name}`}><span>menu</span></RowMenu>
        {p.id === "u0" ? createPortal(<p>Dialog text</p>, document.body) : null}
      </>
    )} />);
    expect(screen.getByRole("button", { name: "Options for Person 00" })).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(screen.getByText("Dialog text"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps the heading in sight on long desktop lists", () => {
    render(<Local />);
    const table = screen.getByRole("table", { name: "People" });
    expect(table.querySelector("thead")!.className).toContain("sticky");
    expect(table.parentElement!.className).toContain("max-h-");
    cleanup();
    render(<Local stickyHeader={false} />);
    expect(screen.getByRole("table", { name: "People" }).parentElement!.className).not.toContain("max-h-");
  });
});

describe("the table on a phone", () => {
  it("shows each row as a card of label and value, with its actions and a sort menu", () => {
    phone(true);
    render(<Local actions={(p) => <button type="button">Edit {p.name}</button>} />);
    expect(screen.queryByRole("table")).toBeNull();
    const list = screen.getByRole("list", { name: "People" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(10);
    expect(within(cards[1]!).getByText("Person 01")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("Used")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("7")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("Team")).toBeInTheDocument(); // hidden on narrow desktops, not on cards
    expect(within(cards[1]!).getByRole("button", { name: "Edit Person 01" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort by" })).toBeInTheDocument();
  });
});

describe("the address keeps the table", () => {
  function Harness() {
    const control = useTableState({ size: 10 }, { filters: ["team"] });
    return <DataTable<Person> label="People" columns={COLUMNS} rows={PEOPLE.filter((p) => !control.state.f.team || p.team === control.state.f.team)}
      rowId={(p) => p.id} control={control} searchText={(p) => p.name}
      filters={<button type="button" onClick={() => control.set({ f: { team: "North" } })}>North only</button>} />;
  }

  it("puts page, sort and filters in the search params, so Back returns to them", async () => {
    const root = createRootRoute({ component: Harness });
    const history = createMemoryHistory({ initialEntries: ["/?sort=-used"] });
    const router = createRouter({ routeTree: root, history });
    render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>);
    const used = await screen.findByRole("columnheader", { name: /Used/ });
    expect(used).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ page: 2, sort: "-used" }));
    expect(screen.getByText("Showing 11 to 20 of 30")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "North only" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: "-used", team: "North" }));
    expect(screen.getByText("Showing 1 to 10 of 15")).toBeInTheDocument();
    act(() => history.back());
    await waitFor(() => expect(router.state.location.search).toEqual({ page: 2, sort: "-used" }));
    expect(screen.getByText("Showing 11 to 20 of 30")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "person 05" } });
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "person 05", sort: "-used" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("P107: export, row actions, delete with a confirmation, bulk delete", () => {
  beforeEach(() => void saved.splice(0));

  it("writes CSV with a byte-order mark, quoted cells and formulas kept as text", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`);
    expect(csvCell(-5)).toBe('"-5"');
    expect(csvCell(null)).toBe('""');
    const cols: Column<Person>[] = [
      ...COLUMNS,
      { id: "secret", header: "Secret", sortValue: () => "x", noExport: true, cell: () => "x" },
      { id: "email", header: "Email", exportOnly: true, exportValue: (p) => `${p.id}@example.com`, cell: () => null },
      { id: "plain", header: "Plain", cell: () => "no value" },
    ];
    const csv = toCsv(cols, PEOPLE.slice(0, 2));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")).toEqual([
      '"Name","Used","Team","Email"',
      '"Person 00","0","South","u0@example.com"',
      '"Person 01","7","North","u1@example.com"',
    ]);
    expect(csvName("Companies", new Date(2026, 10, 16))).toBe("companies-2026-11-16.csv");
  });

  it("exports every row matching the search (not just the page), and hides export-only columns", async () => {
    const cols: Column<Person>[] = [...COLUMNS, { id: "email", header: "Email", exportOnly: true, exportValue: (p) => `${p.id}@example.com`, cell: () => "shown?" }];
    render(<Local columns={cols} exportName="people" initial={{ q: "north" }} />);
    expect(screen.queryByText("shown?")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /Email/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toMatch(/^people-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = (await blobText(saved[0]!.blob)).replace(/^﻿/, "").split("\r\n");
    expect(lines).toHaveLength(16); // heading + the 15 North rows over two pages
    expect(lines[0]).toBe('"Name","Used","Team","Email"');
  });

  it("gives each row View, Edit and Delete (where allowed); Delete asks first, naming it", async () => {
    const view = vi.fn();
    const edit = vi.fn();
    const remove = vi.fn(async () => undefined);
    render(<Local rowActions={{ view, edit, remove, canRemove: (p) => p.id !== "u0", removeBody: (p) => `${p.name} goes for good.` }} />);
    let menu = openMenu("Options for Person 00");
    expect(within(menu).getByRole("menuitem", { name: "View" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Delete" })).toBeNull(); // not this one
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit" }));
    expect(edit).toHaveBeenCalledWith(PEOPLE[0]);
    menu = openMenu("Options for Person 01");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Person 01?" });
    expect(within(dialog).getByText("Person 01 goes for good.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(PEOPLE[1]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(view).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the reason when a delete is refused", async () => {
    const remove = vi.fn(async () => {
      throw new Error("A workspace needs at least one owner.");
    });
    render(<Local rowActions={{ remove, verb: "remove" }} />);
    fireEvent.click(within(openMenu("Options for Person 02")).getByRole("menuitem", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Person 02?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("A workspace needs at least one owner.");
    expect(screen.getByRole("dialog", { name: "Remove Person 02?" })).toBeInTheDocument();
  });

  it("bulk bar: export the ticked rows, delete them with a count, and say what did not go", async () => {
    const run = vi.fn(async (rows: Person[]) => eachRow(rows, (p) => p.id, async (p) => {
      if (p.id === "u3") throw new Error("Not yours to delete.");
    }));
    function Bulk() {
      const [sel, setSel] = useState<Set<string>>(new Set());
      return (
        <>
          <Local exportName="people" selection={{ selected: sel, onChange: setSel }} bulkRemove={{ run }} />
          <output data-testid="ticked">{[...sel].join(",")}</output>
        </>
      );
    }
    render(<Bulk />);
    for (const n of ["01", "02", "03"]) fireEvent.click(screen.getByRole("checkbox", { name: `Select Person ${n}` }));
    const bar = screen.getByRole("region", { name: "Ticked rows" });
    expect(within(bar).getByText("3 ticked")).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: /Export ticked/ }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((await blobText(saved[0]!.blob)).split("\r\n")).toHaveLength(4);
    fireEvent.click(within(bar).getByRole("button", { name: /Delete ticked/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete 3 ticked rows?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("2 done, 1 not done: Not yours to delete.");
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("ticked")).toHaveTextContent(/^u3$/); // only what did not go stays ticked
    expect(screen.getByRole("dialog", { name: "Delete 1 ticked row?" })).toBeInTheDocument();
  });

  it("puts Add and Import in the toolbar", () => {
    const add = vi.fn();
    const imp = vi.fn();
    render(<Local onAdd={add} addLabel="Add person" onImport={imp} importLabel="Import from Excel" />);
    fireEvent.click(screen.getByRole("button", { name: /Add person/ }));
    fireEvent.click(screen.getByRole("button", { name: /Import from Excel/ }));
    expect(add).toHaveBeenCalledTimes(1);
    expect(imp).toHaveBeenCalledTimes(1);
  });
});
