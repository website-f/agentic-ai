/** The companies (branches) a person may see, and the one the header switcher points at.
 *
 * "All companies" is a real choice: lists then show every company the person may see. Pages that
 * need exactly one company (office floor, company kit, forms that create something) use `one`:
 * the chosen company, or under "All" the last single company they picked (or the first). */
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { branchesQuery, meQuery } from "./queries";
import { ALL_COMPANIES, useBranch } from "./stores";
import type { Branch, Me } from "./types";

/** The one company a scoped role is held to (branch managers, heads, supervisors, staff). */
export function lockedBranchId(me: Me): string | null {
  return me.scope && me.scope.kind !== "all" ? me.scope.branch_id : null;
}

export interface Companies {
  /** Every company this person may see, in the switcher's order. */
  branches: Branch[];
  isLoading: boolean;
  /** More than one company: "All companies" is on offer. */
  canAll: boolean;
  /** The switcher is on "All companies". */
  isAll: boolean;
  /** The chosen company (null under "All"). */
  selected: Branch | null;
  /** For pages that need one company: the chosen one, else the last one picked, else the first. */
  one: Branch | null;
  /** Point the switcher at a company id or ALL_COMPANIES. */
  select: (id: string) => void;
  /** A one-company page switched company: under "All" it stays on "All" and only remembers it. */
  pickOne: (id: string) => void;
}

export function useCompanies(): Companies {
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: every = [], isLoading } = useQuery(branchesQuery);
  const branchId = useBranch((s) => s.branchId);
  const lastId = useBranch((s) => s.lastId);
  const setBranchId = useBranch((s) => s.setBranchId);
  const setLastId = useBranch((s) => s.setLastId);
  const lock = lockedBranchId(me);
  const branches = useMemo(() => {
    const mine = lock ? every.filter((b) => b.id === lock) : every;
    return mine.length ? mine : every;
  }, [every, lock]);
  const canAll = branches.length > 1;
  // Nothing chosen yet (or a company that was deleted): several companies start on "All".
  const chosen = branches.find((b) => b.id === branchId) ?? null;
  const isAll = canAll && !chosen;
  const selected = isAll ? null : (chosen ?? branches[0] ?? null);
  const one = selected ?? branches.find((b) => b.id === lastId) ?? branches[0] ?? null;
  return {
    branches,
    isLoading,
    canAll,
    isAll,
    selected,
    one,
    select: (id) => setBranchId(id),
    pickOne: (id) => (isAll ? setLastId(id) : setBranchId(id)),
  };
}

export { ALL_COMPANIES };
