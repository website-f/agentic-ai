/** My workspace → AI workers: each of the person's own AI workers with what it is doing, when
 * it works, the workflows it follows and quick ways to give it work; for people who manage
 * agents, the company agents they look after and their hours. */
import { ChatCircleDotsIcon, ClockIcon, FlowArrowIcon, KanbanIcon, PencilSimpleIcon, UserFocusIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { AgentAvatar } from "@/components/agent-avatar";
import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ListCard, ListRow } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { useT } from "@/i18n";
import type { Desk } from "@/lib/desk";

import { hoursOf } from "./workflows";

export function AgentsTab({ desk, onWorkflows }: { desk: Desk; onWorkflows: () => void }) {
  const t = useT();
  const flowsOf = (id: string) => desk.procedures.workflows.filter((w) => w.followers.some((f) => f.id === id));
  const company = desk.assignable.filter((a) => !a.mine);
  return (
    <div data-guide="desk.agents" className="grid min-w-0 gap-5">
      {desk.agents.length ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {desk.agents.map((a) => {
            const flows = flowsOf(a.id);
            return (
              <Card key={a.id} className="min-w-0">
                <div className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-4 sm:px-5">
                  <AgentAvatar name={a.name} color={a.color} size="lg" working={!!a.current_task} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-semibold">{a.name}</p>
                    <p className="truncate text-[12.5px] text-muted">{a.is_twin ? t("Your AI worker") : t("Your assistant")} · {a.role}</p>
                  </div>
                  <Pill tone={a.current_task ? "info" : "ok"} live={!!a.current_task}>{a.current_task ? t("Working") : t("Free for work")}</Pill>
                </div>
                <CardBody className="grid gap-4">
                  {a.current_task ? (
                    <Link to="/tasks" search={{ task: a.current_task.id }} className="rounded-sm bg-surface-2/60 px-3 py-2 text-[13px] hover:bg-surface-2">
                      <span className="text-muted">{t("Working on")}</span> <span className="font-medium">{a.current_task.title}</span>
                    </Link>
                  ) : null}
                  <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
                    <div className="grid gap-0.5">
                      <dt className="flex items-center gap-1.5 text-[12px] text-muted"><ClockIcon size={13} /> {t("When it works")}</dt>
                      <dd className="font-medium">{hoursOf(t, { work_hours: a.work_hours ?? null })}</dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="flex items-center gap-1.5 text-[12px] text-muted"><KanbanIcon size={13} /> {t("Open work")}</dt>
                      <dd className="font-medium">{a.open_tasks ? t("{n} open tasks", { n: a.open_tasks }) : t("Nothing open")}</dd>
                    </div>
                  </dl>
                  <div className="grid gap-1.5">
                    <p className="flex items-center gap-1.5 text-[12px] text-muted"><FlowArrowIcon size={13} /> {t("Workflows it follows")}</p>
                    {flows.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {flows.map((w) => <Pill key={w.id} tone="accent" className="max-w-full"><span className="truncate">{w.name}</span></Pill>)}
                      </div>
                    ) : (
                      <p className="text-[12.5px] text-muted">{t("None yet.")}</p>
                    )}
                    <button type="button" onClick={onWorkflows} className="justify-self-start text-[12.5px] font-medium text-accent hover:underline">
                      {t("Choose its workflows")}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" asChild><Link to="/tasks" search={{ new: 1, agent: a.id }}><KanbanIcon size={14} /> {t("Give a task")}</Link></Button>
                    <Button size="sm" variant="outline" asChild><Link to="/chat" search={{ agent: a.id }}><ChatCircleDotsIcon size={14} /> {t("Chat")}</Link></Button>
                    {a.is_twin ? (
                      <Button size="sm" variant="ghost" asChild><Link to="/my-worker"><PencilSimpleIcon size={14} /> {t("Hours and duties")}</Link></Button>
                    ) : (
                      <Button size="sm" variant="ghost" asChild><Link to="/assistants" search={{ a: a.id, tab: "settings" }}><PencilSimpleIcon size={14} /> {t("Settings")}</Link></Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardBody className="grid gap-3 text-[13px] text-muted">
            <IconTile icon={UserFocusIcon} tone="ok" />
            {desk.person.role === "staff" ? (
              <>
                <p>{t("You have no AI worker of your own yet. One works for you, follows your procedures and keeps what it makes in your workspace.")}</p>
                <div><Button size="sm" asChild><Link to="/my-worker">{t("Hire my AI worker")}</Link></Button></div>
              </>
            ) : (
              <>
                <p>{t("Ask any company agent from the box above, or create your own private assistant that works only for you. Everything they make for you lands here.")}</p>
                {desk.can_ask ? <div><Button size="sm" asChild><Link to="/assistants">{t("Create my assistant")}</Link></Button></div> : null}
              </>
            )}
          </CardBody>
        </Card>
      )}
      {company.length ? (
        <Card>
          <CardHeader
            title={t("Company agents you look after")}
            description={t("Their working hours, and the workflows they follow.")}
            icon={<IconTile icon={UsersThreeIcon} size="sm" tone="info" />}
            actions={<Button size="sm" variant="ghost" asChild><Link to="/agents">{t("All agents")}</Link></Button>}
          />
          <ListCard className="max-h-[32rem] overflow-y-auto rounded-none border-0">
            {company.map((a) => {
              const flows = flowsOf(a.id);
              return (
                <ListRow key={a.id}
                  leading={<AgentAvatar name={a.name} color={a.color} size="sm" />}
                  title={a.name}
                  meta={<span className="min-w-0 truncate">{a.role} · {hoursOf(t, a)}</span>}
                  trailing={flows.length ? <Pill tone="accent">{t("{n} workflows", { n: flows.length })}</Pill> : <Pill>{t("No workflow")}</Pill>} />
              );
            })}
          </ListCard>
        </Card>
      ) : null}
    </div>
  );
}
