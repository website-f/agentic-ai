/**
 * P97: whose cards, by face. Everyone, only people, only AI, or one person or agent: my team
 * first (me and the people who report to me, then my people's and my department's agents).
 * Scrolls sideways inside itself on phones; the page never does.
 */
import { RobotIcon, UsersIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { AgentAvatar } from "@/components/agent-avatar";
import { AssigneePicker, workableAgents } from "@/components/assignee-picker";
import { PersonAvatar } from "@/components/person-avatar";
import { useT } from "@/i18n";
import { teamPeopleQuery } from "@/lib/people";
import { cn } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

const SHOWN = 10;

export function PeopleStrip({ value, onChange, teamOnly }: { value: string; onChange: (v: string) => void; teamOnly?: boolean }) {
  const t = useT();
  const { data: people = [] } = useQuery(teamPeopleQuery);
  const { data: agents = [] } = useQuery(agentsQuery);
  const team = people.filter((p) => p.me || p.reports_to_me);
  const teamIds = new Set(team.map((p) => p.user_id));
  const faces = [
    ...(team.length > 1 || teamOnly ? team : people).slice(0, SHOWN).map((p) => ({ value: `user:${p.user_id}`, name: p.me ? t("Me") : p.name, full: p.name, person: true, id: p.user_id, color: "" })),
    ...workableAgents(agents)
      .filter((a) => !teamOnly || (a.owner_user_id && teamIds.has(a.owner_user_id)) || !a.owner_user_id)
      .slice(0, SHOWN)
      .map((a) => ({ value: `agent:${a.id}`, name: a.name, full: a.name, person: false, id: a.id, color: a.color })),
  ];
  const known = value === "" || value === "people" || value === "agents" || faces.some((f) => f.value === value);
  const chip = (on: boolean) =>
    cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium transition-colors pointer-coarse:h-11",
      on ? "border-accent bg-accent-soft/60 text-accent" : "border-border bg-surface text-muted hover:border-accent/40 hover:text-fg");
  return (
    <div role="radiogroup" aria-label={t("Whose tasks")} data-guide="tasks.people"
      className="-mx-1 flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button type="button" role="radio" aria-checked={value === ""} className={chip(value === "")} onClick={() => onChange("")}>{t("Everyone")}</button>
      <button type="button" role="radio" aria-checked={value === "people"} className={chip(value === "people")} onClick={() => onChange(value === "people" ? "" : "people")}>
        <UsersIcon size={14} /> {t("People")}
      </button>
      <button type="button" role="radio" aria-checked={value === "agents"} className={chip(value === "agents")} onClick={() => onChange(value === "agents" ? "" : "agents")}>
        <RobotIcon size={14} /> {t("AI")}
      </button>
      <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-border" />
      {faces.map((f) => {
        const on = value === f.value;
        return (
          <button key={f.value} type="button" role="radio" aria-checked={on} title={f.full} onClick={() => onChange(on ? "" : f.value)}
            className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border py-0 pr-2.5 pl-1 text-[12.5px] transition-colors pointer-coarse:h-11",
              on ? "border-accent bg-accent-soft/60 text-fg" : "border-transparent text-muted hover:border-border hover:text-fg")}>
            {f.person ? <PersonAvatar name={f.full} id={f.id} size="xs" /> : <AgentAvatar name={f.name} color={f.color} size="xs" />}
            <span className="max-w-[8rem] truncate">{f.name}</span>
          </button>
        );
      })}
      <div className="w-44 shrink-0">
        <AssigneePicker compact allowNobody={false} label={t("Show the tasks of")} placeholder={t("Someone else")} value={!known && (value.startsWith("user:") || value.startsWith("agent:")) ? (value as `user:${string}`) : ""}
          onChange={(v) => onChange(v)} className={cn("w-full", !known && "border-accent bg-accent-soft/60")} />
      </div>
    </div>
  );
}
