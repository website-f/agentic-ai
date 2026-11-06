/** P82: the Members table, one page at a time (GET /api/members?page=..., api/routers/members.py). */
import type { Member, Role } from "./types";

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export type MemberStatus = "active" | "pending" | "disabled";
export type MemberSort = "name" | "email" | "role" | "company" | "department" | "last_seen" | "joined";
export type SortDir = "asc" | "desc";

export interface MembersFilters {
  q: string;
  /** A branch id, "none" (no company) or "" for every company. */
  company: string;
  role: Role | "";
  status: MemberStatus | "";
  sort: MemberSort;
  dir: SortDir;
  page: number;
  pageSize: PageSize;
}

export const FIRST_PAGE: MembersFilters = { q: "", company: "", role: "", status: "", sort: "name", dir: "asc", page: 1, pageSize: 25 };

export interface MembersSummary {
  members: number;
  owners_admins: number;
  temp_password: number;
  microsoft: number;
  agents: number;
  roles: Partial<Record<Role, number>>;
}

export interface MembersPage {
  items: Member[];
  total: number;
  page: number;
  page_size: number;
  summary: MembersSummary;
}

/** The address of one page: only what is set goes, so the server's defaults hold. */
export function membersPageUrl(f: MembersFilters): string {
  const q = new URLSearchParams({ page: String(f.page), page_size: String(f.pageSize) });
  if (f.q.trim()) q.set("q", f.q.trim());
  if (f.company) q.set("company", f.company);
  if (f.role) q.set("role", f.role);
  if (f.status) q.set("status", f.status);
  if (f.sort !== "name") q.set("sort", f.sort);
  if (f.dir !== "asc") q.set("dir", f.dir);
  return `/api/members?${q}`;
}

/** How many pages, and which rows this page shows (1-based, for "26–50 of 239"). */
export function pageRange(page: number, pageSize: number, total: number): { pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (!total) return { pages, from: 0, to: 0 };
  const from = (Math.min(page, pages) - 1) * pageSize + 1;
  return { pages, from, to: Math.min(total, from + pageSize - 1) };
}

/** As the server's status filter reads it (members._status_where). */
export function memberStatus(m: Pick<Member, "is_active" | "must_change_password">): MemberStatus {
  if (!m.is_active) return "disabled";
  return m.must_change_password ? "pending" : "active";
}

/** A column heading clicked: the same column turns round, another starts the natural way
 * (names A to Z, last seen and joined newest first). */
export function nextSort(f: Pick<MembersFilters, "sort" | "dir">, key: MemberSort): Pick<MembersFilters, "sort" | "dir"> {
  if (f.sort === key) return { sort: key, dir: f.dir === "asc" ? "desc" : "asc" };
  return { sort: key, dir: key === "last_seen" || key === "joined" ? "desc" : "asc" };
}

/** A change to anything but the page goes back to page 1 (page 9 of a search may not exist). */
export function withFilter(f: MembersFilters, change: Partial<MembersFilters>): MembersFilters {
  const next = { ...f, ...change };
  if (!("page" in change)) next.page = 1;
  return next;
}

/** Ticking the box above the rows: all of this page when any is unticked, else none of it.
 * People ticked on other pages stay ticked. */
export function toggleAll(selected: ReadonlySet<string>, pageIds: string[]): Set<string> {
  const out = new Set(selected);
  const all = pageIds.length > 0 && pageIds.every((id) => out.has(id));
  for (const id of pageIds) {
    if (all) out.delete(id);
    else out.add(id);
  }
  return out;
}
