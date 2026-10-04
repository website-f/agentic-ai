import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function initials(name: string): string {
  // "Aisyah (Finance)" reads AF: the name, then the role in brackets (starter teams, P19).
  const role = name.match(/^([^(]*\p{L}[^(]*)\(\s*([\p{L}\p{N}])/u);
  if (role) return (((role[1] ?? "").trim()[0] ?? "") + (role[2] ?? "")).toUpperCase();
  // "Rafi #2" (a helper) reads R2, not R#; other punctuation never becomes an initial.
  const parts = name.trim().replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function timeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "Never";
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "Just now";
}

const SHORT: Partial<Record<Intl.RelativeTimeFormatUnit, string>> = { year: "y", month: "mo", week: "w", day: "d", hour: "h", minute: "m" };

/** Compact age for tight spots like board cards: "now", "3m", "2h", "5d". */
export function shortAge(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const seconds = Math.abs(Math.round((new Date(iso).getTime() - now) / 1000));
  for (const [unit, size] of STEPS) {
    if (seconds >= size) return `${Math.round(seconds / size)}${SHORT[unit]}`;
  }
  return "now";
}

export function greeting(date: Date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
