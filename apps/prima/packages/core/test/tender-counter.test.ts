import { describe, expect, it } from "vitest";
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  countCompanyQuotations,
  countCompanyTenders,
  generateDataset,
  halfKey,
  lastHalves,
  lastMonths,
  type Quotation,
  type Tender,
} from "../src";

const TODAY = "2026-11-04";
const NOW = "2026-11-04T03:00:00.000Z";

// Synthetic records only.
function tender(over: Partial<Tender>): Tender {
  return {
    id: "td-x",
    companyId: "co-test",
    ref: "T-1",
    title: "Test tender",
    buyer: "Test buyer (mock)",
    channel: "PRIVATE",
    source: "test",
    owner: "test",
    closesOn: "2026-03-10",
    guards: 4,
    sites: 1,
    status: "open",
    estMonthly: null,
    ...over,
  };
}

function quote(over: Partial<Quotation>): Quotation {
  return {
    id: "q-x",
    companyId: "co-test",
    ref: "Q-1",
    client: "Test client (mock)",
    siteName: "Site",
    tenderId: null,
    guards: 2,
    hoursPerDay: 12,
    ratePerGuard: 3000,
    monthlyTotal: 6000,
    validUntil: "2026-12-31",
    status: "draft",
    preparedBy: "Staff A",
    preparedById: "u-a",
    preparedAt: "2026-02-01T02:00:00.000Z",
    approvedBy: null,
    approvedAt: null,
    note: "",
    ...over,
  };
}

const sign = (level: "PREPARER" | "MANAGER", userId: string, by: string) => ({
  level,
  userId,
  by,
  at: "2026-01-01T00:00:00.000Z",
  note: "",
});

describe("tender counter periods", () => {
  it("uses January-June and July-December six-month periods", () => {
    expect(halfKey("2026-06-30")).toBe("2026-H1");
    expect(halfKey("2026-07-01")).toBe("2026-H2");
    expect(lastHalves(TODAY, 4)).toEqual([
      "2025-H1",
      "2025-H2",
      "2026-H1",
      "2026-H2",
    ]);
    expect(lastMonths("2026-02-15", 3)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(lastMonths(TODAY, 12)).toHaveLength(12);
  });
});

describe("countCompanyTenders", () => {
  it("counts entered by the slip month, won by the result date, and each preparer once", () => {
    const c = countCompanyTenders("co-test", [
      tender({ id: "a", status: "open" }),
      tender({
        id: "b",
        status: "preparing",
        verifications: [sign("PREPARER", "u-a", "Staff A")],
      }),
      tender({
        id: "c",
        status: "submitted",
        submission: {
          by: "Staff A",
          at: "2026-03-05T01:00:00.000Z",
          note: "",
          proofIds: ["p"],
        },
        verifications: [
          sign("PREPARER", "u-a", "Staff A"),
          sign("MANAGER", "u-m", "Manager"),
        ],
      }),
      tender({
        id: "d",
        status: "won",
        submission: {
          by: "Staff B",
          at: "2026-05-20T01:00:00.000Z",
          note: "",
          proofIds: ["p"],
        },
        outcome: {
          status: "won",
          userId: "u-m",
          by: "Manager",
          at: "2026-08-02T01:00:00.000Z",
        },
        verifications: [
          sign("PREPARER", "u-b", "Staff B"),
          sign("MANAGER", "u-m", "Manager"),
        ],
      }),
      tender({ id: "e", status: "lost", closesOn: "2026-05-01" }),
      tender({ id: "f", status: "no_bid" }),
      tender({ id: "g", companyId: "co-other", status: "won" }),
    ]);
    expect(c.enteredByMonth).toEqual({ "2026-03": 1, "2026-05": 2 });
    expect(c.enteredByHalf).toEqual({ "2026-H1": 3 });
    // Lodged in May, won in August: the win counts in July-December.
    expect(c.wonByHalf).toEqual({ "2026-H2": 1 });
    expect(c.awaitingResult).toBe(1);
    expect(c.datedByClosing).toBe(1);
    const a = c.staff.find((s) => s.userId === "u-a")!;
    expect(a.completedByMonth).toEqual({ "2026-03": 1 });
    expect(c.staff.find((s) => s.userId === "u-m")!.verifiedByHalf).toEqual({
      "2026-H1": 2,
    });
  });
});

describe("countCompanyQuotations", () => {
  it("counts sent quotations per month and accepted per six months, per preparer", () => {
    const c = countCompanyQuotations("co-test", [
      quote({ id: "1", status: "draft" }),
      quote({ id: "2", status: "approved" }),
      quote({
        id: "3",
        status: "sent",
        sent: { userId: "u-a", by: "Staff A", at: "2026-04-02T00:00:00.000Z" },
      }),
      quote({
        id: "4",
        status: "accepted",
        preparedBy: "Staff B",
        preparedById: "u-b",
        sent: { userId: "u-b", by: "Staff B", at: "2026-06-10T00:00:00.000Z" },
        decided: {
          status: "accepted",
          userId: "u-b",
          by: "Staff B",
          at: "2026-07-03T00:00:00.000Z",
        },
      }),
      quote({
        id: "5",
        status: "rejected",
        approvedAt: "2026-01-15T00:00:00.000Z",
      }),
    ]);
    expect(c.sentByMonth).toEqual({ "2026-01": 1, "2026-04": 1, "2026-06": 1 });
    expect(c.acceptedByHalf).toEqual({ "2026-H2": 1 });
    expect(c.awaitingAnswer).toBe(1);
    expect(c.estimatedDates).toBe(1);
    expect(c.staff.map((s) => s.userId)).toEqual(["u-a", "u-b"]);
    expect(c.staff[1].acceptedByHalf).toEqual({ "2026-H2": 1 });
  });
});

describe("tenderCounter service (Fauzan, 4 Nov 2026)", () => {
  function fresh() {
    const ds = generateDataset({ today: TODAY, now: NOW });
    return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
  }

  it("lets the Director Office Administrator monitor every company with every staff member", async () => {
    const { svc } = fresh();
    const doa = await svc.user("u-pwvsb-doa");
    const view = await svc.tenderCounter(doa);
    expect(view.months).toHaveLength(12);
    expect(view.halves.map((h) => h.label)).toEqual([
      "Jan-Jun 2025",
      "Jul-Dec 2025",
      "Jan-Jun 2026",
      "Jul-Dec 2026",
    ]);
    const ids = view.companies.map((c) => c.companyId);
    expect(ids).toEqual(
      expect.arrayContaining(["co-sasa", "co-arsh", "co-inas"]),
    );
    expect(view.companies.every((c) => c.staffScope === "all")).toBe(true);
  });

  it("shows a company admin only their own company and their own staff row", async () => {
    const { svc, ds } = fresh();
    ds.tenders.push(
      tender({
        id: "td-count-1",
        companyId: "co-arsh",
        status: "submitted",
        submission: {
          by: "x",
          at: "2026-11-02T01:00:00.000Z",
          note: "",
          proofIds: ["p"],
        },
        verifications: [
          sign("PREPARER", "u-ae-arsh", "Siti Hajar binti Rosli"),
          sign("MANAGER", "u-cm-arsh", "Kenny Lau Chee Wah"),
        ],
      }),
      tender({
        id: "td-count-2",
        companyId: "co-arsh",
        status: "submitted",
        submission: {
          by: "x",
          at: "2026-11-03T01:00:00.000Z",
          note: "",
          proofIds: ["p"],
        },
        verifications: [
          sign("PREPARER", "u-other", "Another Staff"),
          sign("MANAGER", "u-cm-arsh", "Kenny Lau Chee Wah"),
        ],
      }),
    );
    const ae = await svc.user("u-ae-arsh");
    const view = await svc.tenderCounter(ae);
    expect(view.companies.map((c) => c.companyId)).toEqual(["co-arsh"]);
    const row = view.companies[0];
    expect(row.staffScope).toBe("own");
    expect(row.staff.map((s) => s.userId)).toEqual(["u-ae-arsh"]);
    expect(row.entered[11]).toBeGreaterThanOrEqual(2);

    const cm = await svc.user("u-cm-arsh");
    const mgr = (await svc.tenderCounter(cm)).companies[0];
    expect(mgr.staffScope).toBe("all");
    expect(mgr.staff.map((s) => s.userId)).toEqual(
      expect.arrayContaining(["u-ae-arsh", "u-other", "u-cm-arsh"]),
    );
  });

  it("records who set the tender result and who sent the quotation, and counts them", async () => {
    const { svc, ds } = fresh();
    ds.tenders.push(
      tender({
        id: "td-count-3",
        companyId: "co-arsh",
        status: "submitted",
        submission: {
          by: "x",
          at: "2026-10-01T01:00:00.000Z",
          note: "",
          proofIds: ["p"],
        },
      }),
    );
    const ae = await svc.user("u-ae-arsh");
    const cm = await svc.user("u-cm-arsh");
    await expect(
      svc.updateTender(ae, "td-count-3", "won"),
    ).rejects.toBeInstanceOf(AccessDenied);
    const won = await svc.updateTender(cm, "td-count-3", "won");
    expect(won.outcome).toMatchObject({
      status: "won",
      userId: "u-cm-arsh",
      at: NOW,
    });

    const q = await svc.createQuotation(ae, "co-arsh", {
      client: "Test JMB (mock)",
      siteName: "Tower A",
      tenderId: null,
      guards: 4,
      hoursPerDay: 12,
      ratePerGuard: 3200,
      validDays: 30,
    });
    await svc.quotationAction(ae, q.id, "submit");
    await svc.quotationAction(cm, q.id, "approve", "Reviewed quotation and approved");
    const sent = await svc.quotationAction(ae, q.id, "sent");
    expect(sent.sent).toMatchObject({ userId: "u-ae-arsh", at: NOW });
    const accepted = await svc.quotationAction(ae, q.id, "accepted");
    expect(accepted.decided).toMatchObject({ status: "accepted", at: NOW });

    const before = (await svc.tenderCounter(cm)).companies[0];
    expect(before.wonHalf[3]).toBeGreaterThanOrEqual(1);
    expect(before.quotations.sent[11]).toBeGreaterThanOrEqual(1);
    expect(before.quotations.acceptedHalf[3]).toBeGreaterThanOrEqual(1);
    const mine = before.quotations.staff.find((s) => s.userId === "u-ae-arsh")!;
    expect(mine.sent[11]).toBeGreaterThanOrEqual(1);
  });

  it("gives a guard nothing and keeps the arms-only desk out", async () => {
    const { svc, ds } = fresh();
    const guard = ds.users.find((u) => u.role === "guard");
    if (guard)
      expect(
        (await svc.tenderCounter(await svc.user(guard.id))).companies,
      ).toEqual([]);
    await expect(
      svc.tenderCounter(await svc.user("u-pwvsb-arms")),
    ).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe("tender opportunities (Fauzan, 4 Nov 2026)", () => {
  function fresh() {
    const ds = generateDataset({ today: TODAY, now: NOW });
    return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
  }
  const base = {
    kind: "TENDER" as const,
    ref: "TEST-0001",
    title: "Guarding services, test zone (mock)",
    buyer: "Test Utility (mock)",
    channel: "GOVERNMENT" as const,
    source: "Public portal",
    closesOn: "2026-11-12",
    guards: 10,
    note: "",
  };

  it("lets the Director Office record a tender and set companies, each getting its own tender record", async () => {
    const { svc } = fresh();
    const doa = await svc.user("u-pwvsb-doa");
    const o = await svc.recordTenderOpportunity(doa, {
      ...base,
      companyIds: ["co-sasa", "co-arsh"],
    });
    expect(o.entries.map((e) => [e.companyId, e.setBy])).toEqual([
      ["co-sasa", "DOA"],
      ["co-arsh", "DOA"],
    ]);
    const cm = await svc.user("u-cm-sasa");
    const view = await svc.commercial(cm, "co-sasa");
    expect(
      view.tenders.some(
        (t) => t.tender.ref === "TEST-0001" && t.tender.status === "open",
      ),
    ).toBe(true);
    await expect(svc.recordTenderOpportunity(doa, { ...base })).rejects.toThrow(
      /already on the list/,
    );
  });

  it("lets a company enter by itself or just inform, and hides other companies’ entries", async () => {
    const { svc } = fresh();
    const doa = await svc.user("u-pwvsb-doa");
    const o = await svc.recordTenderOpportunity(doa, {
      ...base,
      companyIds: ["co-sasa"],
    });
    const ae = await svc.user("u-ae-arsh");
    const before = await svc.tenderOpportunities(ae);
    const row = before.rows.find((r) => r.id === o.id)!;
    expect(row.entries).toEqual([]);
    expect(row.canEnter).toEqual(["co-arsh"]);
    await svc.enterTenderOpportunity(ae, o.id, ["co-arsh"]);
    await expect(
      svc.enterTenderOpportunity(ae, o.id, ["co-arsh"]),
    ).rejects.toThrow(/already enters/);
    await expect(
      svc.enterTenderOpportunity(ae, o.id, ["co-sasa"]),
    ).rejects.toBeInstanceOf(AccessDenied);
    const after = (await svc.tenderOpportunities(ae)).rows.find(
      (r) => r.id === o.id,
    )!;
    expect(after.entries.map((e) => [e.companyId, e.setBy])).toEqual([
      ["co-arsh", "COMPANY"],
    ]);

    // A company tells the Director Office about one it found itself: no approval, the Director Office sees it.
    const own = await svc.recordTenderOpportunity(ae, {
      ...base,
      kind: "QUOTATION",
      ref: "",
      title: "Client quotation (mock)",
      channel: "PRIVATE",
      companyId: "co-arsh",
    });
    expect(own.origin).toBe("COMPANY");
    expect(own.entries[0]).toMatchObject({
      companyId: "co-arsh",
      setBy: "COMPANY",
      tenderId: null,
    });
    const dv = await svc.tenderOpportunities(doa);
    expect(dv.rows.find((r) => r.id === own.id)!.informedByCompany).toBe(1);
    expect(dv.rows.find((r) => r.id === o.id)!.entries).toHaveLength(2);
    await expect(
      svc.recordTenderOpportunity(ae, {
        ...base,
        ref: "TEST-0002",
        companyId: "co-sasa",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
  });

  it("only lets the Director Office set other companies", async () => {
    const { svc } = fresh();
    const doa = await svc.user("u-pwvsb-doa");
    const o = await svc.recordTenderOpportunity(doa, { ...base });
    const cm = await svc.user("u-cm-arsh");
    await expect(
      svc.enterTenderOpportunity(cm, o.id, ["co-sasa"]),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.recordTenderOpportunity(doa, { ...base, ref: "X", closesOn: "soon" }),
    ).rejects.toThrow(/closing date/);
  });
});

describe("tender sites to check (Fauzan, 4 Nov 2026)", () => {
  function fresh() {
    const ds = generateDataset({ today: TODAY, now: NOW });
    return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
  }

  it("lets the Director Office load the starter list, record checks and see what is due", async () => {
    const { svc } = fresh();
    const doa = await svc.user("u-pwvsb-doa");
    expect((await svc.loadTenderSourceStarter(doa)).added).toBe(28);
    expect((await svc.loadTenderSourceStarter(doa)).added).toBe(0);
    let view = await svc.tenderSources(doa);
    expect(view.summary.watched).toBe(28);
    expect(view.summary.due).toBe(28);
    const tnb = view.rows.find((r) => r.buyer === "TNB")!;
    await expect(
      svc.recordTenderSourceCheck(doa, tnb.id, {
        status: "CHECKED",
        result: "",
      }),
    ).rejects.toThrow(/what you saw/);
    await svc.recordTenderSourceCheck(doa, tnb.id, {
      status: "VENDOR_LIMITED",
      result: "Guarding tenders confirmed from public PDFs",
      found: 6,
      followUp: "Confirm registration",
    });
    const ltat = view.rows.find((r) => r.buyer === "LTAT")!;
    await svc.recordTenderSourceCheck(doa, ltat.id, {
      status: "ERROR",
      result: "403",
    });
    view = await svc.tenderSources(doa);
    expect(view.rows.find((r) => r.buyer === "TNB")!.due).toBe(false);
    expect(view.rows.find((r) => r.buyer === "LTAT")!).toMatchObject({
      due: true,
      why: expect.stringMatching(/failed/),
    });
    expect(view.summary).toMatchObject({ due: 27, vendorLimited: 1, error: 1 });
    await expect(
      svc.addTenderSource(doa, {
        buyer: "Test portal",
        urls: ["http://insecure.example"],
      }),
    ).rejects.toThrow(/https/);
    await svc.addTenderSource(doa, {
      buyer: "Test portal",
      urls: ["https://portal.example/tenders"],
    });
    await expect(
      svc.addTenderSource(doa, {
        buyer: "test portal",
        urls: ["https://portal.example/x"],
      }),
    ).rejects.toThrow(/already/);
  });

  it("keeps the site list to the Director Office and group leaders; only the Director Office edits", async () => {
    const { svc } = fresh();
    await expect(
      svc.tenderSources(await svc.user("u-cm-sasa")),
    ).rejects.toBeInstanceOf(AccessDenied);
    // The CEO (Director) may set the tender protocol, so edits like the Director Office; the COO only views.
    expect((await svc.tenderSources(await svc.user("u-fauzan"))).canEdit).toBe(
      true,
    );
    const coo = await svc.user("u-coo");
    expect((await svc.tenderSources(coo)).canEdit).toBe(false);
    await expect(svc.loadTenderSourceStarter(coo)).rejects.toBeInstanceOf(
      AccessDenied,
    );
    await expect(
      svc.loadTenderSourceStarter(await svc.user("u-ae-arsh")),
    ).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe("Director Office report and meeting counter (Fauzan, 4 Nov 2026)", () => {
  function fresh() {
    const ds = generateDataset({ today: TODAY, now: NOW });
    return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
  }
  const meeting = (
    id: string,
    start: string,
    status: "scheduled" | "held" | "cancelled",
    minutes: boolean,
  ) => ({
    id,
    companyId: "co-sasa",
    department: null,
    kind: "management" as const,
    title: `Test meeting ${id} (mock)`,
    organiser: "Organiser (mock)",
    start,
    end: start,
    location: "Office",
    attendees: [],
    agenda: "1. Item",
    status,
    minutes: minutes ? { text: "Minutes (mock)", by: "x", at: start } : null,
    summary: null,
  });

  it("counts every report each company and department sent, with the time sent, and every meeting with its minutes", async () => {
    const { svc, ds } = fresh();
    ds.meetings.push(
      meeting("mt-c1", "2026-10-05T02:00:00.000Z", "held", true),
      meeting("mt-c2", "2026-10-12T02:00:00.000Z", "held", false),
      meeting("mt-c3", "2026-10-19T02:00:00.000Z", "cancelled", false),
    );
    const doa = await svc.user("u-pwvsb-doa");
    const c = await svc.directorOfficeCounter(doa);
    expect(c.months[11]).toBe("2026-11");
    const oct = c.months.indexOf("2026-10");
    expect(c.reports.senders.some((s) => s.kind === "company")).toBe(true);
    expect(c.reports.senders.some((s) => s.kind === "department")).toBe(true);
    const sasa = c.reports.senders.find((s) => s.key === "co-sasa")!;
    const cell = sasa.months[oct];
    expect(cell.expected).toBe(
      cell.onTime + cell.late + cell.missing + cell.unknown,
    );
    expect(cell.expected).toBeGreaterThan(0);
    const sentEntry = sasa.log.find((l) => l.sentAt);
    expect(sentEntry?.by).toBeTruthy();
    const ids = new Set(
      ds.reportSubmissions
        .filter((r) => r.companyId === "co-sasa")
        .map((r) => r.at),
    );
    expect(ids.has(sentEntry!.sentAt!)).toBe(true);

    const g = c.meetings.groups.find((x) => x.key === "co-sasa")!;
    expect(g.months[oct].held).toBeGreaterThanOrEqual(2);
    expect(g.months[oct].cancelled).toBeGreaterThanOrEqual(1);
    expect(c.meetings.missingMinutes.map((x) => x.id)).toContain("mt-c2");
    expect(c.meetings.missingMinutes.map((x) => x.id)).not.toContain("mt-c1");
  });

  it("is for the Director Office, CEO and COO only", async () => {
    const { svc } = fresh();
    await expect(
      svc.directorOfficeCounter(await svc.user("u-cm-sasa")),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.directorOfficeCounter(await svc.user("u-ae-arsh")),
    ).rejects.toBeInstanceOf(AccessDenied);
    expect(
      (await svc.directorOfficeCounter(await svc.user("u-coo"))).months,
    ).toHaveLength(12);
  });
});
