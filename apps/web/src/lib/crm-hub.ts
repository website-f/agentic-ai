/**
 * P50 the universal CRM (api/routers/crm_hub.py): typed calls, query options and small pure
 * helpers. The CRM is the owner's; others see only what the owner shared (per object, view or
 * edit, minus hidden fields).
 *
 * Objects: custom (anything a business tracks), built-in (the office's own data: contacts,
 * deals, invoices... read only, plus extra fields people add) and synced (from another system).
 */
import { queryOptions } from "@tanstack/react-query";

import { msg } from "@/i18n";

import { api, ApiError, langHeader } from "./api";

export type FieldType =
  | "text" | "long_text" | "number" | "money" | "percent" | "date" | "datetime" | "checkbox"
  | "select" | "multi_select" | "email" | "phone" | "url" | "rating" | "person" | "relation" | "file" | "auto";

export interface Choice { value: string; label: string; color: string }

export interface CrmField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options: { choices?: Choice[]; currency?: string; max?: number; object?: string; many?: boolean };
  required: boolean;
  hidden: boolean;
  builtin: boolean;
  source_path: string | null;
  position: number;
}

export interface CrmObject {
  id: string;
  key: string;
  name: string;
  singular: string;
  description: string;
  icon: string;
  color: string;
  kind: "custom" | "builtin" | "synced";
  source: string | null;
  title_field: string;
  position: number;
  archived: boolean;
  connector_id: string | null;
  count: number | null;
  can_edit: boolean;
  can_add_fields: boolean;
  link: string | null;
}

export type ViewKind = "table" | "board" | "calendar" | "cards";

export interface Filter { field: string; op: string; value?: unknown }
export interface Sort { field: string; dir: "asc" | "desc" }

export interface CrmView {
  id: string;
  name: string;
  kind: ViewKind;
  config: { columns?: string[]; filters?: Filter[]; sort?: Sort[]; group_by?: string; date_field?: string };
  position: number;
}

export interface CrmRow {
  id: string;
  title: string;
  data: Record<string, unknown>;
  link?: string;
  builtin?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Discovered { key: string; name: string; description: string; icon: string; color: string; count: number; tags: string[] }
export interface Template { key: string; name: string; description: string; icon: string; objects: string[]; builtins: string[] }

export interface CrmOverview {
  access: { owner: boolean; dashboard: boolean };
  objects: CrmObject[];
  discover?: Discovered[];
  templates?: Template[];
  field_types?: FieldType[];
}

export interface ObjectDetail {
  object: CrmObject;
  fields: CrmField[];
  views: CrmView[];
  connector: { id: string; name: string; last_sync_at: string | null; last_status: string } | null;
}

export interface QueryResult { total: number; rows: CrmRow[]; refs: Record<string, string> }

export interface Widget {
  id: string;
  title: string;
  kind: "number" | "bar" | "pie" | "line" | "list";
  size: "sm" | "md" | "lg";
  config: { object: string; metric?: "count" | "sum" | "avg"; field?: string; group_by?: string; date_field?: string; period?: string; filters?: Filter[] };
  position: number;
  object: { key: string; name: string; icon: string; color: string };
  money: boolean;
  data: { total: number; groups: { key: string; label: string; value: number }[]; rows?: { id: string; title: string }[] };
}

export interface Connector {
  id: string;
  name: string;
  kind: "rest" | "csv" | "webhook";
  preset: string | null;
  config: Record<string, unknown> & { secret_set?: boolean };
  object: { key: string; name: string } | null;
  every_minutes: number;
  enabled: boolean;
  last_sync_at: string | null;
  last_status: "never" | "ok" | "error";
  last_error: string | null;
  stats: Record<string, unknown>;
  sync?: Record<string, unknown>;
  webhook_path?: string;
}

export interface Preset { key: string; name: string; kind: "rest" | "csv" | "webhook"; icon: string; help: string; config: Record<string, unknown> }

export interface FoundField { key: string; label: string; type: FieldType; path: string; sample: unknown }

export interface Grant { user_id: string; name: string; email: string; dashboard: boolean; objects: { object_id: string; level: "view" | "edit"; hidden_fields: string[] }[] }

// ------------------------------------------------------------------------------- queries

export const crmKeys = {
  all: ["crm"] as const,
  overview: ["crm", "overview"] as const,
  object: (key: string) => ["crm", "object", key] as const,
  rows: (key: string) => ["crm", "rows", key] as const,
  record: (key: string, id: string) => ["crm", "record", key, id] as const,
  dashboard: ["crm", "dashboard"] as const,
  connectors: ["crm", "connectors"] as const,
  access: ["crm", "access"] as const,
  people: ["crm", "people"] as const,
};

const enc = encodeURIComponent;

export const crmOverviewQuery = queryOptions({ queryKey: crmKeys.overview, queryFn: () => api<CrmOverview>("/api/crm"), retry: false });
export const crmObjectQuery = (key: string) =>
  queryOptions({ queryKey: crmKeys.object(key), queryFn: () => api<ObjectDetail>(`/api/crm/objects/${enc(key)}`), enabled: !!key });
export const crmDashboardQuery = queryOptions({ queryKey: crmKeys.dashboard, queryFn: () => api<{ widgets: Widget[]; can_edit: boolean }>("/api/crm/dashboard"), retry: false });
export const crmConnectorsQuery = queryOptions({ queryKey: crmKeys.connectors, queryFn: () => api<{ connectors: Connector[]; presets: Preset[] }>("/api/crm/connectors") });
export const crmAccessQuery = queryOptions({ queryKey: crmKeys.access, queryFn: () => api<Grant[]>("/api/crm/access") });
export const crmPeopleQuery = queryOptions({ queryKey: crmKeys.people, queryFn: () => api<{ id: string; name: string; email?: string; owner?: boolean }[]>("/api/crm/people"), staleTime: 300_000 });

// ------------------------------------------------------------------------------- calls

export const queryRows = (key: string, body: { q?: string; filters?: Filter[]; sort?: Sort[]; limit?: number; offset?: number }) =>
  api<QueryResult>(`/api/crm/objects/${enc(key)}/query`, "POST", body);
export const getRecord = (key: string, id: string) =>
  api<{ row: CrmRow; refs: Record<string, string>; history: { at: string; who: string; action: string; changed: string[] }[] }>(`/api/crm/objects/${enc(key)}/records/${enc(id)}`);
export const addRecord = (key: string, values: Record<string, unknown>) => api<CrmRow>(`/api/crm/objects/${enc(key)}/records`, "POST", { values });
export const updateRecord = (key: string, id: string, values: Record<string, unknown>) =>
  api<{ id: string; data: Record<string, unknown> }>(`/api/crm/objects/${enc(key)}/records/${enc(id)}`, "PATCH", { values });
export const deleteRecord = (key: string, id: string) => api<void>(`/api/crm/objects/${enc(key)}/records/${enc(id)}`, "DELETE");
export const relationOptions = (key: string, q: string) => api<{ id: string; title: string }[]>(`/api/crm/objects/${enc(key)}/options?q=${enc(q)}`);

export const applyTemplate = (key: string) => api<{ objects: string[] }>(`/api/crm/templates/${enc(key)}`, "POST");
export const addBuiltin = (source: string) => api<CrmObject>(`/api/crm/builtins/${enc(source)}`, "POST");
export const addObject = (body: { name: string; singular?: string; description?: string; icon?: string; color?: string; preset?: string }) =>
  api<CrmObject>("/api/crm/objects", "POST", body);
export const updateObject = (key: string, body: Partial<Pick<CrmObject, "name" | "singular" | "description" | "icon" | "color" | "title_field" | "position" | "archived">>) =>
  api<CrmObject>(`/api/crm/objects/${enc(key)}`, "PATCH", body);
export const deleteObject = (key: string) => api<void>(`/api/crm/objects/${enc(key)}`, "DELETE");

export const addField = (key: string, body: { label: string; type: FieldType; options?: CrmField["options"]; required?: boolean }) =>
  api<CrmField>(`/api/crm/objects/${enc(key)}/fields`, "POST", body);
export const updateField = (id: string, body: Partial<Pick<CrmField, "label" | "options" | "required" | "hidden" | "position">>) =>
  api<CrmField>(`/api/crm/fields/${enc(id)}`, "PATCH", body);
export const deleteField = (id: string) => api<void>(`/api/crm/fields/${enc(id)}`, "DELETE");

export const addView = (key: string, body: { name: string; kind: ViewKind; config?: CrmView["config"] }) => api<CrmView>(`/api/crm/objects/${enc(key)}/views`, "POST", body);
export const updateView = (id: string, body: Partial<Pick<CrmView, "name" | "kind" | "config" | "position">>) => api<CrmView>(`/api/crm/views/${enc(id)}`, "PATCH", body);
export const deleteView = (id: string) => api<void>(`/api/crm/views/${enc(id)}`, "DELETE");

export const addWidget = (body: { title: string; kind: Widget["kind"]; size?: Widget["size"]; config: Widget["config"] }) => api<{ id: string }>("/api/crm/widgets", "POST", body);
export const updateWidget = (id: string, body: Partial<{ title: string; kind: Widget["kind"]; size: Widget["size"]; config: Widget["config"]; position: number }>) =>
  api<{ id: string }>(`/api/crm/widgets/${enc(id)}`, "PATCH", body);
export const deleteWidget = (id: string) => api<void>(`/api/crm/widgets/${enc(id)}`, "DELETE");

export const testConnector = (body: { kind: "rest" | "csv"; config: Record<string, unknown>; secret?: string }) =>
  api<{ count: number; fields: FoundField[]; sample: Record<string, unknown>[] }>("/api/crm/connectors/test", "POST", body);
export const addConnector = (body: {
  name: string; kind: Connector["kind"]; preset?: string | null; config: Record<string, unknown>; secret?: string;
  fields: (FoundField & { include: boolean })[]; title_field?: string | null; object_name?: string; icon?: string; every_minutes?: number;
}) => api<Connector>("/api/crm/connectors", "POST", body);
export const syncConnector = (id: string) => api<Connector>(`/api/crm/connectors/${enc(id)}/sync`, "POST");
export const updateConnector = (id: string, body: Partial<{ name: string; enabled: boolean; every_minutes: number; secret: string; config: Record<string, unknown> }>) =>
  api<Connector>(`/api/crm/connectors/${enc(id)}`, "PATCH", body);
export const newHookAddress = (id: string) => api<Connector>(`/api/crm/connectors/${enc(id)}/new-address`, "POST");
export const deleteConnector = (id: string) => api<void>(`/api/crm/connectors/${enc(id)}`, "DELETE");

export const setAccess = (userId: string, body: { dashboard: boolean; objects: Grant["objects"] }) => api<Grant>(`/api/crm/access/${enc(userId)}`, "PUT", body);

export const importCsv = (key: string, csv: string) => api<{ added: number; skipped: number; problems: string[] }>(`/api/crm/objects/${enc(key)}/import`, "POST", { csv, add_fields: true });

/** The object's rows as a CSV file, saved by the browser. */
export async function exportCsv(key: string): Promise<void> {
  const res = await fetch(`/api/crm/objects/${enc(key)}/export.csv`, { credentials: "same-origin", headers: langHeader() });
  if (!res.ok) throw new ApiError(res.status, "export_failed", msg("Could not export."));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${key}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------------------------- labels and helpers

export const FIELD_TYPES: { type: FieldType; label: string; hint: string }[] = [
  { type: "text", label: msg("Text"), hint: msg("A name, a short note") },
  { type: "long_text", label: msg("Long text"), hint: msg("Notes, descriptions") },
  { type: "number", label: msg("Number"), hint: msg("Quantity, size, count") },
  { type: "money", label: msg("Money"), hint: msg("Prices, fees, totals in RM") },
  { type: "percent", label: msg("Percent"), hint: msg("Progress, discount") },
  { type: "date", label: msg("Date"), hint: msg("A day, like a due date") },
  { type: "datetime", label: msg("Date and time"), hint: msg("An appointment, a meeting") },
  { type: "select", label: msg("One choice"), hint: msg("Status, type, stage") },
  { type: "multi_select", label: msg("Several choices"), hint: msg("Tags, services, days") },
  { type: "checkbox", label: msg("Yes or no"), hint: msg("Paid? Active? Done?") },
  { type: "email", label: msg("Email"), hint: msg("An email address") },
  { type: "phone", label: msg("Phone"), hint: msg("A phone or WhatsApp number") },
  { type: "url", label: msg("Web address"), hint: msg("A website or a link") },
  { type: "rating", label: msg("Rating"), hint: msg("1 to 5 stars") },
  { type: "person", label: msg("Person"), hint: msg("Someone in your office") },
  { type: "relation", label: msg("Link to another list"), hint: msg("A customer, a project, a property") },
  { type: "file", label: msg("Files"), hint: msg("Documents from your Library") },
  { type: "auto", label: msg("Auto number"), hint: msg("1, 2, 3... given by itself") },
];

export const FILTER_OPS: { op: string; label: string; types?: FieldType[]; noValue?: boolean }[] = [
  { op: "is", label: msg("is") },
  { op: "is_not", label: msg("is not") },
  { op: "contains", label: msg("contains"), types: ["text", "long_text", "email", "phone", "url"] },
  { op: "any_of", label: msg("is any of"), types: ["select", "multi_select"] },
  { op: "gt", label: msg("more than"), types: ["number", "money", "percent", "rating", "auto", "date", "datetime"] },
  { op: "lt", label: msg("less than"), types: ["number", "money", "percent", "rating", "auto", "date", "datetime"] },
  { op: "this_week", label: msg("this week"), types: ["date", "datetime"], noValue: true },
  { op: "this_month", label: msg("this month"), types: ["date", "datetime"], noValue: true },
  { op: "past", label: msg("is past"), types: ["date", "datetime"], noValue: true },
  { op: "future", label: msg("is coming up"), types: ["date", "datetime"], noValue: true },
  { op: "empty", label: msg("is empty"), noValue: true },
  { op: "not_empty", label: msg("is filled in"), noValue: true },
];

export const CHOICE_TONE: Record<string, string> = {
  gray: "bg-surface-2 text-fg/80",
  green: "bg-ok/12 text-ok",
  blue: "bg-info/12 text-info",
  amber: "bg-warn/14 text-warn",
  red: "bg-danger/12 text-danger",
  violet: "bg-[color-mix(in_oklab,var(--series-7)_14%,transparent)] text-[var(--series-7)]",
  pink: "bg-[color-mix(in_oklab,var(--series-5)_14%,transparent)] text-[var(--series-5)]",
  teal: "bg-accent-soft text-accent",
  orange: "bg-[color-mix(in_oklab,var(--series-2)_14%,transparent)] text-[var(--series-2)]",
};

/** A value as text (for cards, titles and the calendar). */
export function valueText(f: Pick<CrmField, "type" | "options">, v: unknown, refs: Record<string, string> = {}, lang = "en-MY"): string {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return "";
  switch (f.type) {
    case "checkbox": return v ? "✓" : "";
    case "money": return `${f.options.currency || "RM"} ${Number(v).toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "percent": return `${Number(v)}%`;
    case "number": case "auto": return Number(v).toLocaleString(lang);
    case "rating": return "★".repeat(Number(v) || 0);
    case "date": return new Date(`${String(v)}T00:00:00`).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });
    case "datetime": return new Date(String(v)).toLocaleString(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    case "select": case "multi_select": {
      const labels = new Map((f.options.choices ?? []).map((c) => [c.value, c.label]));
      return (Array.isArray(v) ? v : [v]).map((x) => labels.get(String(x)) ?? String(x)).join(", ");
    }
    case "person": return refs[String(v)] ?? String(v);
    case "relation": case "file": return (Array.isArray(v) ? v : [v]).map((x) => refs[String(x)] ?? String(x)).join(", ");
    default: return String(v);
  }
}

/** Fields worth showing on a card or as the first table columns: not long, not hidden. */
export function summaryFields(fields: CrmField[], titleKey: string, n = 4): CrmField[] {
  return fields.filter((f) => !f.hidden && f.key !== titleKey && f.type !== "long_text").slice(0, n);
}
