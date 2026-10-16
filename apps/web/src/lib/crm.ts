/**
 * P35 Business: contacts (customers, suppliers, partners and leads, called parties) and the
 * sales pipeline (deals).
 *
 * Typed calls and small pure helpers only (no React), so screens and tests share them. Until
 * the server ships P35 these endpoints answer 404: `isMissingApi` lets each screen show an
 * "update the server" notice instead of an error. Lists take q, filters and limit/offset and
 * answer {items, total}; a bare array is accepted too.
 */
import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";

import { msg, t } from "@/i18n";

import { api, ApiError, langHeader, readCookie } from "./api";

// ------------------------------------------------------------------------------------- types

export type PartyKind = "company" | "person";
export const PARTY_ROLES = ["customer", "supplier", "partner", "lead"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];
export type PartyStatus = "active" | "archived";

export interface Address {
  lines: string[];
  city: string;
  postcode: string;
  state: string;
  country: string;
}

export interface Contact {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  is_primary: boolean;
  notes: string;
}

export interface PartyBalances {
  receivable_open: number;
  payable_open: number;
  overdue: number;
}

export interface Party {
  id: string;
  kind: PartyKind;
  roles: PartyRole[];
  name: string;
  legal_name: string;
  /** SSM registration number. */
  reg_no: string;
  /** LHDN tax identification number. */
  tin: string;
  sst_no: string;
  industry: string;
  email: string;
  phone: string;
  website: string;
  address: Address;
  currency: string;
  payment_terms_days: number | null;
  credit_limit: number | null;
  tags: string[];
  notes: string;
  owner_user_id: string | null;
  status: PartyStatus;
  source: string;
  branch_id: string;
  branch_name: string;
  primary_contact?: Contact | null;
  balances?: PartyBalances | null;
}

export type PartyIn = Partial<Omit<Party, "id" | "primary_contact" | "balances" | "branch_name" | "status">> & {
  /** On create: the first contact person (optional). */
  contact?: Partial<Omit<Contact, "id">>;
};

export type ContactIn = Partial<Omit<Contact, "id">>;

export const DEAL_STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export interface Deal {
  id: string;
  branch_id: string;
  party_id: string;
  party_name: string;
  title: string;
  value: number;
  currency: string;
  stage: DealStage;
  probability: number | null;
  expected_close: string | null;
  owner_user_id: string | null;
  agent_id: string | null;
  source: string;
  next_step: string;
  next_step_due: string | null;
  lost_reason: string;
  position: number | null;
}

export type DealIn = Partial<Omit<Deal, "id" | "party_name">>;

export type DealSummary = Partial<Record<DealStage, { count: number; value: number }>>;

/** The money summary on a contact's page (amounts in the company's currency). */
export interface PartyMoney {
  receivable_open: number;
  payable_open: number;
  overdue: number;
}

export interface PartyDetail extends Party {
  contacts: Contact[];
  deals: Deal[];
  money: PartyMoney | null;
}

export const TIMELINE_KINDS = ["email_in", "email_out", "note", "call", "meeting", "task", "document", "invoice", "payment", "deal"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export interface TimelineLinks {
  task_id?: string | null;
  document_id?: string | null;
  money_doc_id?: string | null;
  deal_id?: string | null;
  mail_item_id?: string | null;
}

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  summary: string;
  at: string;
  actor: string | null;
  links: TimelineLinks;
}

export interface ImportPreview {
  rows: Record<string, unknown>[];
  columns: string[];
  /** The server's suggestion: which Party field each column fills (null = skip it). */
  mapping: Record<string, string | null>;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
}

export interface DuplicateGroup {
  reason: string;
  parties: Party[];
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

export type ListParams = Record<string, string | number | boolean | null | undefined>;

// ------------------------------------------------------------------------------------- helpers

/** Not on this server yet (P35 not deployed): show "update the server", not an error. Only a
 * route the server does not know (a bare 404 without a code); "money_not_found" and the like
 * mean the record is gone, which is an ordinary error. */
export function isMissingApi(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && !/_not_found$/.test(err.code);
}

/** One quick retry for real failures; none for a 404 or 403 (the notice shows at once). */
export const retryUnlessMissing = (count: number, err: unknown) =>
  !isMissingApi(err) && !(err instanceof ApiError && err.status === 403) && count < 1;

/** "?q=x&role=customer&limit=50": empty values are left out. */
export function query(params: ListParams = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** {items, total} or a bare array, both read the same. */
export function asList<T>(r: ListResult<T> | T[] | null | undefined): ListResult<T> {
  if (Array.isArray(r)) return { items: r, total: r.length };
  const items = Array.isArray(r?.items) ? r.items : [];
  return { items, total: typeof r?.total === "number" ? r.total : items.length };
}

const EMPTY_ADDRESS: Address = { lines: [], city: "", postcode: "", state: "", country: "" };

/** Fills what an older or partial answer left out, so screens never check for undefined. */
export function normalizeParty<T extends Partial<Party>>(p: T): T & Party {
  const roles = Array.isArray(p.roles) ? p.roles.filter((r): r is PartyRole => (PARTY_ROLES as readonly string[]).includes(r)) : [];
  return {
    ...p,
    id: p.id ?? "",
    kind: p.kind === "person" ? "person" : "company",
    roles,
    name: p.name ?? "",
    legal_name: p.legal_name ?? "",
    reg_no: p.reg_no ?? "",
    tin: p.tin ?? "",
    sst_no: p.sst_no ?? "",
    industry: p.industry ?? "",
    email: p.email ?? "",
    phone: p.phone ?? "",
    website: p.website ?? "",
    address: { ...EMPTY_ADDRESS, ...(p.address ?? {}), lines: Array.isArray(p.address?.lines) ? p.address.lines : [] },
    currency: p.currency || "MYR",
    payment_terms_days: typeof p.payment_terms_days === "number" ? p.payment_terms_days : null,
    credit_limit: typeof p.credit_limit === "number" ? p.credit_limit : null,
    tags: Array.isArray(p.tags) ? p.tags : [],
    notes: p.notes ?? "",
    owner_user_id: p.owner_user_id ?? null,
    status: p.status === "archived" ? "archived" : "active",
    source: p.source ?? "",
    branch_id: p.branch_id ?? "",
    branch_name: p.branch_name ?? "",
  };
}

export function normalizeDeal(d: Partial<Deal>): Deal {
  return {
    id: d.id ?? "",
    branch_id: d.branch_id ?? "",
    party_id: d.party_id ?? "",
    party_name: d.party_name ?? "",
    title: d.title ?? "",
    value: Number(d.value) || 0,
    currency: d.currency || "MYR",
    stage: (DEAL_STAGES as readonly string[]).includes(d.stage ?? "") ? (d.stage as DealStage) : "lead",
    probability: typeof d.probability === "number" ? d.probability : null,
    expected_close: d.expected_close ?? null,
    owner_user_id: d.owner_user_id ?? null,
    agent_id: d.agent_id ?? null,
    source: d.source ?? "",
    next_step: d.next_step ?? "",
    next_step_due: d.next_step_due ?? null,
    lost_reason: d.lost_reason ?? "",
    position: typeof d.position === "number" ? d.position : null,
  };
}

/** Comma- or line-separated tags: trimmed, no repeats (case-insensitive), no blanks. */
export function parseTags(v: string | string[]): string[] {
  const parts = Array.isArray(v) ? v : v.split(/[,\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

/** What a create or edit form sends: trimmed text, tags cleaned, empty address lines dropped. */
export function cleanParty(body: PartyIn): PartyIn {
  const out: PartyIn = {};
  for (const [k, v] of Object.entries(body) as [keyof PartyIn, unknown][]) {
    if (typeof v === "string") (out as Record<string, unknown>)[k] = v.trim();
    else (out as Record<string, unknown>)[k] = v;
  }
  if (body.name !== undefined) out.name = body.name.trim().replace(/\s+/g, " ");
  if (body.email !== undefined) out.email = body.email.trim().toLowerCase();
  if (body.tin !== undefined) out.tin = body.tin.trim().toUpperCase().replace(/\s+/g, "");
  if (body.tags !== undefined) out.tags = parseTags(body.tags);
  if (body.roles !== undefined) out.roles = [...new Set(body.roles)];
  if (body.address) {
    out.address = {
      lines: (body.address.lines ?? []).map((l) => l.trim()).filter(Boolean),
      city: (body.address.city ?? "").trim(),
      postcode: (body.address.postcode ?? "").trim(),
      state: (body.address.state ?? "").trim(),
      country: (body.address.country ?? "").trim(),
    };
  }
  if (body.contact) {
    const c = body.contact;
    const name = (c.name ?? "").trim();
    if (name) out.contact = { name, title: (c.title ?? "").trim(), email: (c.email ?? "").trim().toLowerCase(), phone: (c.phone ?? "").trim(), is_primary: true };
    else delete out.contact;
  }
  return out;
}

/** "12 Jalan Ampang, 50450 Kuala Lumpur, Wilayah Persekutuan" (empty parts skipped). */
export function addressLine(a: Address | null | undefined): string {
  if (!a) return "";
  const town = [a.postcode, a.city].filter(Boolean).join(" ");
  return [...(a.lines ?? []), town, a.state, a.country].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
}

/** The contact person to show on a row: the primary one, else the first. */
export function primaryOf(contacts: Contact[] | undefined | null): Contact | null {
  if (!contacts?.length) return null;
  return contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
}

/** The new position between two neighbours (order is position ascending). */
export function between(before: number | null | undefined, after: number | null | undefined): number {
  const b = typeof before === "number" ? before : null;
  const a = typeof after === "number" ? after : null;
  if (b !== null && a !== null) return (a + b) / 2;
  if (a !== null) return a - 1;
  if (b !== null) return b + 1;
  return 0;
}

/** Deals grouped into the pipeline's columns, each in board order (position, then title). */
export function byStage(deals: Deal[]): Record<DealStage, Deal[]> {
  const out = Object.fromEntries(DEAL_STAGES.map((s) => [s, [] as Deal[]])) as Record<DealStage, Deal[]>;
  for (const d of deals) out[d.stage]?.push(d);
  for (const s of DEAL_STAGES) {
    out[s].sort((x, y) => (x.position ?? Number.MAX_SAFE_INTEGER) - (y.position ?? Number.MAX_SAFE_INTEGER) || x.title.localeCompare(y.title));
  }
  return out;
}

/** Count and value per stage from the deals on screen (when the server summary is missing). */
export function summarize(deals: Deal[]): Record<DealStage, { count: number; value: number }> {
  const out = Object.fromEntries(DEAL_STAGES.map((s) => [s, { count: 0, value: 0 }])) as Record<DealStage, { count: number; value: number }>;
  for (const d of deals) {
    const s = out[d.stage];
    if (!s) continue;
    s.count += 1;
    s.value += d.value;
  }
  return out;
}

/** A deal moved to `stage` at `index` among that column's deals (itself left out). */
export function placeDeal(deals: Deal[], id: string, stage: DealStage, index: number): { deals: Deal[]; position: number } | null {
  const moving = deals.find((d) => d.id === id);
  if (!moving) return null;
  const column = byStage(deals.filter((d) => d.id !== id))[stage];
  const at = Math.max(0, Math.min(index, column.length));
  const position = between(column[at - 1]?.position, column[at]?.position);
  const moved: Deal = { ...moving, stage, position };
  return { deals: deals.map((d) => (d.id === id ? moved : d)), position };
}

/** Is a "next step due" date past (date-only strings compare by local day)? */
export function isPast(day: string | null | undefined, now: Date = new Date()): boolean {
  if (!day) return false;
  const d = parseDay(day);
  if (!d) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d.getTime() < today.getTime();
}

/** "2026-10-16" as a local date (not UTC midnight); full ISO timestamps as given. */
export function parseDay(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Today (or `d`) as "YYYY-MM-DD" in local time, for date inputs. */
export function isoDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A day plus n days, "YYYY-MM-DD". */
export function addDays(day: string, n: number): string {
  const d = parseDay(day) ?? new Date();
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

// ------------------------------------------------------------------------------------- labels

export const ROLE_LABEL: Record<PartyRole, string> = {
  customer: msg("Customer"),
  supplier: msg("Supplier"),
  partner: msg("Partner"),
  lead: msg("Lead|contact"),
};

export const ROLE_TONE: Record<PartyRole, "accent" | "info" | "ok" | "warn"> = {
  customer: "accent",
  supplier: "info",
  partner: "ok",
  lead: "warn",
};

export const KIND_LABEL: Record<PartyKind, string> = {
  company: msg("Company|contact"),
  person: msg("Person"),
};

export const STAGE_LABEL: Record<DealStage, string> = {
  lead: msg("Lead|deal"),
  qualified: msg("Qualified"),
  proposal: msg("Proposal"),
  negotiation: msg("Negotiation"),
  won: msg("Won"),
  lost: msg("Lost"),
};

export const STAGE_HINT: Record<DealStage, string> = {
  lead: msg("Just came in"),
  qualified: msg("A real need, worth chasing"),
  proposal: msg("Quote or proposal sent"),
  negotiation: msg("Agreeing the terms"),
  won: msg("Signed or paid"),
  lost: msg("Did not go ahead"),
};

export const STAGE_TONE: Record<DealStage, "neutral" | "info" | "accent" | "warn" | "ok" | "danger"> = {
  lead: "neutral",
  qualified: "info",
  proposal: "accent",
  negotiation: "warn",
  won: "ok",
  lost: "danger",
};

/** Default chance of winning per stage, for a new deal or a stage change. */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  lead: 10,
  qualified: 25,
  proposal: 50,
  negotiation: 75,
  won: 100,
  lost: 0,
};

export const TIMELINE_LABEL: Record<TimelineKind, string> = {
  email_in: msg("Email received"),
  email_out: msg("Email sent"),
  note: msg("Note"),
  call: msg("Call"),
  meeting: msg("Meeting"),
  task: msg("Task"),
  document: msg("Document"),
  invoice: msg("Invoice"),
  payment: msg("Payment"),
  deal: msg("Deal"),
};

/** Fields an imported column can fill (the server may suggest others; they are kept). */
export const IMPORT_FIELDS: { value: string; label: string }[] = [
  { value: "name", label: msg("Name") },
  { value: "kind", label: msg("Company or person") },
  { value: "roles", label: msg("Roles") },
  { value: "legal_name", label: msg("Registered name") },
  { value: "reg_no", label: msg("SSM number") },
  { value: "tin", label: msg("TIN") },
  { value: "sst_no", label: msg("SST number") },
  { value: "industry", label: msg("Industry") },
  { value: "email", label: msg("Email") },
  { value: "phone", label: msg("Phone") },
  { value: "website", label: msg("Website") },
  { value: "address", label: msg("Address") },
  { value: "city", label: msg("City") },
  { value: "postcode", label: msg("Postcode") },
  { value: "state", label: msg("State") },
  { value: "country", label: msg("Country") },
  { value: "currency", label: msg("Currency") },
  { value: "payment_terms_days", label: msg("Payment terms (days)") },
  { value: "credit_limit", label: msg("Credit limit") },
  { value: "tags", label: msg("Tags") },
  { value: "notes", label: msg("Notes") },
  { value: "contact_name", label: msg("Contact person") },
  { value: "contact_email", label: msg("Contact email") },
  { value: "contact_phone", label: msg("Contact phone") },
];

/** The column→field mapping to send: unknown columns dropped, each field used at most once. */
export function cleanMapping(columns: string[], mapping: Record<string, string | null | undefined>): Record<string, string | null> {
  const used = new Set<string>();
  const out: Record<string, string | null> = {};
  for (const c of columns) {
    const f = mapping[c];
    if (f && !used.has(f)) {
      used.add(f);
      out[c] = f;
    } else out[c] = null;
  }
  return out;
}

/** Malaysian states and federal territories, for the address form. */
export const MY_STATES = [
  "Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Perak", "Perlis", "Pulau Pinang",
  "Sabah", "Sarawak", "Selangor", "Terengganu", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya",
];

// ------------------------------------------------------------------------------------- keys

export const partyKeys = {
  all: ["parties"] as const,
  list: (params: ListParams) => ["parties", "list", params] as const,
  detail: (id: string) => ["parties", "detail", id] as const,
  timeline: (id: string) => ["parties", "timeline", id] as const,
  duplicates: ["parties", "duplicates"] as const,
};

export const dealKeys = {
  all: ["deals"] as const,
  list: (params: ListParams) => ["deals", "list", params] as const,
  summary: (branchId: string | undefined) => ["deals", "summary", branchId ?? "all"] as const,
};

// ------------------------------------------------------------------------------------- parties

export async function listParties(params: ListParams = {}): Promise<ListResult<Party>> {
  const r = asList(await api<ListResult<Party> | Party[]>(`/api/parties${query(params)}`));
  return { ...r, items: r.items.map(normalizeParty) };
}

export const createParty = async (body: PartyIn) => normalizeParty(await api<Party>("/api/parties", "POST", cleanParty(body)));

export async function getParty(id: string): Promise<PartyDetail> {
  const r = await api<Partial<PartyDetail> & { party?: Party }>(`/api/parties/${encodeURIComponent(id)}`);
  // Either the party's own fields with contacts/deals/money beside them, or {party, …}.
  const base = normalizeParty({ ...(r.party ?? r) });
  const contacts = Array.isArray(r.contacts) ? r.contacts : base.primary_contact ? [base.primary_contact] : [];
  const deals = Array.isArray(r.deals) ? r.deals.map(normalizeDeal) : [];
  const money = r.money ?? (base.balances ? { ...base.balances } : null);
  return { ...base, contacts, deals, money };
}

export const updateParty = async (id: string, body: PartyIn) =>
  normalizeParty(await api<Party>(`/api/parties/${encodeURIComponent(id)}`, "PATCH", cleanParty(body)));

export const archiveParty = (id: string) => api<Party>(`/api/parties/${encodeURIComponent(id)}/archive`, "POST");

export const addContact = (partyId: string, body: ContactIn) =>
  api<Contact>(`/api/parties/${encodeURIComponent(partyId)}/contacts`, "POST", cleanContact(body));

export const updateContact = (id: string, body: ContactIn) =>
  api<Contact>(`/api/party-contacts/${encodeURIComponent(id)}`, "PATCH", cleanContact(body));

export const deleteContact = (id: string) => api<void>(`/api/party-contacts/${encodeURIComponent(id)}`, "DELETE");

function cleanContact(body: ContactIn): ContactIn {
  const out: ContactIn = { ...body };
  for (const k of ["name", "title", "phone", "notes"] as const) if (typeof out[k] === "string") out[k] = out[k].trim();
  if (typeof out.email === "string") out.email = out.email.trim().toLowerCase();
  return out;
}

export async function getTimeline(id: string, limit = 50): Promise<TimelineItem[]> {
  const r = await api<TimelineItem[] | { items: TimelineItem[] }>(`/api/parties/${encodeURIComponent(id)}/timeline${query({ limit })}`);
  const list = Array.isArray(r) ? r : (r?.items ?? []);
  return list.map((i) => ({ ...i, links: i.links ?? {} }));
}

export const addNote = (id: string, text: string) => api<TimelineItem>(`/api/parties/${encodeURIComponent(id)}/notes`, "POST", { text: text.trim() });

/** Upload a spreadsheet (CSV or Excel) and get its rows back with a suggested column mapping. */
export async function importPreview(file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file);
  let res: Response;
  try {
    res = await fetch("/api/parties/import", {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": readCookie("agentic_csrf"), ...langHeader() },
      body: form,
    });
  } catch {
    throw new ApiError(0, "network", t("Could not reach the server. Check that the stack is running."));
  }
  const data = (await res.json().catch(() => null)) as (ImportPreview & { code?: string; message?: string; fields?: Record<string, string> }) | null;
  if (!res.ok) throw new ApiError(res.status, data?.code ?? "http_error", data?.message ?? t("Request failed ({status}).", { status: res.status }), data?.fields ?? {});
  const columns = Array.isArray(data?.columns) ? data.columns : [];
  return { columns, rows: Array.isArray(data?.rows) ? data.rows : [], mapping: cleanMapping(columns, data?.mapping ?? {}) };
}

export const importCommit = (mapping: Record<string, string | null>, rows: Record<string, unknown>[]) =>
  api<ImportResult>("/api/parties/import/commit", "POST", { mapping, rows });

export async function getDuplicates(): Promise<DuplicateGroup[]> {
  const r = await api<DuplicateGroup[] | { items: DuplicateGroup[] }>("/api/parties/duplicates");
  const list = Array.isArray(r) ? r : (r?.items ?? []);
  return list.map((g) => ({ reason: g.reason ?? "", parties: (g.parties ?? []).map(normalizeParty) })).filter((g) => g.parties.length > 1);
}

// ------------------------------------------------------------------------------------- deals

export async function listDeals(params: ListParams = {}): Promise<ListResult<Deal>> {
  const r = asList(await api<ListResult<Deal> | Deal[]>(`/api/deals${query(params)}`));
  return { ...r, items: r.items.map(normalizeDeal) };
}

export const createDeal = async (body: DealIn) => normalizeDeal(await api<Deal>("/api/deals", "POST", cleanDeal(body)));

export const updateDeal = async (id: string, body: DealIn) =>
  normalizeDeal(await api<Deal>(`/api/deals/${encodeURIComponent(id)}`, "PATCH", cleanDeal(body)));

export const getDealSummary = (branchId?: string) => api<DealSummary>(`/api/deals/summary${query({ branch_id: branchId })}`);

function cleanDeal(body: DealIn): DealIn {
  const out: DealIn = { ...body };
  for (const k of ["title", "next_step", "lost_reason", "source"] as const) if (typeof out[k] === "string") out[k] = out[k].trim();
  if (out.value !== undefined) out.value = Math.max(0, Math.round(Number(out.value) * 100) / 100 || 0);
  if (out.probability !== undefined && out.probability !== null) out.probability = Math.max(0, Math.min(100, Math.round(Number(out.probability)) || 0));
  if (out.expected_close === "") out.expected_close = null;
  if (out.next_step_due === "") out.next_step_due = null;
  return out;
}

// ------------------------------------------------------------------------------------- queries

export const PAGE = 50;

/** A list read PAGE rows at a time with limit/offset (the "Load more" at its foot). */
export const partiesQuery = (params: ListParams) =>
  infiniteQueryOptions({
    queryKey: partyKeys.list(params),
    queryFn: ({ pageParam }) => listParties({ ...params, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length >= PAGE && loaded < last.total ? loaded : undefined;
    },
    retry: retryUnlessMissing,
    placeholderData: keepPreviousData,
  });

export const partyQuery = (id: string) =>
  queryOptions({ queryKey: partyKeys.detail(id), queryFn: () => getParty(id), retry: retryUnlessMissing });

export const timelineQuery = (id: string) =>
  queryOptions({ queryKey: partyKeys.timeline(id), queryFn: () => getTimeline(id, 100), retry: retryUnlessMissing });

export const duplicatesQuery = queryOptions({ queryKey: partyKeys.duplicates, queryFn: getDuplicates, retry: retryUnlessMissing, staleTime: 60_000 });

/** Pickers (new deal, new invoice): the first matches for what was typed. */
export const partySearchQuery = (q: string, role?: PartyRole, branchId?: string) =>
  queryOptions({
    queryKey: partyKeys.list({ q, role, branch_id: branchId, pick: 1 }),
    queryFn: () => listParties({ q, role, branch_id: branchId, status: "active", limit: 8 }),
    retry: retryUnlessMissing,
    placeholderData: keepPreviousData,
  });

/** The whole board at once (a pipeline is short; 200 open deals is plenty to work through). */
export const dealsQuery = (params: ListParams) =>
  queryOptions({ queryKey: dealKeys.list(params), queryFn: () => listDeals({ ...params, limit: 200 }), retry: retryUnlessMissing });

export const dealSummaryQuery = (branchId?: string) =>
  queryOptions({ queryKey: dealKeys.summary(branchId), queryFn: () => getDealSummary(branchId), retry: retryUnlessMissing });
