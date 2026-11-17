/** P109: Head of department (HOD) of several departments, the Library by department, files
 * uploaded for other companies, and comments with @mentions on feedback. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addComment } from "@/lib/feedback";
import { approveHandoff, editHandoff, uploadFor } from "@/lib/handoffs";
import type { Member } from "@/lib/types";

import { libraryChanges, libraryOf, LibraryAccessFields, type LibraryValue } from "./members-access";
import { HodBadge, OrgFields } from "./members-org";

const m = (id: string, name: string, extra: Partial<Member> = {}): Member => ({
  user_id: id, email: `${id}@example.com`, name, role: "staff", is_active: true, must_change_password: false, last_login_at: null,
  joined_at: "2026-11-01T00:00:00Z", department_id: "dp_fin", department_name: "Finance", ...extra,
});
const BRANCHES = [
  { id: "br_maju", name: "Maju", departments: [{ id: "dp_fin", branch_id: "br_maju", name: "Finance", slug: "finance", position: 0 }, { id: "dp_ops", branch_id: "br_maju", name: "Operations", slug: "ops", position: 1 }] },
  { id: "br_jaya", name: "Jaya", departments: [{ id: "dp_jfin", branch_id: "br_jaya", name: "Finance", slug: "finance", position: 0 }] },
];

let sent: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  sent = [];
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      const raw = init?.body;
      sent.push({
        url: url.pathname + url.search, method,
        body: typeof raw === "string" ? JSON.parse(raw) : raw ?? null,
        headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})),
      });
    }
    if (url.pathname === "/api/branches") return json(BRANCHES);
    if (url.pathname === "/api/handoffs") return json([{ id: "fh_1" }, { id: "fh_2" }], 201);
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("Head of department (HOD)", { timeout: 30_000 }, () => {
  function Fields({ member }: { member: Member }) {
    const [headOf, setHeadOf] = useState<string[]>([]);
    return (
      <>
        <OrgFields member={member} members={[member]} reportsTo="" onReportsTo={() => {}} headOf={headOf} onHeadOf={setHeadOf} departmentId="dp_fin" />
        <output data-testid="heads">{headOf.join(",")}</output>
      </>
    );
  }

  it("turns HOD on with their own department, then lists the departments of every company", async () => {
    wrap(<Fields member={m("u_hana", "Hana", { role: "hod" })} />);
    const box = await screen.findByRole("checkbox", { name: /Head of department \(HOD\)/ });
    expect(screen.queryByText("Departments they head")).toBeNull();
    fireEvent.click(box);
    expect(screen.getByTestId("heads")).toHaveTextContent("dp_fin");
    expect(await screen.findByText("Departments they head")).toBeInTheDocument();
    fireEvent.click(box);
    expect(screen.getByTestId("heads")).toHaveTextContent("");
  });

  it("says HOD and the departments they head, across companies", () => {
    wrap(<>
      <HodBadge member={m("u_a", "A", { heads_department: true, head_of: [{ id: "dp_fin", name: "Finance", branch_name: "Maju" }, { id: "dp_jfin", name: "Audit", branch_name: "Jaya" }] })} />
      <HodBadge member={m("u_b", "B", { heads_department: true })} />
    </>);
    expect(screen.getByText("HOD: Finance, Audit")).toBeInTheDocument();
    expect(screen.getByTitle("Finance (Maju), Audit (Jaya)")).toBeInTheDocument();
    expect(screen.getByText("HOD: Finance")).toBeInTheDocument();
  });
});

describe("Library: whole company or own department only", () => {
  it("sends only what changed", () => {
    const before = libraryOf(m("u", "U"));
    expect(before).toEqual({ scope: "company", forOthers: false });
    expect(libraryChanges(before, before)).toBeNull();
    expect(libraryChanges(before, { scope: "department", forOthers: false })).toEqual({ library_scope: "department" });
    expect(libraryChanges(before, { scope: "company", forOthers: true })).toEqual({ uploads_for_others: true });
  });

  it("explains what each choice means", () => {
    function F() {
      const [v, setV] = useState<LibraryValue>({ scope: "department", forOthers: false });
      return <LibraryAccessFields value={v} onChange={setV} role="staff" />;
    }
    wrap(<F />);
    expect(screen.getByText(/only their department's files/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /May upload files for other companies/ }));
    expect(screen.getByRole("checkbox", { name: /May upload files for other companies/ })).toBeChecked();
  });
});

describe("Files for other companies", () => {
  it("uploads one file for several companies with a typed title and the task", async () => {
    const file = new File(["SSM"], "ssm.pdf", { type: "application/pdf" });
    const got = await uploadFor(file, ["br_jaya", "br_maju"], " SSM certificates ", "tk_1");
    expect(got).toHaveLength(2);
    const [call] = sent;
    expect(call!.method).toBe("POST");
    const q = new URLSearchParams(call!.url.split("?")[1]);
    expect(q.get("companies")).toBe("br_jaya,br_maju");
    expect(q.get("title")).toBe("SSM certificates");
    expect(q.get("task_id")).toBe("tk_1");
    expect(call!.headers["content-type"]).toBe("application/octet-stream");
  });

  it("leaves the title out when the AI describes it, then edits and approves", async () => {
    await uploadFor(new File(["x"], "bank.txt"), ["br_jaya"], "", null);
    const q = new URLSearchParams(sent[0]!.url.split("?")[1]);
    expect(q.has("title")).toBe(false);
    await editHandoff("fh_1", { title: "Bank statement" });
    await approveHandoff("fh_1");
    expect(sent.slice(1).map((s) => [s.method, s.url])).toEqual([["PATCH", "/api/handoffs/fh_1"], ["POST", "/api/handoffs/fh_1/approve"]]);
  });
});

describe("Feedback comments", () => {
  it("sends the comment with the people it mentions", async () => {
    await addComment("fb_1", "@Coo please look", ["u_coo"]);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: "/api/feedback/fb_1/comments", method: "POST", body: { body: "@Coo please look", mentions: ["u_coo"] } });
  });
});
