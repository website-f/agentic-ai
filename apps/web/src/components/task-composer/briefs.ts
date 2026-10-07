/** The words the composer hands an agent, and the repeat presets. Pure: no React. */

/** A title from what was typed: its first real line, without markdown marks, at most 120. */
export function titleFrom(text: string): string {
  const line = text.split("\n").map((l) => l.replace(/^[\s#>*\-•\d.)]+/, "").trim()).find(Boolean) ?? "";
  if (line.length <= 120) return line;
  const cut = line.slice(0, 119);
  const space = cut.lastIndexOf(" ");
  return `${space > 60 ? cut.slice(0, space) : cut}…`;
}

/**
 * Research the web: the person's question, then how to do it. Written for the agent in English
 * like every server-made brief (web_tasks.brief_for); the agent answers in the person's language.
 */
export function researchBrief(question: string, output: "answer" | "report"): string {
  return [
    question.trim(),
    "",
    "How to do this: research it on the public web. Use web_search to find good sources, then read " +
      "the useful pages (research_gather for several at once, or web_fetch). Prefer primary, official " +
      "and recent sources.",
    "Cite every fact with the link it came from. Say plainly where sources disagree, and when nothing " +
      "reliable was found, say so instead of guessing.",
    output === "report"
      ? "Write it up with publish_report: a short summary, the findings with their sources, and a table " +
        "when the findings are list-like."
      : "Keep the answer short: the key facts, each with its link.",
  ].join("\n");
}

/** Repeat presets: each runs at the time picked beside it (custom takes a cron line). */
export type RepeatPreset = "weekdays" | "monday" | "monthly" | "daily" | "custom";

export function cronFor(preset: RepeatPreset, time: string, custom: string): string {
  if (preset === "custom") return custom.trim().split(/\s+/).join(" ");
  const [h = "9", m = "0"] = (time || "09:00").split(":");
  const hour = String(Math.min(23, Math.max(0, Number(h) || 0)));
  const minute = String(Math.min(59, Math.max(0, Number(m) || 0)));
  const days = { weekdays: "* * 1-5", monday: "* * 1", monthly: "1 * *", daily: "* * *" }[preset];
  return `${minute} ${hour} ${days}`;
}
