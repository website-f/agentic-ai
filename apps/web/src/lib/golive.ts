/** P81: Settings > Data and privacy > Start fresh for go-live (owner only). The server counts;
 * this works out what the owner's choice would do before they confirm it. */
import { api } from "@/lib/api";
import { dataKey } from "@/lib/erase";

export interface GoLiveCompany {
  id: string;
  name: string;
  departments: number;
  agents: number;
  files: number;
  members: number;
  linked_folders: number;
  /** Rows that belong only to it (memory pages, skills, workflows, forms...). */
  other: number;
}

export interface GoLiveOverview {
  workspace: { id: string; name: string };
  members: { total: number; owners: number; to_remove: number };
  companies: GoLiveCompany[];
  departments: number;
  agents: number;
  files: number;
  sops: number;
  /** last_success null: this server cannot see when the last backup was taken. */
  backup: { last_success: string | null; command: string };
  needs_code: boolean;
}

export interface GoLiveResult {
  members_removed: number;
  owners_kept: number;
  accounts_deactivated: number;
  sessions_ended: number;
  prima_links_ended: number;
  connections_removed: number;
  api_tokens_revoked: number;
  companies_removed: number;
  companies_kept: number;
  departments_removed: number;
  other_rows_removed: number;
  agents_moved: number;
  personal_agents_retired: number;
  files_moved: number;
  linked_folders_moved: number;
  sops_kept_as_library: number;
  move_to: string | null;
  backup_last_success: string | null;
}

export const goLiveKey = [...dataKey, "golive"] as const;

export const goLiveOverview = () => api<GoLiveOverview>("/api/workspace/data/golive");

export const startFresh = (body: { confirm_name: string; password: string; code: string; remove_branch_ids: string[]; move_to: string | null }) =>
  api<GoLiveResult>("/api/workspace/data/golive", "POST", body);

/** Where AI workers and files go when nobody picked: the kept company with the most AI
 * workers (the server's command line picks the same way). */
export function defaultHome(kept: GoLiveCompany[]): string | null {
  const best = [...kept].sort((a, b) => b.agents - a.agents || a.name.localeCompare(b.name))[0];
  return best?.id ?? null;
}

export interface GoLivePlan {
  removed: number;
  kept: GoLiveCompany[];
  departments: number;
  other: number;
  agents: number;
  files: number;
  linkedFolders: number;
  /** Something in a removed company outlives it and needs a kept company to go to. */
  needsHome: boolean;
  home: string | null;
  ready: boolean;
}

export function goLivePlan(ov: Pick<GoLiveOverview, "companies">, remove: ReadonlySet<string>, moveTo: string | null): GoLivePlan {
  const gone = ov.companies.filter((c) => remove.has(c.id));
  const kept = ov.companies.filter((c) => !remove.has(c.id));
  const sum = (k: "departments" | "other" | "agents" | "files" | "linked_folders") => gone.reduce((n, c) => n + c[k], 0);
  const agents = sum("agents");
  const files = sum("files");
  const linkedFolders = sum("linked_folders");
  const needsHome = agents + files + linkedFolders > 0;
  const picked = moveTo && kept.some((c) => c.id === moveTo) ? moveTo : null;
  const home = needsHome ? (picked ?? defaultHome(kept)) : null;
  return {
    removed: gone.length,
    kept,
    departments: sum("departments"),
    other: sum("other"),
    agents,
    files,
    linkedFolders,
    needsHome,
    home,
    ready: !needsHome || !!home,
  };
}
