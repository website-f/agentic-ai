import { afterEach, describe, expect, it, vi } from "vitest";

import {
  actionsFor,
  agingShares,
  approveMoney,
  balanceOf,
  captureBill,
  cleanLines,
  createMoney,
  formatDay,
  formatMoney,
  getAging,
  getForecast,
  getMoney,
  getReminders,
  getSummary,
  listMoney,
  moneyKeys,
  moneyListQuery,
  parseDays,
  recordPayment,
  remindMoney,
  saveReminders,
  scaleMax,
  totals,
  updateMoney,
  voidMoney,
} from "./money";

function stub(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const call = (f: ReturnType<typeof stub>, i = 0) => {
  const init = f.mock.calls[i]![1] as RequestInit;
  return { url: f.mock.calls[i]![0] as string, method: (init.method ?? "GET") as string, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined };
};
const norm = (s: string) => s.replace(/\s/g, " ");

describe("money formatting", () => {
  it("writes ringgit with thousands separators in both languages", () => {
    expect(norm(formatMoney(1234567.5, "MYR", "en"))).toBe("RM 1,234,567.50");
    expect(norm(formatMoney(1234567.5, "MYR", "ms"))).toBe("RM 1,234,567.50");
    expect(norm(formatMoney(null, "MYR", "en"))).toBe("RM 0.00");
    expect(formatMoney(10, "XYZ1", "en")).toBe("XYZ1 10.00"); // not a currency code: still readable
  });

  it("writes dates the Malaysian way, by language", () => {
    expect(formatDay("2026-10-05", "en")).toBe("5 Oct 2026");
    expect(formatDay("2026-10-05", "ms")).toBe("5 Okt 2026");
    expect(formatDay(null, "en")).toBe("");
  });
});

describe("money maths", () => {
  it("adds lines up with SST per line, to the sen", () => {
    expect(totals([{ qty: 3, unit_price: 33.33, tax_rate: 8 }, { qty: 1, unit_price: 100, tax_rate: 0 }])).toEqual({ subtotal: 199.99, tax_total: 8, total: 207.99 });
    expect(totals([])).toEqual({ subtotal: 0, tax_total: 0, total: 0 });
  });

  it("drops blank lines and works out each amount", () => {
    expect(cleanLines([
      { description: " Service ", qty: 2, unit_price: 150.005, tax_rate: 8, amount: 0 },
      { description: "", qty: 0, unit_price: 0, tax_rate: 0, amount: 0 },
    ])).toEqual([{ description: "Service", qty: 2, unit_price: 150.01, tax_rate: 8, amount: 300.01 }]);
  });

  it("knows the balance and what may be done next", () => {
    expect(balanceOf({ total: 100, amount_paid: 40, status: "partially_paid" })).toBe(60);
    expect(balanceOf({ total: 100, amount_paid: 140, status: "paid" })).toBe(0);
    expect(balanceOf({ total: 100, amount_paid: 0, status: "void" })).toBe(0);
    expect(actionsFor({ direction: "payable", status: "awaiting_approval", total: 100, amount_paid: 0 })).toEqual({ approve: true, pay: false, void: true, remind: false });
    expect(actionsFor({ direction: "payable", status: "approved", total: 100, amount_paid: 0 })).toEqual({ approve: false, pay: true, void: true, remind: false });
    expect(actionsFor({ direction: "receivable", status: "sent", total: 100, amount_paid: 20 })).toEqual({ approve: false, pay: true, void: false, remind: true });
    expect(actionsFor({ direction: "receivable", status: "paid", total: 100, amount_paid: 100 })).toEqual({ approve: false, pay: false, void: false, remind: false });
  });

  it("reads reminder days and scales charts", () => {
    expect(parseDays("7, -3 1 +14;14, x, 400, 1.5")).toEqual([-3, 1, 7, 14]);
    expect(scaleMax([])).toBe(1);
    expect(scaleMax([{ week_start: "2026-10-12", in: 10, out: 30 }])).toBe(30);
    const shares = agingShares({ current: { amount: 50, count: 1 }, d1_30: { amount: 50, count: 1 }, d31_60: { amount: 0, count: 0 }, d61_90: { amount: 0, count: 0 }, d90_plus: { amount: 0, count: 0 } });
    expect(shares.current).toBe(50);
    expect(agingShares({ current: { amount: 0, count: 0 }, d1_30: { amount: 0, count: 0 }, d31_60: { amount: 0, count: 0 }, d61_90: { amount: 0, count: 0 }, d90_plus: { amount: 0, count: 0 } }).d1_30).toBe(0);
  });
});

describe("the money API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists documents with filters and pages by offset", async () => {
    const f = stub({ items: [{ id: "m1", direction: "payable", total: "250.50", status: "weird" }], total: 1 });
    const r = await listMoney({ direction: "payable", status: "", overdue: true, q: "tnb" });
    expect(call(f).url).toBe("/api/money?direction=payable&overdue=true&q=tnb");
    expect(r.items[0]).toMatchObject({ total: 250.5, status: "draft", lines: [], currency: "MYR" });
    expect(moneyListQuery({}).queryKey.slice(0, 1)).toEqual([...moneyKeys.all]); // money.updated refreshes every list
  });

  it("creates an invoice with its totals worked out", async () => {
    const f = stub({ id: "m2" });
    await createMoney({ direction: "receivable", branch_id: "b1", party_id: "p1", issue_date: "2026-10-16", due_date: "2026-11-15", currency: "MYR", reference: " PO-7 ",
      lines: [{ description: "Install", qty: 1, unit_price: 1000, tax_rate: 8, amount: 0 }] });
    expect(call(f)).toMatchObject({ url: "/api/money", method: "POST" });
    expect(call(f).body).toMatchObject({ direction: "receivable", status: "draft", reference: "PO-7", subtotal: 1000, tax_total: 80, total: 1080, lines: [{ amount: 1000 }] });
  });

  it("reads one document with its payments, flat or wrapped", async () => {
    stub({ id: "m1", total: 100, payments: [{ id: "pay1", amount: 40 }] });
    expect((await getMoney("m1")).payments).toHaveLength(1);
    stub({ doc: { id: "m1", total: 100 } });
    const d = await getMoney("m1");
    expect(d.total).toBe(100);
    expect(d.payments).toEqual([]);
  });

  it("edits, approves, pays, voids and reminds", async () => {
    let f = stub({ id: "m1" });
    await updateMoney("m1", { lines: [{ description: "A", qty: 2, unit_price: 5, tax_rate: 0, amount: 0 }] });
    expect(call(f).body).toMatchObject({ subtotal: 10, total: 10 });
    f = stub({ id: "m1" });
    await approveMoney("m1");
    expect(call(f)).toMatchObject({ url: "/api/money/m1/approve", method: "POST" });
    f = stub({ id: "pay" });
    await recordPayment("m1", { amount: 99.999, paid_at: "2026-10-16", method: "duitnow", reference: " ref " });
    expect(call(f)).toEqual({ url: "/api/money/m1/payments", method: "POST", body: { amount: 100, paid_at: "2026-10-16", method: "duitnow", reference: "ref" } });
    f = stub({ id: "m1" });
    await voidMoney("m1", " Entered twice ");
    expect(call(f).body).toEqual({ reason: "Entered twice" });
    f = stub({ draft_id: "dr1" });
    expect(await remindMoney("m1")).toEqual({ draft_id: "dr1" });
    expect(call(f)).toMatchObject({ url: "/api/money/m1/remind", method: "POST" });
  });

  it("captures a bill from a Library file", async () => {
    const f = stub({ id: "m9", direction: "payable", status: "awaiting_approval" });
    const d = await captureBill("f1", "b1");
    expect(call(f)).toEqual({ url: "/api/money/capture", method: "POST", body: { file_id: "f1", branch_id: "b1" } });
    expect(d.direction).toBe("payable");
  });

  it("reads aging, forecast and the summary, filling gaps with zero", async () => {
    let f = stub({ current: { amount: 100, count: 2 }, d90_plus: { amount: "50", count: 1 } });
    const a = await getAging("receivable", "b1");
    expect(call(f).url).toBe("/api/money/aging?direction=receivable&branch_id=b1");
    expect(a.d90_plus).toEqual({ amount: 50, count: 1 });
    expect(a.d31_60).toEqual({ amount: 0, count: 0 });

    f = stub([{ week_start: "2026-10-12", in: "10", out: null }]);
    expect(await getForecast(30)).toEqual([{ week_start: "2026-10-12", in: 10, out: 0 }]);
    expect(call(f).url).toBe("/api/money/forecast?days=30");

    stub({ receivable_open: 1000, awaiting_approval: 2 });
    const s = await getSummary();
    expect(s.receivable_open).toBe(1000);
    expect(s.payable_overdue).toBe(0);
  });

  it("reads and saves a company's payment reminders", async () => {
    let f = stub({ enabled: true, days: [7, -3, 7] });
    expect(await getReminders("b1")).toEqual({ enabled: true, days: [-3, 7], channel: "email" });
    expect(call(f).url).toBe("/api/branches/b1/reminders");
    f = stub({ enabled: false, days: [], channel: "email" });
    await saveReminders("b1", { enabled: true, days: [30, 1, 1], channel: "whatsapp" });
    expect(call(f)).toEqual({ url: "/api/branches/b1/reminders", method: "PUT", body: { enabled: true, days: [1, 30], channel: "whatsapp" } });
  });
});
