import { useQuery } from "@tanstack/react-query";
import { RadioGroup } from "radix-ui";

import { Pill } from "@/components/ui/pill";
import { SwitchField } from "@/components/ui/switch";
import { msg, useLang, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { toolsQuery, type ToolMode } from "@/lib/work";

const MODES: { value: ToolMode; label: string }[] = [
  { value: "allow", label: msg("Allow") },
  { value: "ask", label: msg("Ask me") },
  { value: "deny", label: msg("Never") },
];

const RISK_TONE = { low: "neutral", medium: "warn", high: "danger" } as const;

/** Per-tool permission. The hardline floor (private addresses, unknown tools) applies regardless. */
export function ToolMatrix({
  tools,
  onChange,
  autonomy,
  onAutonomy,
  disabled,
}: {
  tools: Record<string, ToolMode>;
  onChange: (next: Record<string, ToolMode>) => void;
  autonomy: "ask" | "auto";
  onAutonomy: (a: "ask" | "auto") => void;
  disabled?: boolean;
}) {
  const t = useT();
  // "Never" is also the time word (Tidak pernah); the tool setting needs its own Malay word.
  const lang = useLang((s) => s.lang);
  const { data: registry = [] } = useQuery(toolsQuery);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
        {registry.map((tool) => {
          const mode = tools[tool.name] ?? (tool.follows ? tools[tool.follows] : undefined) ?? tool.default_mode;
          // Tools like browser_snapshot inherit the setting of the tool they follow, unless set here.
          const follows = tool.follows && !tools[tool.name] ? registry.find((x) => x.name === tool.follows)?.label ?? tool.follows : null;
          return (
            <li key={tool.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium">
                  {tool.label}
                  {tool.risk !== "low" ? <Pill tone={RISK_TONE[tool.risk]}>{tool.risk === "high" ? t("High risk") : t("Medium risk")}</Pill> : null}
                </p>
                <p className="text-[12.5px] text-muted">{tool.description}</p>
                {follows ? <p className="mt-0.5 text-[12px] text-muted italic">{t("Follows {tool} unless set here", { tool: follows })}</p> : null}
              </div>
              <RadioGroup.Root
                value={mode}
                disabled={disabled}
                onValueChange={(v) => onChange({ ...tools, [tool.name]: v as ToolMode })}
                aria-label={t("Permission for {tool}", { tool: tool.label })}
                className="inline-flex shrink-0 rounded-sm border border-border p-0.5"
              >
                {MODES.map((m) => (
                  <RadioGroup.Item
                    key={m.value}
                    value={m.value}
                    className={cn(
                      "h-8 rounded-[6px] px-3 text-[12.5px] text-muted transition-colors hover:text-fg disabled:opacity-60",
                      "data-[state=checked]:font-medium",
                      m.value === "allow" && "data-[state=checked]:bg-ok/12 data-[state=checked]:text-ok",
                      m.value === "ask" && "data-[state=checked]:bg-warn/14 data-[state=checked]:text-warn",
                      m.value === "deny" && "data-[state=checked]:bg-danger/12 data-[state=checked]:text-danger",
                    )}
                  >
                    {m.value === "deny" && lang === "ms" ? t("Never (tool permission)") : t(m.label)}
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </li>
          );
        })}
      </ul>
      <SwitchField
        checked={autonomy === "auto"}
        onCheckedChange={(v) => onAutonomy(v ? "auto" : "ask")}
        disabled={disabled}
        label={t("Work on auto")}
        hint={t("Tools set to Ask me run without asking, except high-risk ones. Never stays never, and private or internal addresses are always blocked.")}
      />
    </div>
  );
}
