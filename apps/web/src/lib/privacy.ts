/**
 * AI privacy (P33): what leaves the server when an agent calls a cloud AI provider.
 *
 * Before a prompt goes out, IDs, people and company names are swapped for placeholders such as
 * [PERSON_K7Q2A]; the provider only sees the placeholders and the server puts the real values
 * back in the answer. Each company (branch) also has a data level that limits which providers
 * may see its work at all. These are the typed calls and the small pure helpers the screens use.
 */
import { queryOptions } from "@tanstack/react-query";

import { msg } from "@/i18n";
import { api } from "@/lib/api";

// ------------------------------------------------------------------------------------- types

export type DataLevel = "standard" | "confidential" | "local_only";
export const DATA_LEVELS: readonly DataLevel[] = ["standard", "confidential", "local_only"];

/** What can be masked. Amounts are separate so quotations keep their numbers by default. */
export type PrivacyCategory = "ids" | "people" | "companies" | "amounts";
export type PrivacyCategories = Record<PrivacyCategory, boolean>;
/** The categories masked by default (amounts get [AMOUNT_…] placeholders only when turned on). */
export type MaskedCategory = Exclude<PrivacyCategory, "amounts">;
export const MASKED_CATEGORIES: readonly MaskedCategory[] = ["ids", "people", "companies"];

export interface ProviderUse {
  provider_id: string;
  name: string;
  trusted: boolean;
  calls: number;
  /** Calls in which at least one value was swapped for a placeholder. */
  masked: number;
}

export interface CompanyPrivacy {
  branch_id: string;
  name: string;
  data_level: DataLevel;
  providers_30d: ProviderUse[];
}

export interface PrivacySettings {
  masking: boolean;
  categories: PrivacyCategories;
  companies: CompanyPrivacy[];
}

export interface PrivacyUpdate {
  masking?: boolean;
  categories?: Partial<PrivacyCategories>;
}

export interface PrivacyPreview {
  masked: string;
  /** Occurrences per category; amounts only when that category is on. */
  counts: Record<MaskedCategory, number> & { amounts?: number };
}

/** The privacy fields a provider gains (optional: older API builds do not send them). */
export interface ProviderPrivacy {
  trusted?: boolean;
  require_zdr?: boolean;
  data_policy_note?: string;
}

// ------------------------------------------------------------------------------------- API

/** The AI Engine router (prefix /api/ai) serves the privacy endpoints next to providers. */
export const PRIVACY_PATH = "/api/ai/privacy";

export const privacyKeys = {
  settings: ["ai", "privacy"] as const,
};

export const getPrivacy = () => api<PrivacySettings>(PRIVACY_PATH);

export const savePrivacy = (body: PrivacyUpdate) => api<PrivacySettings>(PRIVACY_PATH, "PUT", body);

export const previewPrivacy = (text: string, branchId?: string | null) =>
  api<PrivacyPreview>(`${PRIVACY_PATH}/preview`, "POST", branchId ? { text, branch_id: branchId } : { text });

export const patchProviderPrivacy = (providerId: string, body: Pick<ProviderPrivacy, "trusted" | "require_zdr">) =>
  api(`/api/ai/providers/${providerId}`, "PATCH", body);

export const patchBranchDataLevel = (branchId: string, level: DataLevel) =>
  api(`/api/branches/${branchId}`, "PATCH", { data_level: level });

export const privacyQuery = queryOptions({
  queryKey: privacyKeys.settings,
  queryFn: getPrivacy,
  // Until the API lands this 404s; one try is enough to show the notice.
  retry: false,
});

// ------------------------------------------------------------------------------------- labels

export const LEVEL_LABEL: Record<DataLevel, string> = {
  standard: msg("Standard"),
  confidential: msg("Confidential"),
  local_only: msg("Local only"),
};

export const LEVEL_HINT: Record<DataLevel, string> = {
  standard: msg("Any connected provider, with private details masked."),
  confidential: msg("Only providers you mark as trusted: no training, no retention."),
  local_only: msg("Nothing leaves the server. Only the server's local model answers."),
};

export const LOCAL_ONLY_LIMIT = msg(
  "The local model on the server is small, so answers are slower and less capable than cloud models. Best for short, simple work.",
);

export const CATEGORY_LABEL: Record<PrivacyCategory, string> = {
  ids: msg("IDs & bank/card numbers"),
  people: msg("People & contacts"),
  companies: msg("Company names & references"),
  amounts: msg("Amounts"),
};

/** A realistic Malaysian message for the "what the provider sees" preview. */
export const SAMPLE_TEXT = msg(
  "Hi team, please prepare the quotation for Encik Ahmad Faizal bin Rahman (MyKad 900101-14-5678, phone 012-345 6789, ahmad.faizal@harmonieng.com.my). Client: Harmoni Engineering Sdn Bhd, tender QT260000000027691. Agreed price RM 12,500. Payment to Maybank account 5140 1234 5678.",
);

/** A company's data level; branches from older API builds have none and count as standard. */
export function dataLevelOf(branch: object): DataLevel {
  const v = (branch as { data_level?: unknown }).data_level;
  return DATA_LEVELS.includes(v as DataLevel) ? (v as DataLevel) : "standard";
}

// ------------------------------------------------------------------------------------- placeholders

export const PLACEHOLDER_KINDS = ["PERSON", "EMAIL", "PHONE", "ADDRESS", "IC", "PASSPORT", "BANKACC", "CARD", "COMPANY", "OURCO", "REF", "AMOUNT"] as const;
export type PlaceholderKind = (typeof PLACEHOLDER_KINDS)[number];

/** One placeholder the server put in place of a real value, e.g. [PERSON_K7Q2A]. */
export const PLACEHOLDER_SOURCE = String.raw`\[(PERSON|EMAIL|PHONE|ADDRESS|IC|PASSPORT|BANKACC|CARD|COMPANY|OURCO|REF|AMOUNT)_[A-Z0-9]{5,}\]`;

/** A fresh global regex each call, so a shared lastIndex never leaks between callers. */
export const placeholderRegex = () => new RegExp(PLACEHOLDER_SOURCE, "g");

const KIND_CATEGORY: Record<PlaceholderKind, PrivacyCategory> = {
  IC: "ids",
  PASSPORT: "ids",
  BANKACC: "ids",
  CARD: "ids",
  PERSON: "people",
  EMAIL: "people",
  PHONE: "people",
  ADDRESS: "people",
  COMPANY: "companies",
  // One of your own companies (from the database), so the model can tell ours from theirs.
  OURCO: "companies",
  REF: "companies",
  // Only when the Amounts category is turned on.
  AMOUNT: "amounts",
};

export function placeholderCategory(kind: PlaceholderKind): PrivacyCategory {
  return KIND_CATEGORY[kind];
}

export type MaskedSegment =
  | { type: "text"; text: string }
  | { type: "placeholder"; text: string; kind: PlaceholderKind; category: PrivacyCategory };

/** Splits masked text into plain runs and placeholders, in order, so placeholders can render as chips. */
export function splitMasked(text: string): MaskedSegment[] {
  const out: MaskedSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(placeholderRegex())) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", text: text.slice(last, at) });
    const kind = m[1] as PlaceholderKind;
    out.push({ type: "placeholder", text: m[0], kind, category: placeholderCategory(kind) });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** Placeholders per category (distinct values: the same person twice is one placeholder). */
export function countPlaceholders(text: string): Record<PrivacyCategory, number> {
  const seen = new Set<string>();
  const counts: Record<PrivacyCategory, number> = { ids: 0, people: 0, companies: 0, amounts: 0 };
  for (const m of text.matchAll(placeholderRegex())) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    counts[placeholderCategory(m[1] as PlaceholderKind)] += 1;
  }
  return counts;
}

// ------------------------------------------------------------------------------------- warnings

/**
 * Providers a Confidential company used that are not marked trusted. After P33 the router
 * refuses these, but older calls (or a trust flag turned off later) can still show up.
 */
export function untrustedUses(company: Pick<CompanyPrivacy, "data_level" | "providers_30d">): ProviderUse[] {
  if (company.data_level !== "confidential") return [];
  return company.providers_30d.filter((p) => !p.trusted && p.calls > 0);
}

/** Any provider call at all for a Local-only company means data left the server. */
export function cloudUsesForLocalOnly(company: Pick<CompanyPrivacy, "data_level" | "providers_30d">, localIds: ReadonlySet<string>): ProviderUse[] {
  if (company.data_level !== "local_only") return [];
  return company.providers_30d.filter((p) => p.calls > 0 && !localIds.has(p.provider_id));
}

const RISKY_POLICY = /china|prc\b|may (?:use|train|retain|keep|store)|used (?:for|to) train|trains? on|for training|no opt-?out|retain(?:s|ed)? (?:prompts|data|inputs)|stores? (?:prompts|data|inputs)|kept for/i;
/** Reassuring phrases are removed first, so "not used for training" never reads as a warning. */
const SAFE_POLICY = /\bno (?:training|retention)\b|not (?:be )?(?:used for training|used to train|retained|stored)|zero data retention/gi;

/** Warning tone for a provider's data-policy note when it reads like data may be kept or trained on. */
export function policyTone(note: string | null | undefined, preset?: string | null): "warn" | "muted" {
  if (preset === "deepseek") return "warn";
  if (!note) return "muted";
  return RISKY_POLICY.test(note.replace(SAFE_POLICY, " ")) ? "warn" : "muted";
}

/** OpenRouter can be told to route only to endpoints with zero data retention. */
export function isOpenRouter(p: { preset?: string | null; base_url?: string }): boolean {
  return p.preset === "openrouter" || /openrouter\.ai/i.test(p.base_url ?? "");
}
