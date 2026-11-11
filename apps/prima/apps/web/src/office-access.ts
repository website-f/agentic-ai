import type { Me } from './api';

/**
 * P99 (Fitri, 11 Nov 2026: "roles lower than operations / staff can only access Prima but not all modules in Prima, so
 * make it so we can select the modules too"): inside the Agentic Office, the office says which Prima screens it gives this
 * person (Members > Access, on /api/me as `office`). The menu keeps only those, plus the home screen and the person's own
 * things (`always`). Nothing chosen (null) leaves the menu as their Prima role makes it. The office refuses the other
 * screens' calls too, with a plain message, and Prima's own role checks always come first: this only narrows.
 */
export function officeNarrowed<T extends { view: string }>(items: T[], office?: Me['office']): T[] {
  const chosen = office?.modules;
  if (!chosen) return items;
  const keep = new Set([...chosen, ...(office?.always ?? [])]);
  return items.filter((n) => keep.has(n.view));
}

/** Someone the office gave Prima only: no way back to the office's pages, and signing out signs out of the office. */
export const primaOnly = (me: Me) => me.office?.primaOnly === true;
