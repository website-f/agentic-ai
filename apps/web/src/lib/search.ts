/** P25: search inside every document (files page by page, SOPs, documents, templates, wiki),
 * suggestions as you type, and recent searches. */
import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "./api";

export type HitType = "file" | "sop" | "document" | "template" | "page";
export const HIT_TYPES: HitType[] = ["file", "sop", "document", "template", "page"];

export interface SearchHit {
  type: HitType;
  id: string;
  title: string;
  subtitle: string;
  page: number | null;
  /** HTML-escaped text with <mark> around the matches. Render with <Marked>, never as HTML. */
  snippet: string;
  score: number;
  url: string;
  /** Same rules as snippet. */
  heading: string;
  branch_id: string | null;
  company: string;
  folder: string;
  kind: string;
  department: string;
  draft: boolean;
  pages_matched: number;
  via: string[];
}

export interface SearchResult {
  q: string;
  hits: SearchHit[];
  total: number;
  next_cursor: string | null;
  corrected: string[];
  groups: Partial<Record<HitType, number>>;
  took_ms: number;
}

export interface Suggestion {
  text: string;
  kind: "term" | "title" | "heading" | "recent";
  type?: HitType | null;
  id?: string | null;
  url?: string | null;
  page?: number | null;
  /** A file's company: the Files page shows one company at a time. */
  branch_id?: string | null;
}

export interface SearchFilters {
  q: string;
  branch_id?: string;
  type?: HitType;
  kind?: string;
  department_id?: string;
  source?: "upload" | "agent" | "person";
}

export const searchKeys = {
  all: ["search"] as const,
  results: (f: SearchFilters) => ["search", "results", f] as const,
  suggest: (q: string, branch: string | undefined) => ["search", "suggest", q, branch ?? ""] as const,
};

function params(f: SearchFilters, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, String(v));
  return p.toString();
}

export const PAGE_SIZE = 20;

export function searchQuery(f: SearchFilters) {
  return infiniteQueryOptions({
    queryKey: searchKeys.results(f),
    queryFn: ({ pageParam }) => api<SearchResult>(`/api/search?${params(f, { limit: String(PAGE_SIZE), cursor: pageParam || undefined })}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: f.q.trim().length > 0,
    staleTime: 30_000,
  });
}

export function suggestQuery(q: string, branchId?: string, enabled = true) {
  return queryOptions({
    queryKey: searchKeys.suggest(q, branchId),
    queryFn: () => api<{ q: string; suggestions: Suggestion[] }>(`/api/search/suggest?${params({ q, branch_id: branchId })}`),
    enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

export const clearRecent = () => api<void>("/api/search/recent", "DELETE");

// ---------------------------------------------------------------- <mark> only

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Undo the server's HTML escaping (html.escape): named and numeric entities. */
export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export interface MarkPart {
  text: string;
  mark: boolean;
}

/** The tiny sanitiser: a snippet becomes plain text runs, some marked. <mark> and </mark> are
 * the only tags read; anything else that looks like a tag is shown as text, never as HTML. */
export function markParts(html: string): MarkPart[] {
  const out: MarkPart[] = [];
  let mark = false;
  for (const piece of html.split(/(<\/?mark>)/i)) {
    const low = piece.toLowerCase();
    if (low === "<mark>") mark = true;
    else if (low === "</mark>") mark = false;
    else if (piece) out.push({ text: unescapeHtml(piece), mark });
  }
  return out;
}

export function plainText(html: string): string {
  return markParts(html).map((p) => p.text).join("");
}

/** Where a hit or suggestion opens inside the app (the server's url, kept same-origin). */
export function safeHref(url: string | null | undefined): string | null {
  if (!url || !url.startsWith("/") || url.startsWith("//")) return null;
  return url;
}

// ---------------------------------------------------------------- the debounced query

/** The text to ask for, `ms` after the person stops typing. */
export function useDebounced<T>(value: T, ms = 150): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
