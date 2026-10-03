import {
  BuildingsIcon,
  ClockCounterClockwiseIcon,
  FileTextIcon,
  FlowArrowIcon,
  KanbanIcon,
  RobotIcon,
  SealCheckIcon,
  SignInIcon,
  SparkleIcon,
  UsersIcon,
  WarningOctagonIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { EmptyState, IconTile, Page, PageHeader, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { auditQuery } from "@/lib/queries";
import type { AuditItem } from "@/lib/types";

/** Plain-language sentence for each audit action. */
function describe(item: AuditItem): string {
  const a = item.after ?? {};
  const b = item.before ?? {};
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  switch (item.action) {
    case "workspace.created": return `created the workspace ${s(a.name)}`;
    case "auth.login": return "signed in";
    case "auth.password_changed": return "changed their password";
    case "member.added": return `added ${s(a.email)} as ${s(a.role)}`;
    case "member.role_changed": return `changed a role from ${s(b.role)} to ${s(a.role)}`;
    case "member.removed": return `removed ${s(b.email)}`;
    case "member.password_reset": return "reset a member's password";
    case "branch.created": return `created the branch ${s(a.name)}`;
    case "branch.updated": return `updated the branch ${s(a.name)}`;
    case "branch.deleted": return `deleted the branch ${s(b.name)}`;
    case "department.created": return `added the ${s(a.name)} department to ${s(a.branch)}`;
    case "department.updated": return b.name !== a.name ? `renamed ${s(b.name)} to ${s(a.name)}` : `updated ${s(a.name)}`;
    case "department.deleted": return `removed the ${s(b.name)} department`;
    default: return fallback(item.action);
  }
}

/** "task.created" -> "created a task", "workflow.run_started" -> "workflow run started". */
function fallback(action: string): string {
  const [entity = "", verb = ""] = action.split(".");
  const noun = entity.replace(/_/g, " ");
  if (/^[a-z]+ed$/.test(verb)) return `${verb} ${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;
  return `${noun} ${verb.replace(/_/g, " ")}`.trim() || action;
}

type Kind = "signin" | "people" | "org" | "work" | "agents" | "other";

const KINDS: Record<Kind, { label: string; icon: Icon; tone: Tone }> = {
  signin: { label: "Sign-ins", icon: SignInIcon, tone: "neutral" },
  people: { label: "People", icon: UsersIcon, tone: "info" },
  org: { label: "Organization", icon: BuildingsIcon, tone: "violet" },
  work: { label: "Work", icon: KanbanIcon, tone: "accent" },
  agents: { label: "Agents", icon: RobotIcon, tone: "orange" },
  other: { label: "Other", icon: SparkleIcon, tone: "neutral" },
};

function kindOf(action: string): Kind {
  const entity = action.split(".")[0] ?? "";
  if (entity === "auth") return action === "auth.login" ? "signin" : "people";
  if (entity === "member") return "people";
  if (["workspace", "branch", "department"].includes(entity)) return "org";
  if (["task", "file", "document", "pack", "workflow", "template", "meeting", "broadcast", "report", "schedule"].includes(entity)) return "work";
  if (["agent", "skill", "sop", "brain", "blueprint"].includes(entity)) return "agents";
  return "other";
}

function iconFor(action: string): { icon: Icon; tone: Tone } {
  const entity = action.split(".")[0] ?? "";
  const k = KINDS[kindOf(action)];
  if (entity === "file" || entity === "document") return { icon: FileTextIcon, tone: k.tone };
  if (entity === "workflow") return { icon: FlowArrowIcon, tone: k.tone };
  return { icon: k.icon, tone: k.tone };
}


function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

export function ActivityPage() {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(auditQuery);
  const verify = useMutation({ mutationFn: () => api<{ ok: boolean; checked: number; broken_at: number | null }>("/api/audit/verify") });
  const [kind, setKind] = useState<Kind | "all">("all");

  const all = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const counts = useMemo(() => {
    const out = new Map<Kind, number>();
    for (const item of all) out.set(kindOf(item.action), (out.get(kindOf(item.action)) ?? 0) + 1);
    return out;
  }, [all]);

  const groups = useMemo(() => {
    const out: { day: string; items: AuditItem[] }[] = [];
    for (const item of all) {
      if (kind !== "all" && kindOf(item.action) !== kind) continue;
      const day = dayLabel(item.ts);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [all, kind]);

  const options = [
    { value: "all" as const, label: "All", count: all.length },
    ...(Object.keys(KINDS) as Kind[]).filter((k) => counts.get(k)).map((k) => ({ value: k, label: KINDS[k].label, count: counts.get(k) })),
  ];

  return (
    <Page>
      <PageHeader
        title="Activity"
        description="Every change in this workspace. Entries are chained by hash, so editing or deleting one is detectable."
        actions={
          <Button variant="outline" loading={verify.isPending} onClick={() => verify.mutate()}>
            {!verify.isPending ? <SealCheckIcon size={16} /> : null} Verify log
          </Button>
        }
      />
      {verify.data ? (
        verify.data.ok ? (
          <div role="status" className="flex items-start gap-3 rounded-[var(--radius-md)] border border-ok/25 bg-ok/8 px-4 py-3">
            <IconTile icon={SealCheckIcon} tone="ok" size="sm" />
            <p className="min-w-0 text-[13px]">
              <span className="font-medium text-ok">Log intact.</span>{" "}
              <span className="text-muted">All {verify.data.checked} entries match their hash chain.</span>
            </p>
          </div>
        ) : (
          <div role="alert" className="flex items-start gap-3 rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 px-4 py-3">
            <IconTile icon={WarningOctagonIcon} tone="danger" size="sm" />
            <p className="min-w-0 text-[13px]">
              <span className="font-medium text-danger">Chain broken at entry {verify.data.broken_at}.</span>{" "}
              <span className="text-muted">An entry from that point on was changed or removed.</span>
            </p>
          </div>
        )
      ) : null}
      {verify.error ? <p role="alert" className="text-[13px] text-danger">{errorMessage(verify.error)}</p> : null}

      {isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 rounded-[var(--radius-md)]" />)}</div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
          Could not load activity. {errorMessage(error)}
        </div>
      ) : all.length === 0 ? (
        <EmptyState icon={ClockCounterClockwiseIcon} title="Nothing recorded yet" body="Changes to members, branches and departments will show up here." />
      ) : (
        <div className="grid gap-6">
          <Segmented label="Filter activity" value={kind} onChange={setKind} options={options} className="w-fit" />
          {groups.length === 0 ? (
            <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">
              No {kind !== "all" ? KINDS[kind].label.toLowerCase() : "entries"} in the loaded activity. Load older activity to look further back.
            </p>
          ) : null}
          {groups.map((g) => (
            <section key={g.day} className="grid gap-2">
              <h2 className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
                {g.day}
                <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular">{g.items.length}</span>
              </h2>
              <ol className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
                {g.items.map((item) => {
                  const look = iconFor(item.action);
                  return (
                    <li key={item.id} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
                      <IconTile icon={look.icon} tone={look.tone} size="sm" className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] break-words">
                          <span className="font-medium">{item.actor_name ?? item.actor}</span>{" "}
                          <span className="text-muted">{describe(item)}</span>
                        </p>
                        {item.note ? <p className="text-[12px] break-words text-muted">{item.note}</p> : null}
                      </div>
                      <time className="mt-0.5 shrink-0 font-mono text-[12px] whitespace-nowrap text-muted tabular" dateTime={item.ts} title={new Date(item.ts).toLocaleString()}>
                        {new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {hasNextPage ? (
            <Button variant="outline" className="justify-self-center max-sm:w-full" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
              Load older activity
            </Button>
          ) : null}
        </div>
      )}
    </Page>
  );
}
