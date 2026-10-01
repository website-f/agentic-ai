import { useQuery } from "@tanstack/react-query";
import { RadioGroup } from "radix-ui";

import { Pill } from "@/components/ui/pill";
import { SwitchField } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toolsQuery, type ToolMode } from "@/lib/work";

const MODES: { value: ToolMode; label: string }[] = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask me" },
  { value: "deny", label: "Never" },
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
  const { data: registry = [] } = useQuery(toolsQuery);
  return (
    <div className="grid gap-4">
      <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
        {registry.map((t) => {
          const mode = tools[t.name] ?? t.default_mode;
          return (
            <li key={t.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="flex items-center gap-2 text-[13.5px] font-medium">
                  {t.label}
                  {t.risk !== "low" ? <Pill tone={RISK_TONE[t.risk]}>{t.risk === "high" ? "High" : "Medium"} risk</Pill> : null}
                </p>
                <p className="text-[12.5px] text-muted">{t.description}</p>
              </div>
              <RadioGroup.Root
                value={mode}
                disabled={disabled}
                onValueChange={(v) => onChange({ ...tools, [t.name]: v as ToolMode })}
                aria-label={`Permission for ${t.label}`}
                className="inline-flex shrink-0 rounded-sm border border-border p-0.5"
              >
                {MODES.map((m) => (
                  <RadioGroup.Item
                    key={m.value}
                    value={m.value}
                    className={cn(
                      "rounded-[6px] px-2.5 py-1 text-[12.5px] text-muted disabled:opacity-60",
                      "data-[state=checked]:font-medium",
                      m.value === "allow" && "data-[state=checked]:bg-ok/12 data-[state=checked]:text-ok",
                      m.value === "ask" && "data-[state=checked]:bg-warn/14 data-[state=checked]:text-warn",
                      m.value === "deny" && "data-[state=checked]:bg-danger/12 data-[state=checked]:text-danger",
                    )}
                  >
                    {m.label}
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
        label="Work on auto"
        hint="Tools set to Ask me run without asking, except high-risk ones. Never stays never, and private or internal addresses are always blocked."
      />
    </div>
  );
}
