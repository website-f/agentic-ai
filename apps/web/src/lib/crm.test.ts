import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addContact,
  addDays,
  addNote,
  addressLine,
  archiveParty,
  between,
  byStage,
  cleanMapping,
  cleanParty,
  createDeal,
  createParty,
  deleteContact,
  getDealSummary,
  getDuplicates,
  getParty,
  getTimeline,
  importCommit,
  importPreview,
  isMissingApi,
  isPast,
  listDeals,
  listParties,
  normalizeDeal,
  parseTags,
  partiesQuery,
  partyKeys,
  placeDeal,
  primaryOf,
  query,
  retryUnlessMissing,
  summarize,
  updateContact,
  updateDeal,
  updateParty,
  type Deal,
} from "./crm";

function stub(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(
    status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const call = (f: ReturnType<typeof stub>, i = 0) => {
  const init = f.mock.calls[i]![1] as RequestInit;
  return {
    url: f.mock.calls[i]![0] as string,
    method: (init.method ?? "GET") as string,
    body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
  };
};

const deal = (over: Partial<Deal>): Deal => normalizeDeal({ id: "d", title: "Deal", party_id: "p1", ...over });

describe("the contacts API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists contacts with filters, reading {items,total} or a bare list", async () => {
    let f = stub({ items: [{ id: "p1", name: "Syarikat Maju", roles: ["customer", "bogus"] }], total: 31 });
    const r = await listParties({ q: "maju", role: "customer", branch_id: "", tag: undefined, limit: 50, offset: 0 });
    expect(call(f).url).toBe("/api/parties?q=maju&role=customer&limit=50&offset=0");
    expect(r.total).toBe(31);
    expect(r.items[0]!.roles).toEqual(["customer"]);
    expect(r.items[0]!.address.lines).toEqual([]); // filled when missing
    expect(r.items[0]!.currency).toBe("MYR");

    f = stub([{ id: "p2", name: "Ali" }]);
    expect((await listParties()).total).toBe(1);
    expect(call(f).url).toBe("/api/parties");
  });

  it("creates, edits and archives a contact, cleaning what it sends", async () => {
    let f = stub({ id: "p1", name: "Maju" });
    await createParty({
      kind: "company", name: "  Syarikat   Maju  ", email: " Accounts@Maju.MY ", tin: " c 1234567890 ", roles: ["customer", "customer"],
      tags: ["vip", " KL", "vip ", ""], address: { lines: ["No 1, Jalan Ampang", " "], city: " KL ", postcode: "50450", state: "W.P. Kuala Lumpur", country: "Malaysia" },
      contact: { name: " Aina ", email: "AINA@maju.my" },
    });
    expect(call(f)).toMatchObject({ url: "/api/parties", method: "POST" });
    expect(call(f).body).toMatchObject({
      name: "Syarikat Maju", email: "accounts@maju.my", tin: "C1234567890", roles: ["customer"], tags: ["vip", "KL"],
      address: { lines: ["No 1, Jalan Ampang"], city: "KL" },
      contact: { name: "Aina", email: "aina@maju.my", is_primary: true },
    });

    // A contact without a name is not sent at all.
    f = stub({ id: "p1" });
    await createParty({ name: "X", contact: { name: " ", email: "a@b.co" } });
    expect(call(f).body.contact).toBeUndefined();

    f = stub({ id: "p1" });
    await updateParty("p1", { payment_terms_days: 30 });
    expect(call(f)).toEqual({ url: "/api/parties/p1", method: "PATCH", body: { payment_terms_days: 30 } });

    f = stub({ id: "p1", status: "archived" });
    await archiveParty("p1");
    expect(call(f)).toMatchObject({ url: "/api/parties/p1/archive", method: "POST" });
  });

  it("reads one contact, flat or wrapped, with its contacts, deals and money", async () => {
    stub({ id: "p1", name: "Maju", contacts: [{ id: "c1", name: "Aina", is_primary: true }], deals: [{ id: "d1", stage: "proposal", value: "1200.5" }], money: { receivable_open: 500, payable_open: 0, overdue: 200 } });
    let p = await getParty("p1");
    expect(p.name).toBe("Maju");
    expect(p.contacts).toHaveLength(1);
    expect(p.deals[0]!.value).toBe(1200.5);
    expect(p.money?.overdue).toBe(200);

    stub({ party: { id: "p1", name: "Maju", balances: { receivable_open: 1, payable_open: 2, overdue: 0 }, primary_contact: { id: "c9", name: "Ben" } } });
    p = await getParty("p1");
    expect(p.contacts.map((c) => c.id)).toEqual(["c9"]);
    expect(p.deals).toEqual([]);
    expect(p.money).toEqual({ receivable_open: 1, payable_open: 2, overdue: 0 });
  });

  it("adds, edits and removes contact people", async () => {
    let f = stub({ id: "c1" });
    await addContact("p1", { name: " Aina ", email: " AINA@X.MY ", is_primary: true });
    expect(call(f)).toEqual({ url: "/api/parties/p1/contacts", method: "POST", body: { name: "Aina", email: "aina@x.my", is_primary: true } });
    f = stub({ id: "c1" });
    await updateContact("c1", { is_primary: true });
    expect(call(f)).toEqual({ url: "/api/party-contacts/c1", method: "PATCH", body: { is_primary: true } });
    f = stub(null, 204);
    await deleteContact("c1");
    expect(call(f)).toMatchObject({ url: "/api/party-contacts/c1", method: "DELETE" });
  });

  it("reads the timeline and adds notes", async () => {
    let f = stub([{ id: "e1", kind: "email_in", summary: "Asked for a quote", at: "2026-10-01T02:00:00Z", actor: "Aina" }]);
    const items = await getTimeline("p1", 20);
    expect(call(f).url).toBe("/api/parties/p1/timeline?limit=20");
    expect(items[0]!.links).toEqual({});
    f = stub({ id: "n1" });
    await addNote("p1", "  Called, will pay Friday ");
    expect(call(f)).toEqual({ url: "/api/parties/p1/notes", method: "POST", body: { text: "Called, will pay Friday" } });
  });

  it("imports a spreadsheet: multipart upload, then the mapping and rows", async () => {
    let f = stub({ columns: ["Company", "E-mail", "Extra"], rows: [{ Company: "Maju" }], mapping: { Company: "name", "E-mail": "email", Gone: "phone" } });
    const file = new File(["Company,E-mail\nMaju,a@b.co"], "contacts.csv", { type: "text/csv" });
    const prev = await importPreview(file);
    expect(call(f).url).toBe("/api/parties/import");
    expect(call(f).method).toBe("POST");
    expect(call(f).body).toBeInstanceOf(FormData);
    // No JSON content type: the browser sets the multipart boundary itself.
    expect(((f.mock.calls[0]![1] as RequestInit).headers as Record<string, string>)["content-type"]).toBeUndefined();
    expect(prev.mapping).toEqual({ Company: "name", "E-mail": "email", Extra: null });

    f = stub({ created: 3, updated: 1, skipped: 2 });
    const r = await importCommit({ Company: "name" }, [{ Company: "Maju" }]);
    expect(r).toEqual({ created: 3, updated: 1, skipped: 2 });
    expect(call(f)).toEqual({ url: "/api/parties/import/commit", method: "POST", body: { mapping: { Company: "name" }, rows: [{ Company: "Maju" }] } });

    stub({ code: "bad_file", message: "Not a spreadsheet" }, 422);
    await expect(importPreview(file)).rejects.toMatchObject({ status: 422, message: "Not a spreadsheet" });
  });

  it("lists possible duplicates, dropping groups of one", async () => {
    stub([{ reason: "Same TIN", parties: [{ id: "a" }, { id: "b" }] }, { reason: "x", parties: [{ id: "c" }] }]);
    const groups = await getDuplicates();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.reason).toBe("Same TIN");
  });

  it("tells a server without P35 (404) from a real failure", async () => {
    stub({ code: "not_found", message: "Not Found" }, 404);
    const err = await listParties().catch((e: unknown) => e);
    expect(isMissingApi(err)).toBe(true);
    expect(retryUnlessMissing(0, err)).toBe(false);
    stub({ detail: "Not Found" }, 404); // FastAPI's own answer for a route it does not have
    expect(isMissingApi(await listParties().catch((e: unknown) => e))).toBe(true);
    stub({ code: "party_not_found", message: "That customer or supplier is not here." }, 404);
    expect(isMissingApi(await listParties().catch((e: unknown) => e))).toBe(false);
    stub({ code: "boom" }, 500);
    const real = await listParties().catch((e: unknown) => e);
    expect(isMissingApi(real)).toBe(false);
    expect(retryUnlessMissing(0, real)).toBe(true);
    expect(retryUnlessMissing(1, real)).toBe(false);
  });

  it("pages with limit/offset until the total is reached", () => {
    const q = partiesQuery({ q: "" });
    const next = q.getNextPageParam!;
    const page = (n: number, total: number) => ({ items: Array.from({ length: n }, (_, i) => ({ id: String(i) })), total }) as never;
    expect(next(page(50, 120), [page(50, 120)], 0, [0])).toBe(50);
    expect(next(page(20, 120), [page(50, 120), page(50, 120), page(20, 120)], 100, [0, 50, 100])).toBeUndefined();
    expect(q.queryKey.slice(0, 1)).toEqual([...partyKeys.all]); // party.updated refreshes every list
  });
});

describe("the deals API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists, creates, moves and sums deals", async () => {
    let f = stub({ items: [{ id: "d1", stage: "won", value: 10 }], total: 1 });
    const r = await listDeals({ branch_id: "b1", owner: "u1" });
    expect(call(f).url).toBe("/api/deals?branch_id=b1&owner=u1");
    expect(r.items[0]!.stage).toBe("won");

    f = stub({ id: "d2", title: "Aircond service", stage: "lead" });
    await createDeal({ title: "  Aircond service ", value: 1234.567, probability: 140, party_id: "p1", expected_close: "" });
    expect(call(f).body).toEqual({ title: "Aircond service", value: 1234.57, probability: 100, party_id: "p1", expected_close: null });

    f = stub({ id: "d2", stage: "lost" });
    await updateDeal("d2", { stage: "lost", lost_reason: " Price too high ", position: 1.5 });
    expect(call(f)).toEqual({ url: "/api/deals/d2", method: "PATCH", body: { stage: "lost", lost_reason: "Price too high", position: 1.5 } });

    f = stub({ lead: { count: 2, value: 300 } });
    expect((await getDealSummary("b1")).lead).toEqual({ count: 2, value: 300 });
    expect(call(f).url).toBe("/api/deals/summary?branch_id=b1");
  });
});

describe("pipeline helpers", () => {
  it("groups by stage in board order and sums each stage", () => {
    const deals = [deal({ id: "a", stage: "proposal", position: 2, value: 100 }), deal({ id: "b", stage: "proposal", position: 1, value: 50 }), deal({ id: "c", stage: "won", value: 7 }), normalizeDeal({ id: "x", stage: "weird" as never })];
    const cols = byStage(deals);
    expect(cols.proposal.map((d) => d.id)).toEqual(["b", "a"]);
    expect(cols.lead.map((d) => d.id)).toEqual(["x"]); // unknown stages start as leads
    expect(summarize(deals).proposal).toEqual({ count: 2, value: 150 });
  });

  it("places a dragged deal between its new neighbours", () => {
    expect(between(1, 2)).toBe(1.5);
    expect(between(undefined, 4)).toBe(3);
    expect(between(4, null)).toBe(5);
    expect(between(null, null)).toBe(0);
    const deals = [deal({ id: "a", stage: "lead", position: 1 }), deal({ id: "b", stage: "qualified", position: 1 }), deal({ id: "c", stage: "qualified", position: 2 })];
    const moved = placeDeal(deals, "a", "qualified", 1)!;
    expect(moved.position).toBe(1.5);
    expect(byStage(moved.deals).qualified.map((d) => d.id)).toEqual(["b", "a", "c"]);
    expect(placeDeal(deals, "a", "won", 9)!.position).toBe(0); // empty column
    expect(placeDeal(deals, "nope", "won", 0)).toBeNull();
  });
});

describe("form helpers", () => {
  it("cleans tags, addresses and primary contacts", () => {
    expect(parseTags("a, b,\nA , ,c")).toEqual(["a", "b", "c"]);
    expect(addressLine({ lines: ["No 1, Jalan Ampang"], city: "Kuala Lumpur", postcode: "50450", state: "W.P. Kuala Lumpur", country: "" })).toBe("No 1, Jalan Ampang, 50450 Kuala Lumpur, W.P. Kuala Lumpur");
    expect(addressLine(null)).toBe("");
    const c = (id: string, is_primary: boolean) => ({ id, name: id, title: "", email: "", phone: "", is_primary, notes: "" });
    expect(primaryOf([c("a", false), c("b", true)])!.id).toBe("b");
    expect(primaryOf([c("a", false)])!.id).toBe("a");
    expect(primaryOf([])).toBeNull();
    expect(cleanParty({ name: "x", tags: [" a ", "a"] }).tags).toEqual(["a"]);
  });

  it("maps each import column to one field at most", () => {
    expect(cleanMapping(["A", "B", "C"], { A: "name", B: "name", C: undefined, D: "email" })).toEqual({ A: "name", B: null, C: null });
  });

  it("builds query strings and works with local days", () => {
    expect(query({ a: "", b: null, c: 0, d: false, e: "x y" })).toBe("?c=0&d=false&e=x+y");
    expect(query({})).toBe("");
    const now = new Date(2026, 9, 16, 15, 0);
    expect(isPast("2026-10-15", now)).toBe(true);
    expect(isPast("2026-10-16", now)).toBe(false);
    expect(isPast(null, now)).toBe(false);
    expect(addDays("2026-10-16", 30)).toBe("2026-11-15");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
