/** P30: one personal AI per person. Private assistants are for people who manage others
 * (assistants.use); everyone with agents.own has one AI twin, reached as "My AI": Today
 * (/my-worker) plus the twin page's tabs (/twin). Kept free of React so the router and
 * tests can import it cheaply. */

export const ASSIST = "assistants.use";

/** May have private assistants (owner, admin, branch manager, HOD, supervisor). */
export const canAssist = (perms: readonly string[]) => perms.includes(ASSIST);

/** Where /assistants sends someone who may not have assistants: their AI twin when their
 * role has one, else their own desk. */
export function assistantsFallback(perms: readonly string[]): "/my-worker" | "/workspace" {
  return perms.includes("agents.own") ? "/my-worker" : "/workspace";
}

export const TWIN_TABS = ["profile", "chat", "tasks", "memory", "teach"] as const;
export type TwinTab = (typeof TWIN_TABS)[number];
export type MyAiTab = "today" | TwinTab;

/** The My AI tab a location is on. /twin without a tab is its profile. */
export function myAiTab(pathname: string, tab?: string): MyAiTab {
  if (!pathname.startsWith("/twin")) return "today";
  return TWIN_TABS.find((x) => x === tab) ?? "profile";
}
