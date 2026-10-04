import { CheckCircleIcon, ClockIcon, ListChecksIcon, LockSimpleIcon, MegaphoneIcon, PaperPlaneTiltIcon, UsersIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { canShare } from "@/components/agent-access";
import { AgentAvatar } from "@/components/agent-avatar";
import { LoadMore } from "@/components/load-more";
import { EmptyState, IconTile, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, ListCard, ListRow, Meta } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { usePagedList } from "@/lib/paged";
import { branchesQuery, meQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery, broadcastQuery, workKeys, type Audience, type Broadcast } from "@/lib/work";

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
      className={cn("inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition-colors", on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface hover:bg-surface-2")}>
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
    <Card className="self-start">
      <CardHeader title="New broadcast" description="Pick who hears it, then write once." icon={<IconTile icon={PaperPlaneTiltIcon} size="sm" />} />
      <section className="grid grid-cols-[minmax(0,1fr)] content-start gap-5 p-4 sm:p-5" aria-label="New broadcast">
      <div className="grid min-w-0 gap-2">
        <span className="text-[13px] font-medium">To</span>
        <RadioGroup.Root value={everyone ? "all" : "pick"} onValueChange={(v) => setEveryone(v === "all")} className="inline-flex w-fit gap-0.5 rounded-sm border border-border bg-surface-2/60 p-0.5" aria-label="Audience">
          {[["all", "Everyone"], ["pick", "Choose"]].map(([v, l]) => (
            <RadioGroup.Item key={v} value={v!} className="h-8 rounded-[6px] px-3.5 text-[13px] text-muted transition-colors hover:text-fg data-[state=checked]:bg-surface data-[state=checked]:font-medium data-[state=checked]:text-fg data-[state=checked]:shadow-[0_1px_2px_hsl(var(--shadow)/0.12)] data-[state=checked]:ring-1 data-[state=checked]:ring-border">{l}</RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        {!everyone ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-sm border border-border bg-surface-2/40 p-3">
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
            {agents.some(canShare) ? (
              <div className="grid gap-1.5">
                <span className="text-[12px] text-muted">Individual agents</span>
                <div className="flex flex-wrap gap-1.5">
                  {/* Not colleagues' agents (view only) nor personal assistants. */}
                  {agents.filter((a) => a.status === "active" && canShare(a)).map((a) => (
                    <Chip key={a.id} on={aud.agent_ids.includes(a.id)} onClick={() => toggle("agent_ids", a.id)}>
                      <AgentAvatar name={a.name} color={a.color} size="xs" className="-ml-1.5" /> {a.name}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="flex min-w-0 items-start gap-1.5 text-[12.5px] text-muted" aria-live="polite">
          <UsersIcon size={14} className="mt-0.5 shrink-0" />
          {!hasAudience ? "Pick at least one group." : preview.isFetching && !preview.data ? "Counting..." : preview.data ? `${preview.data.count} active ${preview.data.count === 1 ? "agent" : "agents"}: ${preview.data.label}` : ""}
        </p>
      </div>

      <div className="grid gap-2">
        <span className="text-[13px] font-medium">Kind</span>
        <RadioGroup.Root value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2" aria-label="Kind">
          {([
            ["announcement", MegaphoneIcon, "Announcement", "Agents keep it in mind from their next step on."],
            ["directive", ListChecksIcon, "A task for each", "Each agent gets it as a task in Triage. You start them."],
          ] as const).map(([v, IconCmp, label, hint]) => (
            <RadioGroup.Item key={v} value={v} className="group flex min-w-0 items-start gap-3 rounded-[var(--radius-sm)] border border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-2/50 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50">
              <IconCmp size={18} weight="duotone" className="mt-0.5 shrink-0 text-muted group-data-[state=checked]:text-accent" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{label}</span>
                <span className="block text-[12px] text-muted">{hint}</span>
              </span>
            </RadioGroup.Item>
          ))}
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
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
        <Button className="max-sm:w-full" disabled={!body.trim() || !hasAudience || preview.data?.count === 0} loading={send.isPending} onClick={() => send.mutate()}>
          <PaperPlaneTiltIcon size={15} weight="fill" /> Send broadcast
        </Button>
      </div>
      </section>
    </Card>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: b, isLoading } = useQuery({ ...broadcastQuery(id), refetchInterval: (q) => (q.state.data && q.state.data.acked < q.state.data.targets ? 4000 : false) });
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} title={b ? (b.mode === "directive" ? "Task for each" : "Announcement") : "Broadcast"}
      description={b ? `${b.audience_label} · sent ${timeAgo(b.created_at).toLowerCase()} by ${b.sender_name ?? "someone"}` : undefined}>
      {isLoading || !b ? <div className="grid gap-3"><Skeleton className="h-24 rounded-[var(--radius-md)]" /><Skeleton className="h-40 rounded-[var(--radius-md)]" /></div> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <p className="rounded-[var(--radius-md)] border border-border bg-surface-2/60 px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{b.body}</p>
          <div className="grid gap-1.5">
            <p className="flex items-baseline justify-between gap-2 text-[13px] text-muted">
              <span>{b.acked} of {b.targets} {b.mode === "directive" ? "have a task" : b.request_reply ? "replied" : "received it"}</span>
              <span className="tabular">{b.targets ? Math.round((b.acked / b.targets) * 100) : 0}%</span>
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Received" aria-valuemin={0} aria-valuemax={b.targets} aria-valuenow={b.acked}>
              <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${b.targets ? (b.acked / b.targets) * 100 : 0}%` }} />
            </div>
          </div>
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
            {b.receipts?.map((r) => (
              <li key={r.agent_id} className="flex gap-3 px-4 py-3">
                <AgentAvatar name={r.agent_name} color={r.agent_color} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium break-words">{r.agent_name} <span className="font-normal text-muted">{r.department_name ?? r.agent_role}, {r.branch_name}</span></p>
                  {r.reply ? <p className="mt-1 rounded-sm bg-surface-2/60 px-2.5 py-1.5 text-[13px] break-words text-muted">"{r.reply}"</p> : null}
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
  // Sent broadcasts only grow: 50 at a time as you scroll.
  const list = usePagedList<Broadcast>(workKeys.broadcasts, "/api/broadcasts");
  const { items: history, isLoading } = list;
  const sent = list.total ?? history.length;
  const search = useSearch({ strict: false }) as { b?: string };
  const navigate = useNavigate();
  return (
    <Page className="max-w-7xl">
      <PageHeader title="Broadcasts" description="Message every agent, a whole company, chosen departments, or specific agents. See who received it." />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {canWrite ? <Composer /> : (
          <EmptyState icon={LockSimpleIcon} title="Read only" body="Your role can read broadcasts but not send them." />
        )}
        <Section title="Sent" description={sent ? `${sent} ${sent === 1 ? "broadcast" : "broadcasts"}, newest first` : undefined}>
          {isLoading ? (
            <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-[var(--radius-md)]" />)}</div>
          ) : !history.length ? (
            <EmptyState icon={MegaphoneIcon} title="Nothing sent yet" body="Announcements sit in each agent's context for 30 days. Tasks land in Triage." />
          ) : (
            <ListCard>
              {history.map((b) => (
                <ListRow
                  key={b.id}
                  active={search.b === b.id}
                  onClick={() => navigate({ to: "/broadcasts", search: { b: b.id } })}
                  leading={<IconTile icon={b.mode === "directive" ? ListChecksIcon : MegaphoneIcon} tone={b.mode === "directive" ? "info" : "accent"} size="sm" />}
                  title={<span className="block whitespace-normal"><span className="line-clamp-2 break-words">{b.body}</span></span>}
                  meta={<Meta items={[<span className="truncate">{b.audience_label}</span>, timeAgo(b.created_at)]} />}
                  trailing={<>
                    <Pill tone={b.mode === "directive" ? "info" : "accent"}>{b.mode === "directive" ? "Tasks" : "Announcement"}</Pill>
                    <Pill tone={b.acked >= b.targets ? "ok" : "neutral"} className="tabular">{b.acked}/{b.targets} {b.request_reply ? "replied" : "received"}</Pill>
                  </>}
                />
              ))}
            </ListCard>
          )}
          {history.length ? <LoadMore noun="broadcasts" shown={history.length} total={list.total} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} /> : null}
        </Section>
      </div>
      {search.b ? <Detail id={search.b} onClose={() => navigate({ to: "/broadcasts", search: {} })} /> : null}
    </Page>
  );
}
