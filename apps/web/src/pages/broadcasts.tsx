import { CheckCircleIcon, ClockIcon, MegaphoneIcon, PaperPlaneTiltIcon, UsersIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { branchesQuery, meQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery, broadcastQuery, broadcastsQuery, workKeys, type Audience, type Broadcast } from "@/lib/work";

const EMPTY: Audience = { all: false, branch_ids: [], department_ids: [], agent_ids: [] };

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px]", on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface hover:bg-surface-2")}>
      {children}
    </button>
  );
}

function Composer() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: branches = [] } = useQuery(branchesQuery);
  const { data: agents = [] } = useQuery(agentsQuery);
  const [everyone, setEveryone] = useState(true);
  const [aud, setAud] = useState<Audience>(EMPTY);
  const [mode, setMode] = useState<"announcement" | "directive">("announcement");
  const [reply, setReply] = useState(false);
  const [body, setBody] = useState("");
  const audience: Audience = everyone ? { ...EMPTY, all: true } : aud;
  const debounced = useDebounced(audience);
  const hasAudience = audience.all || audience.branch_ids.length + audience.department_ids.length + audience.agent_ids.length > 0;

  const preview = useQuery({
    queryKey: ["broadcasts", "preview", debounced],
    queryFn: () => api<{ label: string; count: number; agents: { id: string; name: string }[] }>("/api/broadcasts/preview", "POST", { audience: debounced, body: "preview" }),
    enabled: hasAudience,
  });
  const send = useMutation({
    mutationFn: () => api<Broadcast>("/api/broadcasts", "POST", { audience, mode, body, request_reply: reply }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: workKeys.broadcasts });
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      toast.success(`Sent to ${b.targets} ${b.targets === 1 ? "agent" : "agents"}.`);
      setBody("");
      navigate({ to: "/broadcasts", search: { b: b.id } });
    },
  });
  const toggle = (key: "branch_ids" | "department_ids" | "agent_ids", id: string) =>
    setAud((a) => ({ ...a, [key]: a[key].includes(id) ? a[key].filter((x) => x !== id) : [...a[key], id] }));

  return (
    <section className="grid content-start gap-4 rounded-[var(--radius-md)] border border-border bg-surface p-4 sm:p-5" aria-label="New broadcast">
      <div className="grid gap-2">
        <span className="text-[13px] font-medium">To</span>
        <RadioGroup.Root value={everyone ? "all" : "pick"} onValueChange={(v) => setEveryone(v === "all")} className="inline-flex w-fit rounded-sm border border-border p-0.5" aria-label="Audience">
          {[["all", "Everyone"], ["pick", "Choose"]].map(([v, l]) => (
            <RadioGroup.Item key={v} value={v!} className="rounded-[6px] px-3 py-1.5 text-[13px] text-muted data-[state=checked]:bg-accent-soft data-[state=checked]:font-medium data-[state=checked]:text-accent">{l}</RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        {!everyone ? (
          <div className="grid gap-3 rounded-sm border border-border bg-surface-2/40 p-3">
            {branches.map((b) => (
              <div key={b.id} className="grid gap-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip on={aud.branch_ids.includes(b.id)} onClick={() => toggle("branch_ids", b.id)}>
                    <span aria-hidden className="size-2 rounded-full" style={{ background: b.color }} /> All of {b.name}
                  </Chip>
                </div>
                <div className="flex flex-wrap gap-1.5 pl-1">
                  {b.departments.map((d) => <Chip key={d.id} on={aud.department_ids.includes(d.id)} onClick={() => toggle("department_ids", d.id)}>{d.name}</Chip>)}
                </div>
              </div>
            ))}
            {agents.length ? (
              <div className="grid gap-1.5">
                <span className="text-[12px] text-muted">Individual agents</span>
                <div className="flex flex-wrap gap-1.5">
                  {agents.filter((a) => a.status === "active").map((a) => (
                    <Chip key={a.id} on={aud.agent_ids.includes(a.id)} onClick={() => toggle("agent_ids", a.id)}>
                      <AgentAvatar name={a.name} color={a.color} size="xs" className="-ml-1.5" /> {a.name}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted" aria-live="polite">
          <UsersIcon size={14} />
          {!hasAudience ? "Pick at least one group." : preview.isFetching && !preview.data ? "Counting..." : preview.data ? `${preview.data.count} active ${preview.data.count === 1 ? "agent" : "agents"}: ${preview.data.label}` : ""}
        </p>
      </div>

      <div className="grid gap-2">
        <span className="text-[13px] font-medium">Kind</span>
        <RadioGroup.Root value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="grid gap-2 sm:grid-cols-2" aria-label="Kind">
          <RadioGroup.Item value="announcement" className="rounded-sm border border-border px-3 py-2 text-left data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50">
            <span className="block text-[13px] font-medium">Announcement</span>
            <span className="block text-[12px] text-muted">Agents keep it in mind from their next step on.</span>
          </RadioGroup.Item>
          <RadioGroup.Item value="directive" className="rounded-sm border border-border px-3 py-2 text-left data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50">
            <span className="block text-[13px] font-medium">A task for each</span>
            <span className="block text-[12px] text-muted">Each agent gets it as a task in Triage. You start them.</span>
          </RadioGroup.Item>
        </RadioGroup.Root>
      </div>
      {mode === "announcement" ? (
        <SwitchField checked={reply} onCheckedChange={setReply} label="Ask each agent to reply" hint="Each writes one or two sentences on how it affects their work. Uses a little AI per agent." />
      ) : null}

      <div className="grid gap-1.5">
        <label htmlFor="bc-body" className="text-[13px] font-medium">Message</label>
        <textarea id="bc-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5}
          placeholder={mode === "directive" ? "First line becomes the task title.\nThen the details." : "e.g. From October, all quotations need two approvals before sending."}
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
      </div>
      <FormError message={send.error ? errorMessage(send.error) : null} />
      <Button className="w-fit" disabled={!body.trim() || !hasAudience || preview.data?.count === 0} loading={send.isPending} onClick={() => send.mutate()}>
        <PaperPlaneTiltIcon size={15} weight="fill" /> Send broadcast
      </Button>
    </section>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: b, isLoading } = useQuery({ ...broadcastQuery(id), refetchInterval: (q) => (q.state.data && q.state.data.acked < q.state.data.targets ? 4000 : false) });
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} title={b ? (b.mode === "directive" ? "Task for each" : "Announcement") : "Broadcast"}
      description={b ? `${b.audience_label} · sent ${timeAgo(b.created_at).toLowerCase()} by ${b.sender_name ?? "someone"}` : undefined}>
      {isLoading || !b ? <Skeleton className="h-40" /> : (
        <div className="grid gap-5">
          <p className="rounded-[var(--radius-md)] bg-surface-2 px-4 py-3 text-[14px] whitespace-pre-wrap">{b.body}</p>
          <p className="text-[13px] text-muted">{b.acked} of {b.targets} {b.mode === "directive" ? "have a task" : b.request_reply ? "replied" : "received it"}</p>
          <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
            {b.receipts?.map((r) => (
              <li key={r.agent_id} className="flex gap-3 px-4 py-3">
                <AgentAvatar name={r.agent_name} color={r.agent_color} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">{r.agent_name} <span className="font-normal text-muted">{r.department_name ?? r.agent_role}, {r.branch_name}</span></p>
                  {r.reply ? <p className="mt-0.5 text-[13px] text-muted">"{r.reply}"</p> : null}
                  {r.task_id ? <Link to="/tasks" search={{ task: r.task_id }} className="text-[12.5px] text-accent hover:underline">Open task</Link> : null}
                </div>
                {r.ack_at ? <CheckCircleIcon size={18} weight="fill" className="shrink-0 text-ok" aria-label="Received" /> : <ClockIcon size={18} className="shrink-0 text-muted" aria-label="Waiting" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SideSheet>
  );
}

export function BroadcastsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const { data: history, isLoading } = useQuery(broadcastsQuery);
  const search = useSearch({ strict: false }) as { b?: string };
  const navigate = useNavigate();
  return (
    <Page className="max-w-7xl">
      <PageHeader title="Broadcasts" description="Message every agent, a whole company, chosen departments, or specific agents. See who received it." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {canWrite ? <Composer /> : <p className="text-[13.5px] text-muted">Your role can read broadcasts but not send them.</p>}
        <section className="grid content-start gap-2">
          <h2 className="text-[14px] font-semibold">Sent</h2>
          {isLoading ? <Skeleton className="h-32" /> : !history?.length ? (
            <EmptyState icon={MegaphoneIcon} title="Nothing sent yet" body="Announcements sit in each agent's context for 30 days. Tasks land in Triage." />
          ) : (
            <ul className="grid gap-2">
              {history.map((b) => (
                <li key={b.id}>
                  <button onClick={() => navigate({ to: "/broadcasts", search: { b: b.id } })} className="grid w-full gap-1 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-left hover:border-accent/40">
                    <span className="flex items-center gap-2 text-[12.5px] text-muted">
                      <Pill tone={b.mode === "directive" ? "info" : "accent"}>{b.mode === "directive" ? "Tasks" : "Announcement"}</Pill>
                      <span className="truncate">{b.audience_label}</span>
                      <span className="ml-auto shrink-0">{timeAgo(b.created_at)}</span>
                    </span>
                    <span className="line-clamp-2 text-[13.5px]">{b.body}</span>
                    <span className="text-[12px] text-muted">{b.acked}/{b.targets} {b.request_reply ? "replied" : "received"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {search.b ? <Detail id={search.b} onClose={() => navigate({ to: "/broadcasts", search: {} })} /> : null}
    </Page>
  );
}
