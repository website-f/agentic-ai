/** P27: how forms, rounds and schedules are worded (shared by the Forms page and the desk). */
import { locale, msg } from "@/i18n";
import type { CompanyForm, FormState, Schedule } from "@/lib/forms";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";
export type T = (s: string, v?: Record<string, string | number>) => string;

export const STATE_LABEL: Record<FormState, { label: string; tone: Tone }> = {
  accepted: { label: msg("Accepted"), tone: "ok" },
  submitted: { label: msg("Handed in"), tone: "info" },
  returned: { label: msg("Returned to fix"), tone: "danger" },
  draft: { label: msg("AI draft to check"), tone: "accent" },
  upcoming: { label: msg("Not open yet"), tone: "neutral" },
  open: { label: msg("Open"), tone: "accent" },
  due_soon: { label: msg("Due soon"), tone: "warn" },
  late: { label: msg("Late"), tone: "danger" },
  anytime: { label: msg("When needed"), tone: "neutral" },
};

export const PERSON: Record<string, { label: string; tone: Tone }> = {
  missing: { label: msg("Not yet"), tone: "neutral" },
  late: { label: msg("Late"), tone: "danger" },
  draft: { label: msg("Not yet"), tone: "neutral" },
  submitted: { label: msg("Handed in"), tone: "info" },
  returned: { label: msg("Returned to fix"), tone: "danger" },
  accepted: { label: msg("Accepted"), tone: "ok" },
};

export function day(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

export function monthName(m: number): string {
  return new Date(2026, m - 1, 1).toLocaleDateString(locale(), { month: "long" });
}

/** "2026-10" → "October 2026"; "2026" → "2026"; a once-off round's own date stays as is. */
export function periodText(p: string | null): string {
  if (!p) return "";
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString(locale(), { month: "long", year: "numeric" });
  const d = /^(\d{4}-\d{2}-\d{2})-\d+$/.exec(p);
  if (d) return new Date(`${d[1]}T00:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
  return p;
}

export function scheduleText(t: T, s: Schedule): string {
  if (s.every === "month") {
    return s.to_day! < s.from_day!
      ? t("Every month, from the {a}th to the {b}th of the next month", { a: s.from_day!, b: s.to_day! })
      : t("Every month, {a}th to {b}th", { a: s.from_day!, b: s.to_day! });
  }
  if (s.every === "year") return t("Every year in {month}, {a}th to {b}th", { month: monthName(s.month ?? 12), a: s.from_day!, b: s.to_day! });
  if (s.every === "once") return t("Once, by {date}", { date: day(s.due_on ?? null) });
  return t("Whenever needed");
}

export function whenText(t: T, f: CompanyForm): string {
  if (f.state === "anytime") return t("Hand in whenever needed");
  if (f.state === "upcoming" && f.opens) return t("Opens {date}", { date: day(f.opens) });
  if (f.due) return t("{period} · due {date}", { period: periodText(f.period), date: day(f.due) });
  return periodText(f.period);
}
