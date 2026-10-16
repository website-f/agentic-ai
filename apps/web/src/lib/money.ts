/**
 * P35 Money: what customers owe the company (receivables: invoices) and what it owes suppliers
 * (payables: bills, often captured from an emailed PDF), payments against them, aging, a cash
 * forecast and payment reminders.
 *
 * Typed calls and small pure helpers only (no React). Needs finance.view to read and
 * finance.manage to change anything. Until the server ships P35 these endpoints answer 404
 * (see `isMissingApi` in ./crm).
 */
import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";

import { locale, msg, useLang, type Lang } from "@/i18n";

import { api } from "./api";
import { asList, parseDay, query, retryUnlessMissing, type ListParams, type ListResult } from "./crm";

// ------------------------------------------------------------------------------------- types

export type MoneyDirection = "receivable" | "payable";
export const MONEY_STATUSES = ["draft", "awaiting_approval", "approved", "sent", "partially_paid", "paid", "void"] as const;
export type MoneyStatus = (typeof MONEY_STATUSES)[number];

export interface MoneyLine {
  description: string;
  qty: number;
  unit_price: number;
  /** Percent, e.g. 8 for SST at 8%. */
  tax_rate: number;
  amount: number;
}

export interface MoneyDoc {
  id: string;
  branch_id: string;
  party_id: string | null;
  party_name: string;
  direction: MoneyDirection;
  number: string;
  reference: string;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  subtotal: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  status: MoneyStatus;
  overdue: boolean;
  days_overdue: number;
  lines: MoneyLine[];
  document_id: string | null;
  file_id: string | null;
  mail_item_id: string | null;
  source: string;
  /** Another bill or invoice this one looks the same as (same supplier, number or amount). */
  duplicate_of: string | null;
  notes: string;
}

export interface Payment {
  id: string;
  amount: number;
  paid_at: string;
  method: string;
  reference: string;
}

export interface MoneyDocDetail extends MoneyDoc {
  payments: Payment[];
}

export interface MoneyDocIn {
  direction: MoneyDirection;
  branch_id: string;
  party_id: string | null;
  issue_date: string;
  due_date: string;
  currency: string;
  reference?: string;
  notes?: string;
  lines: MoneyLine[];
  subtotal?: number;
  tax_total?: number;
  total?: number;
  status?: MoneyStatus;
}

export interface PaymentIn {
  amount: number;
  paid_at: string;
  method: string;
  reference: string;
}

export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export type Aging = Record<AgingBucket, { amount: number; count: number }>;

export interface ForecastWeek {
  week_start: string;
  in: number;
  out: number;
}

export interface MoneySummary {
  receivable_open: number;
  receivable_overdue: number;
  payable_open: number;
  payable_overdue: number;
  due_7d_in: number;
  due_7d_out: number;
  awaiting_approval: number;
}

export interface ReminderSettings {
  enabled: boolean;
  /** Days relative to the due date: -3 is three days before, 7 is a week after. */
  days: number[];
  channel: string;
}

/** A reminder is either an email draft (approved in Mail) or text to copy and send yourself. */
export interface RemindResult {
  draft_id?: string | null;
  text?: string | null;
}

// ------------------------------------------------------------------------------------- formatting

/** "RM 1,250.00" (Intl, en-MY or ms-MY by the UI language); other currencies keep their code. */
export function formatMoney(amount: number | null | undefined, currency = "MYR", lang: Lang = useLang.getState().lang): string {
  const n = Number(amount);
  const value = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat(locale(lang), { style: "currency", currency: currency || "MYR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    // An unknown currency code: the number with the code in front.
    return `${currency} ${new Intl.NumberFormat(locale(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
  }
}

/** Tight spots (deal cards, chart axes): "RM 12.5K", "RM 1.2M". */
export function formatMoneyShort(amount: number | null | undefined, currency = "MYR", lang: Lang = useLang.getState().lang): string {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(locale(lang), { style: "currency", currency: currency || "MYR", notation: "compact", maximumFractionDigits: 1 }).format(n);
  } catch {
    return formatMoney(n, currency, lang);
  }
}

/** "5 Oct 2026" (or "5 Okt 2026" in Malay); date-only strings read as local days. */
export function formatDay(v: string | null | undefined, lang: Lang = useLang.getState().lang): string {
  const d = parseDay(v);
  return d ? d.toLocaleDateString(locale(lang), { day: "numeric", month: "short", year: "numeric" }) : "";
}

// ------------------------------------------------------------------------------------- maths

/** Two decimal places (sen), half away from zero. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A line's amount before tax. */
export const lineAmount = (l: Pick<MoneyLine, "qty" | "unit_price">) => round2((Number(l.qty) || 0) * (Number(l.unit_price) || 0));

/** Subtotal, tax (each line taxed at its own rate) and total. */
export function totals(lines: Pick<MoneyLine, "qty" | "unit_price" | "tax_rate">[]): { subtotal: number; tax_total: number; total: number } {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const amt = lineAmount(l);
    subtotal += amt;
    tax += round2(amt * ((Number(l.tax_rate) || 0) / 100));
  }
  subtotal = round2(subtotal);
  const tax_total = round2(tax);
  return { subtotal, tax_total, total: round2(subtotal + tax_total) };
}

/** What is still owed on a document (never below zero; nothing on a void one). */
export function balanceOf(d: Pick<MoneyDoc, "total" | "amount_paid" | "status">): number {
  if (d.status === "void") return 0;
  return Math.max(0, round2((Number(d.total) || 0) - (Number(d.amount_paid) || 0)));
}

/** SST rates people pick from (service tax 8%, sales tax 5% or 10%, the old 6%); 0 = no tax. */
export const SST_RATES = [0, 5, 6, 8, 10] as const;

/** The lines to send: blank ones dropped, numbers cleaned, each amount worked out. */
export function cleanLines(lines: MoneyLine[]): MoneyLine[] {
  return lines
    .map((l) => ({
      description: l.description.trim(),
      qty: Math.max(0, Number(l.qty) || 0),
      unit_price: round2(Number(l.unit_price) || 0),
      tax_rate: Math.max(0, Number(l.tax_rate) || 0),
      amount: lineAmount(l),
    }))
    .filter((l) => l.description || l.amount);
}

/** Reminder days typed as "-3, 1, 7": numbers only, sorted, no repeats, within a year. */
export function parseDays(v: string): number[] {
  const out = new Set<number>();
  for (const part of v.split(/[,\s;]+/)) {
    if (!part.trim()) continue;
    const n = Number(part.replace(/^\+/, ""));
    if (Number.isInteger(n) && n >= -60 && n <= 365) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** What a finance manager may do with a document right now. */
export function actionsFor(d: Pick<MoneyDoc, "direction" | "status" | "total" | "amount_paid">): {
  approve: boolean;
  pay: boolean;
  void: boolean;
  remind: boolean;
} {
  const open = d.status !== "void" && d.status !== "paid";
  const owed = balanceOf(d) > 0;
  return {
    approve: d.direction === "payable" && (d.status === "awaiting_approval" || d.status === "draft"),
    pay: open && owed && d.status !== "draft" && d.status !== "awaiting_approval",
    void: d.status !== "void" && !(Number(d.amount_paid) > 0),
    remind: d.direction === "receivable" && owed && (d.status === "sent" || d.status === "partially_paid" || d.status === "approved"),
  };
}

/** The tallest bar's value, so bars can be drawn as a share of it (never zero). */
export function scaleMax(weeks: ForecastWeek[]): number {
  return Math.max(1, ...weeks.flatMap((w) => [Number(w.in) || 0, Number(w.out) || 0]));
}

/** Each aging bucket's share of the total, in percent (all zero when nothing is owed). */
export function agingShares(a: Aging): Record<AgingBucket, number> {
  const total = AGING_BUCKETS.reduce((s, b) => s + Math.max(0, Number(a[b]?.amount) || 0), 0);
  return Object.fromEntries(AGING_BUCKETS.map((b) => [b, total ? (Math.max(0, Number(a[b]?.amount) || 0) / total) * 100 : 0])) as Record<AgingBucket, number>;
}

export function normalizeDoc<T extends Partial<MoneyDoc>>(d: T): T & MoneyDoc {
  return {
    ...d,
    id: d.id ?? "",
    branch_id: d.branch_id ?? "",
    party_id: d.party_id ?? null,
    party_name: d.party_name ?? "",
    direction: d.direction === "payable" ? "payable" : "receivable",
    number: d.number ?? "",
    reference: d.reference ?? "",
    issue_date: d.issue_date ?? null,
    due_date: d.due_date ?? null,
    currency: d.currency || "MYR",
    subtotal: Number(d.subtotal) || 0,
    tax_total: Number(d.tax_total) || 0,
    total: Number(d.total) || 0,
    amount_paid: Number(d.amount_paid) || 0,
    status: (MONEY_STATUSES as readonly string[]).includes(d.status ?? "") ? (d.status as MoneyStatus) : "draft",
    overdue: !!d.overdue,
    days_overdue: Number(d.days_overdue) || 0,
    lines: Array.isArray(d.lines) ? d.lines : [],
    document_id: d.document_id ?? null,
    file_id: d.file_id ?? null,
    mail_item_id: d.mail_item_id ?? null,
    source: d.source ?? "",
    duplicate_of: d.duplicate_of ?? null,
    notes: d.notes ?? "",
  };
}

// ------------------------------------------------------------------------------------- labels

export const STATUS_LABEL: Record<MoneyStatus, string> = {
  draft: msg("Draft"),
  awaiting_approval: msg("Awaiting approval"),
  approved: msg("Approved"),
  sent: msg("Sent"),
  partially_paid: msg("Partly paid"),
  paid: msg("Paid"),
  void: msg("Void|status"),
};

export const STATUS_TONE: Record<MoneyStatus, "neutral" | "warn" | "info" | "accent" | "ok" | "danger"> = {
  draft: "neutral",
  awaiting_approval: "warn",
  approved: "info",
  sent: "accent",
  partially_paid: "info",
  paid: "ok",
  void: "neutral",
};

export const AGING_LABEL: Record<AgingBucket, string> = {
  current: msg("Not due yet"),
  d1_30: msg("1–30 days late"),
  d31_60: msg("31–60 days late"),
  d61_90: msg("61–90 days late"),
  d90_plus: msg("Over 90 days late"),
};

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "bank_transfer", label: msg("Bank transfer") },
  { value: "duitnow", label: msg("DuitNow") },
  { value: "fpx", label: msg("FPX") },
  { value: "cash", label: msg("Cash") },
  { value: "cheque", label: msg("Cheque") },
  { value: "card", label: msg("Card") },
  { value: "other", label: msg("Other") },
];

export const REMINDER_CHANNELS: { value: string; label: string; hint: string }[] = [
  { value: "email", label: msg("Email"), hint: msg("A draft in Mail that you approve before it goes.") },
  { value: "whatsapp", label: msg("WhatsApp"), hint: msg("A message you copy and send yourself.") },
];

export const DEFAULT_REMINDERS: ReminderSettings = { enabled: false, days: [-3, 1, 7, 14, 30], channel: "email" };

// ------------------------------------------------------------------------------------- keys

export const moneyKeys = {
  all: ["money"] as const,
  list: (params: ListParams) => ["money", "list", params] as const,
  doc: (id: string) => ["money", "doc", id] as const,
  summary: (branchId?: string) => ["money", "summary", branchId ?? "all"] as const,
  aging: (direction: MoneyDirection, branchId?: string) => ["money", "aging", direction, branchId ?? "all"] as const,
  forecast: (days: number, branchId?: string) => ["money", "forecast", days, branchId ?? "all"] as const,
  reminders: (branchId: string) => ["money", "reminders", branchId] as const,
};

// ------------------------------------------------------------------------------------- API

const enc = encodeURIComponent;

export async function listMoney(params: ListParams = {}): Promise<ListResult<MoneyDoc>> {
  const r = asList(await api<ListResult<MoneyDoc> | MoneyDoc[]>(`/api/money${query(params)}`));
  return { ...r, items: r.items.map(normalizeDoc) };
}

export async function createMoney(body: MoneyDocIn): Promise<MoneyDoc> {
  const lines = cleanLines(body.lines);
  const sums = totals(lines);
  return normalizeDoc(await api<MoneyDoc>("/api/money", "POST", {
    ...body,
    reference: body.reference?.trim() ?? "",
    notes: body.notes?.trim() ?? "",
    lines,
    ...sums,
    status: body.status ?? "draft",
  }));
}

export async function getMoney(id: string): Promise<MoneyDocDetail> {
  const r = await api<Partial<MoneyDocDetail> & { doc?: MoneyDoc }>(`/api/money/${enc(id)}`);
  // Either the document's own fields with payments beside them, or {doc, payments}.
  const doc = normalizeDoc({ ...(r.doc ?? r) });
  return { ...doc, payments: Array.isArray(r.payments) ? r.payments : [] };
}

export const updateMoney = async (id: string, body: Partial<MoneyDocIn>) => {
  const patch: Partial<MoneyDocIn> = { ...body };
  if (body.lines) {
    patch.lines = cleanLines(body.lines);
    Object.assign(patch, totals(patch.lines));
  }
  return normalizeDoc(await api<MoneyDoc>(`/api/money/${enc(id)}`, "PATCH", patch));
};

export const markMoneySent = (id: string) => api<MoneyDoc>(`/api/money/${enc(id)}/sent`, "POST");

export const approveMoney = (id: string) => api<MoneyDoc>(`/api/money/${enc(id)}/approve`, "POST");

export const recordPayment = (id: string, p: PaymentIn) =>
  api<Payment>(`/api/money/${enc(id)}/payments`, "POST", { amount: round2(Number(p.amount) || 0), paid_at: p.paid_at, method: p.method, reference: p.reference.trim() });

export const voidMoney = (id: string, reason: string) => api<MoneyDoc>(`/api/money/${enc(id)}/void`, "POST", { reason: reason.trim() });

export const remindMoney = (id: string) => api<RemindResult>(`/api/money/${enc(id)}/remind`, "POST");

/** Read a bill from a Library file (a supplier's PDF or photo); answers with the new draft bill. */
export const captureBill = async (fileId: string, branchId: string) =>
  normalizeDoc(await api<MoneyDoc>("/api/money/capture", "POST", { file_id: fileId, branch_id: branchId }));

export async function getAging(direction: MoneyDirection, branchId?: string): Promise<Aging> {
  const r = await api<Partial<Aging>>(`/api/money/aging${query({ direction, branch_id: branchId })}`);
  return Object.fromEntries(AGING_BUCKETS.map((b) => [b, { amount: Number(r?.[b]?.amount) || 0, count: Number(r?.[b]?.count) || 0 }])) as Aging;
}

export async function getForecast(days: number, branchId?: string): Promise<ForecastWeek[]> {
  const r = await api<ForecastWeek[] | { items: ForecastWeek[] }>(`/api/money/forecast${query({ branch_id: branchId, days })}`);
  const list = Array.isArray(r) ? r : (r?.items ?? []);
  return list.map((w) => ({ week_start: w.week_start, in: Number(w.in) || 0, out: Number(w.out) || 0 }));
}

export async function getSummary(branchId?: string): Promise<MoneySummary> {
  const r = await api<Partial<MoneySummary>>(`/api/money/summary${query({ branch_id: branchId })}`);
  const n = (k: keyof MoneySummary) => Number(r?.[k]) || 0;
  return {
    receivable_open: n("receivable_open"),
    receivable_overdue: n("receivable_overdue"),
    payable_open: n("payable_open"),
    payable_overdue: n("payable_overdue"),
    due_7d_in: n("due_7d_in"),
    due_7d_out: n("due_7d_out"),
    awaiting_approval: n("awaiting_approval"),
  };
}

export async function getReminders(branchId: string): Promise<ReminderSettings> {
  const r = await api<Partial<ReminderSettings>>(`/api/branches/${enc(branchId)}/reminders`);
  return {
    enabled: typeof r?.enabled === "boolean" ? r.enabled : DEFAULT_REMINDERS.enabled,
    days: Array.isArray(r?.days) ? parseDays(r.days.join(",")) : DEFAULT_REMINDERS.days,
    channel: r?.channel || DEFAULT_REMINDERS.channel,
  };
}

export const saveReminders = (branchId: string, s: ReminderSettings) =>
  api<ReminderSettings>(`/api/branches/${enc(branchId)}/reminders`, "PUT", { enabled: s.enabled, days: parseDays(s.days.join(",")), channel: s.channel });

// ------------------------------------------------------------------------------------- queries

export const MONEY_PAGE = 50;

export const moneyListQuery = (params: ListParams) =>
  infiniteQueryOptions({
    queryKey: moneyKeys.list(params),
    queryFn: ({ pageParam }) => listMoney({ ...params, limit: MONEY_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length >= MONEY_PAGE && loaded < last.total ? loaded : undefined;
    },
    retry: retryUnlessMissing,
    placeholderData: keepPreviousData,
  });

/** One contact's documents (both directions), for its Money tab. */
export const partyMoneyQuery = (partyId: string) =>
  queryOptions({ queryKey: moneyKeys.list({ party_id: partyId, all: 1 }), queryFn: () => listMoney({ party_id: partyId, limit: 100 }), retry: retryUnlessMissing });

export const moneyDocQuery = (id: string) =>
  queryOptions({ queryKey: moneyKeys.doc(id), queryFn: () => getMoney(id), retry: retryUnlessMissing });

export const moneySummaryQuery = (branchId?: string) =>
  queryOptions({ queryKey: moneyKeys.summary(branchId), queryFn: () => getSummary(branchId), retry: retryUnlessMissing });

export const agingQuery = (direction: MoneyDirection, branchId?: string) =>
  queryOptions({ queryKey: moneyKeys.aging(direction, branchId), queryFn: () => getAging(direction, branchId), retry: retryUnlessMissing, placeholderData: keepPreviousData });

export const forecastQuery = (days: number, branchId?: string) =>
  queryOptions({ queryKey: moneyKeys.forecast(days, branchId), queryFn: () => getForecast(days, branchId), retry: retryUnlessMissing, placeholderData: keepPreviousData });

export const remindersQuery = (branchId: string) =>
  queryOptions({ queryKey: moneyKeys.reminders(branchId), queryFn: () => getReminders(branchId), retry: retryUnlessMissing });
