/**
 * P49 "Get set up": the few steps that make the office work, in order, for the person
 * reading: an owner or manager sets up the company; a staff member sets up their own AI.
 * Each step is ticked from real data (GET /api/tutorial/progress signals), never by hand, so
 * the list is always true. Shown in the sidebar until done, and on /start.
 */
import { msg } from "@/i18n";

import type { Signal } from "./tutorial";

export interface SetupStep {
  key: string;
  title: string;
  why: string;
  /** Done when any of these is true. */
  signals: Signal[];
  /** Where to do it. "compose" opens the New task box. */
  to: string;
  search?: Record<string, unknown>;
  action: string;
  /** Only shown to people with one of these permissions. */
  perm?: string[];
  optional?: boolean;
}

export const OWNER_STEPS: SetupStep[] = [
  {
    key: "ai", title: msg("Connect an AI"), signals: ["provider"], to: "/ai-engine", action: msg("Add an AI key"),
    why: msg("Your agents think with an AI model. Paste one key (OpenAI, Google, Groq or OpenRouter); free and local models work too."),
    perm: ["engine.manage", "org.read"],
  },
  {
    key: "company", title: msg("Add your company"), signals: ["company"], to: "/organization", search: { new: 1 }, action: msg("Add the company"),
    why: msg("Pick your industry and you get a ready AI team for it, with departments."),
    perm: ["org.manage"],
  },
  {
    key: "team", title: msg("Meet your AI team"), signals: ["agent"], to: "/agents", action: msg("Open the AI team"),
    why: msg("Check each agent's job, or hire one for any role with Recruit with AI."),
    perm: ["agents.manage"],
  },
  {
    key: "library", title: msg("Put your SOPs and documents in the Library"), signals: ["library", "sop"], to: "/files", action: msg("Upload files"),
    why: msg("Agents read the Library before they work, so they do things your way."),
  },
  {
    key: "people", title: msg("Invite your staff"), signals: ["people"], to: "/settings/members", search: { add: 1 }, action: msg("Add people"),
    why: msg("Each person gets their own AI worker and a daily AI allowance you set."),
    perm: ["members.manage", "team.manage"],
  },
  {
    key: "phone", title: msg("Reach the office from your phone"), signals: ["whatsapp", "telegram", "push"], to: "/channels", action: msg("Connect your phone"),
    why: msg("Approve from your phone, and let staff send receipts as photos on WhatsApp or Telegram."),
  },
  {
    key: "task", title: msg("Give your first task"), signals: ["task_created"], to: "compose", action: msg("Give a task"),
    why: msg("Say what you need in your own words. The AI asks before anything important."),
  },
];

export const STAFF_STEPS: SetupStep[] = [
  {
    key: "twin", title: msg("Hire your AI worker"), signals: ["twin"], to: "/welcome", action: msg("Start"),
    why: msg("Your own AI that learns your job and does the routine parts for you."),
  },
  {
    key: "hours", title: msg("Set its working hours"), signals: ["work_hours"], to: "/my-worker", action: msg("Set hours"),
    why: msg("It works when you do, and waits for its next shift after hours."),
  },
  {
    key: "phone", title: msg("Get notices on your phone"), signals: ["push", "whatsapp", "telegram"], to: "/channels", action: msg("Connect your phone"),
    why: msg("Answer your AI from anywhere, and send receipts as photos."),
  },
  {
    key: "task", title: msg("Give your first task"), signals: ["task_created"], to: "compose", action: msg("Give a task"),
    why: msg("Ask for anything about your job, in your own words."),
  },
  {
    key: "computer", title: msg("Link your computer"), signals: ["device"], to: "/computers", search: { link: 1 }, action: msg("Link it"),
    why: msg("Your AI finds files on it for you, and you can reach it from anywhere."), optional: true,
  },
];

/** The steps this person sees, with done flags. */
export function stepsFor(staff: boolean, perms: string[], signals: Partial<Record<Signal, boolean>>) {
  const list = (staff ? STAFF_STEPS : OWNER_STEPS).filter((s) => !s.perm || s.perm.some((p) => perms.includes(p)));
  return list.map((s) => ({ ...s, done: s.signals.some((k) => !!signals[k]) }));
}
