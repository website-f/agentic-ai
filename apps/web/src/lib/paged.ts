/** Cursor-paged lists ("lazy load"): pages of rows read with useInfiniteQuery.
 *
 * The API keeps list bodies plain (an array, or {items, ...}) and puts paging in headers:
 * X-Next-Cursor (pass back as `cursor`; absent on the last page) and X-Total-Count (first page).
 * Filters and search go to the server in `params`, so every page is already filtered and the
 * total is the filtered total.
 *
 * Live refresh: the key starts with the list's usual key (e.g. ["files"]), so the existing
 * invalidations in live.ts and in mutations match it. Invalidating an infinite query refetches
 * every loaded page from the top, so new rows appear and removed rows disappear in place. */
import {
  infiniteQueryOptions,
  keepPreviousData,
  useInfiniteQuery,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { apiWithHeaders } from "./api";

export const PAGE_SIZE = 50;

export type PageParams = Record<string, string | number | boolean | null | undefined>;

export interface Page<T> {
  items: T[];
  next: string | null;
  total: number | null;
}

export interface PagedOptions<T> {
  /** Rows per page (the API caps most lists at 200). */
  pageSize?: number;
  /** Pull the rows out of a body that is not a plain list, e.g. `(b) => b.items`. */
  pick?: (body: unknown) => T[];
  /** Identity for de-duplicating rows a later page repeats (a row edited between loads). */
  idOf?: (item: T) => string | number;
  enabled?: boolean;
  /** Poll every N ms while this says so, e.g. while an upload is still being read. */
  poll?: (items: T[]) => number | false;
}

function href(url: string, params: PageParams, limit: number, cursor: string | null): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  q.set("limit", String(limit));
  if (cursor) q.set("cursor", cursor);
  return `${url}${url.includes("?") ? "&" : "?"}${q}`;
}

/** Query options for one paged list. `key` is the list's usual key prefix. */
export function pagedQuery<T>(key: QueryKey, url: string, params: PageParams = {}, opts: PagedOptions<T> = {}) {
  const limit = opts.pageSize ?? PAGE_SIZE;
  const pick = opts.pick ?? ((b: unknown) => b as T[]);
  return infiniteQueryOptions({
    queryKey: [...key, "paged", url, params, limit] as const,
    queryFn: async ({ pageParam }): Promise<Page<T>> => {
      const { data, headers } = await apiWithHeaders<unknown>(href(url, params, limit, pageParam));
      const total = headers.get("X-Total-Count");
      return { items: pick(data), next: headers.get("X-Next-Cursor"), total: total === null ? null : Number(total) };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: opts.enabled,
    refetchInterval: opts.poll ? (q) => opts.poll!(q.state.data ? flatten(q.state.data, opts.idOf) : []) : undefined,
    // A new filter or search keeps the old rows on screen until its first page arrives.
    placeholderData: keepPreviousData,
  });
}

const defaultId = (item: unknown) => (item as { id: string | number }).id;

/** Every loaded row of a paged query in order, without repeats. */
export function flatten<T>(data: InfiniteData<Page<T>> | undefined, idOf: (item: T) => string | number = defaultId): T[] {
  if (!data) return [];
  const seen = new Set<string | number>();
  const out: T[] = [];
  for (const p of data.pages) {
    for (const item of p.items) {
      const id = idOf(item);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(item);
    }
  }
  return out;
}

export function usePagedList<T>(key: QueryKey, url: string, params: PageParams = {}, opts: PagedOptions<T> = {}) {
  const query = useInfiniteQuery(pagedQuery<T>(key, url, params, opts));
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const idOf = opts.idOf;
  const items = useMemo(() => flatten(data, idOf), [data, idOf]);
  const total = data?.pages[0]?.total ?? null;
  return {
    items,
    /** Rows matching the filters on the server (null when the endpoint does not count). */
    total,
    hasMore: !!hasNextPage,
    isLoading: query.isLoading,
    isFetchingMore: isFetchingNextPage,
    error: query.error,
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    query,
  };
}

export type PagedList<T> = ReturnType<typeof usePagedList<T>>;

const isPaged = (data: unknown): data is InfiniteData<Page<unknown>> =>
  !!data && typeof data === "object" && Array.isArray((data as { pages?: unknown }).pages);

/** Edit the loaded rows of every paged query under `key` (optimistic updates). The edit gets
 * each page's rows, the page index and that query's params, and returns the new rows. */
export function editPaged<T>(
  qc: QueryClient,
  key: QueryKey,
  edit: (items: T[], page: number, params: PageParams) => T[],
) {
  for (const [queryKey, data] of qc.getQueriesData<InfiniteData<Page<T>>>({ queryKey: key })) {
    if (!isPaged(data)) continue;
    const at = queryKey.indexOf("paged");
    const params = (at >= 0 ? queryKey[at + 2] : {}) as PageParams;
    qc.setQueryData<InfiniteData<Page<T>>>(queryKey, {
      ...data,
      pages: data.pages.map((p, i) => ({ ...p, items: edit(p.items, i, params) })),
    });
  }
}

/** A value that settles `ms` after it stops changing (search boxes that query the server). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
