/**
 * P109 Getting started: each person's checklist for their role and their guided tours.
 *
 * The server (GET /api/getting-started) says which steps this person has and which are done:
 * from real data, from a tour they took, or ticked by hand. This file holds what each step
 * says and where it leads, in the person's role's words. Progress (tours seen, the welcome
 * tour's state and where to resume it) is saved on the server with PUT, per person.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";

import { msg } from "@/i18n";

import { api } from "./api";

export type Group = "owner" | "admin" | "branch" | "hod" | "staff";
export type StepKey =
  | "welcome" | "account" | "email" | "language" | "system_mail" | "workspace_settings" | "ai_engine"
  | "companies" | "prima_map" | "library_sources" | "members" | "roles" | "team" | "workspace"
  | "own_ai" | "ai_custom" | "library" | "first_task" | "approvals" | "phone";

export interface StepState {
  key: StepKey;
  done: boolean;
  /** How it was found done: real data, a tour they took, or ticked by hand. */
  by: "data" | "tour" | "hand" | null;
  optional: boolean;
  /** Nothing in the data can tell: the person may tick it. */
  manual: boolean;
}

export interface GettingStarted {
  role: string;
  group: Group;
  is_developer: boolean;
  steps: StepState[];
  done: number;
  total: number;
  complete: boolean;
  tours_seen: string[];
  welcome: "started" | "done" | "skipped" | null;
  resume: { tour: string; step: number } | null;
  dismissed: boolean;
}

export interface GettingStartedSave {
  mark?: Record<string, boolean>;
  tour_seen?: string;
  welcome?: "started" | "done" | "skipped" | null;
  resume?: { tour: string; step: number } | null;
  dismissed?: boolean;
}

export const gettingStartedKey = ["getting-started"] as const;

export const gettingStartedQuery = queryOptions({
  queryKey: gettingStartedKey,
  queryFn: () => api<GettingStarted>("/api/getting-started"),
  staleTime: 30_000,
  retry: false,
});

export const saveGettingStarted = (body: GettingStartedSave) => api<GettingStarted>("/api/getting-started", "PUT", body);

/** Save progress and keep the cached checklist in step (it answers with the new state). */
export function useSaveGettingStarted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveGettingStarted,
    onSuccess: (state) => qc.setQueryData(gettingStartedKey, state),
  });
}

export const GROUP_LABEL: Record<Group, string> = {
  owner: msg("Owner"),
  admin: msg("Admin and management"),
  branch: msg("Branch manager"),
  hod: msg("Head of department or supervisor"),
  staff: msg("Staff"),
};

/** One step as the person sees it: what it is, why, and where to do it. */
export interface StepView {
  title: string;
  why: string;
  /** A page, "compose" (the New task box) or "tour:welcome" (the welcome tour). */
  to: string;
  search?: Record<string, unknown>;
  action: string;
  /** The page tour that shows how. */
  tour?: string;
}

const has = (perms: string[], ...p: string[]) => p.some((x) => perms.includes(x));

export function stepView(key: StepKey, perms: string[]): StepView {
  const twin = perms.includes("agents.own");
  switch (key) {
    case "welcome":
      return { title: msg("Take the welcome tour"), why: msg("Two minutes: where everything is and what to click first."), to: "tour:welcome", action: msg("Start the tour") };
    case "account":
      return { title: msg("Sign in with your own password"), why: msg("Done when you first signed in. Keep it to yourself; turn on two-step sign-in in Settings."), to: "/settings", action: msg("Open Settings") };
    case "email":
      return { title: msg("Connect your Microsoft email"), why: msg("Signing in with Microsoft connects it. Your AI reads and drafts mail only for you, and you press Send."), to: "/mail", action: msg("Open Microsoft 365"), tour: "mail" };
    case "language":
      return { title: msg("Pick your language"), why: msg("Bahasa Melayu or English, for the app and for how your AI talks to you."), to: "/settings", action: msg("Open Settings"), tour: "settings" };
    case "system_mail":
      return { title: msg("Set up the system mail"), why: msg("The Microsoft 365 address the office sends sign-in emails and notices from."), to: "/settings", action: msg("Set it up"), tour: "settings" };
    case "workspace_settings":
      return { title: msg("Check the workspace settings"), why: msg("Your workspace's name, sign-in rules, connections and how the app looks."), to: "/settings", action: msg("Open Settings"), tour: "settings" };
    case "ai_engine":
      return { title: msg("Connect the AI engine"), why: msg("Add a provider key and choose the models for smart, fast and bulk work."), to: "/ai-engine", action: msg("Open the AI Engine"), tour: "ai-engine" };
    case "companies":
      return { title: msg("Add your companies and departments"), why: msg("One company per business in the group, each with its departments."), to: "/organization", action: msg("Open Organization"), tour: "organization" };
    case "prima_map":
      return { title: msg("Match your companies to Prima"), why: msg("Tell Prima which of its companies each office company is, so people open the right one."), to: "/prima", search: { people: 1 }, action: msg("Open Prima settings"), tour: "prima" };
    case "library_sources":
      return { title: msg("Check the Library and its sources"), why: msg("Link SharePoint or OneDrive folders and upload your SOPs; your AI reads the Library before it works."), to: "/library", action: msg("Open the Library"), tour: "library" };
    case "members":
      return { title: msg("Invite your people and set their roles"), why: msg("Add each person by email with their role, company and department. They get a sign-in email."), to: "/settings/members", search: { add: 1 }, action: msg("Add people"), tour: "members" };
    case "roles":
      return { title: msg("Check what each role may do"), why: msg("Owners decide what admins, managers, HODs and staff can open and change."), to: "/settings/roles", action: msg("Open Roles and access"), tour: "members" };
    case "team":
      return has(perms, "team.manage", "members.manage")
        ? { title: msg("Check your team"), why: msg("See who reports to you, their roles and what they work on."), to: "/settings/members", action: msg("Open my team"), tour: "members" }
        : { title: msg("Check your team"), why: msg("See who reports to you and what they work on."), to: "/tasks", action: msg("Open Tasks"), tour: "tasks" };
    case "workspace":
      return { title: msg("Set up your workspace"), why: msg("Pin the pages, files and SOPs you use every day, and arrange your desk."), to: "/workspace", action: msg("Open My workspace"), tour: "workspace" };
    case "own_ai":
      return twin
        ? { title: msg("Create your own AI"), why: msg("Hire your AI worker: pick its job and it learns how you work."), to: "/welcome", action: msg("Hire my AI"), tour: "my-ai" }
        : { title: msg("Create your private assistant"), why: msg("Only you see it: the company at a glance, and drafts you approve."), to: "/assistants", action: msg("Open My assistants"), tour: "assistants" };
    case "ai_custom":
      return twin
        ? { title: msg("Customise your AI"), why: msg("Set its working hours, how it speaks and what it may do for you."), to: "/my-worker", action: msg("Open My AI"), tour: "my-ai" }
        : { title: msg("Customise your assistant"), why: msg("Connect your mail and calendar, and tell it what matters to you."), to: "/assistants", action: msg("Open My assistants"), tour: "assistants" };
    case "library":
      return { title: msg("Look through the Library"), why: msg("Your company's files, SOPs and guidelines in folders. Your AI reads them before it works."), to: "/files", action: msg("Open the Library"), tour: "library" };
    case "first_task":
      return { title: msg("Give your first task"), why: msg("To a colleague or to your AI, in your own words, with a due date."), to: "compose", action: msg("Give a task"), tour: "tasks" };
    case "approvals":
      return { title: msg("Answer an approval"), why: msg("Agents and colleagues ask before anything important. Approve once, always, or deny."), to: "/approvals", action: msg("Open Approvals"), tour: "approvals" };
    case "phone":
      return { title: msg("Get notices on your phone"), why: msg("Answer approvals and your AI from anywhere."), to: "/channels", action: msg("Connect your phone"), tour: "channels" };
  }
}

/** The next step to do (the first one not done that is not optional). */
export function nextStep(state: GettingStarted | undefined): StepState | undefined {
  return state?.steps.find((s) => !s.done && !s.optional);
}
