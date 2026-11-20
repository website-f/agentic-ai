/**
 * P111: the organization chart (who reports to whom). The server decides what each reader
 * sees (apps/api agentic/org/hierarchy.py): the whole workspace for owners and admins, their
 * part of it for managers, and for staff themselves, the people under them and their own line
 * of managers (those by name and title only). Here: the queries and the pure helpers that turn
 * the list into trees (roots are the people with nobody above them that the reader sees).
 * P113: every member sees the whole organization (their own part in full, the rest by name,
 * title, company and department); owners, admins, management and HR change any line, branch
 * managers and HODs the people of their branch or department (`editable`), the rest only look.
 */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";
import { keys } from "./queries";
import type { Role } from "./types";

export interface OrgPerson {
  user_id: string;
  name: string;
  job_title: string | null;
  /** null: a manager above the reader shown by name and title only (`limited`). */
  role: Role | null;
  branch_id: string | null;
  branch_name: string | null;
  branch_ids: string[];
  department_id: string | null;
  department_name: string | null;
  reports_to_user_id: string | null;
  /** Their manager's name when the reader does not see the manager's own box. */
  reports_to_name: string | null;
  direct_reports: number | null;
  heads_department: boolean;
  is_active: boolean;
  limited: boolean;
  /** P113: the reader may change this person's line and job title. */
  editable?: boolean;
}

export interface OrgChart {
  people: OrgPerson[];
  me: string;
  can_edit: boolean;
  whole: boolean;
  /** P113: where the reader changes the chart (null: view only). */
  edit_scope?: "all" | "branch" | "department" | null;
}

export interface MyHierarchy {
  me: OrgPerson;
  /** My manager first, then theirs, up to the top. */
  chain: OrgPerson[];
  reports: OrgPerson[];
  below: number;
  /** P120: everyone under me down every line (managers before their people). */
  line?: OrgPerson[];
}

/** Under the members key: any change to a member refreshes the chart too. */
export const hierarchyKey = [...keys.members, "hierarchy"] as const;
export const orgChartQuery = queryOptions({
  queryKey: hierarchyKey,
  queryFn: () => api<OrgChart>("/api/members/hierarchy"),
});
export const myHierarchyQuery = queryOptions({
  queryKey: [...hierarchyKey, "mine"],
  queryFn: () => api<MyHierarchy>("/api/members/hierarchy/mine"),
});

/** Who reports to `user_id` (null: to no one). The server checks every rule (no loops). */
export const setReportsTo = (userId: string, managerId: string | null) =>
  api(`/api/members/${userId}`, "PATCH", { reports_to_user_id: managerId });

export interface OrgNode {
  person: OrgPerson;
  children: OrgNode[];
  /** Everyone under them that this view shows, down every line. */
  size: number;
}

/** The people as trees: a person whose manager the list does not hold is a root. Roots and
 * children by name. Loops (never saved, but never trusted) are broken at the first repeat. */
export function buildForest(people: OrgPerson[]): OrgNode[] {
  const byId = new Map(people.map((p) => [p.user_id, p]));
  const kids = new Map<string, OrgPerson[]>();
  for (const p of people) {
    const boss = p.reports_to_user_id;
    if (boss && boss !== p.user_id && byId.has(boss)) kids.set(boss, [...(kids.get(boss) ?? []), p]);
  }
  const byName = (a: OrgPerson, b: OrgPerson) => a.name.localeCompare(b.name);
  const seen = new Set<string>();
  const grow = (p: OrgPerson): OrgNode => {
    seen.add(p.user_id);
    const children = (kids.get(p.user_id) ?? []).filter((c) => !seen.has(c.user_id)).sort(byName).map(grow);
    return { person: p, children, size: children.reduce((n, c) => n + 1 + c.size, 0) };
  };
  const isRoot = (p: OrgPerson) => !p.reports_to_user_id || !byId.has(p.reports_to_user_id) || p.reports_to_user_id === p.user_id;
  const roots = people.filter(isRoot).sort(byName).map(grow);
  // Anyone left is in a loop: start a tree at the first of them.
  for (const p of [...people].sort(byName)) if (!seen.has(p.user_id)) roots.push(grow(p));
  return roots;
}

/** The managers above a person in this list, nearest first. */
export function ancestorsOf(people: OrgPerson[], userId: string): string[] {
  const byId = new Map(people.map((p) => [p.user_id, p]));
  const out: string[] = [];
  let cur = byId.get(userId)?.reports_to_user_id;
  while (cur && byId.has(cur) && !out.includes(cur) && cur !== userId) {
    out.push(cur);
    cur = byId.get(cur)?.reports_to_user_id;
  }
  return out;
}

/** Everyone under a person in this list (to keep them out of their own "reports to"). */
export function descendantsOf(people: OrgPerson[], userId: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const p of people) if (p.reports_to_user_id) kids.set(p.reports_to_user_id, [...(kids.get(p.reports_to_user_id) ?? []), p.user_id]);
  const out = new Set<string>();
  const stack = [...(kids.get(userId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || id === userId) continue;
    out.add(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

/** A company or department filter: the people who match, with the managers above them (so a
 * line stays whole; those managers show faded). `matched` says who matched. */
export function filterPeople(people: OrgPerson[], test: ((p: OrgPerson) => boolean) | null): { people: OrgPerson[]; matched: Set<string> | null } {
  if (!test) return { people, matched: null };
  const matched = new Set(people.filter(test).map((p) => p.user_id));
  const keep = new Set(matched);
  for (const id of matched) for (const up of ancestorsOf(people, id)) keep.add(up);
  return { people: people.filter((p) => keep.has(p.user_id)), matched };
}

/** The trees worth drawing (someone reports to someone) and the people on their own (nobody
 * above them and nobody under them), who are listed apart instead of as a row of lone boxes. */
export function splitForest(forest: OrgNode[], keep?: string): { trees: OrgNode[]; alone: OrgPerson[] } {
  const trees: OrgNode[] = [];
  const alone: OrgPerson[] = [];
  for (const n of forest) {
    if (n.children.length || n.person.user_id === keep) trees.push(n);
    else alone.push(n.person);
  }
  return { trees, alone };
}

/** The line under a person's name: their job title, else nothing. Company and department. */
export function placeOf(p: OrgPerson): string {
  return [p.department_name, p.branch_name].filter(Boolean).join(" · ");
}
